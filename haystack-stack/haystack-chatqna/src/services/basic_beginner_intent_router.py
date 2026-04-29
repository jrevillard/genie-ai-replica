"""
AMINA Care — Basic/Beginner Intent Router (V2)
================================================
A small, conservative, regex-only classifier that handles **only** UX
intents (greeting, goodbye, thanks, acknowledgement, vague clarification,
guest personal-records request) for the Basic and Beginner literacy modes.

It is INTENTIONALLY NOT a clinical NLP system. The advanced router stack
(intent_router.py / four_layer_router.py / stance_classifier.py / the
LoRA prompts / RAG / medication safety gate) remains the single source
of truth for substantive medical reasoning. This module exists only so
the simplified shells don't hand a bare "hi" to the full ReAct loop.

Public surface (back-compat preserved)
--------------------------------------
  classify_basic_beginner_intent(message, is_guest, mode) -> dict
  deterministic_response(intent, *, is_guest, patient_name) -> dict | None
  VALID_MODES = {"basic", "beginner"}

V2 additions to the classify_basic_beginner_intent return dict:
  intent                 same as V1 (keeps tests passing)
  confidence             same as V1
  matched                same as V1 — back-compat key
  reason                 human-readable reason string
  route                  deterministic | emergency_fallthrough |
                         fallthrough | unknown_fallthrough
  should_short_circuit   bool — caller MUST honour this
  language_hint          en | ma | mixed | unknown
  domain_hint            NCD-first metadata only — never drives a
                         deterministic medical answer
  normalized_text        lowercased / collapsed / typo-corrected text

Conservative bias (unchanged from V1)
-------------------------------------
  - emergency wins over every other intent
  - greeting/goodbye/thanks/ack must be standalone (anchored regex)
  - personal-record short-circuit is GUEST-only; auth falls through
  - everything else falls through to the existing pipeline

V2 additions
------------
  - vague low-information single-token inputs (e.g. "sugar", "pressure",
    "help") get a deterministic clarification menu instead of being
    fed to the LoRA, which would just guess.
  - text normalization: typos like "hii", "helo", "kk" land on the
    same regex bucket as "hi", "hello", "ok".
  - NCD domain hint metadata is computed but DOES NOT change the
    response — the LoRA / RAG / agent pipeline remains authoritative
    for any medical content.
"""
from __future__ import annotations

import re
from typing import Any, Dict, Optional


# ── Modes ─────────────────────────────────────────────────────────
VALID_MODES = {"basic", "beginner"}

# ── Pattern definitions ───────────────────────────────────────────
# Greeting must be effectively standalone. Optional innocuous tail
# ("there", "friend", "amina") is allowed; anything substantive after
# the greeting word fails the anchor and falls through.
_GREETING_RE = re.compile(
    r"^("
    r"hi|hii+|hello+|helo+|hey+|hiya|howdy|yo|"
    r"salaam(?:\s+aleikum|\s+alaikum|\s+aleekum)?|"
    r"salam(?:\s+aleikum|\s+alaikum)?|"
    r"asalaa?mu?\s+alaikum|"
    r"good\s+(morning|afternoon|evening|day)|"
    r"how\s+are\s+you|how'?s\s+it\s+going|what'?s\s+up|sup"
    r")"
    r"(\s+(there|friend|amina|doc(?:tor)?))?"
    r"[\s,!.?]*$",
    re.IGNORECASE,
)

_GOODBYE_RE = re.compile(
    r"^("
    r"bye+|goodbye|farewell|take\s+care|cya|"
    r"see\s+(you|ya)(\s+(soon|later|tomorrow|then|around))?|"
    r"talk\s+(?:to\s+you\s+)?later|catch\s+(?:you\s+)?later|"
    r"bye\s+for\s+now"
    r")\b[\s,!.?]*$",
    re.IGNORECASE,
)

_THANKS_RE = re.compile(
    r"^("
    r"thanks?|thank\s+you+|thx|ty|tysm|tnx|"
    r"much\s+appreciated|appreciate\s+it|cheers|"
    r"jaarama|abaraka"
    r")\b[\s,!.?]*$",
    re.IGNORECASE,
)

