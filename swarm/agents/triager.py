"""Triager: turns issues into task cards. Conservative: unsure means a human looks."""

from __future__ import annotations

import re
from dataclasses import dataclass

from ..board import TaskState
from ..issues import Issue
from ..llm import LLMError
from ..textsim import similarities
from .base import Agent

KEYWORDS = {
    "flaky-test": ["flaky", "intermittent", "intermittently", "sometimes", "randomly", "sporadic", "sporadically",
                   "nondeterministic", "non-deterministic", "passes locally", "on retry", "re-run", "rerun", "1 in"],
    "bug": ["wrong", "incorrect", "error", "exception", "crash", "off-by-one", "bug", "instead of", "broken", "fails"],
    "feature": ["add support", "feature", "would be nice", "please add", "request", "enhancement"],
    "question": ["how do i", "how to", "is it possible", "question", "can i", "?"],
}
IN_SCOPE = {"flaky-test"}  # v1 niche: flaky test triage
TEST_ID = re.compile(r"\btest_[a-z0-9_]+\b")


@dataclass
class Triage:
    kind: str
    priority: str
    confidence: float
    rationale: str


class TriagerAgent(Agent):
    name = "triager"
    consumes = TaskState.NEW

    def ingest(self, issues: list[Issue]) -> int:
        created = 0
        for issue in issues:
            if self.board.find_by_issue(issue.ref):
                continue
            self.board.create(issue.ref, issue.title, issue.body, agent=self.name, labels=list(issue.labels))
            created += 1
        if created:
            self.say(f"ingested {created} new issue(s)")
        return created

    # -- classification --------------------------------------------------
    def classify(self, title: str, body: str) -> Triage:
        heur = self._classify_heuristic(title, body)
        if not self.llm.available:
            return heur
        try:
            llm = self._classify_llm(title, body)
        except LLMError as e:
            self.say(f"LLM triage failed, using heuristics: {e}")
            return heur
        # Two independent opinions: agreement raises confidence, disagreement lowers it.
        if llm.kind == heur.kind:
            rank = ["low", "medium", "high", "critical"]
            priority = max(llm.priority, heur.priority, key=rank.index)
            return Triage(llm.kind, priority, round(max(llm.confidence, heur.confidence), 2),
                          f"{llm.rationale} | heuristics agree ({heur.confidence})")
        best = llm if llm.confidence >= heur.confidence else heur
        # halved so a genuine disagreement always lands below the threshold and a person decides
        return Triage(best.kind, best.priority, round(min(llm.confidence, heur.confidence) * 0.5, 2),
                      f"LLM says {llm.kind} ({llm.confidence}), heuristics say {heur.kind} ({heur.confidence})")

    def _classify_heuristic(self, title: str, body: str) -> Triage:
        text = f"{title}\n{body}".lower()
        scores = {k: sum(text.count(w) for w in words) for k, words in KEYWORDS.items()}
        # Title matches are stronger evidence than body matches.
        for k, words in KEYWORDS.items():
            scores[k] += sum(2 for w in words if w in title.lower())
        total = sum(scores.values())
        kind = max(scores, key=scores.get)
        if total == 0:
            return Triage("unknown", "low", 0.1, "no recognizable signal in the issue text")
        confidence = scores[kind] / total
        words = len(text.split())
        if words < 12:
            confidence *= 0.5  # too little detail to be sure of anything
        if kind == "flaky-test" and TEST_ID.search(text):
            confidence = min(1.0, confidence + 0.2)  # names a concrete test
        priority = self._priority(kind, text)
        top = ", ".join(f"{k}={v}" for k, v in sorted(scores.items(), key=lambda kv: -kv[1]) if v)
        return Triage(kind, priority, round(confidence, 2), f"keyword signal: {top}; {words} words")

    @staticmethod
    def _priority(kind: str, text: str) -> str:
        if any(w in text for w in ("security", "data loss", "vulnerab", "outage")):
            return "critical"
        if kind == "flaky-test" and any(w in text for w in ("blocking", "blocks", "ci", "release")):
            return "high"
        if kind in ("flaky-test", "bug"):
            return "medium"
        return "low"

    def _classify_llm(self, title: str, body: str) -> Triage:
        out = self.llm.complete_json(
            "You triage GitHub issues for a maintenance bot whose scope is flaky tests. "
            "Be conservative: when unsure, give low confidence.",
            f"Issue title: {title}\nIssue body:\n{body}\n\n"
            'Return {"kind": "flaky-test"|"bug"|"feature"|"question"|"unknown", '
            '"priority": "low"|"medium"|"high"|"critical", "confidence": 0..1, "rationale": "<one sentence>"}',
            max_tokens=400,
        )
        kind = str(out.get("kind", "unknown")).lower()
        kind = kind if kind in (*KEYWORDS, "unknown") else "unknown"
        priority = str(out.get("priority", "medium")).lower()
        priority = priority if priority in ("low", "medium", "high", "critical") else "medium"
        try:
            confidence = max(0.0, min(1.0, float(out.get("confidence", 0))))
        except (TypeError, ValueError):
            confidence = 0.0
        return Triage(kind, priority, confidence, f"llm ({self.llm.last_used}): {out.get('rationale', '')}")

    def find_duplicate(self, task_id: str, title: str, body: str) -> tuple[str, float] | None:
        others = [t for t in self.board.list() if t.task_id != task_id and t.state not in (TaskState.NEW,)]
        if not others:
            return None
        text = f"{title} {body}"
        tests = set(TEST_ID.findall(text.lower()))
        sims = similarities(text, [f"{t.title} {t.body}" for t in others], self.settings.use_embeddings)
        best = None
        for t, s in zip(others, sims):
            shared_test = bool(tests & set(TEST_ID.findall(f"{t.title} {t.body}".lower())))
            score = s + (0.35 if shared_test else 0.0)
            if score >= 0.6 and (best is None or score > best[1]):
                best = (t.task_id, round(min(score, 1.0), 2))
        return best

    def step(self) -> bool:
        """Triage is cheap, so drain the whole intake column in one turn."""
        did = False
        while (task := self.board.claim(TaskState.NEW, self.name)) is not None:
            self.handle(task)
            did = True
        return did

    # -- routing -----------------------------------------------------------
    def handle(self, task) -> None:
        tri = self.classify(task.title, task.body)
        labels = sorted(set(task.labels) | {tri.kind, f"priority:{tri.priority}"})
        fields = dict(kind=tri.kind, priority=tri.priority, labels=labels,
                      artifacts={"triage": {"confidence": tri.confidence, "rationale": tri.rationale}})

        dup = self.find_duplicate(task.task_id, task.title, task.body)
        if dup:
            self.board.transition(task.task_id, TaskState.CLOSED, self.name,
                                  f"closed as duplicate of {dup[0]} (similarity {dup[1]})",
                                  note=f"Duplicate of {dup[0]}", **{**fields, "labels": labels + ["duplicate"]})
            self.say(f"duplicate of {dup[0]}", task)
        elif tri.confidence < self.settings.triage_confidence_threshold:
            self.board.transition(task.task_id, TaskState.HUMAN_REVIEW, self.name,
                                  f"low-confidence triage ({tri.confidence}) — flagged for a human",
                                  note=f"Unsure how to classify (confidence {tri.confidence}). {tri.rationale}", **fields)
            self.say(f"low confidence ({tri.confidence}), sent to a human", task)
        elif tri.kind == "question":
            self.board.transition(task.task_id, TaskState.CLOSED, self.name, "labeled question — no code change needed",
                                  note="Question: answer in the issue thread", **fields)
            self.say("question, closed for a maintainer to answer", task)
        elif tri.kind not in IN_SCOPE:
            self.board.transition(task.task_id, TaskState.HUMAN_REVIEW, self.name,
                                  f"labeled {tri.kind}, priority={tri.priority} — outside scope (tests that fail at random)",
                                  note=f"{tri.kind.capitalize()} outside Swarm's scope (tests that fail at random)", **fields)
            self.say(f"{tri.kind} is out of scope, sent to a human", task)
        else:
            self.board.transition(task.task_id, TaskState.TRIAGED, self.name,
                                  f"labeled {tri.kind}, priority={tri.priority} (confidence {tri.confidence})", **fields)
            self.say(f"triaged as {tri.kind}, priority {tri.priority}", task)
