"""
Intent Router — replaces brittle keyword classification with structural
analysis that follows AMINA's legacy approach to intent.

Core insight: strip the ack prefix BEFORE classifying.
  "okay what exercise should i do today"
  → strip "okay" → "what exercise should i do today"
  → simple_question (NOT plan continuation)

Two-tier classification:
  Tier 1: Deterministic for unambiguous cases (emergency, exact ack, goodbye)
  Tier 2: Structural decomposition for everything else

Nine intents:
  emergency, greeting, simple_question, plan_request,
  continuation, topic_shift, report, emotional, goodbye

Gate: settings.USE_INTENT_ROUTER (default false).
When false, every public function returns a neutral fallback.
"""

from __future__ import annotations

import re
import logging
from typing import Any, Dict, Optional, Tuple

import os

from src.config import settings

logger = logging.getLogger(__name__)

_ENABLED = os.getenv("USE_INTENT_ROUTER", "false").lower() == "true"


# ── Ack prefix vocabulary ────────────────────────────────────────────

_ACK_WORDS = frozenset({
    "yes", "yeah", "yea", "yep", "ok", "okay", "sure", "alright",
    "fine", "right", "hmm", "good", "nice", "great", "cool",
    "got it", "will do", "thanks", "thank you",
})

_CONNECTORS = frozenset({
    "what", "how", "why", "when", "where", "which", "who",
    "should", "can", "could", "would", "will", "is", "are",
    "do", "does", "but", "so", "and", "now", "tell", "give",
    "about", "let", "i", "my", "i'm", "im", "me", "we",
    "also", "another", "next", "then", "if",
})


# ── Emergency keywords (from amina_agent.py) ────────────────────────

_EMERGENCY_CUES = [
    "chest pain", "can't breathe", "cant breathe", "difficulty breathing",
    "severe bleeding", "unconscious", "seizure", "convulsion",
    "suicide", "kill myself", "want to die", "overdose",
    "head injury", "poisoning", "snake bite", "severe burn",
    "heart attack", "stroke symptoms", "collapsed",
]


# ── Goodbye phrases ─────────────────────────────────────────────────

_GOODBYE_EXACT = frozenset({
    "bye", "goodbye", "bye bye", "thanks bye", "thank you bye",
    "that's all", "thats all", "nothing else", "i'm done", "im done",
})


# ── Plan detection ───────────────────────────────────────────────────

_PLAN_CUES = [
    "meal plan", "weekly plan", "diet plan", "care plan",
    "monday to friday", "monday till friday", "mon to fri",
    "this week", "whole week", "every day",
    "for the week", "weekly", "daily plan", "schedule",
    "breakfast lunch and dinner", "breakfast lunch dinner",
    "breakfast and lunch and dinner",
    "monday tuesday", "7 days", "five days", "5 days",
    "diet chart", "food chart", "full diet", "full chart",
    "full plan", "complete plan", "complete diet",
    "gimme a plan", "gimme a chart", "gimme a diet",
    "gimme a schedule", "gimme a full",
    "give me a plan", "give me a chart",
    "plan for me", "chart for me", "decide for me",
    "you decide", "you choose", "you plan",
    "make me a", "create a plan", "prepare a plan",
    "what to eat each day", "each day",
    "breakfast and lunch", "lunch and dinner",
]

_DIET_WORDS = frozenset({
    "diet", "food", "eat", "meal", "meals", "breakfast",
    "lunch", "dinner", "cooking", "cook", "nutrition",
})

_TIME_WORDS = frozenset({
    "week", "weeks", "daily", "days", "monday", "tuesday",
    "wednesday", "thursday", "friday", "saturday", "sunday",
    "everyday", "weekday", "weekdays",
})


# ── Report patterns ──────────────────────────────────────────────────

_REPORT_CUES = [
    "my bp", "my sugar", "blood pressure", "glucose",
    "sugar is", "bp is", "reading is", "measured",
    "my weight", "i weigh",
]

