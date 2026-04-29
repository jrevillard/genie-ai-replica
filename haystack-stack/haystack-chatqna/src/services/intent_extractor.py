"""
Structured Intent Extraction — Gap 1 Bridge.

Replaces keyword-only intent classification with an LLM-powered
structured extraction step.  A small fast LLM call (~200ms) produces:

    {primary_intent, secondary_intents, entities,
     emotional_undertone, who_is_the_patient, urgency}

This drives tool routing, response shaping, and dialogue state —
replacing the regex-based classify_intention() for messages where
keyword matching is ambiguous.

Gate: settings.USE_LLM_INTENT_EXTRACTION (default false).
When false, every public function returns None and the pipeline
falls back to keyword-based classify_intention().

Architecture:
  1. Keyword fast-path confidence check (same heuristic as T2)
  2. If high confidence → return None (let keyword result stand)
  3. If low/medium → call small LLM for structured extraction
  4. Structured result feeds tool router, response shaper, state tracker
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Optional

from src.config import settings

logger = logging.getLogger(__name__)

_ENABLED = settings.USE_LLM_INTENT_EXTRACTION


# ── Intent taxonomy (richer than the 8 keyword categories) ─────────────

INTENT_CATEGORIES = [
    "EMERGENCY",
    "SYMPTOM_REPORT",
    "DIABETES_CONCERN",
    "HYPERTENSION_CONCERN",
    "RESPIRATORY_CONCERN",
    "CANCER_CONCERN",
    "MEDICATION_QUESTION",
    "DIET_NUTRITION",
    "FACILITY_SEARCH",
    "RAMADAN_FASTING",
    "CVD_RISK",
    "LIFESTYLE_CHANGE",
    "VITAL_REPORT",
    "CARE_PLAN_REQUEST",
    "MENTAL_HEALTH",
    "SEEKING_INFO",
    "ROUTINE_CHECKIN",
    "GREETING",
    "FAREWELL",
    "GRATITUDE",
    "AFFIRMATIVE",
    "NEGATIVE",
    "CHITCHAT",
    "HEALTH_GENERAL",
]

URGENCY_LEVELS = ["critical", "high", "moderate", "low", "none"]

WHO_IS_PATIENT = ["self", "family_member", "other_person", "general_inquiry"]

EMOTIONAL_UNDERTONES = [
    "scared", "worried", "frustrated", "resigned", "calm",
    "hopeful", "grateful", "confused", "angry", "neutral",
]

# Map structured intents → tool names (for downstream routing)
INTENT_TO_TOOLS: Dict[str, List[str]] = {
    "EMERGENCY": ["assess_triage"],
    "SYMPTOM_REPORT": ["assess_triage"],
    "DIABETES_CONCERN": ["manage_diabetes", "search_knowledge"],
    "HYPERTENSION_CONCERN": ["manage_hypertension", "search_knowledge"],
    "RESPIRATORY_CONCERN": ["assess_respiratory", "search_knowledge"],
    "CANCER_CONCERN": ["screen_cancer", "search_knowledge"],
    "MEDICATION_QUESTION": ["get_medication_info", "search_knowledge"],
    "DIET_NUTRITION": ["get_diet_advice"],
    "FACILITY_SEARCH": ["find_facility"],
    "RAMADAN_FASTING": ["check_ramadan"],
    "CVD_RISK": ["assess_cvd_risk", "search_knowledge"],
    "LIFESTYLE_CHANGE": ["counsel_lifestyle"],
    "VITAL_REPORT": ["record_vitals"],
    "CARE_PLAN_REQUEST": ["generate_care_plan"],
    "MENTAL_HEALTH": ["suggest_community_support", "search_knowledge"],
    "SEEKING_INFO": ["search_knowledge"],
    "ROUTINE_CHECKIN": ["record_vitals"],
    "HEALTH_GENERAL": ["search_knowledge"],
}

# Map structured intents → legacy intention categories (for greeting.py compat)
INTENT_TO_LEGACY: Dict[str, str] = {
    "EMERGENCY": "EMERGENCY",
    "SYMPTOM_REPORT": "IN_PAIN",
    "DIABETES_CONCERN": "HEALTH_GENERAL",
    "HYPERTENSION_CONCERN": "HEALTH_GENERAL",
    "RESPIRATORY_CONCERN": "HEALTH_GENERAL",
    "CANCER_CONCERN": "HEALTH_GENERAL",
    "MEDICATION_QUESTION": "SEEKING_INFO",
    "DIET_NUTRITION": "SEEKING_INFO",
    "FACILITY_SEARCH": "HEALTH_GENERAL",
    "RAMADAN_FASTING": "HEALTH_GENERAL",
    "CVD_RISK": "HEALTH_GENERAL",
    "LIFESTYLE_CHANGE": "HEALTH_GENERAL",
    "VITAL_REPORT": "ROUTINE_CHECKIN",
    "CARE_PLAN_REQUEST": "HEALTH_GENERAL",
    "MENTAL_HEALTH": "LONELY",
    "SEEKING_INFO": "SEEKING_INFO",
    "ROUTINE_CHECKIN": "ROUTINE_CHECKIN",
    "GREETING": "HEALTH_GENERAL",
    "FAREWELL": "HEALTH_GENERAL",
    "GRATITUDE": "HEALTH_GENERAL",
    "AFFIRMATIVE": "HEALTH_GENERAL",
    "NEGATIVE": "HEALTH_GENERAL",
    "CHITCHAT": "HEALTH_GENERAL",
    "HEALTH_GENERAL": "HEALTH_GENERAL",
}


# ── Confidence heuristic (should we even call the LLM?) ───────────────

def _needs_llm_extraction(message: str, keyword_intention: str) -> bool:
    """Decide if the message needs LLM intent extraction or if
    keyword classification is good enough."""
    msg = message.lower().strip()
    words = msg.split()
    word_count = len(words)

    # Short messages with clear keyword match — trust keywords
    if word_count <= 5 and keyword_intention != "HEALTH_GENERAL":
        return False

    # Affirmatives / chitchat — never need LLM
    if msg in {
        "yes", "yeah", "yea", "yep", "ok", "okay", "sure", "alright",
        "no", "nah", "nope", "not really", "thanks", "thank you",
        "bye", "goodbye",
    }:
        return False

    # Greetings — don't need LLM
    if any(g in msg for g in [
        "salaam", "hello", "hi ", "hey ", "good morning",
        "good afternoon", "good evening",
    ]) and word_count <= 6:
        return False

    # HEALTH_GENERAL with >5 words = keyword couldn't classify → LLM needed
    if keyword_intention == "HEALTH_GENERAL" and word_count > 5:
        return True

    # Third-person references that keywords might miss
    third_party = [
        "my mother", "my father", "my child", "my husband", "my wife",
        "my grandmother", "my son", "my daughter", "she ", "he ",
        "her ", "him ", "they ",
    ]
    if any(cue in msg for cue in third_party):
        return True

    # Long complex message — keyword may have caught the wrong thing
    if word_count > 15:
        return True

    # Emotional language that changes meaning
    emotional_cues = [
        "scared", "afraid", "terrified", "don't know what to do",
        "feel like", "can't stop", "won't stop", "getting worse",
        "never had this", "first time", "should i worry",
    ]
    if any(cue in msg for cue in emotional_cues):
        return True

    return False


# ── LLM extraction prompt ─────────────────────────────────────────────

_EXTRACTION_PROMPT = """You are an intent classifier for AMINA, a Gambian healthcare agent. Extract structured intent from the patient message.

