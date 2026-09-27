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
    swarm.board.subscribe(lambda _e, _t: progress.flush())  # the timer alone may not tick in so short a run
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
    # the card lets go and says what went wrong, instead of "tester is on it" forever; after a second crash it
    # goes to a person rather than round and round
    crashed = {e["task_id"] for e in swarm.errors}
    stuck = [t for t in swarm.board.list() if t.task_id in crashed]
    assert stuck and all(t.state == TaskState.HUMAN_REVIEW and t.assigned_agent is None
                         and t.artifacts["last_error"]["agent"] == "tester" for t in stuck)
    assert all(sum(1 for e in swarm.errors if e["task_id"] == t.task_id) == 2 for t in stuck)
    percents = [w["percent"] for w in ref.writes]
    assert percents == sorted(percents) and 12 < percents[-1] < 100  # moved during the run, never backwards


class StopRef(Ref):
    """A run document where someone has pressed Stop."""

    def get(self, field_paths=None):
        class Snap:
            exists = True

            def to_dict(self):
                return {"stopRequested": True}
        return Snap()


def test_stop_halts_the_agents_and_ends_the_run(settings, issues):
    swarm = Swarm(settings)
    progress = worker.RunProgress(StopRef(), every=0.01)
    progress.watch(swarm)
    swarm.ingest(issues)
    progress._check_stop()  # what the timer does every few seconds
    assert progress.stopped.is_set()
    swarm.run_until_idle()
    # nothing was started, so every issue is still waiting where it was
    assert all(t.state == TaskState.NEW for t in swarm.board.list())
    with pytest.raises(worker.RunStopped):
        progress.set_phase("saving")
    assert progress.finish("stopped")["phase"] == "stopped"
