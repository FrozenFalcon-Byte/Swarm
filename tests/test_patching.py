import pytest

from swarm.patching import PatchError, apply_diff, changed_files, diff_stats, make_diff


def test_roundtrip(tmp_path):
    (tmp_path / "m.py").write_text("a = 1\nb = 2\nc = 3\n")
    diff = make_diff({"m.py": ("a = 1\nb = 2\nc = 3\n", "a = 1\nb = 20\nc = 3\n")})
    assert changed_files(diff) == ["m.py"]
    assert diff_stats(diff) == {"files": 1, "added": 1, "removed": 1}
    apply_diff(diff, tmp_path)
    assert (tmp_path / "m.py").read_text() == "a = 1\nb = 20\nc = 3\n"


def test_tolerates_line_drift(tmp_path):
    diff = make_diff({"m.py": ("x\ny\nz\n", "x\nY\nz\n")})
    (tmp_path / "m.py").write_text("header\nheader2\nx\ny\nz\n")
    apply_diff(diff, tmp_path)
    assert (tmp_path / "m.py").read_text() == "header\nheader2\nx\nY\nz\n"


def test_conflict_detected(tmp_path):
    diff = make_diff({"m.py": ("x\ny\nz\n", "x\nY\nz\n")})
    (tmp_path / "m.py").write_text("totally\ndifferent\n")
    with pytest.raises(PatchError):
        apply_diff(diff, tmp_path)


def test_refuses_paths_outside_root(tmp_path):
    diff = "--- a/../evil.py\n+++ b/../evil.py\n@@ -0,0 +1 @@\n+boom\n"
    with pytest.raises(PatchError):
        apply_diff(diff, tmp_path / "root")
