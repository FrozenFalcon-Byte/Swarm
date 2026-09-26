from datetime import datetime, timezone

from swarm.houserules import clean, evaluate, matches, schedule_allows


def test_patterns_read_like_gitignore():
    assert matches("*.lock", "poetry.lock") and matches("*.lock", "sub/dir/yarn.lock")
    assert matches("migrations/", "migrations/0001_init.py") and not matches("migrations/", "app/migrations/x.py")
    assert matches("**/migrations/**", "app/migrations/x.py")
    assert matches("src/*.py", "src/a.py") and not matches("src/*.py", "src/deep/a.py")
    assert matches("src/**/*.py", "src/deep/a.py") and matches("src/**/*.py", "src/a.py")
    assert matches("/setup.py", "setup.py") and not matches("/setup.py", "pkg/setup.py")
    assert not matches("", "anything.py")


def test_rules_block_ask_and_limit():
    rules = [{"kind": "never", "glob": "vendor/", "on": True}, {"kind": "ask", "glob": "*.toml", "on": True},
             {"kind": "size", "max": 10, "on": True}, {"kind": "never", "glob": "tests/", "on": False}, {"kind": "bogus"}]
    assert len(clean(rules)) == 3
    v = evaluate(rules, ["vendor/lib.py", "pyproject.toml", "tests/test_a.py"], 12)
    assert len(v.blocked) == 2 and len(v.ask) == 1 and not v.ok
    assert evaluate(rules, ["src/a.py"], 4).ok


def test_quiet_hours():
    hours = ["0"] * 168
    hours[2 * 24 + 9] = "1"  # Wednesday 09:00-10:00 in Paris
    sched = {"tz": "Europe/Paris", "hours": "".join(hours)}
    wed_0930_paris = datetime(2026, 9, 30, 7, 30, tzinfo=timezone.utc)  # CEST is UTC+2
    assert schedule_allows(sched, wed_0930_paris)
    assert not schedule_allows(sched, datetime(2026, 9, 30, 9, 30, tzinfo=timezone.utc))
    assert schedule_allows(None) and schedule_allows({"hours": "1"})
    assert schedule_allows({"tz": "Not/AZone", "hours": "1" * 168})