PATIENT MESSAGE: "{message}"

PATIENT CONTEXT:
- Name: {patient_name}
- Known conditions: {conditions}
- Current medications: {medications}

{dialogue_state_section}

INTENT CATEGORIES (pick 1 primary, 0-2 secondary):
{intent_list}

Return ONLY valid JSON:
{{
  "primary_intent": "CATEGORY_NAME",
  "secondary_intents": ["CATEGORY_2"],
  "entities": [
    {{"type": "person|condition|medication|symptom|number|facility", "value": "extracted text", "relation": "self|mother|father|child|spouse|other"}}
  ],
  "emotional_undertone": "scared|worried|frustrated|resigned|calm|hopeful|grateful|confused|angry|neutral",
  "who_is_the_patient": "self|family_member|other_person|general_inquiry",
  "urgency": "critical|high|moderate|low|none",
  "reasoning": "one sentence why"
}}

RULES:
1. "My mother's sugar has been climbing" → primary=DIABETES_CONCERN, who=family_member, entities=[person:mother, condition:diabetes]
2. "I'm scared about the thing the nurse told me" → primary=SEEKING_INFO, emotional=scared, urgency=moderate
3. If patient describes symptoms → SYMPTOM_REPORT (not HEALTH_GENERAL)
4. If patient mentions someone else → who_is_the_patient=family_member, add person entity
5. Urgency: chest pain/can't breathe/collapse = critical. Pain/fever = high. Worry = moderate. Info-seeking = low.
6. Emotional undertone: listen for fear, frustration, resignation — not just keywords but tone.

