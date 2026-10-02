#!/usr/bin/env python3
# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
# ruff: noqa: EXE001 (shebang without executable bit — invoked via `python3 ...`)
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

This tool does NOT add a `--chunk-size-rebase` flag. The breakdown's `token_count`
field is the OBSERVED per-candidate token count at the deployed chunk_size;
the formula `factor × token_count` is already scale-correct for whatever
chunk_size was deployed at eval time. The only honest response to a
chunk_size change is "rerun the live eval". Rebasing would push the
tuning in the wrong direction because cost would silently shrink when
the new chunk is smaller.

LIMITATIONS (be honest)
-----------------------
- Tunes only the adaptive cost path. Upstream changes (retriever k, label
  filter, contextual retrieval, RERANKER_SCORE_CALIBRATION) change the candidate
  stack and require a fresh eval run.
- Gold set size is the corpus author's responsibility. At n ≤ 100 the top-3
  cells may differ by noise. Bootstrap CI (--bootstrap N) quantifies this;
  live validation (redeploy winner, rerun eval) guards against overfitting.
- recall is the target metric but we also report precision + a recall-at-
  precision-floor so the loop can't game it by selecting everything.

Usage:
    python3 calibrate.py anchor_results.json
    python3 calibrate.py anchor_results.json --top 5
    python3 calibrate.py ... --factors 0.001,0.0015,0.002 --thresholds -1.0,-0.5
    python3 calibrate.py ... --baseline-factor 0.0006 --baseline-confusion current
    python3 calibrate.py ... --bootstrap 1000          # paired bootstrap CI on top-1 vs top-2
    python3 calibrate.py ... --check-baseline          # exit 2 on replay-vs-live mismatch
    python3 calibrate.py ... --check-chunk-size <N> --chars-per-token <ratio>  # corpus-specific
"""

from __future__ import annotations

import argparse
import itertools
import json
import random
import sys
from pathlib import Path

# Optional: reuse the live metrics so definitions match exactly.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import metrics

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
    the breakdown indexes).

    For each query, the gold subset that lives INSIDE the candidate set is
    the recall ceiling. We check whether the replay-selected positions cover
    that gold.

        replay_recall = |gold ∩ replay_selected_hashes| / |gold|

    where replay_selected_hashes = the hashes at the replay-selected positions
    in `candidates` (when len(candidates) == len(breakdown), which holds when
    no candidate was dropped post-TEI).
    """
    recalls = []
    precisions = []
    passage_recalls = []  # passage-level recall across queries
    n_passages_total = 0
    n_passages_retrieved = 0
    n_empty = 0
    n_selected_total = 0
    n_unmappable = 0
    n_skipped_no_breakdown = 0  # B1 fix: surfaced, not silently dropped
    n_skipped_no_trace = 0  # align replay denominator with run_eval aggregate
    for row in report["per_query"]:
        # Gate on trace_found first — mirrors run_eval.py:400's aggregate
        # denominator (rows without a live span are excluded from
        # report.aggregate.recall). Without this, --check-baseline compares
        # different row sets when some rows have trace_found=True but
        # adaptive_breakdown=[] (warm-up span misses, retriever-empty
        # early return). Common cause: chatqna OTel SDK reinit right
        # after a `docker service update`.
        if not row.get("trace_found"):
            n_skipped_no_trace += 1
            continue
        bd = row.get("adaptive_breakdown") or []
        if not bd:
            # B1: surface instead of silently dropping. The replay n would be
            # lower than the report's n with no warning. Common causes:
            # retriever empty (auth gate, score threshold), trace miss.
            n_skipped_no_breakdown += 1
            continue
        replay_sel_pos = replay_query(bd, factor, conf_fn, threshold)
        n_selected_total += len(replay_sel_pos)
        if not replay_sel_pos:
            n_empty += 1
        # Map replay-selected RANK positions -> original retrieved_docs index ->
        # candidate content hash. The breakdown carries `original_index` per
        # record (annotated by the reranker from decoded_response[i]["index"]).
        # When that field is absent (older report), we can't map safely.
        # Identity space (content_hash vs raw keys) selected via _id_arrays so
        # the replay matches live aggregate.recall (run_eval.py scores in
        # content-hash space; pre-!495 reports fall back to raw keys).
        gold, cands = _id_arrays(row)
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
        # Passage-level recall: group gold chunks by passage_id, check subset
        # membership in the replay's selected _keys. A passage counts only when
        # ALL its chunks are selected. Chunk identity is the raw _key (matches
        # sel_hashes above); pre-refactor gold without passage_id falls back to
        # one singleton passage per chunk.
        expected_chunks = row.get("expected_chunks") or []
        passage_groups: dict[str, set[str]] = {}
        for c in expected_chunks:
            ck = c.get("chunk_key")
            if not ck:
                continue
            pid = c.get("passage_id") or f"{ck}#singleton"
            passage_groups.setdefault(pid, set()).add(ck)
        if passage_groups:
            sel_set = set(sel_hashes)
            retrieved = sum(
                1 for chunks in passage_groups.values() if chunks.issubset(sel_set)
            )
            passage_recalls.append(retrieved / len(passage_groups))
            n_passages_total += len(passage_groups)
            n_passages_retrieved += retrieved
    n_queries_with_breakdown = len(recalls)
    n_queries_total = len(report["per_query"])
    if not recalls:
        return None
    n = n_queries_with_breakdown
    out = {
        "n": n,
        "n_queries_total": n_queries_total,
        "n_skipped_no_trace": n_skipped_no_trace,
        "n_skipped_no_breakdown": n_skipped_no_breakdown,
        "coverage": n_queries_with_breakdown / n_queries_total
        if n_queries_total
        else 0.0,
        "recall": sum(recalls) / n,
        "precision": sum(precisions) / n,
        "avg_selected": n_selected_total / n,
        "empty_queries": n_empty,
        "unmappable": n_unmappable,
    }
    if passage_recalls:
        out["passage_recall"] = sum(passage_recalls) / len(passage_recalls)
        out["total_passages"] = n_passages_total
        out["retrieved_passages"] = n_passages_retrieved
    return out


