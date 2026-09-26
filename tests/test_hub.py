"""The hub's dispatcher: when it starts the GitHub Actions worker, and when it holds back."""

import httpx
import pytest

from swarm import hub


class Calls:
    def __init__(self, queued: int = 0, fail: bool = False):
        self.queued, self.fail, self.posts = queued, fail, 0

    def get(self, url, **kw):
        if self.fail:
            raise httpx.ConnectError("offline")
        return httpx.Response(200, json={"total_count": self.queued}, request=httpx.Request("GET", url))

    def post(self, url, **kw):
        self.posts += 1
        assert url.endswith("/actions/workflows/worker.yml/dispatches") and kw["json"] == {"ref": "main"}
        return httpx.Response(204, request=httpx.Request("POST", url))


@pytest.fixture
def github(monkeypatch):
    def use(**kw):
        calls = Calls(**kw)
        monkeypatch.setattr(hub.httpx, "get", calls.get)
        monkeypatch.setattr(hub.httpx, "post", calls.post)
        return calls
    return use


def test_starts_the_worker_when_nothing_is_queued(github):
    calls = github()
    d = hub.Dispatcher(None, "me/swarm", "t")
    d.kick("a run")
    assert calls.posts == 1 and d.dispatches == 1 and d.status()["lastError"] is None


def test_leaves_it_when_a_pass_is_already_waiting(github):
    calls = github(queued=1)
    d = hub.Dispatcher(None, "me/swarm", "t")
    d.kick("a run")
    assert calls.posts == 0


def test_cooldown_holds_back_a_second_start(github, monkeypatch):
    calls = github()
    d = hub.Dispatcher(None, "me/swarm", "t")
    d.kick("first")
    d.kick("second, straight after")
    assert calls.posts == 1
    if d._retry:
        d._retry.cancel()


def test_a_github_failure_is_reported_not_raised(github):
    github(fail=True)
    d = hub.Dispatcher(None, "me/swarm", "t")
    d.kick("a run")
    assert d.dispatches == 0 and "offline" in d.status()["lastError"]


def test_background_mode_comes_from_the_environment(monkeypatch):
    from swarm.config import Settings

    monkeypatch.delenv("SWARM_GH_REPO", raising=False)
    monkeypatch.delenv("SWARM_DISPATCH_TOKEN", raising=False)
    monkeypatch.delenv("SWARM_HUB_WORKER", raising=False)
    assert hub.background(Settings()) is None
    monkeypatch.setenv("SWARM_HUB_WORKER", "on")
    assert isinstance(hub.background(Settings()), hub.InProcessWorker)
