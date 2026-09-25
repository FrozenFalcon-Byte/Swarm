"""End-to-end: the demo issues through every agent, tool reuse, and the human merge gate."""

import subprocess
import sys

from swarm.board import TaskState
from swarm.orchestrator import Swarm


def test_full_pipeline(settings, issues):
    swarm = Swarm(settings)
    swarm.ingest(issues)
    swarm.run_until_idle()
    by_issue = {t.source_issue: t for t in swarm.board.list()}

    tags, retry, auth = by_issue["#101"], by_issue["#102"], by_issue["#103"]
    assert tags.state == TaskState.APPROVED  # approved, never auto-merged
    assert retry.state == TaskState.APPROVED
    assert retry.artifacts["strategy"] == "bound-jitter"
    # auth code: all checks pass, but a human must approve
    assert auth.state == TaskState.HUMAN_REVIEW and auth.artifacts["review"]["sensitive"]

    tools = {r.tool_id: r for r in swarm.registry.all()}
    assert set(tools) == {"hashseed_sweep_v1", "repeat_run_v1"}
    assert all(r.validated for r in tools.values())
    assert tools["hashseed_sweep_v1"].used_by_tasks == [tags.task_id, auth.task_id]  # reused, not rewritten

    evidence = tags.artifacts["test_summary"]["harness"]["evidence"]
    (only,) = evidence.values()
    assert only["before"]["failures"] > 0 and only["after"]["failures"] == 0

    # Human gate: approve the auth fix, merge all three, and the flaky tests are stable.
    swarm.approve(auth.task_id, "scopes change reviewed")
    for t in (tags, retry, auth):
        assert swarm.merge(t.task_id).state == TaskState.MERGED
    for seed in range(6):
        proc = subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider",
                               "tests/test_tags.py", "tests/test_retry.py", "tests/test_auth.py"],
                              cwd=settings.repo_path, capture_output=True, text=True,
                              env={"PYTHONHASHSEED": str(seed), "PYTHONPATH": str(settings.repo_path)})
        assert proc.returncode == 0, proc.stdout
