# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Unit tests for semantic_match — embedding-similarity gold passage matching.

Uses a stub embed_fn (deterministic vectors) so tests run without the deployed
embedding endpoint. The stub maps known strings to fixed vectors; cosine math
and threshold behavior are the unit under test.
"""

from __future__ import annotations

import math

import semantic_match


# Stub embedding: each keyword maps to a fixed orthogonal-ish vector. Strings
# using the same keyword embed identically; cosine of (a, a) = 1.0; cosine of
# unrelated keywords ≈ 0.0.
def _vec(idx: int, dim: int = 8) -> list[float]:
    v = [0.0] * dim
    v[idx % dim] = 1.0
    return v


_KEYWORDS = {"blossom": _vec(0), "tomato": _vec(1), "water": _vec(2), "soil": _vec(3)}


def _stub_embed(texts: list[str]) -> list[list[float]]:
    """Embed by keyword lookup; unknown strings get a unique-ish vector."""
    out = []
    for i, t in enumerate(texts):
        kw = next((k for k in _KEYWORDS if k in t.lower()), None)
        out.append(_KEYWORDS[kw] if kw else _vec(4 + (i % 4)))
    return out


def _matcher(min_similarity: float = 0.70) -> semantic_match.SemanticMatcher:
    return semantic_match.SemanticMatcher(
        ["blossom end rot", "tomato watering"],
        embed_fn=_stub_embed,
        min_similarity=min_similarity,
    )


def _fetch(keys: list[str]) -> dict[str, list[float] | None]:
    """Stub chunk-vector fetch: every key embeds to its keyword vector."""
    return {k: _stub_embed([k])[0] for k in keys}


# --- cosine ------------------------------------------------------------------


def test_cosine_identical_vectors_is_one():
    assert math.isclose(semantic_match.cosine([1, 0, 0], [1, 0, 0]), 1.0)


def test_cosine_orthogonal_vectors_is_zero():
    assert math.isclose(semantic_match.cosine([1, 0], [0, 1]), 0.0, abs_tol=1e-9)


def test_cosine_zero_vector_returns_zero_not_nan():
    assert semantic_match.cosine([0, 0, 0], [1, 0, 0]) == 0.0


# --- SemanticMatcher.score ---------------------------------------------------


def test_perfect_match_passages_covered_by_selected():
    sm = _matcher()
    # chunk "blossom on tomato" embeds as either blossom or tomato (blossom wins
    # by dict-iteration order); make the chunk text match the passage keyword
    # directly so the cosine is 1.0.
    row = sm.score(
        "q1",
        candidate_keys=["blossom"],
        selected_keys=["blossom"],
        passage_texts=["blossom end rot"],
        fetch_fn=_fetch,
    )
    assert row["recall"] == 1.0
    assert row["retrieval_recall"] == 1.0
    assert row["n_passages_covered_by_selected"] == 1
    assert row["n_passages"] == 1


def test_no_match_when_selected_chunk_is_unrelated():
    sm = _matcher()
    row = sm.score(
        "q1",
        candidate_keys=["water"],  # unrelated to "blossom end rot"
        selected_keys=["water"],
        passage_texts=["blossom end rot"],
        fetch_fn=_fetch,
    )
    assert row["recall"] == 0.0
    assert row["precision"] == 0.0
    assert row["noise"] == 1.0


def test_retrieval_recall_separates_retriever_and_reranker_failure():
    """Gold in CANDIDATES but not SELECTED → retrieval_recall=1, recall=0."""
    sm = _matcher()
    row = sm.score(
        "q1",
        candidate_keys=["blossom", "water"],
        selected_keys=["water"],  # reranker dropped the matching chunk
        passage_texts=["blossom end rot"],
        fetch_fn=_fetch,
    )
    assert row["retrieval_recall"] == 1.0
    assert row["recall"] == 0.0


def test_precision_counts_selected_chunks_matching_any_passage():
    sm = _matcher()
    row = sm.score(
        "q1",
        candidate_keys=["blossom", "water", "soil"],
        selected_keys=["blossom", "water"],  # 1 matches, 1 is noise
        passage_texts=["blossom end rot"],
        fetch_fn=_fetch,
    )
    assert row["n_selected"] == 2
    assert row["precision"] == 0.5
    assert row["noise"] == 0.5


def test_threshold_governs_match():
    """At min_sim=1.0 only perfect matches count; at 0.0 everything matches."""
    # Perfect-match-only: unrelated chunk dropped
    sm_strict = _matcher(min_similarity=1.0)
    row = sm_strict.score(
        "q1",
        candidate_keys=["water"],
        selected_keys=["water"],
        passage_texts=["blossom end rot"],
        fetch_fn=_fetch,
    )
    assert row["recall"] == 0.0
    # Permissive: unrelated chunk counts (cosine 0 >= 0)
    sm_loose = _matcher(min_similarity=0.0)
    row = sm_loose.score(
        "q1",
        candidate_keys=["water"],
        selected_keys=["water"],
        passage_texts=["blossom end rot"],
        fetch_fn=_fetch,
    )
    assert row["recall"] == 1.0


def test_multi_passage_complete_recall_only_when_all_covered():
    sm = _matcher()
    # Both passages have a matching selected chunk → complete
    row = sm.score(
        "q1",
        candidate_keys=["blossom", "tomato"],
        selected_keys=["blossom", "tomato"],
        passage_texts=["blossom end rot", "tomato watering"],
        fetch_fn=_fetch,
    )
    assert row["recall"] == 1.0
    assert row["complete_recall"] == 1.0
    # Only one of two → partial, complete_recall=0
    row2 = sm.score(
        "q1",
        candidate_keys=["blossom", "tomato"],
        selected_keys=["blossom"],
        passage_texts=["blossom end rot", "tomato watering"],
        fetch_fn=_fetch,
    )
    assert row2["recall"] == 0.5
    assert row2["complete_recall"] == 0.0


def test_no_passages_is_vacuously_perfect():
    sm = _matcher()
    row = sm.score(
        "q1",
        candidate_keys=["blossom"],
        selected_keys=["blossom"],
        passage_texts=[],  # no gold
        fetch_fn=_fetch,
    )
    assert row["recall"] == 1.0
    assert row["complete_recall"] == 1.0


def test_missing_chunk_embedding_doesnt_crash():
    """A chunk_key with no vector (missing/None) is skipped, not scored."""
    sm = _matcher()

    def fetch_with_missing(keys):
        return {k: None for k in keys}  # all missing

    row = sm.score(
        "q1",
        candidate_keys=["blossom"],
        selected_keys=["blossom"],
        passage_texts=["blossom end rot"],
        fetch_fn=fetch_with_missing,
    )
    assert row["recall"] == 0.0  # no vector → no match


def test_chunk_vector_cache_avoids_refetch():
    """A repeated key is fetched once (the cache returns the cached vector)."""
    sm = _matcher()
    calls = []

    def counting_fetch(keys):
        calls.append(list(keys))
        return {k: _stub_embed([k])[0] for k in keys}

    # First query fetches the key
    sm.score("q1", ["blossom"], ["blossom"], ["blossom end rot"], counting_fetch)
    # Second query with the same key should NOT refetch it
    sm.score(
        "q2", ["blossom", "water"], ["blossom"], ["blossom end rot"], counting_fetch
    )
    # Only 'water' should be fetched in the second call (blossom was cached)
    assert calls[1] == ["water"]


# --- aggregate ---------------------------------------------------------------


def test_aggregate_means_across_rows():
    rows = [
        {
            "recall": 1.0,
            "precision": 0.5,
            "complete_recall": 1.0,
            "noise": 0.5,
            "retrieval_recall": 1.0,
            "n_passages": 1,
        },
        {
            "recall": 0.0,
            "precision": 0.0,
            "complete_recall": 0.0,
            "noise": 1.0,
            "retrieval_recall": 0.0,
            "n_passages": 1,
        },
    ]
    agg = semantic_match.aggregate(rows)
    assert agg["n"] == 2
    assert math.isclose(agg["recall"], 0.5)
    assert math.isclose(agg["precision"], 0.25)


def test_aggregate_skips_zero_passage_rows():
    """Rows with n_passages=0 (vacuous) are excluded from the mean."""
    rows = [
        {
            "recall": 1.0,
            "precision": 1.0,
            "complete_recall": 1.0,
            "noise": 0.0,
            "retrieval_recall": 1.0,
            "n_passages": 2,
        },
        {
            "recall": 1.0,
            "precision": 1.0,
            "complete_recall": 1.0,
            "noise": 0.0,
            "retrieval_recall": 1.0,
            "n_passages": 0,
        },
    ]
    agg = semantic_match.aggregate(rows)
    assert agg["n"] == 1  # only the n_passages=2 row counted
