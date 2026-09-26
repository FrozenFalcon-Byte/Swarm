"""Test lab: makes up a small Python project full of bugs, and the issues people would file about them.

With a model configured (Groq, Gemini, OpenRouter, Anthropic), the model invents everything each time: the
library and what it is for, every module, the bug hidden in it and its fix, and each issue in a real user's
words. Nothing is kept unless it is proven in the sandbox first: the test has to fail at random on the buggy
code and pass every time on the fix. Without a model, built-in makers fill in, shuffled by the wave's seed.

Bugs that fail at random (what the swarm fixes):
  hash-order    a result whose order comes from a set, so it changes between processes
  jitter        unseeded randomness that breaks something on some draws
  clock         reading the clock, so calls close together or on a boundary go wrong
  shared-state  state leaking between calls, so a test fails when another one ran first

Noise the triager has to sort out: questions, vague reports, plain bugs, feature requests and duplicates.
"""

from __future__ import annotations

import random
import re
from dataclasses import dataclass, field
from pathlib import Path

KINDS = ("hash-order", "jitter", "clock", "shared-state")
NOISE = ("question", "vague", "bug", "feature", "duplicate")
SIZES = {"small": (3, 2), "medium": (5, 3), "large": (8, 5)}


@dataclass
class Bug:
    kind: str
    module: str
    func: str
    test: str  # the test that fails at random, as path::name
    symptom: str
    how_often: str
    issue: int = 0


@dataclass
class Project:
    name: str
    files: dict[str, str] = field(default_factory=dict)
    issues: list[dict] = field(default_factory=list)
    bugs: list[Bug] = field(default_factory=list)

    def summary(self) -> dict:
        kinds: dict[str, int] = {}
        for b in self.bugs:
            kinds[b.kind] = kinds.get(b.kind, 0) + 1
        return {"name": self.name, "issues": len(self.issues), "bugs": kinds,
                "modules": sorted({b.module for b in self.bugs})}


# -- names ------------------------------------------------------------------------------------------

_HEADS = ["brim", "quill", "fern", "cobalt", "ember", "tally", "marl", "pike", "sable", "wren", "flint", "moss",
          "birch", "tarn", "vale", "kestrel", "dune", "loam", "cinder", "hollow", "glade", "reed", "slate", "otter"]
_TAILS = ["kit", "box", "log", "desk", "yard", "port", "works", "stack", "base", "line", "loop", "craft", "shelf"]


def project_name(seed: int) -> str:
    r = random.Random(seed)
    return r.choice(_HEADS) + r.choice(_TAILS)


class _Names:
    """Hands out module and function names that are unique across every wave of a project."""

    def __init__(self):
        self.used: set[str] = set()

    def take(self, name: str) -> str:
        n, i = name, 2
        while n in self.used:
            n, i = f"{name}{i}", i + 1
        self.used.add(n)
        return n


# -- bug makers -------------------------------------------------------------------------------------
# Each one returns the module source, the test file and what a person would see when it fails. The code
# under test avoids f-strings and braces so the coder reads the right kind of randomness in it.

_SETS = [
    # module, function, argument, noun, normaliser, sample values
    ("labels", "clean_labels", "labels", "label", "x.strip().lower()", [" Bug", "ui", "API", "ui ", "docs", "Perf", ""]),
    ("contacts", "unique_emails", "emails", "email", "x.strip().lower()",
     ["ana@ex.io", "Bo@ex.io", "ana@EX.io", "cy@ex.io", " dee@ex.io", ""]),
    ("places", "distinct_cities", "cities", "city", "x.strip().title()", ["lima", "Oslo", "LIMA", "kyoto", "perth ", "Accra"]),
    ("catalog", "merge_skus", "skus", "SKU", "x.strip().upper()", ["ab-1", "AB-1", "cd-9", "ef-3", " gh-7", "cd-9 "]),
    ("permissions", "effective_scopes", "scopes", "scope", "x.strip().lower()", ["Read", "write", "READ", "admin", "billing"]),
    ("search", "query_terms", "terms", "search term", "x.strip().lower()", ["Red", "shoes", "RED", "size", "Nine", "shoes"]),
    ("inventory", "bin_codes", "codes", "bin code", "x.strip().upper()", ["a1", "B2", "a1 ", "c3", "D4", "b2"]),
    ("audience", "segment_names", "segments", "segment", "x.strip().lower()", ["Trial", "paid", "PAID", "churned", "vip"]),
]

