"""The board's state machine. Every state change goes through `can_transition`."""

from __future__ import annotations

from .models import TaskState as S


class InvalidTransition(ValueError):
    pass


TRANSITIONS: dict[S, set[S]] = {
    S.NEW: {S.TRIAGED, S.HUMAN_REVIEW, S.CLOSED},
    S.TRIAGED: {S.IN_PROGRESS, S.CLOSED},
    S.IN_PROGRESS: {S.AWAITING_TESTS, S.HUMAN_REVIEW},
    # A failing test run sends the task back through Rejected with the failure as feedback.
    S.AWAITING_TESTS: {S.IN_REVIEW, S.REJECTED},
    S.IN_REVIEW: {S.APPROVED, S.REJECTED, S.HUMAN_REVIEW},
    S.REJECTED: {S.IN_PROGRESS, S.HUMAN_REVIEW},
    # Approved means "ready for a human to click merge", never auto-merged.
    S.APPROVED: {S.MERGED, S.REJECTED},
    S.HUMAN_REVIEW: {S.TRIAGED, S.APPROVED, S.REJECTED, S.CLOSED},
    S.MERGED: set(),
    S.CLOSED: {S.TRIAGED},
}

# Transitions only a person may make from the dashboard/API.
HUMAN_ONLY: set[tuple[S, S]] = {
    (S.APPROVED, S.MERGED),
    (S.HUMAN_REVIEW, S.APPROVED),
    (S.HUMAN_REVIEW, S.TRIAGED),
    (S.CLOSED, S.TRIAGED),
}


def can_transition(src: S, dst: S) -> bool:
    return dst in TRANSITIONS.get(src, set())


def check_transition(src: S, dst: S, actor: str) -> None:
    if not can_transition(src, dst):
        raise InvalidTransition(f"{src.value} → {dst.value} is not a valid transition")
    if (src, dst) in HUMAN_ONLY and actor != "human":
        raise InvalidTransition(f"{src.value} → {dst.value} requires a human")
