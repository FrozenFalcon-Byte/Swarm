"""FastAPI service: the board as a REST resource, live updates over a websocket,
human merge/approve/reject actions, and the dashboard UI."""

from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from .board import InvalidTransition, Task
from .config import Settings
from .orchestrator import Swarm

DASHBOARD = Path(__file__).parent / "dashboard" / "index.html"


class Comment(BaseModel):
    comment: str = ""


class Hub:
    """Fans board and activity events out to websocket clients from any thread."""

    def __init__(self) -> None:
        self.queues: set[asyncio.Queue] = set()
        self.loop: asyncio.AbstractEventLoop | None = None

    def publish(self, msg: dict) -> None:
        if not self.loop:
            return
        data = json.dumps(msg, default=str)
        for q in list(self.queues):
            self.loop.call_soon_threadsafe(q.put_nowait, data)


def create_app(settings: Settings | None = None) -> FastAPI:
    swarm = Swarm(settings)
    hub = Hub()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        hub.loop = asyncio.get_running_loop()

        async def status_pulse() -> None:  # agent busy/idle indicators
            last = None
            while True:
                st = swarm.status()
                if st != last:
                    hub.publish({"type": "status", "status": st})
                    last = st
                await asyncio.sleep(0.5)

        pulse = asyncio.create_task(status_pulse())
        yield
        pulse.cancel()
        swarm.stop_background()

    app = FastAPI(title="Codebase Maintenance Swarm", lifespan=lifespan)
    app.state.swarm = swarm

    def task_json(t: Task) -> dict:
        return json.loads(t.model_dump_json())

    swarm.board.subscribe(lambda event, t: hub.publish({"type": "task", "event": event, "task": task_json(t)}))
    swarm.on_activity(lambda e: hub.publish({"type": "activity", "entry": e}))

    @app.get("/", response_class=HTMLResponse)
    def index() -> str:
        return DASHBOARD.read_text()

    @app.get("/api/state")
    def state() -> dict:
        return {
            "tasks": swarm.board.export(),
            "status": swarm.status(),
            "tools": [r.model_dump() for r in swarm.registry.all()],
            "activity": list(swarm.activity),
        }

    @app.get("/api/tasks")
    def list_tasks() -> list[dict]:
        return swarm.board.export()

    @app.get("/api/tasks/{task_id}")
    def get_task(task_id: str) -> dict:
        try:
            return task_json(swarm.board.get(task_id))
        except KeyError:
            raise HTTPException(404, f"No task {task_id}")

    @app.get("/api/tools")
    def tools() -> list[dict]:
        return [r.model_dump() for r in swarm.registry.all()]

    @app.get("/api/tools/{tool_id}/code")
    def tool_code(tool_id: str) -> dict:
        rec = swarm.registry.get(tool_id)
        if not rec:
            raise HTTPException(404, f"No tool {tool_id}")
        return {"tool_id": tool_id, "code": Path(rec.code_path).read_text()}

    def act(fn, task_id: str, *args) -> dict:
        try:
            t = fn(task_id, *args)
        except KeyError:
            raise HTTPException(404, f"No task {task_id}")
        except (InvalidTransition, ValueError) as e:
            raise HTTPException(409, str(e))
        hub.publish({"type": "tools", "tools": [r.model_dump() for r in swarm.registry.all()]})
        return task_json(t)

    @app.post("/api/tasks/{task_id}/merge")
    def merge(task_id: str) -> dict:
        return act(swarm.merge, task_id)

    @app.post("/api/tasks/{task_id}/approve")
    def approve(task_id: str, body: Comment) -> dict:
        return act(swarm.approve, task_id, body.comment)

    @app.post("/api/tasks/{task_id}/reject")
    def reject(task_id: str, body: Comment) -> dict:
        if not body.comment.strip():
            raise HTTPException(422, "Say what should change so the coder can act on it")
        return act(swarm.reject, task_id, body.comment)

    @app.post("/api/tasks/{task_id}/reopen")
    def reopen(task_id: str, body: Comment) -> dict:
        return act(swarm.reopen, task_id, body.comment)

    @app.post("/api/tasks/{task_id}/close")
    def close(task_id: str, body: Comment) -> dict:
        return act(swarm.close, task_id, body.comment)

    @app.post("/api/run")
    def run() -> dict:
        created = swarm.ingest(swarm.load_issues())
        swarm.start_background()
        return {"ingested": created, "running": True}

    @app.post("/api/pause")
    def pause() -> dict:
        swarm.stop_background()
        return {"running": False}

    @app.websocket("/ws")
    async def ws(sock: WebSocket) -> None:
        await sock.accept()
        q: asyncio.Queue = asyncio.Queue()
        hub.queues.add(q)
        try:
            await sock.send_text(json.dumps({"type": "snapshot", **state()}, default=str))
            last_tools = None
            while True:
                msg = await q.get()
                await sock.send_text(msg)
                # tool registry changes ride along with task updates
                tools_now = [r.model_dump() for r in swarm.registry.all()]
                if tools_now != last_tools:
                    last_tools = tools_now
                    await sock.send_text(json.dumps({"type": "tools", "tools": tools_now}, default=str))
        except WebSocketDisconnect:
            pass
        finally:
            hub.queues.discard(q)

    return app
