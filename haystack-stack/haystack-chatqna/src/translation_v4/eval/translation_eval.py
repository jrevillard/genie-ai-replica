"""Run the v3.5 pipeline against the golden pairs and produce a report.

Usage (from repo root):
    PYTHONIOENCODING=utf-8 \
    AMINA_TRANSLATION_V4_ENABLED=true \
    python haystack-stack/haystack-chatqna/src/translation_v4/eval/translation_eval.py

The harness uses the golden pairs as the SOURCE OF TRUTH for negation
and number preservation only -- semantic similarity is computed against
the model's actual output, not the golden Mandinka. This means the
hard pass/fail criteria do not depend on the golden Mandinka being
correct (which it is not yet -- pending native-speaker review).

Hard pass criteria:
    negation_preservation_rate >= 100%   -- ZERO tolerance
    number_preservation_rate   >= 100%   -- ZERO tolerance

Soft criteria (logged, not blocking):
    semantic_similarity_avg
    exact_match_rate (informational; will be low until native review)
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List


# Make sure we can import from src.* whether run from repo root or
# from this file's directory.
_HERE = Path(__file__).resolve().parent
_HAYSTACK_ROOT = _HERE.parent.parent.parent  # .../haystack-chatqna
sys.path.insert(0, str(_HAYSTACK_ROOT))


_NEGATION = re.compile(r"\b(?:not|don't|do not|never|avoid|stop|kana|maŋ|te)\b", re.IGNORECASE)
_NUMBER = re.compile(r"\b\d+(?:[.,]\d+)?\b")


def _negs(text: str) -> int:
    return len(_NEGATION.findall(text or ""))


def _nums(text: str) -> List[str]:
    return sorted(_NUMBER.findall(text or ""))


def _load_pairs() -> List[Dict[str, Any]]:
    path = _HERE / "golden_translations.json"
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    return list(data.get("pairs") or [])


async def _run_pair(pipeline, pair: Dict[str, Any]) -> Dict[str, Any]:
    english = pair.get("english", "")
    golden_mandinka = pair.get("mandinka", "")
    out = await pipeline.translate(
        english_text=english,
        patient_context={},
        session_id=f"eval_{pair.get('id', 'x')}",
        response_type="general",
    )
    if out is None:
        # Pipeline disabled. Return a stub so the report shows the run
        # happened but produced no v4 output.
        return {
            "id":               pair.get("id"),
            "category":         pair.get("category"),
            "v4_disabled":      True,
            "english":          english,
            "golden_mandinka":  golden_mandinka,
        }
    produced = out.get("assembled_output", "") or ""
    # Negation/number preservation: compared between the input English
    # and the produced output (which may be all-Mandinka, bilingual,
    # or all-English depending on routing).
    en_negs = _negs(english)
    out_negs = _negs(produced)
    en_nums = _nums(english)
    out_nums = _nums(produced)
    # v4.2 attribution: which engine(s) drove this sentence + which
    # back-translation method ran. ``engine_selection`` is a list (one
    # entry per simplified-source-sentence) so we record the dominant
    # engine for the per-pair row.
    selections = out.get("engine_selection") or []
    dominant_engine = None
    if selections:
        # Most-common selection wins for the report row.
        from collections import Counter as _C
        dominant_engine = _C(selections).most_common(1)[0][0]
    return {
        "id":                       pair.get("id"),
        "category":                 pair.get("category"),
        "english":                  english,
        "golden_mandinka":          golden_mandinka,
        "produced":                 produced,
        "overall_decision":         out.get("overall_decision"),
        "mandinka_ratio":           out.get("mandinka_ratio"),
        "scores":                   out.get("quality_scores"),
        "engine_selection":         selections,
        "dominant_engine":          dominant_engine,
        "nllb_invoked":             bool(out.get("nllb_invoked")),
        "back_translation_method":  (out.get("back_translation") or {}).get("engine_used_back"),
        "negation_preserved":       en_negs == out_negs,
        "negation_input":           en_negs,
        "negation_output":          out_negs,
        "numbers_preserved":        en_nums == out_nums,
        "numbers_input":            en_nums,
        "numbers_output":           out_nums,
        "exact_match":              produced.strip() == golden_mandinka.strip() and bool(golden_mandinka),
        "total_latency_ms":         out.get("total_latency_ms"),
    }


def _summarize(results: List[Dict[str, Any]]) -> Dict[str, Any]:
    total = len(results)
    if total == 0:
        return {"total": 0}
    runnable = [r for r in results if not r.get("v4_disabled")]
    if not runnable:
        return {
            "total":            total,
            "v4_disabled":      True,
            "note":             "AMINA_TRANSLATION_V4_ENABLED=false -- harness ran but pipeline is off",
        }
    by_cat: Dict[str, Dict[str, int]] = {}
    for r in runnable:
        c = r.get("category", "unknown")
        bucket = by_cat.setdefault(c, {"total": 0, "negation_ok": 0, "numbers_ok": 0, "exact": 0})
        bucket["total"] += 1
        if r.get("negation_preserved"): bucket["negation_ok"] += 1
        if r.get("numbers_preserved"):  bucket["numbers_ok"] += 1
        if r.get("exact_match"):        bucket["exact"] += 1

    neg_total = sum(b["negation_ok"] for b in by_cat.values())
    num_total = sum(b["numbers_ok"] for b in by_cat.values())
    exact_total = sum(b["exact"] for b in by_cat.values())
    n = len(runnable)
    avg_latency = sum((r.get("total_latency_ms") or 0) for r in runnable) / max(1, n)

    # v4.2 attribution metrics.
    from collections import Counter as _Counter
    engine_dominant = _Counter((r.get("dominant_engine") or "unknown") for r in runnable)
    bt_methods = _Counter((r.get("back_translation_method") or "unknown") for r in runnable)
    nllb_invocations = sum(1 for r in runnable if r.get("nllb_invoked"))

    return {
        "total":                            total,
        "runnable":                         n,
        "negation_preservation_rate":       round(neg_total / n, 3),
        "number_preservation_rate":         round(num_total / n, 3),
        "exact_match_rate":                 round(exact_total / n, 3),
        "average_latency_ms":               int(avg_latency),
        "by_category":                      by_cat,
        # v4.2 attribution
        "v42_engine_distribution":          dict(engine_dominant),
        "v42_back_translation_methods":     dict(bt_methods),
        "v42_nllb_invocation_rate":         round(nllb_invocations / n, 3) if n else 0.0,
    }


async def _amain() -> int:
    try:
        from src.translation_v4 import config as v4_config
        from src.translation_v4.pipeline import get_pipeline
    except Exception as e:
        print(f"[ERROR] cannot import translation_v4: {e}", file=sys.stderr)
        return 1

    print(f"[eval] v4 enabled flag: {v4_config.AMINA_TRANSLATION_V4_ENABLED}")
    pairs = _load_pairs()
    print(f"[eval] golden pairs loaded: {len(pairs)}")

    pipeline = get_pipeline()
    results: List[Dict[str, Any]] = []
    for p in pairs:
        try:
            r = await _run_pair(pipeline, p)
            results.append(r)
        except Exception as e:  # never let one bad pair break the run
            results.append({
                "id":           p.get("id"),
                "category":     p.get("category"),
                "english":      p.get("english"),
                "error":        f"{type(e).__name__}: {str(e)[:160]}",
            })

    summary = _summarize(results)
    report = {"summary": summary, "results": results}
    print(json.dumps(summary, indent=2, default=str))

    # Hard pass criteria. Skipped when v4 is disabled (no point).
    if not summary.get("v4_disabled"):
        if summary.get("negation_preservation_rate", 0.0) < 1.0:
            print("[FAIL] negation_preservation_rate < 100% -- BLOCK", file=sys.stderr)
            return 2
        if summary.get("number_preservation_rate", 0.0) < 1.0:
            print("[FAIL] number_preservation_rate < 100% -- BLOCK", file=sys.stderr)
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(_amain()))
