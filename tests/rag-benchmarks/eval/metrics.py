# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Retrieval-quality metrics for reranker chunk selection.

Operates on sets of canonical chunk ``_key`` strings — the identity chatqna
emits via the ``rag.selected_chunk_ids`` / ``rag.candidate_chunk_ids`` span
attributes (see ``chatqna._emit_reranker_selection_span``).

Per-query definitions (averaged across the gold dataset by ``evaluate``):
    recall          = |gold ∩ selected| / |gold|
    precision       = |gold ∩ selected| / |selected|
    complete_recall = 1.0 iff every gold chunk was selected, else 0.0
    noise           = 1.0 - precision   (irrelevant selected / total selected)

When candidate keys are available (pre-rerank), ``retrieval_recall`` separates
retriever failure (gold never retrieved) from reranker failure (gold retrieved
but dropped): retrieval_recall = |gold ∩ candidates| / |gold|.
"""

from __future__ import annotations

from collections.abc import Iterable

Keys = Iterable[str]


def recall(gold: Keys, selected: Keys) -> float:
    """Recall = fraction of gold chunks that survived reranker selection."""
    g, s = set(gold), set(selected)
    if not g:
        return 1.0  # vacuously true: nothing to retrieve
    return len(g & s) / len(g)


def precision(gold: Keys, selected: Keys) -> float:
    """Precision = fraction of selected chunks that are gold (relevant)."""
    g, s = set(gold), set(selected)
    if not s:
        return 0.0  # nothing selected → no precision signal
    return len(g & s) / len(s)


def complete_recall(gold: Keys, selected: Keys) -> float:
    """1.0 iff ALL gold chunks were selected (complete hit), else 0.0."""
    g, s = set(gold), set(selected)
    if not g:
        return 1.0
    return 1.0 if g.issubset(s) else 0.0


def noise(gold: Keys, selected: Keys) -> float:
    """Noise = fraction of selected chunks that are NOT gold (1 - precision)."""
    return 1.0 - precision(gold, selected)


def retrieval_recall(gold: Keys, candidates: Keys) -> float:
    """Was the gold chunk even retrieved (pre-rerank)? Isolates retriever vs reranker failure."""
    g, c = set(gold), set(candidates)
    if not g:
        return 1.0
    return len(g & c) / len(g)


def aggregate(rows):
    """Mean metrics across a list of per-query result dicts.

    Each row must already carry scalar metric fields (``recall``, ``precision``,
    ``complete_recall``, ``noise``); ``retrieval_recall`` is included when present.
    Returns ``{"n": count, "<metric>": mean, ...}``.
    """
    rows = list(rows)
    n = len(rows)
    if n == 0:
        return {"n": 0, "recall": 0.0, "precision": 0.0, "complete_recall": 0.0, "noise": 0.0}
    keys = ["recall", "precision", "complete_recall", "noise"]
    has_candidates = all("retrieval_recall" in r for r in rows)
    if has_candidates:
        keys.append("retrieval_recall")
    return {"n": n, **{k: sum(r[k] for r in rows) / n for k in keys}}
