"""`swarm doctor`: check every connection the worker needs and say how to fix what's missing."""

from __future__ import annotations

import os
import shutil
from dataclasses import dataclass

import httpx

from .config import Settings


@dataclass
class Check:
    area: str
    name: str
    status: str  # ok | warn | fail | skip
    detail: str
    fix: str = ""


def _firebase() -> list[Check]:
    from .cloud import firebase

    out: list[Check] = []
    if firebase.using_emulators():
        out.append(Check("firebase", "mode", "warn", f"local emulators at {os.environ['FIRESTORE_EMULATOR_HOST']}",
                         "Unset FIRESTORE_EMULATOR_HOST to use your real Firebase project."))
    else:
        try:
            sa = firebase.service_account()
        except (OSError, ValueError) as e:
            return [Check("firebase", "service account", "fail", f"couldn't read it: {e}",
                          "Firebase console → Project settings → Service accounts → Generate new private key.")]
        wanted = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
        if sa:
            out.append(Check("firebase", "service account", "ok", sa.get("client_email", "loaded")))
        elif wanted:
            out.append(Check("firebase", "service account", "fail", f"{wanted} doesn't exist yet",
                             "Firebase console → Project settings → Service accounts → Generate new private key, "
                             f"then save the file as {wanted}."))
            out.append(Check("firebase", "project", "ok", firebase.project_id()))
            out.append(Check("firebase", "firestore", "skip", "waiting for the service account"))
            return out
        else:
            out.append(Check("firebase", "service account", "warn", "none set; trying application default credentials",
                             "Set GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json in .env "
                             "(Firebase console → Project settings → Service accounts → Generate new private key)."))
    out.append(Check("firebase", "project", "ok" if firebase.project_id() != "demo-swarm" or firebase.using_emulators() else "fail",
                     firebase.project_id(), "" if firebase.project_id() != "demo-swarm" else "Set FIREBASE_PROJECT_ID in .env."))
    if not firebase.using_emulators() and firebase.project_id() == "demo-swarm":
        out.append(Check("firebase", "firestore", "skip", "set the project and credentials first"))
        return out
    try:
        firebase.db().collection("workers").limit(1).get(timeout=10)
        out.append(Check("firebase", "firestore", "ok", "reachable"))
    except Exception as e:  # noqa: BLE001 - any failure here is a setup problem to report
        out.append(Check("firebase", "firestore", "fail", str(e).splitlines()[0][:160],
                         "Create the database: Firebase console → Build → Firestore Database → Create database."))
    if not firebase.storage_enabled():
        out.append(Check("firebase", "storage", "ok", "not used: tool code is kept in Firestore (fine on the free Spark plan)"))
        return out
    try:
        b = firebase.bucket()
        ok = firebase.using_emulators() or b.exists()
        out.append(Check("firebase", "storage", "ok" if ok else "fail", b.name,
                         "" if ok else "Enable Storage (Build → Storage → Get started), then set FIREBASE_STORAGE_BUCKET "
                         "to the bucket name it shows (gs://<name>)."))
    except Exception as e:  # noqa: BLE001
        out.append(Check("firebase", "storage", "fail", str(e).splitlines()[0][:160],
                         "Enable Storage and set FIREBASE_STORAGE_BUCKET."))
    return out


def _github() -> list[Check]:
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        return [Check("github", "worker token", "skip", "not set; the worker uses each repo owner's connected account",
                      "Optional. For a fallback, create a token at github.com/settings/tokens and set GITHUB_TOKEN.")]
    try:
        r = httpx.get("https://api.github.com/user", headers={"Authorization": f"Bearer {token}"}, timeout=10)
    except httpx.HTTPError as e:
        return [Check("github", "worker token", "fail", f"couldn't reach GitHub: {e}")]
    if r.status_code != 200:
        return [Check("github", "worker token", "fail", f"GitHub said {r.status_code}", "Create a new token; this one is invalid or expired.")]
    scopes = r.headers.get("x-oauth-scopes")
    detail = f"@{r.json().get('login')}" + (f" · scopes: {scopes}" if scopes else " · fine-grained token")
    return [Check("github", "worker token", "ok", detail)]


