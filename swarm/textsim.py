"""Text similarity for duplicate detection and tool lookup.

Uses sentence-transformers when SWARM_EMBEDDINGS=1 and the package is importable,
otherwise a dependency-free TF-IDF cosine that is good enough for short issue
titles and tool descriptions.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from functools import lru_cache

_TOKEN = re.compile(r"[a-z0-9_]+")
_STOP = set(
    "a an the and or of to in on for with is are was were be been it this that when from at by as i we you "
    "my our can do does not no but if so into its".split()
)


def tokenize(text: str) -> list[str]:
    toks = []
    for t in _TOKEN.findall(text.lower()):
        if t in _STOP or len(t) < 2:
            continue
        toks.append(t)
        # Split identifiers like test_normalize_tags into parts too, so prose matches code names.
        if "_" in t:
            toks.extend(p for p in t.split("_") if len(p) > 1 and p not in _STOP)
    return toks


def _tfidf_vectors(docs: list[str]) -> list[dict[str, float]]:
    tokenized = [Counter(tokenize(d)) for d in docs]
    n = len(docs)
    df: Counter[str] = Counter()
    for c in tokenized:
        df.update(c.keys())
    vecs = []
    for c in tokenized:
        v = {t: (1 + math.log(f)) * (math.log((1 + n) / (1 + df[t])) + 1) for t, f in c.items()}
        norm = math.sqrt(sum(x * x for x in v.values())) or 1.0
        vecs.append({t: x / norm for t, x in v.items()})
    return vecs


@lru_cache(maxsize=1)
def _embedder():
    from sentence_transformers import SentenceTransformer  # optional dependency

    return SentenceTransformer("all-MiniLM-L6-v2")


def similarities(query: str, docs: list[str], use_embeddings: bool = False) -> list[float]:
    """Cosine similarity of `query` against each doc, in [0, 1]."""
    if not docs:
        return []
    if use_embeddings:
        try:
            model = _embedder()
            emb = model.encode([query, *docs], normalize_embeddings=True)
            return [float(max(0.0, emb[0] @ e)) for e in emb[1:]]
        except Exception:
            pass  # fall back to TF-IDF
    vecs = _tfidf_vectors([query, *docs])
    q = vecs[0]
    return [sum(q.get(t, 0.0) * w for t, w in d.items()) for d in vecs[1:]]