_WAITS = [
    ("backoff", "backoff_schedule", "backoff"), ("polling", "poll_intervals", "polling"),
    ("reconnect", "reconnect_waits", "reconnect"), ("cooldown", "cooldown_steps", "cooldown"),
    ("webhooks", "delivery_waits", "webhook delivery"), ("sync", "sync_pauses", "sync"),
]

_CLOCK = [
    ("receipts", "receipt_id", "receipt"), ("uploads", "upload_name", "upload"), ("events", "event_key", "event"),
    ("jobs", "job_label", "job"), ("invoices", "invoice_number", "invoice"), ("exports", "export_file", "export"),
]

_SHARED = [
    ("cart", "add_to_cart", "item", "basket", "cart"), ("playlist", "queue_song", "song", "queue", "playlist"),
    ("notes", "pin_note", "note", "board", "pinboard"), ("alerts", "stack_alert", "alert", "pile", "alert stack"),
    ("reading", "save_article", "article", "shelf", "reading list"), ("watch", "watch_symbol", "symbol", "watchlist", "watchlist"),
]


def _hash_order(r: random.Random, names: _Names, pkg: str) -> tuple[Bug, dict[str, str]]:
    mod, fn, arg, noun, norm, pool = r.choice(_SETS)
    mod, fn = names.take(mod), names.take(fn)
    values = r.sample(pool, k=min(len(pool), r.randint(5, 7)))
    if not any(v.strip() == "" for v in values):
        values.append("")
    expected = sorted({eval(norm, {"x": v}) for v in values if v.strip()})  # noqa: S307 (our own literals)
    while len(expected) < 3:
        values.append(r.choice(["zeta", "yak", "xeno"]))
        expected = sorted({eval(norm, {"x": v}) for v in values if v.strip()})  # noqa: S307
    src = (f'def {fn}({arg}):\n    """Each {noun} once, cleaned up, in a stable order."""\n'
           f"    cleaned = [{norm} for x in {arg} if x.strip()]\n    return list(set(cleaned))\n")
    test = f"test_{fn}"
    tsrc = (f"from {pkg}.{mod} import {fn}\n\n\ndef {test}():\n"
            f"    assert {fn}({values!r}) == {expected!r}\n")
    shown = expected[:]
    while shown == expected:
        r.shuffle(shown)
    bug = Bug("hash-order", mod, fn, f"tests/test_{mod}.py::{test}",
              f"AssertionError: assert {shown!r} == {expected!r}", r.choice(
                  ["about a third of CI runs", "roughly half the time on CI", "maybe 1 in 3 runs",
                   "every few pipeline runs", "on some runs and not others"]))
    return bug, {f"{pkg}/{mod}.py": src, f"tests/test_{mod}.py": tsrc}


def _jitter(r: random.Random, names: _Names, pkg: str) -> tuple[Bug, dict[str, str]]:
    mod, fn, noun = r.choice(_WAITS)
    mod, fn = names.take(mod), names.take(fn)
    base = r.choice([0.05, 0.1, 0.2, 0.25])
    spread = round(base * r.choice([2, 3, 4, 5]), 2)
    step = r.choice(["step", "wait", "pause", "delay"])
    counter = r.choice(["n", "i", "k", "attempt"])
    src = ("import random\n\n\n"
           f"def {fn}(count, base={base}, spread={spread}):\n"
           f'    """Growing waits in seconds for {noun}, with random spread so clients don\'t all come back at once."""\n'
           f"    out = []\n    for {counter} in range(count):\n        {step} = base * 2 ** {counter}\n"
           f"        out.append({step} + random.uniform(0, spread))\n    return out\n")
    runs = r.choice([5, 6, 7])
    test = f"test_{fn}_keep_growing"
    tsrc = (f"from {pkg}.{mod} import {fn}\n\n\ndef {test}():\n    waits = {fn}({runs})\n"
            "    assert all(a < b for a, b in zip(waits, waits[1:]))\n")
    first = round(base + spread * r.uniform(0.7, 0.95), 2)
    second = round(base * 2 + spread * r.uniform(0.0, 0.2), 2)
    bug = Bug("jitter", mod, fn, f"tests/test_{mod}.py::{test}",
              f"the waits came back as [{first}, {second}, ...]: the second one is shorter than the first",
              r.choice(["1 in 4 runs or so", "a couple of times a day", "now and then", "on some runs"]))
    return bug, {f"{pkg}/{mod}.py": src, f"tests/test_{mod}.py": tsrc}