JSON:"""


# ── Model call ─────────────────────────────────────────────────────────

async def _call_extraction_model(prompt: str) -> Optional[Dict[str, Any]]:
    """Call a fast model for intent extraction. Gemini → Groq → GPT-4o-mini."""
    from openai import AsyncOpenAI

    clients = []

    if settings.GOOGLE_API_KEY:
        clients.append((
            AsyncOpenAI(api_key=settings.GOOGLE_API_KEY, base_url=settings.GEMINI_BASE_URL),
            "gemini-2.0-flash-lite",
            "gemini",
        ))

    if settings.GROQ_API_KEY:
        clients.append((
            AsyncOpenAI(api_key=settings.GROQ_API_KEY, base_url=settings.GROQ_BASE_URL),
            settings.GROQ_MODEL,
            "groq",
        ))

    if settings.OPENAI_API_KEY:
        clients.append((
            AsyncOpenAI(api_key=settings.OPENAI_API_KEY, base_url=settings.OPENAI_BASE_URL),
            "gpt-4o-mini",
            "openai",
        ))

    for client, model, provider in clients:
        try:
            completion = await client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.0,
                max_tokens=300,
            )
            text = (completion.choices[0].message.content or "").strip()
            if text.startswith("```"):
                text = re.sub(r"^```(?:json)?\s*", "", text)
                text = re.sub(r"```\s*$", "", text)
            result = json.loads(text)
            logger.debug(f"intent_extractor: extracted via {provider}/{model}")
            return result
        except Exception as e:
            logger.warning(f"intent_extractor: {provider} call failed: {e}")
            continue

    logger.error("intent_extractor: all model providers failed")
    return None


# ── Validation ─────────────────────────────────────────────────────────

_VALID_INTENTS = set(INTENT_CATEGORIES)
_VALID_URGENCY = set(URGENCY_LEVELS)
_VALID_WHO = set(WHO_IS_PATIENT)
_VALID_EMOTIONAL = set(EMOTIONAL_UNDERTONES)


def _validate_extraction(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Sanitise LLM output — clamp to valid enums, cap list lengths."""
    primary = raw.get("primary_intent", "HEALTH_GENERAL")
    if primary not in _VALID_INTENTS:
        primary = "HEALTH_GENERAL"

    secondary = [s for s in raw.get("secondary_intents", []) if s in _VALID_INTENTS]
    secondary = secondary[:2]

    entities = raw.get("entities", [])
    if isinstance(entities, list):
        entities = entities[:10]
    else:
        entities = []

    emotional = raw.get("emotional_undertone", "neutral")
    if emotional not in _VALID_EMOTIONAL:
        emotional = "neutral"

    who = raw.get("who_is_the_patient", "self")
    if who not in _VALID_WHO:
        who = "self"

    urgency = raw.get("urgency", "low")
    if urgency not in _VALID_URGENCY:
        urgency = "low"

    return {
        "primary_intent": primary,
        "secondary_intents": secondary,
        "entities": entities,
        "emotional_undertone": emotional,
        "who_is_the_patient": who,
        "urgency": urgency,
        "reasoning": str(raw.get("reasoning", ""))[:200],
    }


# ── Public API ─────────────────────────────────────────────────────────