_ACK_RE = re.compile(
    r"^("
    r"ok|okay|okk+|kk+|k|"
    r"got\s+it|sure|yes+|yeah+|yep|yup|alright|"
    r"fine|noted|cool|sounds?\s+good|makes?\s+sense|"
    r"understood|i\s+see"
    r")\b[\s,!.?]*$",
    re.IGNORECASE,
)

# Personal records / account-bound info request. Searches anywhere.
_PERSONAL_RECORDS_RE = re.compile(
    r"\b("
    r"my\s+(medicines?|medications?|prescriptions?|appointments?|"
    r"records?|chart|history|labs?|lab\s+results?|test\s+results?|"
    r"care\s+plan|caregivers?|doctors?|providers?|conditions?|"
    r"diagnos[ie]s|allergies)|"
    r"what\s+medicines?\s+(am|do)\s+i|"
    r"what\s+medications?\s+(am|do)\s+i|"
    r"show\s+(me\s+)?my|list\s+my|access\s+my|view\s+my|"
    r"do\s+i\s+have\s+(any\s+)?appointments?|"
    r"when\s+is\s+my\s+(next\s+)?appointment"
    r")\b",
    re.IGNORECASE,
)

# Emergency keywords. Safety-first. Wins over every other intent.
_EMERGENCY_RE = re.compile(
    r"\b("
    r"chest\s+pain|chest\s+tight|heart\s+attack|"
    r"can'?t\s+breathe|cannot\s+breathe|trouble\s+breathing|"
    r"shortness\s+of\s+breath|"
    r"stroke|face\s+drooping|slurred\s+speech|"
    r"severe\s+bleed|bleeding\s+heavily|hemorrhag|"
    r"unconscious|passed\s+out|fainted?|"
    r"seizure|convulsion|"
    r"choking|"
    r"anaphylaxis|severe\s+allergic|"
    r"suicid|kill\s+myself|end\s+my\s+life|harm\s+myself|"
    r"i\s+want\s+to\s+die|want\s+to\s+die|"
    r"don'?t\s+want\s+to\s+(live|be\s+alive)|"
    r"low\s+sugar|sugar\s+is\s+low|hypoglycem|"
    r"emergency"
    r")\b",
    re.IGNORECASE,
)

# Medical keywords (broad). A "?" anywhere also strongly hints at a
# question so we fall through. Stem-only roots end with \w* so they
# match natural inflections (diabetes, dizziness, depressed, etc.).
_MEDICAL_KEYWORDS_RE = re.compile(
    r"\b("
    r"symptom\w*|medicine\w*|medication\w*|prescription\w*|dose\w*|drug\w*|"
    r"diet\w*|exercise\w*|workout\w*|nutrition|eat|food|meal\w*|"
    r"blood\s+(pressure|sugar)|bp|sugar|"
    r"diabet\w*|hypertensi\w*|cholesterol|"
    r"headache\w*|migraine\w*|fever|cough|nausea|vomit\w*|"
    r"dizz\w*|tired|weak|fatigue\w*|confus\w*|"
    r"sleep|insomnia|stress\w*|anxiety|anxious|depress\w*|mood|"
    r"pregnan\w*|infant\w*|baby|breastfeed\w*|"
    r"vaccin\w*|immuniz\w*|"
    r"pain|ache|sore|tender|swell\w*|hurt\w*|"
    r"weight|obesi\w*|"
    r"asthma|allerg\w*|"
    r"period|menstrua\w*|menopause|"
    r"chest|back|stomach|belly|abdomen|throat|neck|head|"
    r"arm|leg|foot|hand|knee|joint|skin|rash|"
    r"appointment\w*|clinic|doctor|hospital|nurse|"
    r"how\s+(can|do|to|should)|"
    r"what\s+(should|can|is|are|do)|"
    r"why\s+(do|am|is|are)|"
    r"when\s+(should|can|do)"
    r")\b"
    # Bare BP-shaped reading like "160/100" — without a word boundary
    # because numbers + slash aren't \w.
    r"|\d{2,3}\s*/\s*\d{2,3}",
    re.IGNORECASE,
)

