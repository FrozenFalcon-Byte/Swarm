from swarm.agents import ReviewerAgent
from swarm.board import TaskBoard, TaskState
from swarm.patching import make_diff

OLD = "        delays.append(step + random.uniform(0, base * jitter))\n"


def _task_in_review(board, settings, new_line):
    src = (settings.repo_path / "tagkit/retry.py").read_text()
    diff = make_diff({"tagkit/retry.py": (src, src.replace(OLD, new_line))})
    t = board.create("#102", "test_backoff_is_increasing is flaky", kind="flaky-test")
    for s in (TaskState.TRIAGED, TaskState.IN_PROGRESS, TaskState.AWAITING_TESTS, TaskState.IN_REVIEW):
        board.transition(t.task_id, s, "agent", "")
    ev = {"tests/test_retry.py::test_backoff_is_increasing": {"before": {"failures": 3, "runs": 12}, "after": {"failures": 0, "runs": 12}}}
    return board.update(t.task_id, "tester", artifacts={
        "diff_text": diff, "strategy": "x", "target_symbols": ["tagkit/retry.py::backoff_delays"],
        "test_ids": ["tests/test_retry.py::test_backoff_is_increasing"],
        "test_summary": {"harness": {"tool_id": "repeat_run_v1", "evidence": ev}, "regressions": []}})


def test_rejects_deleting_the_jitter(settings):
    board = TaskBoard(":memory:")
    t = _task_in_review(board, settings, "        delays.append(step)\n")
    ReviewerAgent(board, settings).step()
    t = board.get(t.task_id)
    assert t.state == TaskState.REJECTED and "deletes the randomness" in t.note


def test_approves_bounded_jitter(settings):
    board = TaskBoard(":memory:")
    t = _task_in_review(board, settings, "        delays.append(step + random.uniform(0, step))\n")
    ReviewerAgent(board, settings).step()
    assert board.get(t.task_id).state == TaskState.APPROVED
