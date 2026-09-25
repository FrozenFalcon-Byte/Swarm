"""Passkey sign-in for Firebase accounts.

Firebase Auth has no passkeys of its own, so the server does the WebAuthn part and hands the
browser a Firebase custom token once a passkey checks out:

  add a passkey (signed in):  register_options → the browser creates it → register_verify
  sign in with one:           login_options    → the browser signs       → login_verify → custom token

Passkeys live in Firestore at passkeys/{credential id}: the public key and signature counter,
never anything secret. Challenges are single-use and expire after five minutes.
"""

from __future__ import annotations

import json
import secrets
import time
from dataclasses import dataclass
from urllib.parse import urlparse

from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

CHALLENGE_TTL_S = 300
MAX_PASSKEYS = 10


class PasskeyError(Exception):
    """A problem the person can act on; the message is shown in the dashboard."""


@dataclass
class _Challenge:
    value: bytes
    origin: str
    uid: str | None  # set when adding a passkey to a signed-in account
    expires: float


class Passkeys:
    def __init__(self, db, allowed_origins: list[str], rp_name: str = "Swarm"):
        self.db = db
        self.allowed_origins = [o.rstrip("/") for o in allowed_origins if o.strip()]
        self.rp_name = rp_name
        self._challenges: dict[str, _Challenge] = {}

    # -- helpers ------------------------------------------------------------
    def _origin(self, origin: str | None) -> tuple[str, str]:
        origin = (origin or "").rstrip("/")
        if origin not in self.allowed_origins:
            raise PasskeyError(f"passkeys aren't enabled for {origin or 'this site'}; add it to SWARM_WEB_ORIGINS")
        return origin, urlparse(origin).hostname or ""

    def _remember(self, value: bytes, origin: str, uid: str | None) -> str:
        now = time.time()
        for key in [k for k, c in self._challenges.items() if c.expires < now]:
            del self._challenges[key]
        cid = secrets.token_urlsafe(16)
        self._challenges[cid] = _Challenge(value, origin, uid, now + CHALLENGE_TTL_S)
        return cid

    def _take(self, cid: str, origin: str) -> _Challenge:
        c = self._challenges.pop(cid or "", None)
        if not c or c.expires < time.time() or c.origin != origin:
            raise PasskeyError("that request expired; try again")
        return c

    def _mine(self, uid: str) -> list[dict]:
        from google.cloud.firestore_v1.base_query import FieldFilter

        return [s.to_dict() | {"id": s.id} for s in
                self.db.collection("passkeys").where(filter=FieldFilter("uid", "==", uid)).stream()]

    # -- adding a passkey ---------------------------------------------------
    def register_options(self, uid: str, email: str | None, name: str | None, origin: str | None) -> dict:
        origin, rp_id = self._origin(origin)
        existing = self._mine(uid)
        if len(existing) >= MAX_PASSKEYS:
            raise PasskeyError(f"you already have {MAX_PASSKEYS} passkeys; remove one first")
        opts = generate_registration_options(
            rp_id=rp_id, rp_name=self.rp_name, user_id=uid.encode(), user_name=email or uid,
            user_display_name=name or email or "Swarm user",
            # discoverable, so signing in needs no email: the device offers the account
            authenticator_selection=AuthenticatorSelectionCriteria(
                resident_key=ResidentKeyRequirement.REQUIRED, user_verification=UserVerificationRequirement.PREFERRED),
            exclude_credentials=[PublicKeyCredentialDescriptor(id=base64url_to_bytes(p["id"])) for p in existing],
        )
        return {"challengeId": self._remember(opts.challenge, origin, uid), "options": json.loads(options_to_json(opts))}

    def register_verify(self, uid: str, challenge_id: str, credential: dict, label: str, origin: str | None) -> dict:
        from google.cloud import firestore as gfs

        origin, rp_id = self._origin(origin)
        c = self._take(challenge_id, origin)
        if c.uid != uid:
            raise PasskeyError("that request belongs to another account")
        try:
            v = verify_registration_response(credential=credential, expected_challenge=c.value,
                                             expected_rp_id=rp_id, expected_origin=origin)
        except Exception as e:  # the library raises several types, all meaning "not valid"
            raise PasskeyError(f"the passkey couldn't be verified ({e})") from e
        cred_id = bytes_to_base64url(v.credential_id)
        doc = {
            "uid": uid, "name": (label or "Passkey").strip()[:60], "rpId": rp_id,
            "publicKey": bytes_to_base64url(v.credential_public_key), "signCount": v.sign_count,
            "transports": credential.get("response", {}).get("transports") or [],
            "deviceType": str(getattr(v.credential_device_type, "value", v.credential_device_type)),
            "backedUp": bool(v.credential_backed_up), "createdAt": gfs.SERVER_TIMESTAMP, "lastUsedAt": None,
        }
        self.db.collection("passkeys").document(cred_id).set(doc)
        return {"id": cred_id, "name": doc["name"]}

    # -- signing in ---------------------------------------------------------
    def login_options(self, origin: str | None) -> dict:
        origin, rp_id = self._origin(origin)
        opts = generate_authentication_options(rp_id=rp_id, user_verification=UserVerificationRequirement.PREFERRED)
        return {"challengeId": self._remember(opts.challenge, origin, None), "options": json.loads(options_to_json(opts))}

    def login_verify(self, challenge_id: str, credential: dict, origin: str | None) -> str:
        """Returns the uid the passkey belongs to."""
        from google.cloud import firestore as gfs

        origin, rp_id = self._origin(origin)
        c = self._take(challenge_id, origin)
        ref = self.db.collection("passkeys").document(str(credential.get("id", "")))
        snap = ref.get()
        if not snap.exists or (snap.get("rpId") or rp_id) != rp_id:
            raise PasskeyError("this passkey isn't registered with Swarm; sign in another way, then add it in your profile")
        p = snap.to_dict()
        try:
            v = verify_authentication_response(
                credential=credential, expected_challenge=c.value, expected_rp_id=rp_id, expected_origin=origin,
                credential_public_key=base64url_to_bytes(p["publicKey"]), credential_current_sign_count=p.get("signCount", 0))
        except Exception as e:
            raise PasskeyError(f"the passkey couldn't be verified ({e})") from e
        ref.update({"signCount": v.new_sign_count, "lastUsedAt": gfs.SERVER_TIMESTAMP})
        return p["uid"]
