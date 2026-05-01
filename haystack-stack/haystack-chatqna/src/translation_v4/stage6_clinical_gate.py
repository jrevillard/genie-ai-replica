"""Stage 6 -- Clinical safety gate (wraps existing v5.1 corrector).

The v5.1 corrector at ``src/nlp/translation_corrector.py`` has 13
explicitly numbered layers (the spec text occasionally calls it
"15 layers" -- that is wrong; the file's layer markers are 1-13).

This stage does NOT rewrite the corrector. It calls
``corrector.correct(...)`` and adds one extra signal: if the
corrector had to make many critical corrections, downgrade
confidence by 0.15 because "broken text plus heavy correction"
is still a poor base for serving Mandinka.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


class ClinicalSafetyGate:
    """Stage 6 entry point. Pure pass-through wrapper plus one nudge."""

    def __init__(self) -> None:
        # Lazy load -- importing this module never imports the corrector
        # if v4 is disabled.
        self._corrector = None

    def _get_corrector(self):
        if self._corrector is not None:
            return self._corrector
        try:
            from src.nlp.translation_corrector import get_corrector
            self._corrector = get_corrector()
        except Exception as e:
            logger.warning("v4.stage6: corrector unavailable (%s: %s)", type(e).__name__, e)
            self._corrector = None
        return self._corrector

    def gate(
        self,
        mandinka_text: str,
        english_source: str,
        patient_context: Optional[Dict[str, Any]] = None,
        response_type: str = "general",
    ) -> Dict[str, Any]:
        corrector = self._get_corrector()
        if corrector is None or not (mandinka_text or "").strip():
            return {
                "corrected_text":           mandinka_text,
                "corrector_score":          0.0,
                "corrections_count":        0,
                "critical_corrections":     0,
                "blocked":                  False,
                "block_reason":             None,
                "confidence_adjustment":    0.0,
            }

        try:
            result = corrector.correct(
                mandinka_text=mandinka_text,
                english_source=english_source,
                patient_context=patient_context or {},
                response_type=response_type,
            )
        except Exception as e:
            logger.warning("v4.stage6: corrector raised (%s: %s)", type(e).__name__, e)
            return {
                "corrected_text":           mandinka_text,
                "corrector_score":          0.0,
                "corrections_count":        0,
                "critical_corrections":     0,
                "blocked":                  False,
                "block_reason":             None,
                "confidence_adjustment":    0.0,
                "corrector_error":          str(e)[:160],
            }

        # The corrector returns several count fields. We treat
        # `medical_corrections` + cultural issue count as "critical"
        # for v3.5 because those are the categories the spec
        # specifically calls out.
        med_corrections = int(result.get("medical_corrections") or 0)
        cultural_issue_count = len(result.get("cultural_issues") or [])
        critical = med_corrections + cultural_issue_count

        # Many critical corrections -> the original Mandinka was
        # broken; correcting it doesn't make it good. Downgrade.
        confidence_adjustment = -0.15 if critical > 3 else 0.0

        return {
            "corrected_text":           result.get("corrected_text", mandinka_text),
            "corrector_score":          float(result.get("overall_score") or 0.0),
            "corrections_count":        len(result.get("corrections_applied") or []),
            "critical_corrections":     critical,
            "medical_corrections":      med_corrections,
            "cultural_issues":          result.get("cultural_issues") or [],
            "hard_blockers_fired":      result.get("hard_blockers_fired") or [],
            "blocked":                  result.get("recommendation") == "BLOCK_USE_ENGLISH",
            "block_reason":             result.get("block_reason"),
            "confidence_adjustment":    confidence_adjustment,
        }