def _clock(r: random.Random, names: _Names, pkg: str) -> tuple[Bug, dict[str, str]]:
    mod, fn, noun = r.choice(_CLOCK)
    mod, fn = names.take(mod), names.take(fn)
    arg = r.choice(["name", "prefix", "owner", "kind"])
    src = ("import time\n\n\n"
           f"def {fn}({arg}):\n"
           f'    """A short unique id for a new {noun}: the {arg} plus the time it was made."""\n'
           f'    return {arg} + "-" + str(int(time.time() * 1000))\n')
    test = f"test_{fn}_is_unique"
    word = r.choice(["acme", "north", "team", "blue"])
    tsrc = (f"from {pkg}.{mod} import {fn}\n\n\ndef {test}():\n"
            f'    first = {fn}("{word}")\n    second = {fn}("{word}")\n    assert first != second\n')
    stamp = 1727000000000 + r.randint(0, 99999999)
    bug = Bug("clock", mod, fn, f"tests/test_{mod}.py::{test}",
              f"AssertionError: assert '{word}-{stamp}' != '{word}-{stamp}'",
              r.choice(["most runs on the fast CI machines, rarely on my laptop", "on and off", "sporadically",
                        "more often on the new runners"]))
    return bug, {f"{pkg}/{mod}.py": src, f"tests/test_{mod}.py": tsrc}


def _shared(r: random.Random, names: _Names, pkg: str) -> tuple[Bug, dict[str, str]]:
    mod, fn, item, bag, noun = r.choice(_SHARED)
    mod, fn = names.take(mod), names.take(fn)
    src = (f"def {fn}({item}, {bag}=[]):\n"
           f'    """Add a {item} to the {noun} and return the {noun}."""\n'
           f"    {bag}.append({item})\n    return {bag}\n")
    a, b, c = r.sample(["alpha", "bravo", "delta", "echo", "kilo", "lima", "oscar", "tango"], 3)
    first, second = f"test_{fn}_starts_empty", f"test_{fn}_single_{item}"
    tsrc = (f"from {pkg}.{mod} import {fn}\n\n\n"
            f'def {first}():\n    assert {fn}("{a}") == ["{a}"]\n\n\n'
            f'def {second}():\n    assert {fn}("{b}") == ["{b}"]\n\n\n'
            f'def test_{fn}_given_{bag}():\n    assert {fn}("{c}", ["{a}"]) == ["{a}", "{c}"]\n')
    target = r.choice([first, second])
    other = a if target == second else b
    mine = b if target == second else a
    bug = Bug("shared-state", mod, fn, f"tests/test_{mod}.py::{target}",
              f"AssertionError: assert ['{other}', '{mine}'] == ['{mine}']: something is left over from another test",
              r.choice(["whenever the tests run in a different order", "since we turned on pytest-randomly",
                        "only when the whole file runs, never on its own", "when CI splits tests across workers"]))
    return bug, {f"{pkg}/{mod}.py": src, f"tests/test_{mod}.py": tsrc}


MAKERS = {"hash-order": _hash_order, "jitter": _jitter, "clock": _clock, "shared-state": _shared}

# plain bugs the triager should hand to a person (not tests that fail at random)
_PLAIN = [
    ("money", "percent_of", "def percent_of(part, whole):\n    \"\"\"part as a percentage of whole.\"\"\"\n"
     "    return round(part / whole * 10, 1)\n", "percent_of(1, 4)", "2.5", "25.0"),
    ("calendar", "days_between", "def days_between(start, end):\n    \"\"\"Whole days from start to end, inclusive.\"\"\"\n"
     "    return (end - start).days\n", "days_between(date(2024, 3, 1), date(2024, 3, 3))", "2", "3"),
    ("paging", "page_count", "def page_count(items, per_page):\n    \"\"\"How many pages the items fill.\"\"\"\n"
     "    return items // per_page\n", "page_count(41, 20)", "2", "3"),
    ("text", "initials", "def initials(full_name):\n    \"\"\"First letter of each part of a name.\"\"\"\n"
     "    return \"\".join(p[0] for p in full_name.split(\" \")).upper()\n", "initials(\"ada  lovelace\")", "an IndexError", "\"AL\""),
]

