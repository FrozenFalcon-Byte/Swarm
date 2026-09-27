"""One agent behind an A2A server.

A request names a board task ({"task_id": "task-004"}). The agent reads that task from the board, does its
job in a worker thread, and streams what it says as status updates. When it finishes it attaches its
result as an artifact, then hands the task to whichever peer offers the skill the task needs next. If
nobody can take it (a person has to decide) the A2A task ends as input-required.
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import TYPE_CHECKING, Any

from a2a.helpers.proto_helpers import get_data_parts, get_message_text, new_data_part, new_task_from_user_message
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.tasks import TaskUpdater
from a2a.types.a2a_pb2 import Part, TaskState

from ..agents.base import Agent
from ..board import Task
from ..board.models import TaskState as Col
from ..board.models import utcnow
from ..board.states import can_transition
from .cards import AGENTS, DONE, NEEDS_PERSON, NEXT_SKILL

if TYPE_CHECKING:
    from .network import AgentNetwork

log = logging.getLogger("swarm.a2a")
MAX_CRASHES = 2  # errors in a row on one card before it goes to a person
TASK_ID = re.compile(r"\btask-\d+\b")


def accepts(agent: str) -> set[Col]:
    """Board columns an agent works from: the ones whose next skill it offers."""
    mine = {s.id for s in AGENTS[agent]["skills"]}
    return {col for col, skill in NEXT_SKILL.items() if skill in mine}


def request_data(message) -> dict[str, Any]:
    for d in get_data_parts(message.parts):
        if isinstance(d, dict):
            return d
    return {}


def result_of(agent: str, t: Task) -> dict[str, Any]:
    """What an agent reports back: small enough to read on the wire, the full record stays on the board."""
    a = t.artifacts
    out: dict[str, Any] = {"task_id": t.task_id, "state": t.state.value, "attempts": t.attempts}
    if t.note:
        out["note"] = t.note[:400]
    if agent == "triager":
        out.update(kind=t.kind, priority=t.priority, labels=t.labels)
        if a.get("duplicate_of"):
            out["duplicate_of"] = a["duplicate_of"]
    elif agent == "coder":
        diff = a.get("diff_text") or ""
        out.update(strategy=a.get("strategy"), root_cause=(a.get("root_cause") or "")[:400],
                   files=sorted({ln[6:] for ln in diff.splitlines() if ln.startswith("+++ b/")}),
                   diff_lines=sum(1 for ln in diff.splitlines() if ln[:1] in "+-" and ln[:3] not in ("+++", "---")))
    elif agent == "tester":
        h = a.get("test_summary", {}).get("harness", {})
        out.update(harness=h.get("tool_id"), reused=h.get("reused"),
                   evidence={test: {"before": f"{e['before'].get('failures')}/{e['before'].get('runs')}",
                                    "after": f"{e['after'].get('failures')}/{e['after'].get('runs')}"}
                             for test, e in (h.get("evidence") or {}).items()})
    elif agent == "reviewer":
        r = a.get("review", {})
        out.update(sensitive=r.get("sensitive"), checks={c["name"]: c["ok"] for c in r.get("checks", [])})
    return out


def waiting_for(t: Task) -> str:
    if t.state == Col.APPROVED:
        return f"{t.task_id} is approved and waiting for a person to merge it."
    return f"{t.task_id} needs a person: {t.note or 'the agents were not sure how to proceed.'}"


class BoardAgentExecutor(AgentExecutor):
    def __init__(self, agent: Agent, network: "AgentNetwork"):
        self.agent = agent
        self.network = network
        self.accepts = accepts(agent.name)

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        msg = context.message
        task = context.current_task or new_task_from_user_message(msg)
        if not context.current_task:
            await event_queue.enqueue_event(task)
        up = TaskUpdater(event_queue, task.id, task.context_id)
        say = lambda text: up.new_agent_message([Part(text=text)])  # noqa: E731

        board_id = request_data(msg).get("task_id") or next(iter(TASK_ID.findall(get_message_text(msg))), "")
        try:
            card = self.network.board.get(board_id) if board_id else None
        except KeyError:
            card = None
        if card is None:
            await up.reject(say(f"I need a board task to work on, like {{\"task_id\": \"task-001\"}}; got {board_id or 'none'}."))
            return
        if card.state not in self.accepts:
            await up.reject(say(f"{card.task_id} is {card.state.value}; I work on "
                                f"{', '.join(sorted(c.value for c in self.accepts))}."))
            return

        async with self.network.slot(self.agent.name):
            # the board may have moved while this request waited for the agent to be free
            card = self.network.board.get(card.task_id)
            if card.state not in self.accepts:
                await up.reject(say(f"{card.task_id} moved to {card.state.value} before I got to it."))
                return
            await up.start_work(say(f"{self.agent.name} picked up {card.task_id}: {card.title}"))
            try:
                await self._handle(card, up)
            except Exception as e:  # the agent crashed: say so everywhere a person looks, then let go of the card
                log.exception("%s crashed on %s", self.agent.name, card.task_id)
                self._crashed(card, e)
                await up.failed(say(f"{self.agent.name} hit an error on {card.task_id}: {e}"))
                return
            if card.artifacts.get("last_error") or card.artifacts.get("crashes"):  # it went through this time
                self.network.board.update(card.task_id, self.agent.name, artifacts={"last_error": None, "crashes": 0})
            if self.network.delay:
                await asyncio.sleep(self.network.delay)

        after = self.network.board.get(card.task_id)
        if self.agent.name == "reviewer" and after.state in NEEDS_PERSON:
            await self.network.second_opinions(after, up)
            after = self.network.board.get(card.task_id)
        await up.add_artifact([new_data_part(result_of(self.agent.name, after))], name=f"{self.agent.name}-result")

        peer = self.network.hand_off(self.agent.name, after, task.id)
        if peer:
            await up.complete(say(f"{after.task_id} is {after.state.value}; handed to {peer}."))
        elif after.state in NEEDS_PERSON:
            await up.requires_input(say(waiting_for(after)))
        elif after.state in DONE:
            await up.complete(say(f"{after.task_id} is {after.state.value}. {after.note}".strip()))
        else:
            await up.complete(say(f"{after.task_id} is {after.state.value}."))

    def _crashed(self, card: Task, e: Exception) -> None:
        """The first time, the card stays in its column and gets one more go; until then it says what went
        wrong instead of "tester is on it", and the run reports the error. A second crash on the same card
        hands it to a person: trying again would only crash again, round and round."""
        swarm = self.network.swarm
        what = f"{type(e).__name__}: {e}".strip()[:300]
        swarm._record(self.agent.name, f"error: {what}", card.task_id)
        swarm.errors.append({"agent": self.agent.name, "task_id": card.task_id, "error": what})
        crashes = int(card.artifacts.get("crashes") or 0) + 1
        error = {"agent": self.agent.name, "error": what, "ts": utcnow()}
        board = self.network.board
        try:
            if crashes >= MAX_CRASHES and can_transition(card.state, Col.HUMAN_REVIEW):
                board.transition(card.task_id, Col.HUMAN_REVIEW, self.agent.name, f"stopped after {crashes} errors: {what}",
                                 note=f"The {self.agent.name} hit an error {crashes} times in a row, so the agents stopped "
                                      f"trying: {what}. Have a look, then send it back to the swarm.",
                                 assigned_agent=None, artifacts={"last_error": error, "crashes": 0})
            else:
                board.update(card.task_id, self.agent.name, f"hit an error: {what}", assigned_agent=None,
                             artifacts={"last_error": error, "crashes": crashes})
        except Exception:
            log.exception("couldn't note the error on %s", card.task_id)

    async def _handle(self, card: Task, up: TaskUpdater) -> None:
        """Run the agent's (blocking) handler in a thread and stream what it says as it says it."""
        loop = asyncio.get_running_loop()
        notes: asyncio.Queue[str] = asyncio.Queue()
        self.agent.tap = lambda text: loop.call_soon_threadsafe(notes.put_nowait, text)
        self.network.swarm.busy[self.agent.name] = True
        job = asyncio.ensure_future(asyncio.to_thread(self.agent.handle, card))
        try:
            while True:
                getter = asyncio.ensure_future(notes.get())
                done, _ = await asyncio.wait({job, getter}, return_when=asyncio.FIRST_COMPLETED)
                if getter in done:
                    await up.update_status(TaskState.TASK_STATE_WORKING, message=up.new_agent_message([Part(text=getter.result())]))
                else:
                    getter.cancel()
                if job.done() and notes.empty():
                    break
            job.result()
        finally:
            self.agent.tap = None
            self.network.swarm.busy[self.agent.name] = False

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        # an agent's step is short and writes the board as it goes; cancelling means "don't hand it on"
        if context.task_id:
            self.network.cancelled.add(context.task_id)
            up = TaskUpdater(event_queue, context.task_id, context.context_id or "")
            await up.cancel(up.new_agent_message([Part(text="Cancelled; the board keeps whatever was already done.")]))
