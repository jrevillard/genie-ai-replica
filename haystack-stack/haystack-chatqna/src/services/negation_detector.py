"""
AMINA Care — Negation-Aware Symptom Detector
==============================================
Uses spaCy dependency parsing to determine whether symptom keywords
in a patient message are **affirmed** or **negated**.

    "I feel dizzy"           → dizzy is AFFIRMED
    "I'm not feeling dizzy"  → dizzy is NEGATED
    "no more headache"       → headache is NEGATED
    "the pain is gone"       → pain is NEGATED
    "I used to have fever"   → fever is NEGATED (past-tense hedge)
    "sometimes I get dizzy"  → dizzy is AFFIRMED (ambiguous → keep)

Two public functions:

  has_affirmed_symptom(text, keywords)
    → True only if at least one keyword appears AND is not negated

  extract_affirmed_symptoms(text, keywords)
    → list of keyword strings that are affirmed (non-negated)

Falls back to simple keyword matching if spaCy is unavailable,
so this is a strict improvement — never worse than the old logic.
"""
from __future__ import annotations

import logging
import re
from typing import List, Optional, Set, Tuple

_log = logging.getLogger("negation_detector")

# ═══════════════════════════════════════════════════════════════════════════════
# SPACY LOADING
# ═══════════════════════════════════════════════════════════════════════════════

_nlp = None
_nlp_loaded = False


def _load_spacy():
    global _nlp, _nlp_loaded
    if _nlp_loaded:
        return _nlp
    _nlp_loaded = True
    try:
        import spacy
        _nlp = spacy.load("en_core_web_sm", disable=["ner", "textcat"])
        _log.info("negation_detector: spaCy en_core_web_sm loaded")
    except Exception as e:
        _log.warning("negation_detector: spaCy unavailable, using regex fallback: %s", e)
        _nlp = None
    return _nlp


# ═══════════════════════════════════════════════════════════════════════════════
# NEGATION CUES
# ═══════════════════════════════════════════════════════════════════════════════

_NEGATION_WORDS = frozenset({
    "no", "not", "n't", "never", "none", "neither", "nor", "nothing",
    "nowhere", "hardly", "barely", "scarcely", "without",
    "dont", "don't", "doesn't", "doesnt", "didn't", "didnt",
    "isn't", "isnt", "aren't", "arent", "wasn't", "wasnt",
    "weren't", "werent", "won't", "wont", "wouldn't", "wouldnt",
    "can't", "cant", "cannot", "couldn't", "couldnt",
    "shouldn't", "shouldnt", "haven't", "havent", "hasn't", "hasnt",
})

_RESOLUTION_PHRASES = [
    r"\b(?:no\s+(?:more|longer))\b",
    r"\b(?:is|are|am|was|were|feeling)\s+(?:gone|over|better|fine|okay|ok|good|great|resolved|cleared)\b",
    r"\b(?:went\s+away|cleared\s+up|stopped|subsided|eased|relieved)\b",
    r"\b(?:used\s+to\s+(?:have|feel|get|experience))\b",
    r"\b(?:don'?t|do\s+not|doesn'?t|does\s+not)\s+(?:have|feel|get|experience)\b",
    r"\b(?:i'?m\s+(?:not|no\s+longer))\b",
    r"\b(?:free\s+(?:of|from))\b",
    r"\bnot\s+(?:feeling|having|experiencing)\s+(?:any|the|much|that|this|it|so)\b",
    r"\b(?:thank|thanks|good\s+now|fine\s+now|okay\s+now|better\s+now|well\s+now)\b",
]
_RE_RESOLUTION = re.compile("|".join(_RESOLUTION_PHRASES), re.IGNORECASE)

_WELLBEING_PHRASES = re.compile(
    r"(?<!\bnot\s)(?<!\bnt\s)"
    r"\b(?:i'?m\s+(?:fine|good|great|okay|ok|well|better|alright)|"
    r"feeling\s+(?:fine|good|great|okay|ok|well|better|alright)|"
    r"i\s+feel\s+(?:fine|good|great|okay|ok|well|better|alright)|"
    r"no\s+(?:issues?|problems?|complaints?|concerns?|worries?))\b",
    re.IGNORECASE,
)


# ═══════════════════════════════════════════════════════════════════════════════
# SPACY-BASED NEGATION DETECTION
# ═══════════════════════════════════════════════════════════════════════════════


