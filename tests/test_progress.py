"""A run reports how far along it is, what each agent is on, and any agent that crashed."""

import pytest

from swarm.board import TaskState
from swarm.orchestrator import Swarm

worker = pytest.importorskip("swarm.cloud.worker")


class Ref:
    def __init__(self):
        self.writes = []

    def update(self, data):
        self.writes.append(data["progress"])


def test_progress_follows_the_run_and_reports_crashes(settings, issues, monkeypatch):
    swarm = Swarm(settings)
    ref = Ref()
    progress = worker.RunProgress(ref, every=0.05)
    progress.set_phase("reading")
    progress.watch(swarm)
    swarm.ingest(issues)
    progress.set_phase("agents")

    def boom(task):
        raise RuntimeError("sandbox image missing")

    monkeypatch.setattr(swarm.tester, "handle", boom)
    progress.start()
    swarm.run_until_idle()
    final = progress.finish()

    assert final["percent"] == 100 and final["phase"] == "done"
    assert set(final["agents"]) >= {"triager", "coder", "tester"}
    assert any(e["agent"] == "tester" and "sandbox image missing" in e["error"] for e in final["errors"])
    # the card lets go and says what went wrong, instead of "tester is on it" forever
    stuck = [t for t in swarm.board.list() if t.state == TaskState.AWAITING_TESTS]
    assert stuck and all(t.assigned_agent is None and t.artifacts["last_error"]["agent"] == "tester" for t in stuck)
    assert {e["task_id"] for e in swarm.errors} == {t.task_id for t in stuck}
    percents = [w["percent"] for w in ref.writes]
    assert percents == sorted(percents) and 12 < percents[-1] < 100  # moved during the run, never backwards
