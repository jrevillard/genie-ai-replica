"""
AMINA v2.0 — Tier 2: Intelligence Upgrade

#5 Real-Time Empathy Engine
#6 Assertiveness Calibration
#7 Multi-Turn Reasoning (complex cases)

Replaces the v1.0 keyword-based emotion detection with a multi-dimensional
emotional state classifier that adapts dynamically throughout the conversation.

Architecture:
  1. classify_emotional_state() — fast heuristic classifier (<2ms)
     Returns structured emotional state, not just a boolean flag.

  2. calibrate_assertiveness() — computes tone level (1-5) based on:
     - Patient's emotional state
     - Adherence history (from behavior profile)
     - Trust tier (stranger→family)
     - Clinical urgency
     - Conversation turn count

  3. build_reasoning_chain() — for complex cases (multi-condition, pregnancy)
     Generates structured clinical reasoning steps for the LLM.

  4. build_empathy_instruction() — synthesizes all signals into a precise
     prompt instruction for the LLM (replaces the old static emotional block).
"""

import re
import logging
from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime

logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════
# #5 REAL-TIME EMPATHY ENGINE
# Multi-dimensional emotional state classifier
# ══════════════════════════════════════════════════════════════

# Emotion categories with weighted keyword signals
_EMOTION_SIGNALS = {
    "fear": {
        "keywords": ["scared", "afraid", "terrified", "fear", "panic", "worried about dying",
                     "am i going to die", "will i die", "is it serious", "is it cancer",
                     "worst case", "what if"],
        "weight": 1.0,
    },
    "shame": {
        "keywords": ["ashamed", "embarrassed", "shy", "stigma", "people will think",
                     "don't want anyone to know", "cant tell my husband", "hide",
                     "what will people say", "judgment", "secret"],
        "weight": 0.9,
    },
    "grief": {
        "keywords": ["lost", "died", "passed away", "miss", "gone", "funeral",
                     "since my wife", "since my husband", "since my mother",
                     "they left me", "alone now"],
        "weight": 0.9,
    },
    "overwhelm": {
        "keywords": ["overwhelmed", "too much", "cant cope", "can't cope",
                     "don't know what to do", "dont know what to do",
                     "everything at once", "too many", "giving up",
                     "tired of this", "exhausted", "no energy"],
        "weight": 0.8,
    },
    "denial": {
        "keywords": ["i'm fine", "nothing wrong", "don't need", "dont need",
                     "not sick", "it will pass", "just tired", "overreacting",
                     "doctor is wrong", "don't believe", "dont believe",
                     "traditional medicine will cure"],
        "weight": 0.7,
    },
    "sadness": {
        "keywords": ["sad", "depressed", "lonely", "hopeless", "cry", "crying",
                     "no point", "worthless", "burden", "empty",
                     "dont care anymore", "don't care anymore"],
        "weight": 0.8,
    },
    "frustration": {
        "keywords": ["frustrated", "angry", "annoyed", "fed up", "sick of",
                     "waste of time", "not working", "useless", "stupid",
                     "why isn't", "already told you", "same thing again"],
        "weight": 0.6,
    },
    "anxiety": {
        "keywords": ["anxious", "nervous", "worry", "worried", "stress", "stressed",
                     "cant sleep", "can't sleep", "racing heart", "shaking",
                     "what will happen", "future"],
        "weight": 0.7,
    },
    "hope": {
        "keywords": ["better", "improving", "hopeful", "trying", "i can do this",
                     "progress", "thank god", "alhamdulillah", "inshallah",
                     "getting better", "good news"],
        "weight": 0.3,  # Low weight — positive, not distress
    },
    "determination": {
        "keywords": ["i will", "i want to", "help me", "teach me", "show me how",
                     "ready to", "let's do this", "committed", "i promise"],
        "weight": 0.2,
    },
}