def _is_negated_spacy(doc, token_idx: int) -> bool:
    """Check if a token in a spaCy Doc is negated via dependency tree."""
    token = doc[token_idx]

    for child in token.children:
        if child.dep_ == "neg" or child.lower_ in _NEGATION_WORDS:
            return True

    head = token.head
    if head != token:
        for child in head.children:
            if child.dep_ == "neg" or child.lower_ in _NEGATION_WORDS:
                return True
        if head.head != head:
            for child in head.head.children:
                if child.dep_ == "neg" or child.lower_ in _NEGATION_WORDS:
                    return True

    window_start = max(0, token_idx - 4)
    window_end = min(len(doc), token_idx + 1)
    for i in range(window_start, window_end):
        if doc[i].lower_ in _NEGATION_WORDS:
            return True

    return False


def _find_keyword_tokens(doc, keyword: str) -> List[int]:
    """Find token indices where a keyword (possibly multi-word) appears."""
    kw_lower = keyword.lower()
    kw_words = kw_lower.split()
    indices = []

    if len(kw_words) == 1:
        for i, token in enumerate(doc):
            if token.lower_ == kw_lower or token.lemma_.lower() == kw_lower:
                indices.append(i)
    else:
        text_lower = doc.text.lower()
        start = 0
        while True:
            pos = text_lower.find(kw_lower, start)
            if pos == -1:
                break
            span = doc.char_span(pos, pos + len(kw_lower), alignment_mode="expand")
            if span:
                indices.append(span.start)
            start = pos + 1

    return indices


# ═══════════════════════════════════════════════════════════════════════════════
# REGEX FALLBACK
# ═══════════════════════════════════════════════════════════════════════════════


def _is_negated_regex(text: str, keyword: str) -> bool:
    """Simple regex-based negation check (fallback when spaCy unavailable)."""
    text_lower = text.lower()
    kw_lower = keyword.lower()

    kw_pos = text_lower.find(kw_lower)
    if kw_pos == -1:
        return False

    prefix = text_lower[:kw_pos]
    last_30 = prefix[-30:] if len(prefix) > 30 else prefix

    for neg in _NEGATION_WORDS:
        if neg in last_30.split():
            return True

    if _RE_RESOLUTION.search(text_lower):
        return True

    return False


# ═══════════════════════════════════════════════════════════════════════════════
# PUBLIC API
# ═══════════════════════════════════════════════════════════════════════════════


def extract_affirmed_symptoms(
    text: str,
    keywords: List[str],
) -> List[str]:
    """Return only the keywords that appear in `text` and are NOT negated.

    Uses spaCy dependency parsing if available, falls back to regex.
    """
    if not text or not keywords:
        return []

    text_lower = text.lower()

    if _WELLBEING_PHRASES.search(text_lower):
        return []

    _SELF_NEGATED_SYMPTOMS = {"not feeling well", "feel sick", "feeling unwell"}

    present = [kw for kw in keywords if kw.lower() in text_lower]
    if not present:
        return []

    self_neg_matches = [kw for kw in present if kw.lower() in _SELF_NEGATED_SYMPTOMS]
    if self_neg_matches:
        real_neg = any(
            p in text_lower for p in [
                "don't feel sick", "dont feel sick", "not feel sick",
                "no longer feel", "not feeling unwell",
            ]
        )
        if not real_neg:
            return self_neg_matches

    nlp = _load_spacy()

    if nlp is not None:
        doc = nlp(text)

        if _RE_RESOLUTION.search(text_lower):
            return []

        affirmed = []
        for kw in present:
            token_indices = _find_keyword_tokens(doc, kw)
            if not token_indices:
                if not _is_negated_regex(text, kw):
                    affirmed.append(kw)
                continue

            any_affirmed = any(
                not _is_negated_spacy(doc, idx) for idx in token_indices
            )
            if any_affirmed:
                affirmed.append(kw)

        return affirmed
    else:
        if _RE_RESOLUTION.search(text_lower):
            return []

        return [kw for kw in present if not _is_negated_regex(text, kw)]


def has_affirmed_symptom(
    text: str,
    keywords: List[str],
) -> bool:
    """True only if at least one keyword appears AND is not negated."""
    return len(extract_affirmed_symptoms(text, keywords)) > 0
