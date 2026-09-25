"""Config loading, GitHub error handling and the doctor report: no network needed."""

from pathlib import Path

import httpx

from swarm import env
from swarm.cloud import github
from swarm.doctor import Check, render


def test_env_parse_handles_quotes_comments_and_export():
    got = env.parse('# comment\nexport A=1\nB="two words"\nC=\'x=y\'\nD=plain # trailing\nE=\nnot a line\n')
    assert got == {"A": "1", "B": "two words", "C": "x=y", "D": "plain", "E": ""}


def test_env_load_never_overrides_real_environment(tmp_path, monkeypatch):
    f = tmp_path / ".env"
    f.write_text("SWARM_T_ONE=file\nSWARM_T_TWO=file\n")
    monkeypatch.setenv("SWARM_ENV_FILE", str(f))
    monkeypatch.setenv("SWARM_T_ONE", "shell")
    monkeypatch.delenv("SWARM_T_TWO", raising=False)
    assert env.load() == f
    import os

    assert os.environ["SWARM_T_ONE"] == "shell" and os.environ["SWARM_T_TWO"] == "file"
    monkeypatch.delenv("SWARM_T_TWO")


def _resp(code, headers=None, json=None):
    return httpx.Response(code, headers=headers or {}, json=json if json is not None else {}, request=httpx.Request("GET", "https://api.github.com/x"))


def test_github_errors_say_what_to_do():
    assert "reconnect GitHub" in github.explain(_resp(401))
    assert "rate limit" in github.explain(_resp(403, {"x-ratelimit-remaining": "0"}))
    assert "can't see acme/app" in github.explain(_resp(404), "acme/app")


def test_issues_changed_since_ignores_pull_requests(monkeypatch):
    seen = {}

    def fake_get(url, headers, params, timeout):
        seen.update(url=url, params=params, auth=headers.get("Authorization"))
        return _resp(200, json=[{"number": 1}, {"number": 2, "pull_request": {}}, {"number": 3}])

    monkeypatch.setattr(github.httpx, "get", fake_get)
    assert github.issues_changed_since("acme/app", "tok", "2026-01-01T00:00:00+00:00") == 2
    assert seen["params"]["since"].startswith("2026") and seen["auth"] == "Bearer tok"


def test_doctor_render_counts_failures():
    out = render([Check("a", "x", "ok", "fine"), Check("a", "y", "fail", "broken", "do this")])
    assert "✗ y" in out and "→ do this" in out and "1 problem(s) to fix" in out


class _Snap:
    def __init__(self, data):
        self._d = data
        self.exists = data is not None

    def to_dict(self):
        return dict(self._d)

    def get(self, key):
        return self._d[key]


class _Doc:
    def __init__(self, store, key):
        self.store, self.key = store, key

    def set(self, data):
        self.store[self.key] = dict(data)

    def get(self):
        return _Snap(self.store.get(self.key))


class _Col:
    def __init__(self):
        self.store = {}

    def document(self, key):
        return _Doc(self.store, key)

    def stream(self):
        return [_Snap(v) for v in self.store.values()]


def test_tool_code_lives_in_firestore_without_a_bucket(tmp_path):
    from swarm.cloud.registry import FirestoreToolRegistry

    tools = _Col()

    class Db:
        def collection(self, _):
            return self

        def document(self, _):
            return type("R", (), {"collection": lambda self_, _n: tools})()

    reg = FirestoreToolRegistry(Db(), None, "r1", tmp_path / "cache", use_embeddings=False)
    reg.register("probe_v1", "runs a test many times", "print('hi')\n", "task-001", ["flaky"], True, {})
    assert tools.store["probe_v1"]["code"] == "print('hi')\n" and "storage_path" not in tools.store["probe_v1"]

    fresh = FirestoreToolRegistry(Db(), None, "r1", tmp_path / "other-cache")  # a different worker's empty cache
    rec = fresh.get("probe_v1")
    assert Path(rec.code_path).read_text() == "print('hi')\n"
    assert [r.tool_id for r in fresh.all()] == ["probe_v1"]


def test_storage_is_optional(monkeypatch):
    from swarm.cloud import firebase

    monkeypatch.delenv("FIRESTORE_EMULATOR_HOST", raising=False)
    monkeypatch.setenv("FIREBASE_STORAGE_BUCKET", "")
    assert not firebase.storage_enabled()
    monkeypatch.setenv("FIREBASE_STORAGE_BUCKET", "swarm-4ce56.firebasestorage.app")
    assert firebase.storage_enabled()
