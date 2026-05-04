"""Abuse-defense classifier (Phase A).

Pure stateless function: text in, classification out.

Priority order (DO NOT change without safety review):

    1. DISTRESS    -- absolute override. Any self-harm / suicidal /
                      crisis signal -> ``distress``, regardless of
                      what abuse signals are also present.

    2. HEALTH FRUSTRATION -- profanity OR mild insult-words paired
                      with a health-context vocabulary word in a small
                      adjacency window -> ``health_frustration``.
                      We take this carve-out BEFORE checking directed
                      abuse, because "this damn diabetes" ought to
                      get an empathetic response, not a warning.

    3. COERCIVE ABUSE -- coercion phrase paired with a clinical action
                      word OR a guilt-trip phrase paired with an AI
                      reference -> ``coercive_abuse``. Phase B will
                      escalate these faster (skip one warning level).

    4. DIRECTED ABUSE -- insult / threat / dehumanising phrase paired
                      with an AI reference (you / bot / AI / amina /
                      this thing / ...) within ~5 tokens -> ``directed_abuse``.

    5. CLEAN       -- nothing matched.

Performance budget: <2 ms per call. Patterns compile once at import.

Mode flag:
    When config.ABUSE_DEFENSE_ENABLED is False the classifier
    short-circuits to CLEAN. This is the safe fail-open behaviour
    used while Phase A is still inert (no integration).
"""
from __future__ import annotations

import re
import time
import unicodedata
from dataclasses import dataclass, field
from typing import List, Optional

from . import config
from .wordlists import abuse_patterns as ABUSE
from .wordlists import safe_patterns  as SAFE


# ── Categories ───────────────────────────────────────────────────────

CAT_CLEAN              = "clean"
CAT_HEALTH_FRUSTRATION = "health_frustration"
CAT_DISTRESS           = "distress"
CAT_DIRECTED_ABUSE     = "directed_abuse"
CAT_COERCIVE_ABUSE     = "coercive_abuse"

SEV_NONE     = "none"
SEV_LOW      = "low"
SEV_MEDIUM   = "medium"
SEV_HIGH     = "high"
SEV_CRITICAL = "critical"


# ── Compiled patterns (one-off cost at import) ───────────────────────
# We compile word-boundary patterns from the wordlists. Multi-word
# phrases use ``\b...\b`` with whitespace tolerance.

def _compile_phrase(phrase: str) -> re.Pattern:
    # Escape, then collapse multi-space to "\s+"
    escaped = re.escape(phrase.lower())
    flexible = re.sub(r"(\\\ )+", r"\\s+", escaped)
    return re.compile(rf"\b{flexible}\b", re.IGNORECASE)


# Distress -- the overriding category. Use phrase compilation so
# "want to die" matches "I want to die" but NOT "I'd die for some chocolate".
_DISTRESS_REGEXES: List[re.Pattern] = [_compile_phrase(p) for p in SAFE.DISTRESS_PATTERNS]

# Health frustration vocabulary -- single tokens or short phrases.
_HEALTH_REGEXES: List[re.Pattern] = [_compile_phrase(p) for p in SAFE.HEALTH_CONTEXT_WORDS]

# Profanity (markers, not graded).
_PROFANITY_REGEXES: List[re.Pattern] = [_compile_phrase(p) for p in SAFE.PROFANITY_TOKENS]

# AI references (you / bot / AI / amina / ...).
_AI_REGEXES: List[re.Pattern] = [_compile_phrase(p) for p in ABUSE.AI_REFERENCES]

# Insults + dehumanising phrases.
_INSULT_REGEXES: List[re.Pattern] = [_compile_phrase(p) for p in ABUSE.INSULT_WORDS]
_DEHUMAN_REGEXES: List[re.Pattern] = [_compile_phrase(p) for p in ABUSE.DEHUMANISING_PHRASES]

