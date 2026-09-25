"""Load `.env` files so keys live in one place instead of shell exports.

Looked up in order: $SWARM_ENV_FILE, ./.env, <project root>/.env. Real
environment variables always win over the file, so a deploy platform's
secrets override anything checked out on disk.
"""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def parse(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.removeprefix("export ").partition("=")
        key, val = key.strip(), val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        elif " #" in val:  # trailing comment on an unquoted value
            val = val.split(" #", 1)[0].rstrip()
        if key:
            values[key] = val
    return values


def candidates() -> list[Path]:
    paths = [Path(p) for p in (os.environ.get("SWARM_ENV_FILE"),) if p]
    return paths + [Path.cwd() / ".env", ROOT / ".env"]


def load() -> Path | None:
    """Apply the first .env found. Returns its path, or None."""
    for path in candidates():
        if path.is_file():
            for key, val in parse(path.read_text()).items():
                if val and key not in os.environ:
                    os.environ[key] = val
            return path
    return None
