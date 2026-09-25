from swarm.agents import TriagerAgent
from swarm.board import TaskBoard
from swarm.llm import LLM, LLMError, Provider


class Fake(Provider):
    def __init__(self, name, reply=None, fail=False, ready=True):
        super().__init__(name)
        self.reply, self.fail, self._ready, self.calls = reply, fail, ready, 0

    def ready(self):
        return self._ready

    @property
    def model(self):
        return f"{self.name}-model"

    def complete(self, system, prompt, max_tokens, json_mode):
        self.calls += 1
        if self.fail:
            raise LLMError("boom")
        return self.reply


def test_falls_through_to_next_provider(settings):
    settings.llm_disabled = False
    a, b = Fake("a", fail=True), Fake("b", reply="<think>hmm</think>hello")
    llm = LLM(settings, providers=[a, b, Fake("c", ready=False)])
    assert llm.complete("s", "p") == "hello"  # reasoning blocks are stripped
    assert llm.last_used == "b:b-model" and a.calls == 1
    assert llm.describe()["active"] == "a:a-model"


def test_no_providers_means_heuristics(settings):
    settings.llm_disabled = False
    llm = LLM(settings, providers=[Fake("a", ready=False)])
    assert not llm.available


def test_triage_blends_llm_with_heuristics(settings, issues):
    settings.llm_disabled = False
    tri = TriagerAgent(TaskBoard(":memory:"), settings,
                       llm=LLM(settings, providers=[Fake("a", reply='{"kind": "flaky-test", "priority": "low", "confidence": 0.3}')]))
    issue = next(i for i in issues if i.number == 101)
    t = tri.classify(issue.title, issue.body)
    # an under-confident small model that agrees with strong heuristics doesn't send a clear case to a human
    assert t.kind == "flaky-test" and t.confidence >= settings.triage_confidence_threshold and t.priority == "high"

    tri.llm = LLM(settings, providers=[Fake("a", reply='{"kind": "question", "priority": "low", "confidence": 0.9}')])
    t = tri.classify(issue.title, issue.body)
    assert t.confidence < settings.triage_confidence_threshold  # disagreement goes to a human
