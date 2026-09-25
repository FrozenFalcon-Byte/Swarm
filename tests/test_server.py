"""The HTTP server's own checks: MCP access tokens and passkey origins and challenges."""

import asyncio

import pytest

pytest.importorskip("mcp")
pytest.importorskip("webauthn")

from swarm.passkeys import PasskeyError, Passkeys  # noqa: E402
from swarm.server import FirestoreTokens, token_hash  # noqa: E402


class Snap:
    def __init__(self, data):
        self._d = data
        self.exists = data is not None
        self.reference = self

    def to_dict(self):
        return self._d

    def update(self, _):
        pass


class FakeDb:
    """Just enough of Firestore: collection(name).document(id).get()."""

    def __init__(self, docs):
        self.docs = docs
        self.reads = 0

    def collection(self, name):
        db = self

        class Col:
            def document(self, doc_id):
                class Doc:
                    def get(self):
                        db.reads += 1
                        return Snap(db.docs.get((name, doc_id)))
                return Doc()
        return Col()


def test_tokens_map_to_their_user_and_unknown_ones_fail():
    good = "swm_" + "a" * 40
    db = FakeDb({("mcpTokens", token_hash(good)): {"uid": "u1", "name": "laptop"}})
    tokens = FirestoreTokens(db)

    tok = asyncio.run(tokens.verify_token(good))
    assert tok.subject == "u1" and tok.client_id == "laptop" and tok.scopes == ["swarm"]
    asyncio.run(tokens.verify_token(good))
    assert db.reads == 1  # cached for a minute

    assert asyncio.run(tokens.verify_token("swm_" + "b" * 40)) is None  # not issued
    assert asyncio.run(tokens.verify_token("ghp_" + "a" * 40)) is None  # wrong kind of token
    assert db.reads == 2  # the wrong kind never reaches Firestore


def test_passkeys_only_for_listed_sites_and_challenges_are_single_use():
    pk = Passkeys(FakeDb({}), ["http://localhost:5173", "https://swarm.web.app/"])

    with pytest.raises(PasskeyError, match="aren't enabled"):
        pk.login_options("https://evil.example")

    out = pk.login_options("https://swarm.web.app")
    assert out["options"]["rpId"] == "swarm.web.app"
    cid = out["challengeId"]
    with pytest.raises(PasskeyError, match="expired"):
        pk._take(cid, "http://localhost:5173")  # a challenge is bound to the site that asked for it
    with pytest.raises(PasskeyError, match="expired"):
        pk._take(cid, "https://swarm.web.app")  # and the failed attempt used it up
