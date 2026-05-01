#!/usr/bin/env python3
"""One-shot v4.2 baseline run.

Runs every entry in ``golden_translations.json`` through the live
v4.2 pipeline inside ``haystack-chatqna`` and persists the result
to ``docs/compliance/translation_v4_baseline_<UTC-date>.json`` so
the next baseline run can diff against it.

The pipeline's Stage 8 telemetry fires automatically per call -- so
every pair also lands in the ArcadeDB ``TranslationMetric`` vertex
when ``V4_TELEMETRY_ARCADEDB=true``. This script's JSON is the
human-readable artefact; ArcadeDB is the time-series.

Cost
    Every pair is one full pipeline run -> up to two LLM calls
    (forward + back-translation) PLUS one NLLB call when the sidecar
    is up. Real money. Run once after a stack change or a
    native-speaker review pass; not on every CI build.

Usage
    python scripts/translation_baseline.py
    python scripts/translation_baseline.py --validated-only
    python scripts/translation_baseline.py --category clinical
    python scripts/translation_baseline.py --compare docs/compliance/translation_v4_baseline_2026-05-01.json
"""
from __future__ import annotations

import argparse
import asyncio
import datetime as _dt
import json
import os
import re
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional


_HERE = Path(__file__).resolve().parent
_REPO_ROOT = _HERE.parent
_GOLDEN_FILE = _REPO_ROOT / "haystack-stack" / "haystack-chatqna" / "src" / "translation_v4" / "eval" / "golden_translations.json"
_BASELINE_DIR = _REPO_ROOT / "docs" / "compliance"
_HAYSTACK_ROOT = _REPO_ROOT / "haystack-stack" / "haystack-chatqna"

sys.path.insert(0, str(_HAYSTACK_ROOT))


_NEG = re.compile(r"\b(?:not|don't|do not|never|avoid|stop|kana|maŋ|te)\b", re.IGNORECASE)
_NUM = re.compile(r"\b\d+(?:[.,]\d+)?\b")


def _negs(text: str) -> int:
    return len(_NEG.findall(text or ""))


def _nums(text: str) -> List[str]:
    return sorted(_NUM.findall(text or ""))


def _now_date() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%d")


def _now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


async def _run_one(pipeline, pair: Dict[str, Any]) -> Dict[str, Any]:
    english = pair.get("english", "")
    started = time.perf_counter()
    out = await pipeline.translate(
        english_text=english,
        patient_context={},
        session_id=f"baseline_{pair.get('id', 'x')}",
        response_type="general",
    )
    elapsed = (time.perf_counter() - started) * 1000
    if out is None:
        return {
            "id":           pair.get("id"),
            "category":     pair.get("category"),
            "english":      english,
            "v4_disabled":  True,
            "wall_ms":      int(elapsed),
        }
    produced = out.get("assembled_output", "") or ""
    selections = out.get("engine_selection") or []
    dominant = Counter(selections).most_common(1)[0][0] if selections else None
    return {
        "id":                       pair.get("id"),
        "category":                 pair.get("category"),
        "critical":                 bool(pair.get("critical")),
        "english":                  english,
        "produced":                 produced,
        "validated_pair":           bool(pair.get("validated")),
        "overall_decision":         out.get("overall_decision"),
        "mandinka_ratio":           out.get("mandinka_ratio"),
        "quality_scores":           out.get("quality_scores"),
        "dominant_engine":          dominant,
        "engine_selection":         selections,
        "nllb_invoked":             bool(out.get("nllb_invoked")),
        "back_translation_method":  (out.get("back_translation") or {}).get("engine_used_back"),
        "back_translation_conf":    (out.get("back_translation") or {}).get("confidence"),
        "negation_preserved":       _negs(english) == _negs(produced),
        "number_preserved":         _nums(english) == _nums(produced),
        "stage_latencies":          out.get("stage_latencies"),
        "total_latency_ms":         out.get("total_latency_ms"),
        "wall_ms":                  int(elapsed),
    }


