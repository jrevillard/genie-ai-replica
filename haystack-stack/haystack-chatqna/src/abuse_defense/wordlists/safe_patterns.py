"""Patterns that EXEMPT a message from abuse classification.

Three lists:
    HEALTH_CONTEXT_WORDS -- when profanity is paired with any of these
        in a 10-token window, the classifier returns
        ``health_frustration`` instead of ``directed_abuse``.

    DISTRESS_PATTERNS    -- ABSOLUTE OVERRIDE. If any of these match,
        the classifier returns ``distress`` regardless of any other
        signal. Self-harm / suicidal-ideation / crisis cues. The
        downstream agent must route to crisis support, NEVER warn,
        NEVER terminate, NEVER step the escalation state machine.

    CULTURAL_SAFE_PATTERNS -- placeholder for Gambian/Mandinka
        communication norms that read as harsh in English. Currently
        empty pending native-speaker review (see TODO at bottom).

Adding to DISTRESS_PATTERNS is high-impact and high-risk: too narrow
and we miss a real crisis, too broad and we mis-route benign chatter.
Keep entries specific enough that they need genuine intent context
(e.g. "die" alone is too broad -- "want to die" / "wish I was dead"
require the framing word).
"""
from __future__ import annotations


# ── HEALTH-CONTEXT VOCABULARY ────────────────────────────────────────
# When these appear within ~10 tokens of a profanity / mild insult,
# the classifier treats the message as ``health_frustration`` rather
# than abuse. The expression is FRUSTRATION about the situation, not
# hostility toward AMINA.
HEALTH_CONTEXT_WORDS = [
    # diseases / conditions
    "disease", "diseases", "illness", "illnesses", "condition", "conditions",
    "diabetes", "diabetic", "hypertension", "hypertensive", "high blood pressure",
    "blood pressure", "bp",
    "asthma", "asthmatic",
    "malaria", "typhoid", "cholera",
    "anemia", "anaemia",
    "cancer", "tumor", "tumour",
    "stroke", "heart attack", "heart disease",
    "infection", "infections",
    "kidney", "liver", "lungs",
    "dka", "ketoacidosis",
    "tb", "tuberculosis",
    "hiv", "aids",
    "ulcer", "ulcers",

    # medications / pharmacology
    "medicine", "medicines", "medication", "medications",
    "drug", "drugs", "tablet", "tablets", "pill", "pills",
    "injection", "injections", "shot", "shots",
    "insulin", "metformin", "amlodipine", "aspirin",
    "antibiotic", "antibiotics", "paracetamol", "ibuprofen",
    "prescription", "dose", "dosage",
    "syrup", "syrups", "ointment", "ointments", "cream", "creams",

    # symptoms
    "pain", "ache", "aches", "aching", "hurting", "hurts", "hurt",
    "sore", "soreness",
    "headache", "stomach ache", "stomachache", "back pain", "chest pain",
    "fever", "feverish",
    "cough", "coughing",
    "tired", "tiredness", "fatigue", "exhausted", "weak", "weakness",
    "dizzy", "dizziness", "lightheaded",
    "nausea", "nauseous", "vomit", "vomiting",
    "diarrhea", "diarrhoea",
    "rash", "itch", "itching", "swelling", "swollen",
    "sick", "sickness", "ill",
    "shortness of breath", "breathless",
    "numb", "numbness", "tingling",

    # measurements / readings
    "blood sugar", "sugar level", "glucose",
    "reading", "readings", "result", "results",
    "test", "tests", "lab", "lab work",
    "mg", "mg/dl", "mg/dL", "mmhg", "mmHg",

    # care settings / providers
    "hospital", "clinic", "centre", "center", "ward",
    "doctor", "doctors", "nurse", "nurses",
    "vhw", "village health worker",
    "appointment", "visit", "checkup", "check-up", "follow-up", "followup",

    # general body / life-with-illness words
    "body", "health", "diet", "nutrition", "exercise",
    "diagnosed", "diagnosis",
    "patient", "patients",
    "treatment", "therapy",
]


