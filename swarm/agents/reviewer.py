"""Reviewer: critiques the diff independently of the coder.

It never sees the coder's reasoning, only the issue, the diff and the test
evidence, and it is framed adversarially: its job is to find a reason not to
merge. Security-sensitive changes always go to a human.
"""

from __future__ import annotations

import py_compile
import re
from dataclasses import dataclass

from ..board import Task, TaskState
from ..houserules import evaluate as house_rules
from ..llm import LLMError
from ..patching import changed_files, diff_stats, parse_diff
from ..retrieval import RepoIndex
from ..sandbox import Sandbox
from .base import Agent
from .coder import _digest

SENSITIVE = re.compile(r"(auth|security|crypto|passw|secret|token|permission|acl|oauth|session)", re.I)
MASKING = [
    (re.compile(r"random\.seed\("), "seeds the RNG in the test instead of fixing the nondeterminism"),
    (re.compile(r"time\.sleep\("), "adds a sleep, which hides timing races rather than fixing them"),
    (re.compile(r"@pytest\.mark\.(skip|xfail|flaky)"), "skips or xfails the test"),
    (re.compile(r"\b(retry|rerun|reruns)\b", re.I), "adds retries around the test"),
]
MAX_CHANGED_LINES = 20
MAX_LINE_LEN = 120


@dataclass
class Check:
    name: str
    ok: bool
    detail: str
    blocking: bool = True

    def as_dict(self) -> dict:
        return {"name": self.name, "ok": self.ok, "detail": self.detail, "blocking": self.blocking}


