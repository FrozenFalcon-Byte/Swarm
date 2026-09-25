import shutil
from pathlib import Path

import pytest

from swarm.config import Settings

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def settings(tmp_path, monkeypatch):
    # Tests exercise the deterministic heuristics; a local Ollama must not change outcomes.
    monkeypatch.setenv("SWARM_NO_LLM", "1")
    monkeypatch.delenv("SWARM_GITHUB_REPO", raising=False)
    repo = tmp_path / "repo"
    shutil.copytree(ROOT / "demo_repo", repo, ignore=shutil.ignore_patterns("__pycache__"))
    s = Settings()
    s.home = tmp_path / ".swarm"
    s.repo_path = repo
    s.sandbox_backend = "local"
    s.flaky_repeat_runs = 12
    s.ensure_dirs()
    return s


@pytest.fixture
def issues():
    from swarm.issues import from_file

    return from_file(ROOT / "demo_issues.json")