# ── DISTRESS / CRISIS PATTERNS (ABSOLUTE OVERRIDE) ───────────────────
# If ANY of these match, the message is classified as ``distress`` and
# the abuse pipeline DOES NOT engage. Phase B+ will route these to a
# crisis-support response template + always-on emergency info.
#
# These are PHRASES (multi-word) on purpose -- single-word matches on
# "die" or "kill" produce too many false positives ("the medicine is
# killing my appetite" / "this dosage might kill me too quick"
# without distress framing).
DISTRESS_PATTERNS = [
    # explicit suicidal ideation
    "want to die",
    "wanna die",
    "want to f***ing die",
    "want to fucking die",
    "wish i was dead",
    "wish i were dead",
    "wish i could die",
    "rather be dead",
    "rather die",

    "kill myself",
    "killing myself",
    "end myself",
    "end my life",
    "ending my life",
    "end it all",
    "ending it all",
    "end it now",
    "should end it",
    "want to end it",
    "ready to end it",

    "take my own life",
    "taking my own life",
    "took my own life",

    # negation of life-worth
    "no point living",
    "no point in living",
    "no reason to live",
    "what's the point of living",
    "whats the point of living",
    "can't go on",
    "cant go on",
    "can't keep going",
    "cant keep going",
    "give up on life",
    "giving up on life",
    "life isn't worth",
    "life is not worth",

    # better-off / burden framing
    "better off dead",
    "better off without me",
    "everyone would be better off",
    "world would be better without me",
    "i'm a burden",
    "im a burden",
    "i am a burden",

    # nobody-cares framing (only when paired with life/die context;
    # the classifier can't enforce that pairing alone, so we keep
    # only the most distress-specific variants here)
    "nobody cares if i live",
    "nobody cares if i die",
    "no one cares if i live",
    "no one cares if i die",
    "nobody would miss me",
    "no one would miss me",

    # self-harm
    "hurt myself",
    "hurting myself",
    "harm myself",
    "harming myself",
    "cut myself",
    "cutting myself",

    # overdose risk
    "take all my pills",
    "taking all my pills",
    "take too many pills",
    "swallow all my pills",
    "swallow all the pills",
    "overdose on",
    "overdose myself",
    "od on my",
]


# ── CULTURAL SAFE PATTERNS (placeholder) ─────────────────────────────
# TODO(cultural-review): patterns for Gambian/Mandinka/Wolof
# conversational norms that read as harsh in English translation but
# are not abuse in context.
#
# Examples to validate with native speakers before adding:
#   * Heated village-meeting argument styles
#   * Elderly-patient blunt speech ("you don't know what you're talking
#     about, child" -- respectful in context, dismissive in English)
#   * Religious imprecation phrases that map to "by God I tell you" but
#     literally translate as something stronger
#
# UNTIL THIS LIST IS POPULATED via native-speaker review, the
# classifier should NOT treat any pattern as culturally exempt --
# we'd rather miss-fire WARNING_1 (recoverable) than wrongly let
# real abuse through. Phase C UX review is the right place to add
# this list as we observe real behaviour in shadow mode.
CULTURAL_SAFE_PATTERNS: list[str] = []


# ── PROFANITY MARKERS ────────────────────────────────────────────────
# Used by the classifier to detect "profanity present" when scoring
# a message for the health-frustration carve-out. Asterisked variants
# (f***, sh*t) are recognised. Severity is NOT graded here -- the
# classifier itself decides whether profanity matters.
PROFANITY_TOKENS = [
    # Hard profanity (and asterisked variants)
    "fuck", "fucked", "fucker", "fucking", "fuckin", "fuck'n",
    "f***", "f***ed", "f***er", "f***ing", "f***in",
    "f**k", "f**king", "f**ked",
    "shit", "shitty", "shitting", "bullshit",
    "sh*t", "sh*tty", "sh*tting", "bullsh*t",
    "ass", "asshole", "a**hole",
    "bitch", "b*tch",
    "bastard", "b*stard",
    "piss", "pissed", "pissing", "p*ssed",
    "damn", "damned", "goddamn", "god damn", "goddamnit",
    "hell",
    "crap", "crappy", "crapping",
]


def _all_phrases_for_unit_test() -> dict:
    """Convenience for the test suite — never imported by classifier."""
    return {
        "health_context": list(HEALTH_CONTEXT_WORDS),
        "distress":       list(DISTRESS_PATTERNS),
        "cultural_safe":  list(CULTURAL_SAFE_PATTERNS),
        "profanity":      list(PROFANITY_TOKENS),
    }