class ReviewerAgent(Agent):
    name = "reviewer"
    consumes = TaskState.IN_REVIEW

    def __init__(self, *args, sandbox: Sandbox | None = None, **kw):
        super().__init__(*args, **kw)
        self.ask_first: list[str] = []
        self.sandbox = sandbox or Sandbox(self.settings)

    def review(self, task: Task) -> tuple[list[Check], bool]:
        diff = task.artifacts.get("diff_text", "")
        files = changed_files(diff)
        stats = diff_stats(diff)
        added = [l[1:] for hunks in parse_diff(diff).values() for _, h in hunks for l in h if l.startswith("+")]
        test_files = [f for f in files if RepoIndex.is_test_path(f)]
        checks: list[Check] = []

        # Does the diff address the issue? It should touch the code under test (or the test itself).
        targets = {s.split("::")[0] for s in task.artifacts.get("target_symbols", [])}
        tests = {s.split("::")[0] for s in task.artifacts.get("test_ids", [])}
        relevant = [f for f in files if f in targets | tests]
        checks.append(Check("matches-issue", bool(relevant) and len(relevant) == len(files),
                            f"touches {', '.join(files)}; code under test: {', '.join(sorted(targets)) or '?'}"))

        n = stats["added"] + stats["removed"]
        checks.append(Check("minimal", n <= MAX_CHANGED_LINES and stats["files"] <= 3,
                            f"{stats['files']} file(s), +{stats['added']}/-{stats['removed']}"))

        masking = [why for rx, why in MASKING for line in added if rx.search(line)]
        removed_src = [l[1:] for f, hunks in parse_diff(diff).items() if f not in test_files
                       for _, h in hunks for l in h if l.startswith("-")]
        if any("random." in l for l in removed_src) and not any("random." in l for l in added):
            masking.append("deletes the randomness the code is meant to provide instead of bounding it; "
                           "that changes behaviour beyond the issue")
        only_tests = bool(files) and len(test_files) == len(files)
        if only_tests and task.kind == "flaky-test":
            masking.append("changes only the test, not the code whose behaviour is nondeterministic")
        checks.append(Check("fixes-root-cause", not masking,
                            "; ".join(dict.fromkeys(masking)) or "changes the nondeterministic code itself"))

        lint_problems = [f"line too long ({len(l.rstrip())})" for l in added if len(l.rstrip("\n")) > MAX_LINE_LEN]
        lint_problems += ["trailing whitespace" for l in added if l.rstrip("\n") != l.rstrip("\n").rstrip()]
        with self.sandbox.workspace(diff) as work:
            for f in files:
                if f.endswith(".py"):
                    try:
                        py_compile.compile(str(work / f), doraise=True)
                    except py_compile.PyCompileError as e:
                        lint_problems.append(f"{f} does not compile: {e.msg.strip()[:120]}")
        checks.append(Check("style-and-syntax", not lint_problems, "; ".join(dict.fromkeys(lint_problems)) or "clean"))

        summary = task.artifacts.get("test_summary", {})
        evidence = summary.get("harness", {}).get("evidence", {})
        stable = bool(evidence) and all(e["after"].get("failures") == 0 for e in evidence.values())
        checks.append(Check("test-evidence", stable and not summary.get("regressions"),
                            f"harness {summary.get('harness', {}).get('tool_id', '-')}: "
                            + ", ".join(f"{e['before'].get('failures')}→{e['after'].get('failures')} failing of {e['after'].get('runs')}"
                                        for e in evidence.values())))

        if self.llm.available:
            checks.append(self._llm_check(task, diff))

        self.ask_first = []
        if self.settings.house_rules:
            verdict = house_rules(self.settings.house_rules, files, n)
            checks.append(Check("house-rules", verdict.ok, "; ".join(verdict.blocked) or "keeps to the repository's house rules"))
            self.ask_first = verdict.ask

        sensitive = [f for f in files if SENSITIVE.search(f)]
        return checks, bool(sensitive)

    def _llm_check(self, task: Task, diff: str) -> Check:
        try:
            out = self.llm.complete_json(
                "You are a skeptical senior reviewer. You did not write this patch. Look for reasons NOT to merge: "
                "masking symptoms, behaviour changes beyond the issue, unhandled edge cases, API breaks.",
                f"Issue: {task.title}\n{task.body}\n\nDiff:\n{diff}\n\n"
                'Return {"verdict": "approve"|"reject", "reasons": ["..."]}',
                max_tokens=600,
            )
            ok = out.get("verdict") == "approve"
            return Check("llm-critique", ok, f"[{self.llm.last_used}] " + "; ".join(map(str, out.get("reasons", [])))[:500],
                         blocking=self.settings.llm_review_blocking)
        except LLMError as e:
            return Check("llm-critique", True, f"skipped: {e}", blocking=False)

    def handle(self, task: Task) -> None:
        self.board.update(task.task_id, self.name, assigned_agent=self.name)
        checks, sensitive = self.review(task)
        failed = [c for c in checks if not c.ok and c.blocking]
        review = {"checks": [c.as_dict() for c in checks], "sensitive": sensitive}
        if failed:
            reason = " | ".join(f"{c.name}: {c.detail}" for c in failed)
            rejected = sorted(set(task.artifacts.get("rejected_strategies", [])) | {task.artifacts.get("strategy", "")} - {""})
            rejected_diffs = sorted(set(task.artifacts.get("rejected_diffs", [])) | {_digest(task.artifacts.get("diff_text", ""))})
            self.board.transition(task.task_id, TaskState.REJECTED, self.name, f"changes requested — {reason[:200]}",
                                  note=f"Reviewer: {reason}", assigned_agent=None,
                                  artifacts={"review": review, "rejected_strategies": rejected, "rejected_diffs": rejected_diffs})
            self.say(f"requested changes: {reason[:120]}", task)
        elif self.ask_first:
            review["askFirst"] = self.ask_first
            self.board.transition(task.task_id, TaskState.HUMAN_REVIEW, self.name,
                                  "all checks pass, but a house rule says to ask you first",
                                  note="House rule: " + "; ".join(self.ask_first)[:400], assigned_agent=None,
                                  artifacts={"review": review})
            self.say("checks pass; a house rule asks for a person, escalated", task)
        elif sensitive:
            self.board.transition(task.task_id, TaskState.HUMAN_REVIEW, self.name,
                                  "all checks pass, but the diff touches security-sensitive code — escalated",
                                  note="Security-sensitive path: a maintainer must approve", assigned_agent=None,
                                  artifacts={"review": review})
            self.say("checks pass; security-sensitive, escalated to a human", task)
        else:
            self.board.transition(task.task_id, TaskState.APPROVED, self.name,
                                  f"approved — {len(checks)} checks passed; waiting for a maintainer to merge",
                                  assigned_agent=None, note="", artifacts={"review": review})
            self.say("approved, ready for a maintainer to merge", task)
