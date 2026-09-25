"""SQLite-backed task board with validated transitions and change subscriptions."""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any, Callable

from .models import HistoryEntry, Task, TaskState, utcnow
from .states import check_transition

Listener = Callable[[str, Task], None]


class TaskBoard:
    def __init__(self, db_path: Path | str):
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(str(db_path), check_same_thread=False)
        self._conn.execute(
            """CREATE TABLE IF NOT EXISTS tasks (
                task_id TEXT PRIMARY KEY,
                source_issue TEXT UNIQUE,
                state TEXT NOT NULL,
                body TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )"""
        )
        self._conn.commit()
        self._listeners: list[Listener] = []

    # -- subscriptions -------------------------------------------------
    def subscribe(self, fn: Listener) -> Callable[[], None]:
        self._listeners.append(fn)
        return lambda: self._listeners.remove(fn) if fn in self._listeners else None

    def _emit(self, event: str, task: Task) -> None:
        for fn in list(self._listeners):
            try:
                fn(event, task)
            except Exception:  # a broken listener must never break the board
                pass

    # -- persistence ---------------------------------------------------
    def _save(self, task: Task) -> None:
        task.updated_at = utcnow()
        self._conn.execute(
            "INSERT INTO tasks(task_id, source_issue, state, body, updated_at) VALUES (?,?,?,?,?) "
            "ON CONFLICT(task_id) DO UPDATE SET state=excluded.state, body=excluded.body, updated_at=excluded.updated_at",
            (task.task_id, task.source_issue, task.state.value, task.model_dump_json(), task.updated_at),
        )
        self._conn.commit()

    def _next_id(self) -> str:
        row = self._conn.execute("SELECT COUNT(*) FROM tasks").fetchone()
        return f"task-{row[0] + 1:03d}"

    # -- queries -------------------------------------------------------
    def get(self, task_id: str) -> Task:
        with self._lock:
            row = self._conn.execute("SELECT body FROM tasks WHERE task_id=?", (task_id,)).fetchone()
        if not row:
            raise KeyError(task_id)
        return Task.model_validate_json(row[0])

    def find_by_issue(self, source_issue: str) -> Task | None:
        with self._lock:
            row = self._conn.execute("SELECT body FROM tasks WHERE source_issue=?", (source_issue,)).fetchone()
        return Task.model_validate_json(row[0]) if row else None

    def list(self, state: TaskState | None = None) -> list[Task]:
        with self._lock:
            if state is None:
                rows = self._conn.execute("SELECT body FROM tasks ORDER BY task_id").fetchall()
            else:
                rows = self._conn.execute(
                    "SELECT body FROM tasks WHERE state=? ORDER BY task_id", (state.value,)
                ).fetchall()
        return [Task.model_validate_json(r[0]) for r in rows]

    # -- commands ------------------------------------------------------
    def create(self, source_issue: str, title: str, body: str = "", agent: str = "system", **fields: Any) -> Task:
        with self._lock:
            existing = self.find_by_issue(source_issue)
            if existing:
                return existing
            task = Task(task_id=self._next_id(), source_issue=source_issue, title=title, body=body, **fields)
            task.history.append(HistoryEntry(agent=agent, action=f"created from issue {source_issue}", to_state=task.state))
            self._save(task)
        self._emit("created", task)
        return task

    def transition(self, task_id: str, to: TaskState, agent: str, action: str, **updates: Any) -> Task:
        """Move a task to `to`, validating the transition and recording who did it and why."""
        with self._lock:
            task = self.get(task_id)
            check_transition(task.state, to, agent)
            src = task.state
            self._apply(task, updates)
            task.state = to
            task.history.append(HistoryEntry(agent=agent, action=action, from_state=src, to_state=to))
            self._save(task)
        self._emit("transition", task)
        return task

    def update(self, task_id: str, agent: str, action: str | None = None, **updates: Any) -> Task:
        """Change fields without changing state (e.g. attach an artifact)."""
        with self._lock:
            task = self.get(task_id)
            self._apply(task, updates)
            if action:
                task.history.append(HistoryEntry(agent=agent, action=action))
            self._save(task)
        self._emit("updated", task)
        return task

    def claim(self, state: TaskState, agent: str) -> Task | None:
        """Oldest task in `state` not already assigned to someone else."""
        with self._lock:
            for task in self.list(state):
                if task.assigned_agent in (None, agent):
                    return task
        return None

    @staticmethod
    def _apply(task: Task, updates: dict[str, Any]) -> None:
        artifacts = updates.pop("artifacts", None)
        if artifacts:
            task.artifacts.update(artifacts)
        for k, v in updates.items():
            setattr(task, k, v)

    def export(self) -> list[dict[str, Any]]:
        return [json.loads(t.model_dump_json()) for t in self.list()]
