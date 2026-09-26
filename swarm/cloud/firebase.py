"""Firebase Admin initialisation.

Credentials, in order:
* emulators: FIRESTORE_EMULATOR_HOST / FIREBASE_STORAGE_EMULATOR_HOST set; no credentials needed.
* FIREBASE_SERVICE_ACCOUNT_JSON: the service-account JSON itself, for hosts that only take env vars.
* GOOGLE_APPLICATION_CREDENTIALS: a path to the service-account JSON file.
* application default credentials (e.g. on Cloud Run, or after `gcloud auth application-default login`).
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore, storage


def service_account() -> dict | None:
    inline = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip()
    if inline:
        return _parse_inline(inline)
    path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    if not path:
        return None
    # a relative path in .env means relative to the project, wherever the command is run from
    for candidate in (Path(path).expanduser(), Path(__file__).resolve().parents[2] / path):
        if candidate.is_file():
            return json.loads(candidate.read_text())
    return None


def _parse_inline(raw: str) -> dict:
    """The service account as pasted into a host's settings. Pasting is lossy (braces dropped, the whole
    thing wrapped in quotes), so this also takes it base64-encoded, which survives any paste."""
    import base64
    import binascii

    text = raw.strip()
    if text[:1] in "'\"" and text[-1:] == text[:1] and not text.startswith('"type"'):
        text = text[1:-1].strip()
    if not text.startswith(("{", '"')):
        try:
            text = base64.b64decode(text, validate=True).decode().strip()
        except (binascii.Error, UnicodeDecodeError):
            pass
    if text.startswith('"'):  # the braces got lost on the way in
        text = "{" + text.rstrip(",") + "}"
    try:
        sa = json.loads(text)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"FIREBASE_SERVICE_ACCOUNT_JSON isn't valid JSON ({e.msg} at char {e.pos}); "
                           "paste the whole file, or its base64 (base64 < service-account.json)") from None
    if not isinstance(sa, dict) or "private_key" not in sa:
        raise RuntimeError("FIREBASE_SERVICE_ACCOUNT_JSON doesn't look like a service account (no private_key)")
    return sa


def project_id() -> str:
    explicit = os.environ.get("FIREBASE_PROJECT_ID") or os.environ.get("GCLOUD_PROJECT")
    if explicit:
        return explicit
    if not using_emulators():
        try:
            sa = service_account()
        except (OSError, ValueError):
            sa = None
        if sa and sa.get("project_id"):
            return sa["project_id"]
    return "demo-swarm"


def bucket_name() -> str:
    # Projects created since late 2024 get <id>.firebasestorage.app; older ones <id>.appspot.com.
    return os.environ.get("FIREBASE_STORAGE_BUCKET") or f"{project_id()}.firebasestorage.app"


def storage_enabled() -> bool:
    """Cloud Storage is optional: new projects need the Blaze plan for it. Without a bucket,
    tool code lives in Firestore and patches/results stay on the task documents."""
    return using_emulators() or bool(os.environ.get("FIREBASE_STORAGE_BUCKET", "").strip())


def using_emulators() -> bool:
    return bool(os.environ.get("FIRESTORE_EMULATOR_HOST"))


@lru_cache(maxsize=1)
def app() -> firebase_admin.App:
    if firebase_admin._apps:
        return firebase_admin.get_app()
    sa = service_account()
    cred = credentials.Certificate(sa) if sa else None  # None → application default credentials
    return firebase_admin.initialize_app(cred, {"projectId": project_id(), "storageBucket": bucket_name()})


@lru_cache(maxsize=1)
def db():
    if using_emulators():
        # The emulators accept any caller; the Admin SDK would otherwise demand real Google credentials.
        from google.auth.credentials import AnonymousCredentials
        from google.cloud import firestore as gfs

        return gfs.Client(project=project_id(), credentials=AnonymousCredentials())
    return firestore.client(app())


@lru_cache(maxsize=1)
def bucket():
    if not storage_enabled():
        return None
    if using_emulators():
        from google.auth.credentials import AnonymousCredentials
        from google.cloud import storage as gcs

        os.environ.setdefault("STORAGE_EMULATOR_HOST", "http://" + os.environ.get("FIREBASE_STORAGE_EMULATOR_HOST", "127.0.0.1:9199"))
        return gcs.Client(project=project_id(), credentials=AnonymousCredentials()).bucket(bucket_name())
    return storage.bucket(app=app())
