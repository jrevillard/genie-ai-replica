#!/usr/bin/env python3
# The phase-2 judged pass over the B/C legs' rows (issue #2167) — the same
# machinery as judge-m23-e2167.py (the A capture's pass), pointed at a legs
# rows file. The verdict rules stay mechanical (class x signal, computed
# here); the LLM classifies the prose signal and the grounding attribution.
import asyncio, hashlib, importlib.util, json, os, sys, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
# The A pass's machinery, reused verbatim (its file name carries dashes —
# loaded by path, not by module name).
_A = HERE.parent / "e02-thresholds-draft-2026-11-24" / "judge-m23-e2167.py"
_spec = importlib.util.spec_from_file_location("judge_m23_a", _A)
_j = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_j)
judge_call = _j.judge_call
m3_verdict = _j.m3_verdict
sha256_file = _j.sha256_file
INSTRUCTIONS = _j.INSTRUCTIONS

LEG = sys.argv[1]  # B | C
ROWS = HERE / f"config-{LEG.lower()}.rows.json"
OUT = HERE / f"judged-results-{LEG.lower()}.json"

def main() -> int:
    import urllib.request
    rows = json.loads(ROWS.read_text(encoding="utf-8"))["cases"]
    entries = {
        e["id"]: e
        for e in json.loads((HERE / "assessment-set.json").read_text(encoding="utf-8"))["entries"]
    }
    instructions_sha = sha256_file(Path(INSTRUCTIONS))
    results = []
    for index, (case_id, row) in enumerate(sorted(rows.items()), 1):
        entry = entries.get(case_id.split("#")[0])
        if entry is None or (
            row.get("outcome") not in (None, "answered") and row.get("status") not in ("ok",)
        ):
            continue
        try:
            verdict = judge_call(
                {
                    "case_id": case_id,
                    "answer": (row.get("answer") or "")[:4000],
                    "source_documents": row.get("source_documents") or [],
                },
                entry,
            )
        except Exception as failed:
            results.append({
                "case_id": case_id, "case_class": entry.get("case_class"),
                "error": f"judge call failed: {str(failed)[:160]}",
            })
            OUT.write_text(json.dumps({"artifact": "judged-m23-results", "leg": LEG, "results": results}, indent=1, ensure_ascii=False), encoding="utf-8")
            print(f"[{index}/{len(rows)}] {case_id}: JUDGE ERROR recorded", flush=True)
            continue
        signal = verdict.get("m3_signal", "unclassified")
        cls = entry.get("case_class", "unknown")
        if LEG == "B":
            m3, m3_reason = m3_verdict(cls, signal)
        else:
            # Config C carries no mechanical abstention flag; the signal is
            # informational, the abstention dimension is not applicable.
            m3, m3_reason = "not_applicable", "config C carries no mechanical abstention surface"
        results.append({
            "case_id": case_id,
            "case_class": cls,
            "m2": {"verdict": verdict.get("m2_verdict", "unclassified"), "reason": verdict.get("m2_reason", "")},
            "m3": {"signal": signal, "verdict": m3, "reason": m3_reason},
        })
        OUT.write_text(json.dumps({
            "artifact": "judged-m23-results", "leg": LEG,
            "instructions_sha256": instructions_sha,
            "rows_sha256": sha256_file(ROWS),
            "judge": {"endpoint": os.environ["JUDGE_BASE_URL"], "model": os.environ.get("JUDGE_MODEL", "ibm-granite/granite-4.1-8b"), "temperature": 0},
            "results": results,
        }, indent=1, ensure_ascii=False), encoding="utf-8")
        print(f"[{index}/{len(rows)}] {case_id}: m2={results[-1]['m2']['verdict']} m3={m3} ({signal})", flush=True)
    return 0

if __name__ == "__main__":
    sys.exit(main())
