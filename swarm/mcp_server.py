"""`swarm mcp`: Swarm as an MCP server, so Claude (or any MCP client) can work with the board.

Two backends:
* local (default): the SQLite board in SWARM_HOME, the same one `swarm demo` / `swarm run` use.
* cloud (`--cloud`): repositories in Firestore, using the worker's Firebase credentials. Runs are
  queued for the worker exactly as the dashboard queues them.

Two transports:
* stdio (`swarm mcp`): one client on this machine, acting as the operator.
* HTTP (`swarm server`): any number of clients over the network, each with a personal access
  token made in the dashboard. A token acts as the user who made it and sees only their repos.

What a client can do is deliberately narrow: read the board, tasks and harnesses; start a run; and
send a patch back to the coder with feedback. There is no approve or merge tool. Merging stays a
human click in the dashboard.
"""

from __future__ import annotations

import functools
import json
from typing import Any

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

from .board import InvalidTransition, TaskState
from .board.models import Task
from .config import Settings

READ = ToolAnnotations(readOnlyHint=True, openWorldHint=False)
ACT = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=False, openWorldHint=False)
NEEDS_YOU = (TaskState.APPROVED, TaskState.HUMAN_REVIEW)


def explained(fn):
    """Let expected problems (unknown task, a move the state machine forbids) reach the client in words."""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except (KeyError, ValueError, InvalidTransition, PermissionError) as e:
            raise ToolError(str(e).strip("'\"")) from e
    return wrapper


def task_summary(t: Task) -> dict[str, Any]:
    return {"task_id": t.task_id, "issue": t.source_issue, "title": t.title, "state": t.state.value,
            "kind": t.kind, "priority": t.priority, "attempts": t.attempts, "note": t.note or None}


def task_detail(t: Task) -> dict[str, Any]:
    a = t.artifacts
    harness = a.get("test_summary", {}).get("harness", {})
    review = a.get("review", {})
    return {
        **task_summary(t),
        "body": t.body[:2000],
        "root_cause": a.get("root_cause"),
        "diff": a.get("diff_text"),
        "evidence": {test: {"before": f"{e['before'].get('failures')}/{e['before'].get('runs')} failing",
                            "after": f"{e['after'].get('failures')}/{e['after'].get('runs')} failing"}
                     for test, e in (harness.get("evidence") or {}).items()} or None,
        "harness": harness.get("tool_id"),
        "review": [{"check": c["name"], "ok": c["ok"], "detail": c["detail"]} for c in review.get("checks", [])] or None,
        "history": [f"{h.ts[:19]} {h.agent}: {h.action}" for h in t.history[-12:]],
    }


class LocalBackend:
    kind = "local"

    def __init__(self, settings: Settings):
        from .orchestrator import Swarm

        demo = settings.home / "workspace" / "tagkit"
        if demo.exists():
            settings.repo_path = demo.resolve()
        self.swarm = Swarm(settings)

    def repos(self) -> list[dict]:
        return [{"id": "local", "name": str(self.swarm.settings.repo_path)}]

    def board(self, repo: str | None):
        return self.swarm.board

    def registry(self, repo: str | None):
        return self.swarm.registry

    def run(self, repo: str | None) -> str:
        before = {t.task_id: t.state for t in self.swarm.board.list()}
        self.swarm.ingest(self.swarm.load_issues(None))
        sent = self.swarm.run_until_idle()
        moved = [t for t in self.swarm.board.list() if before.get(t.task_id) != t.state]
        return f"the agents exchanged {sent} A2A messages; {len(moved)} task(s) moved: " + ", ".join(f"{t.task_id}→{t.state.value}" for t in moved)

    def request_changes(self, repo: str | None, task_id: str, comment: str) -> str:
        self.swarm.reject(task_id, f"via MCP: {comment}")
        return f"{task_id} sent back to the coder. Call run_swarm to let it try again."

    def read_tool(self, repo: str | None, tool_id: str) -> str:
        from pathlib import Path

        rec = self.swarm.registry.get(tool_id)
        if not rec:
            raise KeyError(tool_id)
        return Path(rec.code_path).read_text()


def current_user() -> tuple[str | None, str]:
    """The Swarm user behind this request's access token, and the token's name. (None, "") over stdio."""
    from mcp.server.auth.middleware.auth_context import get_access_token

    tok = get_access_token()
    return (tok.subject, tok.client_id) if tok else (None, "")