# Single-token vague input. We only short-circuit if the entire
# (normalised) message is exactly one of these tokens — never if the
# user has any extra context like "my sugar is high" or "I have pain".
_VAGUE_TOKENS = frozenset({
    "help", "pain", "medicine", "food", "sugar",
    "pressure", "sick", "dizzy", "tired", "symptoms",
})

# ── NCD domain hints (METADATA ONLY) ──────────────────────────────
# Order matters — earliest match wins, so put more specific / context-
# overriding patterns first. Never used to drive a deterministic
# answer; only surfaced in classification metadata for logging /
# observability.
_DOMAIN_HINT_PATTERNS = [
    # Adherence wins over vitals so "I missed my BP medicine" classifies
    # as adherence even though "BP" also matches vitals.
    ("medication_adherence", re.compile(r"\b(missed\s+(my|a|the)|stopped\s+taking|forgot\s+(my|to\s+take)|skipped\s+(my|a|the)|ran\s+out\s+of)\b", re.IGNORECASE)),
    ("medication_safety",    re.compile(r"\b(side\s+effects?|allerg(?:y|ic)\s+to|too\s+much|overdose|interact(?:ion)?|safe\s+to\s+take)\b", re.IGNORECASE)),
    # Pregnancy + NCD is special — a pregnant patient's NCD context
    # warrants pregnancy_ncd labelling, not bare diabetes/hypertension.
    ("pregnancy_ncd",        re.compile(r"\b(pregnan\w*|gestational|trimester|breastfeed\w*|prenatal|antenatal)\b", re.IGNORECASE)),
    ("vitals_bp",            re.compile(r"\b(bp|blood\s+pressure|systolic|diastolic)\b|\d{2,3}\s*/\s*\d{2,3}", re.IGNORECASE)),
    ("vitals_glucose",       re.compile(r"\b(blood\s+sugar|glucose|hba1c|fasting\s+sugar|sugar\s+(level|reading|test|is\s+(high|low)))\b", re.IGNORECASE)),
    ("diabetes",             re.compile(r"\b(diabet\w*|insulin|metformin|glipizide|glibenclamide)\b", re.IGNORECASE)),
    ("hypertension",         re.compile(r"\b(hypertensi\w*|high\s+blood\s+pressure|hbp|amlodipine|lisinopril|losartan|hydrochlorothiazide|atenolol)\b", re.IGNORECASE)),
    ("asthma_copd",          re.compile(r"\b(asthma|copd|inhaler|wheez\w*|salbutamol|breathlessness)\b", re.IGNORECASE)),
    ("cardiovascular_risk",  re.compile(r"\b(heart\s+disease|cardio\w*|cholesterol|atherosclerosis|statin)\b", re.IGNORECASE)),
    ("mental_health",        re.compile(r"\b(stress\w*|anxiety|anxious|depress\w*|mood|sad|worry|worried|panic)\b", re.IGNORECASE)),
    ("diet_nutrition",       re.compile(r"\b(diet|food|eat(?:ing)?|meal|nutrition|recipe|cook|sugar\s+intake|salt\s+intake)\b", re.IGNORECASE)),
    ("physical_activity",    re.compile(r"\b(exercise|workout|run(?:ning)?|walk(?:ing)?|active|physical\s+activity)\b", re.IGNORECASE)),
    ("tobacco_alcohol",      re.compile(r"\b(smok(?:e|ing)|tobacco|cigarette|alcohol|drink(?:ing)?\s+alcohol)\b", re.IGNORECASE)),
    ("obesity_weight",       re.compile(r"\b(weight|obese|overweight|bmi|lose\s+weight|gain(?:ing)?\s+weight)\b", re.IGNORECASE)),
    ("caregiver_support",    re.compile(r"\b(caregiver|carer|home\s+care|community\s+health\s+worker|chw|alkalo)\b", re.IGNORECASE)),
    ("appointment_followup", re.compile(r"\b(appointment\w*|follow.?up|visit|schedule|booking)\b", re.IGNORECASE)),
    ("referral",             re.compile(r"\b(referral|refer\s+(to|me)|specialist|hospital|efsth)\b", re.IGNORECASE)),
    ("records",              re.compile(r"\b(records?|chart|history|file|profile)\b", re.IGNORECASE)),
    # Symptoms catches general body-pain words that fall through the
    # specific NCDs above. Stem patterns end with \w* so "dizzy" hits.
    ("symptoms",             re.compile(r"\b(symptom\w*|pain|ache|sore|fever|cough|nausea|dizz\w*|tired|weak|hurt\w*|swell\w*)\b", re.IGNORECASE)),
]

