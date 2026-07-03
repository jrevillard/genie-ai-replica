#!/usr/bin/env python3
# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Semantic passage matching for the re-ingest-proof gold format.

Complements the chunk-key-based metrics in ``metrics.py`` (hash equality) with
embedding-similarity matching against answer passages. The passage format
survives re-ingest, chunk-size changes, contextual-prefix changes — the gold
unit is the ANSWER, not the chunk artifact.

## How it works

A retrieved chunk "matches" a gold passage if:

    cosine(embed(chunk), embed(passage)) >= min_similarity

- Chunk embeddings are read straight from ArangoDB's stored ``embedding`` field
  (no re-embedding — uses the SAME vectors the retriever scores against).
- Passage embeddings are computed once via the deployed embedding endpoint
  (TEI/embedding service, same model as ingestion → vectors live in the same
  space). Cached per passage-text to avoid repeat work across rerun/AB.

## Metric semantics (mirror metrics.py)

- recall          = fraction of passages covered by >=1 SELECTED chunk
- precision       = fraction of selected chunks that match >=1 passage
- complete_recall = 1.0 iff every passage covered by a selected chunk
- noise           = 1 - precision
- retrieval_recall = fraction of passages covered by >=1 CANDIDATE (pre-rerank)

A chunk can match multiple passages (counts once per metric). Overlapping
chunks all match the same passage — no double-count penalty.

## Use

Construct once (embeds passages, caches), then call ``score`` per query:

    sm = SemanticMatcher(passage_texts, embed_fn, min_similarity=0.70)
    row = sm.score(query_id, candidate_keys, selected_keys)
