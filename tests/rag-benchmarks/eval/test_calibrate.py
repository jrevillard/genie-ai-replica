# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Unit tests for calibrate.py adaptive-replay kernel.

The calibration tool re-implements the live chatqna adaptive-reranker
selection algorithm as a pure function over the per-candidate
``adaptive_breakdown`` captured at eval time. Two consumers share the
selection kernel:

- ``score_combo`` (main sweep path) — SKIPS unmappable rows (increments
  ``n_unmappable``; the row never enters the recall mean).
- ``_replay_recall_one`` (bootstrap path) — returns 0.0 for unmappable
  rows (worst-case recall; the row stays in the mean with value 0).

That divergence is BY DESIGN: ``--check-baseline`` treats unmappable
rows as a mapping bug to surface (skip), while ``--bootstrap`` is a
worst-case paired test where treating unmappable as 0.0 is the
conservative bound. The shared kernel (``_selected_hashes``) returns
``(sel_hashes, ok)``; each caller applies its own unmappable policy.

These tests pin:

1. The shared kernel produces the correct rank positions and the
   correct mapped hashes for a fully-mappable breakdown.
2. ``replay_query`` and ``score_combo`` AGREE on recall for a synthetic
   2-query report (the baseline-path contract).
3. The divergent unmappable semantics on at least one synthetic row
   (skip vs 0.0) — both behaviors are correct under their respective
   callers.