class CloudBackend:
    kind = "cloud"
    via = "via MCP"  # how requests from this backend are labelled on the board

    def __init__(self, settings: Settings, per_user: bool = False, as_user: tuple[str, str] | None = None):
        from .cloud import firebase

        self.settings = settings
        self.db = firebase.db()
        self.bucket = firebase.bucket()
        self.per_user = per_user or bool(as_user)  # over HTTP every call must come from a token's user
        self.as_user = as_user  # (uid, token name) when the caller is known up front, as in the A2A gateway

    def _who(self) -> tuple[str | None, str]:
        return self.as_user or current_user()

    def _uid(self) -> str | None:
        uid, _ = self._who()
        if self.per_user and not uid:
            raise PermissionError("this server needs an access token")
        return uid

    def repos(self) -> list[dict]:
        from google.cloud.firestore_v1.base_query import FieldFilter

        uid = self._uid()
        query = self.db.collection("repos")
        if uid:
            query = query.where(filter=FieldFilter("members", "array_contains", uid))
        out = []
        for snap in query.stream():
            d = snap.to_dict() or {}
            if d.get("fullName"):
                out.append({"id": snap.id, "name": d["fullName"], "status": d.get("status"), "needsYou": (d.get("stats") or {}).get("needsYou", 0)})
        return out

    def _repo_id(self, repo: str | None) -> str:
        repos = self.repos()
        if repo:
            match = next((r for r in repos if repo in (r["id"], r["name"])), None)
            if not match:
                raise KeyError(f"no repository {repo!r}; call list_repos")
            return match["id"]
        if len(repos) == 1:
            return repos[0]["id"]
        if not repos:
            raise ValueError("no repositories are connected yet; connect one in the Swarm dashboard")
        raise ValueError("several repositories are connected; pass repo (see list_repos)")

    def board(self, repo: str | None):
        from .cloud.board import FirestoreTaskBoard

        return FirestoreTaskBoard(self.db, self._repo_id(repo))

    def registry(self, repo: str | None):
        from .cloud.registry import FirestoreToolRegistry

        rid = self._repo_id(repo)
        return FirestoreToolRegistry(self.db, self.bucket, rid, self.settings.tools_dir / rid, self.settings.use_embeddings)

    def queue_run(self, repo: str | None, trigger: str = "mcp"):
        """Queue a run for the worker; returns (repo id, the run's document)."""
        from google.cloud import firestore as gfs

        rid = self._repo_id(repo)
        _, ref = self.db.collection("repos").document(rid).collection("runs").add(
            {"status": "queued", "trigger": trigger, "requestedBy": self._uid() or trigger, "createdAt": gfs.SERVER_TIMESTAMP})
        return rid, ref

    def run(self, repo: str | None) -> str:
        self.queue_run(repo)
        return "queued; the worker picks it up within seconds. Check back with board_summary."

    def request_changes(self, repo: str | None, task_id: str, comment: str) -> str:
        from google.cloud import firestore as gfs

        rid = self._repo_id(repo)
        uid, client = self._who()
        # over stdio the operator speaks for the repo owner; over HTTP the token's user speaks for themselves
        uid = uid or self.db.collection("repos").document(rid).get().get("ownerUid")
        self.db.collection("repos").document(rid).collection("actions").add(
            {"status": "pending", "type": "reject", "taskId": task_id, "comment": comment, "uid": uid,
             "userName": f"{self.via} ({client})" if client else self.via, "createdAt": gfs.SERVER_TIMESTAMP})
        return f"sent {task_id} back to the coder; the worker applies it and starts a new run."

    def read_tool(self, repo: str | None, tool_id: str) -> str:
        rec = self.registry(repo).get(tool_id)
        if not rec:
            raise KeyError(tool_id)
        from pathlib import Path

        return Path(rec.code_path).read_text()


