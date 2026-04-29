"""
Translation Quality Gate — prevents bad Mandinka translations from
reaching users.

Scores LLM-generated Mandinka text on four axes:
  1. Untranslated English medical terms
  2. Repetitive phrasing (template hallucination)
  3. Length ratio vs English source
  4. Phrase bank coverage

Decision:
  SERVE_MANDINKA      — score >= 0.7, translation is reliable
  SERVE_BILINGUAL     — score 0.4-0.7, show English + Mandinka key phrases
  SERVE_ENGLISH_ONLY  — score < 0.4, Mandinka too unreliable
"""

from __future__ import annotations

import logging
import re
from collections import Counter
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

# ── Terms that must NEVER be translated ──────────────────────────

NEVER_TRANSLATE = {
    "BP", "mg", "mg/dL", "mmHg", "mmol/L", "HbA1c", "199", "WHO",
    "EFSTH", "metformin", "amlodipine", "glibenclamide", "hydrochlorothiazide",
    "atenolol", "lisinopril", "losartan", "nifedipine", "enalapril",
    "insulin", "aspirin", "paracetamol", "ibuprofen", "ACE",
    "ARB", "NSAID", "ORS", "IV", "ECG", "ICU",
}

# Regex for English medical terms that should NOT appear untranslated
_ENGLISH_MEDICAL_RE = re.compile(
    r"\b(?:Diabetic Ketoacidosis|ketoacidosis|hyperglycemia|hypoglycemia|"
    r"hypertension|cardiovascular|cholesterol|triglyceride|hemoglobin|"
    r"glycemic|glycated|retinopathy|neuropathy|nephropathy|"
    r"protein|fiber|carbohydrate|calorie|sodium|potassium|"
    r"glucose|fasting|postprandial|insulin resistance|"
    r"systolic|diastolic|angina|arrhythmia|atherosclerosis|"
    r"stroke|thrombosis|embolism|aneurysm)\b",
    re.IGNORECASE,
)

# Simpler English words that indicate poor translation quality
_ENGLISH_COMMON_RE = re.compile(
    r"\b(?:because|therefore|however|although|important|"
    r"recommend|increase|decrease|maintain|manage|monitor|"
    r"condition|treatment|medication|symptoms?|diagnosis|"
    r"doctor|hospital|clinic|appointment|exercise|physical)\b",
    re.IGNORECASE,
)


