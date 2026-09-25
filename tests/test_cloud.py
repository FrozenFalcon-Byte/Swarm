"""Firestore-backed board and worker helpers. Runs only against the local emulator."""

import os
import uuid

import pytest

from swarm.board import InvalidTransition, TaskState

pytestmark = pytest.mark.skipif(not os.environ.get("FIRESTORE_EMULATOR_HOST"), reason="needs the Firestore emulator")


@pytest.fixture
def fs_board():
    from swarm.cloud import firebase
    from swarm.cloud.board import FirestoreTaskBoard

    repo_id = f"test-{uuid.uuid4().hex[:8]}"
    db = firebase.db()
    db.collection("repos").document(repo_id).set({"members": ["u1"], "ownerUid": "u1"})
    yield FirestoreTaskBoard(db, repo_id)


def test_firestore_board_state_machine(fs_board):
    t = fs_board.create("#1", "flaky thing", "body")
    assert t.task_id == "task-001" and fs_board.create("#1", "again").task_id == "task-001"
    assert fs_board.create("#2", "other").task_id == "task-002"
    fs_board.transition(t.task_id, TaskState.TRIAGED, "triager", "ok", artifacts={"a": 1})
    fs_board.update(t.task_id, "tester", "attach", artifacts={"b": 2})
    got = fs_board.get(t.task_id)
    assert got.state == TaskState.TRIAGED and got.artifacts == {"a": 1, "b": 2}
    with pytest.raises(InvalidTransition):
        fs_board.transition(t.task_id, TaskState.MERGED, "coder", "skip")
    assert [x.task_id for x in fs_board.list(TaskState.TRIAGED)] == ["task-001"]


def test_worker_queues_a_run_when_github_has_new_issues(monkeypatch):
    from swarm.cloud import firebase, worker as worker_mod
    from swarm.cloud.worker import Worker

    db = firebase.db()
    rid = f"gh-{uuid.uuid4().hex[:8]}"
    base = {"members": ["u1"], "ownerUid": "u1", "source": "github", "fullName": "acme/app", "status": "idle",
            "lastSyncedAt": "2026-01-01T00:00:00+00:00"}
    db.collection("repos").document(rid).set(base)
    db.collection("repos").document(rid + "-off").set({**base, "settings": {"autoSync": False}})
    monkeypatch.setattr(worker_mod, "issues_changed_since", lambda full, token, since: 2)
    w = Worker.__new__(Worker)
    w.db, w.sync_minutes, w._last_sync = db, 10, 0.0
    w.sync_due_repos(force=True)
    runs = list(db.collection("repos").document(rid).collection("runs").stream())
    assert [r.get("trigger") for r in runs] == ["github-sync"]
    assert not list(db.collection("repos").document(rid + "-off").collection("runs").stream())
    assert db.collection("repos").document(rid).get().get("status") == "queued"