# Mandinka-language hints. Conservative — single-character indicators
# (ŋ, ñ) AND a short whitelist of common Mandinka words.
_MANDINKA_CHARS_RE = re.compile(r"[ŋñ]")
_MANDINKA_WORDS_RE = re.compile(
    r"\b(salaam|salam|aleikum|alaikum|asalaa?mu|"
    r"ñaadii|kontibali|maakoyi|jaarama|abaraka|"
    r"diyaa|nafaa|kendeyaa|kasoolu|kuwo|dindi?ng|moo)\b",
    re.IGNORECASE,
)


# ── Normalization ────────────────────────────────────────────────
_WHITESPACE_RE      = re.compile(r"\s+")
_REPEATED_PUNCT_RE  = re.compile(r"([!?.,;:])\1+")
_HII_RE             = re.compile(r"\bhii+\b",   re.IGNORECASE)
_HELO_RE            = re.compile(r"\bhel+o\b",  re.IGNORECASE)
_HEYY_RE            = re.compile(r"\bhey+\b",   re.IGNORECASE)
_OKK_RE             = re.compile(r"\bok+y?\b",  re.IGNORECASE)
_KK_RE              = re.compile(r"\bk+\b",     re.IGNORECASE)
_OKAY_RE            = re.compile(r"\bokay\b",   re.IGNORECASE)


def _normalize_text(text: str) -> str:
    """Lowercase, trim, collapse spaces and repeated punctuation, and
    fold a few common typos (hii, helo, kk) so the regexes match
    consistently. Cheap — runs once per classify call."""
    if not text or not isinstance(text, str):
        return ""
    s = text.strip().lower()
    if not s:
        return ""
    s = _WHITESPACE_RE.sub(" ", s)
    s = _REPEATED_PUNCT_RE.sub(r"\1", s)
    # Greeting typos
    s = _HII_RE.sub("hi", s)
    s = _HELO_RE.sub("hello", s)
    s = _HEYY_RE.sub("hey", s)
    # Acknowledgement variants — only when standalone.
    if s in {"k", "kk", "kkk", "kkkk"}:
        s = "ok"
    elif s == "okay":
        s = "ok"
    return s


def _detect_language_hint(text: str, normalized: str) -> str:
    """Cheap heuristic: en | ma | mixed | unknown."""
    has_ma = bool(_MANDINKA_CHARS_RE.search(text)) or bool(_MANDINKA_WORDS_RE.search(text))
    if not normalized:
        return "unknown"
    # Strip whitespace + punctuation to see if any latin letters are present.
    stripped = re.sub(r"[^a-z]", "", normalized)
    has_en = bool(stripped)
    if has_ma and has_en:
        return "mixed"
    if has_ma:
        return "ma"
    if has_en:
        return "en"
    return "unknown"


def _detect_domain_hint(normalized: str) -> str:
    """Return the best-fit NCD domain hint or 'unknown'.
    Pure metadata — never drives the response."""
    if not normalized:
        return "unknown"
    for label, pat in _DOMAIN_HINT_PATTERNS:
        if pat.search(normalized):
            return label
    return "unknown"


def _is_vague_single_token(normalized: str) -> bool:
    """True when the user typed exactly one of the low-info tokens."""
    if not normalized:
        return False
    # Strip leading/trailing punctuation tokens and split.
    cleaned = re.sub(r"[^\w\s]", "", normalized).strip()
    parts = cleaned.split()
    return len(parts) == 1 and parts[0] in _VAGUE_TOKENS


