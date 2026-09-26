#!/usr/bin/env python3
"""Put Swarm's server on a free Hugging Face Space, and give the GitHub Actions worker what it needs.

    HF_TOKEN=hf_...  SWARM_DISPATCH_TOKEN=github_pat_...  python scripts/space.py --space you/swarm

What it does, each step skipped when there's nothing to do:
  1. creates the Space (Docker, free CPU) if it doesn't exist yet
  2. sets its secrets and variables: the Firebase service account (from secrets/service-account.json or
     FIREBASE_SERVICE_ACCOUNT_JSON), the dispatch token, and where the web app and repository live
  3. pushes the code (swarm/, pyproject.toml, the demo repo) with space/Dockerfile and space/README.md
  4. with --actions, also sets the GitHub Actions secrets the scheduled worker needs, using the gh CLI

HF_TOKEN: huggingface.co → Settings → Access Tokens → New token, type "Write".
SWARM_DISPATCH_TOKEN: github.com → Settings → Developer settings → Fine-grained tokens, only this repository,
  permission "Actions: Read and write". It lets the Space start the worker; nothing else.
Later deploys happen by themselves on every push to main (.github/workflows/space.yml).
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
HF = "https://huggingface.co"
SHIP = ["swarm", "pyproject.toml", "demo_repo", "demo_issues.json"]  # what the Space image is built from


def say(msg: str) -> None:
    print(f"  {msg}", flush=True)


def env_file() -> dict[str, str]:
    """The repository's .env, for model keys; real environment variables win."""
    out: dict[str, str] = {}
    f = ROOT / ".env"
    if f.exists():
        for line in f.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                if v.strip():
                    out[k.strip()] = v.strip().strip('"').strip("'")
    return {**out, **{k: v for k, v in os.environ.items() if v}}


def service_account() -> str:
    if os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON"):
        return os.environ["FIREBASE_SERVICE_ACCOUNT_JSON"]
    f = ROOT / "secrets" / "service-account.json"
    if not f.exists():
        sys.exit("No Firebase service account: put it at secrets/service-account.json or in FIREBASE_SERVICE_ACCOUNT_JSON.")
    return json.dumps(json.loads(f.read_text()))  # one line


def space_url(space: str) -> str:
    owner, name = space.split("/")
    slug = f"{owner}-{name}".lower().replace("_", "-").replace(".", "-")
    return f"https://{slug}.hf.space"


def github_repo() -> str:
    url = subprocess.run(["git", "remote", "get-url", "origin"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    return url.removesuffix(".git").split("github.com")[-1].lstrip(":/")


def create(client: httpx.Client, space: str, private: bool) -> None:
    r = client.get(f"{HF}/api/spaces/{space}")
    if r.status_code == 200:
        say(f"Space {space} exists")
        return
    owner, name = space.split("/")
    body = {"type": "space", "name": name, "sdk": "docker", "private": private}
    me = client.get(f"{HF}/api/whoami-v2").json().get("name")
    if owner != me:
        body["organization"] = owner
    r = client.post(f"{HF}/api/repos/create", json=body)
    if r.status_code >= 400 and "already" not in r.text.lower():
        sys.exit(f"Couldn't create the Space: {r.status_code} {r.text[:300]}")
    say(f"created Space {space}")


def configure(client: httpx.Client, space: str, values: dict[str, str], secret: set[str]) -> None:
    for key, value in values.items():
        kind = "secrets" if key in secret else "variables"
        r = client.post(f"{HF}/api/spaces/{space}/{kind}", json={"key": key, "value": value})
        if r.status_code >= 400:
            sys.exit(f"Couldn't set {key}: {r.status_code} {r.text[:200]}")
        say(f"{kind[:-1]} {key} set")


def push(space: str, token: str) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp) / "space"
        work.mkdir()
        for item in SHIP:
            src = ROOT / item
            if src.is_dir():
                shutil.copytree(src, work / item, ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".pytest_cache", "*.egg-info"))
            else:
                shutil.copy2(src, work / item)
        shutil.copy2(ROOT / "space" / "Dockerfile", work / "Dockerfile")
        shutil.copy2(ROOT / "space" / "README.md", work / "README.md")
        sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
        git = lambda *a: subprocess.run(["git", *a], cwd=work, check=True, capture_output=True, text=True)  # noqa: E731
        git("init", "-q", "-b", "main")
        git("add", "-A")
        git("-c", "user.name=swarm-deploy", "-c", "user.email=deploy@swarm.local", "commit", "-q", "-m", f"Deploy {sha or 'local'}")
        remote = f"https://user:{token}@huggingface.co/spaces/{space}"
        r = subprocess.run(["git", "push", "-q", "--force", remote, "main"], cwd=work, capture_output=True, text=True)
        if r.returncode:
            sys.exit(f"Push to the Space failed: {r.stderr.replace(token, '***')[:400]}")
    say("code pushed; the Space builds it now (a few minutes the first time)")