# Linguistic markers that amplify emotional signals
_INTENSITY_MARKERS = {
    "amplifiers": ["very", "really", "so", "extremely", "terribly", "deeply",
                   "completely", "absolutely", "seriously", "desperately"],
    "urgency": ["now", "right now", "immediately", "please help", "urgent",
                "emergency", "quickly", "hurry"],
    "repetition_threshold": 2,  # Same emotion word repeated = amplified
    "caps_threshold": 0.4,      # >40% caps = shouting/distress
    "exclamation_threshold": 2, # 2+ exclamation marks = heightened
}


def classify_emotional_state(
    message: str,
    conversation_history: list = None,
    patient_context: dict = None,
) -> Dict[str, Any]:
    """Multi-dimensional emotional state classifier.

    Returns a structured emotional state, not just a boolean.
    Runs in <2ms — no LLM, pure heuristic with weighted scoring.

    Returns:
      {
        "primary_emotion": "fear" | "shame" | "grief" | ... | None,
        "secondary_emotion": ...,
        "intensity": 0.0-1.0,
        "distress_level": "none" | "mild" | "moderate" | "severe" | "crisis",
        "emotional_trajectory": "escalating" | "stable" | "de-escalating" | "new",
        "needs_empathy_first": True/False,
        "suggested_opener": "...",
        "suppress_clinical": True/False (if True, skip health questions this turn),
      }
    """
    msg = message.lower().strip()
    result = {
        "primary_emotion": None,
        "secondary_emotion": None,
        "intensity": 0.0,
        "distress_level": "none",
        "emotional_trajectory": "new",
        "needs_empathy_first": False,
        "suggested_opener": None,
        "suppress_clinical": False,
    }

    if not msg:
        return result

    # Score each emotion category
    scores = {}
    for emotion, config in _EMOTION_SIGNALS.items():
        matches = sum(1 for kw in config["keywords"] if kw in msg)
        if matches > 0:
            scores[emotion] = matches * config["weight"]

    if not scores:
        return result

    # Sort by score
    ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    result["primary_emotion"] = ranked[0][0]
    if len(ranked) > 1 and ranked[1][1] > 0.3:
        result["secondary_emotion"] = ranked[1][0]

    # Compute intensity (0-1)
    base_intensity = min(1.0, ranked[0][1] / 3.0)

    # Amplifiers boost intensity
    amplifier_count = sum(1 for a in _INTENSITY_MARKERS["amplifiers"] if a in msg)
    urgency_count = sum(1 for u in _INTENSITY_MARKERS["urgency"] if u in msg)
    caps_ratio = sum(1 for c in message if c.isupper()) / max(len(message), 1)
    exclamation_count = message.count("!")

    intensity = base_intensity
    intensity += amplifier_count * 0.1
    intensity += urgency_count * 0.15
    if caps_ratio > _INTENSITY_MARKERS["caps_threshold"]:
        intensity += 0.2
    if exclamation_count >= _INTENSITY_MARKERS["exclamation_threshold"]:
        intensity += 0.1
    intensity = min(1.0, intensity)
    result["intensity"] = round(intensity, 2)

    # Distress level
    if intensity < 0.2:
        result["distress_level"] = "none"
    elif intensity < 0.4:
        result["distress_level"] = "mild"
    elif intensity < 0.7:
        result["distress_level"] = "moderate"
        result["needs_empathy_first"] = True
    elif intensity < 0.9:
        result["distress_level"] = "severe"
        result["needs_empathy_first"] = True
    else:
        result["distress_level"] = "crisis"
        result["needs_empathy_first"] = True
        result["suppress_clinical"] = True  # This turn: ONLY emotional support

    # Emotional trajectory (compared to previous messages)
    if conversation_history:
        prev_emotions = []
        for m in conversation_history[-4:]:
            if m.get("role") == "user":
                prev_state = classify_emotional_state(m.get("content", ""))
                if prev_state.get("primary_emotion"):
                    prev_emotions.append(prev_state["intensity"])
        if prev_emotions:
            avg_prev = sum(prev_emotions) / len(prev_emotions)
            if intensity > avg_prev + 0.2:
                result["emotional_trajectory"] = "escalating"
            elif intensity < avg_prev - 0.2:
                result["emotional_trajectory"] = "de-escalating"
            else:
                result["emotional_trajectory"] = "stable"

    # Generate suggested opener based on emotion type
    result["suggested_opener"] = _get_empathy_opener(
        result["primary_emotion"], result["intensity"], result["distress_level"],
        patient_context,
    )

    return result


