"""Stage 5 -- Multi-axis quality scoring.

AfriCOMET-inspired four-axis scorer. We do NOT collapse to a single
number for the per-sentence routing decision; the router consumes
both ``overall`` and ``clinical_safety`` because a sentence that says
"eat sugar" instead of "do not eat sugar" is unsafe even if it scores
high on fluency.

Weights (rationale: clinical safety dominates):
    clinical_safety   0.35
    semantic_fidelity 0.30
    fluency           0.20
    cultural_fit      0.15
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional


# Weight vector. Sums to 1.0; do not change without aligning the
# router thresholds in Stage 7 / config.
_WEIGHTS = {
    "clinical_safety":      0.35,
    "semantic_fidelity":    0.30,
    "fluency":              0.20,
    "cultural_fit":         0.15,
}


def _english_leak_ratio(mandinka_text: str) -> float:
    """Crude estimate of English-token leakage. Cheap, deterministic."""
    if not mandinka_text:
        return 0.0
    tokens = re.findall(r"[A-Za-z]+", mandinka_text)
    if not tokens:
        return 0.0
    common_english = {
        "the", "and", "for", "you", "your", "with", "this", "that",
        "have", "has", "is", "are", "to", "of", "in", "on", "be",
    }
    leaks = sum(1 for t in tokens if t.lower() in common_english)
    return leaks / max(1, len(tokens))


def _fluency_score(per_sentence: List[Dict[str, Any]], engine_results: List[Dict[str, Any]]) -> float:
    """Combine phrasebank coverage + leak ratio + repetition into a
    single fluency proxy. All deterministic, all bounded in [0, 1]."""
    if not engine_results:
        return 0.0
    coverages = []
    for r in engine_results:
        pb = (r.get("engine_results") or {}).get("phrasebank") or {}
        coverages.append(float(pb.get("coverage", 0.0)))
    avg_cov = sum(coverages) / len(coverages) if coverages else 0.0

    # Leak penalty: each 10% English leak knocks 0.1 off the score.
    avg_leak = sum(_english_leak_ratio(r.get("selected_translation", "")) for r in engine_results) / max(1, len(engine_results))
    leak_pen = min(0.5, avg_leak * 1.0)

    fluency = max(0.0, min(1.0, avg_cov + (1.0 - leak_pen) * 0.3))
    return round(fluency, 3)


def _semantic_fidelity_score(back_translation_result: Optional[Dict[str, Any]]) -> float:
    """Comes straight from Stage 4's semantic_similarity, with a hard
    floor of 0 when back-translation was skipped/blocked."""
    if not back_translation_result:
        return 0.0
    rec = back_translation_result.get("recommendation", "")
    if rec == "BLOCK":
        return 0.0
    return round(float(back_translation_result.get("semantic_similarity", 0.0)), 3)


def _clinical_safety_score(back_translation_result: Optional[Dict[str, Any]],
                           corrector_critical_corrections: int) -> float:
    """Negation + number preservation + corrector criticals. Each axis
    can independently take the score to zero -- "fail closed" by design."""
    score = 1.0
    if back_translation_result:
        ent = back_translation_result.get("entities_preserved") or {}
        if not ent.get("negations", True):
            return 0.0  # negation flips are unsafe regardless of anything else
        if not ent.get("numbers", True):
            score -= 0.4
        if not ent.get("food_names", True):
            score -= 0.1
    # Each "critical" correction the v5.1 corrector had to make is
    # evidence the original was unsafe; cap the penalty at 0.45.
    score -= min(0.45, 0.15 * max(0, corrector_critical_corrections))
    return round(max(0.0, min(1.0, score)), 3)


def _cultural_fit_score(corrector_result: Optional[Dict[str, Any]]) -> float:
    """Pulls from the corrector's cultural-issues list. Empty list = 1.0;
    each issue knocks 0.2 off, floored at 0."""
    if not corrector_result:
        return 0.7  # no information; mid-range default
    issues = corrector_result.get("cultural_issues") or []
    return round(max(0.0, 1.0 - 0.2 * len(issues)), 3)


class TranslationQualityScorer:
    """Stage 5 entry point."""

    def score(
        self,
        engine_results: List[Dict[str, Any]],
        back_translation_result: Optional[Dict[str, Any]],
        corrector_result: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        per_sentence: List[Dict[str, Any]] = []
        for r in engine_results:
            sentence = r.get("sentence", "")
            mandinka = r.get("selected_translation", "")
            cov = (r.get("engine_results") or {}).get("phrasebank", {}).get("coverage", 0.0)
            leak = _english_leak_ratio(mandinka)
            per_sentence.append({
                "english":          sentence,
                "mandinka":         mandinka,
                "selected_engine":  r.get("selected"),
                "phrasebank_cov":   round(float(cov), 3),
                "english_leak":     round(leak, 3),
            })

        critical = int((corrector_result or {}).get("hard_blockers_fired", []) and 1 or 0)
        # Count real "critical" corrections from the corrector when it
        # exposes them; otherwise fall back to the binary flag above.
        crit_field = (corrector_result or {}).get("critical_corrections")
        if isinstance(crit_field, int):
            critical = crit_field

        clinical = _clinical_safety_score(back_translation_result, critical)
        fidelity = _semantic_fidelity_score(back_translation_result)
        fluency = _fluency_score(per_sentence, engine_results)
        cultural = _cultural_fit_score(corrector_result)

        overall = (
            _WEIGHTS["clinical_safety"]   * clinical +
            _WEIGHTS["semantic_fidelity"] * fidelity +
            _WEIGHTS["fluency"]           * fluency +
            _WEIGHTS["cultural_fit"]      * cultural
        )
        overall = round(max(0.0, min(1.0, overall)), 3)

        # Per-sentence overall score: same axes but use only the
        # signals available at sentence level (we don't have a
        # back-translation per sentence in v3.5).
        for ps in per_sentence:
            sentence_overall = (
                _WEIGHTS["clinical_safety"]   * clinical +
                _WEIGHTS["semantic_fidelity"] * fidelity +
                _WEIGHTS["fluency"]           * (1.0 - ps["english_leak"]) +
                _WEIGHTS["cultural_fit"]      * cultural
            )
            ps["score"] = round(max(0.0, min(1.0, sentence_overall)), 3)

        flags: List[str] = []
        if clinical < 0.5:
            flags.append("LOW_CLINICAL_SAFETY")
        if fidelity < 0.5:
            flags.append("LOW_SEMANTIC_FIDELITY")
        if fluency < 0.5:
            flags.append("LOW_FLUENCY")

        if overall >= 0.80:
            recommendation = "SERVE_MANDINKA"
        elif overall >= 0.60:
            recommendation = "SERVE_BILINGUAL"
        else:
            recommendation = "SERVE_ENGLISH"

        lowest = min((ps["score"] for ps in per_sentence), default=overall)

        return {
            "semantic_fidelity":    fidelity,
            "fluency":              fluency,
            "clinical_safety":      clinical,
            "cultural_fit":         cultural,
            "overall":              overall,
            "per_sentence_scores":  per_sentence,
            "lowest_sentence":      round(lowest, 3),
            "flags":                flags,
            "recommendation":       recommendation,
        }