def _models(settings: Settings) -> list[Check]:
    from .llm import build_providers

    out: list[Check] = []
    keys = {  # provider → (key variable, model variable, where to get a key)
        "groq": ("GROQ_API_KEY", "SWARM_GROQ_MODEL", "console.groq.com/keys"),
        "gemini": ("GEMINI_API_KEY", "SWARM_GEMINI_MODEL", "aistudio.google.com/apikey"),
        "openrouter": ("OPENROUTER_API_KEY", "SWARM_OPENROUTER_MODEL", "openrouter.ai/settings/keys"),
        "anthropic": ("ANTHROPIC_API_KEY", "SWARM_MODEL", "console.anthropic.com → API keys"),
    }
    for p in build_providers(settings):
        if p.name == "ollama":
            ok = p.ready()
            out.append(Check("models", "ollama", "ok" if ok else "skip", p.model if ok else "not running",
                             "" if ok else "Install from ollama.com, then: ollama pull qwen2.5-coder:7b"))
            continue
        if p.name not in keys:
            continue
        key_env, model_env, where = keys[p.name]
        if not p.ready():
            hint = f"Paid. {where} → {key_env}" if p.name == "anthropic" else f"Free key at {where} → {key_env} in .env"
            out.append(Check("models", p.name, "skip", "no key", hint))
            continue
        out.append(_probe_model(p, key_env, model_env, where))
    if not any(c.status == "ok" for c in out):
        out.append(Check("models", "any model", "warn", "none available; agents fall back to built-in heuristics",
                         "Add one free key: GROQ_API_KEY (console.groq.com/keys) or GEMINI_API_KEY (aistudio.google.com/apikey)."))
    return out


def _probe_model(p, key_env: str, model_env: str, where: str) -> Check:
    """A one-line request, so a valid key paired with a retired model shows up here, not mid-run."""
    from .llm import LLMError

    try:
        p.complete("Reply with the word ok.", "ok?", 16, False)
        return Check("models", p.name, "ok", p.model)
    except LLMError as e:
        msg = str(e)
        status = msg.split(" ", 2)[1].rstrip(":") if msg.count(" ") >= 1 else ""
        if status in ("401", "403"):
            return Check("models", p.name, "fail", f"key rejected ({status})", f"Make a new key at {where}.")
        if status in ("429", "500", "502", "503"):
            busy = "rate limited" if status == "429" else "busy"
            return Check("models", p.name, "warn", f"{p.model}: {busy} right now ({status})", "Usually temporary; the next provider takes over meanwhile.")
        if status in ("400", "404"):
            return Check("models", p.name, "fail", f"{p.model} isn't available to this key",
                         f"Set {model_env} in .env to a model listed on your {p.name} account.")
        return Check("models", p.name, "fail", " ".join(msg.split())[:160])
    except httpx.HTTPError as e:
        return Check("models", p.name, "fail", f"unreachable: {e}")


def _tools(settings: Settings) -> list[Check]:
    from .sandbox import Sandbox

    out = [Check("tools", "git", "ok" if shutil.which("git") else "fail", shutil.which("git") or "missing", "Install git.")]
    backend = Sandbox(settings).backend
    out.append(Check("tools", "sandbox", "ok" if backend == "docker" else "warn", backend,
                     "" if backend == "docker" else "Install Docker to run untrusted repos with the network cut off."))
    return out


def run(settings: Settings, env_file: str | None) -> list[Check]:
    import logging

    logging.getLogger("google").setLevel(logging.ERROR)  # the metadata-server probe is noisy off GCP
    checks = [Check("config", ".env", "ok" if env_file else "warn", env_file or "none found",
                    "" if env_file else "cp .env.example .env and fill it in.")]
    for part in (_firebase, _github):
        checks += part()
    checks += _models(settings)
    checks += _tools(settings)
    return checks


def render(checks: list[Check]) -> str:
    icon = {"ok": "✓", "warn": "!", "fail": "✗", "skip": "·"}
    lines, area = [], ""
    for c in checks:
        if c.area != area:
            area = c.area
            lines.append(f"\n{area}")
        lines.append(f"  {icon[c.status]} {c.name:<16} {c.detail}")
        if c.fix and c.status != "ok":
            lines.append(f"    → {c.fix}")
    failed = sum(c.status == "fail" for c in checks)
    lines.append(f"\n{'all set' if not failed else f'{failed} problem(s) to fix'}")
    return "\n".join(lines)
