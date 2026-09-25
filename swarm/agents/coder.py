"""Coder: reads the relevant code and proposes a minimal patch as a unified diff.

With an LLM configured it asks the model for search/replace edits. Offline it
uses a small library of flaky-test fix strategies. Either way it reads the
reviewer's or tester's rejection reason and does not repeat a rejected approach.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path

from ..board import Task, TaskState
from ..llm import LLMError
from ..patching import diff_stats, make_diff
from ..retrieval import RepoIndex, Symbol
from .base import Agent

TEST_ID = re.compile(r"\btest_[a-z0-9_]+\b")


def _digest(diff: str) -> str:
    return hashlib.sha256(diff.encode()).hexdigest()[:16]


@dataclass
class Context:
    tests: list[Symbol]
    targets: list[Symbol]  # code under test
    flakiness_source: str  # hash-order | rng | time | unknown
    files: dict[str, str] = field(default_factory=dict)


@dataclass
class Proposal:
    strategy: str
    root_cause: str
    changes: dict[str, tuple[str, str]]


class CoderAgent(Agent):
    name = "coder"

    def step(self) -> bool:
        task = self.board.claim(TaskState.REJECTED, self.name) or self.board.claim(TaskState.TRIAGED, self.name)
        if task is None:
            return False
        self.handle(task)
        return True

    def handle(self, task: Task) -> None:
        if task.attempts >= self.settings.max_coder_attempts:
            self.board.transition(task.task_id, TaskState.HUMAN_REVIEW, self.name,
                                  f"gave up after {task.attempts} attempts",
                                  note=f"Coder ran out of attempts. Last feedback: {task.note}")
            self.say("out of attempts, handing to a human", task)
            return
        feedback = task.note if task.state == TaskState.REJECTED else ""
        task = self.board.transition(task.task_id, TaskState.IN_PROGRESS, self.name,
                                     "picked up" + (" after rejection" if feedback else ""),
                                     assigned_agent=self.name, attempts=task.attempts + 1)

        index = RepoIndex(self.settings.repo_path)
        ctx = self.locate(task, index)
        if not ctx.tests:
            self.board.transition(task.task_id, TaskState.HUMAN_REVIEW, self.name,
                                  "could not find the failing test named in the issue",
                                  note="No test in the repo matches the issue", assigned_agent=None)
            self.say("could not locate the failing test", task)
            return

        rejected = list(task.artifacts.get("rejected_strategies", []))
        rejected_diffs = set(task.artifacts.get("rejected_diffs", []))
        fresh = lambda p: p is not None and _digest(make_diff(p.changes)) not in rejected_diffs  # noqa: E731

        def from_llm() -> Proposal | None:
            if not self.llm.available:
                return None
            try:
                p = self._propose_llm(task, ctx, feedback)
            except (LLMError, KeyError, ValueError) as e:
                self.say(f"LLM patch failed: {e}", task)
                return None
            if not fresh(p):
                self.say("LLM proposed a patch that was already rejected", task)
                return None
            return p

        def from_strategies() -> Proposal | None:
            p = self._propose_heuristic(ctx, rejected)
            return p if fresh(p) else None

        # The model gets the first attempt. After a rejection, proven strategies go before asking it again.
        order = (from_llm, from_strategies) if task.attempts == 1 else (from_strategies, from_llm)
        proposal = order[0]() or order[1]()

        if proposal is None or not any(o != n for o, n in proposal.changes.values()):
            self.board.transition(task.task_id, TaskState.HUMAN_REVIEW, self.name,
                                  "no applicable fix strategy left",
                                  note=f"No fix found for {ctx.flakiness_source} flakiness "
                                       f"(already rejected: {', '.join(rejected) or 'none'})", assigned_agent=None)
            self.say("no fix strategy applies, handing to a human", task)
            return

        diff = make_diff(proposal.changes)
        version = 1 + sum(1 for h in task.history if h.action.startswith("submitted patch"))
        patch_path = self.settings.patches_dir / f"{task.task_id}.v{version}.diff"
        patch_path.write_text(diff)
        self.board.transition(
            task.task_id, TaskState.AWAITING_TESTS, self.name,
            f"submitted patch v{version} ({proposal.strategy}): {diff_stats(diff)['added']}+/{diff_stats(diff)['removed']}-",
            assigned_agent=None,
            artifacts={
                "diff": str(patch_path),
                "diff_text": diff,
                "strategy": proposal.strategy,
                "root_cause": proposal.root_cause,
                "flakiness_source": ctx.flakiness_source,
                "test_ids": [f"{t.path}::{t.name}" for t in ctx.tests],
                "target_symbols": [f"{s.path}::{s.name}" for s in ctx.targets],
            },
        )
        self.say(f"patch v{version} ready ({proposal.strategy})", task)

    # -- retrieval ---------------------------------------------------------
    def locate(self, task: Task, index: RepoIndex) -> Context:
        names = list(dict.fromkeys(TEST_ID.findall(f"{task.title} {task.body}".lower())))
        tests = [s for n in names for s in index.find(n, tests=True)]
        if not tests:  # fall back to retrieval over the issue text
            tests = [s for s in index.search(f"{task.title} {task.body}", k=8) if index.is_test_path(s.path)][:1]
        targets: list[Symbol] = []
        for t in tests:
            for s in index.source_symbols_called_by(t):
                targets.append(s)
                # one hop further: helpers the code under test calls
                for inner in s.calls:
                    targets.extend(x for x in index.find(inner, tests=False) if x not in targets)
        src = "\n".join(s.source for s in targets)
        if re.search(r"\bset\(|\{[^}:]+\}|frozenset\(", src):
            source = "hash-order"
        elif "random." in src or "uuid" in src:
            source = "rng"
        elif "time." in src or "datetime.now" in src or "sleep(" in src:
            source = "time"
        else:
            source = "unknown"
        files = {p: index.files[p] for p in {s.path for s in tests + targets}}
        return Context(tests=tests, targets=targets, flakiness_source=source, files=files)

    # -- heuristic fix strategies -----------------------------------------
    def _propose_heuristic(self, ctx: Context, rejected: list[str]) -> Proposal | None:
        strategies = [
            ("sort-set-result", self._fix_sort_set_result),
            ("bound-jitter", self._fix_bound_jitter),
            # Last resort, and naive: pins the RNG in the test. The reviewer is expected to push back.
            ("seed-test-rng", self._fix_seed_test_rng),
        ]
        for name, fn in strategies:
            if name in rejected:
                continue
            proposal = fn(ctx)
            if proposal:
                return proposal
        return None

    def _edit_symbol(self, ctx: Context, sym: Symbol, new_source: str, changes: dict) -> None:
        old_file = changes.get(sym.path, (ctx.files[sym.path], ctx.files[sym.path]))[1]
        changes[sym.path] = (ctx.files[sym.path], old_file.replace(sym.source, new_source, 1))

    def _fix_sort_set_result(self, ctx: Context) -> Proposal | None:
        changes: dict[str, tuple[str, str]] = {}
        for sym in ctx.targets:
            if "list(set(" in sym.source:
                self._edit_symbol(ctx, sym, sym.source.replace("list(set(", "sorted(set("), changes)
        if not changes:
            return None
        return Proposal("sort-set-result",
                        "Result is built from a set, so element order depends on PYTHONHASHSEED and changes "
                        "between processes. Returning sorted(...) makes the order deterministic.", changes)

    def _fix_seed_test_rng(self, ctx: Context) -> Proposal | None:
        if ctx.flakiness_source != "rng":
            return None
        changes: dict[str, tuple[str, str]] = {}
        for t in ctx.tests:
            lines = t.source.splitlines()
            indent = re.match(r"\s*", lines[1]).group(0) if len(lines) > 1 else "    "
            new_src = "\n".join([lines[0], f"{indent}random.seed(0)", *lines[1:]])
            self._edit_symbol(ctx, t, new_src, changes)
            old, new = changes[t.path]
            if not re.search(r"^import random$", new, re.M):
                new = "import random\n" + new
            changes[t.path] = (old, new)
        return Proposal("seed-test-rng", "Test depends on unseeded randomness; seed the RNG in the test.", changes)

    def _fix_bound_jitter(self, ctx: Context) -> Proposal | None:
        changes: dict[str, tuple[str, str]] = {}
        for sym in ctx.targets:
            step = re.search(r"^\s*(\w+)\s*=\s*[^\n]*\*\*[^\n]*$", sym.source, re.M)
            m = re.search(r"random\.uniform\(0,\s*([^)]+)\)", sym.source)
            if step and m and m.group(1).strip() != step.group(1):
                var = step.group(1)
                new_src = sym.source.replace(m.group(0), f"random.uniform(0, {var})")
                self._edit_symbol(ctx, sym, new_src, changes)
        if not changes:
            return None
        return Proposal("bound-jitter",
                        "Jitter range is fixed while the backoff step doubles, so an early delay can exceed a later "
                        "one. Bounding jitter by the current step keeps delays strictly increasing.", changes)

    # -- LLM ---------------------------------------------------------------
    def _propose_llm(self, task: Task, ctx: Context, feedback: str) -> Proposal:
        code = "\n\n".join(f"### {p}\n```python\n{src}\n```" for p, src in ctx.files.items())
        out = self.llm.complete_json(
            "You fix flaky tests at the root cause with the smallest possible change. Never mask flakiness by "
            "seeding RNGs in tests, adding retries, sleeps, skip or xfail. Prefer fixing the code under test.",
            f"Issue {task.source_issue}: {task.title}\n{task.body}\n\nSuspected flakiness source: {ctx.flakiness_source}\n"
            f"{'Previous attempt was rejected: ' + feedback if feedback else ''}\n\nRelevant files:\n{code}\n\n"
            'Return {"strategy": "<short-kebab-name>", "root_cause": "<1-2 sentences>", '
            '"edits": [{"path": "<file>", "old": "<exact existing text>", "new": "<replacement>"}]}',
        )
        changes: dict[str, tuple[str, str]] = {}
        for e in out["edits"]:
            path = e["path"]
            base = changes.get(path, (ctx.files.get(path) or (Path(self.settings.repo_path) / path).read_text(),) * 2)
            if e["old"] not in base[1]:
                raise ValueError(f"edit target not found in {path}")
            changes[path] = (base[0], base[1].replace(e["old"], e["new"], 1))
        return Proposal(out.get("strategy", "llm-fix"), out.get("root_cause", ""), changes)
