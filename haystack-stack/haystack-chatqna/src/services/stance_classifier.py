"""
Stance Classifier — Layer 1 of the four-layer neuro-symbolic router.

Classifies patient messages into one of nine conversational stances using
a lightweight LLM call (Gemini Flash Lite, ~150 tokens in, ~80 tokens out,
~200ms latency).

Nine stances:
  clinical_question        — asks about symptoms, conditions, treatment
  emotional_disclosure     — shares feelings, distress, mental health
  vitals_report            — reports BP, sugar, weight, or other readings
  information_seeking      — wants general health education / facts
  social_ritual            — greeting, goodbye, thank-you, small talk
  family_carer_concern     — asking about someone else's health
  medication_question      — drug names, dosages, interactions, side effects
  followup_continuation    — short ack continuing previous topic
  ambiguous_needs_clarification — unclear, classifier unsure

Structured output per call:
  {
    "stance": str,
    "subject": "self" | "other_person" | "general",
    "urgency": "immediate" | "soon" | "routine" | "non_clinical",
    "emotional_register": "calm" | "worried" | "scared" | "confused" |
                          "frustrated" | "resigned",
    "is_continuing_previous_topic": bool,
    "confidence": float  (0.0-1.0)
  }

Modes (USE_STANCE_MODE env var):
  "shadow"  — runs and logs but does NOT affect routing (default)
  "active"  — result feeds into Layer 2 tool selection
  "off"     — completely disabled

Fallback: if the LLM call fails or times out, returns a deterministic
classification using the existing Layer 0 heuristics from intent_router.py.

Gate: USE_STANCE_CLASSIFIER env var (default false).
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

_ENABLED = os.getenv("USE_STANCE_CLASSIFIER", "false").lower() == "true"
_MODE = os.getenv("USE_STANCE_MODE", "shadow").lower()

VALID_STANCES = frozenset({
    "clinical_question",
    "emotional_disclosure",
    "vitals_report",
    "information_seeking",
    "social_ritual",
    "family_carer_concern",
    "medication_question",
    "followup_continuation",
    "ambiguous_needs_clarification",
})

VALID_SUBJECTS = frozenset({"self", "other_person", "general"})
VALID_URGENCIES = frozenset({"immediate", "soon", "routine", "non_clinical"})
VALID_REGISTERS = frozenset({
    "calm", "worried", "scared", "confused", "frustrated", "resigned",
})

# Stance → intent mapping (Layer 2 uses this for tool selection)
STANCE_TO_INTENT = {
    "clinical_question":             "simple_question",
    "emotional_disclosure":          "emotional",
    "vitals_report":                 "report",
    "information_seeking":           "simple_question",
    "social_ritual":                 "greeting",
    "family_carer_concern":          "simple_question",
    "medication_question":           "simple_question",
    "followup_continuation":         "continuation",
    "ambiguous_needs_clarification": "simple_question",
}


# ── LLM client (lazy singleton) ─────────────────────────────────────

_client = None
_model = None

def _get_client():
    global _client, _model
    if _client is not None:
        return _client, _model
    try:
        from openai import AsyncOpenAI
        from src.config import settings
        if settings.GOOGLE_API_KEY:
            _client = AsyncOpenAI(
                api_key=settings.GOOGLE_API_KEY,
                base_url=settings.GEMINI_BASE_URL,
            )
            _model = settings.GEMINI_MODEL
            return _client, _model
    except Exception as e:
        logger.warning(f"stance_classifier: client init failed: {e}")
    return None, None


# ── System prompt (kept minimal for speed) ───────────────────────────

_SYSTEM_PROMPT = """You classify patient messages for a community health worker AI in rural Gambia.

Output ONLY valid JSON with these exact keys:
{"stance":"...","subject":"...","urgency":"...","emotional_register":"...","is_continuing_previous_topic":...,"confidence":...}

