#!/usr/bin/env python3
# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Semantic-mode anchor eval — re-scores an EXISTING anchor report against
the new passage gold set using embedding similarity.

Why replay an existing report?
  - Driving 32 queries through chatqna takes minutes; the candidate/selected
    chunk_keys are already captured in anchor_results.json. Re-scoring against
    a different gold (passages instead of chunk_keys) is a pure function of
    (report, gold, embedding_vectors) — no need to re-run the pipeline.

This lets us:
  1. Validate the semantic matching end-to-end before changing the live eval.
  2. A/B chunk-key vs passage metrics on the SAME retrieval results.
  3. Sweep min_similarity offline (which threshold best separates the right
     chunk from other chunks).

Usage:
    python3 run_eval_semantic.py anchor_results.json gold_passages.json --similarity 0.70

Run on the swarm node (ArangoDB + embedding endpoint reachable):
    ssh govstack@<node> 'cd /tmp/rag-eval && python3 run_eval_semantic.py \
        anchor_v4_calibrated.json gold_passages.json'
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import semantic_match
from arango import cursor  # reuses the eval's existing ArangoDB helper

DEFAULT_MIN_SIM = float(os.getenv("EVAL_MIN_SIMILARITY", "0.70"))


def fetch_chunk_embeddings(keys: list[str]) -> dict[str, list[float] | None]:
    """Read the stored embedding field for each chunk straight from ArangoDB."""
    if not keys:
        return {}
    keys_str = ",".join(f'"{k}"' for k in keys)
    aql = (
        f"FOR doc IN GRAPH_TEST_SOURCE "
        f"FILTER doc._key IN [{keys_str}] "
        f"RETURN {{key: doc._key, embedding: doc.embedding}}"
    )
    out = {}
    for row in cursor(aql):
        emb = row.get("embedding")
        out[row["key"]] = emb if isinstance(emb, list) else None
    # Mark missing chunks as None so the cache treats them as no-vector.
    for k in keys:
        out.setdefault(k, None)
    return out


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument(
        "report", help="anchor_results.json (chunk-key based, from run_eval.py)"
    )
    ap.add_argument(
        "gold_passages", help="passage-format gold JSON (list or {entries:[...]})"
    )
    ap.add_argument(
        "--similarity",
        type=float,
        default=DEFAULT_MIN_SIM,
        help=f"min cosine similarity to count a match (default {DEFAULT_MIN_SIM})",
    )
    ap.add_argument("--out", help="output JSON path (default: <report>_semantic.json)")
    ap.add_argument(
        "--sweep",
        action="store_true",
        help="also sweep thresholds 0.5-0.85 and report metrics at each",
    )
    args = ap.parse_args()

    report = json.load(open(args.report))
    raw_gold = json.load(open(args.gold_passages))
    # Accept either {"entries":[...]} (gold_dataset shape) or a flat list.
    if isinstance(raw_gold, dict) and "entries" in raw_gold:
        gold_entries = raw_gold["entries"]
    else:
        gold_entries = raw_gold

    # Index gold by query id. Each entry: {"id","passages":[{passage},...]}.
    gold_by_id = {
        e["id"]: [p["passage"] for p in e.get("passages", [])] for e in gold_entries
    }

    # Index report rows by id.
    rows_by_id = {r["id"]: r for r in report["per_query"]}

    # Collect every passage text (dedupe for one-shot embedding).
    all_passages = list({p for ps in gold_by_id.values() for p in ps})
    print(f"Embedding {len(all_passages)} unique gold passages...", file=sys.stderr)
    matcher = semantic_match.SemanticMatcher(
        all_passages,
        min_similarity=args.similarity,
    )
    print(
        f"Done. Scoring {len(gold_by_id)} queries at min_similarity={args.similarity}",
        file=sys.stderr,
    )

    sem_rows = []
    for qid, passages in sorted(gold_by_id.items(), key=lambda kv: int(kv[0][1:])):
        rep = rows_by_id.get(qid)
        if rep is None:
            print(f"  {qid}: NOT in report — skipped", file=sys.stderr)
            continue
        cands = rep.get("candidates", [])
        sel = rep.get("selected", [])
        row = matcher.score(qid, cands, sel, passages, fetch_chunk_embeddings)
        sem_rows.append(row)
        print(
            f"  {qid}: recall={row['recall']:.2f} prec={row['precision']:.2f} "
            f"retr={row['retrieval_recall']:.2f} "
            f"({row['n_passages_covered_by_selected']}/{row['n_passages']} passages | "
            f"{row['n_selected']} selected)",
            file=sys.stderr,
        )

    agg = semantic_match.aggregate(sem_rows)
    print(
        f"\n=== SEMANTIC AGGREGATE (min_sim={args.similarity}, n={agg['n']}) ===",
        file=sys.stderr,
    )
    for k in ("recall", "precision", "complete_recall", "noise", "retrieval_recall"):
        if k in agg:
            print(f"  {k:20s} {agg[k]:.3f}", file=sys.stderr)

    out = {
        "per_query": sem_rows,
        "aggregate": agg,
        "min_similarity": args.similarity,
        "baseline_chunk_key_aggregate": report.get("aggregate", {}),
    }

    if args.sweep:
        sweep = []
        for sim in [0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85]:
            sweep_matcher = semantic_match.SemanticMatcher(
                all_passages,
                min_similarity=sim,
            )
            sweep_rows = []
            for qid, passages in sorted(
                gold_by_id.items(), key=lambda kv: int(kv[0][1:])
            ):
                rep = rows_by_id.get(qid)
                if not rep:
                    continue
                sweep_rows.append(
                    sweep_matcher.score(
                        qid,
                        rep.get("candidates", []),
                        rep.get("selected", []),
                        passages,
                        fetch_chunk_embeddings,
                    )
                )
            a = semantic_match.aggregate(sweep_rows)
            sweep.append({"min_similarity": sim, **a})
            print(
                f"  sweep@{sim:.2f}: recall={a['recall']:.3f} prec={a['precision']:.3f} "
                f"retr={a['retrieval_recall']:.3f}",
                file=sys.stderr,
            )
        out["sweep"] = sweep

    out_path = args.out or (args.report.rsplit(".", 1)[0] + "_semantic.json")
    json.dump(out, open(out_path, "w"), indent=2)
    print(f"\nReport -> {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