# -- issue wording ----------------------------------------------------------------------------------

_TITLES = {
    "hash-order": ["{test} fails intermittently in CI", "Flaky: {test} returns items in a random order",
                   "{test} sometimes fails with the list in a different order", "{fn}() order is nondeterministic, {test} flaky"],
    "jitter": ["{test} is flaky", "{test} fails intermittently: waits not increasing",
               "Nondeterministic failure in {test}", "{fn} sometimes returns a shorter wait after a longer one"],
    "clock": ["{test} fails intermittently", "Flaky: two ids from {fn} are sometimes equal",
              "{test} randomly failing on CI", "{fn} ids collide sometimes, {test} flaky"],
    "shared-state": ["{test} fails intermittently", "{test} flaky depending on test order",
                     "Flaky {test}: leftover state from another test?", "{test} passes locally, fails sporadically in CI"],
}
_OPENERS = ["tests/{path} is flaky.", "Seeing {path} fail intermittently.", "{path} passes locally but not always on CI.",
            "We keep hitting a random failure in {path}.", "{path} started failing sporadically this week."]
_FREQ = ["It fails {often}.", "Happens {often}.", "Frequency: {often}.", "Fails {often}, passes on re-run."]
_EXTRA = ["Re-running the job usually makes it green, but it is blocking merges.", "This is blocking the release.",
          "Not sure what changed. It passes on retry.", "Could not reproduce it on my machine every time.",
          "It is nondeterministic, looks random.", "CI log excerpt below.", ""]
_QUESTIONS = ["How do I use {fn} with my own data?", "Is it possible to call {fn} from a script?",
              "Question: can I configure {fn}?", "How to import {fn} in {pkg}?"]
_VAGUE = [("broken", "it doesnt work"), ("{pkg} not working", "after updating nothing works for me"),
          ("help", "error when I run it"), ("issue with {fn}", "something is off")]
_FEATURES = ["Please add support for async in {fn}", "Feature request: a CLI for {pkg}",
             "Would be nice to have type hints in {fn}", "Enhancement: add a JSON export to {fn}"]


def _flaky_issue(r: random.Random, b: Bug) -> tuple[str, str]:
    name = b.test.split("::")[1]
    title = r.choice(_TITLES[b.kind]).format(test=name, fn=b.func)
    lines = [r.choice(_OPENERS).format(path=b.test), r.choice(_FREQ).format(often=b.how_often),
             "", "```", b.symptom, "```", r.choice(_EXTRA)]
    return title, "\n".join(lines).strip()




# -- the probe: does a bug really fail at random? -----------------------------------------------------
# Runs inside the sandbox. Each run gets its own hash seed, and every other run first runs a random pick of
# the file's other tests, so set order, randomness, the clock and leftover state all get a chance to show.

PROBE = r'''
import json, os, random, re, subprocess, sys
test, runs = sys.argv[1], int(sys.argv[2])
path, _, name = test.partition("::")
others = [path + "::" + n for n in re.findall(r"^def (test_\w+)", open(path).read(), re.M) if n != name]
fails, broken, tail = 0, 0, ""
for i in range(runs):
    r = random.Random(i)
    before = r.sample(others, r.randint(1, len(others))) if others and i % 2 else []
    env = dict(os.environ, PYTHONHASHSEED=str(i))
    p = subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "-rfE", *before, test],
                       env=env, capture_output=True, text=True, timeout=60)
    out = p.stdout + p.stderr
    if p.returncode not in (0, 1) or ("ERROR " + test) in out:
        broken += 1
        tail = out[-1500:]
    elif ("FAILED " + test) in out:
        fails += 1
        tail = tail or out[-1500:]
print(json.dumps({"runs": runs, "failures": fails, "broken": broken, "tail": tail}))
'''


def probe(files: dict[str, str], test: str, sandbox_settings, runs: int = 12) -> dict:
    """Run `test` `runs` times inside the sandbox on a project made of `files`."""
    import json
    import tempfile

    from .sandbox import Sandbox

    with tempfile.TemporaryDirectory(prefix="swarm-lab-") as tmp:
        root = Path(tmp)
        for rel, text in files.items():
            (root / rel).parent.mkdir(parents=True, exist_ok=True)
            (root / rel).write_text(text)
        (root / "_lab_probe.py").write_text(PROBE)
        box = Sandbox(sandbox_settings, repo_path=root)
        with box.workspace() as work:
            res = box.run(work, [box.python(), "_lab_probe.py", test, str(runs)], timeout=240)
    for line in reversed(res.stdout.strip().splitlines()):
        try:
            return json.loads(line)
        except ValueError:
            continue
    return {"runs": runs, "failures": 0, "broken": runs, "tail": (res.stderr or res.stdout)[-1500:]}


