"""
Response Shape Decision — Transformation 3.

Instead of always forcing a deterministic greeting + hard 80-word cap,
this service lets the model choose the response shape based on context.
The 7 layers of greeting data become *available context* rather than
*forced output*. Length limits become mode-dependent rather than fixed.

Gate: settings.USE_RESPONSE_SHAPE_DECISION (default false).
When false, every public function is a no-op — greeting/stripping/length
behavior is unchanged.

Response shapes:
  GREETING_FULL     — full cultural greeting (Mandinka time-of-day + trust tier)
  GREETING_BRIEF    — short "Salaam aleikum" + engage
  ACKNOWLEDGE_ENGAGE — skip greeting, acknowledge concern, engage directly
  STRAIGHT_TO_CONCERN — no greeting, address worry immediately
  EMERGENCY         — emergency protocol only
  EMPATHY_FIRST     — emotional acknowledgment before clinical content
  CLOSING           — warm goodbye with follow-up plan
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from src.config import settings

logger = logging.getLogger(__name__)

_ENABLED = settings.USE_RESPONSE_SHAPE_DECISION


# ── Shape definitions ────────────────────────────────────────────────────

SHAPES = {
    "GREETING_FULL": {
        "max_words": 80,
        "instruction": (
            "RESPONSE SHAPE: GREETING_FULL\n"
            "Start with the full cultural greeting provided below, then "
            "address the patient's message. Keep total response under 80 words."
        ),
    },
    "GREETING_BRIEF": {
        "max_words": 60,
        "instruction": (
            "RESPONSE SHAPE: GREETING_BRIEF\n"
            "Start with a brief 'Salaam aleikum' then engage directly with "
            "their message. Keep total response under 60 words."
        ),
    },
    "ACKNOWLEDGE_ENGAGE": {
        "max_words": 80,
        "instruction": (
            "RESPONSE SHAPE: ACKNOWLEDGE_AND_ENGAGE\n"
            "Skip the greeting. Acknowledge what the patient said in your "
            "first sentence, then give practical advice. Under 80 words."
        ),
    },
    "STRAIGHT_TO_CONCERN": {
        "max_words": 100,
        "instruction": (
            "RESPONSE SHAPE: STRAIGHT_TO_CONCERN\n"
            "No greeting. The patient is worried — address their concern "
            "immediately. Be specific and practical. You may use up to "
            "100 words because the situation needs clear guidance."
        ),
    },
    "EMERGENCY": {
        "max_words": 120,
        "instruction": (
            "RESPONSE SHAPE: EMERGENCY\n"
            "No greeting. Be firm and directive. Give the emergency protocol: "
            "call 199, go to EFSTH, and what to do while waiting. Up to "
            "120 words."
        ),
    },
    "EMPATHY_FIRST": {
        "max_words": 150,
        "instruction": (
            "RESPONSE SHAPE: EMPATHY_FIRST\n"
            "No greeting. The patient is scared, grieving, or overwhelmed. "
            "Your first 2-3 sentences acknowledge their feelings directly. "
            "Then offer one concrete next step. You may use up to 150 words "
            "because emotional presence needs space. No filler — every "
            "sentence earns its place."
        ),
    },
    "CLOSING": {
        "max_words": 80,
        "instruction": (
            "RESPONSE SHAPE: CLOSING\n"
            "The patient is wrapping up. Give a warm, brief goodbye with "
            "their follow-up plan. Under 80 words."
        ),
    },
}


# ── Shape selection logic (deterministic, zero LLM) ─────────────────────

def select_response_shape(
    message: str,
    is_first_turn: bool,
    greeting_ctx: Dict[str, Any],
    dialogue_state: Optional[Dict[str, Any]] = None,
    emotional_state: Optional[Dict[str, Any]] = None,
    is_emergency: bool = False,
    is_closing: bool = False,
) -> str:
    """Select the appropriate response shape based on context.
    Returns a shape key from SHAPES.

    This is deterministic (no LLM call) but uses richer signals than
    the current always-greet logic."""
    if not _ENABLED:
        return "GREETING_FULL"  # never used when disabled

    # Emergency always wins
    if is_emergency:
        return "EMERGENCY"

    # Closing detected
    if is_closing:
        return "CLOSING"

    # Emotional distress -- empathy before anything else.
    # BUG-034 verified-safe: the `if emotional_state` guard already
    # short-circuits None/{}; the `or .get(..., "calm")` chain handles
    # truthy-but-missing-key. Keeping the guard; do NOT remove it.
    if emotional_state:
        register = emotional_state.get("register") or emotional_state.get("current_register", "calm")
        if register in ("scared", "frustrated", "resigned"):
            return "EMPATHY_FIRST"

    # Dialogue state emotional register (from T1)
    if dialogue_state:
        ds_register = dialogue_state.get("current_register", "calm")
        if ds_register in ("scared", "frustrated", "resigned"):
            return "EMPATHY_FIRST"

    # Intention-based selection
    intention = greeting_ctx.get("intention", {}).get("intention", "HEALTH_GENERAL")

    if intention == "EMERGENCY":
        return "EMERGENCY"
    if intention == "IN_PAIN":
        return "STRAIGHT_TO_CONCERN"
    if intention == "WORRIED_ABOUT_OTHER":
        return "STRAIGHT_TO_CONCERN"
    if intention == "LONELY":
        # Lonely patients need warmth — brief greeting + engage
        if is_first_turn:
            return "GREETING_BRIEF"
        return "ACKNOWLEDGE_ENGAGE"

    # First turn with clear health question — acknowledge, don't greet
    if is_first_turn:
        msg_lower = message.lower()
        # If message is a health question (>8 words, no greeting words)
        has_greeting = any(g in msg_lower for g in [
            "salaam", "hi ", "hello", "hey ", "good morning",
            "good afternoon", "good evening", "assalamu",
        ])
        if not has_greeting and len(msg_lower.split()) > 8:
            return "ACKNOWLEDGE_ENGAGE"

        # Unusual hour + distress
        signals = greeting_ctx.get("signals", {})
        if signals.get("unusual_hour") and intention in ("IN_PAIN", "EMERGENCY"):
            return "STRAIGHT_TO_CONCERN"

        # Normal first turn — full greeting
        return "GREETING_FULL"

    # Non-first-turn: never greet
    # Check if patient is worried based on message signals
    msg_lower = message.lower()
    worry_cues = ["worried", "scared", "afraid", "don't know what to do",
                  "dont know what to do", "help me", "please help",
                  "what should i do", "is it serious", "am i going to"]
    if any(cue in msg_lower for cue in worry_cues):
        return "STRAIGHT_TO_CONCERN"

    return "ACKNOWLEDGE_ENGAGE"


# ── Build prompt instruction ─────────────────────────────────────────────

def build_shape_instruction(
    shape: str,
    greeting_text: str,
    greeting_ctx: Dict[str, Any],
    is_first_turn: bool,
) -> str:
    """Build a prompt instruction block that tells the model:
    1. What shape to use
    2. The greeting data (available, not forced)
    3. The length limit for this shape

    Returns empty string when flag is off."""
    if not _ENABLED:
        return ""

    shape_def = SHAPES.get(shape, SHAPES["ACKNOWLEDGE_ENGAGE"])
    parts = [shape_def["instruction"]]

    # Provide greeting data as context (not as a command to use it)
    if greeting_text and shape in ("GREETING_FULL", "GREETING_BRIEF"):
        parts.append(
            f"\nAVAILABLE GREETING (use this exact text as your opener): "
            f"{greeting_text}"
        )
    elif greeting_text and is_first_turn:
        parts.append(
            f"\nAVAILABLE GREETING (you may reference it naturally if "
            f"appropriate, but you are NOT required to use it): "
            f"{greeting_text}"
        )

    # Trust tier context
    trust = greeting_ctx.get("trust", {})
    tier = trust.get("tier", "stranger")
    if tier == "companion" or tier == "family":
        parts.append(
            f"WARMTH: This is a {tier}-level patient. Be warm and personal."
        )

    # Intention context
    intention = greeting_ctx.get("intention", {}).get("intention", "")
    if intention == "WORRIED_ABOUT_OTHER":
        parts.append(
            "NOTE: The patient is asking about someone ELSE (family member). "
            "Address them as the carer, not as the patient."
        )
    if intention == "LONELY":
        parts.append(
            "NOTE: This patient may be lonely. Health is real — engage warmly."
        )

    # Tone signals
    signals = greeting_ctx.get("signals", {})
    if signals.get("unusual_hour"):
        parts.append("NOTE: It is late/early. Check if everything is okay.")
    if signals.get("shouting"):
        parts.append("NOTE: Patient is using ALL CAPS — they may be urgent.")
    if signals.get("privacy_needed"):
        parts.append("NOTE: Patient wants privacy — acknowledge confidentiality.")

    # Special day
    special = greeting_ctx.get("special_day")
    if special and shape in ("GREETING_FULL", "GREETING_BRIEF"):
        parts.append(f"SPECIAL DAY: {special.get('modifier', '')}")

    # Override the 80-word system prompt rule with shape-specific limit
    max_words = shape_def["max_words"]
    if max_words != 80:
        parts.append(
            f"\nIMPORTANT: For this response shape, your word limit is "
            f"{max_words} words (overrides the default 80-word rule). "
            f"Every sentence must earn its place — no filler."
        )

    return "\n".join(parts)


def get_max_words_for_shape(shape: str) -> int:
    """Return the max word count for a given shape."""
    if not _ENABLED:
        return 80
    return SHAPES.get(shape, SHAPES["ACKNOWLEDGE_ENGAGE"])["max_words"]