def f1(m):
    r, p = m["recall"], m["precision"]
    return (2 * r * p / (r + p)) if (r + p) > 0 else 0.0


# ---- Validity check (B2 fix) -----------------------------------------------
def _baseline_replay_recall(report, factor, conf_name, threshold) -> float | None:
    """Replay the live-config cell on the fresh breakdown. The result must
    match `report.aggregate.recall` within tolerance — if it doesn't, the
    breakdown→candidates mapping is broken (position-vs-order pitfall) and
    the offline sweep is unsafe to trust. Used by `--check-baseline`.

    conf_name is the operator-declared confusion formula key (see
    CONFUSION_FORMULAS). On a different corpus, pass the live reranker config
    via `--baseline-{factor,threshold,confusion}` so the replay targets the
    ACTUAL live cell, not a stale historical default.
    """
    conf_fn = CONFUSION_FORMULAS[conf_name]
    m = score_combo(report, factor, conf_fn, threshold)
    return m["recall"] if m else None


# ---- Bootstrap (P2 fix) ---------------------------------------------------
def _replay_recall_one(bd, gold, cands, factor, conf_fn, threshold):
    """Per-query replay for a SINGLE (factor, conf_fn, threshold) cell.
    Returns recall (float) or 0.0 if the breakdown is unmappable.
    """
    scores = [c["score"] for c in bd]
    if not scores:
        return 0.0
    mx, avg, n = max(scores), sum(scores) / len(scores), len(scores)
    sel = set()
    for i, c in enumerate(bd):
        tc = factor * c["token_count"]
        cf = conf_fn(c["score"], mx, avg, i, n)
        v = c["utility"] - (tc + cf)
        if v > threshold:
            sel.add(i)
    sel_hashes = []
    for rank_pos in sorted(sel):
        if rank_pos >= len(bd):
            return 0.0
        oi = bd[rank_pos].get("original_index")
        if oi is None or oi >= len(cands):
            return 0.0
        sel_hashes.append(cands[oi])
    return metrics.recall(gold, sel_hashes)