# -- the model invents the wave ---------------------------------------------------------------------

BRIEF = {
    "hash-order": "the result's order comes from iterating a set of strings (or something built from one), so it "
                  "changes between processes with PYTHONHASHSEED; the test compares against one fixed order",
    "jitter": "unseeded randomness from the random module (uniform, choice, shuffle, sample, randint, random...) "
              "breaks something only on some draws; aim for the test failing in roughly 20 to 70 percent of runs",
    "clock": "it reads the clock (time.time, time.monotonic, time.perf_counter, datetime.now...) and calls that "
             "happen close together make the result wrong only sometimes, for example ids or names built from a "
             "coarse timestamp that collide, a duration rounded to zero, or an ordering that assumes two clock "
             "reads differ. The test calls it several times in a tight loop so it fails on some runs and not "
             "others; no sleep longer than 0.02 s",
    "shared-state": "state leaks between calls through a mutable default argument or a module-level list, dict or "
                    "cache, so a test fails only when another test in the same file ran before it; the test file "
                    "has 2 to 4 tests that all use it and each passes when run alone",
}
SYSTEM = ("You invent realistic, small Python code with one subtle, real-world bug, for testing a bot that fixes "
          "tests which fail at random. Standard library only. No network, no files, no subprocesses. "
          "Never hint at the bug in names, comments or docstrings.")
_LETTERS = "abcdefghiklmnoprstvw"


def _pkg_ok(name: str) -> bool:
    return bool(re.fullmatch(r"[a-z][a-z0-9]{3,15}", name or ""))


def invent_project(llm, seed: int, avoid: list[str] | None = None) -> tuple[str, str]:
    r = random.Random(seed)
    out = llm.complete_json(
        "You name small, specific open-source Python libraries. Be inventive and concrete.",
        f"Invent a small Python library someone might maintain (random seed {seed}). Its subject must start with "
        f"the letter '{r.choice(_LETTERS)}' and be something ordinary people or small teams deal with "
        f"({r.choice(['at work', 'at home', 'in a hobby', 'in a small shop', 'in a club', 'outdoors', 'in a lab'])}). "
        f"Avoid these subjects and names: {', '.join(avoid or []) or 'none'}.\n"
        'Return {"package": "<one lowercase word, 4 to 14 letters, a made-up brandable name>", '
        '"description": "<one sentence on what it does>"}',
        max_tokens=1500, temperature=1.0)
    pkg = re.sub(r"[^a-z0-9]", "", str(out.get("package", "")).lower())
    if not _pkg_ok(pkg):
        raise ValueError(f"bad package name {out.get('package')!r}")
    return pkg, str(out.get("description", "")).strip()[:200]


def _invent_bug(llm, pkg: str, description: str, kind: str, taken: list[str], feedback: str = "") -> dict:
    out = llm.complete_json(
        SYSTEM,
        f"Library `{pkg}`: {description}\nModules it already has: {', '.join(taken) or 'none'}.\n\n"
        f"Write one NEW module for a different part of this library, with a function whose bug is: {BRIEF[kind]}.\n"
        f"Then a pytest file for it that imports `from {pkg}.<module> import ...`, with one test that fails at "
        "random because of the bug and passes every time once the bug is fixed. Tests must be quick (under a "
        "second) and must not seed the random module or retry.\n"
        "Also the fixed module (the smallest change that fixes the cause in the code, not in the test), and the "
        "GitHub issue a user would file after seeing that test fail on CI: they don't know the cause, they say it "
        "fails intermittently or sometimes, name the test as tests/test_<module>.py::<test name>, say roughly "
        "how often, and paste a short plausible error. Vary the tone and length.\n"
        + (f"\nYour previous attempt did not work: {feedback}\n" if feedback else "")
        + '\nReturn {"module": "<snake_case>", "code": "<module source>", "fixed_code": "<module source, fixed>", '
          '"test_code": "<pytest file>", "test_name": "<test function that fails at random>", '
          '"root_cause": "<one or two sentences>", "issue_title": "...", "issue_body": "<markdown>"}',
        max_tokens=6000, temperature=0.9)
    for k in ("module", "code", "fixed_code", "test_code", "test_name", "issue_title", "issue_body"):
        if not isinstance(out.get(k), str) or not out[k].strip():
            raise ValueError(f"missing {k}")
    out["module"] = re.sub(r"[^a-z0-9_]", "_", out["module"].lower()).strip("_") or "part"
    for k in ("code", "fixed_code", "test_code"):
        compile(out[k], f"{k}.py", "exec")
    if f"def {out['test_name']}(" not in out["test_code"]:
        raise ValueError(f"the test file has no {out['test_name']}")
    return out


