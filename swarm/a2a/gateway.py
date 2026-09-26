"""The public face of the swarm for other agents: one A2A agent, "Swarm", served by `swarm server`.

  GET  /.well-known/agent-card.json   what Swarm can do (public)
  POST /a2a                           JSON-RPC: message/send, message/stream, tasks/get, tasks/cancel,
                                      push notification configs. Needs `Authorization: Bearer swm_…`.

Another agent (or an A2A client) can ask for the board, look at a task, start the swarm on new issues
and follow along as the agents hand the work to each other, or send a fix back with feedback. Like the
MCP server it can never approve or merge: when a run ends with work waiting for a person, the task ends
as input-required and says what is waiting.

A token acts as the person who made it and only sees their repositories.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from typing import Any, Callable

from starlette.requests import Request
from starlette.responses import JSONResponse

from a2a.auth.user import User
from a2a.helpers.proto_helpers import get_message_text, new_data_part, new_task_from_user_message
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.context import ServerCallContext
from a2a.server.events import EventQueue
from a2a.server.request_handlers.default_request_handler_v2 import DefaultRequestHandlerV2
from a2a.server.routes.agent_card_routes import create_agent_card_routes
from a2a.server.routes.common import DefaultServerCallContextBuilder
from a2a.server.routes.jsonrpc_routes import create_jsonrpc_routes
from a2a.server.tasks import (BasePushNotificationSender, InMemoryPushNotificationConfigStore, InMemoryTaskStore,
                              TaskUpdater)
from a2a.types.a2a_pb2 import (AgentCapabilities, AgentCard, AgentInterface, AgentProvider, AgentSkill, Part,
                               SecurityRequirement, StringList, TaskState)

from ..board import TaskState as Col
from .cards import BEARER, DATA, VERSION
from .executor import TASK_ID, request_data

log = logging.getLogger("swarm.gateway")
RUN_TIMEOUT_S = 15 * 60
POLL_S = 3.0

SKILLS = [
    AgentSkill(id="board_status", name="Board status", tags=["board", "status"],
               description="How many tasks are in each column of a repository's board, and which ones wait for a person.",
               examples=["What's on the board?", '{"skill": "board_status", "repo": "owner/name"}']),
    AgentSkill(id="task_details", name="Task details", tags=["task", "diff", "evidence"],
               description="One task in full: the issue, the patch, before/after test runs, the review and its history.",
               examples=["Show me task-004", '{"skill": "task_details", "task_id": "task-004"}']),
    AgentSkill(id="fix_issues", name="Fix new issues", tags=["run", "agents", "streaming"],
               description="Pick up new GitHub issues and let the triager, coder, tester and reviewer work until they're "
                           "done, streaming each hand-off between them. Ends input-required when fixes wait for a person.",
               examples=["Run the swarm on owner/name", '{"skill": "fix_issues", "repo": "owner/name"}']),
    AgentSkill(id="request_changes", name="Send a fix back", tags=["feedback", "coder"],
               description="Send a task's patch back to the coder with feedback. Merging stays a click in the dashboard.",
               examples=['{"skill": "request_changes", "task_id": "task-004", "comment": "Keep the public API unchanged"}']),
    AgentSkill(id="list_repos", name="List repositories", tags=["repos"],
               description="The repositories this token can see.", examples=["Which repos do you work on?"]),
]


def gateway_card(public_url: str) -> AgentCard:
    card = AgentCard(
        name="Swarm", version=VERSION,
        description="Four agents (triager, coder, tester, reviewer) that fix tests failing at random in your GitHub "
                    "repositories, talking to each other over A2A. Merging always stays with a person.",
        supported_interfaces=[AgentInterface(url=f"{public_url}/a2a", protocol_binding="JSONRPC")],
        provider=AgentProvider(organization="Swarm", url=public_url),
        documentation_url=f"{public_url}/healthz",
        capabilities=AgentCapabilities(streaming=True, push_notifications=True),
        default_input_modes=[DATA, "text/plain"], default_output_modes=[DATA, "text/plain"],
        skills=SKILLS,
    )
    card.security_schemes["bearer"].CopyFrom(BEARER)
    card.security_requirements.append(SecurityRequirement(schemes={"bearer": StringList()}))
    return card


def pick_skill(data: dict, text: str) -> str:
    """Structured requests name the skill; plain-language ones are matched on a few words."""
    if data.get("skill") in {s.id for s in SKILLS}:
        return data["skill"]
    t = text.lower()
    if data.get("comment") or re.search(r"\b(send (it )?back|request changes|reject)\b", t):
        return "request_changes"
    if data.get("task_id") or TASK_ID.search(t):
        return "task_details"
    if re.search(r"\b(run|fix|start|work on|go)\b", t):
        return "fix_issues"
    if re.search(r"\b(repos|repositories)\b", t):
        return "list_repos"
    return "board_status"


class SwarmUser(User):
    def __init__(self, uid: str, token_name: str):
        self.uid, self.token_name = uid, token_name

    @property
    def is_authenticated(self) -> bool:
        return True

    @property
    def user_name(self) -> str:  # the task store keeps each user's tasks apart by this
        return self.uid


class TokenContextBuilder(DefaultServerCallContextBuilder):
    """Carries the user that TokenGate verified into the A2A call."""

    def build(self, request: Request) -> ServerCallContext:
        ctx = super().build(request)
        headers = ctx.state.get("headers") or {}
        ctx.state["headers"] = {k: v for k, v in headers.items() if k.lower() != "authorization"}  # don't keep the token around
        who = request.scope.get("swarm_user")
        if who:
            ctx.user = SwarmUser(*who)
        return ctx


class TokenGate:
    """ASGI middleware: POST /a2a needs a valid Swarm access token; everything else passes through."""

    def __init__(self, app, verify: Callable[[str], Any], path: str = "/a2a"):
        self.app, self.verify, self.path = app, verify, path

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"].rstrip("/") == self.path and scope["method"] == "POST":
            header = dict(scope["headers"]).get(b"authorization", b"").decode()
            tok = await self.verify(header[7:].strip()) if header.lower().startswith("bearer ") else None
            if not tok:
                res = JSONResponse({"jsonrpc": "2.0", "id": None, "error": {
                    "code": -32001, "message": "Swarm needs an access token: Authorization: Bearer swm_… (make one in the dashboard)."}},
                    status_code=401, headers={"WWW-Authenticate": 'Bearer realm="swarm"'})
                return await res(scope, receive, send)
            scope = {**scope, "swarm_user": (tok.subject, tok.client_id)}
        return await self.app(scope, receive, send)


class GatewayExecutor(AgentExecutor):
    def __init__(self, backend_for: Callable[[str, str], Any]):
        self.backend_for = backend_for  # (uid, token name) → CloudBackend acting as that person
        self.cancelled: set[str] = set()

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        msg = context.message
        task = context.current_task or new_task_from_user_message(msg)
        if not context.current_task:
            await event_queue.enqueue_event(task)
        up = TaskUpdater(event_queue, task.id, task.context_id)
        say = lambda text: up.new_agent_message([Part(text=text)])  # noqa: E731
        user = context.call_context.user
        if not isinstance(user, SwarmUser):
            await up.requires_auth(say("Send an access token: Authorization: Bearer swm_…"))
            return
        backend = self.backend_for(user.uid, user.token_name)
        data, text = request_data(msg), get_message_text(msg)
        skill = pick_skill(data, text)
        repo = data.get("repo") or _repo_in(text)
        try:
            await up.start_work(say(f"Swarm: {skill.replace('_', ' ')}"))
            if skill == "list_repos":
                repos = await asyncio.to_thread(backend.repos)
                await up.add_artifact([new_data_part({"repos": repos})], name="repos")
                await up.complete(say(", ".join(r["name"] for r in repos) or "No repositories connected yet."))
            elif skill == "board_status":
                summary = await asyncio.to_thread(_summary, backend, repo)
                await up.add_artifact([new_data_part(summary)], name="board")
                await up.complete(say(_summary_text(summary)))
            elif skill == "task_details":
                from ..mcp_server import task_detail

                task_id = data.get("task_id") or next(iter(TASK_ID.findall(text)), "")
                t = await asyncio.to_thread(lambda: backend.board(repo).get(task_id))
                await up.add_artifact([new_data_part(task_detail(t))], name=task_id)
                await up.complete(say(f"{t.task_id} ({t.source_issue}) is {t.state.value}: {t.title}"))
            elif skill == "request_changes":
                task_id = data.get("task_id") or next(iter(TASK_ID.findall(text)), "")
                comment = (data.get("comment") or text).strip()
                if not task_id or not comment:
                    await up.reject(say('Say which task and what should change: {"task_id": "task-004", "comment": "…"}'))
                    return
                result = await asyncio.to_thread(backend.request_changes, repo, task_id, comment)
                await up.complete(say(result))
            else:
                await self._fix(backend, repo, task.id, up, say)
        except (KeyError, ValueError, PermissionError) as e:
            await up.reject(say(str(e).strip("'\"")))
        except Exception as e:
            log.exception("gateway %s failed", skill)
            await up.failed(say(f"Swarm hit an error: {e}"))

    async def _fix(self, backend, repo: str | None, a2a_task: str, up: TaskUpdater, say) -> None:
        """Queue a run and relay the agents' own A2A traffic until it finishes."""
        from google.cloud import firestore as gfs

        repo_id, run = await asyncio.to_thread(backend.queue_run, repo, "a2a")
        await up.update_status(TaskState.TASK_STATE_WORKING, message=say("Queued. Waiting for the worker to pick it up."))
        traffic = backend.db.collection("repos").document(repo_id).collection("a2a")
        since = await asyncio.to_thread(lambda: (run.get().to_dict() or {}).get("createdAt"))
        deadline, last_status = time.monotonic() + RUN_TIMEOUT_S, "queued"
        while time.monotonic() < deadline:
            if a2a_task in self.cancelled:
                return
            snap = await asyncio.to_thread(run.get)
            status = (snap.to_dict() or {}).get("status", "queued")
            if status != last_status:
                last_status = status
                await up.update_status(TaskState.TASK_STATE_WORKING, message=say(f"Run is {status}."))
            q = traffic.where(filter=gfs.FieldFilter("kind", "==", "message"))
            if since is not None:
                q = q.where(filter=gfs.FieldFilter("createdAt", ">", since))
            fresh = await asyncio.to_thread(lambda: [d.to_dict() for d in q.order_by("createdAt").limit(50).stream()])
            for e in fresh:
                since = e.get("createdAt") or since
                await up.update_status(TaskState.TASK_STATE_WORKING, message=up.new_agent_message(
                    [Part(text=f"{e.get('from')} → {e.get('to')}: {e.get('text', '')}"),
                     new_data_part({k: e.get(k) for k in ("from", "to", "taskId", "text", "ts")})]))
            if status in ("done", "failed"):
                break
            await asyncio.sleep(POLL_S)
        else:
            await up.complete(say("Still running after 15 minutes; ask for board_status later."))
            return
        if last_status == "failed":
            await up.failed(say(f"The run failed: {(snap.to_dict() or {}).get('error', 'unknown error')}"))
            return
        summary = await asyncio.to_thread(_summary, backend, repo_id)
        await up.add_artifact([new_data_part({"run": (snap.to_dict() or {}).get("summary"), **summary})], name="run")
        if summary["waiting_for_you"]:
            await up.requires_input(say(_summary_text(summary) + " Merge or approve them in the dashboard, or reply with "
                                        '{"skill": "request_changes", "task_id": …, "comment": …} to send one back.'))
        else:
            await up.complete(say(_summary_text(summary)))

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        if context.task_id:
            self.cancelled.add(context.task_id)
            up = TaskUpdater(event_queue, context.task_id, context.context_id or "")
            await up.cancel(up.new_agent_message([Part(text="Stopped following the run; the agents finish what they started.")]))


