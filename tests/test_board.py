import pytest

from swarm.board import InvalidTransition, TaskBoard, TaskState
from swarm.board.states import TRANSITIONS


@pytest.fixture
def board():
    return TaskBoard(":memory:")


def test_create_is_idempotent_per_issue(board):
    a = board.create("#1", "flaky thing")
    b = board.create("#1", "flaky thing again")
    assert a.task_id == b.task_id == "task-001"
    assert len(board.list()) == 1


def test_valid_path_records_history(board):
    t = board.create("#1", "x")
    for dst, who in [(TaskState.TRIAGED, "triager"), (TaskState.IN_PROGRESS, "coder"),
                     (TaskState.AWAITING_TESTS, "coder"), (TaskState.IN_REVIEW, "tester"),
                     (TaskState.APPROVED, "reviewer"), (TaskState.MERGED, "human")]:
        t = board.transition(t.task_id, dst, who, f"to {dst.value}")
    assert t.state == TaskState.MERGED
    assert [h.agent for h in t.history] == ["system", "triager", "coder", "coder", "tester", "reviewer", "human"]


def test_invalid_transition_rejected(board):
    t = board.create("#1", "x")
    with pytest.raises(InvalidTransition):
        board.transition(t.task_id, TaskState.MERGED, "coder", "skip ahead")
    assert board.get(t.task_id).state == TaskState.NEW


def test_only_humans_merge(board):
    t = board.create("#1", "x")
    for dst in (TaskState.TRIAGED, TaskState.IN_PROGRESS, TaskState.AWAITING_TESTS, TaskState.IN_REVIEW, TaskState.APPROVED):
        board.transition(t.task_id, dst, "agent", "")
    with pytest.raises(InvalidTransition, match="requires a human"):
        board.transition(t.task_id, TaskState.MERGED, "reviewer", "auto-merge")


def test_rejection_loops_back_to_in_progress(board):
    assert TaskState.IN_PROGRESS in TRANSITIONS[TaskState.REJECTED]
    assert TaskState.REJECTED in TRANSITIONS[TaskState.IN_REVIEW]


def test_subscribers_see_changes_and_artifacts_merge(board):
    events = []
    board.subscribe(lambda e, t: events.append((e, t.state)))
    t = board.create("#1", "x")
    board.update(t.task_id, "tester", "attach", artifacts={"a": 1})
    board.update(t.task_id, "tester", "attach", artifacts={"b": 2})
    assert board.get(t.task_id).artifacts == {"a": 1, "b": 2}
    assert [e for e, _ in events] == ["created", "updated", "updated"]


def test_persistence(tmp_path):
    db = tmp_path / "b.sqlite3"
    t = TaskBoard(db).create("#9", "persist me")
    assert TaskBoard(db).get(t.task_id).title == "persist me"