class TranslationQualityGate:

    def __init__(self):
        self._audit_log: List[Dict[str, Any]] = []

    def verify_translation(
        self, english_text: str, mandinka_text: str,
    ) -> Dict[str, Any]:
        """Score a Mandinka translation and decide how to serve it.

        Returns:
            {
                "score": float 0.0-1.0,
                "decision": "SERVE_MANDINKA" | "SERVE_BILINGUAL" | "SERVE_ENGLISH_ONLY",
                "flags": list of issue strings,
                "details": dict of per-axis scores,
            }
        """
        flags: List[str] = []

        # ── 1. Untranslated English medical terms ────────────
        medical_hits = _ENGLISH_MEDICAL_RE.findall(mandinka_text)
        medical_penalty = 0.0
        if medical_hits:
            unique_hits = set(h.lower() for h in medical_hits)
            medical_penalty = min(0.4, len(unique_hits) * 0.1)
            flags.append(f"UNTRANSLATED_MEDICAL: {', '.join(unique_hits)}")

        # Common English words (less severe)
        common_hits = _ENGLISH_COMMON_RE.findall(mandinka_text)
        # Exclude NEVER_TRANSLATE terms (those are OK in Mandinka text)
        common_filtered = [
            w for w in common_hits
            if w.upper() not in NEVER_TRANSLATE and w not in NEVER_TRANSLATE
        ]
        common_penalty = 0.0
        if len(common_filtered) > 3:
            common_penalty = min(0.3, (len(common_filtered) - 3) * 0.05)
            flags.append(f"ENGLISH_LEAKAGE: {len(common_filtered)} common words")

        # ── 2. Repetitive phrasing ───────────────────────────
        repetition_penalty = 0.0
        words_3gram = mandinka_text.split()
        if len(words_3gram) >= 6:
            trigrams = [
                " ".join(words_3gram[i:i+3])
                for i in range(len(words_3gram) - 2)
            ]
            trigram_counts = Counter(trigrams)
            repeated = {k: v for k, v in trigram_counts.items() if v >= 3}
            if repeated:
                repetition_penalty = min(0.4, len(repeated) * 0.15)
                flags.append(f"TEMPLATE_GENERATED: {len(repeated)} repeated phrases")

        # ── 3. Length ratio ──────────────────────────────────
        length_penalty = 0.0
        en_len = max(len(english_text.split()), 1)
        ma_len = max(len(mandinka_text.split()), 1)
        ratio = ma_len / en_len
        if ratio < 0.5 or ratio > 2.0:
            length_penalty = 0.3
            flags.append(f"SUSPICIOUS_LENGTH: ratio={ratio:.2f}")
        elif ratio < 0.8 or ratio > 1.4:
            length_penalty = 0.1
            flags.append(f"LENGTH_SLIGHTLY_OFF: ratio={ratio:.2f}")

        # ── 4. Phrase bank coverage ──────────────────────────
        coverage_penalty = 0.0
        try:
            from src.services.mandinka_phrases import PHRASES
            validated_count = 0
            total_segments = 0
            ma_lower = mandinka_text.lower()
            for cat_phrases in PHRASES.values():
                for phrase in cat_phrases.values():
                    if isinstance(phrase, str) and len(phrase) > 2:
                        total_segments += 1
                        if phrase.lower() in ma_lower:
                            validated_count += 1

            if total_segments > 0:
                coverage = validated_count / max(1, ma_len // 5)
                if coverage < 0.15:
                    coverage_penalty = 0.3
                    flags.append(f"MOSTLY_UNVALIDATED: coverage={coverage:.0%}")
                elif coverage < 0.30:
                    coverage_penalty = 0.15
                    flags.append(f"LOW_COVERAGE: coverage={coverage:.0%}")
        except ImportError:
            pass

        # ── Compute final score ──────────────────────────────
        total_penalty = (
            medical_penalty + common_penalty +
            repetition_penalty + length_penalty + coverage_penalty
        )
        score = max(0.0, min(1.0, 1.0 - total_penalty))

        if score >= 0.7:
            decision = "SERVE_MANDINKA"
        elif score >= 0.4:
            decision = "SERVE_BILINGUAL"
        else:
            decision = "SERVE_ENGLISH_ONLY"

        result = {
            "score": round(score, 3),
            "decision": decision,
            "flags": flags,
            "details": {
                "medical_penalty": round(medical_penalty, 3),
                "common_penalty": round(common_penalty, 3),
                "repetition_penalty": round(repetition_penalty, 3),
                "length_penalty": round(length_penalty, 3),
                "coverage_penalty": round(coverage_penalty, 3),
                "length_ratio": round(ratio, 2),
            },
        }

        self._audit(english_text, mandinka_text, result)
        return result

    def _audit(
        self, english: str, mandinka: str, result: Dict,
    ) -> None:
        entry = {
            "english_preview": english[:120],
            "mandinka_preview": mandinka[:120],
            "score": result["score"],
            "decision": result["decision"],
            "flags": result["flags"],
        }
        self._audit_log.append(entry)
        if len(self._audit_log) > 200:
            self._audit_log = self._audit_log[-100:]

        logger.info(
            "TranslationGate: score=%.2f decision=%s flags=%s",
            result["score"], result["decision"], result["flags"],
        )

    def get_audit_log(self) -> List[Dict[str, Any]]:
        return list(self._audit_log)


# Singleton
_gate: TranslationQualityGate | None = None


def get_gate() -> TranslationQualityGate:
    global _gate
    if _gate is None:
        _gate = TranslationQualityGate()
    return _gate
