"""Git and GitHub operations for connected repositories."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import httpx

from ..patching import apply_diff


class GitError(RuntimeError):
    pass


API = "https://api.github.com"


def _headers(token: str | None) -> dict[str, str]:
    h = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def explain(resp: httpx.Response, full_name: str = "") -> str:
    """Turn a GitHub error response into something a maintainer can act on."""
    code = resp.status_code
    if code == 401:
        return "GitHub rejected the saved token. It may have expired or been revoked: reconnect GitHub in Settings."
    if code == 403 and resp.headers.get("x-ratelimit-remaining") == "0":
        return "GitHub's rate limit is used up. Connect GitHub in Settings to get a higher limit, or wait an hour."
    if code in (403, 404) and full_name:
        return (f"Swarm can't see {full_name}. Check the name, or connect a GitHub account that can "
                "access it (private repos need the repo scope).")
    return f"GitHub returned {code}: {resp.text[:160]}"


def api_get(path: str, token: str | None, **params) -> httpx.Response:
    return httpx.get(f"{API}{path}", headers=_headers(token), params=params or None, timeout=30)


def repo_info(full_name: str, token: str | None) -> dict:
    """Default branch, visibility and URL for a repository; raises GitError with a readable reason."""
    resp = api_get(f"/repos/{full_name}", token)
    if resp.status_code != 200:
        raise GitError(explain(resp, full_name))
    r = resp.json()
    return {"defaultBranch": r.get("default_branch") or "main", "private": bool(r.get("private")),
            "htmlUrl": r.get("html_url"), "openIssues": r.get("open_issues_count", 0),
            "description": (r.get("description") or "")[:200]}


def issues_changed_since(full_name: str, token: str | None, since_iso: str) -> int:
    """How many issues (not PRs) were opened or edited after `since_iso`."""
    resp = api_get(f"/repos/{full_name}/issues", token, state="open", since=since_iso, per_page=50)
    if resp.status_code != 200:
        raise GitError(explain(resp, full_name))
    return sum(1 for i in resp.json() if "pull_request" not in i)


def _git(args: list[str], cwd: Path | None = None) -> str:
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0")
    proc = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, env=env, timeout=300)
    if proc.returncode != 0:
        # never echo a token-bearing URL back into logs or the UI
        raise GitError(proc.stderr.replace("x-access-token", "***")[-400:])
    return proc.stdout


def _url(full_name: str, token: str | None) -> str:
    return f"https://x-access-token:{token}@github.com/{full_name}.git" if token else f"https://github.com/{full_name}.git"


def sync_checkout(full_name: str, dest: Path, token: str | None, branch: str | None = None) -> str:
    """Clone or fast-forward `dest` to the default branch. Returns the checked-out branch."""
    if (dest / ".git").exists():
        _git(["remote", "set-url", "origin", _url(full_name, token)], dest)
        _git(["fetch", "--depth", "1", "origin"], dest)
        branch = branch or _git(["rev-parse", "--abbrev-ref", "origin/HEAD"], dest).strip().split("/", 1)[-1]
        _git(["checkout", "-B", branch, f"origin/{branch}"], dest)
        _git(["reset", "--hard", f"origin/{branch}"], dest)
        return branch
    if dest.exists():
        shutil.rmtree(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    _git(["clone", "--depth", "1", *(["--branch", branch] if branch else []), _url(full_name, token), str(dest)])
    return _git(["rev-parse", "--abbrev-ref", "HEAD"], dest).strip()


def open_pull_request(full_name: str, checkout: Path, token: str, base: str, task_id: str,
                      title: str, body: str, diff: str) -> str:
    """Commit the patch on a new branch, push it and open a PR. Returns the PR URL."""
    branch = f"swarm/{task_id}"
    _git(["checkout", "-B", branch, f"origin/{base}"], checkout)
    apply_diff(diff, checkout)
    _git(["add", "-A"], checkout)
    _git(["-c", "user.name=Swarm", "-c", "user.email=swarm@users.noreply.github.com",
          "commit", "-m", f"{title}\n\nOpened by Swarm for {task_id}."], checkout)
    _git(["push", "--force", "origin", branch], checkout)
    _git(["checkout", base], checkout)
    resp = httpx.post(
        f"{API}/repos/{full_name}/pulls",
        headers=_headers(token),
        json={"title": title, "head": branch, "base": base, "body": body},
        timeout=30,
    )
    if resp.status_code == 422 and "already exists" in resp.text:
        return f"https://github.com/{full_name}/pulls?q=head:{branch}"
    if resp.status_code >= 300:
        raise GitError(explain(resp, full_name))
    return resp.json()["html_url"]
