# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""PII corpus harness — measure precision and recall of the scanner against a
curator-supplied corpus of REAL personal-data cases.

WHY THIS EXISTS (David, 2026-10-12): "presidio also seems to identify a lot of
false positives... I have not yet seen even one genuine PII concern related to
GDPR." Without a corpus that statement is unfalsifiable — any tuning change can be
justified by anecdote. This harness makes it measurable.

Design rules:

1. EXPECTATIONS ARE KEYED ON THE VALUE, NOT THE OFFSET. Offsets move whenever the
   text is edited, and offset drift is exactly the failure the region-split in
   pii-client.js can introduce — so an offset-keyed corpus would go red for an
   unrelated reason. Keying on the value asserts the right thing: the correct
   entity was identified over the correct text.

2. THE REPORT NEVER ECHOES PERSONAL DATA (NFR-P2). Counts, case ids and entity
   types only. Pass --show-values to print matched text, which is for local
   debugging only and will be flagged in the output.

3. NEGATIVE CASES ARE FIRST CLASS. A corpus of only positives pushes you toward
   tuning that maximises apparent precision by detecting less. Every case can
   carry `expect: []` and/or `must_not_flag: [...]`, which is how the
   known-bad recognizers are pinned down.

4. IT MUST BE ABLE TO RUN AGAINST A CANDIDATE CONFIG. --entities and --threshold
   exist so a change can be A/B'd rather than argued about.

Usage:
    python corpus/run_corpus.py                          # default corpus file
    python corpus/run_corpus.py --cases corpus/mine.json
    python corpus/run_corpus.py --entities EMAIL_ADDRESS,IBAN_CODE
    python corpus/run_corpus.py --threshold 0.6
    python corpus/run_corpus.py --show-values            # local debug ONLY

