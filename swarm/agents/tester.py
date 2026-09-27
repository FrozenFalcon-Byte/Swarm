"""Tester: runs the patch in the sandbox and, when the existing suite can't prove
the fix (a flaky test passing once proves nothing), finds or designs a harness that can.

A saved harness is reused only if it actually reproduces this failure on the old code. Otherwise the
Tester designs one for this failure (the LLM reads the test, the code and the coder's diagnosis), checks
that it catches the failure on the old code and isn't simply broken on the fixed code, tries once more
with what went wrong, and falls back to a template. Only a harness that holds up is saved for reuse."""

from __future__ import annotations

import ast
import json
import re
from pathlib import Path

from ..board import Task, TaskState
from ..patching import PatchError, apply_diff
from ..registry import ToolRecord, ToolRegistry
from ..sandbox import Sandbox
from ..toolgen import design_tool, spec_for, template_tool
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

        # 0. A patch that doesn't apply to the code as it is now can't be tested: back to the coder to write
        #    it again (its attempt budget keeps that from going round forever).
        try:
            with self.sandbox.workspace() as work:
                apply_diff(diff, work)
        except PatchError as e:
            self._reject(task, results, f"the patch doesn't apply to the current code ({e}); write it again against the file as it is now")
            return

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
        tool, reused, known = self._get_or_write_tool(task, source, test_ids)
        evidence = {}
        for test in test_ids:  # runs already made while choosing or validating the tool count as evidence
            before = known.get(test, {}).get("old") or self._run_tool(tool, test, diff=None)
            after = known.get(test, {}).get("new") or self._run_tool(tool, test, diff=diff)
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
            return self._reject(task, results, f"Still fails at random under {tool.tool_id}: {detail}",
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

    def _get_or_write_tool(self, task: Task, source: str, test_ids: list[str]) -> tuple[ToolRecord, bool, dict]:
        """The harness for this task, whether it was reused, and the runs already made with it
        ({test: {"old": ..., "new": ...}})."""
        spec = spec_for(source)
        diff = task.artifacts.get("diff_text")

        # 1. A saved tool, but only one that reproduces this failure: a close description isn't proof it fits.
        for tool, score in self.registry.search(f"{spec.description} {' '.join(spec.tags)}")[:3]:
            old = {t: self._run_tool(tool, t, diff=None) for t in test_ids}
            if test_ids and all(_catches(r) for r in old.values()):
                self.say(f"reusing {tool.tool_id} (match {score}): it reproduces the failure on the old code", task)
                self.board.update(task.task_id, self.name, f"reused tool {tool.tool_id} from {tool.created_by_task} (match {score})")
                return tool, True, {t: {"old": r} for t, r in old.items()}
            self.say(f"{tool.tool_id} looked like a fit (match {score}) but doesn't reproduce this failure; not using it", task)

        # 2. Design one for this failure, test it, and try again with what went wrong.
        feedback, context = "", None
        for attempt in (1, 2):
            if not self.llm.available:
                break
            context = context or self._failure_context(task, source, test_ids)
            self.say(f"designing a harness for this failure (attempt {attempt})", task)
            d = design_tool(context, self.settings.flaky_repeat_runs, self.llm, feedback)
            if d is None:
                break
            tool_id = self.registry.next_id(d.stem)
            validation, ok, why = self._validate(d.code, test_ids, diff)
            if ok:
                return self._save(task, tool_id, d.description, d.code, d.tags, validation), False, validation
            self.say(f"{tool_id} didn't hold up: {why}", task)
            self.board.update(task.task_id, self.name, f"designed {tool_id}, discarded it: {why[:160]}")
            feedback = why

        # 3. The built-in harness for this kind of failure.
        tool_id = self.registry.next_id(spec.stem)
        self.say(f"no saved harness fits '{source}' random failures, writing {tool_id} from the built-in template", task)
        code = template_tool(source, tool_id, task.task_id, self.settings.flaky_repeat_runs)
        validation, ok, why = self._validate(code, test_ids, diff)
        return self._save(task, tool_id, spec.description, code, spec.tags, validation, ok, why), False, validation

    def _save(self, task: Task, tool_id: str, description: str, code: str, tags: list[str], validation: dict,
              validated: bool = True, why: str = "") -> ToolRecord:
        rec = self.registry.register(tool_id, description, code, task.task_id, tags, validated, validation)
        self.board.update(task.task_id, self.name,
                          f"wrote tool {tool_id}; validation {'passed' if validated else 'FAILED'} "
                          f"(catches the failures on the old code: {validated})" + (f": {why[:160]}" if why else ""))
        self.say(f"registered {tool_id} (validated={validated})", task)
        return rec

    def _validate(self, code: str, test_ids: list[str], diff: str | None) -> tuple[dict, bool, str]:
        """Test the test: it must catch the failure on the old code, and on the fixed code it must at least
        be able to pass (a harness that fails every run is measuring something else)."""
        tmp = ToolRecord(tool_id="candidate", description="", code_path="", created_by_task="")
        validation, problems = {}, []
        for test in test_ids:
            old = self._run_tool(tmp, test, diff=None, code=code)
            new = self._run_tool(tmp, test, diff=diff, code=code)
            catches = _catches(old)
            validation[test] = {"detects_bug_on_old_code": catches, "passes_on_fixed_code": new.get("failures") == 0,
                                "old": old, "new": new}
            if "error" in old or "error" in new:
                problems.append(f"it crashed on {test}: {(old.get('error') or new.get('error') or '')[-240:]}")
            elif not catches:
                problems.append(f"it saw no failures of {test} on the old code ({old.get('failures')}/{old.get('runs')})")
            elif (new.get("failures") or 0) >= (new.get("runs") or 1):
                problems.append(f"it failed every run of {test} on the fixed code too, so it isn't measuring this failure")
        ok = bool(test_ids) and not problems
        return validation, ok, "; ".join(problems)

    def _failure_context(self, task: Task, source: str, test_ids: list[str]) -> str:
        """What the LLM needs to design a harness for this failure: the issue, the diagnosis, the test, the code."""
        a = task.artifacts
        parts = [f"Issue: {task.title}\n{task.body[:1200]}",
                 f"Suspected kind of failure: {source}", f"The coder's diagnosis: {a.get('root_cause') or 'none given'}"]
        for ref in test_ids[:3]:
            parts.append(f"Failing test {ref}:\n{_source_of(self.settings.repo_path, ref)}")
        for ref in (a.get("target_symbols") or [])[:3]:
            parts.append(f"Code under test {ref}:\n{_source_of(self.settings.repo_path, ref)}")
        if a.get("diff_text"):
            parts.append(f"The proposed fix (the harness must pass with it and catch the failure without it):\n{a['diff_text'][:2000]}")
        return "\n\n".join(parts)

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


def _catches(result: dict) -> bool:
    return "error" not in result and (result.get("failures") or 0) > 0


def _source_of(root: Path, ref: str, limit: int = 2500) -> str:
    """The source of `path::name` (a function or class, top level or in a class), or the file's head."""
    path, _, name = ref.partition("::")
    try:
        src = (root / path).read_text()
    except OSError:
        return "(not found)"
    want = name.split(".")[-1]
    try:
        for node in ast.walk(ast.parse(src)):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.name == want:
                return (ast.get_source_segment(src, node) or "")[:limit]
    except SyntaxError:
        pass
    return src[:limit]


def _test_names(text: str) -> list[str]:
    return re.findall(r"\btest_[a-z0-9_]+\b", text.lower())

