"""The agents' network: four A2A servers, the clients they use to reach each other, and a log of every
message on the wire.

By default the servers run in-process (httpx talks to them over ASGI, no ports needed, which suits a
scheduled GitHub Actions run). `swarm agents` serves the same apps over real HTTP so any A2A client can
discover and message them.

Nothing here decides who works next. `pump` only starts work nobody is carrying yet: new issues, tasks a
person just sent back, and anything a previous run left mid-way. From then on the agents hand tasks to
each other themselves (BoardAgentExecutor → hand_off).
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import json
import logging
import os
import uuid
from collections import Counter
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Any, Callable

import httpx
from google.protobuf.json_format import MessageToDict
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route

from a2a.client import create_client
from a2a.client.client import ClientConfig
from a2a.helpers.proto_helpers import get_data_parts, get_text_parts, new_data_part
from a2a.server.request_handlers.default_request_handler_v2 import DefaultRequestHandlerV2
from a2a.server.routes.agent_card_routes import create_agent_card_routes
from a2a.server.routes.jsonrpc_routes import create_jsonrpc_routes
from a2a.server.tasks import InMemoryTaskStore, TaskUpdater
from a2a.types.a2a_pb2 import Message, Part, Role, SendMessageRequest, StreamResponse, TaskState

from ..board import Task
from ..board.models import TaskState as Col
from ..board.models import utcnow
from .cards import AGENTS, NEXT_SKILL, agent_card, card_json
from .executor import BoardAgentExecutor

if TYPE_CHECKING:
    from ..orchestrator import Swarm

log = logging.getLogger("swarm.a2a")
# the SDK warns when a queue closes after a task pauses for input; that is the normal end of a hand-off here
logging.getLogger("a2a.server.events.event_queue_v2").setLevel(logging.ERROR)
INTERNAL_URL = "http://swarm.agents"
Listener = Callable[[dict], None]
WIRE_LIMIT = 6000  # characters of raw JSON kept per logged event


def state_name(s: int) -> str:
    """TASK_STATE_INPUT_REQUIRED → input-required, as the A2A spec writes it."""
    return TaskState.Name(s).removeprefix("TASK_STATE_").lower().replace("_", "-")


def context_for(task_id: str) -> str:
    """One A2A conversation per board task, so every message about an issue shares a context."""
    return f"swarm-{task_id}"


KIND_WORDS = {"flaky-test": "test that fails at random", "bug": "bug", "feature": "feature request", "question": "question"}


def handoff_text(sender: str, t: Task) -> str:
    a = t.artifacts
    if t.state == Col.TRIAGED:
        kind = KIND_WORDS.get(t.kind, t.kind)
        return f"{t.task_id} ({t.source_issue}) is a {kind}, {t.priority} priority. Please write a fix."
    if t.state == Col.AWAITING_TESTS:
        return f"Patch ready for {t.task_id} ({a.get('strategy') or 'patch'}). Please verify it."
    if t.state == Col.IN_REVIEW:
        ev = a.get("test_summary", {}).get("harness", {}).get("evidence") or {}
        runs = "; ".join(f"{e['before'].get('failures')}/{e['before'].get('runs')} failing before, "
                         f"{e['after'].get('failures')}/{e['after'].get('runs')} after" for e in ev.values())
        return f"{t.task_id} passes its tests ({runs or 'verified'}). Please review it."
    if t.state == Col.REJECTED:
        return f"{t.task_id} needs another try: {t.note or 'see the board.'}"
    return f"{t.task_id} is {t.state.value}."


def intake_text(sender: str, t: Task) -> str:
    """The first message about a task this run, from whoever last touched it."""
    if t.state == Col.NEW:
        return f"New issue {t.source_issue}: {t.title}. Please triage it."
    if sender == "human":
        last = t.history[-1].action if t.history else ""
        return f"A maintainer sent {t.task_id} back: {t.note or last}".strip()
    return f"Resuming {t.task_id}, which a previous run left in {t.state.value}. " + handoff_text(sender, t)


class AgentNetwork:
    def __init__(self, swarm: "Swarm", base_url: str = INTERNAL_URL, delay: float = 0.0,
                 external: list[str] | None = None, external_transport: httpx.AsyncBaseTransport | None = None):
        self.swarm = swarm
        self.board = swarm.board
        self.base_url = base_url.rstrip("/")
        self.delay = delay
        self.cards = {name: agent_card(name, self.base_url) for name in AGENTS}
        self.agents = {a.name: a for a in swarm.agents}
        # other people's A2A agents asked for a second opinion on fixes waiting for a person
        self.external = external if external is not None else [
            u.strip() for u in os.environ.get("SWARM_SECOND_OPINION_AGENTS", "").split(",") if u.strip()]
        self.external_transport = external_transport
        self.cancelled: set[str] = set()
        self.sent = 0
        self._listeners: list[Listener] = []
        self._http: httpx.AsyncClient | None = None
        self._clients: dict[str, Any] = {}
        self._slots: dict[str, asyncio.Lock] = {}
        self._inflight: set[asyncio.Future] = set()
        self._carrying: Counter[str] = Counter()
        self._halt = False
        self.app: Starlette | None = None

    # -- exchange log -------------------------------------------------------------
    def on_exchange(self, fn: Listener) -> None:
        self._listeners.append(fn)

    def _emit(self, entry: dict) -> None:
        entry.setdefault("ts", utcnow())
        for fn in list(self._listeners):
            try:
                fn(entry)
            except Exception:  # a broken listener must never break the network
                log.debug("exchange listener failed", exc_info=True)

    # -- directory ----------------------------------------------------------------
    def find(self, skill: str) -> str | None:
        """The agent whose card offers `skill`. This is how agents discover each other."""
        for name, card in self.cards.items():
            if any(s.id == skill for s in card.skills):
                return name
        return None

    def directory(self) -> list[dict]:
        return [card_json(c) for c in self.cards.values()]

    def build_app(self) -> Starlette:
        routes: list[Any] = []
        for name, card in self.cards.items():
            handler = DefaultRequestHandlerV2(agent_executor=BoardAgentExecutor(self.agents[name], self),
                                              task_store=InMemoryTaskStore(), agent_card=card)
            routes.append(Mount(f"/agents/{name}", routes=create_jsonrpc_routes(handler, "/a2a") + create_agent_card_routes(card)))

        async def listing(request: Request):
            return JSONResponse({"agents": self.directory()})

        routes.append(Route("/agents", listing))
        return Starlette(routes=routes)

    # -- lifecycle ----------------------------------------------------------------
    @asynccontextmanager
    async def session(self, over_http: bool = False):
        """Bind the network to the running event loop. In-process by default; `over_http` when the apps are
        served for real (see serve)."""
        if not over_http or self.app is None:
            self.app = self.build_app()
        self._slots = {n: asyncio.Lock() for n in self.cards}
        self._inflight, self._carrying, self._clients, self._halt = set(), Counter(), {}, False
        transport = None if over_http else httpx.ASGITransport(app=self.app)
        async with httpx.AsyncClient(transport=transport, base_url=self.base_url, timeout=httpx.Timeout(600, connect=10)) as hc:
            self._http = hc
            try:
                yield self
            finally:
                self._halt = True
                if self._inflight:
                    await asyncio.gather(*self._inflight, return_exceptions=True)
                self._http = None

    def slot(self, name: str) -> asyncio.Lock:
        """Each agent works on one task at a time; different agents work in parallel."""
        return self._slots[name]

    async def _client(self, name: str):
        if name not in self._clients:
            self._clients[name] = await create_client(self.cards[name], client_config=ClientConfig(httpx_client=self._http, streaming=True))
        return self._clients[name]

    # -- messaging ----------------------------------------------------------------
    def dispatch(self, sender: str, recipient: str, t: Task, text: str, reference: str | None = None,
                 extra: dict | None = None) -> None:
        """Send `recipient` an A2A message about board task `t`, without waiting for the answer."""
        self._carrying[t.task_id] += 1
        job = asyncio.ensure_future(self._send(sender, recipient, t, text, reference, extra or {}))
        self._inflight.add(job)
        job.add_done_callback(self._inflight.discard)

    async def _send(self, sender: str, recipient: str, t: Task, text: str, reference: str | None, extra: dict) -> None:
        data = {"task_id": t.task_id, "from": sender, "state": t.state.value, **extra}
        msg = Message(message_id=uuid.uuid4().hex, context_id=context_for(t.task_id), role=Role.ROLE_USER,
                      parts=[Part(text=text), new_data_part(data)], reference_task_ids=[reference] if reference else [])
        msg.metadata.update({"from": sender, "to": recipient})
        base = {"from": sender, "to": recipient, "taskId": t.task_id, "context": msg.context_id}
        self.sent += 1
        self._emit({**base, "kind": "message", "text": text, "data": data, "reference": reference, "wire": wire(msg)})
        try:
            client = await self._client(recipient)
            back = {**base, "from": recipient, "to": sender}  # everything after the message is the recipient answering
            async for ev in client.send_message(SendMessageRequest(message=msg)):
                self._log(back, ev)
        except Exception as e:
            log.exception("message %s → %s about %s failed", sender, recipient, t.task_id)
            self._emit({**base, "kind": "error", "text": str(e)[:300]})
        finally:
            self._carrying[t.task_id] -= 1

    def _log(self, base: dict, ev: StreamResponse) -> None:
        what = ev.WhichOneof("payload")
        if what == "task":
            self._emit({**base, "kind": "task", "a2aTask": ev.task.id, "state": state_name(ev.task.status.state), "wire": wire(ev.task)})
        elif what == "status_update":
            u = ev.status_update
            texts = get_text_parts(u.status.message.parts) if u.status.HasField("message") else []
            ts = u.status.timestamp.ToDatetime().isoformat(timespec="seconds") + "+00:00" if u.status.HasField("timestamp") else None
            entry = {**base, "kind": "status", "a2aTask": u.task_id, "state": state_name(u.status.state),
                     "text": " ".join(texts)[:600], "wire": wire(u)}
            if ts:
                entry["ts"] = ts
            self._emit(entry)
        elif what == "artifact_update":
            a = ev.artifact_update
            data = next(iter(get_data_parts(a.artifact.parts)), None)
            self._emit({**base, "kind": "artifact", "a2aTask": a.task_id, "name": a.artifact.name,
                        "data": data if isinstance(data, dict) else None, "wire": wire(a)})
        elif what == "message":
            self._emit({**base, "kind": "reply", "text": " ".join(get_text_parts(ev.message.parts))[:600], "wire": wire(ev.message)})

    def hand_off(self, sender: str, t: Task, a2a_task: str | None) -> str | None:
        """Called by an agent that just finished: pass the task to whoever offers the skill it needs now."""
        if self._halt or (a2a_task and a2a_task in self.cancelled):
            return None
        skill = NEXT_SKILL.get(t.state)
        peer = self.find(skill) if skill else None
        if not peer:
            return None
        extra = {"feedback": t.note} if t.state == Col.REJECTED and t.note else {}
        self.dispatch(sender, peer, t, handoff_text(sender, t), reference=a2a_task, extra=extra)
        return peer

    def pump(self, seen: set) -> int:
        """Start work that nobody is carrying. `seen` stops a task that failed from being resent in the same run."""
        started = 0
        for t in self.board.list():
            skill = NEXT_SKILL.get(t.state)
            if not skill or self._carrying[t.task_id] > 0:
                continue
            key = (t.task_id, t.state, len(t.history))
            if key in seen:
                continue
            seen.add(key)
            sender = t.history[-1].agent if t.history and t.state != Col.NEW else "intake"
            sender = "intake" if sender == "system" else sender
            extra = {"feedback": t.note} if sender == "human" and t.note else {}
            self.dispatch(sender, self.find(skill), t, intake_text(sender, t), extra=extra)
            started += 1
        return started

    async def run_until_idle(self, max_messages: int = 400) -> int:
        """Start what's waiting, then let the agents pass work along until nobody has anything to do.
        Returns the number of A2A messages sent."""
        if self._http is None:
            async with self.session():
                return await self.run_until_idle(max_messages)
        start, seen = self.sent, set()
        while True:
            if not self._halt:
                self.pump(seen)
            if not self._inflight:
                break
            if self.sent - start > max_messages and not self._halt:
                log.warning("stopping after %d messages; the rest continues next run", max_messages)
                self._halt = True
            await asyncio.wait(set(self._inflight), return_when=asyncio.FIRST_COMPLETED)
        self._halt = False
        return self.sent - start

    def run_sync(self, max_messages: int = 400) -> int:
        """run_until_idle from ordinary code, including code that is itself inside an event loop."""
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(self.run_until_idle(max_messages))
        with concurrent.futures.ThreadPoolExecutor(1) as pool:
            return pool.submit(asyncio.run, self.run_until_idle(max_messages)).result()

    def serve(self, host: str, port: int, pump_every: float = 5.0) -> None:
        """Serve the four agents over HTTP, so any A2A client can discover and message them, and keep starting
        whatever is waiting on the board."""
        import uvicorn

        self.base_url = f"http://{'localhost' if host in ('0.0.0.0', '127.0.0.1') else host}:{port}"
        self.cards = {name: agent_card(name, self.base_url) for name in AGENTS}
        self.app = self.build_app()
        inner = self.app

        @asynccontextmanager
        async def lifespan(_app):
            async with self.session(over_http=True):
                async def keep_pumping():
                    seen: set = set()
                    while True:
                        self.pump(seen)
                        await asyncio.sleep(pump_every)
                job = asyncio.create_task(keep_pumping())
                yield
                job.cancel()

        outer = Starlette(routes=[Mount("/", app=inner)], lifespan=lifespan)
        log.warning("agents on %s/agents (cards at /agents/<name>/.well-known/agent-card.json)", self.base_url)
        uvicorn.run(outer, host=host, port=port, log_level="warning")

    # -- other people's agents ------------------------------------------------------
    async def second_opinions(self, t: Task, up: TaskUpdater) -> None:
        """Ask each configured outside A2A agent what it thinks of a fix before a person decides.
        Their answers are advice attached to the task; they never move it."""
        if not self.external or not t.artifacts.get("diff_text"):
            return
        opinions = []
        async with httpx.AsyncClient(transport=self.external_transport, timeout=httpx.Timeout(90, connect=10)) as hc:
            for url in self.external:
                op = await ask_external(hc, url, t)
                opinions.append(op)
                self._emit({"from": "reviewer", "to": op["agent"], "taskId": t.task_id, "context": context_for(t.task_id),
                            "kind": "external", "external": True, "url": url, "state": op["state"], "text": op["text"][:600]})
                await up.update_status(TaskState.TASK_STATE_WORKING,
                                       message=up.new_agent_message([Part(text=f"Second opinion from {op['agent']}: {op['verdict']}")]))
        self.board.update(t.task_id, "reviewer", f"asked {len(opinions)} outside agent(s) for a second opinion",
                          artifacts={"second_opinions": opinions})


async def ask_external(hc: httpx.AsyncClient, url: str, t: Task) -> dict:
    from a2a.client.card_resolver import A2ACardResolver

    out = {"url": url, "agent": url, "state": "failed", "verdict": "no answer", "text": "", "at": utcnow()}
    try:
        base, _, path = url.partition("/.well-known/")
        card = await A2ACardResolver(hc, base.rstrip("/"), f"/.well-known/{path}" if path else "/.well-known/agent-card.json").get_agent_card()
        out["agent"] = card.name or url
        client = await create_client(card, client_config=ClientConfig(httpx_client=hc, streaming=False))
        a = t.artifacts
        text = (f"Please review this fix for a test that fails at random. Reply with APPROVE or REJECT and a reason.\n\n"
                f"Issue {t.source_issue}: {t.title}\n\n{t.body[:1500]}\n\nRoot cause: {a.get('root_cause', '')}\n\n"
                f"```diff\n{a.get('diff_text', '')[:12000]}\n```")
        msg = Message(message_id=uuid.uuid4().hex, role=Role.ROLE_USER, parts=[Part(text=text)])
        replies: list[str] = []
        async for ev in client.send_message(SendMessageRequest(message=msg)):
            what = ev.WhichOneof("payload")
            if what == "message":
                replies += get_text_parts(ev.message.parts)
            elif what == "task":
                out["state"] = state_name(ev.task.status.state)
                for art in ev.task.artifacts:
                    replies += get_text_parts(art.parts)
                if ev.task.status.HasField("message"):
                    replies += get_text_parts(ev.task.status.message.parts)
            elif what == "status_update":
                out["state"] = state_name(ev.status_update.status.state)
                if ev.status_update.status.HasField("message"):
                    replies += get_text_parts(ev.status_update.status.message.parts)
            elif what == "artifact_update":
                replies += get_text_parts(ev.artifact_update.artifact.parts)
        body = "\n".join(r for r in replies if r).strip()
        out["text"] = body[:2000]
        head = body[:200].upper()
        out["verdict"] = "reject" if "REJECT" in head else "approve" if "APPROVE" in head else "comment"
        if out["state"] == "failed" and body:
            out["state"] = "completed"
    except Exception as e:  # an outside agent being down must never block the swarm
        out["text"] = f"could not reach it: {e}"[:300]
    return out


def wire(message) -> Any:
    """The event as it looks in JSON on the wire, trimmed for the log."""
    d = MessageToDict(message, preserving_proto_field_name=False)
    s = json.dumps(d, default=str)
    return d if len(s) <= WIRE_LIMIT else {"truncated": True, "json": s[:WIRE_LIMIT]}