def _get_empathy_opener(emotion: str, intensity: float, level: str, patient_ctx: dict = None) -> Optional[str]:
    """Generate a culturally appropriate empathy opener for the detected emotion."""
    name = ""
    if patient_ctx and patient_ctx.get("name"):
        name = patient_ctx["name"].split()[0]  # First name only

    openers = {
        "fear": {
            "mild": f"{'I understand your concern, ' + name + '. ' if name else ''}It is natural to feel worried.",
            "moderate": f"{'I hear you, ' + name + '. ' if name else ''}What you are feeling is completely normal. Many people feel the same way.",
            "severe": f"{'I am here with you, ' + name + '. ' if name else ''}I can hear this is frightening. Let us face this together, one step at a time.",
            "crisis": f"{'Stay with me, ' + name + '. ' if name else ''}You are not alone right now. I am here.",
        },
        "shame": {
            "mild": "Thank you for trusting me with this. There is no judgment here.",
            "moderate": f"{'Thank you for sharing this, ' + name + '. ' if name else ''}What you feel is more common than you think. You are brave for speaking up.",
            "severe": "I respect your courage in telling me this. Nothing you say will leave this conversation. You are safe here.",
        },
        "grief": {
            "mild": "I am sorry for what you have been through.",
            "moderate": f"{'I am sorry, ' + name + '. ' if name else ''}Grief takes time, and it is okay to feel this way.",
            "severe": f"{'I am so sorry, ' + name + '. ' if name else ''}Your loss is real and your pain matters. There is no rush. Take your time.",
        },
        "overwhelm": {
            "mild": "I understand there is a lot going on. Let us take it one thing at a time.",
            "moderate": f"{'I hear you, ' + name + '. ' if name else ''}It is okay to feel overwhelmed. We do not need to solve everything today. Just one small step.",
            "severe": "You do not need to carry all of this alone. Let us focus on just one thing right now — the most important one.",
        },
        "denial": {
            "mild": "I understand. Everyone processes health information differently.",
            "moderate": "I hear you. Your feelings are valid. When you are ready, I am here to help you understand what is happening.",
        },
        "sadness": {
            "mild": f"{'I hear you, ' + name + '. ' if name else ''}Your feelings are important.",
            "moderate": "What you are feeling matters. You are not a burden, and you are not alone in this.",
            "severe": f"{'I am here for you, ' + name + '. ' if name else ''}It takes real strength to share what you are going through. I am listening.",
        },
        "frustration": {
            "mild": "I understand this can be frustrating.",
            "moderate": "Your frustration is valid. Let me try a different approach that might help more.",
        },
        "anxiety": {
            "mild": "It is natural to feel this way.",
            "moderate": f"{'I understand, ' + name + '. ' if name else ''}Worrying shows you care about your health. Let us work through this together.",
            "severe": "Take a slow breath with me. In through your nose, out through your mouth. You are safe right now.",
        },
    }

    emotion_openers = openers.get(emotion, {})
    return emotion_openers.get(level) or emotion_openers.get("mild")


# ══════════════════════════════════════════════════════════════
# #6 ASSERTIVENESS CALIBRATION
# Dynamic tone scale: 1 (gentle) → 5 (firm)
# ══════════════════════════════════════════════════════════════