# ── Classifier ────────────────────────────────────────────────────
def classify_basic_beginner_intent(
    message: str,
    is_guest: bool,
    mode: str,
) -> Dict[str, Any]:
    """Return classified intent + V2 metadata for a Basic/Beginner UX msg.

    The caller (basic_beginner_chat_patch) must read `should_short_circuit`
    rather than re-deriving routing from `intent`. A non-deterministic
    intent (medical_question, emergency, authenticated personal-records,
    unknown) returns should_short_circuit=False so the existing
    LoRA/RAG/agent pipeline handles it.
    """
    raw = message if isinstance(message, str) else ""
    norm = _normalize_text(raw)
    domain = _detect_domain_hint(norm)
    lang = _detect_language_hint(raw, norm)

    base_meta: Dict[str, Any] = {
        "language_hint":    lang,
        "domain_hint":      domain,
        "normalized_text":  norm,
    }

    if not norm:
        return _result(
            intent="unknown", confidence=0.0,
            matched="empty", reason="empty input",
            route="unknown_fallthrough", short_circuit=False,
            base=base_meta,
        )

    # 1. Emergency — always wins. Falls through to the existing agent
    #    so the LoRA/safety/escalation pipeline owns the response.
    if _EMERGENCY_RE.search(norm):
        return _result(
            intent="emergency", confidence=0.95,
            matched="emergency_keyword",
            reason="emergency keyword detected",
            route="emergency_fallthrough", short_circuit=False,
            base={**base_meta, "domain_hint": "emergency"},
        )

    # 2. Greeting (anchored / standalone).
    if _GREETING_RE.match(norm):
        return _result(
            intent="greeting", confidence=0.95,
            matched="greeting_only", reason="standalone greeting",
            route="deterministic", short_circuit=True,
            base=base_meta,
        )

    # 3. Goodbye.
    if _GOODBYE_RE.match(norm):
        return _result(
            intent="goodbye", confidence=0.95,
            matched="goodbye_only", reason="standalone goodbye",
            route="deterministic", short_circuit=True,
            base=base_meta,
        )

    # 4. Thanks.
    if _THANKS_RE.match(norm):
        return _result(
            intent="thanks", confidence=0.95,
            matched="thanks_only", reason="standalone thanks",
            route="deterministic", short_circuit=True,
            base=base_meta,
        )

    # 5. Acknowledgement.
    if _ACK_RE.match(norm):
        return _result(
            intent="acknowledgement", confidence=0.90,
            matched="ack_only", reason="standalone acknowledgement",
            route="deterministic", short_circuit=True,
            base=base_meta,
        )

    # 6. Vague single-token input — clarification menu instead of
    #    handing the LoRA a one-word riddle.
    if _is_vague_single_token(norm):
        return _result(
            intent="vague", confidence=0.85,
            matched="vague_single_token", reason="single low-info token",
            route="deterministic", short_circuit=True,
            base=base_meta,
        )

    # 7a. Medication-adherence statements like "I missed my medicine"
    #     bind PERSONAL_RECORDS_RE on "my medicine" but are NOT
    #     records-access requests — they're medical adherence content
    #     that needs the LoRA / safety pipeline. Override to medical_question.
    if domain == "medication_adherence":
        return _result(
            intent="medical_question", confidence=0.80,
            matched="medication_adherence",
            reason="medication adherence statement — defer to existing pipeline",
            route="fallthrough", short_circuit=False,
            base=base_meta,
        )

    # 7. Personal-records request. Guest = short-circuit; auth =
    #    fall through to the existing authenticated agent/tools.
    if _PERSONAL_RECORDS_RE.search(norm):
        if is_guest:
            return _result(
                intent="personal_records_request", confidence=0.85,
                matched="personal_records",
                reason="guest asked for personal records — sign-in required",
                route="deterministic", short_circuit=True,
                base={**base_meta,
                      "domain_hint": domain if domain != "unknown" else "records"},
            )
        return _result(
            intent="personal_records_request", confidence=0.85,
            matched="personal_records",
            reason="authenticated record request — fall through to agent",
            route="fallthrough", short_circuit=False,
            base={**base_meta,
                  "domain_hint": domain if domain != "unknown" else "records"},
        )

    # 8. Substantive medical / question — fall through to LLM.
    if _MEDICAL_KEYWORDS_RE.search(norm) or "?" in raw:
        return _result(
            intent="medical_question", confidence=0.70,
            matched="medical_keyword_or_question",
            reason="medical keyword or question — defer to existing pipeline",
            route="fallthrough", short_circuit=False,
            base=base_meta,
        )

    # 9. Unknown — fall through.
    return _result(
        intent="unknown", confidence=0.0,
        matched="no_pattern", reason="no pattern matched",
        route="unknown_fallthrough", short_circuit=False,
        base=base_meta,
    )


