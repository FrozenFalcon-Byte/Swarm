"""Tool registry: agent-written tools, searchable by what they do, reused across tasks."""

from __future__ import annotations

import json
import threading
from pathlib import Path

from pydantic import BaseModel, Field

from .board.models import utcnow
from .textsim import similarities


class ToolRecord(BaseModel):
    tool_id: str
    description: str
    code_path: str
    created_by_task: str
    validated: bool = False
    usage_count: int = 0
    tags: list[str] = Field(default_factory=list)
    validation: dict = Field(default_factory=dict)
    used_by_tasks: list[str] = Field(default_factory=list)
    created_at: str = Field(default_factory=utcnow)


class ToolRegistry:
    def __init__(self, tools_dir: Path, use_embeddings: bool = False):
        self.dir = tools_dir
        self.dir.mkdir(parents=True, exist_ok=True)
        self.index_path = self.dir / "registry.json"
        self.use_embeddings = use_embeddings
        self._lock = threading.Lock()

    def all(self) -> list[ToolRecord]:
        if not self.index_path.exists():
            return []
        return [ToolRecord.model_validate(r) for r in json.loads(self.index_path.read_text())]

    def _write(self, records: list[ToolRecord]) -> None:
        self.index_path.write_text(json.dumps([r.model_dump() for r in records], indent=2))

    def get(self, tool_id: str) -> ToolRecord | None:
        return next((r for r in self.all() if r.tool_id == tool_id), None)

    def search(self, query: str, min_score: float = 0.35, validated_only: bool = True) -> list[tuple[ToolRecord, float]]:
        """Existing tools whose description is close to `query`, best first."""
        records = [r for r in self.all() if r.validated or not validated_only]
        if not records:
            return []
        docs = [f"{r.description} {' '.join(r.tags)}" for r in records]
        scored = zip(records, similarities(query, docs, self.use_embeddings))
        return sorted(((r, round(s, 3)) for r, s in scored if s >= min_score), key=lambda x: -x[1])

    def register(self, tool_id: str, description: str, code: str, task_id: str, tags: list[str],
                 validated: bool, validation: dict) -> ToolRecord:
        with self._lock:
            path = self.dir / f"{tool_id}.py"
            path.write_text(code)
            records = [r for r in self.all() if r.tool_id != tool_id]
            rec = ToolRecord(tool_id=tool_id, description=description, code_path=str(path), created_by_task=task_id,
                             validated=validated, tags=tags, validation=validation,
                             usage_count=1, used_by_tasks=[task_id])
            records.append(rec)
            self._write(records)
            return rec

    def record_use(self, tool_id: str, task_id: str) -> None:
        with self._lock:
            records = self.all()
            for r in records:
                if r.tool_id == tool_id:
                    r.usage_count += 1
                    if task_id not in r.used_by_tasks:
                        r.used_by_tasks.append(task_id)
            self._write(records)

    def next_id(self, stem: str) -> str:
        n = sum(1 for r in self.all() if r.tool_id.startswith(stem)) + 1
        return f"{stem}_v{n}"
