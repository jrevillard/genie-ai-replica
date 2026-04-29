"""
Four-Layer Neuro-Symbolic Router — orchestrates the full classification
pipeline for AMINA.

Pipeline:
  Layer 0: Fast deterministic filter (existing intent_router.py)
           — catches emergency, goodbye, short ack in <1ms
           — if it matches with high confidence, skip Layer 1

  Layer 1: Conversational stance classifier (stance_classifier.py)
           — LLM-based (Gemini Flash Lite), 9 stances, structured output
           — runs in shadow mode by default (logs but doesn't route)
           — degrades to deterministic fallback when LLM fails

  Layer 2: Stance-conditional tool selection
           — maps stance → allowed/suppressed tools
           — social_ritual and emotional_disclosure suppress most tools
           — ambiguous → no tools + ask clarifying question

  Layer 3: Knowledge-graph safety check (intent_pattern_graph.py)
           — emergency patterns, drug context, cultural idioms
           — if emergency detected, OVERRIDES all prior layers
           — cultural idioms can shift stance classification

Output: the same dict shape as intent_router.route_intent() so the
existing pipeline (conversational_pacer → amina_agent) works unchanged.

Gate: USE_FOUR_LAYER_ROUTER env var (default false).
When false, falls through to the existing intent_router.route_intent().
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional, Set

logger = logging.getLogger(__name__)

_ENABLED = os.getenv("USE_FOUR_LAYER_ROUTER", "false").lower() == "true"


# ── Layer 2: Tool suppression map ────────────────────────────────────
#
# For each stance, which tools should be SUPPRESSED (not called).
# Tools not in the suppression set are available.
# "all" means suppress all tools — model answers from knowledge only.

_HEAVY_TOOLS = frozenset({
    "manage_diabetes", "manage_hypertension", "get_diet_advice",
    "counsel_lifestyle", "assess_triage", "get_medication_info",
    "create_care_plan",
})

_CLINICAL_TOOLS = frozenset({
    "manage_diabetes", "manage_hypertension", "get_diet_advice",
    "counsel_lifestyle", "get_medication_info", "create_care_plan",
})

TOOL_SUPPRESSION: Dict[str, frozenset] = {
    "social_ritual":                 _HEAVY_TOOLS,
    "emotional_disclosure":          _CLINICAL_TOOLS,
    "followup_continuation":         _HEAVY_TOOLS,
    "ambiguous_needs_clarification": frozenset({"all"}),
    "vitals_report":                 frozenset(),
    "clinical_question":             frozenset(),
    "information_seeking":           frozenset(),
    "family_carer_concern":          frozenset(),
    "medication_question":           frozenset(),
}

# Stance → special behaviors
STANCE_BEHAVIORS: Dict[str, Dict[str, Any]] = {
    "social_ritual": {
        "max_tokens_override": 200,
        "instruction_suffix": "Keep it warm and brief — this is social, not clinical.",
    },
    "emotional_disclosure": {
        "max_tokens_override": 400,
        "instruction_suffix": "Acknowledge the emotion FIRST. No clinical advice until they ask.",
    },
    "ambiguous_needs_clarification": {
        "max_tokens_override": 200,
        "instruction_suffix": "Ask ONE clarifying question to understand what they need. Do not guess.",
    },
    "followup_continuation": {
        "max_tokens_override": 300,
        "instruction_suffix": "",
    },
    "vitals_report": {
        "max_tokens_override": 400,
        "instruction_suffix": "",
    },
    "clinical_question": {
        "max_tokens_override": 400,
        "instruction_suffix": "",
    },
    "information_seeking": {
        "max_tokens_override": 500,
        "instruction_suffix": "Educational explanation — clear, factual, no jargon.",
    },
    "family_carer_concern": {
        "max_tokens_override": 400,
        "instruction_suffix": "They're asking about someone else's health. Acknowledge the caregiving burden.",
    },
    "medication_question": {
        "max_tokens_override": 400,
        "instruction_suffix": "",
    },
}


# ═══════════════════════════════════════════════════════════════════
# MAIN ROUTER PIPELINE
# ═══════════════════════════════════════════════════════════════════

async def route(
    message: str,
    is_first_turn: bool,
    session_id: str = "",
    emotional_register: str = "calm",
    patient_name: str = "",
    patient_id: str = "",
) -> Dict[str, Any]:
    """Four-layer classification pipeline.

    Returns the same shape as intent_router.route_intent():
    {
        "intent": str,
        "sub_intent": str|None,
        "prompt_instruction": str,
        "max_tokens_hint": int,
        "turn_type": str,
        "stripped_message": str,
        # Plus four-layer metadata:
        "stance": dict|None,
        "tool_suppression": list,
        "graph_match": dict|None,
        "layer_path": str,      # e.g. "L0" or "L0→L1→L2→L3"
    }
    """
    if not _ENABLED:
        from src.services.intent_router import route_intent
        result = route_intent(
            message=message,
            is_first_turn=is_first_turn,
            session_id=session_id,
            emotional_register=emotional_register,
            patient_name=patient_name,
            patient_id=patient_id,
        )
        result["stance"] = None
        result["tool_suppression"] = []
        result["graph_match"] = None
        result["layer_path"] = "L0"
        return result

    # ────────────────────────────────────────────────────────────────
    # LAYER 0: Fast deterministic filter
    # ────────────────────────────────────────────────────────────────
    from src.services.intent_router import (
        _strip_ack_prefix, _is_emergency, _is_goodbye, _is_short_ack,
        _classify_content, _make_result, _get_last_intent, _save_last_intent,
        _learner_lookup, _learner_record, INTENT_TOKEN_HINTS,
    )

    msg_lower = message.lower().strip()
    prev_intent = _get_last_intent(session_id) if session_id else None

    # L0 catches: emergency, goodbye, pure ack — no LLM needed
    l0_emergency = _is_emergency(msg_lower)
    l0_goodbye = _is_goodbye(msg_lower)
    l0_short_ack = _is_short_ack(msg_lower)

    if l0_emergency:
        intent = "emergency"
        _save_last_intent(session_id, intent)
        result = _make_result(intent, None, message, patient_name, prev_intent)
        _learner_record(message, message, intent, result["turn_type"], session_id, patient_id)
        result["stance"] = None
        result["tool_suppression"] = []
        result["graph_match"] = {"layer": "L0", "match": "emergency_keywords"}
        result["layer_path"] = "L0"
        logger.info(f"FOUR_LAYER L0=emergency msg={message[:60]}")
        return result

    if l0_goodbye:
        intent = "goodbye"
        _save_last_intent(session_id, intent)
        result = _make_result(intent, None, message, patient_name, prev_intent)
        _learner_record(message, message, intent, result["turn_type"], session_id, patient_id)
        result["stance"] = None
        result["tool_suppression"] = list(_HEAVY_TOOLS)
        result["graph_match"] = None
        result["layer_path"] = "L0"
        logger.info(f"FOUR_LAYER L0=goodbye msg={message[:60]}")
        return result

    if l0_short_ack:
        intent = "continuation"
        _save_last_intent(session_id, intent)
        result = _make_result(intent, None, message, patient_name, prev_intent)
        _learner_record(message, message, intent, result["turn_type"], session_id, patient_id)
        result["stance"] = None
        result["tool_suppression"] = list(_HEAVY_TOOLS)
        result["graph_match"] = None
        result["layer_path"] = "L0"
        logger.info(f"FOUR_LAYER L0=continuation msg={message[:60]}")
        return result

    # Strip ack prefix for downstream layers
    stripped, had_ack = _strip_ack_prefix(msg_lower)

    # Check learner corrections (same as intent_router Tier 2)
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
        result["stance"] = None
        result["tool_suppression"] = []
        result["graph_match"] = None
        result["layer_path"] = "L0_correction"
        logger.info(f"FOUR_LAYER L0_correction={corrected_intent} msg={stripped[:60]}")
        return result

    # ────────────────────────────────────────────────────────────────
    # LAYER 1: Conversational stance classifier
    # ────────────────────────────────────────────────────────────────
    from src.services.stance_classifier import classify_stance, STANCE_TO_INTENT

    stance_result = await classify_stance(
        message=stripped,
        session_id=session_id,
        is_first_turn=is_first_turn,
        prev_intent=prev_intent or "",
        layer0_intent="",
    )

    stance = stance_result.get("stance", "ambiguous_needs_clarification")
    stance_confidence = stance_result.get("confidence", 0.0)
    stance_mode = stance_result.get("_mode", "shadow")
    stance_urgency = stance_result.get("urgency", "routine")

    # ────────────────────────────────────────────────────────────────
    # LAYER 3: Knowledge-graph safety check (runs before L2 decision)
    # ────────────────────────────────────────────────────────────────
    from src.services.intent_pattern_graph import (
        check_emergency, check_drug_context, check_cultural_idiom,
        check_disambiguator,
    )

    graph_emergency = check_emergency(stripped)
    if graph_emergency:
        intent = "emergency"
        _save_last_intent(session_id, intent)
        result = _make_result(intent, None, stripped, patient_name, prev_intent)
        _learner_record(message, stripped, intent, result["turn_type"], session_id, patient_id)
        result["stance"] = stance_result
        result["tool_suppression"] = []
        result["graph_match"] = graph_emergency
        result["layer_path"] = "L0→L1→L3_emergency"
        logger.info(
            f"FOUR_LAYER L3_emergency pattern={graph_emergency.get('pattern','')} "
            f"stance_was={stance} msg={stripped[:60]}"
        )
        return result

    # Cultural idiom override
    cultural_match = check_cultural_idiom(stripped)
    if cultural_match and cultural_match.get("stance_override"):
        stance = cultural_match["stance_override"]
        if cultural_match.get("urgency"):
            stance_urgency = cultural_match["urgency"]
        logger.info(
            f"FOUR_LAYER L3_cultural override={stance} "
            f"pattern={cultural_match.get('pattern','')} msg={stripped[:60]}"
        )

    # Disambiguator override
    disambig_match = check_disambiguator(stripped)
    if disambig_match and disambig_match.get("stance_override"):
        if stance_confidence < 0.70:
            stance = disambig_match["stance_override"]
            if disambig_match.get("urgency"):
                stance_urgency = disambig_match["urgency"]
            logger.info(
                f"FOUR_LAYER L3_disambig override={stance} "
                f"confidence_was={stance_confidence:.2f} msg={stripped[:60]}"
            )

    # Drug context enrichment (doesn't override stance, adds metadata)
    drug_matches = check_drug_context(stripped)

    # ────────────────────────────────────────────────────────────────
    # LAYER 2: Stance-conditional tool selection + intent mapping
    # ────────────────────────────────────────────────────────────────

    # Determine final intent
    if stance_mode == "active":
        intent = STANCE_TO_INTENT.get(stance, "simple_question")
    else:
        # Shadow mode: use Layer 0 classification for actual routing
        sub_intent = _classify_content(stripped, is_first_turn)
        if had_ack and sub_intent in ("simple_question", "report", "emotional"):
            intent = "topic_shift"
        elif had_ack and sub_intent == "plan_request":
            intent = "plan_request"
        else:
            intent = sub_intent

    # Tool suppression
    suppressed_tools = TOOL_SUPPRESSION.get(stance, frozenset())
    if "all" in suppressed_tools:
        tool_list = ["all"]
    else:
        tool_list = list(suppressed_tools)

    # Stance behavior overrides
    behavior = STANCE_BEHAVIORS.get(stance, {})
    max_tokens = behavior.get("max_tokens_override", INTENT_TOKEN_HINTS.get(intent, 400))
    instruction_suffix = behavior.get("instruction_suffix", "")

    _save_last_intent(session_id, intent)
    result = _make_result(intent, None, stripped, patient_name, prev_intent)

    # Append stance-specific instruction
    if instruction_suffix and stance_mode == "active":
        result["prompt_instruction"] += "\n" + instruction_suffix

    if stance_mode == "active":
        result["max_tokens_hint"] = max_tokens

    _learner_record(message, stripped, intent, result["turn_type"], session_id, patient_id)

    result["stance"] = stance_result
    result["tool_suppression"] = tool_list
    result["graph_match"] = {
        "cultural": cultural_match,
        "drugs": [d.get("pattern", "") for d in drug_matches] if drug_matches else [],
        "disambig": disambig_match,
    }
    result["layer_path"] = f"L0→L1({stance})→L2→L3"

    logger.info(
        f"FOUR_LAYER result intent={intent} stance={stance} "
        f"confidence={stance_confidence:.2f} urgency={stance_urgency} "
        f"mode={stance_mode} tools_suppressed={len(tool_list)} "
        f"drugs={len(drug_matches)} msg={stripped[:60]}"
    )

    return result