"""

from __future__ import annotations

import json
import math
import os
import subprocess
from typing import Callable, Iterable

# --- env config (matches run_eval.py conventions) ---------------------------
CHATQNA_CONTAINER = os.getenv("CHATQNA_CONTAINER", "chatqna-xeon-backend-server")
# Embedding endpoint reachable from inside the chatqna container (same model the
# retriever uses, so chunk + passage vectors share a space).
EMBEDDING_URL = os.getenv(
    "EVAL_EMBEDDING_URL",
    # default: the internal embedding service the chatqna pipeline uses
    "http://embedding:6000/v1/embeddings",
)
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "")
DEFAULT_MIN_SIMILARITY = float(os.getenv("EVAL_MIN_SIMILARITY", "0.70"))


def _docker_exec_json(container: str, cmd: str, timeout: float = 120) -> dict | list:
    """Run a curl cmd inside the container via docker exec; parse JSON response."""
    result = subprocess.run(
        ["docker", "exec", container, "sh", "-c", cmd],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError(f"docker exec failed: {result.stderr.strip()[:300]}")
    return json.loads(result.stdout)


def embed_via_stack(texts: list[str]) -> list[list[float]]:
    """Embed a batch of texts via the deployed embedding endpoint (docker exec).

    Uses the OpenAI-compatible /v1/embeddings contract (TEI + the OPEA embedding
    wrapper both honor it). The endpoint is hit from inside the chatqna
    container so we stay on the overlay network.
    """
    if not texts:
        return []
    payload = {"input": texts}
    if EMBEDDING_MODEL:
        payload["model"] = EMBEDDING_MODEL
    # Escape single quotes for shell; payload is JSON so no nested quote hell.
    body = json.dumps(payload).replace("'", "'\\''")
    cmd = (
        f"curl -s -m 120 -X POST '{EMBEDDING_URL}' "
        f"-H 'Content-Type: application/json' -d '{body}'"
    )
    data = _docker_exec_json(CHATQNA_CONTAINER, cmd, timeout=150)
    # OpenAI shape: {"data": [{"embedding": [...], "index": i}, ...]}
    if isinstance(data, dict) and "data" in data:
        items = sorted(data["data"], key=lambda d: d.get("index", 0))
        return [item["embedding"] for item in items]
    raise RuntimeError(f"unexpected embedding response shape: {str(data)[:200]}")


def cosine(a: list[float], b: list[float]) -> float:
    """Cosine similarity. Returns 0.0 on empty/zero vectors (no division error)."""
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


class SemanticMatcher:
    """Embeds gold passages once, matches retrieved chunks by cosine similarity.

    Parameters
    ----------
    passages : list[str]
        The gold answer passages (one string per passage; multi-passage queries
        pass multiple entries).
    embed_fn : callable, optional
        ``texts -> list[list[float]]``. Defaults to ``embed_via_stack`` (hits the
        deployed embedding endpoint). Override for unit tests with a stub.
    min_similarity : float
        Match threshold. A chunk matches a passage when cosine >= this value.
    """

    def __init__(
        self,
        passages: list[str],
        embed_fn: Callable[[list[str]], list[list[float]]] | None = None,
        min_similarity: float = DEFAULT_MIN_SIMILARITY,
    ):
        self.min_similarity = min_similarity
        self._embed_fn = embed_fn or embed_via_stack
        # Dedupe passage texts — same passage text across queries embeds once.
        unique = list(dict.fromkeys(passages))
        self._unique = unique
        if unique:
            vecs = self._embed_fn(unique)
            self._passage_vec = {t: v for t, v in zip(unique, vecs)}
        else:
            self._passage_vec = {}
        # Cache: chunk_key -> embedding vector (ArangoDB lookup is the slow path).
        self._chunk_vec_cache: dict[str, list[float] | None] = {}

    def get_chunk_vectors(
        self, chunk_keys: Iterable[str], fetch_fn
    ) -> dict[str, list[float] | None]:
        """Resolve chunk embeddings, caching results.

        ``fetch_fn(keys) -> {key: vector | None}`` is provided by the caller
        (typically an ArangoDB AQL lookup of the stored ``embedding`` field).
        Only uncached keys are fetched.
        """
        missing = [k for k in chunk_keys if k not in self._chunk_vec_cache]
        if missing:
            fetched = fetch_fn(missing)
            for k in missing:
                self._chunk_vec_cache[k] = fetched.get(k)
        return {k: self._chunk_vec_cache.get(k) for k in chunk_keys}

    def _matches(
        self, chunk_vecs: dict[str, list[float] | None], passage_texts: list[str]
    ) -> tuple[set[str], set[str]]:
        """Return (passages_covered_set, chunks_matching_set) for one query."""
        covered_passages: set[str] = set()  # indices into passage_texts
        matching_chunks: set[str] = set()
        for p_idx, ptext in enumerate(passage_texts):
            pvec = self._passage_vec.get(ptext)
            if pvec is None:
                continue
            for ckey, cvec in chunk_vecs.items():
                if cvec is None:
                    continue
                if cosine(pvec, cvec) >= self.min_similarity:
                    covered_passages.add(p_idx)
                    matching_chunks.add(ckey)
        return covered_passages, matching_chunks

    def score(
        self,
        query_id: str,
        candidate_keys: list[str],
        selected_keys: list[str],
        passage_texts: list[str],
        fetch_fn,
    ) -> dict:
        """Score one query: how well do selected/candidate chunks cover the passages?

        ``fetch_fn(keys) -> {key: vector | None}`` resolves chunk embeddings.

        Returns a dict with semantic-matching metrics. Mirrors the keys
        ``metrics.py`` produces (recall/precision/complete_recall/noise/
        retrieval_recall) so the same aggregate + reporting path works.
        """
        if not passage_texts:
            # No gold for this query — vacuously perfect (consistent with metrics.py).
            return {
                "id": query_id,
                "match_method": "embedding_similarity",
                "n_passages": 0,
                "n_candidates": len(candidate_keys),
                "n_selected": len(selected_keys),
                "recall": 1.0,
                "precision": 1.0 if selected_keys else 0.0,
                "complete_recall": 1.0,
                "noise": 0.0,
                "retrieval_recall": 1.0,
            }
        # Resolve embeddings for every chunk involved (candidates + selected).
        all_keys = list(dict.fromkeys([*candidate_keys, *selected_keys]))
        chunk_vecs = self.get_chunk_vectors(all_keys, fetch_fn)

        cand_vecs = {k: chunk_vecs.get(k) for k in candidate_keys}
        sel_vecs = {k: chunk_vecs.get(k) for k in selected_keys}

        sel_covered, sel_matching = self._matches(sel_vecs, passage_texts)
        cand_covered, _ = self._matches(cand_vecs, passage_texts)

        n_passages = len(passage_texts)
        n_selected = len(selected_keys)
        recall = len(sel_covered) / n_passages
        precision = (len(sel_matching) / n_selected) if n_selected else 0.0
        complete_recall = 1.0 if len(sel_covered) == n_passages else 0.0
        noise = 1.0 - precision
        retrieval_recall = len(cand_covered) / n_passages

        return {
            "id": query_id,
            "match_method": "embedding_similarity",
            "min_similarity": self.min_similarity,
            "n_passages": n_passages,
            "n_candidates": len(candidate_keys),
            "n_selected": n_selected,
            "n_passages_covered_by_selected": len(sel_covered),
            "n_passages_covered_by_candidates": len(cand_covered),
            "recall": recall,
            "precision": precision,
            "complete_recall": complete_recall,
            "noise": noise,
            "retrieval_recall": retrieval_recall,
        }


def aggregate(rows: list[dict]) -> dict:
    """Mean semantic metrics across rows (mirrors metrics.aggregate)."""
    rows = [r for r in rows if r.get("n_passages", 0) > 0]
    n = len(rows)
    if n == 0:
        return {
            "n": 0,
            "recall": 0.0,
            "precision": 0.0,
            "complete_recall": 0.0,
            "noise": 0.0,
        }
    keys = ["recall", "precision", "complete_recall", "noise", "retrieval_recall"]
    return {"n": n, **{k: sum(r.get(k, 0.0) for r in rows) / n for k in keys}}