def calibrate_assertiveness(
    emotional_state: Dict[str, Any],
    patient_context: dict = None,
    behavior_profile: dict = None,
    trust_tier: str = "stranger",
    conversation_turn: int = 0,
    tools_used: list = None,
) -> Dict[str, Any]:
    """Compute dynamic assertiveness level for this response.

    Returns:
      {
        "level": 1-5,
        "label": "gentle" | "supportive" | "balanced" | "direct" | "firm",
        "tone_instruction": "specific instruction for the LLM",
        "word_limit_adjust": 0 (no change) | -20 (shorter) | +30 (longer),
      }

    Calibration factors:
      - Emotional distress → lower assertiveness (be gentle)
      - Adherence history: patient skips meds → higher (be firm)
      - Trust tier: stranger → gentle, family → can be direct
      - Clinical urgency: emergency → firm regardless
      - Conversation depth: early turns → gentle, later → can be direct
    """
    level = 3  # Default: balanced
    factors = []

    # Factor 1: Emotional state (strongest signal)
    distress = emotional_state.get("distress_level", "none")
    if distress == "crisis":
        level = 1
        factors.append("crisis-level distress → maximum gentleness")
    elif distress == "severe":
        level = max(1, level - 2)
        factors.append("severe distress → very gentle")
    elif distress == "moderate":
        level = max(2, level - 1)
        factors.append("moderate distress → gentle")
    elif emotional_state.get("primary_emotion") == "denial":
        level = min(4, level + 1)
        factors.append("denial detected → slightly more direct")
    elif emotional_state.get("primary_emotion") == "determination":
        level = min(4, level + 1)
        factors.append("determination → match their energy, be direct")

    # Factor 2: Adherence history
    if behavior_profile:
        adherence_rate = behavior_profile.get("adherence_rate", 0.5)
        tendency = behavior_profile.get("adherence_tendency", "")
        if adherence_rate < 0.3 or "needs encouragement" in tendency:
            level = max(level, 4)
            factors.append(f"low adherence ({adherence_rate:.0%}) → firm encouragement")
        elif adherence_rate > 0.7:
            level = min(level, 3)
            factors.append("good adherence → keep balanced, supportive")

    # Factor 3: Trust tier
    trust_adjust = {"stranger": -1, "acquaintance": 0, "companion": 0, "family": 1}
    level += trust_adjust.get(trust_tier, 0)
    if trust_tier == "stranger":
        factors.append("new patient → extra gentle, build trust")
    elif trust_tier == "family":
        factors.append("trusted relationship → can be direct")

    # Factor 4: Clinical urgency
    if tools_used and any(t in (tools_used or []) for t in ["check_emergency", "assess_triage"]):
        level = max(level, 4)
        factors.append("clinical urgency → be directive")

    # Factor 5: Conversation depth
    if conversation_turn <= 1:
        level = min(level, 3)
        factors.append("first interaction → build rapport first")
    elif conversation_turn > 6:
        level = min(level + 1, 5)
        factors.append("deep conversation → can be more direct")

    # Clamp to 1-5
    level = max(1, min(5, level))

    labels = {1: "gentle", 2: "supportive", 3: "balanced", 4: "direct", 5: "firm"}
    label = labels[level]

    # Generate tone instruction
    instructions = {
        1: ("Use the GENTLEST possible tone. Short sentences. No questions that feel like pressure. "
            "Acknowledge feelings first. 'It is okay.' 'You are safe.' 'Take your time.' "
            "Do NOT ask about medications, diet, or exercise this turn. Just be present."),
        2: ("Use a WARM, SUPPORTIVE tone. Lead with empathy. Ask at most ONE gentle question. "
            "No lists. No clinical jargon. Speak like a trusted auntie, not a health worker."),
        3: ("Use your normal balanced CHW tone. Warm but practical. "
            "One piece of advice + one question. Direct but caring."),
        4: ("Use a DIRECT tone. Be matter-of-fact. This patient needs clear guidance. "
            "State the action clearly: 'You need to...' 'It is important that you...' "
            "Acknowledge their situation briefly, then focus on the action."),
        5: ("Use a FIRM, AUTHORITATIVE tone. This patient has not followed advice before "
            "or the situation is clinically urgent. Be compassionate but unambiguous. "
            "'I need you to understand: this is serious.' 'Your health depends on this.' "
            "No hedging. No 'maybe'. State what needs to happen."),
    }

    word_adjust = {1: -20, 2: -10, 3: 0, 4: 0, 5: +10}

    return {
        "level": level,
        "label": label,
        "tone_instruction": instructions[level],
        "word_limit_adjust": word_adjust[level],
        "factors": factors,
    }


