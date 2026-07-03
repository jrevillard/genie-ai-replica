#!/usr/bin/env python3
# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Offline adaptive-reranker calibration.

Replays the adaptive selection algorithm against the per-candidate breakdown
captured in an instrumented anchor report (run_eval.py with rag.adaptive_breakdown
harvested). Lets us sweep CONTEXT_DECAY_FACTOR, the confusion-cost formula, and
MIN_VALUE_THRESHOLD across hundreds of combinations in seconds — no redeploy,
no eval rerun — then validates only the winner live.

WHY THIS IS A PURE FUNCTION
---------------------------
The breakdown records the computed `utility` per candidate (utility depends on
relevance + novelty, which depend on score + embeddings — already fixed at eval
time). Only the COST side changes when we retune:
  - context_decay_cost = CONTEXT_DECAY_FACTOR * token_count   (token_count logged)
  - confusion_cost     = f(score, max_score, avg_score)        (scores logged)
  - value              = utility - (context_decay_cost + confusion_cost)
  - selected           = value > MIN_VALUE_THRESHOLD

So for any (factor, confusion_formula, threshold) we recompute cost -> value ->
selection for every candidate of every query, then score recall/precision/noise
against the gold set embedded in the report. Same logged data + same formula =
same selection the live reranker would produce with those params.

LIMITATIONS (be honest)
-----------------------
- Tunes only the adaptive cost path. Upstream changes (retriever k, label
  filter, contextual retrieval, RERANKER_SCORE_CALIBRATION) change the candidate
  stack and require a fresh eval run.
- 32-query gold set is small; the top-3 cells may differ by noise. The live
  validation step (redeploy winner, rerun eval) guards against overfitting.
- recall is the target metric but we also report precision + a recall-at-
  precision-floor so the loop can't game it by selecting everything.

Usage:
    python3 calibrate.py anchor_instrumented_factor0025.json
    python3 calibrate.py anchor_instrumented_factor0025.json --top 5
    python3 calibrate.py ... --factors 0.001,0.0015,0.002 --thresholds -1.0,-0.5