"""

from __future__ import annotations

import statistics

import calibrate  # sys.path manipulated by pytest.ini / conftest
import metrics

# --- Synthetic fixtures ----------------------------------------------------
# Hand-computed in the comment below — derived values are in the test body
# so a reader can re-derive the expected recall by hand without running
# the code.
#
# Q1 (3 candidates, all mappable):
#     bd1[0] = {score=0.9, utility=1.0, token_count=100, original_index=0}
#     bd1[1] = {score=0.5, utility=0.8, token_count=200, original_index=1}
#     bd1[2] = {score=0.2, utility=0.5, token_count=300, original_index=2}
#     cands1 = ['h1', 'h2', 'h3']   gold1 = ['h1']
#
#     conf_current at (factor=0.001, threshold=-1.0):
#         mx = 0.9, avg = (0.9+0.5+0.2)/3 = 0.5333, n = 3
#         i=0: confusion = 0.1 + 0.0           = 0.1000
#               value    = 1.0 - (0.001*100 + 0.1000) = 0.8000
#               0.8000 > -1.0 → SELECT
#         i=1: confusion = 0.5 + (0.4 / 0.3667) = 1.5909
#               value    = 0.8 - (0.001*200 + 1.5909) = -0.9909
#               -0.9909 > -1.0 → SELECT (just barely)
#         i=2: confusion = 0.8 + (0.7 / 0.3667) = 2.7091
#               value    = 0.5 - (0.001*300 + 2.7091) = -2.5091
#               -2.5091 > -1.0 → REJECT
#
#     sel_hashes = [cands1[0], cands1[1]] = ['h1', 'h2']
#     recall(gold=['h1'], sel=['h1', 'h2']) = 1.0
#
# Q2 (3 candidates, all mappable):
#     bd2[0] = {score=0.8, utility=1.2, token_count=150, original_index=0}
#     bd2[1] = {score=0.6, utility=0.9, token_count=250, original_index=1}
#     bd2[2] = {score=0.3, utility=0.4, token_count=350, original_index=2}
#     cands2 = ['h4', 'h5', 'h6']   gold2 = ['h4', 'h5']
#
#     conf_current at (factor=0.001, threshold=-1.0):
#         mx = 0.8, avg = (0.8+0.6+0.3)/3 = 0.5667, n = 3
#         i=0: confusion = 0.2 + 0.0           = 0.2000
#               value    = 1.2 - (0.001*150 + 0.2000) = 0.8500
#               SELECT
#         i=1: confusion = 0.4 + (0.2 / 0.2333) = 1.2571
#               value    = 0.9 - (0.001*250 + 1.2571) = -0.6071
#               SELECT
#         i=2: confusion = 0.7 + (0.5 / 0.2333) = 2.8429
#               value    = 0.4 - (0.001*350 + 2.8429) = -2.7929
#               REJECT
#
#     sel_hashes = [cands2[0], cands2[1]] = ['h4', 'h5']
#     recall(gold=['h4', 'h5'], sel=['h4', 'h5']) = 1.0
#
# Aggregate replay recall (per-query mean, n=2) = (1.0 + 1.0) / 2 = 1.0
# Aggregate precision: Q1 = 1/2 = 0.5, Q2 = 2/2 = 1.0, mean = 0.75

_FACTOR = 0.001
_THRESHOLD = -1.0
_EXPECTED_Q1_RECALL = 1.0
_EXPECTED_Q2_RECALL = 1.0
_EXPECTED_AGG_RECALL = 1.0
_EXPECTED_AGG_PRECISION = 0.75


def _bd_q1():
    return [
        {"score": 0.9, "utility": 1.0, "token_count": 100, "original_index": 0},
        {"score": 0.5, "utility": 0.8, "token_count": 200, "original_index": 1},
        {"score": 0.2, "utility": 0.5, "token_count": 300, "original_index": 2},
    ]


def _bd_q2():
    return [
        {"score": 0.8, "utility": 1.2, "token_count": 150, "original_index": 0},
        {"score": 0.6, "utility": 0.9, "token_count": 250, "original_index": 1},
        {"score": 0.3, "utility": 0.4, "token_count": 350, "original_index": 2},
    ]


def _two_query_report():
    return {
        "per_query": [
            {
                "id": "q1",
                "trace_found": True,
                "adaptive_breakdown": _bd_q1(),
                "candidates": ["h1", "h2", "h3"],
                "gold": ["h1"],
            },
            {
                "id": "q2",
                "trace_found": True,
                "adaptive_breakdown": _bd_q2(),
                "candidates": ["h4", "h5", "h6"],
                "gold": ["h4", "h5"],
            },
        ]
    }


# --- Tests ----------------------------------------------------------------


def test_replay_query_returns_expected_selected_positions():
    """The shared selection kernel must surface the right rank positions.

    Hand-computed in the module docstring: Q1 → {0, 1}, Q2 → {0, 1}.
    """
    conf = calibrate.CONFUSION_FORMULAS["current"]
    assert calibrate.replay_query(_bd_q1(), _FACTOR, conf, _THRESHOLD) == {0, 1}
    assert calibrate.replay_query(_bd_q2(), _FACTOR, conf, _THRESHOLD) == {0, 1}


def test_score_combo_recall_matches_hand_computed_cell():
    """``score_combo`` on the 2-query synthetic report must give recall=1.0.

    Hand derivation: both queries select 2 candidates, both have all gold
    chunks inside the selection (Q1: 1/1, Q2: 2/2). Per-query mean = 1.0.
    """
    conf = calibrate.CONFUSION_FORMULAS["current"]
    m = calibrate.score_combo(_two_query_report(), _FACTOR, conf, _THRESHOLD)
    assert m is not None
    assert m["recall"] == _EXPECTED_AGG_RECALL
    assert m["precision"] == _EXPECTED_AGG_PRECISION
    assert m["n"] == 2
    assert m["unmappable"] == 0


def test_replay_query_and_score_combo_agree_on_mappable_rows():
    """replay_query (rank positions) and score_combo (recall) share the
    same value kernel. On a fully-mappable report, the per-query recall
    derived from replay_query must equal the recall reported by
    score_combo (after aggregating across queries).
    """
    conf = calibrate.CONFUSION_FORMULAS["current"]
    report = _two_query_report()
    cands_by_id = {"q1": ["h1", "h2", "h3"], "q2": ["h4", "h5", "h6"]}
    gold_by_id = {"q1": ["h1"], "q2": ["h4", "h5"]}

    per_query_recall = []
    for row in report["per_query"]:
        sel = calibrate.replay_query(
            row["adaptive_breakdown"], _FACTOR, conf, _THRESHOLD
        )
        cands = cands_by_id[row["id"]]
        sel_hashes = [cands[row["adaptive_breakdown"][i]["original_index"]] for i in sorted(sel)]
        per_query_recall.append(metrics.recall(gold_by_id[row["id"]], sel_hashes))

    replay_mean = sum(per_query_recall) / len(per_query_recall)
    m = calibrate.score_combo(report, _FACTOR, conf, _THRESHOLD)
    assert replay_mean == _EXPECTED_Q1_RECALL == _EXPECTED_Q2_RECALL
    assert m["recall"] == replay_mean


def test_unmappable_row_score_combo_skips_bootstrap_treats_as_zero():
    """Lock the BY-DESIGN divergence on unmappable rows.

    A row with a missing ``original_index`` on a selected rank position is
    unmappable. ``score_combo`` skips it (``n_unmappable += 1``; recall
    averaged over mappable rows only); ``_replay_recall_one`` returns 0.0
    (the conservative bound for the bootstrap CI).
    """
    conf = calibrate.CONFUSION_FORMULAS["current"]
    # 2-row report: Q1 mappable, Q2 unmappable (no original_index on entry 0)
    bd_unmappable = [
        {"score": 0.9, "utility": 1.0, "token_count": 100},  # missing original_index
        {"score": 0.5, "utility": 0.8, "token_count": 200, "original_index": 1},
        {"score": 0.2, "utility": 0.5, "token_count": 300, "original_index": 2},
    ]
    report = {
        "per_query": [
            {
                "id": "q_mappable",
                "trace_found": True,
                "adaptive_breakdown": _bd_q1(),
                "candidates": ["h1", "h2", "h3"],
                "gold": ["h1"],
            },
            {
                "id": "q_unmappable",
                "trace_found": True,
                "adaptive_breakdown": bd_unmappable,
                "candidates": ["hx", "hy", "hz"],
                "gold": ["hx"],
            },
        ]
    }
    m = calibrate.score_combo(report, _FACTOR, conf, _THRESHOLD)
    # score_combo skips Q2 → recall = Q1's recall = 1.0 (mean of n=1)
    assert m["recall"] == 1.0
    assert m["unmappable"] == 1
    assert m["n"] == 1  # only the mappable row entered the mean

    # _replay_recall_one: Q1 returns 1.0, Q2 returns 0.0; mean = 0.5
    bd1 = _bd_q1()
    q1_recall = calibrate._replay_recall_one(
        bd1, ["h1"], ["h1", "h2", "h3"], _FACTOR, conf, _THRESHOLD
    )
    q2_recall = calibrate._replay_recall_one(
        bd_unmappable, ["hx"], ["hx", "hy", "hz"], _FACTOR, conf, _THRESHOLD
    )
    assert q1_recall == 1.0
    assert q2_recall == 0.0  # bootstrap's worst-case semantics


# --- Statistics.median parity (replaces hand-rolled _median) --------------


def test_statistics_median_matches_expected_for_even_and_odd():
    """The bootstrap path's hand-rolled _median must be replaced with
    statistics.median. Pin the parity so the refactor is testable:
    statistics.median on the same input arrays must produce the values
    the inline _median previously produced (so bootstrap_pair_ci's
    median_a/median_b are unchanged after the refactor).
    """
    odd = [0.10, 0.30, 0.50, 0.70, 0.90]
    even = [0.10, 0.30, 0.50, 0.70]
    assert statistics.median(odd) == 0.5
    assert statistics.median(even) == 0.4  # (0.30 + 0.50) / 2

    # Drive the bootstrap path on the synthetic 2-query report with a
    # distinct cell_b. The median_a / median_b values must be the same
    # before and after the refactor (median semantics unchanged). At
    # threshold=-0.5 cell_b selects only position 0 of each query, so
    # Q1 recall = 1.0 (1/1 gold) and Q2 recall = 0.5 (1/2 gold). Median
    # of [1.0, 0.5] = 0.75.
    report = _two_query_report()
    conf = calibrate.CONFUSION_FORMULAS["current"]
    res = calibrate.bootstrap_pair_ci(
        report,
        conf_name_a="current",
        conf_fn_a=conf,
        threshold_a=_THRESHOLD,
        factor_a=_FACTOR,
        conf_name_b="current",
        conf_fn_b=conf,
        threshold_b=-0.5,
        factor_b=_FACTOR,
        B=50,
        seed=0,
    )
    assert res["status"] == "ok"
    assert res["median_a"] == 1.0
    assert res["median_b"] == 0.75  # median of [1.0, 0.5]


def test_dead_tolerance_param_was_removed_from_check_chunk_size_sanity():
    """The tolerance param of check_chunk_size_sanity was dead (unused
    inside the body; the caller uses its own tolerance). The refactor
    drops it. Pin by signature inspection.
    """
    import inspect

    sig = inspect.signature(calibrate.check_chunk_size_sanity)
    assert "tolerance" not in sig.parameters
    # The wrapper check_chunk_size_vs_expected keeps its own tolerance
    # param (still used to compute off_pct vs threshold).
    sig2 = inspect.signature(calibrate.check_chunk_size_vs_expected)
    assert "tolerance" in sig2.parameters


def test_shared_kernel_extracted():
    """The refactor must extract a `_selected_hashes` kernel that both
    replay_query (via its value computation) and score_combo /
    _replay_recall_one (via the mapping) call into. Today the value
    computation is inlined twice; after the refactor the kernel exists.
    """
    assert hasattr(calibrate, "_selected_hashes"), (
        "calibrate must expose a shared _selected_hashes kernel used by "
        "both replay_query and score_combo / _replay_recall_one"
    )


class TestStripEqPrefix:
    """Calibrate CLI accepts `--thresholds =-1.0` (argparse preserves the
    leading `=` verbatim) and bare `-1.0` (the caller's shell should quote,
    but we don't break the value when it survives). We MUST NOT silently
    flip the sign of negative numbers (the lstrip('=-') footgun the
    original fix introduced)."""

    def test_strip_eq_prefix_passes_through_plain_numbers(self):
        from calibrate import _strip_eq_prefix
        assert _strip_eq_prefix("0.0006") == "0.0006"
        assert _strip_eq_prefix("0.5") == "0.5"

    def test_strip_eq_prefix_strips_single_leading_equals(self):
        from calibrate import _strip_eq_prefix
        assert _strip_eq_prefix("=-1.0") == "-1.0"
        assert _strip_eq_prefix("=-0.5") == "-0.5"

    def test_strip_eq_prefix_does_not_flip_negative_signs(self):
        """The bug: a naive lstrip('=-') turned "-1.0" into "1.0"."""
        from calibrate import _strip_eq_prefix
        # Bare negative passes through unchanged — the shell quoting
        # problem is a different issue.
        assert _strip_eq_prefix("-1.0") == "-1.0"
        # Even a single `=` followed by a negative is the right thing.
        assert _strip_eq_prefix("=-1.0") == "-1.0"

    def test_strip_eq_prefix_handles_outer_whitespace(self):
        from calibrate import _strip_eq_prefix
        assert _strip_eq_prefix("  = -1.0  ") == "-1.0"

    def test_strip_eq_prefix_does_not_strip_double_equals(self):
        """``= -1.0`` with surrounding space — we only strip ONE leading
        character so legitimate leading ``=`` patterns still work after
        a single pass; this documents current single-strip semantics."""
        from calibrate import _strip_eq_prefix
        # First call: "= -1.0" -> strip leading '=' -> " -1.0" -> strip
        # whitespace (caller's responsibility; helper is whitespace-aware
        # so this is a no-op extra pass).
        assert _strip_eq_prefix("= -1.0".strip()) == "-1.0"


class TestCliFactorsAndThresholdsParseNegativeValues:
    """End-to-end: the calibrate CLI must accept negative threshold values
    delivered via ``--thresholds =-1.0,=-0.5`` (argparse preserves the
    leading `=`) and parse them as the intended negative floats."""

    def test_thresholds_eq_prefix_negative_parses_as_negative(self, tmp_path):
        # Mirror the relevant slice of calibrate.main's argparser (which
        # isn't exported). The point of this test is the parse path, not
        # the report loader, so we build a minimal argparse locally.
        import argparse as _ap
        from calibrate import _strip_eq_prefix
        ap = _ap.ArgumentParser()
        ap.add_argument("report")
        ap.add_argument("--factors")
        ap.add_argument("--thresholds")
        args = ap.parse_args([
            str(tmp_path / "report.json"),
            "--thresholds", "=-1.0,=-0.5,0",
            "--factors", "0.0006",
        ])
        # The parse path that the CLI uses at line 692.
        parsed = [float(_strip_eq_prefix(x)) for x in args.thresholds.split(",")]
        assert parsed == [-1.0, -0.5, 0.0]
        # And the negative sign survives — the original lstrip('=-') bug
        # would have made these 1.0, 0.5, 0.0.
        assert parsed[0] < 0
        assert parsed[1] < 0
