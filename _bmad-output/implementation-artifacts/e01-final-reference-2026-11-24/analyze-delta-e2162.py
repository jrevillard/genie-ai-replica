#!/usr/bin/env python3
"""The #2162 verdict table: measured A reference vs the signed M-1 floors
(thresholds.yaml) and vs the signed M-1 VALUES (#2148's re-anchor table).

Reads the run's config-a.report.json (aggregate) + reference.manifest.json.
Prints: per-metric measured value, floor verdict (PASS/FAIL), delta vs the
signed M-1 value. NO signature is composed here — the lineage confirmation
is the operator's decision (issue #2162).
"""
import json
import sys

REPORT = sys.argv[1]
MANIFEST = sys.argv[2]

report = json.load(open(REPORT))
manifest = json.load(open(MANIFEST))
agg = report["aggregate"]

# the signed M-1 VALUES (the #2148 re-anchor table, 2026-11-24 — config A,
# 6 gold-bearing queries): every metric identical to the original !1056 basis
M1_SIGNED = {
    "recall": 1.000,
    "precision": 0.333,
    "complete_recall": 1.000,
    "noise": 0.667,
    "retrieval_recall": 1.000,
    "passage_recall": 1.000,
    "recall_at_1": 1.000,
    "recall_at_3": 1.000,
    "recall_at_5": 1.000,
    "recall_at_10": 1.000,
    "ndcg_at_1": 1.000,
    "ndcg_at_3": 1.000,
    "ndcg_at_5": 1.000,
    "ndcg_at_10": 1.000,
}

# the signed M-1 FLOORS (thresholds.yaml, dimensions.M-1.value.metrics)
FLOORS = {
    "retrieval_recall": (">=", 0.95),
    "recall_at_10": (">=", 0.95),
    "ndcg_at_10": (">=", 0.90),
    "passage_recall": (">=", 0.95),
    "noise": ("<=", 0.80),
}

print("=== the final A reference (aggregate over the anchor-scored cases)")
print(f"n = {agg.get('n')}  n_missed_traces = {report.get('n_missed_traces')}")
print()
print(f"{'metric':<20}{'measured':>10}{'M-1 signed':>12}{'delta':>8}   floor verdict")
print("-" * 78)
fails = []
for metric, signed in M1_SIGNED.items():
    measured = agg.get(metric)
    if measured is None:
        print(f"{metric:<20}{'ABSENT':>10}{signed:>12.3f}{'—':>8}   (not in report)")
        continue
    line = f"{metric:<20}{measured:>10.3f}{signed:>12.3f}{measured - signed:>+8.3f}   "
    if metric in FLOORS:
        op, thr = FLOORS[metric]
        ok = measured >= thr if op == ">=" else measured <= thr
        line += f"{'PASS' if ok else 'FAIL'} ({op} {thr})"
        if not ok:
            fails.append(metric)
    else:
        line += "(no floor — not a registry metric)"
    print(line)

print()
print("=== lineage")
print("corpus fingerprint:", manifest["corpus"]["fingerprint"])
print("set digest (sha256):", manifest["sets"]["assessment"]["sha256"])
print("evaluator-instructions:", manifest["evaluator_instructions"]["sha256"][:16])
print()
if fails:
    print("VERDICT: FAIL — floor breached:", ", ".join(fails))
else:
    print("VERDICT: every registry floor PASS (measurement only — the lineage")
    print("confirmation / re-signature stays the operator's decision)")