def _rename(text: str, old: str, new: str) -> str:
    return re.sub(rf"\b{re.escape(old)}\b", new, text)


def _llm_bug(llm, pkg, description, kind, names: _Names, files: dict[str, str], sandbox_settings, say) -> dict | None:
    feedback = ""
    for attempt in range(2):
        try:
            b = _invent_bug(llm, pkg, description, kind, sorted(names.used), feedback)
        except Exception as e:  # the model's answer was unusable; ask once more, then fall back
            feedback = f"your answer could not be used ({str(e)[:200]})"
            continue
        mod = names.take(b["module"])
        test_path = f"tests/test_{mod}.py"
        test_code = b["test_code"]
        if mod != b["module"]:
            test_code = test_code.replace(f"{pkg}.{b['module']}", f"{pkg}.{mod}")
        tname = b["test_name"]
        if any(f"def {tname}(" in t for p, t in files.items() if p.startswith("tests/")):
            new = f"{tname}_{mod}"
            test_code, b["issue_title"], b["issue_body"] = (_rename(x, tname, new) for x in (test_code, b["issue_title"], b["issue_body"]))
            tname = new
        test = f"{test_path}::{tname}"
        base = {**files, f"{pkg}/{mod}.py": b["code"], test_path: test_code}
        buggy = probe(base, test, sandbox_settings)
        fixed = probe({**base, f"{pkg}/{mod}.py": b["fixed_code"]}, test, sandbox_settings)
        passes = buggy["runs"] - buggy["failures"] - buggy["broken"]
        problem = ("it does not run: " + buggy["tail"][-400:] if buggy["broken"] else
                   "the test never failed in 12 runs" if not buggy["failures"] else
                   "the test failed every time; it should pass on some runs" if passes == 0 and kind != "clock" else
                   "the fixed code still fails: " + fixed["tail"][-400:] if fixed["failures"] or fixed["broken"] else "")
        if problem:
            names.used.discard(mod)
            feedback = problem
            say(f"{kind}: the model's bug in {mod} was not usable ({problem[:80]}), asking again" if attempt == 0
                else f"{kind}: second try in {mod} was not usable either")
            continue
        body = b["issue_body"]
        if tname not in body and tname not in b["issue_title"]:
            body += f"\n\nFailing test: `{test}`"
        return {"kind": kind, "module": mod, "test": test, "files": {f"{pkg}/{mod}.py": b["code"], test_path: test_code},
                "fix": b["fixed_code"], "root_cause": str(b.get("root_cause", ""))[:600],
                "title": b["issue_title"][:200], "body": body[:4000],
                "verified": {"buggy": {k: buggy[k] for k in ("runs", "failures")},
                             "fixed": {k: fixed[k] for k in ("runs", "failures")}}}
    return None


