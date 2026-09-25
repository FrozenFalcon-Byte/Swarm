"""TaskBoard with the same interface as the SQLite board, stored in Firestore under
repos/{repo_id}/tasks. State changes run in transactions so two workers can't
race a card through the state machine."""

from __future__ import annotations

import json
from typing import Any, Callable

from google.cloud import firestore as gfs

from ..board.models import HistoryEntry, Task, TaskState, utcnow
from ..board.states import check_transition

Listener = Callable[[str, Task], None]


def _doc(task: Task) -> dict[str, Any]:
    return json.loads(task.model_dump_json())


class FirestoreTaskBoard:
    def __init__(self, db, repo_id: str):
        self.db = db
        self.repo_id = repo_id
        self.repo_ref = db.collection("repos").document(repo_id)
        self.col = self.repo_ref.collection("tasks")
        self._listeners: list[Listener] = []

    def subscribe(self, fn: Listener) -> Callable[[], None]:
        self._listeners.append(fn)
        return lambda: self._listeners.remove(fn) if fn in self._listeners else None

    def _emit(self, event: str, task: Task) -> None:
        for fn in list(self._listeners):
            try:
                fn(event, task)
            except Exception:
                pass

    # -- queries -------------------------------------------------------
    def get(self, task_id: str) -> Task:
        snap = self.col.document(task_id).get()
        if not snap.exists:
            raise KeyError(task_id)
        return Task.model_validate(snap.to_dict())

    def find_by_issue(self, source_issue: str) -> Task | None:
        for snap in self.col.where(filter=gfs.FieldFilter("source_issue", "==", source_issue)).limit(1).stream():
            return Task.model_validate(snap.to_dict())
        return None

    def list(self, state: TaskState | None = None) -> list[Task]:
        q = self.col if state is None else self.col.where(filter=gfs.FieldFilter("state", "==", state.value))
        return sorted((Task.model_validate(s.to_dict()) for s in q.stream()), key=lambda t: t.task_id)

    def claim(self, state: TaskState, agent: str) -> Task | None:
        for task in self.list(state):
            if task.assigned_agent in (None, agent):
                return task
        return None

    def export(self) -> list[dict[str, Any]]:
        return [_doc(t) for t in self.list()]

    # -- commands ------------------------------------------------------
    def create(self, source_issue: str, title: str, body: str = "", agent: str = "system", **fields: Any) -> Task:
        existing = self.find_by_issue(source_issue)
        if existing:
            return existing

        @gfs.transactional
        def txn(tx) -> Task:
            repo = self.repo_ref.get(transaction=tx).to_dict() or {}
            seq = int(repo.get("taskSeq", 0)) + 1
            task = Task(task_id=f"task-{seq:03d}", source_issue=source_issue, title=title, body=body, **fields)
            task.history.append(HistoryEntry(agent=agent, action=f"created from issue {source_issue}", to_state=task.state))
            tx.set(self.repo_ref, {"taskSeq": seq}, merge=True)
            tx.set(self.col.document(task.task_id), _doc(task))
            return task

        task = txn(self.db.transaction())
        self._emit("created", task)
        return task

    def _mutate(self, task_id: str, fn: Callable[[Task], None]) -> Task:
        ref = self.col.document(task_id)

        @gfs.transactional
        def txn(tx) -> Task:
            snap = ref.get(transaction=tx)
            if not snap.exists:
                raise KeyError(task_id)
            task = Task.model_validate(snap.to_dict())
            fn(task)
            task.updated_at = utcnow()
            tx.set(ref, _doc(task))
            return task

        return txn(self.db.transaction())

    def transition(self, task_id: str, to: TaskState, agent: str, action: str, **updates: Any) -> Task:
        def fn(task: Task) -> None:
            check_transition(task.state, to, agent)
            src = task.state
            _apply(task, dict(updates))
            task.state = to
            task.history.append(HistoryEntry(agent=agent, action=action, from_state=src, to_state=to))

        task = self._mutate(task_id, fn)
        self._emit("transition", task)
        return task

    def update(self, task_id: str, agent: str, action: str | None = None, **updates: Any) -> Task:
        def fn(task: Task) -> None:
            _apply(task, dict(updates))
            if action:
                task.history.append(HistoryEntry(agent=agent, action=action))

        task = self._mutate(task_id, fn)
        self._emit("updated", task)
        return task


def _apply(task: Task, updates: dict[str, Any]) -> None:
    artifacts = updates.pop("artifacts", None)
    if artifacts:
        task.artifacts.update(artifacts)
    for k, v in updates.items():
        setattr(task, k, v)