_VITALS_PATTERN = re.compile(r"\b\d{2,3}\s*/\s*\d{2,3}\b")


# ── Emotional keywords (from empathy.py) ────────────────────────────

_EMOTIONAL_CUES = [
    "scared", "afraid", "terrified", "fear", "panic",
    "ashamed", "embarrassed", "stigma",
    "overwhelmed", "too much", "cant cope", "can't cope",
    "giving up", "tired of this",
    "sad", "depressed", "lonely", "hopeless", "cry", "crying",
    "frustrated", "angry", "fed up", "sick of",
    "anxious", "nervous", "worried", "stressed",
    "want to die", "no point", "worthless", "burden",
]


# ── Question words ───────────────────────────────────────────────────

_QUESTION_WORDS = frozenset({
    "what", "how", "why", "when", "where", "which", "who",
    "should", "can", "could", "is", "are", "do", "does",
    "tell", "explain", "give",
})


# ── Token hints per intent ───────────────────────────────────────────

INTENT_TOKEN_HINTS = {
    "emergency":       200,
    "greeting":        200,
    "simple_question": 400,
    "plan_request":    1000,
    "continuation":    300,
    "topic_shift":     400,
    "report":          400,
    "emotional":       400,
    "goodbye":         150,
}

# ── Intent → legacy turn_type mapping ────────────────────────────────

INTENT_TO_TURN_TYPE = {
    "emergency":       "emergency",
    "greeting":        "greet",
    "simple_question": "direct_answer",
    "plan_request":    "structured_plan",
    "continuation":    "affirm",
    "topic_shift":     "direct_answer",
    "report":          "check",
    "emotional":       "empathize",
    "goodbye":         "close",
}


# ── Redis helpers (same pattern as conversational_pacer) ─────────────

_QUEUE_TTL = 86400

def _get_redis():
    import redis
    return redis.Redis(
        host=settings.REDIS_HOST,
        port=settings.REDIS_PORT,
        db=0,
        decode_responses=True,
    )

def _get_last_intent(session_id: str) -> Optional[str]:
    try:
        r = _get_redis()
        return r.get(f"last_intent:{session_id}")
    except Exception:
        return None

def _save_last_intent(session_id: str, intent: str) -> None:
    try:
        r = _get_redis()
        r.set(f"last_intent:{session_id}", intent, ex=_QUEUE_TTL)
    except Exception:
        pass


# ═══════════════════════════════════════════════════════════════════
# ACK PREFIX STRIPPING — the core innovation
# ═══════════════════════════════════════════════════════════════════

def _strip_ack_prefix(msg: str) -> Tuple[str, bool]:
    """Strip acknowledgment prefix from message.

    "okay what exercise should i do" → ("what exercise should i do", True)
    "yes" → ("yes", False)  — whole message is ack, don't strip
    "what should i eat" → ("what should i eat", False)  — no ack prefix
    """
    words = msg.split()
    if not words:
        return msg, False

    ack_end = 0
    w0 = words[0].rstrip(",.!").lower()
    if w0 in _ACK_WORDS:
        ack_end = 1
        if len(words) > 1:
            w1 = words[1].rstrip(",.!").lower()
            if w1 in _ACK_WORDS:
                ack_end = 2

    if ack_end == 0:
        return msg, False

    if ack_end >= len(words):
        return msg, False

    next_word = words[ack_end].rstrip(",.!").lower()
    prev_ends_comma = words[ack_end - 1].endswith(",")

    if next_word in _CONNECTORS or prev_ends_comma:
        stripped = " ".join(words[ack_end:]).lstrip(", ")
        return stripped, True

    return msg, False


# ═══════════════════════════════════════════════════════════════════
# CONTENT CLASSIFIERS
# ═══════════════════════════════════════════════════════════════════

def _is_emergency(msg: str) -> bool:
    ml = msg.lower()
    return any(cue in ml for cue in _EMERGENCY_CUES)


def _is_goodbye(msg: str) -> bool:
    return msg.lower().strip().rstrip(".!") in _GOODBYE_EXACT


