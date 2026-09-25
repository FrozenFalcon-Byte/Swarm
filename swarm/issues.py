"""Issue sources: GitHub REST API (read-only) or a local JSON file."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import httpx


@dataclass
class Issue:
    number: int
    title: str
    body: str
    labels: list[str]

    @property
    def ref(self) -> str:
        return f"#{self.number}"


def from_file(path: Path) -> list[Issue]:
    raw = json.loads(Path(path).read_text())
    return [Issue(i["number"], i["title"], i.get("body") or "", i.get("labels", [])) for i in raw]


def from_github(repo: str, token: str = "", limit: int = 50) -> list[Issue]:
    headers = {"Accept": "application/vnd.github+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    resp = httpx.get(
        f"https://api.github.com/repos/{repo}/issues",
        params={"state": "open", "per_page": min(limit, 100)},
        headers=headers,
        timeout=30,
    )
    resp.raise_for_status()
    issues = []
    for i in resp.json():
        if "pull_request" in i:  # the issues endpoint also returns PRs
            continue
        issues.append(Issue(i["number"], i["title"], i.get("body") or "", [l["name"] for l in i.get("labels", [])]))
    return issues