async def extract_intent(
    message: str,
    keyword_intention: str,
    patient_context: Any = None,
    dialogue_state: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """Extract structured intent from a patient message.

    Returns None when:
      - Flag is off
      - Keyword classification is confident enough
      - LLM call fails

    When None is returned, the caller should fall back to keyword intent.
    """
    if not _ENABLED:
        return None

    if not _needs_llm_extraction(message, keyword_intention):
        logger.debug(f"intent_extractor: keyword confidence sufficient for '{keyword_intention}'")
        return None

    # Build prompt
    pc = patient_context
    conditions = "none known"
    medications = "none known"
    patient_name = "unknown"

    if pc:
        if hasattr(pc, "conditions") and pc.conditions:
            conditions = ", ".join(pc.conditions)
        if hasattr(pc, "medications") and pc.medications:
            medications = ", ".join(
                m.get("name", str(m)) if isinstance(m, dict) else str(m)
                for m in pc.medications
            )
        patient_name = getattr(pc, "name", "") or "unknown"

    ds_section = ""
    if dialogue_state:
        ds_parts = []
        if dialogue_state.get("active_topic"):
            ds_parts.append(f"Active topic: {dialogue_state['active_topic']}")
        if dialogue_state.get("subject") == "other_person":
            ds_parts.append(f"Subject: {dialogue_state.get('subject_description', 'someone else')}")
        if dialogue_state.get("current_register") and dialogue_state["current_register"] != "calm":
            ds_parts.append(f"Emotional register: {dialogue_state['current_register']}")
        if ds_parts:
            ds_section = "DIALOGUE STATE:\n" + "\n".join(ds_parts)

    prompt = _EXTRACTION_PROMPT.format(
        message=message[:500],
        patient_name=patient_name,
        conditions=conditions,
        medications=medications,
        dialogue_state_section=ds_section or "DIALOGUE STATE: (not available)",
        intent_list=", ".join(INTENT_CATEGORIES),
    )

    raw = await _call_extraction_model(prompt)
    if not raw:
        return None

    result = _validate_extraction(raw)

    logger.info(
        f"intent_extractor: {result['primary_intent']} "
        f"(urgency={result['urgency']}, who={result['who_is_the_patient']}, "
        f"emotional={result['emotional_undertone']})"
    )

    return result


def get_tools_for_intent(extraction: Dict[str, Any]) -> List[str]:
    """Map extracted intent to suggested tool list."""
    if not extraction:
        return []

    tools = list(INTENT_TO_TOOLS.get(extraction["primary_intent"], []))

    for secondary in extraction.get("secondary_intents", []):
        for t in INTENT_TO_TOOLS.get(secondary, []):
            if t not in tools:
                tools.append(t)

    # Emergency urgency overrides everything
    if extraction.get("urgency") == "critical" and "assess_triage" not in tools:
        tools.insert(0, "assess_triage")

    return tools[:3]


def get_legacy_intention(extraction: Dict[str, Any]) -> str:
    """Map structured intent to legacy intention category for greeting.py compat."""
    if not extraction:
        return "HEALTH_GENERAL"

    primary = extraction.get("primary_intent", "HEALTH_GENERAL")

    # Override for third-person context
    if extraction.get("who_is_the_patient") == "family_member":
        return "WORRIED_ABOUT_OTHER"

    return INTENT_TO_LEGACY.get(primary, "HEALTH_GENERAL")


def render_intent_for_prompt(extraction: Dict[str, Any]) -> str:
    """Render extracted intent as a compact prompt block (~100 tokens)."""
    if not extraction:
        return ""

    parts = [f"[Intent Analysis]"]
    parts.append(f"Primary: {extraction['primary_intent']}")

    if extraction.get("secondary_intents"):
        parts.append(f"Also: {', '.join(extraction['secondary_intents'])}")

    if extraction.get("who_is_the_patient") != "self":
        parts.append(f"Subject: {extraction['who_is_the_patient']}")

    if extraction.get("emotional_undertone") != "neutral":
        parts.append(f"Emotional tone: {extraction['emotional_undertone']}")

    if extraction.get("urgency") in ("critical", "high"):
        parts.append(f"Urgency: {extraction['urgency']}")

    entities = extraction.get("entities", [])
    if entities:
        entity_strs = []
        for e in entities[:5]:
            if isinstance(e, dict):
                entity_strs.append(f"{e.get('type', '?')}: {e.get('value', '?')}")
        if entity_strs:
            parts.append(f"Entities: {', '.join(entity_strs)}")

    return "\n".join(parts)