Exit code 0 = every case met its expectations. Non-zero = at least one failed,
so this can gate CI once a synthetic corpus is committed.
"""

import argparse
import json
import os
import sys
from types import SimpleNamespace

from fastapi.testclient import TestClient
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

DEFAULT_CASES = Path(__file__).resolve().parent / "cases.local.json"


def load_cases(path: Path) -> list[dict]:
    if not path.exists():
        raise SystemExit(
            f"No corpus at {path}\n"
            f"Copy corpus/cases.example.json to corpus/cases.local.json and fill it in.\n"
            f"See corpus/README.md for the format."
        )
    data = json.loads(path.read_text(encoding="utf-8"))
    cases = data.get("cases", data) if isinstance(data, dict) else data
    if not isinstance(cases, list):
        raise SystemExit("Corpus must be a list of cases, or {'cases': [...]}")
    seen: set[str] = set()
    for c in cases:
        cid = c.get("id")
        if not cid:
            raise SystemExit("Every case needs an 'id'")
        if cid in seen:
            raise SystemExit(f"Duplicate case id: {cid}")
        seen.add(cid)
        if not isinstance(c.get("text"), str):
            raise SystemExit(f"Case {cid}: 'text' must be a string")
        for exp in c.get("expect", []):
            if "entity" not in exp or "value" not in exp:
                raise SystemExit(f"Case {cid}: each expect entry needs 'entity' and 'value'")
    return cases


def span_text(text: str, start: int, end: int) -> str:
    return text[start:end] if isinstance(start, int) and isinstance(end, int) else ""


def hit_satisfies(hit_text: str, expected: str) -> tuple[bool, bool]:
    """(satisfied, fuzzy). Exact match is the honest one. Containment is accepted
    only when the hit is not wildly larger than the expected value, otherwise a
    single hit spanning a whole paragraph would 'satisfy' every expectation in
    it and quietly destroy the measurement."""
    if hit_text == expected:
        return True, False
    if expected in hit_text and len(hit_text) <= len(expected) * 2 + 10:
        return True, True
    return False, False


def scan_case(client, case: dict, entities: list[str] | None, threshold: float) -> list:
    """Scan through the REAL endpoint, not by calling the analyzer directly.

    This is deliberate and it is the whole point. Calling analyzer.analyze()
    directly means re-implementing the entity-resolution rule that app.py:190
    applies — and a harness that resolves entities differently from the service
    measures a configuration that does not exist in production. That mistake was
    actually made while writing this harness: passing entities=None straight
    through made Presidio scan its ENTIRE default registry, surfacing
    ORGANIZATION and URL, neither of which is in DEFAULT_ENTITIES. The resulting
    precision number was measuring the wrong thing entirely.

    Going through the endpoint means the service resolves its own defaults, and
    there is no second copy of that rule to drift. What we measure is what the
    Node caller measures.
    """
    body: dict = {"texts": [{"id": case["id"], "text": case["text"]}]}
    if entities is not None:
        body["entities"] = entities
    if threshold is not None:
        body["threshold"] = threshold
    r = client.post("/v1/pii/scan", json=body)
    if r.status_code != 200:
        raise SystemExit(f"Scan failed for case {case['id']}: HTTP {r.status_code} {r.text[:200]}")
    result = r.json()["results"][0]
    text = case["text"]
    return [
        SimpleNamespace(
            entity_type=h["type"],
            start=h["start"],
            end=h["end"],
            score=h["score"],
        )
        for h in result["hits"]
    ]


def evaluate(client, cases: list[dict], entities, threshold, show_values: bool):
    per_entity: dict[str, dict] = {}
    failures: list[dict] = []

    def bucket(entity: str) -> dict:
        return per_entity.setdefault(entity, {"tp": 0, "fp": 0, "fn": 0, "fuzzy": 0})

    for case in cases:
        cid = case["id"]
        text = case["text"]
        hits = scan_case(client, case, entities, threshold)
        consumed: set[int] = set()
        case_problems: list[str] = []

        for exp in case.get("expect", []):
            entity, expected = exp["entity"], exp["value"]
            satisfied = fuzzy = False
            for i, h in enumerate(hits):
                if i in consumed or h.entity_type != entity:
                    continue
                ok, is_fuzzy = hit_satisfies(span_text(text, h.start, h.end), expected)
                if ok:
                    satisfied, fuzzy = True, is_fuzzy
                    consumed.add(i)
                    break
            if satisfied:
                bucket(entity)["tp"] += 1
                if fuzzy:
                    bucket(entity)["fuzzy"] += 1
                    case_problems.append(
                        f"    {entity}: matched a LARGER span than the expected value"
                        + (f" -> {span_text(text, hits[0].start, hits[0].end)!r}" if show_values else "")
                    )
            else:
                bucket(entity)["fn"] += 1
                case_problems.append(
                    f"    MISSED {entity}"
                    + (f" ({expected!r})" if show_values else " (value withheld — rerun with --show-values)")
                )

        for i, h in enumerate(hits):
            if i in consumed:
                continue
            bucket(h.entity_type)["fp"] += 1
            snippet = f" score={h.score:.2f}"
            if show_values:
                snippet += f" value={span_text(text, h.start, h.end)!r}"
            case_problems.append(f"    UNWANTED {h.entity_type}{snippet}")

        forbidden = case.get("must_not_flag", [])
        for entity in forbidden:
            n = sum(1 for h in hits if h.entity_type == entity)
            if n:
                bucket(entity)["fp"] += n
                case_problems.append(
                    f"    MUST-NOT-FLAG violated: {entity} fired {n}x on a case that must be clean"
                )

        if case_problems:
            failures.append({"id": cid, "problems": case_problems})

    return per_entity, failures


def report(per_entity: dict, failures: list[dict], show_values: bool, total_cases: int) -> int:
    if show_values:
        print("!! --show-values: personal data is being printed to your terminal !!\n")

    if per_entity:
        print(f"{'entity':<24}{'TP':>6}{'FP':>6}{'FN':>6}{'precision':>12}{'recall':>10}")
        print("-" * 64)
        for entity in sorted(per_entity):
            b = per_entity[entity]
            tp, fp, fn = b["tp"], b["fp"], b["fn"]
            precision = tp / (tp + fp) if (tp + fp) else float("nan")
            recall = tp / (tp + fn) if (tp + fn) else float("nan")
            p_s = "n/a" if precision != precision else f"{precision:.0%}"
            r_s = "n/a" if recall != recall else f"{recall:.0%}"
            print(f"{entity:<24}{tp:>6}{fp:>6}{fn:>6}{p_s:>12}{r_s:>10}")

        tp_all = sum(b["tp"] for b in per_entity.values())
        fp_all = sum(b["fp"] for b in per_entity.values())
        fn_all = sum(b["fn"] for b in per_entity.values())
        macro_p = tp_all / (tp_all + fp_all) if (tp_all + fp_all) else float("nan")
        macro_r = tp_all / (tp_all + fn_all) if (tp_all + fn_all) else float("nan")
        print("-" * 64)
        p_s = "n/a" if macro_p != macro_p else f"{macro_p:.0%}"
        r_s = "n/a" if macro_r != macro_r else f"{macro_r:.0%}"
        print(f"{'MICRO TOTAL':<24}{tp_all:>6}{fp_all:>6}{fn_all:>6}{p_s:>12}{r_s:>10}")
        fuzzy = sum(b["fuzzy"] for b in per_entity.values())
        if fuzzy:
            print(f"\n{fuzzy} expectation(s) matched only a LOOSER span than expected — sloppy detector, not a miss.")
    else:
        print("No expectations produced any signal. If your corpus has positive cases,")
        print("the scanner is finding nothing at all — check the spaCy model is installed.")

    if failures:
        print(f"\n{len(failures)}/{total_cases} case(s) FAILED:\n")
        for f in failures:
            print(f"  {f['id']}")
            for p in f["problems"]:
                print(p)
        return 1

    print(f"\nAll {total_cases} case(s) met expectations.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Measure PII scanner precision/recall against a corpus.")
    ap.add_argument("--cases", type=Path, default=DEFAULT_CASES, help="corpus JSON path")
    ap.add_argument("--entities", help="comma-separated entity list to request (default: sidecar's own)")
    ap.add_argument("--threshold", type=float, help="score threshold override")
    ap.add_argument("--show-values", action="store_true", help="print matched text (LOCAL DEBUG ONLY)")
    args = ap.parse_args()

    # A candidate national-ID registry can be A/B'd without editing app.py.
    if os.getenv("OKF_PII_NATIONAL_ID_PATTERNS"):
        print("NOTE: OKF_PII_NATIONAL_ID_PATTERNS is set — this run uses an overridden registry.\n")

    try:
        import app as app_module
    except ImportError as e:
        raise SystemExit(f"Could not import the sidecar module ({e}). Run from {Path(__file__).resolve().parent.parent}.")

    try:
        client = TestClient(app_module.app)  # warms the lazy analyzer + uses the real path
    except Exception as e:
        raise SystemExit(
            f"Could not load the spaCy model ({type(e).__name__}: {e}).\n"
            f"The corpus harness needs the REAL analyzer — it is measuring detection, not plumbing.\n"
            f"In CI the model is installed; locally use the .venv-linux/ in this component."
        )

    # Leave entities/threshold as None unless explicitly overridden, so the
    # SERVICE resolves its own defaults. Sending an explicit value here would
    # silently fork the configuration from the one production runs.
    entities = [e.strip() for e in args.entities.split(",")] if args.entities else None
    threshold = args.threshold

    cases = load_cases(args.cases)
    print(f"Corpus: {args.cases.name} — {len(cases)} case(s)")
    print(f"Entities: {entities or 'service default'} | threshold: {threshold or 'service default'}\n")

    per_entity, failures = evaluate(client, cases, entities, threshold, args.show_values)
    return report(per_entity, failures, args.show_values, len(cases))


if __name__ == "__main__":
    raise SystemExit(main())