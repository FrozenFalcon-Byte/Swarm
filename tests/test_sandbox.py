import sys

from swarm.sandbox import Sandbox


def test_workspace_is_disposable(settings):
    sb = Sandbox(settings)
    with sb.workspace() as work:
        (work / "tagkit" / "tags.py").write_text("broken")
        path = work
    assert not path.exists()
    assert "def normalize_tags" in (settings.repo_path / "tagkit" / "tags.py").read_text()


def test_timeout_enforced(settings):
    sb = Sandbox(settings)
    with sb.workspace() as work:
        res = sb.run(work, [sys.executable, "-c", "while True: pass"], timeout=2)
    assert res.timed_out


def test_pytest_report(settings):
    sb = Sandbox(settings)
    with sb.workspace() as work:
        rep = sb.run_pytest(work, "tests/test_dates.py")
    assert rep.ok and rep.passed == 1
