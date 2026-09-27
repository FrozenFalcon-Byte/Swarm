"""The Swarm worker: turns Firestore requests into agent work.

The web app never writes tasks. It only creates:
* repos/{id}/runs/{run}       {status: "queued"}            -> ingest issues, run agents until idle
* repos/{id}/actions/{action} {status: "pending", type, taskId, comment}
                                                             -> merge / approve / reject / reopen / close
The worker validates every request against the state machine and repo
membership, so security rules can keep tasks read-only for clients.
"""

from __future__ import annotations

import copy
import logging
import os
import shutil
import socket
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
from google.api_core import exceptions as gexc
from google.cloud import firestore as gfs

from ..board import InvalidTransition, TaskState
from ..board.models import utcnow
from ..config import Settings
from .. import houserules, lab
from ..issues import Issue, from_file, from_github
from ..orchestrator import Swarm
from . import firebase
from .board import FirestoreTaskBoard
from .github import GitError, explain, issues_changed_since, open_pull_request, repo_info, sync_checkout
from .registry import FirestoreToolRegistry

log = logging.getLogger("swarm.worker")
def _project_root() -> Path:
    """Where demo_repo/ and demo_issues.json live. Next to the package in a checkout or an editable install;
    after a plain `pip install .` the package is in site-packages, so look in SWARM_ROOT or the working
    directory (the repository in CI, /app in the Docker image) instead."""
    for base in (os.environ.get("SWARM_ROOT"), Path(__file__).resolve().parents[2], Path.cwd()):
        if base and (Path(base) / "demo_repo").is_dir():
            return Path(base).resolve()
    return Path.cwd()


ROOT = _project_root()

# How far along a task is, out of 5: a run's percentage is the tasks it touches, averaged.
STAGE = {TaskState.NEW: 0, TaskState.TRIAGED: 1, TaskState.IN_PROGRESS: 2, TaskState.AWAITING_TESTS: 3,
         TaskState.IN_REVIEW: 4, TaskState.REJECTED: 1, TaskState.APPROVED: 5, TaskState.HUMAN_REVIEW: 5,
         TaskState.MERGED: 5, TaskState.CLOSED: 5}
AT_REST = {TaskState.APPROVED, TaskState.HUMAN_REVIEW, TaskState.MERGED, TaskState.CLOSED}
# where each phase sits on the bar; the agents' share is filled in by the tasks moving
PHASES = {"preparing": (0, 4, "Getting the code"), "lab": (4, 8, "Making up bugs"), "reading": (8, 12, "Reading the issues"),
          "agents": (12, 97, "Agents working"), "saving": (97, 99, "Saving results"), "done": (100, 100, "Done")}
OVER = {"completed", "failed", "rejected", "input-required", "canceled"}


