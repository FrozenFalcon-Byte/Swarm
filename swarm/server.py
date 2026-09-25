"""`swarm server`: Swarm's public HTTP server, next to the worker.

  /mcp                      MCP over streamable HTTP, for any number of clients at once. Every request
                            needs `Authorization: Bearer swm_…`, a personal access token made in the
                            dashboard (Settings → Use from Claude). A token acts as the person who made
                            it and sees only their repositories.
  /api/passkeys/...         passkey sign-in for the web app (see swarm.passkeys)
  /healthz                  liveness, for hosting platforms

Access tokens are stored as SHA-256 hashes at mcpTokens/{hash}; the plain token is shown once, in
the browser that made it, and never reaches Firestore. Deleting the document revokes it.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from typing import Any

from mcp.server.auth.provider import AccessToken
from mcp.server.auth.settings import AuthSettings
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from .config import Settings

log = logging.getLogger("swarm.server")
TOKEN_PREFIX = "swm_"
CACHE_S = 60  # a revoked token stops working within a minute
TOUCH_S = 300  # how often lastUsedAt is refreshed


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class FirestoreTokens:
    """MCP bearer tokens → the Swarm user who made them."""

    def __init__(self, db):
        self.db = db
        self._cache: dict[str, tuple[AccessToken | None, float]] = {}
        self._touched: dict[str, float] = {}

    async def verify_token(self, token: str) -> AccessToken | None:
        if not token.startswith(TOKEN_PREFIX) or len(token) > 200:
            return None
        h = token_hash(token)
        hit = self._cache.get(h)
        if hit and hit[1] > time.monotonic():
            return hit[0]
        snap = self.db.collection("mcpTokens").document(h).get()
        d = snap.to_dict() if snap.exists else None
        result = AccessToken(token=token, client_id=d.get("name") or "token", subject=d["uid"], scopes=["swarm"]) \
            if d and d.get("uid") else None
        self._cache[h] = (result, time.monotonic() + CACHE_S)
        if result and time.monotonic() - self._touched.get(h, 0) > TOUCH_S:
            from google.cloud import firestore as gfs

            self._touched[h] = time.monotonic()
            snap.reference.update({"lastUsedAt": gfs.SERVER_TIMESTAMP})
        return result


def web_origins() -> list[str]:
    from .cloud import firebase

    listed = [o.strip() for o in os.environ.get("SWARM_WEB_ORIGINS", "").split(",") if o.strip()]
    project = firebase.project_id()
    return listed or ["http://localhost:5173", "http://127.0.0.1:5173",
                      f"https://{project}.web.app", f"https://{project}.firebaseapp.com"]


def create_app(settings: Settings, public_url: str, host: str = "127.0.0.1"):
    from firebase_admin import auth as fb_auth

    from .cloud import firebase
    from .mcp_server import build
    from .passkeys import PasskeyError, Passkeys

    db = firebase.db()
    origins = web_origins()
    server = build(settings, cloud=True, token_verifier=FirestoreTokens(db), auth=AuthSettings(
        issuer_url=public_url, resource_server_url=f"{public_url}/mcp", validate_token_resource=False,
        required_scopes=["swarm"]))
    passkeys = Passkeys(db, origins)

    def firebase_user(request: Request) -> dict:
        header = request.headers.get("authorization", "")
        if not header.startswith("Bearer "):
            raise PasskeyError("sign in first")
        firebase.app()
        try:
            return fb_auth.verify_id_token(header[7:])
        except Exception as e:
            raise PasskeyError("your session expired; sign in again") from e

    def route(path: str, handler):
        async def endpoint(request: Request):
            try:
                raw = await request.body()
                body: dict[str, Any] = json.loads(raw) if raw.strip() else {}
                if not isinstance(body, dict):
                    raise PasskeyError("expected a JSON object")
                return JSONResponse(await handler(request, body))
            except (PasskeyError, json.JSONDecodeError) as e:
                return JSONResponse({"error": str(e)}, status_code=400)
            except Exception:
                log.exception("%s failed", path)
                return JSONResponse({"error": "the server hit an unexpected error"}, status_code=500)
        server.custom_route(path, methods=["POST"])(endpoint)

    async def reg_options(request: Request, body: dict):
        u = firebase_user(request)
        return passkeys.register_options(u["uid"], u.get("email"), u.get("name"), request.headers.get("origin"))

    async def reg_verify(request: Request, body: dict):
        u = firebase_user(request)
        return passkeys.register_verify(u["uid"], body.get("challengeId", ""), body.get("credential") or {},
                                        body.get("name", ""), request.headers.get("origin"))

    async def login_options(request: Request, body: dict):
        return passkeys.login_options(request.headers.get("origin"))

    async def login_verify(request: Request, body: dict):
        uid = passkeys.login_verify(body.get("challengeId", ""), body.get("credential") or {}, request.headers.get("origin"))
        firebase.app()
        return {"token": fb_auth.create_custom_token(uid).decode()}

    route("/api/passkeys/register/options", reg_options)
    route("/api/passkeys/register/verify", reg_verify)
    route("/api/passkeys/login/options", login_options)
    route("/api/passkeys/login/verify", login_verify)

    @server.custom_route("/healthz", methods=["GET"])
    async def healthz(request: Request):
        return JSONResponse({"ok": True, "mcp": f"{public_url}/mcp", "project": firebase.project_id()})

    app = server.streamable_http_app(host=host)
    # the web app calls /api from its own origin; MCP clients aren't browsers, so they don't need CORS
    return CORSMiddleware(app, allow_origins=origins, allow_methods=["GET", "POST", "OPTIONS"],
                          allow_headers=["authorization", "content-type"], max_age=600)


def serve(settings: Settings, host: str, port: int) -> None:
    import uvicorn

    public = (os.environ.get("SWARM_PUBLIC_URL") or f"http://{'localhost' if host in ('127.0.0.1', '0.0.0.0') else host}:{port}").rstrip("/")
    log.warning("Swarm server on %s  (MCP: %s/mcp)", public, public)
    uvicorn.run(create_app(settings, public, host), host=host, port=port, log_level="warning")