def _is_plan_request(msg: str) -> bool:
    ml = msg.lower()
    if any(cue in ml for cue in _PLAN_CUES):
        return True
    tokens = set(re.sub(r"[^\w\s]", "", ml).split())
    return bool(tokens & _DIET_WORDS and tokens & _TIME_WORDS)


def _is_report(msg: str) -> bool:
    ml = msg.lower()
    if any(cue in ml for cue in _REPORT_CUES):
        return True
    return bool(_VITALS_PATTERN.search(ml))


def _is_emotional(msg: str) -> bool:
    ml = msg.lower()
    word_count = len(ml.split())
    if word_count > 20:
        return False
    return any(cue in ml for cue in _EMOTIONAL_CUES)


def _is_question(msg: str) -> bool:
    ml = msg.lower()
    words = ml.split()
    if "?" in msg:
        return True
    if words and words[0].rstrip(",.!") in _QUESTION_WORDS:
        return True
    return any(w.rstrip(",.!") in _QUESTION_WORDS for w in words[:3])


def _is_short_ack(msg: str) -> bool:
    """True when the entire message is a short acknowledgment (≤4 words)."""
    words = msg.lower().split()
    if len(words) > 4:
        return False
    _ack_vocab = {
        "yes", "yeah", "yea", "yep", "ok", "okay", "sure", "alright",
        "fine", "right", "hmm", "good", "nice", "great", "cool",
        "thanks", "will", "do", "it", "i", "try", "can",
        "got", "noted", "understood", "i'll",
    }
    return all(w.rstrip(",.!") in _ack_vocab for w in words)


# ═══════════════════════════════════════════════════════════════════
# PROMPT INSTRUCTION BUILDER
# ═══════════════════════════════════════════════════════════════════

def _build_instruction(
    intent: str,
    sub_intent: Optional[str] = None,
    stripped_msg: str = "",
    patient_name: str = "",
    prev_intent: Optional[str] = None,
) -> str:
    """Build natural-language prompt instruction for the model.

    These are GUIDANCE, not hard limits. The model self-regulates
    based on these instructions, following AMINA's legacy approach.
    """

    name_note = f"Address as '{patient_name}' once." if patient_name else ""

    if intent == "emergency":
        return (
            "EMERGENCY: Direct the patient to call 199 or go to the nearest health post IMMEDIATELY. "
            "Say what to do while waiting. Be firm, clear, short. 3-4 sentences max. "
            + name_note
        )

    if intent == "greeting":
        return (
            "The patient is greeting you. Greet back warmly using their name, "
            "ask how they're doing or about a specific health concern. "
            "2-3 sentences. Do NOT give unsolicited advice. "
            + name_note
        )

    if intent == "simple_question":
        return (
            "The patient asked a specific question. Answer it DIRECTLY with one concrete, "
            "specific recommendation using Gambian foods/context. "
            "2-4 sentences. Do NOT add unrelated topics (hydration, medication, exercise, follow-ups) "
            "unless the patient asked about them. End with a short question or suggestion. "
            + name_note
        )

    if intent == "plan_request":
        return (
            "STRUCTURED PLAN REQUEST — generate the COMPLETE plan the patient asked for. "
            "Use a clear day-by-day structure with bold headers. "
            "For meal plans, format as:\n"
            "**Monday**\n"
            "- Breakfast: [specific Gambian food]\n"
            "- Lunch: [specific Gambian food]\n"
            "- Dinner: [specific Gambian food]\n\n"
            "RULES:\n"
            "- Use ONLY specific Gambian foods: moringa porridge, benachin, domoda, supakanja, "
            "churaa gerté, chere, mbahal, nyaankataŋ, tapalapa bread, baobab juice, bissap, "
            "findi, laaciiri, tia durango.\n"
            "- Include seasonal notes: moringa year-round, okra rainy season (Jun-Oct), "
            "sweet potato Nov-Mar, watermelon Mar-Jun.\n"
            "- Vary meals across days.\n"
            "- Reference patient's conditions where relevant.\n"
            "- End with one tip about lumo market shopping.\n"
            + name_note
        )

    if intent == "continuation":
        context = ""
        if prev_intent == "plan_request":
            context = "Your last message was a structured plan. "
        elif prev_intent == "simple_question":
            context = "You were answering a health question. "
        return (
            "The patient acknowledged/agreed. " + context +
            "Build on what you were discussing — give the next specific piece of advice "
            "or ask a follow-up question about the SAME topic. "
            "2-3 sentences. Do NOT close the conversation or say 'check back'. "
            + name_note
        )

    if intent == "topic_shift":
        return (
            "The patient acknowledged your last point and is now asking a NEW question. "
            "Answer their NEW question directly. Do NOT continue the previous topic. "
            "2-4 sentences with one specific recommendation. "
            + name_note
        )

    if intent == "report":
        return (
            "The patient reported health data (vitals, symptoms, actions). "
            "Acknowledge the reading, say whether it's concerning or good, "
            "and give ONE specific next step. 2-4 sentences. "
            + name_note
        )

    if intent == "emotional":
        return (
            "The patient is expressing difficult emotions. "
            "Acknowledge the emotion FIRST — name it. Sit with it for one sentence. "
            "Then offer ONE concrete, doable next step. 3-4 sentences. "
            "Do NOT minimize ('it'll be fine') or lecture. "
            + name_note
        )

    if intent == "goodbye":
        return (
            "The patient is wrapping up. Summarize ONE thing agreed today, "
            "say when to check back. 2 sentences max. "
            + name_note
        )

    return (
        "Answer the patient's question directly with one specific recommendation. "
        "2-4 sentences. " + name_note
    )