# ══════════════════════════════════════════════════════════════
# #7 MULTI-TURN REASONING
# Chain-of-thought for complex clinical cases
# ══════════════════════════════════════════════════════════════


def should_use_reasoning(
    message: str,
    patient_context: dict = None,
) -> bool:
    """Determine if this case needs structured clinical reasoning.

    Complex cases include:
    - Multiple conditions (diabetes + hypertension + pregnancy)
    - Medication interactions (multiple drugs)
    - Pregnancy with NCD
    - Conflicting symptoms
    - Ramadan fasting with medication
    """
    msg = message.lower()
    conditions = []
    if patient_context:
        conditions = patient_context.get("conditions", [])
        if isinstance(conditions, str):
            try:
                import json
                conditions = json.loads(conditions)
            except Exception:
                conditions = []

    # Multi-condition patient
    if len(conditions) >= 2:
        return True

    # Pregnancy + any NCD
    if any(w in msg for w in ["pregnant", "pregnancy", "expecting", "baby"]):
        if conditions or any(w in msg for w in ["diabetes", "hypertension", "bp", "sugar", "asthma"]):
            return True

    # Multiple medications mentioned
    med_count = sum(1 for m in ["metformin", "amlodipine", "insulin", "gliclazide",
                                 "salbutamol", "enalapril", "losartan", "aspirin",
                                 "simvastatin"] if m in msg)
    if med_count >= 2:
        return True

    # Ramadan + medication
    if any(w in msg for w in ["ramadan", "fasting", "fast"]):
        if any(w in msg for w in ["medicine", "medication", "pill", "tablet", "metformin", "insulin"]):
            return True

    # Conflicting symptoms
    conflict_pairs = [
        (["chest pain", "short of breath"], ["exercise", "walk"]),
        (["dizzy", "faint"], ["stand", "walk"]),
        (["sugar low", "hypoglycemia"], ["fast", "skip meal"]),
    ]
    for symptoms, triggers in conflict_pairs:
        if any(s in msg for s in symptoms) and any(t in msg for t in triggers):
            return True

    return False


def build_reasoning_chain(
    message: str,
    patient_context: dict = None,
    tools_results: list = None,
) -> str:
    """Build a structured clinical reasoning prompt for complex cases.

    This prepends a step-by-step reasoning framework to the LLM prompt,
    ensuring it considers all relevant factors before responding.
    """
    conditions = []
    medications = []
    if patient_context:
        conditions = patient_context.get("conditions", [])
        medications = patient_context.get("medications", [])
        if isinstance(conditions, str):
            try:
                import json
                conditions = json.loads(conditions)
            except Exception:
                conditions = []
        if isinstance(medications, str):
            try:
                import json
                medications = json.loads(medications)
            except Exception:
                medications = []

    med_names = []
    for m in medications:
        if isinstance(m, dict):
            med_names.append(m.get("name", ""))
        elif isinstance(m, str):
            med_names.append(m)

    reasoning = [
        "COMPLEX CASE — USE STRUCTURED CLINICAL REASONING:",
        "",
        "Before responding, think through these steps internally:",
        f"1. CONDITIONS: Patient has {', '.join(conditions) if conditions else 'unknown conditions'}",
        f"2. MEDICATIONS: Currently on {', '.join(med_names) if med_names else 'unknown medications'}",
        f"3. QUESTION: Patient is asking about: {message[:200]}",
        "",
        "REASONING STEPS:",
        "  a) What is the PRIMARY concern in this message?",
        "  b) How do their CONDITIONS interact with this concern?",
        "  c) Are there any MEDICATION considerations (timing, interactions, contraindications)?",
        "  d) Is there a SAFETY risk I need to address first?",
        "  e) What is the ONE most important thing to tell them?",
        "  f) What follow-up question will help me understand their situation better?",
        "",
        "IMPORTANT: Do NOT show your reasoning to the patient. Give them a clear,",
        "simple answer based on your analysis. ONE point. Gambian CHW language.",
    ]

    return "\n".join(reasoning)


