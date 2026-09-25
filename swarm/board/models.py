from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class TaskState(str, Enum):
    NEW = "New Issue"
    TRIAGED = "Triaged"
    IN_PROGRESS = "In Progress"
    AWAITING_TESTS = "Awaiting Tests"
    IN_REVIEW = "In Review"
    REJECTED = "Rejected"
    APPROVED = "Approved"
    MERGED = "Merged"
    # Parking states: a person has to look (low-confidence triage, security-sensitive
    # diff, coder out of attempts), or the swarm decided not to act.
    HUMAN_REVIEW = "Needs Human"
    CLOSED = "Closed"


class HistoryEntry(BaseModel):
    agent: str
    action: str
    ts: str = Field(default_factory=utcnow)
    from_state: TaskState | None = None
    to_state: TaskState | None = None


class Task(BaseModel):
    task_id: str
    source_issue: str
    title: str
    body: str = ""
    state: TaskState = TaskState.NEW
    priority: str = "unset"  # low | medium | high | critical
    kind: str = "unknown"  # bug | flaky-test | feature | question
    labels: list[str] = Field(default_factory=list)
    assigned_agent: str | None = None
    attempts: int = 0
    # Why a task is parked in Needs Human / Closed, or the last rejection reason.
    note: str = ""
    artifacts: dict[str, Any] = Field(default_factory=dict)
    history: list[HistoryEntry] = Field(default_factory=list)
    created_at: str = Field(default_factory=utcnow)
    updated_at: str = Field(default_factory=utcnow)