def _llm_noise(llm, pkg, description, n: int, kinds: list[str], bugs: list[dict], names: _Names) -> list[dict]:
    listing = "\n".join(f"- #{i + 1} [{b['module']}] {b['title']} (test {b['test']})" for i, b in enumerate(bugs))
    out = llm.complete_json(
        "You write realistic GitHub issues from real users of a small Python library, with all their variety: "
        "terse, rambling, polite, annoyed, well written or not.",
        f"Library `{pkg}`: {description}\nModules: {', '.join(sorted(names.used))}\nIssues already filed:\n{listing}\n\n"
        f"Write {n} more issues, of these types in this order: {', '.join(kinds)}.\n"
        "- question: someone asking how to do something (not a bug)\n"
        "- vague: a report with almost no detail\n"
        "- feature: a request for something new\n"
        "- bug: a plain, always-reproducible wrong result in a NEW small module you also write (5 to 20 lines, "
        "one deterministic bug such as an off-by-one or a wrong formula)\n"
        "- duplicate: a different person reporting one of the filed issues again in their own words, naming the same test\n"
        'Return {"issues": [{"type": "...", "title": "...", "body": "...", "duplicate_of": <number or null>, '
        '"module": "<snake_case, bug only>", "code": "<module source, bug only>"}]}',
        max_tokens=6000, temperature=1.0)
    items = out.get("issues")
    if not isinstance(items, list):
        raise ValueError("no issues")
    good = []
    for it in items:
        if not isinstance(it, dict) or not str(it.get("title", "")).strip():
            continue
        it["type"] = it.get("type") if it.get("type") in NOISE else "vague"
        if it["type"] == "bug":
            try:
                compile(str(it.get("code") or ""), "bug.py", "exec")
                it["module"] = names.take(re.sub(r"[^a-z0-9_]", "_", str(it.get("module") or "helpers").lower()))
            except SyntaxError:
                it["code"] = None
        good.append(it)
    return good


# -- building a wave --------------------------------------------------------------------------------

@dataclass
class LabState:
    """What earlier waves left behind: the package, its files and how many issues were filed."""
    package: str | None = None
    description: str = ""
    files: dict[str, str] = field(default_factory=dict)
    issues: int = 0

    @classmethod
    def of(cls, records: list[dict]) -> "LabState":
        st = cls()
        for rec in records:
            st.package = st.package or rec.get("package")
            st.description = st.description or rec.get("description", "")
            st.files.update(rec.get("files") or {})
            st.issues += len(rec.get("issues") or [])
        return st

    def names(self) -> _Names:
        n = _Names()
        for rel, text in self.files.items():
            if rel.endswith(".py"):
                n.used.add(Path(rel).stem.removeprefix("test_"))
                n.used.update(re.findall(r"^def (\w+)", text, re.M))
        return n


def make_wave(spec: dict, state: LabState, llm=None, sandbox_settings=None, avoid: list[str] | None = None,
              say=lambda m: None) -> dict:
    """One wave of bugs and issues. With a model, it invents everything and each bug is proven in the sandbox
    before it is kept; without one (or when it fails), the built-in makers fill in."""
    seed = int(spec.get("seed") or new_seed())
    r = random.Random(seed)
    n_bugs, n_noise = SIZES.get(str(spec.get("size") or "medium"), SIZES["medium"])
    allowed = [k for k in (spec.get("kinds") or KINDS) if k in KINDS] or list(KINDS)
    picks = r.sample(allowed, k=min(len(allowed), n_bugs)) + [r.choice(allowed) for _ in range(max(0, n_bugs - len(allowed)))]
    use_llm = bool(llm is not None and llm.available and sandbox_settings is not None)
    via = "built-in"

    pkg, description = state.package, state.description
    if pkg is None:
        if use_llm:
            try:
                pkg, description = invent_project(llm, seed, avoid)
                via = llm.last_used or "model"
            except Exception as e:
                say(f"the model couldn't name a project ({str(e)[:80]}), using a made-up name")
        if pkg is None:
            pkg, description = project_name(seed), "a small made-up library for testing Swarm"
        say(f"new project: {pkg} ({description})")
    files = dict(state.files)
    new_files: dict[str, str] = {}
    if f"{pkg}/__init__.py" not in files:
        new_files[f"{pkg}/__init__.py"] = f'"""{pkg}: {description}"""\n'
        new_files["README.md"] = f"# {pkg}\n\n{description}\n\nMade up by Swarm's test lab.\n"
    files.update(new_files)
    names = state.names()

    bugs: list[dict] = []
    for kind in picks:
        b = None
        if use_llm:
            say(f"inventing a {kind} bug")
            b = _llm_bug(llm, pkg, description, kind, names, files, sandbox_settings, say)
            if b:
                via = llm.last_used or via
                say(f"{kind} bug in {b['module']}: fails {b['verified']['buggy']['failures']}/12 runs, "
                    f"its fix {b['verified']['fixed']['failures']}/12")
        if b is None:
            bug, bfiles = MAKERS[kind](r, names, pkg)
            title, body = _flaky_issue(r, bug)
            b = {"kind": kind, "module": bug.module, "test": bug.test, "files": bfiles, "fix": None,
                 "root_cause": {"hash-order": "The result is built from a set, so its order changes between processes.",
                                "jitter": "The random spread is fixed while the step grows, so an early wait can be longer than a later one.",
                                "clock": "Ids come from the clock in milliseconds, so two made in the same millisecond are equal.",
                                "shared-state": "A mutable default argument keeps items from earlier calls."}[kind],
                 "title": title, "body": body, "verified": None, "builtIn": True}
            if use_llm:
                say(f"{kind}: using a built-in bug in {bug.module} instead")
        files.update(b["files"])
        new_files.update(b["files"])
        bugs.append(b)

    noise_kinds = [r.choice(NOISE) for _ in range(n_noise)]
    noise: list[dict] = []
    if use_llm and noise_kinds:
        try:
            say("writing the other issues people file")
            noise = _llm_noise(llm, pkg, description, n_noise, noise_kinds, bugs, names)
        except Exception as e:
            say(f"the model couldn't write the other issues ({str(e)[:80]}), using built-in ones")
    if not noise:
        noise = _builtin_noise(r, pkg, noise_kinds, bugs, names)
    for it in noise:
        if it["type"] == "bug" and it.get("code") and it.get("module"):
            new_files[f"{pkg}/{it['module']}.py"] = it["code"]

    # number the issues: duplicates after what they duplicate, everything else shuffled
    firsts = [("bug", i, b) for i, b in enumerate(bugs)] + [("noise", i, n) for i, n in enumerate(noise) if n["type"] != "duplicate"]
    r.shuffle(firsts)
    order = firsts + [("noise", i, n) for i, n in enumerate(noise) if n["type"] == "duplicate"]
    issues, number = [], state.issues
    for src, _, item in order:
        number += 1
        issues.append({"number": number, "title": item["title"], "body": item.get("body") or "", "labels": []})
        item["issue"] = number
    return {"seed": seed, "package": pkg, "description": description, "via": via, "files": new_files, "issues": issues,
            "bugs": [{k: v for k, v in b.items() if k != "files"} for b in bugs],
            "noise": [{"issue": n["issue"], "type": n["type"]} for n in noise]}


