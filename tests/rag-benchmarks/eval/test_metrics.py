# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Unit tests for retrieval-quality metrics (pure functions, no env deps)."""

import math

import metrics  # sys.path manipulated by pytest.ini / conftest


def _approx(a, b):
    return math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-9)


# --- recall -----------------------------------------------------------------


def test_recall_full_hit():
    assert _approx(metrics.recall(["a", "b"], ["a", "b", "c"]), 1.0)


def test_recall_partial():
    # 1 of 2 gold found → 0.5
    assert _approx(metrics.recall(["a", "b"], ["a", "x"]), 0.5)


def test_recall_none_found():
    assert _approx(metrics.recall(["a", "b"], ["x", "y"]), 0.0)


def test_recall_empty_gold_is_vacuously_one():
    assert _approx(metrics.recall([], ["x", "y"]), 1.0)


# --- precision --------------------------------------------------------------


def test_precision_all_relevant():
    assert _approx(metrics.precision(["a", "b"], ["a", "b"]), 1.0)


def test_precision_some_noise():
    # 2 gold out of 4 selected → 0.5
    assert _approx(metrics.precision(["a", "b"], ["a", "b", "x", "y"]), 0.5)


def test_precision_nothing_selected_is_zero():
    assert _approx(metrics.precision(["a"], []), 0.0)


# --- complete_recall --------------------------------------------------------


def test_complete_recall_all_selected():
    assert _approx(metrics.complete_recall(["a", "b"], ["a", "b", "c"]), 1.0)


def test_complete_recall_partial_is_zero():
    assert _approx(metrics.complete_recall(["a", "b"], ["a"]), 0.0)


# --- noise ------------------------------------------------------------------


def test_noise_is_one_minus_precision():
    # precision 0.5 → noise 0.5
    assert _approx(metrics.noise(["a", "b"], ["a", "b", "x", "y"]), 0.5)


def test_noise_zero_when_all_selected_relevant():
    assert _approx(metrics.noise(["a", "b"], ["a", "b"]), 0.0)


# --- retrieval_recall -------------------------------------------------------


def test_retrieval_recall_isolates_retriever_failure():
    # gold 'b' never retrieved (not in candidates) → 0.5, even if reranker is perfect
    assert _approx(metrics.retrieval_recall(["a", "b"], ["a", "c"]), 0.5)


# --- recall_at_k ------------------------------------------------------------


def test_recall_at_k_perfect_top():
    # gold 'a' at position 0 (best-first), k=1 → recall@1 = 1.0
    assert _approx(metrics.recall_at_k(["a"], ["a", "b", "c"], k=1), 1.0)


def test_recall_at_k_miss_at_k():
    # gold 'a' at position 2, k=1 → recall@1 = 0.0; k=3 → recall@3 = 1.0
    assert _approx(metrics.recall_at_k(["a"], ["x", "y", "a"], k=1), 0.0)
    assert _approx(metrics.recall_at_k(["a"], ["x", "y", "a"], k=3), 1.0)


def test_recall_at_k_partial():
    # 1 of 2 gold in top-1 → 0.5
    assert _approx(metrics.recall_at_k(["a", "b"], ["a", "x"], k=1), 0.5)
    # 2 of 2 in top-2
    assert _approx(metrics.recall_at_k(["a", "b"], ["a", "b"], k=2), 1.0)


def test_recall_at_k_k_exceeds_selected():
    # k > len(selected): falls back to recall over whatever was selected
    assert _approx(metrics.recall_at_k(["a", "b"], ["a"], k=5), 0.5)


def test_recall_at_k_empty_gold_is_vacuously_one():
    assert _approx(metrics.recall_at_k([], ["x", "y"], k=1), 1.0)


def test_recall_at_k_zero_k_raises():
    import pytest

    with pytest.raises(ValueError, match="k must be a positive integer"):
        metrics.recall_at_k(["a"], ["a"], k=0)


