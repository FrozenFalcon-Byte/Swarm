"""The test lab: made-up projects whose random failures the swarm really fixes, with new tools along the way."""

from swarm import lab
from swarm.board import TaskState as Col
from swarm.issues import Issue
from swarm.orchestrator import Swarm


def _run(settings, records):
    proj = lab.project_of(records)
    lab.materialize(proj.files, settings.repo_path)
    swarm = Swarm(settings)
    swarm.ingest([Issue(i["number"], i["title"], i["body"], []) for i in proj.issues])
    swarm.run_until_idle()
    return swarm


def test_every_wave_is_different():
    a = lab.make_wave({"seed": 1, "size": "small"}, lab.LabState())
    b = lab.make_wave({"seed": 2, "size": "small"}, lab.LabState())
    assert a["issues"] != b["issues"] and a["package"] != b["package"]
    assert len(a["bugs"]) == 3 and len(a["issues"]) == 5


def test_later_waves_add_to_the_same_project(settings, tmp_path):
    first = lab.make_wave({"seed": 5, "size": "small"}, lab.LabState())
    second = lab.make_wave({"seed": 6, "size": "small"}, lab.LabState.of([first]))
    assert second["package"] == first["package"]
    assert not set(first["files"]) & set(second["files"]), "a new wave never overwrites earlier files"
    assert second["issues"][0]["number"] == len(first["issues"]) + 1


def test_the_swarm_fixes_every_kind_and_writes_a_tool_for_each(settings, tmp_path):
    settings.repo_path = tmp_path / "lab"
    rec = lab.make_wave({"seed": 11, "size": "small", "kinds": list(lab.KINDS)}, lab.LabState())
    rec2 = lab.make_wave({"seed": 12, "size": "small", "kinds": ["clock"]}, lab.LabState.of([rec]))
    swarm = _run(settings, [rec, rec2])
    for b in rec["bugs"] + rec2["bugs"]:
        t = swarm.board.find_by_issue(f"#{b['issue']}")
        sensitive = "permission" in b["module"]
        assert t.state == (Col.HUMAN_REVIEW if sensitive else Col.APPROVED), (b, t.state, t.note)
    tools = {r.tool_id.rsplit("_v", 1)[0] for r in swarm.registry.all() if r.validated}
    kinds = {b["kind"] for b in rec["bugs"] + rec2["bugs"]}
    if "hash-order" in kinds:
        assert "hashseed_sweep" in tools
    if "shared-state" in kinds:  # a kind no earlier tool covers gets a brand-new one
        assert "order_shuffle" in tools
    if "clock" in kinds:
        assert "timing_stress" in tools