def _result(
    *,
    intent: str,
    confidence: float,
    matched: str,
    reason: str,
    route: str,
    short_circuit: bool,
    base: Dict[str, Any],
) -> Dict[str, Any]:
    """Assemble the V2 classification dict. Keeps V1 keys for back-compat."""
    out = {
        "intent":               intent,
        "confidence":           confidence,
        "matched":              matched,
        "reason":               reason,
        "route":                route,
        "should_short_circuit": short_circuit,
    }
    out.update(base)
    return out


# ── Deterministic responses ───────────────────────────────────────
# NCD-menu wording so users know what to ask about — but no clinical
# answers. Anything substantive falls through to the LoRA / RAG path.
_NCD_MENU = (
    "I can help with blood pressure, blood sugar, medicines, food, "
    "exercise, symptoms, or appointments."
)
_NCD_MENU_PROMPT = "What would you like help with today?"
_VAGUE_PROMPT = (
    "What would you like help with: blood pressure, blood sugar, "
    "medicines, food, exercise, symptoms, or appointments?"
)


def deterministic_response(
    intent: str,
    *,
    is_guest: bool,
    patient_name: str = "",
) -> Optional[Dict[str, Any]]:
    """Return a result-dict for canned UX intents, or None to fall through.

    None means: let the existing agent/LLM pipeline handle the message.
    A non-None return is shaped exactly like AminaAgent.process_message
    so the chat / chat-stream routes can serialise it without changes.
    """
    name = (patient_name or "").strip()

    if intent == "greeting":
        if is_guest:
            text = f"Hello, I'm Amina. {_NCD_MENU} {_NCD_MENU_PROMPT}"
        elif name:
            text = f"Hello, {name}. {_NCD_MENU} {_NCD_MENU_PROMPT}"
        else:
            text = f"Hello. {_NCD_MENU} {_NCD_MENU_PROMPT}"
        return _envelope(text, intent)

    if intent == "goodbye":
        text = "Take care! I'm here whenever you have a health question."
        return _envelope(text, intent)

    if intent == "thanks":
        text = "You're welcome. Is there anything else I can help with?"
        return _envelope(text, intent)

    if intent == "acknowledgement":
        text = "Got it. Let me know if you have more questions."
        return _envelope(text, intent)

    if intent == "vague":
        return _envelope(_VAGUE_PROMPT, intent)

    if intent == "personal_records_request" and is_guest:
        text = (
            "Please sign in to access your personal records, medications, "
            "appointments, or care plan."
        )
        return _envelope(text, intent)

    # emergency, medical_question, authed personal_records, unknown
    # → fall through.
    return None


def _envelope(text: str, intent: str) -> Dict[str, Any]:
    """Match the keys downstream callers (agent_routes, streaming_routes)
    read off the result dict so the deterministic short-circuit is a
    drop-in for AminaAgent.process_message."""
    return {
        "response":              text,
        "triage_level":          None,
        "tools_used":            [],
        "followup":              None,
        "is_emergency":          False,
        "suggest_form":          None,
        "suggest_notifications": False,
        "intention":             intent,
        "trust_tier":            None,
        "ethnic_language":       None,
        "vitals_trend":          None,
        "ritual_phase":          None,
        "journey_callback":      None,
        "anniversary":           None,
        "referral_consumed":     None,
        "user_role":             None,
        "sources":               [],
        "export_action":         None,
        # Marker — also projected on X-AMINA-Intent-Router header by
        # basic_beginner_chat_patch's middleware.
        "intent_router":         "basic_beginner",
    }


__all__ = [
    "classify_basic_beginner_intent",
    "deterministic_response",
    "VALID_MODES",
]