def _id_arrays(row):
    """Pick (gold, cands) in the identity space the live aggregate scores in.

    Reports carry both raw keys (`gold`/`candidates`, the ArangoDB primary
    keys) and content-hash projections (`gold_hashes`/`candidate_hashes`,
    sha256[:16] of the chunk text). The live aggregate.recall is computed
    against the content-hash space — run_eval's score path calls
    metrics.recall(gold, sel) on the content-hash lists, not the raw keys.
    For the offline replay to reproduce live aggregate within tolerance,
    it must score in the same space. Falls back to raw keys when the
    content-hash projections are absent (older reports predating the
    hash projection pass).
    """
    if "gold_hashes" in row and "candidate_hashes" in row:
        return row.get("gold_hashes") or [], row.get("candidate_hashes") or []
    return row.get("gold", []) or [], row.get("candidates", []) or []


def _per_query_recall_paired(
    report, factor_a, conf_fn_a, threshold_a, factor_b, conf_fn_b, threshold_b
):
    """Per-query recall arrays for two cells. Returns (per_q_a, per_q_b, keys)
    keyed by query id. Gates on `trace_found` so the replay denominator matches
    the live aggregate (run_eval.py's aggregate.recall excludes trace-missed
    rows). Without this, --check-baseline conflates mapping bugs with
    denominator drift.
    """
    per_q_a, per_q_b = {}, {}
    for i, row in enumerate(report["per_query"]):
        if not row.get("trace_found"):
            continue
        bd = row.get("adaptive_breakdown") or []
        gold, cands = _id_arrays(row)
        if not bd or not cands:
            continue
        key = row.get("id") or f"row_{i}"
        per_q_a[key] = _replay_recall_one(
            bd, gold, cands, factor_a, conf_fn_a, threshold_a
        )
        per_q_b[key] = _replay_recall_one(
            bd, gold, cands, factor_b, conf_fn_b, threshold_b
        )
    keys = sorted(set(per_q_a) & set(per_q_b))
    return per_q_a, per_q_b, keys


