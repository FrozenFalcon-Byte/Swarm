from __future__ import annotations

import logging
from typing import Callable

from ..board import Task, TaskBoard, TaskState
from ..config import Settings
from ..llm import LLM

ActivityFn = Callable[[str, str, str | None], None]  # (agent, message, task_id)


class Agent:
    """An agent owns one input column of the board and moves cards out of it."""

    name = "agent"
    consumes: TaskState | None = None

    def __init__(self, board: TaskBoard, settings: Settings, llm: LLM | None = None, on_activity: ActivityFn | None = None):
        self.board = board
        self.settings = settings
        self.llm = llm or LLM(settings)
        self.log = logging.getLogger(f"swarm.{self.name}")
        self._on_activity = on_activity
        # set while the agent serves an A2A request: each thing it says becomes a status update on that task
        self.tap: Callable[[str], None] | None = None

    def say(self, message: str, task: Task | None = None) -> None:
        self.log.info("%s%s", f"[{task.task_id}] " if task else "", message)
        if self._on_activity:
            self._on_activity(self.name, message, task.task_id if task else None)
        if self.tap:
            self.tap(message)

    def step(self) -> bool:
        """Process one task from the input column. Returns True if work was done."""
        if self.consumes is None:
            return False
        task = self.board.claim(self.consumes, self.name)
        if task is None:
            return False
        self.handle(task)
        return True

    def handle(self, task: Task) -> None:  # pragma: no cover - abstract
        raise NotImplementedError