# Hard profanity directed at the AI ("fuck off", "screw you", etc.).
# Phrasal — phrase itself implies AI targeting, so no adjacency check
# required. Treated as dehumanising-tier on match.
_HARD_PROFANITY_AT_AI_REGEXES: List[re.Pattern] = [
    _compile_phrase(p) for p in ABUSE.HARD_PROFANITY_AT_AI
]

# Threats.
_THREAT_REGEXES: List[re.Pattern] = [_compile_phrase(p) for p in ABUSE.THREAT_VERBS]

# Coercion + guilt + clinical actions.
_COERCION_REGEXES: List[re.Pattern] = [_compile_phrase(p) for p in ABUSE.COERCION_PHRASES]
_GUILT_REGEXES:    List[re.Pattern] = [_compile_phrase(p) for p in ABUSE.COERCION_GUILT_PHRASES]
_CLINICAL_REGEXES: List[re.Pattern] = [_compile_phrase(p) for p in ABUSE.CLINICAL_ACTION_WORDS]

# Repeated-demand markers (literal, case-sensitive ALL CAPS).
_DEMAND_REGEXES: List[re.Pattern] = [
    re.compile(rf"\b{re.escape(p)}\b") for p in ABUSE.REPEATED_DEMAND_MARKERS
]


# ── Result type ──────────────────────────────────────────────────────

@dataclass
class Classification:
    category:         str               # one of the CAT_* constants
    severity:         str               # SEV_* constant
    is_abuse:         bool              # True iff category is *_abuse
    is_distress:      bool              # True iff category == distress
    is_frustration:   bool              # True iff category == health_frustration
    matched_patterns: List[str]         # human-readable signal names
    explanation:      str               # short reason for the result
    latency_ms:       float = 0.0       # populated by classify()


def _empty_clean() -> Classification:
    return Classification(
        category=CAT_CLEAN,
        severity=SEV_NONE,
        is_abuse=False,
        is_distress=False,
        is_frustration=False,
        matched_patterns=[],
        explanation="no signals matched",
    )


# ── Token utilities ──────────────────────────────────────────────────

_WORD_RE = re.compile(r"\b[\w']+\b")


def _tokenise(text: str) -> List[tuple]:
    """Return [(token_lower, start, end), ...] for context-window analysis."""
    return [(m.group(0).lower(), m.start(), m.end()) for m in _WORD_RE.finditer(text)]


def _within_window(span_a: tuple, span_b: tuple, max_tokens: int, tokens: List[tuple]) -> bool:
    """True if spans share <= max_tokens tokens between them. Treats
    overlap as 0 distance."""
    a_start, a_end = span_a
    b_start, b_end = span_b
    if a_end >= b_start and b_end >= a_start:
        return True
    # Find token indices spanning the two regions.
    indices_in_between = 0
    lo = min(a_end, b_end)
    hi = max(a_start, b_start)
    for tok, ts, te in tokens:
        if ts >= lo and te <= hi:
            indices_in_between += 1
            if indices_in_between > max_tokens:
                return False
    return True


def _spans(text: str, regs: List[re.Pattern]) -> List[tuple]:
    """All match spans across the regex list."""
    out: List[tuple] = []
    for r in regs:
        for m in r.finditer(text):
            out.append(m.span())
    return out


# ── Public API ───────────────────────────────────────────────────────