def bootstrap_pair_ci(
    report,
    conf_name_a,
    conf_fn_a,
    threshold_a,
    factor_a,
    conf_name_b,
    conf_fn_b,
    threshold_b,
    factor_b,
    B=1000,
    seed=0,
):
    """Paired bootstrap CI on (cell_a recall) - (cell_b recall).

    Cells are FULLY parametrized (factor, conf_fn, threshold). For each of B
    iterations, draw n_with_replacement query keys (PAIRED), compute mean
    recall of cell_a and cell_b on the SAME keys, take the difference.
    Returns a dict; see return schema.

    Paired bootstrap keeps within-query correlation that unpaired throws
    away — the only design with power to detect small F1 deltas at typical
    eval n (≤100 queries).

    ONE-COMPARISON CI: this function reports a single CI between two cells.
    Family-wise correction (Sidak / Bonferroni) is NOT applied — it is a
    category error for one comparison (would just inflate the CI to no
    useful effect; with n_cells=480 default, alpha_per_comparison would
    shrink to ~1e-4 and the CI bounds the full empirical range at any
    practical B). If you run `--bootstrap` against MULTIPLE cell pairs,
    apply your own Bonferroni / Holm adjustment outside this tool.

    DEGENERATE GUARD: returns status='degenerate' when cell_a == cell_b
    on all three params — the diff distribution is identically 0 in that
    case and any reported CI is meaningless.
    """
    if (factor_a, conf_name_a, threshold_a) == (factor_b, conf_name_b, threshold_b):
        return {
            "status": "degenerate",
            "reason": "cell_a == cell_b on (factor, confusion, threshold); pick distinct cells",
        }
    per_q_a, per_q_b, keys = _per_query_recall_paired(
        report,
        factor_a,
        conf_fn_a,
        threshold_a,
        factor_b,
        conf_fn_b,
        threshold_b,
    )
    if not keys:
        return {
            "status": "no_overlap",
            "reason": "no queries have both adaptive_breakdown AND trace_found",
            "n_queries_in_sample": 0,
        }
    # Detect duplicate ids (silent collision would under-cover the gold).
    # The run_eval scoring loop in metrics.aggregate treats repeated ids as
    # separate rows; we mirror that here but warn loudly so dataset bugs
    # don't pass silently.
    seen = set()
    dups = []
    for k in keys:
        if k in seen:
            dups.append(k)
        seen.add(k)
    if dups:
        return {
            "status": "duplicate_ids",
            "reason": f"{len(dups)} duplicate query id(s) in paired sample — dataset bug",
            "duplicate_ids": dups[:10],
            "n_queries_in_sample": len(keys),
        }
    rng = random.Random(seed)
    n_keys = len(keys)
    a_arr = [per_q_a[k] for k in keys]
    b_arr = [per_q_b[k] for k in keys]
    # Empirical (no-resample) paired diff: the point estimate.
    paired_diff_obs = sum(a_arr[i] - b_arr[i] for i in range(n_keys)) / n_keys
    # Bootstrap distribution of the same statistic.
    diffs = []
    for _ in range(B):
        idx = [rng.randrange(n_keys) for _ in range(n_keys)]
        a = sum(a_arr[i] for i in idx) / n_keys
        b = sum(b_arr[i] for i in idx) / n_keys
        diffs.append(a - b)
    diffs.sort()
    n_d = len(diffs)
    # Naive 95% CI (single-comparison alpha). Discrete percentile: at
    # B=1000 indices 25 / 975 cover 2.5% / 97.5% exactly; at B<1000 the
    # coverage is biased upward (one of the most-cited bootstrap quirks;
    # accepted in the literature for B ≥ 1000).
    lo = diffs[int(0.025 * n_d)]
    hi = diffs[int(0.975 * n_d)]

    # Median for even n: average the two middles (PEP-450 convention).
    def _median(arr):
        s = sorted(arr)
        m = len(s) // 2
        return (s[m - 1] + s[m]) / 2 if len(s) % 2 == 0 else s[m]

    return {
        "status": "ok",
        "cell_a": {
            "factor": factor_a,
            "confusion": conf_name_a,
            "threshold": threshold_a,
        },
        "cell_b": {
            "factor": factor_b,
            "confusion": conf_name_b,
            "threshold": threshold_b,
        },
        "median_a": _median(a_arr),
        "median_b": _median(b_arr),
        "paired_diff_obs": paired_diff_obs,
        "paired_diff_mean_boot": sum(diffs) / n_d,
        "naive_ci_low": lo,
        "naive_ci_high": hi,
        "B": B,
        "n_queries_in_sample": n_keys,
        "alpha": 0.05,
        "ci_kind": "naive_95pct_paired_bootstrap",
        "interpretation": (
            "One-comparison 95% paired-bootstrap CI on (cell_a - cell_b) "
            "recall. PAIRED = same query keys resampled in both cells, "
            "which preserves within-query correlation (unpaired throws "
            "this away). If naive_ci excludes 0, cell_a is statistically "
            "better at single-comparison alpha=0.05. B ≥ 1000 recommended "
            "for stable tail coverage. Live A/B validation remains "
            "mandatory regardless of CI outcome."
        ),
    }


