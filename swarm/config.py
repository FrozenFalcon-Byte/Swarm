"""Runtime configuration, read from environment variables with safe defaults."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _bool(name: str, default: bool = False) -> bool:
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in {"1", "true", "yes", "on"}


@dataclass
class Settings:
    # Where the swarm keeps its state (board DB, patches, tool registry, results).
    home: Path = field(default_factory=lambda: Path(os.environ.get("SWARM_HOME", ".swarm")).resolve())
    # The repository being maintained.
    repo_path: Path = field(default_factory=lambda: Path(os.environ.get("SWARM_REPO", "demo_repo")).resolve())
    # GitHub "owner/name" to pull issues from; empty means use the local issues file.
    github_repo: str = field(default_factory=lambda: os.environ.get("SWARM_GITHUB_REPO", ""))
    github_token: str = field(default_factory=lambda: os.environ.get("GITHUB_TOKEN", ""))

    # LLM: see swarm/llm.py for provider order. Anthropic settings are used only by that provider.
    anthropic_api_key: str = field(default_factory=lambda: os.environ.get("ANTHROPIC_API_KEY", ""))
    anthropic_base_url: str = field(
        default_factory=lambda: os.environ.get("SWARM_LLM_BASE_URL", "https://api.anthropic.com")
    )
    model: str = field(default_factory=lambda: os.environ.get("SWARM_MODEL", "claude-sonnet-5"))
    llm_disabled: bool = field(default_factory=lambda: _bool("SWARM_NO_LLM"))

    use_embeddings: bool = field(default_factory=lambda: _bool("SWARM_EMBEDDINGS"))
    # "auto" picks docker when available, else the local subprocess sandbox.
    sandbox_backend: str = field(default_factory=lambda: os.environ.get("SWARM_SANDBOX", "auto"))
    sandbox_timeout_s: int = field(default_factory=lambda: int(os.environ.get("SWARM_SANDBOX_TIMEOUT", "120")))

    triage_confidence_threshold: float = 0.6
    max_coder_attempts: int = 3
    flaky_repeat_runs: int = 12

    @property
    def db_path(self) -> Path:
        return self.home / "board.sqlite3"

    @property
    def patches_dir(self) -> Path:
        return self.home / "patches"

    @property
    def results_dir(self) -> Path:
        return self.home / "results"

    @property
    def tools_dir(self) -> Path:
        return self.home / "tools"

    def ensure_dirs(self) -> None:
        for d in (self.home, self.patches_dir, self.results_dir, self.tools_dir):
            d.mkdir(parents=True, exist_ok=True)

    # An LLM critique from a small local model is advisory unless this is set.
    llm_review_blocking: bool = field(default_factory=lambda: _bool("SWARM_LLM_REVIEW_BLOCKING"))
    # The repository owner's house rules (see houserules.py); the worker fills them in per repository.
    house_rules: list = field(default_factory=list)
