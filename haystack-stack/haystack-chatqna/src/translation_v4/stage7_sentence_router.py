"""Stage 7 -- Per-sentence serve-decision router.

The v1 translator decides at full-message granularity: if the message
is good enough, serve all-Mandinka; otherwise serve all-English. v3.5
makes the decision per sentence so one bad sentence does not block
all the good ones (and one good sentence does not carry a bad one).

Decision rule per sentence:
    score >= V4_SERVE_MANDINKA_THRESHOLD                  -> SERVE_MANDINKA
    score >= V4_SERVE_BILINGUAL_THRESHOLD                 -> SERVE_BILINGUAL
    score < V4_SERVE_BILINGUAL_THRESHOLD                  -> SERVE_ENGLISH
    clinical_safety < V4_CLINICAL_SAFETY_BLOCK            -> SERVE_ENGLISH (override)

Assembly: interleave the per-sentence decisions in original order.
For SERVE_BILINGUAL we render English with the Mandinka in parens.
"""
from __future__ import annotations

from typing import Any, Dict, List

from . import config


class SentenceRouter:
    """Stage 7 entry point."""

    def route(
        self,
        scored: Dict[str, Any],
        engine_results: List[Dict[str, Any]],
        clinical_safety: float,
    ) -> Dict[str, Any]:
        per_sentence = scored.get("per_sentence_scores") or []
        decisions: List[Dict[str, Any]] = []
        mandinka_count = 0

        # Pair scored sentences with the engine result for the same
        # index so we still have the English source available.
        for idx, ps in enumerate(per_sentence):
            er = engine_results[idx] if idx < len(engine_results) else {}
            english = ps.get("english") or er.get("sentence", "")
            mandinka = ps.get("mandinka") or er.get("selected_translation", "")
            score = float(ps.get("score") or 0.0)

            # Clinical-safety override: any sentence below the floor
            # must serve English regardless of overall score.
            if clinical_safety < config.V4_CLINICAL_SAFETY_BLOCK:
                decision = "SERVE_ENGLISH"
                reason = "clinical_safety_below_block_threshold"
            elif score >= config.V4_SERVE_MANDINKA_THRESHOLD:
                decision = "SERVE_MANDINKA"
                reason = "score_above_mandinka_threshold"
                mandinka_count += 1
            elif score >= config.V4_SERVE_BILINGUAL_THRESHOLD:
                decision = "SERVE_BILINGUAL"
                reason = "score_in_bilingual_band"
                mandinka_count += 1  # still emits Mandinka, just with English fallback
            else:
                decision = "SERVE_ENGLISH"
                reason = "score_below_bilingual_threshold"

            decisions.append({
                "english":  english,
                "mandinka": mandinka if decision != "SERVE_ENGLISH" else None,
                "decision": decision,
                "score":    round(score, 3),
                "reason":   reason,
            })

        # Assemble the final string. For BILINGUAL we use the form
        # "English (Mandinka)" -- compact and unambiguous to the reader.
        out_pieces: List[str] = []
        for d in decisions:
            if d["decision"] == "SERVE_MANDINKA" and d["mandinka"]:
                out_pieces.append(d["mandinka"])
            elif d["decision"] == "SERVE_BILINGUAL" and d["mandinka"]:
                out_pieces.append(f"{d['english']} ({d['mandinka']})")
            else:
                out_pieces.append(d["english"])
        assembled = " ".join(out_pieces).strip()

        # Overall mode: if every sentence served Mandinka, MANDINKA;
        # if mixed, BILINGUAL; if none, ENGLISH.
        if not decisions:
            overall = "SERVE_ENGLISH"
        elif all(d["decision"] == "SERVE_MANDINKA" for d in decisions):
            overall = "SERVE_MANDINKA"
        elif all(d["decision"] == "SERVE_ENGLISH" for d in decisions):
            overall = "SERVE_ENGLISH"
        else:
            overall = "SERVE_BILINGUAL"

        ratio = (mandinka_count / max(1, len(decisions))) if decisions else 0.0

        return {
            "sentences":            decisions,
            "overall_decision":     overall,
            "mandinka_ratio":       round(ratio, 3),
            "assembly_strategy":    "interleaved",
            "assembled_output":     assembled,
        }
