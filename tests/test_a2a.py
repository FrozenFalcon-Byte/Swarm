"""The agents as A2A services: discovery by skill, hand-offs on the wire, people in the loop, outside agents,
and the public gateway."""

import asyncio
import uuid

import httpx
from starlette.applications import Starlette

from a2a.client import create_client
from a2a.client.client import ClientConfig
from a2a.helpers.proto_helpers import new_task_from_user_message
from a2a.server.agent_execution import AgentExecutor
from a2a.server.request_handlers.default_request_handler_v2 import DefaultRequestHandlerV2
from a2a.server.routes.agent_card_routes import create_agent_card_routes
from a2a.server.routes.jsonrpc_routes import create_jsonrpc_routes
from a2a.server.tasks import InMemoryTaskStore, TaskUpdater
from a2a.types.a2a_pb2 import (AgentCapabilities, AgentCard, AgentInterface, Message, Part, Role, SendMessageRequest,
                               TaskState)

from swarm.a2a.cards import AGENTS, NEXT_SKILL, agent_card, card_json
from swarm.a2a.gateway import TokenGate, gateway_routes, pick_skill
from swarm.board import TaskState as Col
from swarm.orchestrator import Swarm


def test_every_column_has_an_agent_that_offers_its_skill(settings):
    swarm = Swarm(settings)
    for col, skill in NEXT_SKILL.items():
        assert swarm.network.find(skill), f"nobody works on {col.value}"
    card = card_json(agent_card("coder", "http://x"))
    assert card["supportedInterfaces"][0]["url"] == "http://x/agents/coder/a2a"
    assert card["capabilities"]["streaming"] is True
    assert {s["id"] for s in card["skills"]} == {"write_fix"}
    assert set(AGENTS) == {"triager", "coder", "tester", "reviewer"}


def test_agents_hand_work_to_each_other_over_a2a(settings, issues):
    swarm = Swarm(settings)
    swarm.ingest([i for i in issues if i.number in (102, 106)])  # a fixable failure and a question
    sent = swarm.run_until_idle()
    log = list(swarm.a2a_log)
    msgs = [(e["from"], e["to"]) for e in log if e["kind"] == "message"]
    assert sent == len(msgs)
    # the chain for the fixable issue, each hop sent by the agent that just finished
    fix = swarm.board.find_by_issue("#102")
    chain = [(e["from"], e["to"]) for e in log if e["kind"] == "message" and e["taskId"] == fix.task_id]
    assert chain == [("intake", "triager"), ("triager", "coder"), ("coder", "tester"), ("tester", "reviewer")]
    # one A2A conversation per board task, with each message pointing at the task it follows from
    wire = [e for e in log if e["kind"] == "message" and e["taskId"] == fix.task_id]
    assert {e["wire"]["contextId"] for e in wire} == {f"swarm-{fix.task_id}"}
    assert all(e["reference"] for e in wire[1:])
    # approved work waits for a person: the reviewer's task ends input-required
    assert fix.state == Col.APPROVED
    last = [e for e in log if e["taskId"] == fix.task_id and e["kind"] == "status"][-1]
    assert last["from"] == "reviewer" and last["state"] == "input-required"
    # results travel as artifacts
    art = next(e for e in log if e["kind"] == "artifact" and e["from"] == "tester" and e["taskId"] == fix.task_id)
    assert art["data"]["harness"] and art["data"]["state"] == "In Review"
    # the question is closed by the triager and nobody else hears about it
    q = swarm.board.find_by_issue("#106")
    assert q.state == Col.CLOSED
    assert [(e["from"], e["to"]) for e in log if e["kind"] == "message" and e["taskId"] == q.task_id] == [("intake", "triager")]
    assert not any(swarm.busy.values())


def test_a_persons_decision_reaches_the_coder_as_a_message(settings, issues):
    swarm = Swarm(settings)
    swarm.ingest([i for i in issues if i.number == 102])
    swarm.run_until_idle()
    t = swarm.board.find_by_issue("#102")
    swarm.reject(t.task_id, "keep the jitter but cap it at the base delay")
    swarm.a2a_log.clear()
    swarm.run_until_idle()
    first = next(e for e in swarm.a2a_log if e["kind"] == "message")
    assert (first["from"], first["to"]) == ("human", "coder")
    assert "cap it at the base delay" in first["data"]["feedback"]


def test_an_agent_refuses_work_that_is_not_in_its_column(settings, issues):
    swarm = Swarm(settings)
    t = swarm.board.create("#1", "something")

    async def ask():
        async with swarm.network.session():
            client = await swarm.network._client("reviewer")
            msg = Message(message_id=uuid.uuid4().hex, role=Role.ROLE_USER, parts=[Part(text=f"review {t.task_id}")])
            return [ev async for ev in client.send_message(SendMessageRequest(message=msg))]

    events = asyncio.run(ask())
    final = events[-1].status_update.status
    assert final.state == TaskState.TASK_STATE_REJECTED
    assert "New Issue" in final.message.parts[0].text
    assert swarm.board.get(t.task_id).state == Col.NEW


