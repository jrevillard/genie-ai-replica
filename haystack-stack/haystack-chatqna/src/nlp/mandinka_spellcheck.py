"""Mandinka spell normalizer -- phonetic variant to canonical form.

Pure dictionary lookup + string substitution rules.
No ML models. Target latency: < 5ms per message.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

__all__ = ["MandinkaNormalizer"]


@dataclass(frozen=True)
class _Correction:
    original: str
    corrected: str
    confidence: float


CANONICAL_FORMS: Dict[str, str] = {
    # --- Greetings ---
    "salam": "salaam",
    "salaamu": "salaam",
    "aleykum": "aleikum",
    "alaykum": "aleikum",
    "isama": "isama",
    "i sama": "isama",
    "iisama": "isama",

    # --- Medical ---
    "dokotoro": "dokitaroo",
    "doktoro": "dokitaroo",
    "doktar": "dokitaroo",
    "sukaro": "sukkaroo",
    "sukaaro": "sukkaroo",
    "sukkar": "sukkaroo",
    "furaango": "furaŋo",
    "furanyo": "furaŋo",
    "furang": "furaŋo",
    "kangkulung": "kankuluŋ",
    "kankulung": "kankuluŋ",
    "sasaringo": "saasaariŋo",
    "sasaaring": "saasaariŋo",
    "dimii": "dimi",
    "dimee": "dimi",
    "kurango": "kurango",
    "kurang": "kurango",
    "kendeya": "kendeyaa",
    "ospitali": "ospitaali",
    "ospital": "ospitaali",
    "lopitaŋ": "ospitaali",

    # --- Food ---
    "benacin": "benachin",
    "bena chin": "benachin",
    "benachiin": "benachin",
    "domodaa": "domoda",
    "supakanja": "supakanja",
    "supa kanja": "supakanja",
    "attaya": "attaayaa",
    "ataaya": "attaayaa",
    "atayaa": "attaayaa",
    "tapalapa": "tapalapa",
    "tapa lapa": "tapalapa",
    "nebedaye": "nebedaye",
    "nebeday": "nebedaye",

    # --- Body ---
    "kung": "kuŋ",
    "kuŋ": "kuŋ",
    "kun": "kuŋ",
    "konoo": "kono",
    "sengo": "seŋo",
    "seng": "seŋo",
    "jolo": "joloo",
    "nyaa": "ñaa",
    "ñaa": "ñaa",
    "nyah": "ñaa",
}

_MULTI_WORD_VARIANTS: Dict[str, str] = {
    k: v for k, v in CANONICAL_FORMS.items() if " " in k
}

_SINGLE_WORD_VARIANTS: Dict[str, str] = {
    k: v for k, v in CANONICAL_FORMS.items() if " " not in k
}

_KNOWN_CANONICAL: set = set(CANONICAL_FORMS.values())

_PHONETIC_SUBS: List[Tuple[re.Pattern, str]] = [
    (re.compile(r"ny"), "ñ"),
    (re.compile(r"ng\b"), "ŋ"),
    (re.compile(r"n\b(?![.,;:!?\s]*$)"), "ŋ"),  # trailing n -> ŋ only mid-word-boundary context
    (re.compile(r"dy"), "j"),
]

_VOWEL_EXPAND: Dict[str, str] = {
    "a": "aa",
    "e": "ee",
    "i": "ii",
    "o": "oo",
    "u": "uu",
}


class MandinkaNormalizer:

    def __init__(self) -> None:
        self._single: Dict[str, str] = dict(_SINGLE_WORD_VARIANTS)
        self._multi: Dict[str, str] = dict(_MULTI_WORD_VARIANTS)
        self._multi_sorted: List[Tuple[str, str]] = self._build_multi_sorted()
        self._known: set = set(_KNOWN_CANONICAL)

    def _build_multi_sorted(self) -> List[Tuple[str, str]]:
        return sorted(self._multi.items(), key=lambda kv: -len(kv[0]))

    def add_variant(self, variant: str, canonical: str) -> None:
        variant_lower = variant.lower().strip()
        canonical_lower = canonical.lower().strip()
        if " " in variant_lower:
            self._multi[variant_lower] = canonical_lower
            self._multi_sorted = self._build_multi_sorted()
        else:
            self._single[variant_lower] = canonical_lower
        self._known.add(canonical_lower)

    def normalize(self, text: str) -> dict:
        if not text or not text.strip():
            return {
                "original": text,
                "normalized": text,
                "corrections": [],
                "overall_confidence": 1.0,
            }

        original = text
        corrections: List[_Correction] = []

        working = text
        working, multi_corrections = self._apply_multi_word(working)
        corrections.extend(multi_corrections)

        tokens = self._tokenize(working)
        normalized_tokens: List[str] = []

        for token, is_word in tokens:
            if not is_word:
                normalized_tokens.append(token)
                continue

            corrected, confidence = self._normalize_word(token)
            normalized_tokens.append(corrected)

            if corrected != token:
                corrections.append(_Correction(
                    original=token,
                    corrected=corrected,
                    confidence=confidence,
                ))

        normalized = "".join(normalized_tokens)

        if corrections:
            overall = sum(c.confidence for c in corrections) / len(corrections)
        else:
            overall = 1.0

        return {
            "original": original,
            "normalized": normalized,
            "corrections": [
                {
                    "original": c.original,
                    "corrected": c.corrected,
                    "confidence": c.confidence,
                }
                for c in corrections
            ],
            "overall_confidence": round(overall, 2),
        }

    def _apply_multi_word(self, text: str) -> Tuple[str, List[_Correction]]:
        corrections: List[_Correction] = []
        lower = text.lower()

        for variant, canonical in self._multi_sorted:
            idx = lower.find(variant)
            while idx != -1:
                matched_original = text[idx : idx + len(variant)]
                text = text[:idx] + canonical + text[idx + len(variant) :]
                lower = text.lower()
                corrections.append(_Correction(
                    original=matched_original,
                    corrected=canonical,
                    confidence=0.95,
                ))
                idx = lower.find(variant, idx + len(canonical))

        return text, corrections

    def _tokenize(self, text: str) -> List[Tuple[str, bool]]:
        tokens: List[Tuple[str, bool]] = []
        pattern = re.compile(r"([a-zA-ZñÑŋŊàáèéìíòóùú]+)|([^a-zA-ZñÑŋŊàáèéìíòóùú]+)")
        for m in pattern.finditer(text):
            if m.group(1):
                tokens.append((m.group(1), True))
            else:
                tokens.append((m.group(2), False))
        return tokens

    def _normalize_word(self, word: str) -> Tuple[str, float]:
        lower = word.lower()

        if lower in self._known:
            return lower, 1.0

        canonical = self._single.get(lower)
        if canonical is not None:
            return canonical, 0.95

        after_phonetic = self._apply_phonetic_rules(lower)
        if after_phonetic != lower:
            canonical = self._single.get(after_phonetic)
            if canonical is not None:
                return canonical, 0.85

            if after_phonetic in self._known:
                return after_phonetic, 0.85

        expanded = self._try_vowel_expand(lower)
        if expanded and expanded != lower:
            canonical = self._single.get(expanded)
            if canonical is not None:
                return canonical, 0.80
            if expanded in self._known:
                return expanded, 0.80

        expanded_phonetic = self._try_vowel_expand(after_phonetic) if after_phonetic != lower else None
        if expanded_phonetic and expanded_phonetic != after_phonetic:
            canonical = self._single.get(expanded_phonetic)
            if canonical is not None:
                return canonical, 0.75
            if expanded_phonetic in self._known:
                return expanded_phonetic, 0.75

        return word, 0.0

    def _apply_phonetic_rules(self, word: str) -> str:
        result = word
        for pattern, replacement in _PHONETIC_SUBS:
            result = pattern.sub(replacement, result)
        return result

    def _try_vowel_expand(self, word: str) -> Optional[str]:
        # "o" ending -> "oo" ending check
        if word.endswith("o") and not word.endswith("oo"):
            candidate = word + "o"
            if candidate in self._single or candidate in self._known:
                return candidate

        # Single vowel -> double vowel at end of word
        for short, double in _VOWEL_EXPAND.items():
            if word.endswith(short) and not word.endswith(double):
                candidate = word + short
                if candidate in self._single or candidate in self._known:
                    return candidate

        return None