class RunProgress:
    """What a run is doing, written onto its run document (`progress`) so the web app can show a percentage,
    the phase, and what each agent is on. It follows the board and the agents' A2A traffic, keeps its own
    copy of the task states (no extra reads), and writes at most every 1.5 seconds."""

    def __init__(self, ref, every: float = 1.5):
        self.ref, self.every = ref, every
        self.phase = "preparing"
        self.states: dict[str, TaskState] = {}
        self.in_play: set[str] = set()
        self.agents: dict[str, dict] = {}
        self.errors: list[dict] = []
        self.percent = 0
        self._lock = threading.Lock()
        self._dirty = True
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, name="run-progress", daemon=True)

    # -- inputs ------------------------------------------------------------------
    def start(self) -> "RunProgress":
        self._thread.start()
        return self

    def set_phase(self, phase: str) -> None:
        with self._lock:
            self.phase, self._dirty = phase, True

    def watch(self, swarm) -> None:
        tasks = swarm.board.list()
        with self._lock:
            self.states = {t.task_id: t.state for t in tasks}
            self.in_play = {t.task_id for t in tasks if t.state not in AT_REST}
            self._dirty = True
        swarm.board.subscribe(self.on_task)
        swarm.on_exchange(self.on_exchange)
        swarm.on_activity(self.on_activity)

    def on_task(self, _event: str, t) -> None:
        with self._lock:
            if self.states.get(t.task_id) != t.state:
                self.in_play.add(t.task_id)
            self.states[t.task_id] = t.state
            if (t.artifacts or {}).get("last_error"):
                e = t.artifacts["last_error"]
                entry = {"agent": e.get("agent"), "task": t.task_id, "error": (e.get("error") or "")[:300]}
                if entry not in self.errors:
                    self.errors = [*self.errors, entry][-10:]
            self._dirty = True

    def on_exchange(self, e: dict) -> None:
        if e.get("kind") not in ("status", "task") or e.get("from") not in PHASE_AGENTS:
            return
        with self._lock:
            a = self.agents.setdefault(e["from"], {})
            state = e.get("state") or ""
            a.update(task=e.get("taskId"), state=state, busy=state not in OVER)
            if e.get("text"):
                a["text"] = e["text"][:160]
            self._dirty = True

    def on_activity(self, e: dict) -> None:
        if e.get("agent") not in PHASE_AGENTS or not e.get("message"):
            return
        with self._lock:
            a = self.agents.setdefault(e["agent"], {})
            a.update(text=e["message"][:160], task=e.get("task_id") or a.get("task"))
            self._dirty = True

    # -- output ------------------------------------------------------------------
    def snapshot(self) -> dict:
        lo, hi, label = PHASES[self.phase]
        play = [self.states[t] for t in self.in_play if t in self.states]
        done = sum(1 for s in play if s in AT_REST)
        if self.phase == "agents" and play:
            share = sum(STAGE.get(s, 0) for s in play) / (5 * len(play))
            pct = lo + (hi - lo) * share
        else:
            pct = lo
        self.percent = max(self.percent, min(100, round(pct)))  # never goes backwards, even when a fix is rejected
        return {"phase": self.phase, "label": label, "percent": self.percent, "tasks": len(play), "settled": done,
                "agents": {k: v for k, v in self.agents.items()}, "errors": self.errors[-5:], "updatedAt": utcnow()}

    def flush(self, force: bool = False) -> None:
        with self._lock:
            if not (self._dirty or force):
                return
            snap, self._dirty = self.snapshot(), False
        try:
            self.ref.update({"progress": snap})
        except Exception as e:  # progress is a nicety; never let it stop the run
            log.warning("couldn't write run progress: %s", e)

    def _loop(self) -> None:
        while not self._stop.wait(self.every):
            self.flush()

    def finish(self, phase: str = "done") -> dict:
        self._stop.set()
        with self._lock:
            self.phase = phase
            if phase == "done":
                self.percent = 100
                for a in self.agents.values():
                    a["busy"] = False
            return self.snapshot()


PHASE_AGENTS = ("triager", "coder", "tester", "reviewer")


