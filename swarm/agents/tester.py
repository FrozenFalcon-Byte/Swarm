"""Tester: runs the patch in the sandbox and, when the existing suite can't prove
the fix (a flaky test passing once proves nothing), writes a harness that can,
validates it against old and new code, and registers it for reuse."""

from __future__ import annotations

import json
import re
from pathlib import Path

from ..board import Task, TaskState
from ..registry import ToolRecord, ToolRegistry
from ..sandbox import Sandbox
from ..toolgen import spec_for, write_tool
from .base import Agent
from .coder import _digest

RERUNS = 8
OPEN_STATES = {TaskState.NEW, TaskState.TRIAGED, TaskState.IN_PROGRESS, TaskState.AWAITING_TESTS, TaskState.IN_REVIEW,
               TaskState.REJECTED, TaskState.APPROVED, TaskState.HUMAN_REVIEW}


class TesterAgent(Agent):
    name = "tester"
    consumes = TaskState.AWAITING_TESTS

    def __init__(self, *args, registry: ToolRegistry | None = None, sandbox: Sandbox | None = None, **kw):
        super().__init__(*args, **kw)
        self.registry = registry or ToolRegistry(self.settings.tools_dir, self.settings.use_embeddings)
        self.sandbox = sandbox or Sandbox(self.settings)

    def handle(self, task: Task) -> None:
        self.board.update(task.task_id, self.name, assigned_agent=self.name)
        diff = task.artifacts.get("diff_text", "")
        test_ids: list[str] = task.artifacts.get("test_ids", [])
        results: dict = {"sandbox": self.sandbox.backend}

        # 1. Full suite, patched vs. baseline, so pre-existing failures aren't blamed on this patch.
        with self.sandbox.workspace(diff) as work:
            patched = self.sandbox.run_pytest(work)
        with self.sandbox.workspace() as work:
            baseline = self.sandbox.run_pytest(work)
        results["suite_patched"] = patched.as_dict()
        results["suite_baseline"] = baseline.as_dict()

        tracked = self._tests_tracked_elsewhere(task)
        suspects = [f for f in patched.failures if f not in baseline.failures and f not in tracked and f not in test_ids]
        # One red run of a test that was green on main is not proof: it may be flaky on its own.
        regressions, rerun_notes = [], {}
        for test in suspects:
            base_fail = self._rerun(test, diff=None)
            new_fail = self._rerun(test, diff=diff)
            rerun_notes[test] = {"baseline_failures": base_fail, "patched_failures": new_fail, "runs": RERUNS}
            if new_fail > 0 and base_fail == 0:
                regressions.append(test)
        results["regression_reruns"] = rerun_notes
        targets_failing = [f for f in patched.failures if f in test_ids]
        results["regressions"] = regressions
        results["preexisting_failures"] = [f for f in patched.failures if f not in regressions and f not in test_ids]

        if patched.total == 0:
            return self._reject(task, results, "Test suite did not run (collection error?)\n" + patched.output_tail)
        if targets_failing:
            return self._reject(task, results, f"Target test still fails with the patch: {', '.join(targets_failing)}")
        if regressions:
            return self._reject(task, results, f"Patch breaks tests that pass on main: {', '.join(regressions)}")

        # 2. Flakiness evidence: a single green run proves nothing, so use a repeat-run harness.
        source = task.artifacts.get("flakiness_source", "unknown")
        tool, reused = self._get_or_write_tool(task, source, test_ids)
        evidence = {}
        for test in test_ids:
            before = self._run_tool(tool, test, diff=None)
            after = self._run_tool(tool, test, diff=diff)
            evidence[test] = {"before": before, "after": after}
        results["harness"] = {"tool_id": tool.tool_id, "reused": reused, "evidence": evidence}
        if reused:  # a new tool's first use is counted at registration
            self.registry.record_use(tool.tool_id, task.task_id)

        still_flaky = {t: e["after"] for t, e in evidence.items() if e["after"].get("failures", 1) > 0}
        results_path = self.settings.results_dir / f"{task.task_id}.h{len(task.history)}.json"
        results_path.write_text(json.dumps(results, indent=2))
        tools_used = sorted(set(task.artifacts.get("tools_used", [])) | {tool.tool_id})
        if still_flaky:
            detail = "; ".join(f"{t}: {e.get('failures')}/{e.get('runs')} runs failed ({', '.join(e.get('failing', [])[:4])})"
                               for t, e in still_flaky.items())
            return self._reject(task, results, f"Still flaky under {tool.tool_id}: {detail}",
                                results_path=results_path, tools_used=tools_used)

        summary = ", ".join(f"{e['before'].get('failures')}/{e['before'].get('runs')} → {e['after'].get('failures')}/{e['after'].get('runs')} failing"
                            for e in evidence.values())
        self.board.transition(task.task_id, TaskState.IN_REVIEW, self.name,
                              f"tests pass ({patched.passed}/{patched.total}); {tool.tool_id}: {summary}",
                              assigned_agent=None,
                              artifacts={"test_results": str(results_path), "test_summary": results, "tools_used": tools_used})
        self.say(f"patch verified with {tool.tool_id} ({summary})", task)

    # -- helpers -----------------------------------------------------------
    def _rerun(self, test: str, diff: str | None) -> int:
        """Failures of `test` over RERUNS fresh runs with varied hash seeds."""
        fails = 0
        with self.sandbox.workspace(diff) as work:
            for i in range(RERUNS):
                rep = self.sandbox.run_pytest(work, test, env={"PYTHONHASHSEED": str(1000 + i)})
                fails += 0 if rep.ok else 1
        return fails

    def _tests_tracked_elsewhere(self, task: Task) -> set[str]:
        """Tests other open tasks already track as flaky: known failures, not regressions."""
        out: set[str] = set()
        for t in self.board.list():
            if t.task_id != task.task_id and t.state in OPEN_STATES and t.kind in ("flaky-test", "unknown"):
                out.update(t.artifacts.get("test_ids", []))
                for name in _test_names(f"{t.title} {t.body}"):
                    out.update(f for f in self._all_test_ids() if f.endswith("::" + name))
        return out

    def _all_test_ids(self) -> list[str]:
        from ..retrieval import RepoIndex

        idx = RepoIndex(self.settings.repo_path)
        return [f"{s.path}::{s.name}" for s in idx.symbols if idx.is_test_path(s.path) and s.name.startswith("test_")]

    def _get_or_write_tool(self, task: Task, source: str, test_ids: list[str]) -> tuple[ToolRecord, bool]:
        spec = spec_for(source)
        hits = self.registry.search(f"{spec.description} {' '.join(spec.tags)}")
        if hits:
            tool, score = hits[0]
            self.say(f"reusing registered tool {tool.tool_id} (match {score})", task)
            self.board.update(task.task_id, self.name, f"reused tool {tool.tool_id} from {tool.created_by_task} (match {score})")
            return tool, True

        tool_id = self.registry.next_id(spec.stem)
        self.say(f"no existing tool fits '{source}' flakiness — writing {tool_id}", task)
        code = write_tool(source, tool_id, task.task_id, self.settings.flaky_repeat_runs, self.llm)
        # Test the test: it must catch the bug on old code and pass on the fixed code.
        tmp = ToolRecord(tool_id=tool_id, description=spec.description, code_path="", created_by_task=task.task_id)
        validation = {}
        for test in test_ids:
            before = self._run_tool(tmp, test, diff=None, code=code)
            after = self._run_tool(tmp, test, diff=task.artifacts.get("diff_text"), code=code)
            validation[test] = {"detects_bug_on_old_code": before.get("failures", 0) > 0,
                                "old": before, "new": after}
        validated = all(v["detects_bug_on_old_code"] and "error" not in v["old"] for v in validation.values())
        rec = self.registry.register(tool_id, spec.description, code, task.task_id, spec.tags, validated, validation)
        self.board.update(task.task_id, self.name,
                          f"wrote tool {tool_id}; validation {'passed' if validated else 'FAILED'} "
                          f"(detects flakiness on old code: {validated})")
        self.say(f"registered {tool_id} (validated={validated})", task)
        return rec, False

    def _run_tool(self, tool: ToolRecord, test: str, diff: str | None, code: str | None = None) -> dict:
        code = code if code is not None else Path(tool.code_path).read_text()
        with self.sandbox.workspace(diff) as work:
            (work / "_swarm_tool.py").write_text(code)
            res = self.sandbox.run(work, [self.sandbox.python(), "_swarm_tool.py", test, str(self.settings.flaky_repeat_runs)])
        for line in reversed(res.stdout.strip().splitlines()):
            try:
                return json.loads(line)
            except json.JSONDecodeError:
                continue
        return {"error": (res.stderr or res.stdout)[-500:], "failures": None}

    def _reject(self, task: Task, results: dict, reason: str, results_path: Path | None = None,
                tools_used: list[str] | None = None) -> None:
        if results_path is None:
            results_path = self.settings.results_dir / f"{task.task_id}.h{len(task.history)}.json"
            results_path.write_text(json.dumps(results, indent=2))
        rejected = sorted(set(task.artifacts.get("rejected_strategies", [])) | {task.artifacts.get("strategy", "")} - {""})
        rejected_diffs = sorted(set(task.artifacts.get("rejected_diffs", [])) | {_digest(task.artifacts.get("diff_text", ""))})
        arts = {"test_results": str(results_path), "test_summary": results, "rejected_strategies": rejected, "rejected_diffs": rejected_diffs}
        if tools_used:
            arts["tools_used"] = tools_used
        self.board.transition(task.task_id, TaskState.REJECTED, self.name, f"tests failed: {reason[:200]}",
                              note=f"Tester: {reason}", assigned_agent=None, artifacts=arts)
        self.say(f"rejected: {reason[:120]}", task)


def _test_names(text: str) -> list[str]:
    return re.findall(r"\btest_[a-z0-9_]+\b", text.lower())