# ══════════════════════════════════════════════════════════════
# SYNTHESIZE — combines all signals into a single prompt block
# ══════════════════════════════════════════════════════════════


# ══════════════════════════════════════════════════════════════
# CONVERSATION INTENT CLASSIFIER
# Detects: CLOSING / CONTINUING / ESCALATING / REDIRECTING
# Uses multi-signal analysis, not just keywords
# ══════════════════════════════════════════════════════════════


def classify_conversation_intent(
    message: str,
    conversation_history: list = None,
    behavior_profile: dict = None,
    turn_count: int = 0,
) -> Dict[str, Any]:
    """Classify whether the patient is closing, continuing, escalating, or redirecting.

    Multi-signal approach (not just keywords):
      1. Explicit closing words ("thanks", "bye")
      2. Commitment language ("I'll try", "let me do that")
      3. Conversation depth (6+ turns + short reply = likely closing)
      4. Message brevity (< 5 words after advice = likely closing)
      5. Learned patient pattern (from behavior profile)
      6. Tone shift (was asking detailed questions, now short = closing)

    Returns:
      {
        "intent": "closing" | "continuing" | "escalating" | "redirecting",
        "confidence": 0.0-1.0,
        "closing_instruction": "..." (if closing),
      }
    """
    msg = message.lower().strip()
    words = msg.split()
    word_count = len(words)
    result = {"intent": "continuing", "confidence": 0.5, "closing_instruction": ""}

    closing_score = 0.0
    signals = []

    # Signal 1: Explicit closing words (strong signal)
    explicit_closers = ["thanks", "thank you", "goodbye", "bye", "bye bye",
                        "okay thanks", "ok thanks", "thats all", "that's all",
                        "nothing else", "im done", "i'm done", "see you",
                        "take care", "good night", "good bye"]
    if any(c in msg for c in explicit_closers):
        closing_score += 0.4
        signals.append("explicit_closing_word")

    # Signal 2: Commitment + gratitude (strong closing signal)
    commitment_words = ["i'll try", "ill try", "i will try", "let me try",
                        "will do", "okay i will", "i promise", "i can do that",
                        "let me do", "i will start", "ill start"]
    if any(c in msg for c in commitment_words):
        closing_score += 0.3
        signals.append("commitment_made")

    # Signal 3: Short message after multiple turns (contextual signal)
    if turn_count >= 3 and word_count <= 5:
        closing_score += 0.2
        signals.append("short_after_deep_conversation")

    # Signal 4: Very short affirmative after advice
    short_affirmatives = ["ok", "okay", "sure", "yes", "yeah", "alright",
                          "fine", "good", "right", "hmm", "got it"]
    if msg.strip() in short_affirmatives and turn_count >= 2:
        closing_score += 0.15
        signals.append("short_affirmative")

    # Signal 5: Indirect closing ("let me go", "my battery", "I need to cook")
    indirect_closers = ["let me go", "i need to go", "i have to go", "battery",
                        "need to cook", "need to pray", "going to market",
                        "children are", "baby is", "someone is calling",
                        "ill come back", "i'll come back", "talk later",
                        "enough for today", "that is enough"]
    if any(c in msg for c in indirect_closers):
        closing_score += 0.35
        signals.append("indirect_closing")

    # Signal 6: No question mark + short + late in conversation
    if "?" not in message and word_count < 8 and turn_count >= 4:
        closing_score += 0.1
        signals.append("no_question_late_conversation")

    # Signal 7: Learned patient behavior (from profile)
    if behavior_profile:
        style = behavior_profile.get("response_style", "")
        if style == "concise" and word_count <= 4 and turn_count >= 3:
            closing_score += 0.1
            signals.append("matches_concise_closing_pattern")

    # Escalation detection (overrides closing)
    escalation_words = ["actually", "wait", "one more", "also", "but what about",
                        "i forgot to ask", "another question", "what if",
                        "is it true that", "i heard that"]
    if any(e in msg for e in escalation_words):
        closing_score -= 0.3
        signals.append("escalation_detected")

    # New topic detection (overrides closing)
    if "?" in message and word_count > 8:
        closing_score -= 0.2
        signals.append("new_question_detected")

    # Clamp and classify
    closing_score = max(0.0, min(1.0, closing_score))

    if closing_score >= 0.4:
        result["intent"] = "closing"
        result["confidence"] = closing_score

        # Generate appropriate closing instruction based on signals
        if "commitment_made" in signals:
            result["closing_instruction"] = (
                "CLOSING: Patient has COMMITTED to trying something. "
                "Acknowledge their commitment warmly. Give ONE brief encouragement. "
                "Do NOT ask another question. End with: 'I am here whenever you need me.' "
                "Keep it to 2 sentences max."
            )
        elif "explicit_closing_word" in signals:
            result["closing_instruction"] = (
                "CLOSING: Patient is saying goodbye. "
                "Respond warmly and briefly. Remind them of ONE key thing to remember. "
                "Do NOT ask a question. End with: 'Stay well. I am always here.' "
                "Keep it to 2 sentences max."
            )
        elif "indirect_closing" in signals:
            result["closing_instruction"] = (
                "CLOSING: Patient needs to leave. Be brief and respectful. "
                "Say something like: 'Go well. Remember [one thing]. Come back anytime.' "
                "Do NOT ask a question. 1-2 sentences only."
            )
        else:
            result["closing_instruction"] = (
                "CLOSING: Patient seems to be wrapping up. "
                "Keep your response brief and warm. Do NOT ask another question. "
                "2 sentences max."
            )
    elif closing_score <= 0.1 and ("escalation_detected" in signals or "new_question_detected" in signals):
        result["intent"] = "escalating"
        result["confidence"] = 1.0 - closing_score
    else:
        result["intent"] = "continuing"
        result["confidence"] = 1.0 - closing_score

    result["signals"] = signals
    return result


