"""Repo-scoped tool registry: records in Firestore (repos/{id}/tools), code in
Cloud Storage (repos/{id}/tools/{tool_id}.py), cached locally for execution."""

from __future__ import annotations

from pathlib import Path

from ..registry import ToolRecord
from ..textsim import similarities


class FirestoreToolRegistry:
    def __init__(self, db, bucket, repo_id: str, cache_dir: Path, use_embeddings: bool = False):
        self.col = db.collection("repos").document(repo_id).collection("tools")
        self.bucket = bucket
        self.repo_id = repo_id
        self.dir = cache_dir
        self.dir.mkdir(parents=True, exist_ok=True)
        self.use_embeddings = use_embeddings

    def _blob(self, tool_id: str):
        return self.bucket.blob(f"repos/{self.repo_id}/tools/{tool_id}.py")

    def _local(self, rec: ToolRecord) -> ToolRecord:
        path = self.dir / f"{rec.tool_id}.py"
        if not path.exists():
            path.write_text(self._blob(rec.tool_id).download_as_text())
        rec.code_path = str(path)
        return rec

    def all(self) -> list[ToolRecord]:
        return sorted((ToolRecord.model_validate(s.to_dict()) for s in self.col.stream()), key=lambda r: r.created_at)

    def get(self, tool_id: str) -> ToolRecord | None:
        snap = self.col.document(tool_id).get()
        return self._local(ToolRecord.model_validate(snap.to_dict())) if snap.exists else None

    def search(self, query: str, min_score: float = 0.35, validated_only: bool = True) -> list[tuple[ToolRecord, float]]:
        records = [r for r in self.all() if r.validated or not validated_only]
        if not records:
            return []
        docs = [f"{r.description} {' '.join(r.tags)}" for r in records]
        scored = zip(records, similarities(query, docs, self.use_embeddings))
        hits = sorted(((r, round(s, 3)) for r, s in scored if s >= min_score), key=lambda x: -x[1])
        return [(self._local(r), s) for r, s in hits]

    def register(self, tool_id: str, description: str, code: str, task_id: str, tags: list[str],
                 validated: bool, validation: dict) -> ToolRecord:
        self._blob(tool_id).upload_from_string(code, content_type="text/x-python")
        path = self.dir / f"{tool_id}.py"
        path.write_text(code)
        rec = ToolRecord(tool_id=tool_id, description=description, code_path=str(path), created_by_task=task_id,
                         validated=validated, tags=tags, validation=validation, usage_count=1, used_by_tasks=[task_id])
        doc = rec.model_dump()
        doc["storage_path"] = self._blob(tool_id).name
        self.col.document(tool_id).set(doc)
        return rec

    def record_use(self, tool_id: str, task_id: str) -> None:
        from google.cloud import firestore as gfs

        self.col.document(tool_id).update({"usage_count": gfs.Increment(1), "used_by_tasks": gfs.ArrayUnion([task_id])})

    def next_id(self, stem: str) -> str:
        n = sum(1 for r in self.all() if r.tool_id.startswith(stem)) + 1
        return f"{stem}_v{n}"