def test_recall_at_k_negative_k_raises():
    import pytest

    with pytest.raises(ValueError, match="k must be a positive integer"):
        metrics.recall_at_k(["a"], ["a"], k=-1)


def test_recall_at_k_dedupes_selected():
    # gold 'a' emitted twice in selected → still 1.0, no double-count.
    assert _approx(metrics.recall_at_k(["a"], ["a", "a", "b"], k=3), 1.0)
    # Top-1 of [a, a, b] is 'a' → recall@1 still 1.0.
    assert _approx(metrics.recall_at_k(["a"], ["a", "a", "b"], k=1), 1.0)
    # gold 'a' dupes, 'a' is in top-1 only by dedupe (a@0 == a@1).
    assert _approx(metrics.recall_at_k(["a", "b"], ["a", "a", "b"], k=2), 1.0)


# --- ndcg_at_k --------------------------------------------------------------


def test_ndcg_at_k_perfect_top():
    # gold 'a' at position 0, k=1: DCG = 1/log2(2) = 1.0; IDCG = 1.0; NDCG = 1.0
    assert _approx(metrics.ndcg_at_k(["a"], ["a", "b"], k=1), 1.0)


def test_ndcg_at_k_wrong_position():
    # gold 'a' at position 1, k=1: DCG = 0; IDCG = 1.0; NDCG = 0.0
    assert _approx(metrics.ndcg_at_k(["a"], ["x", "a"], k=1), 0.0)


def test_ndcg_at_k_partial_ranking():
    # gold = {a, b}, selected = [a, x]; k=2
    # DCG = 1/log2(2) + 0/log2(3) = 1.0
    # IDCG = 1/log2(2) + 1/log2(3) = 1 + 0.6309... ≈ 1.6309
    # NDCG = 1.0 / 1.6309 ≈ 0.6131
    expected = 1.0 / (1.0 + 1.0 / math.log2(3))
    assert _approx(metrics.ndcg_at_k(["a", "b"], ["a", "x"], k=2), expected)


def test_ndcg_at_k_empty_gold_is_vacuously_one():
    assert _approx(metrics.ndcg_at_k([], ["x", "y"], k=1), 1.0)


def test_ndcg_at_k_empty_selected_is_zero():
    assert _approx(metrics.ndcg_at_k(["a", "b"], [], k=5), 0.0)


def test_ndcg_at_k_k_exceeds_both():
    # gold = {a, b}, selected = [a], k=10
    # DCG = 1/log2(2) = 1.0
    # IDCG = 1/log2(2) + 1/log2(3) (since min(10, |gold|)=2)
    # NDCG = 1 / (1 + 1/log2(3)) ≈ 0.6131
    expected = 1.0 / (1.0 + 1.0 / math.log2(3))
    assert _approx(metrics.ndcg_at_k(["a", "b"], ["a"], k=10), expected)


def test_ndcg_at_k_zero_k_raises():
    import pytest

    with pytest.raises(ValueError, match="k must be a positive integer"):
        metrics.ndcg_at_k(["a"], ["a"], k=0)


def test_ndcg_at_k_negative_k_raises():
    import pytest

    with pytest.raises(ValueError, match="k must be a positive integer"):
        metrics.ndcg_at_k(["a"], ["a"], k=-1)


def test_ndcg_at_k_duplicate_selected_caps_at_one():
    # gold={a}, sel=[a,a] → after dedupe s=[a], DCG=1.0, IDCG=1.0, NDCG=1.0.
    # Without dedupe, DCG=1/log2(2)+1/log2(3)≈1.631 → NDCG>1 (invalid).
    assert _approx(metrics.ndcg_at_k(["a"], ["a", "a"], k=2), 1.0)
    # gold={a,b}, sel=[a,a,b,b] → dedupe → s=[a,b], DCG=1+1/log2(3), NDCG=1.0
    assert _approx(metrics.ndcg_at_k(["a", "b"], ["a", "a", "b", "b"], k=4), 1.0)
    # gold={a}, sel=[x,a,a], k=3 → dedupe → s=[x,a], DCG=1/log2(3), NDCG<1.
    ndcg = metrics.ndcg_at_k(["a"], ["x", "a", "a"], k=3)
    expected = (1.0 / math.log2(3)) / 1.0  # IDCG = 1/log2(2) = 1.0
    assert _approx(ndcg, expected)
    assert ndcg <= 1.0