class Skeptic(AgentExecutor):
    """An outside reviewer that rejects everything."""

    async def execute(self, ctx, q):
        task = ctx.current_task or new_task_from_user_message(ctx.message)
        await q.enqueue_event(task)
        up = TaskUpdater(q, task.id, task.context_id)
        await up.complete(up.new_agent_message([Part(text="REJECT: this hides the symptom")]))

    async def cancel(self, ctx, q):
        pass


def outside_agent() -> httpx.ASGITransport:
    card = AgentCard(name="skeptic", description="second opinions", version="1",
                     supported_interfaces=[AgentInterface(url="http://outside.test/a2a", protocol_binding="JSONRPC")],
                     capabilities=AgentCapabilities(streaming=False), default_input_modes=["text/plain"],
                     default_output_modes=["text/plain"])
    handler = DefaultRequestHandlerV2(agent_executor=Skeptic(), task_store=InMemoryTaskStore(), agent_card=card)
    return httpx.ASGITransport(app=Starlette(routes=create_jsonrpc_routes(handler, "/a2a") + create_agent_card_routes(card)))


def test_reviewer_asks_outside_agents_for_a_second_opinion(settings, issues):
    swarm = Swarm(settings)
    swarm.network.external = ["http://outside.test"]
    swarm.network.external_transport = outside_agent()
    swarm.ingest([i for i in issues if i.number == 102])
    swarm.run_until_idle()
    t = swarm.board.find_by_issue("#102")
    (op,) = t.artifacts["second_opinions"]
    assert op["agent"] == "skeptic" and op["verdict"] == "reject" and "hides the symptom" in op["text"]
    assert t.state == Col.APPROVED  # advice only: a person still decides
    assert any(e["kind"] == "external" and e["to"] == "skeptic" for e in swarm.a2a_log)


def test_an_outside_agent_being_down_does_not_block_the_swarm(settings, issues):
    swarm = Swarm(settings)
    swarm.network.external = ["http://127.0.0.1:9"]
    swarm.ingest([i for i in issues if i.number == 102])
    swarm.run_until_idle()
    t = swarm.board.find_by_issue("#102")
    assert t.state == Col.APPROVED
    assert t.artifacts["second_opinions"][0]["text"].startswith("could not reach it")


# -- the public gateway -------------------------------------------------------------------------------


def test_gateway_understands_plain_requests():
    assert pick_skill({}, "what's on the board?") == "board_status"
    assert pick_skill({}, "show me task-004") == "task_details"
    assert pick_skill({}, "run the swarm on me/repo") == "fix_issues"
    assert pick_skill({"task_id": "task-1", "comment": "no"}, "") == "request_changes"
    assert pick_skill({"skill": "list_repos"}, "run") == "list_repos"


class FakeBoard:
    def __init__(self, tasks):
        self.tasks = tasks

    def list(self, state=None):
        return self.tasks


class FakeBackend:
    def __init__(self, uid, tasks):
        self.uid, self._tasks = uid, tasks

    def repos(self):
        return [{"id": "r1", "name": f"{self.uid}/repo"}]

    def board(self, repo):
        return FakeBoard(self._tasks)


class Tok:
    def __init__(self, subject):
        self.subject, self.client_id = subject, "laptop"


def gateway_app(settings, tasks):
    async def verify(token):
        return Tok("alice") if token == "swm_good" else None

    routes, card = gateway_routes("http://gw.test", lambda uid, name: FakeBackend(uid, tasks))
    return TokenGate(Starlette(routes=routes), verify), card


def test_gateway_needs_a_token_and_acts_as_its_owner(settings):
    swarm = Swarm(settings)
    t = swarm.board.create("#9", "a fix")
    app, card = gateway_app(settings, [t])

    async def go():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://gw.test") as hc:
            assert (await hc.get("/.well-known/agent-card.json")).json()["name"] == "Swarm"
            denied = await hc.post("/a2a", json={"jsonrpc": "2.0", "id": 1, "method": "SendMessage", "params": {}})
            assert denied.status_code == 401
        async with httpx.AsyncClient(transport=transport, base_url="http://gw.test",
                                     headers={"Authorization": "Bearer swm_good"}) as hc:
            client = await create_client(card, client_config=ClientConfig(httpx_client=hc, streaming=True))
            out = []
            for text in ("which repos?", "what's on the board?"):
                msg = Message(message_id=uuid.uuid4().hex, role=Role.ROLE_USER, parts=[Part(text=text)])
                out.append([ev async for ev in client.send_message(SendMessageRequest(message=msg))])
            return out

    repos, board = asyncio.run(go())
    assert "alice/repo" in repos[-1].status_update.status.message.parts[0].text
    final = board[-1].status_update.status
    assert final.state == TaskState.TASK_STATE_COMPLETED
    assert final.message.parts[0].text.startswith("1 tasks")