stance — exactly one of:
  clinical_question, emotional_disclosure, vitals_report, information_seeking,
  social_ritual, family_carer_concern, medication_question,
  followup_continuation, ambiguous_needs_clarification

subject — who the message is about:
  self, other_person, general

urgency — how time-sensitive:
  immediate (life-threatening), soon (within days), routine, non_clinical

emotional_register — the patient's emotional state:
  calm, worried, scared, confused, frustrated, resigned

is_continuing_previous_topic — true if this continues the last topic, false if new topic
confidence — 0.0 to 1.0, your confidence in the stance classification

Context clues:
- Mandinka/Wolof greetings (salaam, nanga def, jam waali) → social_ritual
- BP readings like "140/90" or "my sugar is 8" → vitals_report
- "my mother/father/child" + health concern → family_carer_concern
- Drug names (metformin, amlodipine, paracetamol) → medication_question
- Short acks (yes, okay, sure, thanks) → followup_continuation
- Emotional words (scared, worried, can't cope, overwhelmed) → emotional_disclosure
- "what should I eat", "is X good for diabetes" → clinical_question
- "what is diabetes", "how does BP work" → information_seeking"""


def _build_user_prompt(
    message: str,
    prev_stance: str = "",
    prev_intent: str = "",
    is_first_turn: bool = False,
) -> str:
    parts = [f'Message: "{message}"']
    if prev_stance:
        parts.append(f"Previous stance: {prev_stance}")
    if prev_intent:
        parts.append(f"Previous intent: {prev_intent}")
    if is_first_turn:
        parts.append("This is the first message in the conversation.")
    return "\n".join(parts)


# ── Deterministic fallback (mirrors Layer 0 logic) ──────────────────

_DRUG_NAMES = frozenset({
    "metformin", "amlodipine", "atenolol", "lisinopril", "hydrochlorothiazide",
    "glibenclamide", "insulin", "paracetamol", "ibuprofen", "aspirin",
    "omeprazole", "amoxicillin", "co-trimoxazole", "artemether", "lumefantrine",
    "doxycycline", "ciprofloxacin", "diclofenac", "enalapril", "nifedipine",
    "furosemide", "spironolactone", "digoxin", "warfarin", "phenytoin",
    "carbamazepine", "diazepam", "chlorpromazine", "haloperidol", "fluoxetine",
    "amitriptyline", "prednisolone", "salbutamol", "beclometasone",
})

_GREETING_WORDS = frozenset({
    "hi", "hello", "hey", "salaam", "assalamu", "alaikum", "peace",
    "nanga", "def", "jamm", "jam", "waali", "good morning", "good evening",
    "good afternoon", "bye", "goodbye", "thanks", "thank you",
})

_VITALS_PATTERN = re.compile(r"\b\d{2,3}\s*/\s*\d{2,3}\b")
_SUGAR_PATTERN = re.compile(r"\b(?:sugar|glucose|hba1c|a1c)\b.*\b\d", re.IGNORECASE)

_EMOTIONAL_WORDS = frozenset({
    "scared", "afraid", "terrified", "fear", "panic", "ashamed", "embarrassed",
    "overwhelmed", "cant cope", "can't cope", "giving up", "tired of this",
    "sad", "depressed", "lonely", "hopeless", "cry", "crying", "frustrated",
    "angry", "fed up", "anxious", "nervous", "worried", "stressed",
    "want to die", "no point", "worthless", "burden",
})

_FAMILY_CUES = re.compile(
    r"\b(?:my\s+)?(?:mother|father|wife|husband|child|son|daughter|baby|"
    r"grandmother|grandfather|sister|brother|uncle|aunt|family)\b",
    re.IGNORECASE,
)

_ACK_WORDS = frozenset({
    "yes", "yeah", "yea", "yep", "ok", "okay", "sure", "alright",
    "fine", "right", "hmm", "good", "nice", "great", "cool",
    "got it", "will do", "thanks", "thank you", "noted", "understood",
})


def deterministic_fallback(
    message: str,
    is_first_turn: bool = False,
) -> Dict[str, Any]:
    ml = message.lower().strip()
    words = ml.split()
    word_count = len(words)

    # Short ack
    if word_count <= 4 and all(w.rstrip(",.!?") in _ACK_WORDS for w in words):
        return _make_stance("followup_continuation", "self", "non_clinical", "calm", False, 0.85)

    # Vitals
    if _VITALS_PATTERN.search(ml) or _SUGAR_PATTERN.search(ml):
        return _make_stance("vitals_report", "self", "routine", "calm", False, 0.80)

    # Medication
    if any(drug in ml for drug in _DRUG_NAMES):
        return _make_stance("medication_question", "self", "routine", "calm", False, 0.75)

    # Emotional
    if any(cue in ml for cue in _EMOTIONAL_WORDS):
        register = "worried"
        if any(w in ml for w in ("scared", "terrified", "panic", "afraid")):
            register = "scared"
        elif any(w in ml for w in ("frustrated", "angry", "fed up")):
            register = "frustrated"
        elif any(w in ml for w in ("hopeless", "giving up", "worthless")):
            register = "resigned"
        return _make_stance("emotional_disclosure", "self", "soon", register, False, 0.75)

    # Family concern
    if _FAMILY_CUES.search(ml) and ("?" in ml or any(w in ml for w in ("sick", "pain", "fever", "ill"))):
        return _make_stance("family_carer_concern", "other_person", "routine", "worried", False, 0.70)

    # Greeting / social
    if is_first_turn and word_count <= 8:
        if any(g in ml for g in _GREETING_WORDS):
            return _make_stance("social_ritual", "general", "non_clinical", "calm", False, 0.85)
        if "?" not in ml:
            return _make_stance("social_ritual", "general", "non_clinical", "calm", False, 0.70)

    # Goodbye
    if ml.rstrip(".!") in {"bye", "goodbye", "bye bye", "thanks bye", "that's all", "thats all", "im done", "i'm done"}:
        return _make_stance("social_ritual", "general", "non_clinical", "calm", False, 0.90)

    # Information seeking (educational, not personal)
    info_cues = ["what is", "what are", "how does", "how do", "why does", "why do", "explain", "tell me about"]
    if any(cue in ml for cue in info_cues) and "i " not in ml and "my " not in ml:
        return _make_stance("information_seeking", "general", "non_clinical", "calm", False, 0.65)

    # Clinical question (personal health)
    if "?" in ml or any(w in words[:3] for w in ("what", "how", "should", "can", "is")):
        return _make_stance("clinical_question", "self", "routine", "calm", False, 0.60)

    # Ambiguous
    return _make_stance("ambiguous_needs_clarification", "self", "routine", "calm", False, 0.30)


def _make_stance(
    stance: str,
    subject: str,
    urgency: str,
    register: str,
    is_continuing: bool,
    confidence: float,
) -> Dict[str, Any]:
    return {
        "stance": stance,
        "subject": subject,
        "urgency": urgency,
        "emotional_register": register,
        "is_continuing_previous_topic": is_continuing,
        "confidence": confidence,
    }


# ── Redis stance cache (per-session) ────────────────────────────────

_STANCE_TTL = 86400

def _get_redis():
    import redis
    from src.config import settings
    return redis.Redis(
        host=settings.REDIS_HOST,
        port=settings.REDIS_PORT,
        db=0,
        decode_responses=True,
    )

def get_last_stance(session_id: str) -> str:
    if not session_id:
        return ""
    try:
        r = _get_redis()
        return r.get(f"stance:last:{session_id}") or ""
    except Exception:
        return ""

def _save_stance(session_id: str, stance: str) -> None:
    if not session_id:
        return
    try:
        r = _get_redis()
        r.set(f"stance:last:{session_id}", stance, ex=_STANCE_TTL)
    except Exception:
        pass


# ── Shadow mode logging ─────────────────────────────────────────────

def _log_shadow(
    message: str,
    stance_result: Dict[str, Any],
    layer0_intent: str,
    latency_ms: float,
    source: str,
) -> None:
    logger.info(
        f"STANCE_SHADOW stance={stance_result.get('stance','')} "
        f"confidence={stance_result.get('confidence',0):.2f} "
        f"urgency={stance_result.get('urgency','')} "
        f"register={stance_result.get('emotional_register','')} "
        f"layer0={layer0_intent} source={source} "
        f"latency={latency_ms:.0f}ms msg={message[:60]}"
    )


# ── Parse LLM response ──────────────────────────────────────────────

def _parse_llm_response(raw: str) -> Optional[Dict[str, Any]]:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{[^}]+\}", raw, re.DOTALL)
        if match:
            try:
                data = json.loads(match.group())
            except json.JSONDecodeError:
                return None
        else:
            return None

    stance = data.get("stance", "")
    if stance not in VALID_STANCES:
        return None

    subject = data.get("subject", "self")
    if subject not in VALID_SUBJECTS:
        subject = "self"

    urgency = data.get("urgency", "routine")
    if urgency not in VALID_URGENCIES:
        urgency = "routine"

    register = data.get("emotional_register", "calm")
    if register not in VALID_REGISTERS:
        register = "calm"

    confidence = data.get("confidence", 0.5)
    try:
        confidence = max(0.0, min(1.0, float(confidence)))
    except (TypeError, ValueError):
        confidence = 0.5

    return {
        "stance": stance,
        "subject": subject,
        "urgency": urgency,
        "emotional_register": register,
        "is_continuing_previous_topic": bool(data.get("is_continuing_previous_topic", False)),
        "confidence": confidence,
    }


# ═══════════════════════════════════════════════════════════════════
# PUBLIC API
# ═══════════════════════════════════════════════════════════════════

async def classify_stance(
    message: str,
    session_id: str = "",
    is_first_turn: bool = False,
    prev_intent: str = "",
    layer0_intent: str = "",
) -> Dict[str, Any]:
    """Classify the conversational stance of a patient message.

    Returns stance dict with: stance, subject, urgency, emotional_register,
    is_continuing_previous_topic, confidence, plus metadata fields:
      _source: "llm" or "deterministic"
      _latency_ms: classification time
      _mode: "shadow" or "active"
    """
    if not _ENABLED:
        result = deterministic_fallback(message, is_first_turn)
        result["_source"] = "disabled"
        result["_latency_ms"] = 0
        result["_mode"] = "off"
        return result

    prev_stance = get_last_stance(session_id)
    t0 = time.monotonic()

    client, model = _get_client()
    result = None

    if client and model:
        try:
            user_prompt = _build_user_prompt(
                message, prev_stance, prev_intent, is_first_turn,
            )
            completion = await client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.1,
                max_tokens=120,
            )
            raw = (completion.choices[0].message.content or "").strip()
            result = _parse_llm_response(raw)
            if result:
                result["_source"] = "llm"
        except Exception as e:
            logger.debug(f"stance_classifier LLM call failed: {e}")

    if result is None:
        result = deterministic_fallback(message, is_first_turn)
        result["_source"] = "deterministic"

    latency_ms = (time.monotonic() - t0) * 1000
    result["_latency_ms"] = latency_ms
    result["_mode"] = _MODE

    _save_stance(session_id, result["stance"])
    _log_shadow(message, result, layer0_intent, latency_ms, result["_source"])

    return result


def classify_stance_sync(
    message: str,
    is_first_turn: bool = False,
) -> Dict[str, Any]:
    """Synchronous fallback — deterministic only, no LLM call."""
    result = deterministic_fallback(message, is_first_turn)
    result["_source"] = "deterministic_sync"
    result["_latency_ms"] = 0
    result["_mode"] = _MODE
    return result
