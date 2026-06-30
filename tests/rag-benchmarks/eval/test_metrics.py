# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Unit tests for retrieval-quality metrics (pure functions, no env deps)."""

import math

import metrics  # noqa: E402 — sys.path manipulated by pytest.ini / conftest


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


# --- aggregate --------------------------------------------------------------


def _row(gold, selected, candidates=None):
    r = {
        "recall": metrics.recall(gold, selected),
        "precision": metrics.precision(gold, selected),
        "complete_recall": metrics.complete_recall(gold, selected),
        "noise": metrics.noise(gold, selected),
    }
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


def test_aggregate_empty_is_zeroes():
    agg = metrics.aggregate([])
    assert agg["n"] == 0
    assert _approx(agg["recall"], 0.0)
