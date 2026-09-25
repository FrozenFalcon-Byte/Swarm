"""Config loading, GitHub error handling and the doctor report: no network needed."""

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