# --- aggregate --------------------------------------------------------------


def _row(gold, selected, candidates=None):
    """Build a metrics-shaped row with set-based + rank-aware fields (IR standard k)."""
    r = {
        "recall": metrics.recall(gold, selected),
        "precision": metrics.precision(gold, selected),
        "complete_recall": metrics.complete_recall(gold, selected),
        "noise": metrics.noise(gold, selected),
    }
    for k in metrics.RANK_AWARE_K:
        r[f"recall_at_{k}"] = metrics.recall_at_k(gold, selected, k)
        r[f"ndcg_at_{k}"] = metrics.ndcg_at_k(gold, selected, k)
    if candidates is not None:
        r["retrieval_recall"] = metrics.retrieval_recall(gold, candidates)
    return r


def test_aggregate_means_across_rows():
    rows = [_row(["a"], ["a"]), _row(["b", "c"], ["b"])]  # recall 1.0, 0.5 → mean 0.75
    agg = metrics.aggregate(rows)
    assert agg["n"] == 2
    assert _approx(agg["recall"], 0.75)
    assert _approx(agg["complete_recall"], 0.5)  # 1.0, 0.0


def test_aggregate_includes_retrieval_recall_when_present():
    rows = [
        _row(["a"], ["a"], candidates=["a"]),  # retrieval_recall 1.0
        _row(["b", "c"], ["b", "c"], candidates=["b"]),  # retrieval_recall 0.5 (1 of 2)
    ]
    agg = metrics.aggregate(rows)
    assert "retrieval_recall" in agg
    assert _approx(agg["retrieval_recall"], 0.75)  # mean(1.0, 0.5)


def test_aggregate_includes_rank_aware_when_present():
    rows = [
        _row(["a"], ["a", "x"]),
        _row(["b", "c"], ["b"]),
    ]
    agg = metrics.aggregate(rows)
    for k in metrics.RANK_AWARE_K:
        assert f"recall_at_{k}" in agg, f"recall_at_{k} missing"
        assert f"ndcg_at_{k}" in agg, f"ndcg_at_{k} missing"
    # recall@1 should be lower than full recall for the partial-hit row
    assert agg["recall_at_1"] <= agg["recall"]


def test_aggregate_omits_rank_aware_when_rows_inconsistent():
    # Legacy row missing rank-aware keys — aggregate must not blow up.
    rows = [
        {"recall": 1.0, "precision": 1.0, "complete_recall": 1.0, "noise": 0.0},
        {"recall": 0.5, "precision": 0.5, "complete_recall": 0.0, "noise": 0.5},
    ]
    agg = metrics.aggregate(rows)
    assert agg["n"] == 2
    assert _approx(agg["recall"], 0.75)
    # No rank-aware keys present → no rank-aware aggregate emitted.
    for k in metrics.RANK_AWARE_K:
        assert f"recall_at_{k}" not in agg
        assert f"ndcg_at_{k}" not in agg


def test_aggregate_empty_is_zeroes():
    agg = metrics.aggregate([])
    assert agg["n"] == 0
    assert _approx(agg["recall"], 0.0)


def test_aggregate_empty_includes_rank_aware_keys():
    # Empty-rows envelope must auto-discover rank-aware keys so consumers see
    # the same shape they get from a populated aggregate.
    agg = metrics.aggregate([])
    for k in metrics.RANK_AWARE_K:
        assert f"recall_at_{k}" in agg
        assert f"ndcg_at_{k}" in agg
        assert agg[f"recall_at_{k}"] == 0.0
        assert agg[f"ndcg_at_{k}"] == 0.0
