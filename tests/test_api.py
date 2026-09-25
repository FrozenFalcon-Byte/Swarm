from fastapi.testclient import TestClient

from swarm.api import create_app


def test_state_and_human_actions(settings):
    app = create_app(settings)
    with TestClient(app) as client:
        swarm = app.state.swarm
        t = swarm.board.create("#1", "test_x is flaky")
        state = client.get("/api/state").json()
        assert state["tasks"][0]["task_id"] == t.task_id and state["status"]["sandbox"] == "local"
        assert client.post(f"/api/tasks/{t.task_id}/merge").status_code == 409  # not approved
        assert client.post(f"/api/tasks/{t.task_id}/reject", json={"comment": ""}).status_code == 422
        assert client.get("/api/tasks/task-999").status_code == 404
        assert "Swarm Board" in client.get("/").text


def test_websocket_snapshot_and_push(settings):
    app = create_app(settings)
    with TestClient(app) as client, client.websocket_connect("/ws") as ws:
        assert ws.receive_json()["type"] == "snapshot"
        app.state.swarm.board.create("#2", "new issue")
        seen = [ws.receive_json() for _ in range(3)]
        assert any(m["type"] == "task" and m["task"]["source_issue"] == "#2" for m in seen)