class Worker:
    def __init__(self, settings: Settings | None = None, poll_s: float = 2.0):
        self.settings = settings or Settings()
        self.db = firebase.db()
        self.bucket = firebase.bucket()
        self.poll_s = poll_s
        self.worker_id = f"{socket.gethostname()}-{os.getpid()}"
        self._last_beat = 0.0
        self._last_sync = 0.0
        self.mode = "always-on"  # "scheduled" for one pass at a time (cron, GitHub Actions)
        # how often to look for new GitHub issues on connected repos; 0 turns it off
        self.sync_minutes = float(os.environ.get("SWARM_SYNC_MINUTES", "10"))

    # -- per-repo swarm --------------------------------------------------------
    def _repo(self, repo_id: str) -> dict:
        snap = self.db.collection("repos").document(repo_id).get()
        if not snap.exists:
            raise KeyError(repo_id)
        return snap.to_dict()

    def _token(self, repo: dict) -> str | None:
        """The repo owner's GitHub token, else the worker's own GITHUB_TOKEN, else anonymous."""
        snap = self.db.collection("users").document(repo["ownerUid"]).collection("private").document("github").get()
        saved = (snap.to_dict() or {}).get("token") if snap.exists else None
        return saved or os.environ.get("GITHUB_TOKEN") or None

    def _swarm(self, repo_id: str, repo: dict) -> Swarm:
        s = copy.copy(self.settings)
        s.home = self.settings.home / "repos" / repo_id
        s.repo_path = s.home / "checkout"
        s.house_rules = houserules.clean((repo.get("settings") or {}).get("rules"))
        s.ensure_dirs()
        board = FirestoreTaskBoard(self.db, repo_id)
        registry = FirestoreToolRegistry(self.db, self.bucket, repo_id, s.tools_dir, s.use_embeddings)
        swarm = Swarm(s, board=board, registry=registry)
        activity = self.db.collection("repos").document(repo_id).collection("activity")
        swarm.on_activity(lambda e: activity.add({**e, "createdAt": gfs.SERVER_TIMESTAMP}))
        # every A2A message, status update and result between agents, for the Handoffs view
        a2a = self.db.collection("repos").document(repo_id).collection("a2a")
        swarm.on_exchange(lambda e: a2a.add({**e, "createdAt": gfs.SERVER_TIMESTAMP}))
        outside = (repo.get("settings") or {}).get("secondOpinionAgents")
        if isinstance(outside, list):
            swarm.network.external = [u for u in outside if isinstance(u, str) and u.startswith(("https://", "http://"))][:3]
        return swarm

    def _prepare_checkout(self, swarm: Swarm, repo: dict) -> None:
        dest = swarm.settings.repo_path
        if repo.get("source") == "lab":
            written = lab.materialize(lab.project_of(repo["_lab"]).files, dest)
            if written:
                log.info("lab: wrote %d new files", len(written))
            return
        if repo.get("source") == "demo":
            if not dest.exists():
                shutil.copytree(ROOT / "demo_repo", dest, ignore=shutil.ignore_patterns("__pycache__"))
            if repo.get("_lab"):  # an admin made up extra waves of bugs on top of the demo
                lab.materialize(lab.project_of(repo["_lab"]).files, dest)
            return
        sync_checkout(repo["fullName"], dest, self._token(repo), repo.get("defaultBranch"))

    def _issues(self, repo: dict):
        if repo.get("source") == "lab":
            return [Issue(i["number"], i["title"], i.get("body") or "", i.get("labels") or [])
                    for i in lab.project_of(repo["_lab"]).issues]
        if repo.get("source") == "demo":
            extra = [Issue(i["number"], i["title"], i.get("body") or "", i.get("labels") or [])
                     for i in lab.project_of(repo["_lab"]).issues] if repo.get("_lab") else []
            return from_file(ROOT / "demo_issues.json") + extra
        try:
            return from_github(repo["fullName"], self._token(repo) or "")
        except httpx.HTTPStatusError as e:
            raise GitError(explain(e.response, repo["fullName"])) from e

    # -- runs ------------------------------------------------------------------
    def _claim(self, ref, field_value: str, new_value: str) -> bool:
        @gfs.transactional
        def txn(tx) -> bool:
            snap = ref.get(transaction=tx)
            if not snap.exists or snap.get("status") != field_value:
                return False
            tx.update(ref, {"status": new_value, "worker": self.worker_id, "startedAt": gfs.SERVER_TIMESTAMP})
            return True

        return txn(self.db.transaction())

    def process_runs(self) -> int:
        done = 0
        q = self.db.collection_group("runs").where(filter=gfs.FieldFilter("status", "==", "queued")).limit(5)
        for snap in q.stream():
            if not self._claim(snap.reference, "queued", "running"):
                continue
            repo_id = snap.reference.parent.parent.id
            progress = RunProgress(snap.reference).start()
            try:
                summary = self.run_repo(repo_id, progress)
                snap.reference.update({"status": "done", "finishedAt": gfs.SERVER_TIMESTAMP, "summary": summary,
                                       "progress": progress.finish("done")})
            except Exception as e:  # a failed run is reported, never retried silently
                log.exception("run failed for %s", repo_id)
                snap.reference.update({"status": "failed", "finishedAt": gfs.SERVER_TIMESTAMP, "error": str(e)[:500],
                                       "progress": progress.finish(progress.phase)})
                self.db.collection("repos").document(repo_id).update({"status": "error", "lastError": str(e)[:300]})
            done += 1
        return done

    def run_repo(self, repo_id: str, progress: RunProgress | None = None) -> dict:
        step = progress.set_phase if progress else (lambda _p: None)
        repo = self._repo(repo_id)
        repo_ref = self.db.collection("repos").document(repo_id)
        started = datetime.now(timezone.utc).isoformat(timespec="seconds")
        repo_ref.update({"status": "running"})
        if repo.get("source") == "github":
            # refresh branch/visibility each run: repos get renamed, made private, or change default branch
            info = repo_info(repo["fullName"], self._token(repo))
            repo_ref.update(info)
            repo.update(info)
        swarm = self._swarm(repo_id, repo)
        if repo.get("source") == "lab" or (repo.get("source") == "demo" and (repo.get("lab") or {}).get("waves")):
            step("lab")
            repo["_lab"] = self._lab_waves(repo_id, repo, swarm)
        step("preparing")
        self._prepare_checkout(swarm, repo)
        step("reading")
        before = {t.task_id: t.state for t in swarm.board.list()}
        issues = self._issues(repo)
        if progress:
            progress.watch(swarm)
        created = swarm.ingest(issues)
        step("agents")
        messages = swarm.run_until_idle()
        step("saving")
        self._upload_artifacts(repo_id, swarm)
        after = swarm.board.list()
        moved = sum(1 for t in after if before.get(t.task_id) != t.state)
        stats = self.compute_stats(swarm)
        repo_ref.update({"status": "idle", "stats": stats, "lastRunAt": gfs.SERVER_TIMESTAMP, "lastError": None,
                         "lastSyncedAt": started})
        return {"ingested": created, "messages": messages, "tasksMoved": moved, "llm": swarm.llm.describe()["active"],
                "sandbox": swarm.sandbox.backend, "toolsWritten": stats["toolsWritten"],
                "errors": [{"agent": e["agent"], "task": e["task_id"], "error": e["error"]} for e in swarm.errors[:10]]}

    def _lab_waves(self, repo_id: str, repo: dict, swarm: Swarm) -> list[dict]:
        """Test-lab repos: make up every wave that was asked for and not made yet, then return them all."""
        repo_ref = self.db.collection("repos").document(repo_id)
        store = repo_ref.collection("lab")
        records = sorted((s.to_dict() for s in store.stream()), key=lambda r: r["index"])
        specs = ((repo.get("lab") or {}).get("waves") or [])[:20]
        activity = repo_ref.collection("activity")

        def say(msg: str) -> None:
            log.info("lab %s: %s", repo_id, msg)
            activity.add({"ts": utcnow(), "agent": "lab", "message": msg, "task_id": None, "createdAt": gfs.SERVER_TIMESTAMP})

        for i in range(len(records), len(specs)):
            spec = specs[i] if isinstance(specs[i], dict) else {}
            avoid = []
            if i == 0:
                mine = self.db.collection("repos").where(filter=gfs.FieldFilter("ownerUid", "==", repo["ownerUid"])).stream()
                avoid = [(r.to_dict() or {}).get("displayName", "") for r in mine if (r.to_dict() or {}).get("source") == "lab"][:20]
            say(f"making up wave {i + 1}")
            repo_ref.update({"labStatus": f"making up wave {i + 1}"})
            rec = lab.make_wave(spec, lab.LabState.of(records), swarm.llm, swarm.settings, avoid=avoid, say=say)
            rec.update(index=i, createdAt=gfs.SERVER_TIMESTAMP)
            store.document(f"{i:03d}").set(rec)
            records.append(rec)
            if i == 0 and repo.get("source") == "lab":
                repo_ref.update({"displayName": rec["package"], "fullName": f"lab/{rec['package']}",
                                 "description": rec["description"][:200]})
            say(f"wave {i + 1}: {len(rec['bugs'])} bugs and {len(rec['issues'])} issues, made by {rec['via']}")
        repo_ref.update({"labStatus": None})
        return records

    def _upload_artifacts(self, repo_id: str, swarm: Swarm) -> None:
        """Patches and test results go to Cloud Storage alongside the task that made them (when there is a bucket;
        the diff and the evidence are on the task document either way)."""
        if self.bucket is None:
            return
        for d, kind in ((swarm.settings.patches_dir, "patches"), (swarm.settings.results_dir, "results")):
            for f in d.glob("*"):
                blob = self.bucket.blob(f"repos/{repo_id}/{kind}/{f.name}")
                if not blob.exists():
                    blob.upload_from_filename(str(f), content_type="application/json" if f.suffix == ".json" else "text/x-diff")

    @staticmethod
    def compute_stats(swarm: Swarm) -> dict:
        tasks = swarm.board.list()
        counts = {s.value: 0 for s in TaskState}
        for t in tasks:
            counts[t.state.value] += 1
        tools = swarm.registry.all()
        before, after = [], []
        for t in tasks:
            for e in (t.artifacts.get("test_summary", {}).get("harness", {}).get("evidence", {}) or {}).values():
                if e.get("before", {}).get("runs"):
                    before.append(e["before"]["failures"] / e["before"]["runs"])
                    after.append((e["after"].get("failures") or 0) / max(1, e["after"].get("runs") or 1))
        return {
            "counts": counts,
            "total": len(tasks),
            "open": sum(counts[s.value] for s in (TaskState.TRIAGED, TaskState.IN_PROGRESS, TaskState.AWAITING_TESTS,
                                                   TaskState.IN_REVIEW, TaskState.REJECTED)),
            "needsYou": counts[TaskState.APPROVED.value] + counts[TaskState.HUMAN_REVIEW.value],
            "merged": counts[TaskState.MERGED.value],
            "toolsWritten": len(tools),
            "toolReuses": sum(max(0, r.usage_count - 1) for r in tools),
            "flakeRateBefore": round(sum(before) / len(before), 3) if before else None,
            "flakeRateAfter": round(sum(after) / len(after), 3) if after else None,
            "updatedAt": utcnow(),
        }

    # -- GitHub sync ----------------------------------------------------------------
    def sync_due_repos(self, force: bool = False) -> int:
        """Queue a run for each GitHub repo that has new or edited issues since its last run."""
        if not force and (self.sync_minutes <= 0 or time.monotonic() - self._last_sync < self.sync_minutes * 60):
            return 0
        self._last_sync = time.monotonic()
        queued = 0
        repos = self.db.collection("repos").where(filter=gfs.FieldFilter("source", "==", "github")).stream()
        for snap in repos:
            repo = snap.to_dict()
            if repo.get("paused") or (repo.get("settings") or {}).get("autoSync") is False:
                continue
            if not houserules.schedule_allows((repo.get("settings") or {}).get("schedule")):
                continue  # quiet hours: picked up when the next window opens
            if repo.get("status") in ("queued", "running") or not repo.get("lastSyncedAt"):
                continue  # busy, or never run: the connect run covers it
            try:
                changed = issues_changed_since(repo["fullName"], self._token(repo), repo["lastSyncedAt"])
            except (GitError, httpx.HTTPError) as e:
                log.warning("sync check failed for %s: %s", repo.get("fullName"), e)
                continue
            if changed:
                snap.reference.collection("runs").add({"status": "queued", "trigger": "github-sync", "requestedBy": "worker",
                                                       "changedIssues": changed, "createdAt": gfs.SERVER_TIMESTAMP})
                snap.reference.update({"status": "queued"})
                queued += 1
        return queued

    # -- human actions ------------------------------------------------------------
    def process_actions(self) -> int:
        done = 0
        q = self.db.collection_group("actions").where(filter=gfs.FieldFilter("status", "==", "pending")).limit(10)
        for snap in q.stream():
            if not self._claim(snap.reference, "pending", "processing"):
                continue
            repo_id = snap.reference.parent.parent.id
            a = snap.to_dict()
            try:
                result = self.apply_action(repo_id, a)
                snap.reference.update({"status": "done", "result": result, "finishedAt": gfs.SERVER_TIMESTAMP})
            except (InvalidTransition, ValueError, KeyError, PermissionError, GitError) as e:
                snap.reference.update({"status": "failed", "error": str(e)[:400], "finishedAt": gfs.SERVER_TIMESTAMP})
            except Exception as e:  # anything else: say so on the action and carry on, never leave it "processing"
                log.exception("action %s on %s failed", a.get("type"), repo_id)
                snap.reference.update({"status": "failed", "error": f"unexpected: {e}"[:400], "finishedAt": gfs.SERVER_TIMESTAMP})
            done += 1
        return done

    def apply_action(self, repo_id: str, a: dict) -> str:
        repo = self._repo(repo_id)
        if a.get("uid") not in repo.get("members", []):
            raise PermissionError("not a member of this repository")
        swarm = self._swarm(repo_id, repo)
        who = a.get("userName") or "maintainer"
        kind, task_id, comment = a["type"], a["taskId"], (a.get("comment") or "").strip()
        if kind == "merge":
            self._prepare_checkout(swarm, repo)
            deliver = None
            token = self._token(repo)
            if repo.get("source") == "github" and token:
                def deliver(task):
                    url = open_pull_request(repo["fullName"], swarm.settings.repo_path, token,
                                            repo.get("defaultBranch") or "main", task.task_id,
                                            f"Fix intermittent test failure: {task.title}", _pr_body(task), task.artifacts["diff_text"])
                    return f"opened {url}"
            task = swarm.merge(task_id, deliver=deliver)
            result = task.artifacts.get("delivery", "merged")
        elif kind == "approve":
            swarm.approve(task_id, f"{who}: {comment}" if comment else who)
            result = "approved"
        elif kind == "reject":
            if not comment:
                raise ValueError("say what should change so the coder can act on it")
            swarm.reject(task_id, f"{who}: {comment}")
            result = "sent back to the coder"
        elif kind == "reopen":
            swarm.reopen(task_id, comment)
            result = "sent to the swarm"
        elif kind == "close":
            swarm.close(task_id, comment or f"closed by {who}")
            result = "closed"
        else:
            raise ValueError(f"unknown action {kind}")
        self.db.collection("repos").document(repo_id).update({"stats": self.compute_stats(swarm)})
        if kind in ("approve", "reject", "reopen"):  # the swarm has new work
            self.db.collection("repos").document(repo_id).collection("runs").add(
                {"status": "queued", "trigger": f"action:{kind}", "requestedBy": a.get("uid"), "createdAt": gfs.SERVER_TIMESTAMP})
        return result

    # -- loop -------------------------------------------------------------------
    def heartbeat(self) -> None:
        if time.monotonic() - self._last_beat < 15:
            return
        self._last_beat = time.monotonic()
        from ..llm import LLM
        from ..sandbox import Sandbox

        self.db.collection("workers").document(self.worker_id).set({
            "lastSeen": gfs.SERVER_TIMESTAMP, "llm": LLM(self.settings).describe(),
            "sandbox": Sandbox(self.settings).backend, "host": socket.gethostname(),
            "syncMinutes": self.sync_minutes, "githubFallbackToken": bool(os.environ.get("GITHUB_TOKEN")),
            "mode": self.mode, "protocol": "a2a", "agents": self._cards(),
        })

    @staticmethod
    def _cards() -> list[dict]:
        from ..a2a import AGENTS, agent_card, card_json
        from ..a2a.network import INTERNAL_URL

        return [card_json(agent_card(name, INTERNAL_URL)) for name in AGENTS]

    def run_once(self) -> None:
        """One pass for scheduled hosts (cron, CI): sync issues, then work until nothing is waiting."""
        log.info("worker %s: one pass (emulators=%s)", self.worker_id, firebase.using_emulators())
        self._last_beat = 0.0
        self.mode = "scheduled"
        self.heartbeat()
        self.sync_due_repos(force=self.sync_minutes > 0)  # a scheduled pass is itself the interval
        while self.process_actions() + self.process_runs():
            pass

    def run_forever(self) -> None:
        log.info("worker %s polling (emulators=%s)", self.worker_id, firebase.using_emulators())
        while True:
            try:
                self.heartbeat()
                self.sync_due_repos()
                busy = self.process_actions() + self.process_runs()
            except (gexc.FailedPrecondition, gexc.ServiceUnavailable, gexc.DeadlineExceeded) as e:
                # FailedPrecondition: indexes are still building right after a deploy (a few minutes)
                log.warning("Firestore not ready, retrying in 30s: %s", str(e).split(" See its status")[0])
                time.sleep(30)
                continue
            if not busy:
                time.sleep(self.poll_s)


def _pr_body(task) -> str:
    a = task.artifacts
    ev = a.get("test_summary", {}).get("harness", {})
    lines = [f"Fixes {task.source_issue}.", "", f"**Root cause:** {a.get('root_cause', '')}", "",
             f"**Verified with** `{ev.get('tool_id', '-')}`:"]
    for test, e in (ev.get("evidence") or {}).items():
        lines.append(f"- `{test}`: {e['before'].get('failures')}/{e['before'].get('runs')} failing before → "
                     f"{e['after'].get('failures')}/{e['after'].get('runs')} after")
    lines += ["", "Reviewed by the Swarm reviewer agent and approved by a maintainer."]
    return "\n".join(lines)
