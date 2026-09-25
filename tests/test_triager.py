from swarm.agents import TriagerAgent
from swarm.board import TaskBoard, TaskState


def test_routes_demo_issues(settings, issues):
    board = TaskBoard(settings.db_path)
    tri = TriagerAgent(board, settings)
    tri.ingest(issues)
    tri.step()
    by_issue = {t.source_issue: t for t in board.list()}
    assert by_issue["#101"].state == TaskState.TRIAGED and by_issue["#101"].kind == "flaky-test"
    assert by_issue["#101"].priority == "high"  # mentions CI and blocking
    assert by_issue["#102"].state == TaskState.TRIAGED
    assert by_issue["#104"].state == TaskState.CLOSED and "duplicate" in by_issue["#104"].labels
    assert by_issue["#105"].state == TaskState.HUMAN_REVIEW and by_issue["#105"].kind == "bug"
    assert by_issue["#106"].state == TaskState.CLOSED and by_issue["#106"].kind == "question"
    assert by_issue["#107"].state == TaskState.HUMAN_REVIEW  # "it doesnt work": low confidence


def test_not_a_duplicate_of_different_flaky_test(settings, issues):
    board = TaskBoard(settings.db_path)
    tri = TriagerAgent(board, settings)
    tri.ingest(issues)
    tri.step()
    assert board.find_by_issue("#103").state == TaskState.TRIAGED