# ═══════════════════════════════════════════════════════════════════
# INTENT LEARNER INTEGRATION (sync wrappers)
# ═══════════════════════════════════════════════════════════════════

_LEARNER_ENABLED = os.getenv("USE_INTENT_LEARNER", "false").lower() == "true"


def _learner_lookup(stripped_message: str, classified_intent: str) -> Optional[Dict[str, Any]]:
    if not _LEARNER_ENABLED:
        return None
    try:
        from src.services.intent_learner import lookup_correction
        return lookup_correction(stripped_message, classified_intent)
    except Exception as e:
        logger.debug(f"intent_learner lookup failed: {e}")
        return None


def _learner_record(
    message: str, stripped: str, intent: str, turn_type: str,
    session_id: str, patient_id: str,
    was_overridden: bool = False, override_correction_id: str = "",
) -> None:
    if not _LEARNER_ENABLED:
        return
    try:
        from src.services.intent_learner import record_classification
        record_classification(
            message=message, stripped_message=stripped,
            classified_intent=intent, turn_type=turn_type,
            session_id=session_id, patient_id=patient_id,
            was_overridden=was_overridden,
            override_correction_id=override_correction_id,
        )
    except Exception as e:
        logger.debug(f"intent_learner record failed: {e}")


# ═══════════════════════════════════════════════════════════════════
# MAIN ROUTER
# ═══════════════════════════════════════════════════════════════════

