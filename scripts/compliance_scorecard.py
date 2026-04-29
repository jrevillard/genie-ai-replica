#!/usr/bin/env python3
"""
AMINA — compliance scorecard.

Reads docs/compliance/compliance_controls.json and prints a
human-readable scorecard, or `--json` for CI parsing.

Maturity heuristic per domain (0-10):
    score = (complete + 0.5 * partial) / total * 10

The overall score is the unweighted mean of per-domain scores so a
single weak domain (e.g. retention or audit) does not get drowned by
strong ones.

Exit codes:
    0  — JSON parsed and rendered cleanly (regardless of low scores)
    2  — JSON file missing or invalid

No network. No external dependencies. Stdlib only.
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import sys
from typing import Dict, List


HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
DEFAULT_JSON = os.path.join(
    REPO_ROOT, "docs", "compliance", "compliance_controls.json",
)
VALID_STATUSES = {"complete", "partial", "gap"}
PARTIAL_WEIGHT = 0.5


def load(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def validate(doc: dict) -> List[str]:
    """Return a list of validation errors (empty = OK)."""
    errs: List[str] = []
    controls = doc.get("controls")
    if not isinstance(controls, list) or not controls:
        errs.append("controls: missing or empty")
        return errs
    seen_ids: set = set()
    for i, c in enumerate(controls):
        if not isinstance(c, dict):
            errs.append(f"controls[{i}]: not an object")
            continue
        cid = c.get("id")
        if not cid or not isinstance(cid, str):
            errs.append(f"controls[{i}]: missing id")
            continue
        if cid in seen_ids:
            errs.append(f"controls[{i}]: duplicate id {cid!r}")
            continue
        seen_ids.add(cid)
        if c.get("status") not in VALID_STATUSES:
            errs.append(f"{cid}: status must be one of {sorted(VALID_STATUSES)}")
        if not c.get("domain"):
            errs.append(f"{cid}: missing domain")
        if not c.get("requirement"):
            errs.append(f"{cid}: missing requirement")
    return errs


def aggregate(doc: dict) -> dict:
    controls = doc["controls"]
    by_domain: Dict[str, List[dict]] = collections.defaultdict(list)
    for c in controls:
        by_domain[c["domain"]].append(c)

    total = len(controls)
    counts = collections.Counter(c["status"] for c in controls)

    domain_scores: Dict[str, dict] = {}
    for domain, items in sorted(by_domain.items()):
        n = len(items)
        n_complete = sum(1 for c in items if c["status"] == "complete")
        n_partial  = sum(1 for c in items if c["status"] == "partial")
        n_gap      = sum(1 for c in items if c["status"] == "gap")
        score = (n_complete + PARTIAL_WEIGHT * n_partial) / n * 10.0 if n else 0.0
        domain_scores[domain] = {
            "total":    n,
            "complete": n_complete,
            "partial":  n_partial,
            "gap":      n_gap,
            "score":    round(score, 2),
        }

    if domain_scores:
        overall = round(
            sum(d["score"] for d in domain_scores.values()) / len(domain_scores),
            2,
        )
    else:
        overall = 0.0

    # Top gaps: prioritise gap > partial; stable id order within bucket.
    rank = {"gap": 0, "partial": 1, "complete": 2}
    top_gaps = sorted(
        (c for c in controls if c["status"] in ("gap", "partial")),
        key=lambda c: (rank[c["status"]], c["id"]),
    )[:10]

    return {
        "package_version":     doc.get("package_version", ""),
        "schema_version":      doc.get("schema_version", ""),
        "total_controls":      total,
        "complete":            counts.get("complete", 0),
        "partial":             counts.get("partial", 0),
        "gap":                 counts.get("gap", 0),
        "overall_score_10":    overall,
        "domain_scores":       domain_scores,
        "top_gaps": [
            {
                "id":            c["id"],
                "domain":        c["domain"],
                "status":        c["status"],
                "requirement":   c["requirement"],
                "residual_gap":  c.get("residual_gap", ""),
            }
            for c in top_gaps
        ],
    }


def render_text(agg: dict) -> str:
    out = []
    out.append("=" * 64)
    out.append("AMINA Compliance Scorecard")
    out.append("=" * 64)
    out.append(f"Package version: {agg['package_version']}")
    out.append(f"Total controls:  {agg['total_controls']}  "
               f"(complete {agg['complete']}, partial {agg['partial']}, "
               f"gap {agg['gap']})")
    out.append(f"Overall score:   {agg['overall_score_10']:.2f} / 10")
    out.append("")
    out.append("Per-domain maturity:")
    for d, s in agg["domain_scores"].items():
        bar_len = int(round(s["score"]))
        bar = "#" * bar_len + "." * (10 - bar_len)
        out.append(
            f"  {d:<20s} [{bar}] {s['score']:>5.2f}  "
            f"(C={s['complete']}, P={s['partial']}, G={s['gap']}, "
            f"N={s['total']})"
        )
    out.append("")
    out.append("Top 10 remaining gaps (gap > partial):")
    for c in agg["top_gaps"]:
        marker = "GAP" if c["status"] == "gap" else "PARTIAL"
        out.append(f"  [{marker:7s}] {c['id']:<12s} ({c['domain']}): "
                   f"{c['requirement']}")
        if c.get("residual_gap"):
            out.append(f"                next: {c['residual_gap']}")
    out.append("")
    return "\n".join(out)


def main() -> int:
    p = argparse.ArgumentParser(description="AMINA compliance scorecard")
    p.add_argument("--json", action="store_true",
                   help="Emit aggregated scorecard as JSON (CI-friendly).")
    p.add_argument("--path", default=DEFAULT_JSON,
                   help=f"Path to compliance_controls.json "
                        f"(default: {DEFAULT_JSON}).")
    args = p.parse_args()

    if not os.path.exists(args.path):
        sys.stderr.write(f"[scorecard] missing JSON: {args.path}\n")
        return 2

    try:
        doc = load(args.path)
    except json.JSONDecodeError as e:
        sys.stderr.write(f"[scorecard] invalid JSON: {e}\n")
        return 2

    errs = validate(doc)
    if errs:
        sys.stderr.write("[scorecard] validation errors:\n")
        for e in errs:
            sys.stderr.write(f"  - {e}\n")
        return 2

    agg = aggregate(doc)

    if args.json:
        json.dump(agg, sys.stdout, indent=2, sort_keys=True)
        sys.stdout.write("\n")
    else:
        sys.stdout.write(render_text(agg))

    return 0


if __name__ == "__main__":
    sys.exit(main())