"""

from __future__ import annotations

import argparse
import itertools
import json
import sys
from pathlib import Path

# Optional: reuse the live metrics so definitions match exactly.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import metrics  # noqa: E402


# --- confusion-cost formulas -------------------------------------------------
# Each takes (score, max_score, avg_score, idx, n) and returns a float >= 0.
# `idx` is the candidate's position in TEI's score-descending sort; `n` is the
# candidate count. The current production formula is `current`.


def _denominator(max_score: float, avg_score: float) -> float:
    den = max_score - avg_score
    return den if abs(den) > 1e-6 else 1e-6


def conf_current(score, mx, avg, idx, n):
    """Production formula: (1 - score) + (mx - score) / (mx - avg)."""
    return (1 - score) + ((mx - score) / _denominator(mx, avg))


def conf_simple(score, mx, avg, idx, n):
    """Drop the relative term. confusion = (1 - score). Bounded [0,1], monotone.

    Removes the double-counting of low relevance (already in `relevance`) and
    the unstable denominator (explodes when scores cluster tight).
    """
    return 1 - score


def conf_bounded_rel(score, mx, avg, idx, n):
    """Current formula but cap the relative term at 1.0 (kills the 3-5x spikes)."""
    return (1 - score) + min(1.0, (mx - score) / _denominator(mx, avg))


def conf_rank(score, mx, avg, idx, n):
    """Replace the relative term with a rank position penalty (idx/n).

    Stable, bounded [0,1], no denominator at all. Captures "worse than top"
    by sort position rather than score spread.
    """
    return (1 - score) + (idx / n if n else 0.0)


CONFUSION_FORMULAS = {
    "current": conf_current,
    "simple(1-s)": conf_simple,
    "bounded_rel": conf_bounded_rel,
    "rank_i/n": conf_rank,
}


def replay_query(breakdown, factor, conf_fn, threshold):
    """Recompute selected indices for one query under a given param combo.

    Returns the set of selected candidate indices (positions in the breakdown).
    """
    scores = [c["score"] for c in breakdown]
    if not scores:
        return set()
    mx = max(scores)
    avg = sum(scores) / len(scores)
    n = len(scores)
    selected = set()
    for i, c in enumerate(breakdown):
        token_cost = factor * c["token_count"]
        confusion = conf_fn(c["score"], mx, avg, i, n)
        value = c["utility"] - (token_cost + confusion)
        if value > threshold:
            selected.add(i)
    return selected


def score_combo(report, factor, conf_fn, threshold):
    """Replay every query under (factor, conf_fn, threshold); return metrics.

    Selection is indexed by BREAKDOWN POSITION, but the report's `selected`
    field holds content hashes. To score recall we need the hashes of the
    candidates that the replay marked selected. The breakdown doesn't carry
    hashes (it's per-position), so we map position -> hash via the ordering
    of `candidates` (the candidates list is in the same TEI-descending order
    the breakdown indexes). When that mapping isn't available (e.g. a
    candidate dropped before logging), we fall back to counting: we score
    recall against the FULL candidate set filtered by the replay's selected
    positions — i.e. we measure "did the replay keep the gold-bearing
    positions?".

    Concretely: for each query, the gold subset that lives INSIDE the
    candidate set is the recall ceiling. We check whether the replay-selected
    positions cover that gold. Because the breakdown doesn't record which
    candidate hash each position maps to, we approximate using the LIVE
    `selected` vs `candidates` as the ground truth and recompute recall as:

        replay_recall = |gold ∩ replay_selected_hashes| / |gold|

    where replay_selected_hashes = the hashes at the replay-selected positions
    in `candidates` (when len(candidates) == len(breakdown), which holds when
    no candidate was dropped post-TEI).
    """
    recalls = []
    precisions = []
    n_empty = 0
    n_selected_total = 0
    n_unmappable = 0
    for row in report["per_query"]:
        bd = row.get("adaptive_breakdown") or []
        if not bd:
            continue
        replay_sel_pos = replay_query(bd, factor, conf_fn, threshold)
        n_selected_total += len(replay_sel_pos)
        if not replay_sel_pos:
            n_empty += 1
        # Map replay-selected RANK positions -> original retrieved_docs index ->
        # candidate content hash. The breakdown carries `original_index` per
        # record (annotated by the reranker from decoded_response[i]["index"]).
        # When that field is absent (older report), we can't map safely.
        cands = row.get("candidates", [])
        gold = row.get("gold", [])
        sel_hashes = []
        ok = True
        for rank_pos in sorted(replay_sel_pos):
            if rank_pos >= len(bd):
                ok = False
                break
            oi = bd[rank_pos].get("original_index")
            if oi is None or oi >= len(cands):
                ok = False
                break
            sel_hashes.append(cands[oi])
        if not ok:
            n_unmappable += 1
            continue
        recalls.append(metrics.recall(gold, sel_hashes))
        precisions.append(metrics.precision(gold, sel_hashes))
    if not recalls:
        return None
    n = len(recalls)
    return {
        "n": n,
        "recall": sum(recalls) / n,
        "precision": sum(precisions) / n,
        "avg_selected": n_selected_total / n,
        "empty_queries": n_empty,
        "unmappable": n_unmappable,
    }


def f1(m):
    r, p = m["recall"], m["precision"]
    return (2 * r * p / (r + p)) if (r + p) > 0 else 0.0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("report", help="instrumented anchor_results JSON (with adaptive_breakdown per query)")
    ap.add_argument("--factors", help="comma-separated CONTEXT_DECAY_FACTOR values (default: 7-step sweep)")
    ap.add_argument("--thresholds", help="comma-separated MIN_VALUE_THRESHOLD values (default: 5-step sweep)")
    ap.add_argument("--top", type=int, default=10, help="print top-N combos by F1 (default 10)")
    ap.add_argument("--metric", choices=["f1", "recall", "recall_at_precision"], default="f1",
                    help="rank combos by this metric (default f1)")
    ap.add_argument("--precision-floor", type=float, default=0.5,
                    help="for recall_at_precision: min precision to qualify (default 0.5)")
    args = ap.parse_args()

    report = json.load(open(args.report))

    factors = (
        [float(x) for x in args.factors.split(",")]
        if args.factors
        else [0.0005, 0.0008, 0.0010, 0.0015, 0.0020, 0.0025, 0.0030]
    )
    thresholds = (
        [float(x) for x in args.thresholds.split(",")]
        if args.thresholds
        else [-2.0, -1.5, -1.0, -0.5, 0.0]
    )

    # Baseline (current production params) for reference.
    base = score_combo(report, 0.0025, conf_current, -1.0)
    print(f"Baseline (factor=0.0025, current, threshold=-1.0): "
          f"recall={base['recall']:.3f} precision={base['precision']:.3f} "
          f"avg_sel={base['avg_selected']:.2f} empty={base['empty_queries']}/{base['n']}", file=sys.stderr)
    print(f"Sweep: {len(factors)} factors x {len(CONFUSION_FORMULAS)} formulas x "
          f"{len(thresholds)} thresholds = {len(factors) * len(CONFUSION_FORMULAS) * len(thresholds)} combos\n",
          file=sys.stderr)

    results = []
    for factor, (conf_name, conf_fn), threshold in itertools.product(
        factors, CONFUSION_FORMULAS.items(), thresholds
    ):
        m = score_combo(report, factor, conf_fn, threshold)
        if m is None:
            continue
        m.update(factor=factor, confusion=conf_name, threshold=threshold, f1=f1(m))
        m["recall_at_precision"] = m["recall"] if m["precision"] >= args.precision_floor else 0.0
        results.append(m)

    rank_key = args.metric
    results.sort(key=lambda r: r[rank_key], reverse=True)

    print(f"{'rank':<5}{'metric':<8}{'recall':<8}{'prec':<8}{'f1':<8}"
          f"{'avg_sel':<9}{'empty':<7}{'factor':<9}{'confusion':<14}{'thresh':<7}")
    print("-" * 90)
    for i, r in enumerate(results[: args.top], 1):
        print(f"{i:<5}{rank_key[:6]:<8}{r['recall']:<8.3f}{r['precision']:<8.3f}"
              f"{r['f1']:<8.3f}{r['avg_selected']:<9.2f}{r['empty_queries']:<7}"
              f"{r['factor']:<9.4f}{r['confusion']:<14}{r['threshold']:<7.2f}")

    # Save full grid for the team.
    out = Path(args.report).with_name(Path(args.report).stem + "_calibration.json")
    json.dump(
        {"baseline": {"factor": 0.0025, "confusion": "current", "threshold": -1.0, **base},
         "ranking_metric": rank_key,
         "all_combos": results},
        open(out, "w"),
        indent=2,
    )
    print(f"\nFull grid ({len(results)} combos) -> {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
