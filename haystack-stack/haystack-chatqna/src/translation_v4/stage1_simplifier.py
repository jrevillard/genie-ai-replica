"""Stage 1 -- Pre-translation English simplification.

Research basis: AFRIDOC-MT (2025) showed that LLMs and NMT models
under-translate African languages specifically when the source
English is complex. Simplifying English BEFORE translating produces
materially better Mandinka output downstream.

Pure Python, no LLM calls, no model loads. Deterministic. ~150 LoC.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List


# ── Medical jargon -> plain English ──────────────────────────────────
MEDICAL_SIMPLIFICATIONS: Dict[str, str] = {
    "hypertension":             "high blood pressure",
    "hypoglycemia":             "low blood sugar",
    "hyperglycemia":            "high blood sugar",
    "glycemic control":         "blood sugar control",
    "glycemic":                 "blood sugar",
    "cardiovascular":           "heart",
    "renal":                    "kidney",
    "hepatic":                  "liver",
    "pulmonary":                "lung",
    "cerebrovascular":          "brain blood vessel",
    "pharmacological":          "medicine",
    "non-pharmacological":      "without medicine",
    "medication adherence":     "taking medicine every day",
    "dietary modification":     "food changes",
    "physical activity":        "body movement",
    "therapeutic target":       "goal number",
    "comorbidity":              "other health problem",
    "contraindicated":          "not safe",
    "asymptomatic":             "no symptoms",
    "subcutaneous":             "under the skin",
    "intravenous":              "into the vein",
    "systolic":                 "top number",
    "diastolic":                "bottom number",
    "fasting glucose":          "morning blood sugar before eating",
    "postprandial":             "after eating",
    "HbA1c":                    "three-month blood sugar average",
    "BMI":                      "body weight measure",
    "prophylactic":             "preventive",
    "titrate":                  "slowly adjust",
    "exacerbation":             "getting worse",
    "remission":                "getting better",
    "prognosis":                "what will likely happen",
    "etiology":                 "cause",
    "adverse effect":           "bad side effect",
    "indicated":                "recommended",
}

# Sort once, longest first, to avoid partial matches eating long ones.
_SIMPLIFY_KEYS = sorted(MEDICAL_SIMPLIFICATIONS.keys(), key=len, reverse=True)


# ── Hedging removal ──────────────────────────────────────────────────
HEDGING_PHRASES: List[str] = [
    "it is advisable to",
    "it is recommended that",
    "you may want to consider",
    "studies suggest that",
    "evidence indicates that",
    "could possibly",
    "potentially",
    "might",
]


# ── Passive -> active rewrites ───────────────────────────────────────
# Each rule is (pattern, replacement). Patterns are case-insensitive.
PASSIVE_RULES: List[tuple] = [
    (re.compile(r"\bblood pressure should be monitored\b", re.I), "check your blood pressure"),
    (re.compile(r"\bblood sugar should be monitored\b",   re.I), "check your blood sugar"),
    (re.compile(r"\b(?:can|may|should) be taken\b",       re.I), "take"),
    (re.compile(r"\bis recommended\b",                    re.I), "we recommend"),
    (re.compile(r"\bare recommended\b",                   re.I), "we recommend"),
    (re.compile(r"\bshould be (avoided|reduced)\b",       re.I), r"avoid"),
    (re.compile(r"\bshould be (taken|monitored|checked)\b", re.I), r"\1"),
]


# ── Sentence splitting ───────────────────────────────────────────────
# Split on terminal punctuation OR conjunctions when the sentence is
# longer than the budget. Conjunctions are "and / but / or / which /
# that / because" -- these are the most common compound-sentence
# joiners that hurt MT quality on African languages.
_SENT_TERMINATOR = re.compile(r"(?<=[.!?])\s+")
_SPLIT_CONJ = re.compile(
    r"\s+(?:and|but|or|which|that|because)\s+",
    re.IGNORECASE,
)

_MAX_WORDS_PER_SENTENCE = 12


def _strip_hedging(text: str) -> tuple[str, int]:
    """Remove low-information hedging phrases. Returns (text, hits)."""
    hits = 0
    out = text
    for h in HEDGING_PHRASES:
        pattern = re.compile(re.escape(h), re.IGNORECASE)
        new_out, n = pattern.subn("", out)
        hits += n
        out = new_out
    # Tidy up double spaces and stray leading spaces.
    out = re.sub(r"\s+", " ", out).strip(" ,.")
    return out, hits


def _replace_jargon(text: str) -> tuple[str, int]:
    """Substitute medical jargon. Returns (text, hits)."""
    hits = 0
    out = text
    for key in _SIMPLIFY_KEYS:
        pattern = re.compile(r"\b" + re.escape(key) + r"\b", re.IGNORECASE)
        new_out, n = pattern.subn(MEDICAL_SIMPLIFICATIONS[key], out)
        hits += n
        out = new_out
    return out, hits


def _passive_to_active(text: str) -> tuple[str, int]:
    """Apply the passive-rewrite rules. Returns (text, hits)."""
    hits = 0
    out = text
    for rx, repl in PASSIVE_RULES:
        new_out, n = rx.subn(repl, out)
        hits += n
        out = new_out
    return out, hits


def _split_long_sentence(sentence: str, max_words: int = _MAX_WORDS_PER_SENTENCE) -> List[str]:
    """If a sentence exceeds max_words, split at the first conjunction.
    Recurse so very long sentences end up in multiple parts."""
    if len(sentence.split()) <= max_words:
        return [sentence.strip()]
    parts = _SPLIT_CONJ.split(sentence, maxsplit=1)
    if len(parts) == 1:
        # No conjunction; leave as-is rather than chop arbitrarily.
        return [sentence.strip()]
    head, tail = parts[0].strip(), parts[1].strip()
    if not head or not tail:
        return [sentence.strip()]
    return _split_long_sentence(head, max_words) + _split_long_sentence(tail, max_words)


def _split_sentences(text: str) -> List[str]:
    """Split on terminal punctuation, then split overlong pieces at conjunctions."""
    rough = [s.strip() for s in _SENT_TERMINATOR.split(text.strip()) if s.strip()]
    out: List[str] = []
    for s in rough:
        out.extend(_split_long_sentence(s))
    return out


class ClinicalSimplifier:
    """Stage 1 entry point. ``simplify(text)`` returns a structured dict."""

    def simplify(self, text: str) -> Dict[str, Any]:
        if not text or not text.strip():
            return {
                "original": text or "",
                "simplified": "",
                "sentences": [],
                "total_simplifications": 0,
                "avg_sentence_length": 0.0,
            }

        # 1. Hedging removal at document level (cheaper than per-sentence).
        body, hedge_hits = _strip_hedging(text)

        # 2. Sentence-level rewrites.
        out_sentences: List[Dict[str, Any]] = []
        total_simplifications = hedge_hits
        for orig in _split_sentences(body):
            applied: List[str] = ["hedging"] if hedge_hits and orig in body else []
            simplified, jargon_hits = _replace_jargon(orig)
            if jargon_hits:
                applied.append("medical_term")
                total_simplifications += jargon_hits
            simplified, passive_hits = _passive_to_active(simplified)
            if passive_hits:
                applied.append("passive_to_active")
                total_simplifications += passive_hits
            wc_after = len(simplified.split())
            out_sentences.append({
                "original":                 orig,
                "simplified":               simplified,
                "simplifications_applied":  applied,
                "word_count_before":        len(orig.split()),
                "word_count_after":         wc_after,
            })

        joined = ". ".join(s["simplified"] for s in out_sentences if s["simplified"])
        if joined and not joined.endswith((".", "!", "?")):
            joined += "."
        avg = (
            sum(s["word_count_after"] for s in out_sentences) / len(out_sentences)
            if out_sentences else 0.0
        )

        return {
            "original":                 text,
            "simplified":               joined,
            "sentences":                out_sentences,
            "total_simplifications":    total_simplifications,
            "avg_sentence_length":      round(avg, 2),
        }
