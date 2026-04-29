"""Mandinka sentiment / urgency / emotional-state analyzer.

Pure rule-based — no ML models. Target latency: < 5 ms per message.

Detects:
- urgency (cumulative 0.0–1.0 score)
- dominant emotional state (fear / pain / sadness / overwhelm / denial / hope / anger / neutral)
- pain level (none / mild / moderate / severe / emergency)
- isolation flag
- Gambian cultural masking flag ("Kayira dorong" + symptom/vital)
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any, Dict, List, Optional, Sequence

__all__ = ["MandinkaSentimentAnalyzer"]


# ---------------------------------------------------------------------------
# Keyword tables
# ---------------------------------------------------------------------------

# Emotional-state keywords -> (emotion_category, weight)
_EMOTION_KEYWORDS: List[tuple[str, str, float]] = [
    # FEAR
    ("silango be ŋ la", "fear", 0.9),
    ("n jikoyaata",     "fear", 0.7),
    ("munne mu ŋ tara", "fear", 0.6),
    ("n silata",        "fear", 0.8),
    # PAIN
    ("dimi ka n faa",   "pain", 1.0),
    ("dimi baa",        "pain", 0.8),
    ("tooroo",          "pain", 0.7),
    ("dimi",            "pain", 0.5),
    # SADNESS
    ("n sununta",           "sadness", 0.8),
    ("n hakilo to sumata",  "sadness", 0.7),
    ("n juusaata",          "sadness", 0.6),
    # OVERWHELM
    ("munne n ka ke",  "overwhelm", 0.7),
    ("a ka jukuu",     "overwhelm", 0.6),
    ("n te a loŋ",     "overwhelm", 0.5),
    # DENIAL
    ("n kendeyaata",  "denial", 0.8),   # scored only when vitals contradict
    ("a te foyi ti",  "denial", 0.6),
    # HOPE
    ("n na a ke",      "hope", 0.6),
    ("n lafita",       "hope", 0.5),
    ("alhamdulillah",  "hope", 0.3),
    # ANGER
    ("n dimita",  "anger", 0.6),
    ("a ma ñii",  "anger", 0.4),
]

# Sort longest-first so multi-word phrases match before their sub-words.
_EMOTION_KEYWORDS.sort(key=lambda t: len(t[0]), reverse=True)

# Temporal urgency keywords -> bonus
_TEMPORAL_URGENCY: Dict[str, float] = {
    "sisan": 0.2,
    "joona": 0.2,
    "bii":   0.1,
}

# Isolation phrases
_ISOLATION_PHRASES: List[str] = [
    "moo te ŋ fée",
    "n kelen ne",
    "n bula le",
]

# Pain level keywords (order matters: check most specific first)
_PAIN_EMERGENCY_PHRASES: List[str] = ["ka n faa"]
_PAIN_SEVERE_WORDS: List[str] = ["baa", "jukuu"]
_PAIN_MODERATE_WORDS: List[str] = ["dimi"]
_PAIN_MILD_WORDS: List[str] = ["dɔɔniŋ"]

# Cultural masking trigger
_MASKING_TRIGGER = "kayira dorong"

# Body-function words used alongside "n te se" for urgency
_BODY_FUNCTIONS: List[str] = [
    "domoroo", "minkoo", "sinoo", "kuuroo",
    "niisoo",  "taama",  "kono",  "ñaamoo",
]

# Emergency destination / number tokens
_EMERGENCY_DEST: Dict[str, float] = {
    "taa ospitaali": 0.2,
    "199": 0.5,
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _lower_strip(text: str) -> str:
    """Lowercase and collapse whitespace."""
    return re.sub(r"\s+", " ", text.strip().lower())


def _find_repeated_words(text: str) -> Dict[str, int]:
    """Return words that appear consecutively 2+ times."""
    tokens = text.split()
    repeats: Dict[str, int] = {}
    i = 0
    while i < len(tokens):
        word = tokens[i]
        count = 1
        while i + count < len(tokens) and tokens[i + count] == word:
            count += 1
        if count >= 2:
            repeats[word] = max(repeats.get(word, 0), count)
        i += count
    return repeats


def _urgency_level(score: float) -> str:
    if score >= 0.8:
        return "emergency"
    if score >= 0.5:
        return "high"
    if score >= 0.3:
        return "elevated"
    return "routine"


# ---------------------------------------------------------------------------
# Analyzer
# ---------------------------------------------------------------------------

class MandinkaSentimentAnalyzer:
    """Rule-based Mandinka sentiment / urgency analyser.

    Parameters
    ----------
    symptom_keywords : list[str] | None
        Extra symptom tokens (from the wider pipeline) that count as
        "symptom present in session" for masking detection.
    """

    def __init__(
        self,
        symptom_keywords: Optional[Sequence[str]] = None,
    ) -> None:
        self._extra_symptom_kw: List[str] = [
            w.lower() for w in (symptom_keywords or [])
        ]

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def analyze(
        self,
        text: str,
        ner_output: Optional[Dict[str, Any]] = None,
        language_info: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Analyse a single Mandinka utterance.

        Parameters
        ----------
        text : str
            Raw (or normalised) Mandinka text.
        ner_output : dict | None
            NER result from upstream. Expected keys:
            ``emergency_keywords`` (list[str]),
            ``severity`` (str: "emergency"|"severe"|"moderate"|...),
            ``symptoms`` (list[str]),
            ``vitals_abnormal`` (bool).
        language_info : dict | None
            Language-detection metadata (currently unused but reserved).

        Returns
        -------
        dict  with keys: urgency, urgency_level, emotional_state,
              emotion_confidence, pain_level, isolation_flag,
              masking_flag, repetition_emphasis, raw_scores.
        """
        ner = ner_output or {}
        norm = _lower_strip(text)

        urgency = self._score_urgency(norm, ner)
        emotion, emotion_conf, raw_scores = self._score_emotion(norm, ner)
        pain = self._score_pain(norm, urgency)
        isolation = self._detect_isolation(norm)
        masking = self._detect_masking(norm, ner)
        repeats = _find_repeated_words(norm)

        return {
            "urgency": round(min(urgency, 1.0), 2),
            "urgency_level": _urgency_level(min(urgency, 1.0)),
            "emotional_state": emotion,
            "emotion_confidence": round(emotion_conf, 2),
            "pain_level": pain,
            "isolation_flag": isolation,
            "masking_flag": masking,
            "repetition_emphasis": sorted(repeats.keys()),
            "raw_scores": raw_scores,
        }

    # ------------------------------------------------------------------
    # Urgency
    # ------------------------------------------------------------------

    def _score_urgency(self, norm: str, ner: Dict[str, Any]) -> float:
        score = 0.0

        # 1. Word repetition
        repeats = _find_repeated_words(norm)
        for _word, count in repeats.items():
            if count >= 3:
                score += 0.4
            elif count >= 2:
                score += 0.2

        # 2. Emergency keywords from NER
        for _kw in ner.get("emergency_keywords", []):
            score += 0.5

        # 3. "n te se" + body function
        if "n te se" in norm:
            for bf in _BODY_FUNCTIONS:
                if bf in norm:
                    score += 0.3
                    break  # count once

        # 4. Emergency destinations / numbers
        for token, bonus in _EMERGENCY_DEST.items():
            if token in norm:
                score += bonus

        # 5. Temporal urgency
        tokens_set = set(norm.split())
        for kw, bonus in _TEMPORAL_URGENCY.items():
            if kw in tokens_set:
                score += bonus

        # 6. NER severity
        severity = ner.get("severity", "").lower()
        if severity == "emergency":
            score += 0.5
        elif severity == "severe":
            score += 0.3
        elif severity == "moderate":
            score += 0.1

        return score

    # ------------------------------------------------------------------
    # Emotional state
    # ------------------------------------------------------------------

    def _score_emotion(
        self, norm: str, ner: Dict[str, Any],
    ) -> tuple[str, float, Dict[str, float]]:
        """Return (dominant_emotion, confidence, raw_scores_per_category)."""
        scores: Dict[str, float] = {}
        matched_spans: List[tuple[int, int]] = []

        for phrase, category, weight in _EMOTION_KEYWORDS:
            # Skip "n kendeyaata" unless vitals say otherwise
            if phrase == "n kendeyaata":
                if not ner.get("vitals_abnormal", False):
                    continue

            # Find all non-overlapping occurrences
            start = 0
            while True:
                idx = norm.find(phrase, start)
                if idx == -1:
                    break
                end = idx + len(phrase)
                # Check overlap with already-matched spans
                if not any(s <= idx < e or s < end <= e for s, e in matched_spans):
                    scores[category] = scores.get(category, 0.0) + weight
                    matched_spans.append((idx, end))
                start = end

        if not scores or max(scores.values()) <= 0.3:
            return "neutral", 0.0, scores

        dominant = max(scores, key=scores.__getitem__,)
        confidence = min(scores[dominant], 1.0)
        return dominant, confidence, scores

    # ------------------------------------------------------------------
    # Pain level
    # ------------------------------------------------------------------

    def _score_pain(self, norm: str, urgency: float) -> str:
        # Emergency phrases
        for ep in _PAIN_EMERGENCY_PHRASES:
            if ep in norm:
                return "emergency"

        severe_count = sum(1 for w in _PAIN_SEVERE_WORDS if w in norm)
        if severe_count >= 2:
            return "emergency"
        if severe_count >= 1:
            return "severe"

        if any(w in norm for w in _PAIN_MODERATE_WORDS):
            return "moderate"

        if any(w in norm for w in _PAIN_MILD_WORDS):
            return "mild"

        return "none"

    # ------------------------------------------------------------------
    # Isolation
    # ------------------------------------------------------------------

    @staticmethod
    def _detect_isolation(norm: str) -> bool:
        return any(phrase in norm for phrase in _ISOLATION_PHRASES)

    # ------------------------------------------------------------------
    # Cultural masking
    # ------------------------------------------------------------------

    def _detect_masking(self, norm: str, ner: Dict[str, Any]) -> bool:
        if _MASKING_TRIGGER not in norm:
            return False

        # Check for any symptom / vital mention in the same message
        ner_symptoms = ner.get("symptoms", [])
        if ner_symptoms:
            return True

        if ner.get("vitals_abnormal", False):
            return True

        # Check extra symptom keywords supplied at construction
        for kw in self._extra_symptom_kw:
            if kw in norm:
                return True

        # Heuristic: any pain/medical keyword co-occurs
        medical_hints = ["dimi", "tooroo", "kurango", "furaŋo", "sukkaroo"]
        return any(h in norm for h in medical_hints)
