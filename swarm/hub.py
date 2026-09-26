"""`swarm hub`: everything Swarm serves, in one FastAPI app, sized for one free host (a Hugging Face Space).

  /                     a small status page
  /healthz              liveness, plus what this hub is doing
  /mcp, /a2a, /agents, /.well-known/agent-card.json, /api/passkeys/...
                        exactly as `swarm server` (swarm.server.create_app), mounted underneath

and, in the background, one of:

  dispatch (default)    watches Firestore for queued runs and pending actions and starts the GitHub Actions
                        worker (.github/workflows/worker.yml) the moment one appears, instead of waiting for
                        its 15-minute schedule. The worker keeps running there, where every test runs in a
                        Docker sandbox. Needs SWARM_GH_REPO (owner/name) and SWARM_DISPATCH_TOKEN (a
                        fine-grained token with Actions: read and write on that repository).
  worker                runs the worker inside this process instead (SWARM_HUB_WORKER=on). Free hosts have
                        no Docker, so tests run without the sandbox: only for repositories you trust.
  off                   neither (no dispatch settings, worker not switched on)

Firestore listeners cost reads only when something changes, so an idle hub stays inside the free quota.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import FastAPI
from fastapi.responses import HTMLResponse, JSONResponse

from .config import Settings

log = logging.getLogger("swarm.hub")
COOLDOWN_S = 45  # never start the workflow more often than this


class Dispatcher:
    """Starts the GitHub Actions worker when there is work for it."""

    def __init__(self, db, repo: str, token: str, workflow: str = "worker.yml", ref: str = "main"):
        self.db, self.repo, self.token, self.workflow, self.ref = db, repo, token, workflow, ref
        self.last_dispatch = 0.0
        self.dispatches = 0
        self.last_error: str | None = None
        self._lock = threading.Lock()
        self._watches: list[Any] = []
        self._retry: threading.Timer | None = None

    @property
    def _api(self) -> str:
        return f"https://api.github.com/repos/{self.repo}/actions/workflows/{self.workflow}"

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}

    def waiting_already(self) -> bool:
        """A pass that hasn't started yet will pick this up; one that's running might already be past it."""
        r = httpx.get(f"{self._api}/runs", params={"status": "queued", "per_page": 1}, headers=self._headers(), timeout=15)
        r.raise_for_status()
        return r.json().get("total_count", 0) > 0

    def kick(self, why: str) -> None:
        with self._lock:
            wait = COOLDOWN_S - (time.monotonic() - self.last_dispatch)
            if wait > 0:  # try again once the cooldown is over, in case nothing else wakes us
                if not self._retry or not self._retry.is_alive():
                    self._retry = threading.Timer(wait + 1, self.kick, args=(why,))
                    self._retry.daemon = True
                    self._retry.start()
                return
            try:
                if self.waiting_already():
                    log.info("dispatch skipped (%s): a worker pass is already queued", why)
                    return
                r = httpx.post(f"{self._api}/dispatches", json={"ref": self.ref}, headers=self._headers(), timeout=15)
                r.raise_for_status()
                self.last_dispatch = time.monotonic()
                self.dispatches += 1
                self.last_error = None
                log.warning("started the worker on GitHub Actions (%s)", why)
            except Exception as e:  # a bad token or a GitHub hiccup shouldn't take the hub down
                self.last_error = str(e)[:300]
                log.warning("couldn't start the worker: %s", self.last_error)

    def start(self) -> None:
        from google.cloud import firestore as gfs

        def watch(group: str, status: str):
            def changed(snaps, changes, _read_at):
                if any(c.type.name in ("ADDED", "MODIFIED") for c in changes) and snaps:
                    threading.Thread(target=self.kick, args=(f"{len(snaps)} {group} {status}",), daemon=True).start()
            q = self.db.collection_group(group).where(filter=gfs.FieldFilter("status", "==", status)).limit(20)
            self._watches.append(q.on_snapshot(changed))

        watch("runs", "queued")
        watch("actions", "pending")
        log.warning("dispatch on: watching Firestore, starting %s on %s when work appears", self.workflow, self.repo)

    def stop(self) -> None:
        for w in self._watches:
            try:
                w.unsubscribe()
            except Exception:
                pass
        if self._retry:
            self._retry.cancel()

    def status(self) -> dict:
        return {"mode": "dispatch", "repo": self.repo, "workflow": self.workflow, "dispatches": self.dispatches,
                "lastDispatchAgoS": round(time.monotonic() - self.last_dispatch) if self.last_dispatch else None,
                "lastError": self.last_error}


class InProcessWorker:
    """The worker on a thread in this process, for hosts where that's the only option."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.thread: threading.Thread | None = None

    def start(self) -> None:
        from .cloud.worker import Worker

        def loop():
            while True:  # run_forever handles Firestore hiccups; anything else, log and start again
                try:
                    Worker(self.settings).run_forever()
                except Exception:
                    log.exception("worker crashed; restarting in 30s")
                    time.sleep(30)

        self.thread = threading.Thread(target=loop, name="swarm-worker", daemon=True)
        self.thread.start()
        log.warning("worker on: running inside the hub (sandbox: %s)", os.environ.get("SWARM_SANDBOX", "auto"))

    def stop(self) -> None:  # a daemon thread; it goes with the process
        pass

    def status(self) -> dict:
        return {"mode": "worker", "alive": bool(self.thread and self.thread.is_alive()), "sandbox": os.environ.get("SWARM_SANDBOX", "auto")}