def _repo_in(text: str) -> str | None:
    m = re.search(r"\b([\w.-]+/[\w.-]+)\b", text)
    return m.group(1) if m else None


def _summary(backend, repo: str | None) -> dict:
    from ..mcp_server import NEEDS_YOU, task_summary

    tasks = backend.board(repo).list()
    counts: dict[str, int] = {}
    for t in tasks:
        counts[t.state.value] = counts.get(t.state.value, 0) + 1
    return {"total": len(tasks), "counts": counts, "waiting_for_you": [task_summary(t) for t in tasks if t.state in NEEDS_YOU]}


def _summary_text(s: dict) -> str:
    wait = s["waiting_for_you"]
    merged = s["counts"].get(Col.MERGED.value, 0)
    head = f"{s['total']} tasks, {merged} merged."
    if not wait:
        return head + " Nothing is waiting for you."
    return head + f" {len(wait)} waiting for you: " + ", ".join(f"{w['task_id']} ({w['state']})" for w in wait[:6]) + "."


def gateway_routes(public_url: str, backend_for: Callable[[str, str], Any]) -> tuple[list, AgentCard]:
    import httpx

    from a2a.utils.push_url_validator import validate_push_notification_url

    card = gateway_card(public_url)
    push_store = InMemoryPushNotificationConfigStore()
    handler = DefaultRequestHandlerV2(
        agent_executor=GatewayExecutor(backend_for), task_store=InMemoryTaskStore(), agent_card=card,
        push_config_store=push_store,
        push_sender=BasePushNotificationSender(httpx.AsyncClient(timeout=10), push_store,
                                               push_url_validator=validate_push_notification_url),
        push_url_validator=validate_push_notification_url)
    return create_jsonrpc_routes(handler, "/a2a", context_builder=TokenContextBuilder()) + create_agent_card_routes(card), card
