"""Create and apply unified diffs without depending on git or patch binaries."""

from __future__ import annotations

import difflib
import re
from pathlib import Path


class PatchError(RuntimeError):
    pass


def make_diff(changes: dict[str, tuple[str, str]]) -> str:
    """changes: {relative_path: (old_text, new_text)} -> git-style unified diff."""
    out: list[str] = []
    for path in sorted(changes):
        old, new = changes[path]
        if old == new:
            continue
        out.extend(
            difflib.unified_diff(
                old.splitlines(keepends=True),
                new.splitlines(keepends=True),
                fromfile=f"a/{path}",
                tofile=f"b/{path}",
                n=3,
            )
        )
    text = "".join(out)
    return text if text.endswith("\n") or not text else text + "\n"


_HUNK = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


def parse_diff(diff: str) -> dict[str, list[tuple[int, list[str]]]]:
    """-> {path: [(old_start, hunk_lines), ...]} where hunk lines keep their ' ', '-', '+' prefix."""
    files: dict[str, list[tuple[int, list[str]]]] = {}
    current: str | None = None
    hunk: list[str] | None = None
    for line in diff.splitlines(keepends=True):
        if line.startswith("--- "):
            hunk = None
            continue
        if line.startswith("+++ "):
            path = line[4:].strip().split("\t")[0]
            current = path[2:] if path.startswith("b/") else path
            files.setdefault(current, [])
            continue
        m = _HUNK.match(line)
        if m and current is not None:
            hunk = []
            files[current].append((int(m.group(1)), hunk))
            continue
        if hunk is not None and line[:1] in (" ", "-", "+"):
            hunk.append(line)
        elif hunk is not None and line.startswith("\\"):
            continue
    return files


def changed_files(diff: str) -> list[str]:
    return list(parse_diff(diff).keys())


def apply_diff(diff: str, root: Path) -> list[str]:
    """Apply a unified diff to files under root. Strict: context must match exactly."""
    touched = []
    for path, hunks in parse_diff(diff).items():
        target = (root / path).resolve()
        if root.resolve() not in target.parents:
            raise PatchError(f"patch escapes repository root: {path}")
        lines = target.read_text().splitlines(keepends=True) if target.exists() else []
        offset = 0
        for old_start, hunk in hunks:
            old_block = [l[1:] for l in hunk if l[0] in (" ", "-")]
            new_block = [l[1:] for l in hunk if l[0] in (" ", "+")]
            idx = max(old_start - 1 + offset, 0) if old_block else old_start + offset
            if lines[idx : idx + len(old_block)] != old_block:
                # tolerate drift: search nearby for the context
                idx = _search(lines, old_block, idx)
            lines[idx : idx + len(old_block)] = new_block
            offset += len(new_block) - len(old_block)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("".join(lines))
        touched.append(path)
    return touched


def _search(lines: list[str], block: list[str], near: int) -> int:
    for delta in range(0, len(lines) + 1):
        for idx in (near - delta, near + delta):
            if 0 <= idx <= len(lines) - len(block) and lines[idx : idx + len(block)] == block:
                return idx
    raise PatchError("hunk context not found; the file changed since the patch was made")


def diff_stats(diff: str) -> dict[str, int]:
    added = sum(1 for l in diff.splitlines() if l.startswith("+") and not l.startswith("+++"))
    removed = sum(1 for l in diff.splitlines() if l.startswith("-") and not l.startswith("---"))
    return {"files": len(changed_files(diff)), "added": added, "removed": removed}
