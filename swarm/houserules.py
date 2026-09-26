"""House rules and quiet hours: what a repository's owner tells the swarm from the web app.

Rules live on the repo document at settings.rules and the reviewer enforces them on every diff:
  never  a fix may not touch files matching the pattern; the reviewer sends it back to the coder
  ask    a fix touching them always waits for a person, even when every check passes
  size   a fix may change at most `max` lines

Quiet hours live at settings.schedule = {"tz": "Europe/Paris", "hours": "<168 chars>"}: one character per
hour of the week, Monday 00:00 first, "1" when the swarm may start runs on its own. Runs you start by hand
always go ahead.

Patterns read like .gitignore: `*` stays inside a folder, `**` crosses folders, a pattern without a slash
matches a file name anywhere, and one ending in a slash matches everything under that folder. The web app
has the same matcher (web/src/lib/houserules.ts) so what you try there is what the reviewer does.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

KINDS = ("never", "ask", "size")
MAX_RULES = 30


def glob_regex(pattern: str) -> re.Pattern[str]:
    p = pattern.strip().replace("\\", "/")
    anchored = p.startswith("/")
    p = p.lstrip("/")
    if p.endswith("/"):
        p += "**"
    out, i = [], 0
    while i < len(p):
        c = p[i]
        if p.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
        elif p.startswith("**", i):
            out.append(".*")
            i += 2
        elif c == "*":
            out.append("[^/]*")
            i += 1
        elif c == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(c))
            i += 1
    body = "".join(out)
    if not anchored and "/" not in p.rstrip("*"):
        body = "(?:.*/)?" + body  # a bare name matches at any depth
    return re.compile(f"^{body}$")


def matches(pattern: str, path: str) -> bool:
    return bool(pattern.strip()) and bool(glob_regex(pattern).match(path.lstrip("./")))


@dataclass
class Verdict:
    blocked: list[str]  # reasons the fix must change
    ask: list[str]  # reasons a person must look

    @property
    def ok(self) -> bool:
        return not self.blocked


def clean(rules) -> list[dict]:
    """Keep well-formed, switched-on rules only; anything odd from the client is dropped."""
    out = []
    for r in (rules if isinstance(rules, list) else [])[:MAX_RULES]:
        if not isinstance(r, dict) or r.get("on") is False or r.get("kind") not in KINDS:
            continue
        if r["kind"] == "size":
            try:
                n = int(r.get("max"))
            except (TypeError, ValueError):
                continue
            if n > 0:
                out.append({"kind": "size", "max": n, "why": str(r.get("why") or "")[:200]})
        elif isinstance(r.get("glob"), str) and r["glob"].strip():
            out.append({"kind": r["kind"], "glob": r["glob"].strip()[:200], "why": str(r.get("why") or "")[:200]})
    return out


def evaluate(rules: list[dict], files: list[str], changed_lines: int) -> Verdict:
    blocked, ask = [], []
    for r in clean(rules):
        why = f" ({r['why']})" if r.get("why") else ""
        if r["kind"] == "size":
            if changed_lines > r["max"]:
                blocked.append(f"changes {changed_lines} lines, the limit is {r['max']}{why}")
            continue
        hit = [f for f in files if matches(r["glob"], f)]
        if not hit:
            continue
        if r["kind"] == "never":
            blocked.append(f"touches {', '.join(hit)}, which matches “never touch {r['glob']}”{why}")
        else:
            ask.append(f"touches {', '.join(hit)}, which matches “ask me first: {r['glob']}”{why}")
    return Verdict(blocked, ask)


def schedule_allows(schedule, now: datetime | None = None) -> bool:
    """Whether the swarm may start a run on its own right now. No schedule means any time."""
    if not isinstance(schedule, dict):
        return True
    hours = schedule.get("hours")
    if not isinstance(hours, str) or len(hours) != 168:
        return True
    try:
        tz = ZoneInfo(str(schedule.get("tz") or "UTC"))
    except (ZoneInfoNotFoundError, ValueError):
        tz = timezone.utc
    local = (now or datetime.now(timezone.utc)).astimezone(tz)
    return hours[local.weekday() * 24 + local.hour] == "1"