def build(settings: Settings, cloud: bool = False, **http: Any) -> MCPServer:
    """`http` carries token_verifier and auth when serving over HTTP (see swarm.server)."""
    backend = CloudBackend(settings, per_user=bool(http)) if cloud else LocalBackend(settings)
    server = MCPServer(
        "swarm",
        title="Swarm",
        description="Four agents that fix tests that fail at random, working through a shared task board.",
        **http,
        instructions=(
            "Swarm's agents (triager, coder, tester, reviewer) move issues across a task board. Use board_summary "
            "first. Tasks in 'Approved' or 'Needs Human' are waiting for the maintainer. You can start a run and "
            "send a patch back with feedback, but you can't approve or merge: tell the user to do that in the "
            "Swarm dashboard."
        ),
    )
    repo_hint = " Pass repo when several repositories are connected (see list_repos)." if cloud else ""

    @server.tool(annotations=READ, description="Counts per board column and the tasks waiting on the maintainer." + repo_hint)

    @explained
    def board_summary(repo: str | None = None) -> dict:
        tasks = backend.board(repo).list()
        counts = {s.value: 0 for s in TaskState}
        for t in tasks:
            counts[t.state.value] += 1
        return {"backend": backend.kind, "total": len(tasks), "counts": {k: v for k, v in counts.items() if v},
                "waiting_for_you": [task_summary(t) for t in tasks if t.state in NEEDS_YOU]}

    @server.tool(annotations=READ, description="List tasks, optionally only one column: " + ", ".join(s.value for s in TaskState) + "." + repo_hint)

    @explained
    def list_tasks(state: str | None = None, repo: str | None = None) -> list[dict]:
        wanted = None
        if state:
            wanted = next((s for s in TaskState if s.value.lower() == state.lower()), None)
            if wanted is None:
                raise ValueError(f"unknown state {state!r}")
        return [task_summary(t) for t in backend.board(repo).list(wanted)]

    @server.tool(annotations=READ, description="Everything about one task: the issue, the diff, before/after evidence, the review checks and recent history." + repo_hint)

    @explained
    def get_task(task_id: str, repo: str | None = None) -> dict:
        return task_detail(backend.board(repo).get(task_id))

    @server.tool(annotations=READ, description="Search the harnesses the tester has written (small programs that prove a randomly failing test is fixed)." + repo_hint)

    @explained
    def search_harnesses(query: str, repo: str | None = None) -> list[dict]:
        hits = backend.registry(repo).search(query, min_score=0.05, validated_only=False)
        return [{"tool_id": r.tool_id, "score": round(s, 2), "description": r.description, "validated": r.validated,
                 "used": r.usage_count} for r, s in hits[:10]]

    @server.tool(annotations=READ, description="The Python source of one harness." + repo_hint)

    @explained
    def read_harness(tool_id: str, repo: str | None = None) -> str:
        return backend.read_tool(repo, tool_id)

    @server.tool(annotations=ACT, description="Start the swarm: ingest new issues and let the agents work until idle." + repo_hint)

    @explained
    def run_swarm(repo: str | None = None) -> str:
        return backend.run(repo)

    @server.tool(annotations=ACT, description="Send a task's patch back to the coder with the maintainer's feedback (works from In Review, Approved or Needs Human)." + repo_hint)

    @explained
    def request_changes(task_id: str, comment: str, repo: str | None = None) -> str:
        if not comment.strip():
            raise ValueError("say what should change, so the coder can act on it")
        return backend.request_changes(repo, task_id, comment.strip())

    if cloud:
        @server.tool(annotations=READ, description="Repositories connected to Swarm, with how many tasks wait on the maintainer.")
        @explained
        def list_repos() -> list[dict]:
            return backend.repos()

    @server.resource("swarm://board", name="board", description="The whole board as JSON", mime_type="application/json")
    def board_resource() -> str:
        repos = backend.repos()
        if backend.kind == "cloud" and not repos:
            return "[]"
        repo = None if backend.kind == "local" or len(repos) == 1 else repos[0]["id"]
        return json.dumps([task_summary(t) for t in backend.board(repo).list()], indent=2)

    @server.prompt(title="Swarm standup", description="Summarise what the agents did and what needs a decision.")
    def standup() -> str:
        return ("Call board_summary, then get_task for each task waiting for me. Write a short standup: what the "
                "agents fixed (with the before/after evidence), what's waiting on me and why, and anything stuck. "
                "End with the one decision I should make first.")

    return server


def serve(settings: Settings, cloud: bool = False) -> None:
    build(settings, cloud).run("stdio")
