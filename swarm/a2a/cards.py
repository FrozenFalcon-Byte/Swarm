"""Agent cards: how each agent describes itself to the others (and to anyone who asks).

A card lists an agent's skills. Agents never hard-code who comes next: after finishing, an agent looks
up which peer offers the skill the task needs now (see NEXT_SKILL) and sends that peer a message.
"""

from __future__ import annotations

from google.protobuf.json_format import MessageToDict

from a2a.types.a2a_pb2 import (AgentCapabilities, AgentCard, AgentInterface, AgentProvider, AgentSkill,
                               HTTPAuthSecurityScheme, SecurityRequirement, SecurityScheme, StringList)

from ..board import TaskState

VERSION = "1.0.0"
DATA = "application/json"


def _skill(id: str, name: str, description: str, tags: list[str], examples: list[str]) -> AgentSkill:
    return AgentSkill(id=id, name=name, description=description, tags=tags, examples=examples,
                      input_modes=[DATA, "text/plain"], output_modes=[DATA, "text/plain"])


AGENTS: dict[str, dict] = {
    "triager": {
        "title": "Triager",
        "description": "Reads new GitHub issues, decides what kind and how urgent they are, spots duplicates, "
                       "and sends anything unclear to a person instead of guessing.",
        "skills": [_skill("triage_issue", "Triage an issue",
                          "Classify an issue (bug, intermittent test failure, feature, question), set its priority and "
                          "find duplicates. Sends fixable work on to an agent with the write_fix skill.",
                          ["triage", "classification", "duplicates"], ['{"task_id": "task-004"}'])],
    },
    "coder": {
        "title": "Coder",
        "description": "Finds the code behind a failing test and writes the smallest change that removes the cause.",
        "skills": [_skill("write_fix", "Write a fix",
                          "Locate the cause of a failing test and write a patch. Takes feedback from the tester, the "
                          "reviewer or a person and tries again, up to a limit.",
                          ["code", "patch", "fix"], ['{"task_id": "task-004"}', '{"task_id": "task-004", "feedback": "…"}'])],
    },
    "tester": {
        "title": "Tester",
        "description": "Proves a fix works by running the test many times before and after it in a sealed sandbox.",
        "skills": [_skill("verify_fix", "Verify a fix",
                          "Write or reuse a harness, run the failing test repeatedly with and without the patch, and "
                          "report the evidence. Failed fixes go back with the failure as feedback.",
                          ["testing", "sandbox", "evidence"], ['{"task_id": "task-004"}'])],
    },
    "reviewer": {
        "title": "Reviewer",
        "description": "Checks a tested fix without seeing the coder's reasoning, and looks for reasons to say no.",
        "skills": [_skill("review_fix", "Review a fix",
                          "Check the patch for shortcuts, scope and sensitive code. Approves it for a person to merge, "
                          "sends it back, or asks a person when it touches security.",
                          ["review", "security", "quality"], ['{"task_id": "task-004"}'])],
    },
}

# Which skill a task needs next, given its board column. Columns not listed need a person or are done.
NEXT_SKILL: dict[TaskState, str] = {
    TaskState.NEW: "triage_issue",
    TaskState.TRIAGED: "write_fix",
    TaskState.REJECTED: "write_fix",
    TaskState.AWAITING_TESTS: "verify_fix",
    TaskState.IN_REVIEW: "review_fix",
}
NEEDS_PERSON = {TaskState.APPROVED, TaskState.HUMAN_REVIEW}
DONE = {TaskState.MERGED, TaskState.CLOSED}

BEARER = SecurityScheme(http_auth_security_scheme=HTTPAuthSecurityScheme(
    scheme="bearer", bearer_format="swm_ access token",
    description="A personal access token made in the Swarm dashboard (Settings → Access tokens)."))


def agent_card(name: str, base_url: str, secured: bool = False) -> AgentCard:
    a = AGENTS[name]
    card = AgentCard(
        name=name, description=a["description"], version=VERSION,
        supported_interfaces=[AgentInterface(url=f"{base_url.rstrip('/')}/agents/{name}/a2a", protocol_binding="JSONRPC")],
        provider=AgentProvider(organization="Swarm", url=base_url),
        capabilities=AgentCapabilities(streaming=True, push_notifications=False),
        default_input_modes=[DATA, "text/plain"], default_output_modes=[DATA, "text/plain"],
        skills=a["skills"],
    )
    if secured:
        card.security_schemes["bearer"].CopyFrom(BEARER)
        card.security_requirements.append(SecurityRequirement(schemes={"bearer": StringList()}))
    return card


def card_json(card: AgentCard) -> dict:
    return MessageToDict(card, preserving_proto_field_name=False)