def _summary(results: List[Dict[str, Any]]) -> Dict[str, Any]:
    runnable = [r for r in results if not r.get("v4_disabled")]
    n = len(runnable)
    if n == 0:
        return {"total": len(results), "v4_disabled": True}

    overall_scores  = [(r.get("quality_scores") or {}).get("overall", 0.0) or 0.0 for r in runnable]
    clinical_scores = [(r.get("quality_scores") or {}).get("clinical_safety", 0.0) or 0.0 for r in runnable]
    fidelity_scores = [(r.get("quality_scores") or {}).get("semantic_fidelity", 0.0) or 0.0 for r in runnable]
    fluency_scores  = [(r.get("quality_scores") or {}).get("fluency", 0.0) or 0.0 for r in runnable]
    cultural_scores = [(r.get("quality_scores") or {}).get("cultural_fit", 0.0) or 0.0 for r in runnable]

    def _stats(xs: List[float]) -> Dict[str, float]:
        if not xs:
            return {"mean": 0.0, "min": 0.0, "max": 0.0}
        s = sorted(xs)
        return {
            "mean":     round(sum(s) / len(s), 3),
            "min":      round(s[0], 3),
            "max":      round(s[-1], 3),
            "p50":      round(s[len(s) // 2], 3),
            "p95":      round(s[max(0, int(len(s) * 0.95) - 1)], 3),
        }

    crit = [r for r in runnable if r.get("critical")]

    by_cat: Dict[str, Dict[str, float]] = {}
    for r in runnable:
        c = r.get("category", "unknown")
        bucket = by_cat.setdefault(c, {"n": 0, "sum_overall": 0.0, "sum_clinical": 0.0, "neg_ok": 0, "num_ok": 0})
        bucket["n"] += 1
        bucket["sum_overall"]  += float((r.get("quality_scores") or {}).get("overall") or 0.0)
        bucket["sum_clinical"] += float((r.get("quality_scores") or {}).get("clinical_safety") or 0.0)
        if r.get("negation_preserved"): bucket["neg_ok"] += 1
        if r.get("number_preserved"):   bucket["num_ok"] += 1
    for c, b in by_cat.items():
        b["mean_overall"]   = round(b["sum_overall"] / max(1, b["n"]), 3)
        b["mean_clinical"]  = round(b["sum_clinical"] / max(1, b["n"]), 3)
        b["negation_rate"]  = round(b["neg_ok"] / max(1, b["n"]), 3)
        b["number_rate"]    = round(b["num_ok"] / max(1, b["n"]), 3)
        del b["sum_overall"], b["sum_clinical"]

    latencies = sorted((r.get("total_latency_ms") or 0) for r in runnable)
    lat_p50 = latencies[len(latencies) // 2] if latencies else 0
    lat_p95 = latencies[max(0, int(len(latencies) * 0.95) - 1)] if latencies else 0

    return {
        "total":                            len(results),
        "runnable":                         n,
        "negation_preservation_rate":       round(sum(1 for r in runnable if r.get("negation_preserved")) / n, 3),
        "number_preservation_rate":         round(sum(1 for r in runnable if r.get("number_preserved")) / n, 3),
        "critical_negation_rate":           round(sum(1 for r in crit if r.get("negation_preserved")) / max(1, len(crit)), 3),
        "critical_number_rate":             round(sum(1 for r in crit if r.get("number_preserved")) / max(1, len(crit)), 3),
        "critical_total":                   len(crit),
        "score_overall":                    _stats(overall_scores),
        "score_clinical_safety":            _stats(clinical_scores),
        "score_semantic_fidelity":          _stats(fidelity_scores),
        "score_fluency":                    _stats(fluency_scores),
        "score_cultural_fit":               _stats(cultural_scores),
        "engine_distribution":              dict(Counter(r.get("dominant_engine") or "none" for r in runnable)),
        "back_translation_methods":         dict(Counter(r.get("back_translation_method") or "none" for r in runnable)),
        "nllb_invocation_rate":             round(sum(1 for r in runnable if r.get("nllb_invoked")) / n, 3),
        "latency_p50_ms":                   int(lat_p50),
        "latency_p95_ms":                   int(lat_p95),
        "by_category":                      by_cat,
    }


def _diff(prev: Dict[str, Any], curr: Dict[str, Any]) -> Dict[str, Any]:
    """Highlight regressions vs. a previous baseline summary."""
    p, c = (prev or {}).get("summary") or {}, (curr or {}).get("summary") or {}
    if not p:
        return {"note": "no previous baseline summary; first run."}
    out: Dict[str, Any] = {}
    keys = (
        "negation_preservation_rate",
        "number_preservation_rate",
        "critical_negation_rate",
        "critical_number_rate",
        "nllb_invocation_rate",
    )
    for k in keys:
        out[k] = {"prev": p.get(k), "curr": c.get(k), "delta": round((c.get(k) or 0) - (p.get(k) or 0), 3)}
    p_overall = (p.get("score_overall") or {}).get("mean", 0.0)
    c_overall = (c.get("score_overall") or {}).get("mean", 0.0)
    out["score_overall_mean"] = {"prev": p_overall, "curr": c_overall, "delta": round(c_overall - p_overall, 3)}
    return out


async def _amain(args: argparse.Namespace) -> int:
    try:
        from src.translation_v4 import config as cfg
        from src.translation_v4.pipeline import get_pipeline
    except Exception as e:
        print(f"[ERROR] cannot import translation_v4: {e}", file=sys.stderr)
        return 1

    if not cfg.AMINA_TRANSLATION_V4_ENABLED:
        print("[ERROR] AMINA_TRANSLATION_V4_ENABLED is false in this env; baseline cannot run.", file=sys.stderr)
        print("        export AMINA_TRANSLATION_V4_ENABLED=true and re-run.", file=sys.stderr)
        return 2

    print(f"[baseline] v4 enabled flag = {cfg.AMINA_TRANSLATION_V4_ENABLED}")
    print(f"[baseline] NLLB enabled    = {cfg.NLLB_ENABLED}")
    print(f"[baseline] NLLB API URL    = {cfg.NLLB_API_URL}")
    print(f"[baseline] golden file     = {_GOLDEN_FILE}")

    with _GOLDEN_FILE.open("r", encoding="utf-8") as f:
        data = json.load(f)
    pairs: List[Dict[str, Any]] = list(data.get("pairs") or [])
    if args.validated_only:
        pairs = [p for p in pairs if p.get("validated")]
    if args.category:
        pairs = [p for p in pairs if p.get("category") == args.category]
    print(f"[baseline] pairs to run    = {len(pairs)}")
    if not pairs:
        print("[baseline] nothing to run (filter excluded everything).")
        return 0

    pipeline = get_pipeline()
    results: List[Dict[str, Any]] = []
    started_at = time.perf_counter()
    for i, p in enumerate(pairs, 1):
        try:
            r = await _run_one(pipeline, p)
            results.append(r)
            sc = (r.get("quality_scores") or {}).get("overall")
            print(f"  [{i:3}/{len(pairs)}] {p.get('id'):<28} -> {r.get('overall_decision','SKIP'):16} score={sc}")
        except Exception as e:
            print(f"  [{i:3}/{len(pairs)}] {p.get('id')}: ERROR {type(e).__name__}: {str(e)[:120]}")
            results.append({"id": p.get("id"), "category": p.get("category"), "error": f"{type(e).__name__}: {str(e)[:200]}"})
    wall = (time.perf_counter() - started_at) * 1000

    summary = _summary(results)
    summary["wall_ms"] = int(wall)
    summary["timestamp"] = _now_iso()

    artefact: Dict[str, Any] = {
        "schema":           "translation_v4_baseline.v1",
        "timestamp":        summary["timestamp"],
        "config_snapshot":  cfg.snapshot(),
        "summary":          summary,
        "results":          results,
    }

    _BASELINE_DIR.mkdir(parents=True, exist_ok=True)
    out_path = _BASELINE_DIR / f"translation_v4_baseline_{_now_date()}.json"
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(artefact, f, ensure_ascii=False, indent=2, sort_keys=False)
    print()
    print(f"[baseline] wrote {out_path} ({len(results)} results)")

    print()
    print("=== Summary ===")
    print(json.dumps(summary, indent=2, default=str))

    if args.compare:
        try:
            with Path(args.compare).open("r", encoding="utf-8") as f:
                prev = json.load(f)
            print()
            print(f"=== Diff vs {args.compare} ===")
            print(json.dumps(_diff(prev, artefact), indent=2, default=str))
        except Exception as e:
            print(f"[WARN] could not load comparison baseline: {e}")

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Translation v4.2 baseline run")
    parser.add_argument("--category",       help="Only run pairs in this category")
    parser.add_argument("--validated-only", action="store_true", help="Only run pairs with validated=true")
    parser.add_argument("--compare",        help="Path to a previous baseline JSON to diff against")
    args = parser.parse_args()
    return asyncio.run(_amain(args))


if __name__ == "__main__":
    sys.exit(main())
