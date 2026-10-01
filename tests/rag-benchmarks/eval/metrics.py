# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Retrieval-quality metrics for reranker chunk selection.

Operates on canonical chunk identity strings (content_hash — the ``_key`` emitted
by chatqna is projected to ``content_hash`` in ``run_eval.score_anchor``).

The ``selected`` iterable is assumed ORDERED best-first (highest reranker score
first) — this is the order chatqna emits via ``_emit_reranker_selection_span``
(``[text_to_chunk_key.get(...) for d in reranked_docs_with_scores]``). Set-based
metrics (recall, precision, complete_recall, noise) ignore order; the rank-aware
metrics (recall@k, NDCG@k) take the first ``k`` elements as the top-k.

Per-query definitions (averaged across the gold dataset by ``aggregate``):
    recall          = |gold ∩ selected| / |gold|                  (set, ignores order)
    precision       = |gold ∩ selected| / |selected|              (set, ignores order)
    complete_recall = 1.0 iff every gold chunk was selected, else 0.0
    noise           = 1.0 - precision
    recall@k        = |gold ∩ selected[:k]| / |gold|              (rank-aware)
    ndcg@k          = DCG@k(binary relevance) / IDCG@k            (rank-aware)
    retrieval_recall = |gold ∩ candidates| / |gold|              (pre-rerank)

Rank-aware metrics assume ``selected`` is best-first; if the order is unknown
or unranked, fall back to the set-based metrics.

The k values reported by ``aggregate`` mirror the IR standard set (BEIR /
MS-MARCO): recall@1, recall@3, recall@5, recall@10, ndcg@1, ndcg@3, ndcg@5,
ndcg@10. Pick these when comparing against published numbers; ``ndcg@20`` /
``recall@20`` are trivial to add by extending the ``RANK_AWARE_K`` tuple.
"""

from __future__ import annotations

import math
from collections.abc import Iterable

Keys = Iterable[str]

# IR-standard k values reported by `aggregate`. Edit here to add or remove
# values; downstream code (run_eval score_anchor, capture_baseline tolerance)
# auto-discovers via per-row presence.
RANK_AWARE_K: tuple[int, ...] = (1, 3, 5, 10)


def recall(gold: Keys, selected: Keys) -> float:
    """Recall = fraction of gold chunks that survived reranker selection.

    Set-based: order ignored. Vacuously true (1.0) on empty gold.
    """
    g, s = set(gold), set(selected)
    if not g:
        return 1.0
    return len(g & s) / len(g)


def precision(gold: Keys, selected: Keys) -> float:
    """Precision = fraction of selected chunks that are gold (relevant).

    Set-based: order ignored. 0.0 on empty selected (no signal).
    """
    g, s = set(gold), set(selected)
    if not s:
        return 0.0
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


def recall_at_k(gold: Keys, selected: Keys, k: int) -> float:
    """Recall@k = fraction of gold chunks present in the top-``k`` of ``selected``.

    Rank-aware: order of ``selected`` matters (assumed best-first). On empty
    gold the metric is vacuously 1.0 (consistent with ``recall``). On ``k > len(selected)``
    the metric reduces to recall over whatever was selected — not zero.

    ``selected`` is deduplicated (first-occurrence wins) before slicing to top-``k``;
    a chunk emitted twice by the reranker is one rank position, not two.
    """
    if k < 1:
        raise ValueError(f"k must be a positive integer, got {k}")
    g = set(gold)
    if not g:
        return 1.0
    topk: list[str] = []
    seen: set[str] = set()
    for doc in selected:
        if doc in seen:
            continue
        seen.add(doc)
        topk.append(doc)
        if len(topk) == k:
            break
    return len(g & set(topk)) / len(g)


def ndcg_at_k(gold: Keys, selected: Keys, k: int) -> float:
    """NDCG@k with binary relevance (1 if chunk ∈ gold, else 0).

    DCG@k = sum_{i=0}^{k-1} rel_i / log2(i + 2)
    IDCG@k = sum_{i=0}^{min(k, |gold|) - 1} 1 / log2(i + 2)
    NDCG@k = DCG@k / IDCG@k

    Rank-aware: assumes ``selected`` is best-first. Returns 1.0 on empty gold
    (vacuous), 0.0 on empty selected (no ranking signal). When ``k > len(selected)``
    IDCG caps at min(k, |gold|) — the ideal achievable with the available
    gold set, not with ``selected``.

    ``selected`` is deduplicated (first-occurrence wins) before ranking, so a
    chunk emitted twice by the reranker contributes a single DCG term and
    cannot push NDCG above 1.0.
    """
    if k < 1:
        raise ValueError(f"k must be a positive integer, got {k}")
    g = set(gold)
    if not g:
        return 1.0
    if not selected:
        return 0.0

    # Dedupe while preserving rank order — first occurrence wins.
    seen: set[str] = set()
    s: list[str] = []
    for doc in selected:
        if doc in seen:
            continue
        seen.add(doc)
        s.append(doc)
        if len(s) == k:
            break

    # DCG over top-k (binary rel: 1 if selected[i] in gold)
    dcg = 0.0
    for i in range(min(k, len(s))):
        if s[i] in g:
            dcg += 1.0 / math.log2(i + 2)

    # IDCG: ideal ranking would put all |gold| relevant docs at the top,
    # capped at k positions.
    ideal_hits = min(k, len(g))
    idcg = sum(1.0 / math.log2(i + 2) for i in range(ideal_hits))
    if idcg == 0.0:
        return 0.0
    return dcg / idcg


def aggregate(rows):
    """Mean metrics across a list of per-query result dicts.

    Each row must already carry scalar metric fields (``recall``, ``precision``,
    ``complete_recall``, ``noise``); ``retrieval_recall`` is included when every
    row has it. Rank-aware metrics (``recall@k``, ``ndcg@k`` for ``k`` in
    ``RANK_AWARE_K``) are included when every row has them — so legacy reports
    (pre-this-change) still aggregate cleanly without the new fields.

    Returns ``{"n": count, "<metric>": mean, ...}``.
    """
    rows = list(rows)
    n = len(rows)
    if n == 0:
        return {"n": 0, **{k: 0.0 for k in _aggregate_keys([])}}

    keys = _aggregate_keys(rows)

    return {"n": n, **{k: sum(r[k] for r in rows) / n for k in keys}}


def _aggregate_keys(rows: list[dict]) -> list[str]:
    """Canonical metric ordering for ``aggregate`` output.

    Used by both the populated and empty-rows paths so the two paths stay in
    sync — adding a new rank-aware ``k`` to ``RANK_AWARE_K`` automatically
    extends the empty-rows envelope too. Set-based metrics always emit;
    ``retrieval_recall`` and rank-aware fields are opt-in per row so legacy
    reports still aggregate cleanly.
    """
    keys = ["recall", "precision", "complete_recall", "noise"]
    if all("retrieval_recall" in r for r in rows):
        keys.append("retrieval_recall")
    for k in RANK_AWARE_K:
        if all(f"recall_at_{k}" in r for r in rows):
            keys.append(f"recall_at_{k}")
        if all(f"ndcg_at_{k}" in r for r in rows):
            keys.append(f"ndcg_at_{k}")
    return keys