def route_intent(
    message: str,
    is_first_turn: bool,
    session_id: str = "",
    emotional_register: str = "calm",
    patient_name: str = "",
    patient_id: str = "",
) -> Dict[str, Any]:
    """Classify user intent and build prompt guidance.

    Returns:
    {
        "intent": str,
        "sub_intent": str|None,
        "prompt_instruction": str,
        "max_tokens_hint": int,
        "turn_type": str,          # legacy mapping for backward compat
        "stripped_message": str,
    }

    When USE_INTENT_ROUTER is off, returns a neutral fallback.
    """
    if not _ENABLED:
        return {
            "intent": "simple_question",
            "sub_intent": None,
            "prompt_instruction": "",
            "max_tokens_hint": 400,
            "turn_type": "direct_answer",
            "stripped_message": message,
        }

    msg_lower = message.lower().strip()
    prev_intent = _get_last_intent(session_id) if session_id else None

    # ── Tier 1: Unambiguous deterministic rules ──

    if _is_emergency(msg_lower):
        intent = "emergency"
        _save_last_intent(session_id, intent)
        result = _make_result(intent, None, message, patient_name, prev_intent)
        _learner_record(message, message, intent, result["turn_type"], session_id, patient_id)
        return result

    if _is_goodbye(msg_lower):
        intent = "goodbye"
        _save_last_intent(session_id, intent)
        result = _make_result(intent, None, message, patient_name, prev_intent)
        _learner_record(message, message, intent, result["turn_type"], session_id, patient_id)
        return result

    if _is_short_ack(msg_lower):
        intent = "continuation"
        _save_last_intent(session_id, intent)
        result = _make_result(intent, None, message, patient_name, prev_intent)
        _learner_record(message, message, intent, result["turn_type"], session_id, patient_id)
        return result

    # ── Tier 2: Structural decomposition ──

    stripped, had_ack = _strip_ack_prefix(msg_lower)

    # ── Correction layer: check for known overrides before classifying ──
    correction = _learner_lookup(stripped, "")
    if correction:
        corrected_intent = correction["corrected_intent"]
        _save_last_intent(session_id, corrected_intent)
        result = _make_result(corrected_intent, None, stripped, patient_name, prev_intent)
        result["was_overridden"] = True
        result["override_correction_id"] = correction.get("correction_id", "")
        _learner_record(
            message, stripped, corrected_intent, result["turn_type"],
            session_id, patient_id, was_overridden=True,
            override_correction_id=correction.get("correction_id", ""),
        )
        logger.info(
            f"INTENT_OVERRIDE pattern='{stripped[:50]}' "
            f"to={corrected_intent} cid={correction.get('correction_id','')}"
        )
        return result

    # Classify the stripped content
    sub_intent = _classify_content(stripped, is_first_turn)

    if had_ack and sub_intent in ("simple_question", "report", "emotional"):
        intent = "topic_shift"
        _save_last_intent(session_id, sub_intent)
        result = _make_result(intent, sub_intent, stripped, patient_name, prev_intent)
        _learner_record(message, stripped, intent, result["turn_type"], session_id, patient_id)
        return result

    if had_ack and sub_intent == "plan_request":
        intent = "plan_request"
        _save_last_intent(session_id, intent)
        result = _make_result(intent, None, stripped, patient_name, prev_intent)
        _learner_record(message, stripped, intent, result["turn_type"], session_id, patient_id)
        return result

    intent = sub_intent
    _save_last_intent(session_id, intent)
    result = _make_result(intent, None, stripped, patient_name, prev_intent)
    _learner_record(message, stripped, intent, result["turn_type"], session_id, patient_id)
    return result


def _classify_content(msg: str, is_first_turn: bool) -> str:
    """Classify the substantive content (after ack stripping)."""

    if _is_emergency(msg):
        return "emergency"

    if _is_plan_request(msg):
        return "plan_request"

    if _is_report(msg):
        return "report"

    if _is_emotional(msg):
        return "emotional"

    if is_first_turn and len(msg.split()) < 10:
        has_question = _is_question(msg)
        if not has_question:
            return "greeting"

    if _is_question(msg):
        return "simple_question"

    if is_first_turn:
        return "greeting"

    return "simple_question"


def _make_result(
    intent: str,
    sub_intent: Optional[str],
    stripped: str,
    patient_name: str,
    prev_intent: Optional[str],
) -> Dict[str, Any]:
    instruction = _build_instruction(
        intent, sub_intent, stripped, patient_name, prev_intent,
    )
    return {
        "intent": intent,
        "sub_intent": sub_intent,
        "prompt_instruction": instruction,
        "max_tokens_hint": INTENT_TOKEN_HINTS.get(intent, 400),
        "turn_type": INTENT_TO_TURN_TYPE.get(intent, "direct_answer"),
        "stripped_message": stripped,
    }