def build_intelligence_block(
    message: str,
    emotional_state: Dict[str, Any],
    assertiveness: Dict[str, Any],
    use_reasoning: bool,
    reasoning_chain: str = "",
    patient_context: dict = None,
) -> str:
    """Build the v2.0 intelligence block for prompt injection.

    Replaces the old static emotional detection with a dynamic,
    multi-dimensional signal that adapts the LLM's behavior.
    """
    parts = []

    # Reasoning chain (complex cases)
    if use_reasoning and reasoning_chain:
        parts.append(reasoning_chain)
        parts.append("")

    # Emotional state
    if emotional_state.get("needs_empathy_first"):
        emotion = emotional_state["primary_emotion"]
        intensity = emotional_state["intensity"]
        level = emotional_state["distress_level"]
        trajectory = emotional_state.get("emotional_trajectory", "new")
        opener = emotional_state.get("suggested_opener", "")

        parts.append(f"EMOTIONAL STATE: {emotion} (intensity: {intensity:.0%}, {level})")
        if trajectory == "escalating":
            parts.append("WARNING: Patient distress is ESCALATING — they need MORE empathy, not less.")
        if emotional_state.get("suppress_clinical"):
            parts.append("THIS TURN: ONLY emotional support. No health questions. No clinical advice. Just be present.")
        if opener:
            parts.append(f"SUGGESTED OPENING: \"{opener}\"")
        parts.append("EMPATHY FIRST — acknowledge feelings before ANY health content.")
        if emotional_state.get("secondary_emotion"):
            parts.append(f"Also sensing: {emotional_state['secondary_emotion']} — address this gently.")

    # Assertiveness calibration
    parts.append(f"\nTONE: {assertiveness['label'].upper()} (level {assertiveness['level']}/5)")
    parts.append(assertiveness["tone_instruction"])

    return "\n".join(parts)