def classify(text: str) -> Classification:
    """Classify a single user message. Stateless."""
    t0 = time.perf_counter()

    if not config.ABUSE_DEFENSE_ENABLED:
        # Short-circuit while the module is gated off.
        c = _empty_clean()
        c.explanation = "abuse_defense disabled at module config"
        c.latency_ms = (time.perf_counter() - t0) * 1000
        return c

    if not text or not text.strip():
        c = _empty_clean()
        c.latency_ms = (time.perf_counter() - t0) * 1000
        return c

    # Preserve the ORIGINAL for ALL-CAPS demand detection;
    # use NFKC + lower for everything else.
    original = text
    normalised = unicodedata.normalize("NFKC", text).lower()
    tokens = _tokenise(normalised)

    matched: List[str] = []

    # ── 1. DISTRESS (absolute override) ──────────────────────────────
    distress_hits = _spans(normalised, _DISTRESS_REGEXES)
    if distress_hits:
        matched.append("distress")
        c = Classification(
            category=CAT_DISTRESS,
            severity=SEV_CRITICAL,
            is_abuse=False,
            is_distress=True,
            is_frustration=False,
            matched_patterns=matched,
            explanation=(
                "distress signal detected — route to crisis support; "
                "DO NOT escalate or terminate"
            ),
        )
        c.latency_ms = (time.perf_counter() - t0) * 1000
        return c

    # ── 2. HEALTH FRUSTRATION carve-out ──────────────────────────────
    # Profanity OR mild insult words paired with a health-context word
    # within 10 tokens, AND no AI reference adjacent to the insult.
    profanity_hits = _spans(normalised, _PROFANITY_REGEXES)
    insult_hits    = _spans(normalised, _INSULT_REGEXES)
    health_hits    = _spans(normalised, _HEALTH_REGEXES)
    ai_hits        = _spans(normalised, _AI_REGEXES)

    # Quick insult-or-profanity check
    has_profanity = bool(profanity_hits)
    has_insult    = bool(insult_hits)

    # Is there an AI ref adjacent to any insult? (5-token window)
    insult_adjacent_to_ai = False
    for ins in insult_hits:
        for air in ai_hits:
            if _within_window(ins, air, max_tokens=5, tokens=tokens):
                insult_adjacent_to_ai = True
                break
        if insult_adjacent_to_ai:
            break

    # Is there a health context word within 10 tokens of profanity / insult?
    profanity_in_health_context = False
    for pf in profanity_hits:
        for hc in health_hits:
            if _within_window(pf, hc, max_tokens=10, tokens=tokens):
                profanity_in_health_context = True
                break
        if profanity_in_health_context:
            break

    insult_in_health_context = False
    if has_insult and not insult_adjacent_to_ai:
        for ins in insult_hits:
            for hc in health_hits:
                if _within_window(ins, hc, max_tokens=10, tokens=tokens):
                    insult_in_health_context = True
                    break
            if insult_in_health_context:
                break

    if (has_profanity and profanity_in_health_context and not insult_adjacent_to_ai) \
       or (has_insult and insult_in_health_context):
        matched.extend([
            f for f, b in (
                ("profanity",          has_profanity),
                ("health_context",     bool(health_hits)),
                ("insult_word",        has_insult and insult_in_health_context),
            ) if b
        ])
        c = Classification(
            category=CAT_HEALTH_FRUSTRATION,
            severity=SEV_LOW,
            is_abuse=False,
            is_distress=False,
            is_frustration=True,
            matched_patterns=matched,
            explanation=(
                "profanity/insult is paired with health-context vocabulary; "
                "treat as frustration with the health situation, not abuse"
            ),
        )
        c.latency_ms = (time.perf_counter() - t0) * 1000
        return c

    # ── 3. COERCIVE ABUSE ────────────────────────────────────────────
    # Coercion phrase + (clinical action OR AI ref OR guilt phrase).
    # Guilt phrase + AI ref counts as coercive even without the
    # coercion-verb phrase.
    coercion_hits = _spans(normalised, _COERCION_REGEXES)
    guilt_hits    = _spans(normalised, _GUILT_REGEXES)
    clinical_hits = _spans(normalised, _CLINICAL_REGEXES)

    coercive = False
    if coercion_hits and (clinical_hits or ai_hits):
        coercive = True
        matched.append("coercion_phrase")
        if clinical_hits:
            matched.append("clinical_action_word")
        if ai_hits:
            matched.append("ai_reference")
    if guilt_hits and ai_hits:
        coercive = True
        if "guilt_trip" not in matched:
            matched.append("guilt_trip")
        if "ai_reference" not in matched:
            matched.append("ai_reference")

    if coercive:
        c = Classification(
            category=CAT_COERCIVE_ABUSE,
            severity=SEV_HIGH,
            is_abuse=True,
            is_distress=False,
            is_frustration=False,
            matched_patterns=matched,
            explanation=(
                "abuse pressuring AMINA to violate clinical safety rules; "
                "Phase B will escalate this faster (skip one warning level)"
            ),
        )
        c.latency_ms = (time.perf_counter() - t0) * 1000
        return c

    # ── 4. DIRECTED ABUSE ────────────────────────────────────────────
    # (a) insult + AI ref within 5 tokens
    # (b) threat + AI ref within 5 tokens
    # (c) dehumanising phrase (already includes AI ref by construction)
    # (d) hard profanity at AI (phrase like "fuck off", "screw you" --
    #     the phrase itself implies AI targeting, no adjacency required)
    # (e) ALL-CAPS repeated-demand marker
    threat_hits  = _spans(normalised, _THREAT_REGEXES)
    dehuman_hits = _spans(normalised, _DEHUMAN_REGEXES)
    hard_prof_hits = _spans(normalised, _HARD_PROFANITY_AT_AI_REGEXES)
    demand_hits  = []
    for r in _DEMAND_REGEXES:
        for m in r.finditer(original):   # original (pre-lowercase)
            demand_hits.append(m.span())

    threat_adjacent_to_ai = False
    for thr in threat_hits:
        for air in ai_hits:
            if _within_window(thr, air, max_tokens=5, tokens=tokens):
                threat_adjacent_to_ai = True
                break
        if threat_adjacent_to_ai:
            break

    directed = False
    if insult_adjacent_to_ai:
        directed = True
        matched.append("insult_at_ai")
    if threat_adjacent_to_ai:
        directed = True
        matched.append("threat_at_ai")
    if dehuman_hits:
        directed = True
        matched.append("dehumanising_phrase")
    if hard_prof_hits:
        directed = True
        matched.append("hard_profanity_at_ai")
    if demand_hits:
        directed = True
        matched.append("all_caps_demand")

    if directed:
        c = Classification(
            category=CAT_DIRECTED_ABUSE,
            severity=SEV_HIGH,
            is_abuse=True,
            is_distress=False,
            is_frustration=False,
            matched_patterns=matched,
            explanation=(
                "insult / threat / dehumanising language directed at AMINA"
            ),
        )
        c.latency_ms = (time.perf_counter() - t0) * 1000
        return c

    # ── 5. SEMANTIC FALLBACK (Phase G.1) ─────────────────────────────
    # Regex caught nothing. Run the embedding-based classifier as a
    # safety net for paraphrased abuse the catalog missed.
    #
    # Carve-out: do NOT run when the message contains a health-context
    # word — frustration would already have fired upstream IF profanity
    # was present, but the user might still be venting in a non-
    # profanity way ("this disease is so hopeless") and we don't want
    # to flip those to abuse. Health context wins.
    if not health_hits:
        try:
            from . import semantic
            is_para, score, exemplar = semantic.is_abuse_paraphrase(normalised)
            if is_para:
                c = Classification(
                    category=CAT_DIRECTED_ABUSE,
                    severity=SEV_HIGH,
                    is_abuse=True,
                    is_distress=False,
                    is_frustration=False,
                    matched_patterns=["semantic_paraphrase"],
                    explanation=(
                        f"semantic match (score={score:.2f}, "
                        f"exemplar={exemplar!r})"
                    ),
                )
                c.latency_ms = (time.perf_counter() - t0) * 1000
                return c
        except Exception:
            # Fail-open: any error in the semantic layer falls through
            # to clean. The user sees regex-only behaviour, never an
            # exception.
            pass

    # ── 6. CLEAN ─────────────────────────────────────────────────────
    c = _empty_clean()
    c.latency_ms = (time.perf_counter() - t0) * 1000
    return c
