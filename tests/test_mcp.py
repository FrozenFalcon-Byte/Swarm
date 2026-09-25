"""The MCP server over the local board: reads, feedback, and no way to merge."""

import asyncio
import json

import pytest

pytest.importorskip("mcp")

from swarm.mcp_server import build  # noqa: E402
from swarm.orchestrator import Swarm  # noqa: E402


def call(server, name, args=None):
    result = asyncio.run(server.call_tool(name, args or {}))
    texts = [getattr(b, "text", "") for b in result.content]
    if result.is_error:
        raise RuntimeError("".join(texts))
    try:
        parsed = [json.loads(t) for t in texts]
    except ValueError:
        return "".join(texts)
    return parsed[0] if len(parsed) == 1 else parsed  # a list result arrives as one block per item


def test_mcp_reads_the_board_and_sends_feedback(settings, issues):
    swarm = Swarm(settings)
    swarm.ingest(issues)
    swarm.run_until_idle()
    server = build(settings)

    names = {t.name for t in asyncio.run(server.list_tools())}
    assert {"board_summary", "get_task", "search_harnesses", "run_swarm", "request_changes"} <= names
    assert not any("merge" in n or "approve" in n for n in names)  # merging stays a human click

    summary = call(server, "board_summary")
    assert summary["counts"]["Approved"] == 2 and len(summary["waiting_for_you"]) == 5

    task = call(server, "get_task", {"task_id": "task-001"})
    assert task["state"] == "Approved" and task["diff"] and task["evidence"]

    hits = call(server, "search_harnesses", {"query": "hash seed set ordering"})
    hits = hits if isinstance(hits, list) else [hits]
    assert hits[0]["tool_id"] == "hashseed_sweep_v1"

    assert "sent back" in call(server, "request_changes", {"task_id": "task-001", "comment": "sort in the caller"})
    assert Swarm(settings).board.get("task-001").state.value == "Rejected"

    with pytest.raises(Exception, match="not a valid transition"):
        call(server, "request_changes", {"task_id": "task-006", "comment": "again"})