def background(settings: Settings):
    from .cloud import firebase

    if os.environ.get("SWARM_HUB_WORKER", "").lower() in ("1", "on", "true", "yes"):
        return InProcessWorker(settings)
    repo, token = os.environ.get("SWARM_GH_REPO", "").strip(), os.environ.get("SWARM_DISPATCH_TOKEN", "").strip()
    if repo and token:
        return Dispatcher(firebase.db(), repo, token, os.environ.get("SWARM_GH_WORKFLOW", "worker.yml"), os.environ.get("SWARM_GH_REF", "main"))
    return None


def create_hub(settings: Settings, public_url: str) -> FastAPI:
    from .server import create_app

    inner = create_app(settings, public_url, host="0.0.0.0")
    job = background(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # the mounted MCP app has a lifespan of its own (its session manager); FastAPI doesn't run a mount's
        # lifespan, so it runs inside this one
        async with inner.lifespan_context(inner.starlette):
            if job:
                job.start()
            try:
                yield
            finally:
                if job:
                    job.stop()

    app = FastAPI(title="Swarm hub", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/healthz")
    async def healthz():
        from .cloud import firebase

        return JSONResponse({"ok": True, "mcp": f"{public_url}/mcp", "a2a": f"{public_url}/a2a",
                             "agentCard": f"{public_url}/.well-known/agent-card.json", "project": firebase.project_id(),
                             "background": job.status() if job else {"mode": "off"}})

    @app.get("/", response_class=HTMLResponse)
    async def home():
        state = job.status()["mode"] if job else "off"
        return HTMLResponse(PAGE.format(url=public_url, state={"dispatch": "starts the GitHub Actions worker as soon as there's work",
                                                                "worker": "runs the worker in this process",
                                                                "off": "serves MCP, A2A and passkeys; the worker runs on its schedule"}[state]))

    app.mount("/", inner)
    return app


PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Swarm hub</title><style>body{{font:16px/1.5 system-ui,sans-serif;max-width:640px;margin:10vh auto;padding:0 20px;color:#0f0f0f}}
h1{{font-size:40px;letter-spacing:-.04em;margin:0 0 8px}}code{{background:#eceFec;padding:2px 6px;border-radius:6px}}
.dots{{display:flex;gap:6px;margin-bottom:18px}}.dots i{{width:16px;height:16px;border-radius:50%;border:2px solid #0f0f0f}}</style></head>
<body><div class="dots"><i style="background:#fbe74e"></i><i style="background:#9dc4f5"></i><i style="background:#ff8a7a"></i><i style="background:#5dd36a"></i></div>
<h1>Swarm hub</h1><p>This is Swarm's server. It {state}.</p>
<p>MCP: <code>{url}/mcp</code><br>A2A: <code>{url}/a2a</code><br>Health: <a href="/healthz">/healthz</a></p></body></html>"""


def serve(settings: Settings, host: str, port: int) -> None:
    import uvicorn

    public = (os.environ.get("SWARM_PUBLIC_URL") or os.environ.get("SPACE_HOST") and f"https://{os.environ['SPACE_HOST']}"
              or f"http://localhost:{port}").rstrip("/")
    log.warning("Swarm hub on %s", public)
    uvicorn.run(create_hub(settings, public), host=host, port=port, log_level="warning", proxy_headers=True, forwarded_allow_ips="*")