def actions_secrets(values: dict[str, str]) -> None:
    if not shutil.which("gh"):
        sys.exit("--actions needs the GitHub CLI (gh), signed in to this repository.")
    for key, value in values.items():
        subprocess.run(["gh", "secret", "set", key, "--body", value], cwd=ROOT, check=True, capture_output=True)
        say(f"GitHub Actions secret {key} set")


def worker_secrets(env: dict[str, str], hub_url: str | None) -> None:
    """What the scheduled worker on GitHub Actions needs: the service account, any model keys in .env,
    and where the hub lives (so its schedule keeps the hub awake)."""
    worker = {"FIREBASE_SERVICE_ACCOUNT_JSON": service_account()}
    for key, as_key in (("GROQ_API_KEY", "GROQ_API_KEY"), ("GEMINI_API_KEY", "GEMINI_API_KEY"), ("GITHUB_TOKEN", "GH_WORKER_TOKEN")):
        if env.get(key):
            worker[as_key] = env[key]
    actions_secrets(worker)
    if hub_url:
        subprocess.run(["gh", "variable", "set", "SWARM_HUB_URL", "--body", hub_url.rstrip("/")], cwd=ROOT, check=True, capture_output=True)
        say("GitHub Actions variable SWARM_HUB_URL set")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--space", help="owner/name on Hugging Face, e.g. you/swarm")
    ap.add_argument("--actions-only", action="store_true", help="only set the GitHub Actions worker's secrets (no Hugging Face)")
    ap.add_argument("--hub-url", help="with --actions-only: where the hub runs (e.g. your Render URL), for the keep-alive ping")
    ap.add_argument("--private", action="store_true", help="make the Space private (the web app can't reach a private Space)")
    ap.add_argument("--actions", action="store_true", help="also set the GitHub Actions secrets the worker needs")
    ap.add_argument("--no-push", action="store_true", help="only create and configure")
    ap.add_argument("--push-only", action="store_true", help="only push the code (what the deploy workflow does)")
    args = ap.parse_args()

    env = env_file()
    if args.actions_only:
        worker_secrets(env, args.hub_url)
        return
    if not args.space:
        sys.exit("--space owner/name is required (or use --actions-only).")
    token = env.get("HF_TOKEN") or sys.exit("Set HF_TOKEN to a Hugging Face token with write access.")
    if args.push_only:
        push(args.space, token)
        return
    repo = github_repo()
    project = json.loads(service_account()).get("project_id", "")
    url = space_url(args.space)
    print(f"Swarm → {args.space}  ({url})")

    with httpx.Client(headers={"Authorization": f"Bearer {token}"}, timeout=60) as client:
        create(client, args.space, args.private)
        values = {
            "FIREBASE_SERVICE_ACCOUNT_JSON": service_account(),
            "SWARM_PUBLIC_URL": url,
            "SWARM_WEB_ORIGINS": f"https://{project}.web.app,https://{project}.firebaseapp.com,http://localhost:5173",
            "SWARM_GH_REPO": repo,
        }
        secret = {"FIREBASE_SERVICE_ACCOUNT_JSON"}
        if env.get("SWARM_DISPATCH_TOKEN"):
            values["SWARM_DISPATCH_TOKEN"] = env["SWARM_DISPATCH_TOKEN"]
            secret.add("SWARM_DISPATCH_TOKEN")
        else:
            say("no SWARM_DISPATCH_TOKEN: the Space won't start the worker early; it still runs on its 15-minute schedule")
        configure(client, args.space, values, secret)

    if not args.no_push:
        push(args.space, token)

    if args.actions:
        worker_secrets(env, url)

    print(f"\nDone. In a few minutes: {url}/healthz\n"
          f"Point the web app at it: VITE_SWARM_API_URL={url} in web/.env, then rebuild and deploy.\n"
          f"For deploys on every push, add HF_TOKEN as a GitHub Actions secret and HF_SPACE={args.space} as a variable.")


if __name__ == "__main__":
    main()
