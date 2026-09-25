from swarm.agents import CoderAgent, TriagerAgent
from swarm.board import TaskBoard, TaskState


def _triaged(settings, issues, number):
    board = TaskBoard(settings.db_path)
    tri = TriagerAgent(board, settings)
    tri.ingest([i for i in issues if i.number == number])
    tri.step()
    return board


def test_hash_order_fix(settings, issues):
    board = _triaged(settings, issues, 101)
    CoderAgent(board, settings).step()
    t = board.list()[0]
    assert t.state == TaskState.AWAITING_TESTS
    assert t.artifacts["flakiness_source"] == "hash-order"
    assert t.artifacts["strategy"] == "sort-set-result"
    assert "+    return sorted(set(cleaned))" in t.artifacts["diff_text"]
    # the live repo is untouched until a human merges
    assert "list(set(cleaned))" in (settings.repo_path / "tagkit/tags.py").read_text()


def test_skips_rejected_strategy(settings, issues):
    board = _triaged(settings, issues, 102)
    coder = CoderAgent(board, settings)
    coder.step()
    t = board.list()[0]
    assert t.artifacts["strategy"] == "bound-jitter"
    assert "random.uniform(0, step)" in t.artifacts["diff_text"]
    # simulate the reviewer rejecting it: the coder must not resubmit it
    board.transition(t.task_id, TaskState.IN_REVIEW, "tester", "")
    board.transition(t.task_id, TaskState.REJECTED, "reviewer", "no", note="no",
                     artifacts={"rejected_strategies": ["bound-jitter"]})
    coder.step()
    t = board.get(t.task_id)
    assert t.attempts == 2 and t.artifacts["strategy"] == "seed-test-rng"


def test_llm_first_then_strategies_after_rejection(settings, issues):
    from swarm.llm import LLM
    from tests.test_llm import Fake

    settings.llm_disabled = False
    board = _triaged(settings, issues, 102)
    bad = '{"strategy": "remove-jitter", "root_cause": "x", "edits": [{"path": "tagkit/retry.py", ' \
          '"old": "step + random.uniform(0, base * jitter)", "new": "step"}]}'
    llm = LLM(settings, providers=[Fake("a", reply=bad)])
    coder = CoderAgent(board, settings, llm=llm)
    coder.step()
    t = board.list()[0]
    assert t.artifacts["strategy"] == "remove-jitter"  # attempt 1: the model
    board.transition(t.task_id, TaskState.IN_REVIEW, "tester", "")
    board.transition(t.task_id, TaskState.REJECTED, "reviewer", "no", note="deletes randomness",
                     artifacts={"rejected_strategies": ["remove-jitter"]})
    coder.step()
    t = board.get(t.task_id)
    assert t.artifacts["strategy"] == "bound-jitter"  # attempt 2: proven strategy before asking again
