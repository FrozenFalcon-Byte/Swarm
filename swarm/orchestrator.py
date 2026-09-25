"""Wires the agents to one board and drives them. Agents never call each other:
each one reads cards from its column and writes cards to the next."""

from __future__ import annotations

import logging
import shutil
import threading
import time
from collections import deque
from typing import Callable

from .agents import CoderAgent, ReviewerAgent, TesterAgent, TriagerAgent
from .board import Task, TaskBoard, TaskState
from .board.models import utcnow
from .config import Settings
from .issues import Issue, from_file, from_github
from .llm import LLM
from .patching import PatchError, apply_diff
from .registry import ToolRegistry
from .sandbox import Sandbox

log = logging.getLogger("swarm")
ActivityListener = Callable[[dict], None]


class Swarm:
    def __init__(self, settings: Settings | None = None, board=None, registry=None):
        """`board` and `registry` default to local SQLite/JSON; service mode passes Firestore-backed ones."""
        self.settings = settings or Settings()
        self.settings.ensure_dirs()
        self.board = board or TaskBoard(self.settings.db_path)
        self.llm = LLM(self.settings)
        self.registry = registry or ToolRegistry(self.settings.tools_dir, self.settings.use_embeddings)
        self.sandbox = Sandbox(self.settings)
        self.activity: deque[dict] = deque(maxlen=300)
        self._activity_listeners: list[ActivityListener] = []
        common = dict(llm=self.llm, on_activity=self._record)
        self.triager = TriagerAgent(self.board, self.settings, **common)
        self.coder = CoderAgent(self.board, self.settings, **common)
        self.tester = TesterAgent(self.board, self.settings, registry=self.registry, sandbox=self.sandbox, **common)
        self.reviewer = ReviewerAgent(self.board, self.settings, sandbox=self.sandbox, **common)
        self.agents = [self.triager, self.coder, self.tester, self.reviewer]
        self.busy: dict[str, bool] = {a.name: False for a in self.agents}
        self._loop: threading.Thread | None = None
        self._stop = threading.Event()
        self._run_lock = threading.Lock()

    # -- activity feed -------------------------------------------------------
    def on_activity(self, fn: ActivityListener) -> None:
        self._activity_listeners.append(fn)

    def _record(self, agent: str, message: str, task_id: str | None) -> None:
        entry = {"ts": utcnow(), "agent": agent, "message": message, "task_id": task_id}
        self.activity.append(entry)
        for fn in list(self._activity_listeners):
            try:
                fn(entry)
            except Exception:
                pass

    # -- issue intake --------------------------------------------------------
    def load_issues(self, issues_file: str | None = None) -> list[Issue]:
        if self.settings.github_repo:
            return from_github(self.settings.github_repo, self.settings.github_token)
        return from_file(issues_file or "demo_issues.json")

    def ingest(self, issues: list[Issue]) -> int:
        return self.triager.ingest(issues)

    # -- driving -------------------------------------------------------------
    def run_once(self, delay: float = 0.0) -> bool:
        """Give each agent one turn. Returns True if any agent did work."""
        progressed = False
        with self._run_lock:
            for agent in self.agents:
                self.busy[agent.name] = True
                try:
                    did = agent.step()
                except Exception as e:  # an agent crash parks nothing; it is logged and the loop continues
                    log.exception("%s crashed", agent.name)
                    self._record(agent.name, f"error: {e}", None)
                    did = False
                finally:
                    self.busy[agent.name] = False
                progressed |= did
                if did and delay:
                    time.sleep(delay)
        return progressed

    def run_until_idle(self, max_rounds: int = 200, delay: float = 0.0) -> int:
        rounds = 0
        while rounds < max_rounds and self.run_once(delay):
            rounds += 1
        return rounds

    def start_background(self, interval: float = 1.0, delay: float = 0.6) -> None:
        if self._loop and self._loop.is_alive():
            return
        self._stop.clear()

        def loop() -> None:
            while not self._stop.is_set():
                if not self.run_once(delay):
                    self._stop.wait(interval)

        self._loop = threading.Thread(target=loop, name="swarm-loop", daemon=True)
        self._loop.start()

    def stop_background(self) -> None:
        self._stop.set()

    # -- human actions -------------------------------------------------------
    def merge(self, task_id: str, deliver: Callable[[Task], str] | None = None) -> Task:
        """Human merge. `deliver` ships the patch (e.g. opens a GitHub PR) and returns a
        description; by default the patch is applied to the local checkout."""
        task = self.board.get(task_id)
        if task.state != TaskState.APPROVED:
            raise ValueError(f"{task_id} is {task.state.value}; only Approved tasks can be merged")
        try:
            if deliver:
                how = deliver(task)
            else:
                apply_diff(task.artifacts["diff_text"], self.settings.repo_path)
                how = "applied to the local checkout"
        except (PatchError, RuntimeError) as e:
            return self.board.transition(task_id, TaskState.REJECTED, "human", f"merge failed: {e}",
                                         note=f"Merge failed: {e}")
        self._record("human", f"merged — {how}", task_id)
        return self.board.transition(task_id, TaskState.MERGED, "human", f"merged — {how}",
                                     artifacts={"delivery": how})

    def approve(self, task_id: str, comment: str = "") -> Task:
        self._record("human", "approved" + (f": {comment}" if comment else ""), task_id)
        return self.board.transition(task_id, TaskState.APPROVED, "human", "approved by maintainer" + (f": {comment}" if comment else ""))

    def reject(self, task_id: str, comment: str) -> Task:
        self._record("human", f"requested changes: {comment}", task_id)
        # a maintainer's feedback earns the coder a fresh attempt budget
        return self.board.transition(task_id, TaskState.REJECTED, "human", f"changes requested: {comment}",
                                     note=f"Maintainer: {comment}", attempts=0)

    def reopen(self, task_id: str, comment: str = "") -> Task:
        self._record("human", "sent back to triage for the swarm to work on", task_id)
        return self.board.transition(task_id, TaskState.TRIAGED, "human", "re-triaged by maintainer" + (f": {comment}" if comment else ""),
                                     note="", attempts=0, kind="flaky-test" if comment == "flaky" else self.board.get(task_id).kind)

    def close(self, task_id: str, comment: str = "") -> Task:
        self._record("human", "closed", task_id)
        return self.board.transition(task_id, TaskState.CLOSED, "human", "closed by maintainer" + (f": {comment}" if comment else ""),
                                     note=comment or "Closed by maintainer")

    def status(self) -> dict:
        tasks = self.board.list()
        counts = {s.value: 0 for s in TaskState}
        for t in tasks:
            counts[t.state.value] += 1
        return {
            "counts": counts,
            "agents": [{"name": a.name, "busy": self.busy[a.name]} for a in self.agents],
            "llm": self.llm.describe(),
            "sandbox": self.sandbox.backend,
            "repo": str(self.settings.repo_path),
            "running": bool(self._loop and self._loop.is_alive()),
        }


def prepare_demo_workspace(settings: Settings, template: str = "demo_repo") -> None:
    """Fresh copy of the demo repo so demo runs (and merges) never touch the template."""
    dest = settings.home / "workspace" / "tagkit"
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(template, dest, ignore=shutil.ignore_patterns("__pycache__", ".pytest_cache"))
    settings.repo_path = dest.resolve()