def _builtin_noise(r: random.Random, pkg: str, kinds: list[str], bugs: list[dict], names: _Names) -> list[dict]:
    out = []
    for kind in kinds:
        b = r.choice(bugs)
        fn = b["test"].split("::")[1].removeprefix("test_")
        if kind == "question":
            out.append({"type": kind, "title": r.choice(_QUESTIONS).format(fn=fn, pkg=pkg), "body": "Is it possible? How do I set that up?"})
        elif kind == "vague":
            t, body = r.choice(_VAGUE)
            out.append({"type": kind, "title": t.format(pkg=pkg, fn=fn), "body": body})
        elif kind == "feature":
            out.append({"type": kind, "title": r.choice(_FEATURES).format(fn=fn, pkg=pkg),
                        "body": "Would be nice to have. Happy to help with a feature request PR."})
        elif kind == "bug":
            mod, func, src, call, got, want = r.choice(_PLAIN)
            mod, fn2 = names.take(mod), names.take(func)
            imports = "from datetime import date\n\n\n" if "date(" in call else ""
            out.append({"type": kind, "title": f"{fn2} returns the wrong value", "module": mod,
                        "code": imports + src.replace(f"def {func}(", f"def {fn2}("),
                        "body": f"{call.replace(func, fn2)} returns {got} instead of {want}. Looks like a bug in {pkg}/{mod}.py."})
        else:
            name = b["test"].split("::")[1]
            out.append({"type": kind, "title": f"{name} flaky again",
                        "body": f"Seeing {name} fail sporadically on CI again. Passes on re-run."})
    return out


def project_of(records: list[dict]) -> Project:
    """The whole project after its waves, as stored."""
    st = LabState.of(records)
    p = Project(st.package or "lab", files=st.files)
    for rec in records:
        p.issues.extend(rec.get("issues") or [])
    return p


def materialize(files: dict[str, str], dest: Path) -> list[str]:
    """Write the files a checkout doesn't have yet. Existing files are left alone, so merged fixes survive
    new waves."""
    written = []
    for rel, text in files.items():
        p = Path(dest) / rel
        if p.exists():
            continue
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
        written.append(rel)
    return written


def new_seed() -> int:
    return random.SystemRandom().randint(1, 2**31 - 1)