# ---- Staleness check (P3a fix) ---------------------------------------------
def check_chunk_size_sanity(report, expected_chars_per_token=None, tolerance=0.30):
    """Cross-check that the breakdown's median token_count is consistent with
    the deployed chunk_size.

    Implied chunk_size = median(token_count) × chars_per_token. The operator
    passes the expected_chars_per_token (English ≈ 4.0; languages with denser
    orthography ≈ 3.2-3.5). If implied_chunk_size deviates by more than
    `tolerance` from the operator-declared chunk_size, warn.

    Returns dict with implied_chunk_size + status (ok / warn).
    """
    all_tokens = []
    for row in report["per_query"]:
        bd = row.get("adaptive_breakdown") or []
        for c in bd:
            if c.get("token_count") and c["token_count"] > 0:
                all_tokens.append(c["token_count"])
    if not all_tokens:
        return {"status": "warn", "message": "no token_count in any breakdown entry"}
    all_tokens.sort()
    median_tokens = all_tokens[len(all_tokens) // 2]
    implied = median_tokens * expected_chars_per_token
    return {
        "status": "ok",
        "median_token_count": median_tokens,
        "implied_chunk_size": implied,
        "expected_chars_per_token": expected_chars_per_token,
        "interpretation": (
            f"Implied chunk_size = {implied:.0f} chars (median {median_tokens} tokens × "
            f"{expected_chars_per_token} chars/tok). Pass your live chunk_size "
            "as --check-chunk-size N to compare. Hard fail if >20% off."
        ),
    }


# ---- Staleness check (P3a user-supplied expected) ---------------------------
def check_chunk_size_vs_expected(
    report, expected_chunk_size, expected_chars_per_token=None, tolerance=0.30
):
    implied = check_chunk_size_sanity(report, expected_chars_per_token)
    if implied["status"] != "ok":
        return implied
    ratio = implied["implied_chunk_size"] / expected_chunk_size
    off = abs(1 - ratio)
    return {
        "status": "warn" if off > tolerance else "ok",
        "implied_chunk_size": implied["implied_chunk_size"],
        "expected_chunk_size": expected_chunk_size,
        "ratio": ratio,
        "off_pct": off * 100,
        "tolerance_pct": tolerance * 100,
        "message": (
            f"Implied {implied['implied_chunk_size']:.0f} vs expected "
            f"{expected_chunk_size} chars ({off * 100:.1f}% off, tolerance "
            f"{tolerance * 100:.0f}%). Re-run eval if chunk_size changed."
        ),
    }


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument(
        "report",
        help="instrumented anchor_results JSON (with adaptive_breakdown per query)",
    )
    ap.add_argument(
        "--factors",
        help="comma-separated CONTEXT_DECAY_FACTOR values (default: 15-step log-sweep 0.0001-0.05)",
    )
    ap.add_argument(
        "--thresholds",
        help="comma-separated MIN_VALUE_THRESHOLD values (default: 8-step sweep)",
    )
    ap.add_argument(
        "--top", type=int, default=10, help="print top-N combos by F1 (default 10)"
    )
    ap.add_argument(
        "--metric",
        choices=["f1", "recall", "recall_at_precision"],
        default="f1",
        help="rank combos by this metric (default f1)",
    )
    ap.add_argument(
        "--precision-floor",
        type=float,
        default=0.5,
        help="for recall_at_precision: min precision to qualify (default 0.5)",
    )
    ap.add_argument(
        "--check-baseline",
        action="store_true",
        help="B2 fix: validate baseline replay recall vs report.aggregate.recall "
        "(must match within 0.05; otherwise the breakdown→candidates mapping "
        "is broken and the sweep is unsafe to trust).",
    )
    ap.add_argument(
        "--check-chunk-size",
        type=float,
        default=None,
        help="operator-declared live chunk_size in chars. Exits 2 if "
        "implied (median token_count × chars/token) deviates by >30%%.",
    )
    ap.add_argument(
        "--chars-per-token",
        type=float,
        default=None,
        help="chars/token ratio for --check-chunk-size. REQUIRED when "
        "--check-chunk-size is set (no corpus-neutral default — "
        "English ~4.0, languages with denser orthography ~3.2-3.5).",
    )
    ap.add_argument(
        "--bootstrap",
        type=int,
        default=None,
        help="P2 fix: paired-bootstrap B resamples for CI on (top-1 - top-2) "
        "recall delta. Family-wise corrected across the full grid. "
        "Default off (cheap pure replay only).",
    )
    ap.add_argument("--seed", type=int, default=42, help="RNG seed for --bootstrap")
    ap.add_argument(
        "--baseline-factor",
        type=float,
        default=0.0025,
        help="baseline CONTEXT_DECAY_FACTOR for --check-baseline + "
        "out_obj['baseline'] (default 0.0025; override to match your "
        "deployment's live factor when reloading on another corpus).",
    )
    ap.add_argument(
        "--baseline-threshold",
        type=float,
        default=-1.0,
        help="baseline MIN_VALUE_THRESHOLD (default -1.0; override to "
        "match your deployment's live threshold).",
    )
    ap.add_argument(
        "--baseline-confusion",
        default="current",
        choices=list(CONFUSION_FORMULAS),
        help="baseline confusion formula (default 'current'; pick the one "
        "your reranker code actually uses — see CONFUSION_FORMULAS).",
    )
    ap.add_argument(
        "--strict-chunk-size",
        action="store_true",
        help="exit 2 on --check-chunk-size mismatch (default: warn-only).",
    )
    args = ap.parse_args()

    if args.check_chunk_size is not None and args.chars_per_token is None:
        ap.error("--chars-per-token is required when --check-chunk-size is set")

    with open(args.report) as _f:
        report = json.load(_f)

    # ---- Default: log-spaced factor grid (3 orders of magnitude) -------------
    factors = (
        [float(x) for x in args.factors.split(",")]
        if args.factors
        else [
            0.0001,
            0.0002,
            0.0003,
            0.0005,
            0.0007,
            0.001,
            0.0015,
            0.002,
            0.003,
            0.005,
            0.0075,
            0.01,
            0.015,
            0.02,
            0.05,
        ]
    )
    thresholds = (
        [float(x) for x in args.thresholds.split(",")]
        if args.thresholds
        else [-2.5, -2.0, -1.5, -1.0, -0.75, -0.5, 0.0, 0.5]
    )

    # ---- Validity check (B2) ---------------------------------------------
    if args.check_baseline:
        baseline_replay_recall = _baseline_replay_recall(
            report,
            args.baseline_factor,
            args.baseline_confusion,
            args.baseline_threshold,
        )
        live_aggregate_recall = report.get("aggregate", {}).get("recall")
        if baseline_replay_recall is None or live_aggregate_recall is None:
            print(
                "ERROR --check-baseline: cannot find live aggregate recall",
                file=sys.stderr,
            )
            sys.exit(2)
        delta = abs(baseline_replay_recall - live_aggregate_recall)
        if delta > 0.05:
            print(
                f"FAIL --check-baseline: replay recall {baseline_replay_recall:.4f} "
                f"differs from live aggregate recall {live_aggregate_recall:.4f} "
                f"by {delta:.4f} (>0.05). Breakdown→candidates mapping is broken; "
                "DO NOT trust the offline sweep.",
                file=sys.stderr,
            )
            sys.exit(2)
        print(
            f"OK --check-baseline: replay recall {baseline_replay_recall:.4f} vs "
            f"live aggregate {live_aggregate_recall:.4f} (Δ={delta:.4f})",
            file=sys.stderr,
        )

    # ---- Staleness check (P3a) -------------------------------------------
    if args.check_chunk_size is not None:
        cs_check = check_chunk_size_vs_expected(
            report,
            args.check_chunk_size,
            expected_chars_per_token=args.chars_per_token,
        )
        if cs_check["status"] == "warn":
            print(f"WARN --check-chunk-size: {cs_check['message']}", file=sys.stderr)
            if args.strict_chunk_size:
                sys.exit(2)
        else:
            print(
                f"OK --check-chunk-size: implied {cs_check['implied_chunk_size']:.0f} "
                f"vs expected {cs_check['expected_chunk_size']} (Δ={cs_check['off_pct']:.1f}%)",
                file=sys.stderr,
            )

    # ---- Reference baseline (defaults = historical anchor; override per deployment) ---
    base = score_combo(
        report,
        args.baseline_factor,
        CONFUSION_FORMULAS[args.baseline_confusion],
        args.baseline_threshold,
    )
    if base:
        n_total = base.get("n_queries_total", "?")
        coverage = base.get("coverage", 0)
        print(
            f"Reference (factor={args.baseline_factor}, {args.baseline_confusion}, "
            f"threshold={args.baseline_threshold}): "
            f"recall={base['recall']:.3f} precision={base['precision']:.3f} "
            f"avg_sel={base['avg_selected']:.2f} empty={base['empty_queries']}/{base['n']} "
            f"coverage={coverage:.2f} ({base['n']}/{n_total})",
            file=sys.stderr,
        )
    else:
        print("Reference baseline: ALL queries dropped (no breakdown)", file=sys.stderr)

    # ---- Coverage warning (B1) ------------------------------------------
    if base and base.get("n_skipped_no_breakdown", 0) > 0:
        print(
            f"WARN: {base['n_skipped_no_breakdown']}/{base.get('n_queries_total', '?')} "
            f"queries had no adaptive_breakdown (skipped from replay). "
            f"Common causes: retriever returned 0 docs (auth gate, score threshold), "
            f"OTel trace miss. Recapture if significant.",
            file=sys.stderr,
        )

    print(
        f"Sweep: {len(factors)} factors x {len(CONFUSION_FORMULAS)} formulas x "
        f"{len(thresholds)} thresholds = "
        f"{len(factors) * len(CONFUSION_FORMULAS) * len(thresholds)} combos\n",
        file=sys.stderr,
    )

    # ---- Main sweep ----------------------------------------------------
    results = []
    for factor, (conf_name, conf_fn), threshold in itertools.product(
        factors, CONFUSION_FORMULAS.items(), thresholds
    ):
        m = score_combo(report, factor, conf_fn, threshold)
        if m is None:
            continue
        m.update(factor=factor, confusion=conf_name, threshold=threshold, f1=f1(m))
        m["recall_at_precision"] = (
            m["recall"] if m["precision"] >= args.precision_floor else 0.0
        )
        results.append(m)

    rank_key = args.metric
    results.sort(key=lambda r: r[rank_key], reverse=True)

    print(
        f"{'rank':<5}{'metric':<8}{'recall':<8}{'prec':<8}{'f1':<8}"
        f"{'avg_sel':<9}{'empty':<7}{'factor':<9}{'confusion':<14}{'thresh':<7}"
    )
    print("-" * 90)
    for i, r in enumerate(results[: args.top], 1):
        print(
            f"{i:<5}{rank_key[:6]:<8}{r['recall']:<8.3f}{r['precision']:<8.3f}"
            f"{r['f1']:<8.3f}{r['avg_selected']:<9.2f}{r['empty_queries']:<7}"
            f"{r['factor']:<9.4f}{r['confusion']:<14}{r['threshold']:<7.2f}"
        )

    # ---- Bootstrap CI (P2) ---------------------------------------------
    bootstrap_result = None
    if args.bootstrap and len(results) >= 2:
        # Pick t1 = highest by `rank_key` (respects --metric). t2 = next
        # cell with factor != t1. Fallback to sorted_results[1] if no other
        # factor is in the grid; that case will compare on conf/threshold
        # only — printed as a WARN.
        sorted_results = sorted(results, key=lambda r: r[rank_key], reverse=True)
        t1 = sorted_results[0]
        t2 = next(
            (r for r in sorted_results[1:] if r["factor"] != t1["factor"]),
            None,
        )
        factor_held = False
        if t2 is None:
            t2 = sorted_results[1]
            factor_held = True
        bootstrap_result = bootstrap_pair_ci(
            report,
            t1["confusion"],
            CONFUSION_FORMULAS[t1["confusion"]],
            t1["threshold"],
            t1["factor"],
            t2["confusion"],
            CONFUSION_FORMULAS[t2["confusion"]],
            t2["threshold"],
            t2["factor"],
            B=args.bootstrap,
            seed=args.seed,
        )
        bootstrap_result["factor_held_constant"] = factor_held
        bootstrap_result["f1_a"] = t1["f1"]
        bootstrap_result["f1_b"] = t2["f1"]
        bootstrap_result["rank_metric"] = rank_key

    # ---- Save full grid + meta --------------------------------------------
    out = Path(args.report).with_name(Path(args.report).stem + "_calibration.json")
    # Baseline dict: allowlist the schema-stabilising keys only. `score_combo`
    # grows new diagnostic fields (coverage, n_queries_total, ...) without
    # the schema being republished; only the historical set-of-keys below
    # ships to downstream consumers.
    if base:
        baseline = {
            "factor": args.baseline_factor,
            "confusion": args.baseline_confusion,
            "threshold": args.baseline_threshold,
        }
        for k in (
            "n",
            "recall",
            "precision",
            "avg_selected",
            "empty_queries",
            "unmappable",
        ):
            if k in base:
                baseline[k] = base[k]
    else:
        baseline = {}
    out_obj = {
        "baseline": baseline,
        "ranking_metric": rank_key,
        "all_combos": results,
        "sweep": {
            "factors": factors,
            "thresholds": thresholds,
            "n_combos": len(results),
        },
        "sweep_counts": {
            "n_factors": len(factors),
            "n_thresholds": len(thresholds),
            "n_confusion_formulas": len(CONFUSION_FORMULAS),
            "n_cells": len(factors) * len(CONFUSION_FORMULAS) * len(thresholds),
        },
    }
    if args.check_baseline and live_aggregate_recall is not None:
        out_obj["validity_check"] = {
            "baseline_replay_recall": baseline_replay_recall,
            "live_aggregate_recall": live_aggregate_recall,
            "delta": abs(baseline_replay_recall - live_aggregate_recall),
            "passed": abs(baseline_replay_recall - live_aggregate_recall) <= 0.05,
        }
    if args.check_chunk_size is not None:
        out_obj["chunk_size_check"] = cs_check
    if bootstrap_result is not None:
        out_obj["bootstrap"] = bootstrap_result
    out_obj["bootstrap_status"] = (
        "off"
        if args.bootstrap is None
        else bootstrap_result.get("status", "unknown")
        if bootstrap_result
        else "no_results"
    )

    with open(out, "w") as _f:
        json.dump(out_obj, _f, indent=2)
    print(f"\nFull grid ({len(results)} combos) -> {out}", file=sys.stderr)
    if bootstrap_result is not None and bootstrap_result.get("status") == "ok":
        if bootstrap_result.get("factor_held_constant"):
            print(
                "WARN: only one factor in the sweep — bootstrap compares on "
                "confusion/threshold only (lower power). Pass --factors with "
                "multiple values to enable factor contrast.",
                file=sys.stderr,
            )
        rank_m = bootstrap_result["rank_metric"]
        print(
            f"Paired bootstrap CI on ({rank_m}-top - runner_up) RECALL: "
            f"obs Δ = {bootstrap_result['paired_diff_obs']:+.4f}, "
            f"boot mean Δ = {bootstrap_result['paired_diff_mean_boot']:+.4f}, "
            f"95% CI = [{bootstrap_result['naive_ci_low']:+.4f}, "
            f"{bootstrap_result['naive_ci_high']:+.4f}] "
            f"(B={bootstrap_result['B']}, n={bootstrap_result['n_queries_in_sample']})",
            file=sys.stderr,
        )
        print(
            f"  F1({rank_m}-top)={bootstrap_result['f1_a']:.4f} "
            f"F1(runner_up)={bootstrap_result['f1_b']:.4f} "
            f"ΔF1={bootstrap_result['f1_a'] - bootstrap_result['f1_b']:+.4f}. "
            f"{bootstrap_result['interpretation']}",
            file=sys.stderr,
        )
    elif bootstrap_result is not None:
        print(
            f"Bootstrap status: {bootstrap_result.get('status')} — "
            f"{bootstrap_result.get('reason', '')}",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
