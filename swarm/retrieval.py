"""Lightweight repo index: python symbols plus ranked chunk retrieval for agent context."""

from __future__ import annotations

import ast
from dataclasses import dataclass
from pathlib import Path

from .textsim import similarities

SKIP_DIRS = {".git", ".venv", "venv", "__pycache__", "node_modules", ".swarm", ".pytest_cache", "build", "dist"}


@dataclass
class Symbol:
    name: str
    kind: str  # function | class
    path: str  # relative
    lineno: int
    end_lineno: int
    source: str
    calls: list[str]


class RepoIndex:
    def __init__(self, root: Path):
        self.root = root
        self.files: dict[str, str] = {}
        self.symbols: list[Symbol] = []
        self.build()

    def build(self) -> None:
        self.files.clear()
        self.symbols.clear()
        for p in sorted(self.root.rglob("*.py")):
            if any(part in SKIP_DIRS for part in p.relative_to(self.root).parts):
                continue
            rel = p.relative_to(self.root).as_posix()
            text = p.read_text(errors="replace")
            self.files[rel] = text
            try:
                tree = ast.parse(text)
            except SyntaxError:
                continue
            lines = text.splitlines()
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    calls = sorted(
                        {
                            (c.func.id if isinstance(c.func, ast.Name) else c.func.attr)
                            for c in ast.walk(node)
                            if isinstance(c, ast.Call) and isinstance(c.func, (ast.Name, ast.Attribute))
                        }
                    )
                    self.symbols.append(
                        Symbol(
                            name=node.name,
                            kind="class" if isinstance(node, ast.ClassDef) else "function",
                            path=rel,
                            lineno=node.lineno,
                            end_lineno=node.end_lineno or node.lineno,
                            source="\n".join(lines[node.lineno - 1 : node.end_lineno]),
                            calls=calls,
                        )
                    )

    @staticmethod
    def is_test_path(path: str) -> bool:
        name = Path(path).name
        return name.startswith("test_") or name.endswith("_test.py") or "/tests/" in f"/{path}"

    def find(self, name: str, tests: bool | None = None) -> list[Symbol]:
        out = [s for s in self.symbols if s.name == name]
        if tests is not None:
            out = [s for s in out if self.is_test_path(s.path) == tests]
        return out

    def source_symbols_called_by(self, test: Symbol) -> list[Symbol]:
        """Non-test functions a test calls: the code under test."""
        found: list[Symbol] = []
        for call in test.calls:
            for s in self.find(call, tests=False):
                if s not in found:
                    found.append(s)
        return found

    def tests_referencing(self, name: str) -> list[Symbol]:
        return [s for s in self.symbols if self.is_test_path(s.path) and name in s.calls]

    def search(self, query: str, k: int = 5) -> list[Symbol]:
        if not self.symbols:
            return []
        docs = [f"{s.name} {s.path} {s.source}" for s in self.symbols]
        scores = similarities(query, docs)
        ranked = sorted(zip(scores, range(len(docs))), reverse=True)[:k]
        return [self.symbols[i] for score, i in ranked if score > 0]
