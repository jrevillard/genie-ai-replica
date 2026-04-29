"""
Conversational Pacer — Pipeline Redesign.

The current pipeline generates ONE comprehensive response per turn:
400 words, covers diet + exercise + hydration + mental health + emergency
in a single wall of text. No turn-taking, no questions, no waiting.

The Conversational Pacer generates ONE conversational move per turn:
  - Acknowledge what was said       (0–1 sentence)
  - One piece of substance          (1–2 sentences)
  - One engagement point            (1 sentence — question or suggestion)

Total: 2–4 sentences, ≤60 words.

Topics that would have been dumped in one turn are queued and paced
across multiple turns. Nothing is lost — it's just conversational.

Example of the difference:

  BEFORE (one turn, 400 words):
    "Lamin, good to see you! Let me talk about your diet. You should
     eat 5 portions of fruit... Also let's talk about exercise... You
     should also drink water... And manage stress... And if you have
     chest pain call 199..."

  AFTER (paced across turns):
    Turn 1: "Salaam Lamin! How have you been managing since last time?
             Any changes with your sugar or blood pressure?"
    Turn 2: "I'm glad the sugar is stable. For your blood pressure,
             try cutting salt by half this week — use lemon instead.
             Think you can try that?"
    Turn 3: "Good. Are you getting any walks in? Even 10 minutes
             around Kanifing helps your heart."

Gate: settings.USE_CONVERSATIONAL_PACER (default false).
When false, every public function is a no-op.

Architecture:
  1. Topic Queue: maintained in Redis per session, populated from tool
     observations and dialogue state. Each turn pops ONE topic.
  2. Turn Type: classified per turn — greet, ask, advise, check, close.
  3. Pacing Instruction: injected into prompt to constrain the model.
  4. Hard Enforcement: post-generation sentence/word truncation.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

from src.config import settings

logger = logging.getLogger(__name__)

_ENABLED = settings.USE_CONVERSATIONAL_PACER

_QUEUE_KEY = "topic_queue:{sid}"
_QUEUE_TTL = 86400  # 24 hours


# ── Turn types ─────────────────────────────────────────────────────────

TURN_TYPES = {
    # ── Conversation openers ──
    "greet": {
        "max_sentences": 3,
        "max_words": 35,
        "pattern": "short greeting + one question about how they are doing",
    },
    "greet_with_concern": {
        "max_sentences": 3,
        "max_words": 40,
        "pattern": "brief greeting + acknowledge their concern + one clarifying question",
    },

    # ── Questions (AMINA asks) ──
    "ask": {
        "max_sentences": 2,
        "max_words": 20,
        "pattern": "one focused question to understand their situation better",
    },
    "followup_ask": {
        "max_sentences": 2,
        "max_words": 25,
        "pattern": "reference what they just said + one follow-up question",
    },

    # ── Answers (patient asked something) ──
    "direct_answer": {
        "max_sentences": 3,
        "max_words": 45,
        "pattern": "answer their specific question with one concrete recommendation + offer to continue",
    },
    "inform": {
        "max_sentences": 3,
        "max_words": 50,
        "pattern": "one key fact that answers their question + ask if they want more detail",
    },

    # ── Advice delivery (paced from queue) ──
    "advise": {
        "max_sentences": 2,
        "max_words": 35,
        "pattern": "one specific actionable tip + ask if they can try it",
    },
    "nudge": {
        "max_sentences": 2,
        "max_words": 20,
        "pattern": "one quick health nudge related to what they said",
    },

    # ── Validation ──
    "check": {
        "max_sentences": 2,
        "max_words": 30,
        "pattern": "validate or gently correct what they reported + one follow-up question",
    },
    "affirm": {
        "max_sentences": 3,
        "max_words": 40,
        "pattern": "acknowledge what they agreed to + continue with a specific next piece of advice or question about the same topic",
    },

    # ── Emotional ──
    "empathize": {
        "max_sentences": 3,
        "max_words": 40,
        "pattern": "name the emotion + sit with it one sentence + one concrete next step",
    },

    # ── Critical ──
    "emergency": {
        "max_sentences": 3,
        "max_words": 45,
        "pattern": "call 199 or go to hospital NOW + what to do while waiting",
    },

    # ── Structured plan (weekly meal plan, care plan, schedule) ──
    "structured_plan": {
        "max_sentences": 30,
        "max_words": 400,
        "pattern": "structured plan with days/meals in a clear format using Gambian foods and seasonal availability",
    },

    # ── Conversation closers ──
    "close": {
        "max_sentences": 2,
        "max_words": 25,
        "pattern": "one thing agreed today + when to check back",
    },
    "bridge": {
        "max_sentences": 2,
        "max_words": 25,
        "pattern": "transition from current topic to next queued topic naturally",
    },
}


# ── Redis helpers ──────────────────────────────────────────────────────

def _get_redis():
    import redis
    return redis.Redis(
        host=settings.REDIS_HOST,
        port=settings.REDIS_PORT,
        db=0,
        decode_responses=True,
    )


def _load_queue(session_id: str) -> List[Dict[str, Any]]:
    try:
        r = _get_redis()
        raw = r.get(_QUEUE_KEY.format(sid=session_id))
        if raw:
            return json.loads(raw)
    except Exception as e:
        logger.debug(f"pacer: queue load failed: {e}")
    return []


def _save_queue(session_id: str, queue: List[Dict[str, Any]]) -> None:
    try:
        r = _get_redis()
        r.set(
            _QUEUE_KEY.format(sid=session_id),
            json.dumps(queue, default=str),
            ex=_QUEUE_TTL,
        )
    except Exception as e:
        logger.debug(f"pacer: queue save failed: {e}")


# ── Topic extraction from tool observations ────────────────────────────

def extract_topics_from_observations(
    observations: List[Dict[str, Any]],
    tools_used: List[str],
) -> List[Dict[str, Any]]:
    """Extract discussable topics from tool results.

    Each topic has: category, content (one sentence), priority (1-5).
    These get queued and paced across turns.
    """
    if not _ENABLED:
        return []

    topics = []

    for obs in observations:
        tool = obs.get("tool", "")
        result = obs.get("result")
        if not result or isinstance(result, str):
            continue

        if tool == "manage_diabetes":
            if isinstance(result, dict):
                for rec in (result.get("recommendations") or [])[:3]:
                    topics.append({
                        "category": "diabetes",
                        "content": str(rec)[:150],
                        "priority": 2,
                        "source_tool": tool,
                    })

        elif tool == "manage_hypertension":
            if isinstance(result, dict):
                for rec in (result.get("recommendations") or [])[:3]:
                    topics.append({
                        "category": "hypertension",
                        "content": str(rec)[:150],
                        "priority": 2,
                        "source_tool": tool,
                    })

        elif tool == "get_diet_advice":
            if isinstance(result, dict):
                advice = result.get("advice") or result.get("result", "")
                if advice:
                    topics.append({
                        "category": "diet",
                        "content": str(advice)[:150],
                        "priority": 3,
                        "source_tool": tool,
                    })

        elif tool == "counsel_lifestyle":
            if isinstance(result, dict):
                for tip in (result.get("tips") or result.get("recommendations") or [])[:2]:
                    topics.append({
                        "category": "lifestyle",
                        "content": str(tip)[:150],
                        "priority": 3,
                        "source_tool": tool,
                    })

        elif tool == "get_medication_info":
            if isinstance(result, dict):
                info = result.get("info") or result.get("result", "")
                if info:
                    topics.append({
                        "category": "medication",
                        "content": str(info)[:150],
                        "priority": 2,
                        "source_tool": tool,
                    })

        elif tool == "assess_triage":
            if isinstance(result, dict):
                level = result.get("level", "")
                if level == "EMERGENCY":
                    topics.insert(0, {
                        "category": "emergency",
                        "content": "Emergency symptoms detected — needs immediate protocol",
                        "priority": 1,
                        "source_tool": tool,
                    })

    # Sort by priority (1 = highest)
    topics.sort(key=lambda t: t.get("priority", 5))
    return topics


# ── Turn type classification ──────────────────────────────────────────

def _get_last_turn_type(session_id: str) -> Optional[str]:
    """Retrieve the turn type from the previous turn (stored in Redis)."""
    try:
        r = _get_redis()
        return r.get(f"last_turn_type:{session_id}")
    except Exception:
        return None


def _save_last_turn_type(session_id: str, turn_type: str) -> None:
    """Store the current turn type so the next turn can reference it."""
    try:
        r = _get_redis()
        r.set(f"last_turn_type:{session_id}", turn_type, ex=_QUEUE_TTL)
    except Exception:
        pass


def classify_turn_type(
    is_first_turn: bool,
    is_closing: bool,
    is_emergency: bool,
    message: str,
    queue_depth: int,
    emotional_register: str = "calm",
    turn_count: int = 0,
    session_id: str = "",
) -> str:
    """Decide what type of conversational move this turn should be.

    Granular classification — 14 turn types for natural conversation flow.
    The key insight: a simple question ("what should I eat?") gets a
    direct_answer (2 sentences), not an inform (3 sentences with extras).

    Priority order: emergency > plan intent > first-turn > emotion > affirmatives > ...
    Plan detection runs BEFORE greet/affirm so "give me a weekly meal plan"
    on first turn gets structured_plan, not greet.
    """
    if not _ENABLED:
        return "direct_answer"

    if is_emergency:
        return "emergency"

    if is_closing:
        return "close"

    msg_lower = message.lower().strip()
    words = msg_lower.split()
    word_count = len(words)

    # ── Plan detection FIRST — highest non-emergency priority ──
    # Two-tier detection:
    #   Tier 1: exact phrase cues (high confidence)
    #   Tier 2: semantic combo — diet/food/eat + time-range word
    plan_cues = [
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
    if any(cue in msg_lower for cue in plan_cues):
        return "structured_plan"

    # Tier 2: semantic combo — any food/diet word + any time-range word
    _diet_words = {"diet", "food", "eat", "meal", "meals", "breakfast",
                   "lunch", "dinner", "cooking", "cook", "nutrition"}
    _time_words = {"week", "weeks", "daily", "days", "monday", "tuesday",
                   "wednesday", "thursday", "friday", "saturday", "sunday",
                   "everyday", "weekday", "weekdays"}
    _msg_words = set(re.sub(r"[^\w\s]", "", msg_lower).split())
    if _msg_words & _diet_words and _msg_words & _time_words:
        return "structured_plan"

    # ── "yes"/"sure" after a plan turn → continue as structured_plan ──
    _plan_continuation_starts = (
        "yes", "yeah", "yea", "yep", "ok", "okay", "sure", "alright",
        "fine", "do it", "go ahead", "please", "i will", "i'll",
    )
    _is_ack = any(msg_lower == ack or msg_lower.startswith(ack + " ") for ack in _plan_continuation_starts)
    if session_id and _is_ack:
        prev = _get_last_turn_type(session_id)
        if prev == "structured_plan":
            return "structured_plan"

    # First turn — greet, but adapt to what they said
    if is_first_turn:
        has_question = "?" in message or any(
            q in msg_lower for q in ["what ", "how ", "should i ", "can i "]
        )
        if has_question and word_count > 5:
            return "greet_with_concern"
        return "greet"

    if emotional_register in ("scared", "frustrated", "resigned"):
        return "empathize"

    # Affirmatives ("yes", "ok", "sure") — patient agreed to something
    _affirm_exact = {
        "yes", "yeah", "yea", "yep", "ok", "okay", "sure", "alright",
        "i will", "i'll try", "i can try", "fine", "yes i will",
        "yes i can", "yeah i will", "okay i will", "sure i will",
    }
    if msg_lower in _affirm_exact or (
        word_count <= 4 and any(msg_lower.startswith(a) for a in ("yes ", "yeah ", "ok ", "okay ", "sure "))
    ):
        return "affirm"

    # Negative / resistance — patient pushed back
    if msg_lower in {"no", "nah", "nope", "not really", "i can't", "too hard"}:
        return "followup_ask"

    # Patient reported something they did → affirm or check
    did_cues = ["i walked", "i ate", "i took", "i did", "i tried",
                "i cooked", "i drank", "i checked", "i went"]
    if any(cue in msg_lower for cue in did_cues):
        return "affirm"

    # Patient reported vitals → check
    report_cues = ["my bp", "my sugar", "blood pressure", "glucose",
                   "sugar is", "bp is", "reading", "measured"]
    if any(cue in msg_lower for cue in report_cues):
        return "check"

    # Simple direct question (short, clear question) → direct_answer
    simple_question_cues = [
        "what should i", "what can i", "what do i", "what to eat",
        "what food", "how much", "how many", "how often", "how long",
        "is it ok", "is it safe", "can i eat", "can i take", "can i drink",
        "should i eat", "should i take", "should i walk",
    ]
    if any(cue in msg_lower for cue in simple_question_cues):
        return "direct_answer"

    # General question (longer, needs explanation) → inform
    question_cues = ["what ", "how ", "why ", "when ", "is it ", "?",
                     "tell me", "explain", "what causes", "what happens"]
    if any(cue in msg_lower for cue in question_cues):
        if word_count <= 8:
            return "direct_answer"
        return "inform"

    # We have queued topics to deliver
    if queue_depth > 0:
        # Alternate between advise and bridge to feel conversational
        if turn_count % 3 == 0:
            return "bridge"
        return "advise"

    # Short message, unclear intent → ask a clarifying question
    if word_count <= 4:
        return "followup_ask"

    # Default: nudge with a quick health tip
    return "nudge"


# ── Pacing instruction builder ────────────────────────────────────────

def build_pacing_instruction(
    turn_type: str,
    current_topic: Optional[Dict[str, Any]] = None,
    queue_depth: int = 0,
    patient_name: str = "",
) -> str:
    """Build the prompt instruction that constrains the model to one
    conversational move.

    Returns empty string when flag is off.
    """
    if not _ENABLED:
        return ""

    turn_def = TURN_TYPES.get(turn_type, TURN_TYPES["inform"])

    # Structured plan requests get a completely different instruction
    if turn_type == "structured_plan":
        parts = []
        parts.append("STRUCTURED PLAN REQUEST — generate a complete plan as requested.")
        parts.append(f"Up to {turn_def['max_words']} words.")
        parts.append("")
        parts.append("FORMAT: Use a clear day-by-day structure.")
        parts.append("For meal plans, format as:")
        parts.append("**Monday**")
        parts.append("- Breakfast: [specific Gambian food]")
        parts.append("- Lunch: [specific Gambian food]")
        parts.append("- Dinner: [specific Gambian food]")
        parts.append("")
        parts.append("RULES:")
        parts.append("- Use ONLY specific Gambian foods: moringa porridge, benachin, domoda, supakanja, "
                      "churaa gerté, chere, mbahal, nyaankataŋ, tapalapa bread, baobab juice, bissap, "
                      "findi, laaciiri, chereh, mono, tia durango.")
        parts.append("- Include seasonal notes: moringa year-round, okra rainy season (Jun-Oct), "
                      "sweet potato Nov-Mar, watermelon Mar-Jun, bitter tomato dry season.")
        parts.append("- Vary meals across days — don't repeat the same dish two days in a row.")
        parts.append("- If the patient has conditions (diabetes, hypertension), note which meals help.")
        if patient_name:
            parts.append(f"- Address as '{patient_name}'.")
        parts.append("- End with one short tip about lumo market shopping.")
        parts.append("- No sign-offs, no 'remember to', no filler.")
        return "\n".join(parts)

    parts = []
    parts.append(f"CONVERSATIONAL PACING — STRICT (OVERRIDES all prior length/format rules):")
    parts.append(f"Turn type: {turn_type.upper()}")
    parts.append(f"Your move: {turn_def['pattern']}")
    parts.append(f"HARD LIMIT: {turn_def['max_sentences']} sentences, {turn_def['max_words']} words.")
    parts.append(f"OVERRIDE: Ignore '2-4 paragraphs', 'MAX 80 words', or any other length rule. This limit is final.")

    parts.append("")
    parts.append("DO:")
    parts.append("- Answer ONLY what the patient asked. Nothing else.")
    parts.append("- Be specific: 'moringa porridge with lemon' not 'eat healthy foods'.")
    parts.append("- End with ONE short question OR one suggestion. Not both.")
    if patient_name:
        parts.append(f"- Use '{patient_name}' once at most.")

    parts.append("")
    parts.append("DO NOT (violating these makes the response fail):")
    parts.append("- Do NOT add topics the patient didn't ask about.")
    parts.append("- Do NOT mention hydration, medication, exercise, follow-ups, or EFSTH unless asked.")
    parts.append("- Do NOT say 'remember to...', 'don't forget to...', 'it's important to...'.")
    parts.append("- Do NOT say 'don't hesitate', 'reach out', 'we're here for you', 'stay well'.")
    parts.append("- Do NOT write more than one paragraph.")
    parts.append("- Do NOT give a list of recommendations. ONE thing only.")

    if current_topic:
        parts.append("")
        parts.append(f"THIS TURN'S FOCUS: {current_topic.get('category', 'general')}")
        parts.append(f"Deliver: {current_topic.get('content', '')}")
        parts.append("ONLY this point. Other advice comes in later turns.")

    if queue_depth > 0:
        parts.append(f"({queue_depth} more tips queued — they'll come naturally in future turns.)")

    return "\n".join(parts)


# ── Post-generation enforcement ───────────────────────────────────────

def _split_sentences(text: str) -> List[str]:
    """Split into sentences, handling abbreviations."""
    text = re.sub(r"(\d)\.", r"\1<DOT>", text)
    text = re.sub(r"\b(Dr|Mr|Mrs|Ms|vs|etc|e\.g|i\.e)\.", r"\1<DOT>", text, flags=re.IGNORECASE)
    parts = re.split(r"(?<=[.!?])\s+", text)
    return [p.replace("<DOT>", ".").strip() for p in parts if p.strip()]


_FILLER_SENTENCE_PATTERNS = [
    re.compile(p, re.IGNORECASE) for p in [

        # ── 1. Name-only sentences ("Lamin Jallow.") ──
        r"^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}[.!]?$",

        # ── 2. Warm-but-empty openers ──
        r"^I'?m (?:so |always |here |happy |very )?(?:glad|happy|here|pleased|delighted) to (?:see|hear|help|support|know|have)",
        r"^(?:It'?s (?:great|good|wonderful|lovely|nice|so nice) to (?:see|hear|have) you)",
        r"^(?:Welcome back|Good to see you|How wonderful to)",
        r"^(?:I'?m happy to hear|It'?s good to hear|Glad to hear)",
        r"^(?:Thank you for (?:sharing|reaching|coming|asking|trusting|telling))",

        # ── 3. Role announcements ──
        r"^(?:As (?:your|a) (?:community )?health worker|As someone who)",
        r"^(?:I'?m (?:your |)(?:community )?health worker|I'?m Amina)",
        r"^(?:As your (?:CHW|community health|health care|healthcare))",

        # ── 4. Unsolicited reminders / "remember to" ──
        r"^(?:Remember|Don'?t forget|It'?s important|I (?:also )?want to remind you)",
        r"^(?:Let me (?:also )?(?:remind|encourage|tell) you)",
        r"^(?:I (?:also )?want to (?:encourage|suggest|recommend|urge))",
        r"^(?:I would (?:also )?(?:like|love) to (?:remind|encourage|suggest))",
        r"^(?:Please (?:remember|make sure|ensure|be sure) to)",
        r"^(?:It'?s (?:also |very |equally )?(?:important|essential|crucial|vital) (?:to|that))",
        r"^(?:You should (?:also |always )?(?:remember|make sure|keep in mind))",

        # ── 5. Topic transitions / announcements (unsolicited topic changes) ──
        r"^(?:Let(?:'?s| me| us) (?:start|begin|talk|move on|also (?:talk|discuss)|now talk))",
        r"^(?:Now,? let'?s (?:talk|discuss|move|look|focus|turn))",
        r"^(?:Moving on to|Turning to|Speaking of|On (?:the )?(?:topic|subject) of)",
        r"^(?:(?:Now|Next),? (?:about|regarding|for|let me|I want to))",
        r"^(?:I also want to (?:talk|discuss|mention|address|touch on))",
        r"^(?:While we'?re (?:at it|on the (?:topic|subject)))",
        r"^(?:On another (?:note|topic|subject))",

        # ── 6. Generic encouragement / platitudes ──
        r"^(?:Every (?:bit|step|little bit|small step|effort) (?:counts|matters|helps))",
        r"^(?:(?:Making |Even )?(?:Small|Little|Tiny) (?:changes|steps|adjustments) (?:can )?make a (?:big|real|huge))",
        r"^(?:You'?re (?:doing|making) (?:great|good|wonderful|excellent|a great))",
        r"^(?:Keep (?:up|it up|going|at it|doing))",
        r"^(?:I (?:believe|know|am confident|have faith) (?:in you|you can))",
        r"^(?:You (?:can|are able to|have the strength to) do (?:this|it))",
        r"^(?:(?:Together,? )?we can (?:do|work|get through|manage|overcome) (?:this|it))",
        r"^(?:One (?:step|day) at a time)",

        # ── 7. Condition restating / "as someone living with" ──
        r"^(?:As someone (?:living|dealing|coping) with)",
        r"^(?:Given (?:your|that you have|that you'?re) (?:condition|diabetes|hypertension|heart))",
        r"^(?:With your (?:condition|diabetes|hypertension|heart disease))",
        r"^(?:(?:To|In order to) (?:help )?manage your (?:condition|diabetes|heart|blood))",
        r"^(?:Managing your (?:condition|diabetes|heart|blood pressure) (?:is|can be|requires))",
        r"^(?:For (?:someone|a person|people) with (?:your|diabetes|heart|hypertension))",
        r"^(?:This (?:is|will be) (?:good|great|important|essential|helpful) for (?:your|managing))",

        # ── 8. Alternative offerings (second+ recommendations — should be queued) ──
        r"^(?:Alternatively|Another option|Or,? you (?:could|can|might)|You (?:could|can|might) also)",
        r"^(?:If (?:that'?s|this is) (?:not|too) (?:possible|hard|difficult))",
        r"^(?:(?:Or|And) if you (?:prefer|want|like|don'?t))",
        r"^(?:Some (?:other|more|additional) (?:options|alternatives|ideas|suggestions))",

        # ── 9. Hedging / padding / verbal throat-clearing ──
        r"^(?:It'?s (?:also )?worth (?:noting|mentioning|pointing out|remembering))",
        r"^(?:I (?:should|would like to|must) (?:also )?(?:mention|note|point out|add))",
        r"^(?:Please (?:keep|bear) in mind)",
        r"^(?:I know (?:it|this|that) (?:can|might|may) (?:be|seem|feel))",
        r"^(?:I understand (?:that |how |it |this ))",
        r"^(?:That'?s a (?:great|good|very good|important|valid|wonderful) (?:question|concern|point))",

        # ── 10. Closing questions that aren't real engagement ──
        r"^(?:(?:Does|Did) that (?:make sense|help|answer|sound))",
        r"^(?:Do you (?:have any|want me to|need any)(?:.*questions|.*explain))",
        r"^(?:(?:Is|Are) there (?:anything|something) (?:else|more))",
        r"^(?:Would you like (?:to know|me to|more)(?:.*more|.*explain|.*detail))",
        r"^(?:How does that sound)",
        r"^(?:What do you think(?:\?|\.)?$)",
        r"^(?:(?:Shall|Should) (?:we|I) (?:discuss|talk|go over))",

        # ── 11. Schedule / follow-up pushes (unsolicited) ──
        r"^(?:(?:Let'?s|We (?:can|should)|I'?d like to) schedule)",
        r"^(?:Maybe we can (?:plan|even plan|schedule|arrange))",
        r"^(?:We (?:should|could|can) (?:also )?(?:plan|arrange|book|set up))",
        r"^(?:(?:It'?s|It might be|It would be) (?:a good idea|time|important) to (?:schedule|plan|book))",
        r"^(?:(?:Have you|You should|Don'?t forget to) (?:scheduled?|planned?|booked?))",
        r"^(?:When was (?:the last time|your last))",

        # ── 12. Sign-offs and platitudes ──
        r"^(?:If you (?:have any|need|experience|feel)|(?:Don'?t|Please don'?t) hesitate)",
        r"^(?:We'?re (?:always )?here|I'?m (?:always )?here|You'?re not alone)",
        r"^(?:Stay (?:well|safe|strong|hydrated|positive|blessed)|Take care|God bless|Wishing you)",
        r"^(?:May (?:Allah|God) (?:bless|protect|heal|guide))",
        r"^(?:(?:Peace|Blessings|Health) (?:be (?:with|upon) you))",
        r"^(?:I'?m (?:here |always here )?(?:for you|if you need|whenever))",

        # ── 13. Vague goal / generic praise of recommendations ──
        r"^(?:We want to (?:keep|make sure|ensure|help))",
        r"^(?:(?:The|Our|Your) goal is to)",
        r"^(?:This will (?:help|ensure|make sure|go a long way))",
        r"^(?:(?:It'?s|This is) (?:key|critical|essential|vital) (?:that|to|for))",
        r"^(?:(?:It(?:'?s| is)|This is|That(?:'?s| is)) (?:a )?(?:great|good|wonderful|excellent|perfect|easy|simple) (?:way|option|choice|start|step|habit|idea))",
        r"^(?:(?:It|This|That) (?:will|can|helps?|is good) (?:give|boost|improve|help|keep|support))",
        r"^(?:(?:This|It|That) (?:is|will be) (?:very |really )?(?:good|great|helpful|beneficial) for)",

        # ── 14. Empathy fillers (generic, not tied to what patient said) ──
        r"^(?:I know (?:it'?s|this is|how) (?:not easy|hard|difficult|challenging|tough|overwhelming))",
        r"^(?:(?:Living|Dealing|Coping) with (?:diabetes|heart|chronic|your condition) (?:can be|is))",
        r"^(?:It'?s (?:completely |perfectly )?(?:normal|natural|okay|understandable) to (?:feel|be|worry))",
        r"^(?:Many (?:people|patients|others) (?:in your|with your|who have) (?:situation|condition))",
        r"^(?:You'?re (?:not the only one|not alone in this|in good company))",

        # ── 15. Preachy / educational fillers ──
        r"^(?:(?:Studies|Research|Evidence|Science) (?:shows?|suggests?|indicates?|has shown))",
        r"^(?:According to (?:the |)(?:WHO|World Health|research|studies|experts))",
        r"^(?:(?:Did you know|You may not know|Fun fact|Interestingly) (?:that )?)",
        r"^(?:(?:It'?s|This is) (?:well known|widely known|a fact) that)",

        # ── 16. Redundant acknowledgments (mid-conversation) ──
        r"^(?:(?:Yes|Right|Exactly|Indeed|Absolutely|Of course),? (?:that'?s|you'?re|it'?s) (?:right|correct|true|a good))",
        r"^(?:I (?:completely |fully |totally )?(?:understand|hear you|agree)(?:\.|,))",
        r"^(?:That makes (?:perfect |complete |total )?sense)",

        # ── 17. "My dear brother/sister" padding ──
        r"my dear (?:brother|sister|friend)",

        # ── 18. Insha'Allah/blessing as filler at end ──
        r",?\s*insha'?(?:A|a)llah\.?$",

        # ── 19. Vague/generic recommendations (no specific food/action) ──
        r"^.*(?:I (?:would )?(?:recommend|suggest) something (?:light|healthy|nutritious|simple|easy|good))",
        r"^.*(?:(?:Try|Have|Eat|Drink) something (?:light|healthy|nutritious|simple|easy|warm|cool))",
    ]
]


_CULTURAL_GREETINGS = {
    "salaam", "assalamu", "alaikum", "peace", "marhaba",
    "jamm", "nanga", "salam", "shalom", "namaste",
}


def _is_filler_sentence(sentence: str, turn_type: str = "") -> bool:
    """Check if a sentence is conversational filler that should be stripped.

    Turn-type-aware: empathy turns keep empathy sentences (they ARE the
    content), greet turns keep cultural greetings like "Salaam Lamin!".
    """
    s = sentence.strip()
    if not s:
        return True

    if turn_type == "empathize":
        return False

    if len(s.split()) <= 2 and not s.endswith("?"):
        words_lower = [w.lower().rstrip("!.,?") for w in s.split()]
        if turn_type in ("greet", "greet_with_concern") and any(
            w in _CULTURAL_GREETINGS for w in words_lower
        ):
            return False
        return True

    return any(p.search(s) for p in _FILLER_SENTENCE_PATTERNS)


# ── Intra-sentence filler (phrases to strip FROM content sentences) ────
# These pad individual sentences without adding information.
# "For breakfast, I recommend something light and healthy to help manage
#  your diabetes and heart disease." → "For breakfast, try moringa porridge."

_INTRA_FILLER = [
    re.compile(p, re.IGNORECASE) for p in [
        # Vague recommendation wrappers — capture full clause including trailing condition
        r",?\s*(?:which (?:is|will be|are)|that (?:is|'?s|will be)) (?:very |really |so |extremely )?(?:good|great|important|essential|helpful|beneficial) for (?:managing )?(?:your |you\b)[^,.!?]*",
        r"\s*(?:to help (?:you )?(?:manage|control|monitor|improve|maintain|support) (?:your )?(?:condition|diabetes|heart(?: disease)?|blood(?: (?:pressure|sugar))?|health|weight|hypertension|cholesterol)(?:\s+and\s+(?:condition|diabetes|heart(?: disease)?|blood(?: (?:pressure|sugar))?|health|weight|hypertension|cholesterol))?)",
        r"\s*(?:,? ?(?:as|since|because) (?:it|this|they) (?:will|can|helps?|is good for|supports?)(?:.*?)(?:health|condition|diabetes|heart|blood))[.]",
        # Padding phrases mid-sentence
        r"(?:,? my dear (?:brother|sister|friend),?)",
        r"(?:,?\s*insha'?[Aa]llah)",
        # "as we discussed before" / "as I mentioned"
        r"(?:,? ?(?:as (?:we|I) (?:discussed|mentioned|talked about|agreed)(?: before| earlier| last time)?))",
    ]
]


def _strip_intra_filler(sentence: str) -> str:
    """Strip filler phrases from within a sentence."""
    result = sentence
    for pattern in _INTRA_FILLER:
        result = pattern.sub("", result)
    # Clean up artifacts
    result = re.sub(r"  +", " ", result)
    result = re.sub(r" ,", ",", result)
    result = re.sub(r"\.\.", ".", result)
    result = result.strip()
    # Capitalize if needed
    if result and result[0].islower():
        result = result[0].upper() + result[1:]
    return result


def enforce_turn_limits(
    response: str,
    turn_type: str,
) -> str:
    """Hard enforcement: strip filler, then truncate to turn limits.

    Pipeline:
      1. Split into sentences
      2. Remove filler sentences (greetings-as-filler, "remember to",
         "don't hesitate", unsolicited topic openers)
      3. Strip multi-paragraph breaks (force single paragraph)
      4. Truncate to sentence limit
      5. Truncate to word limit at sentence boundary

    This is the architectural backstop — even if the model ignores
    the pacing instruction, the response stays short.

    Returns response unchanged when flag is off.
    """
    if not _ENABLED:
        return response

    if not response:
        return response

    # Structured plans keep their formatting (bold headers, lists, newlines)
    if turn_type == "structured_plan":
        turn_def = TURN_TYPES.get(turn_type, TURN_TYPES["inform"])
        words = response.split()
        if len(words) > turn_def["max_words"]:
            truncated = " ".join(words[:turn_def["max_words"]])
            last_nl = truncated.rfind("\n")
            last_end = max(truncated.rfind("."), truncated.rfind("!"), truncated.rfind("?"))
            cut = max(last_nl, last_end)
            if cut > len(truncated) * 0.5:
                return truncated[:cut + 1].rstrip()
            return truncated
        return response

    # Strip paragraph breaks — force single paragraph
    response = re.sub(r"\n{2,}", " ", response)
    response = re.sub(r"\n", " ", response)
    response = re.sub(r"  +", " ", response).strip()

    turn_def = TURN_TYPES.get(turn_type, TURN_TYPES["direct_answer"])
    if os.getenv("USE_INTENT_ROUTER", "false").lower() == "true":
        max_sentences = 8
        max_words = 150
    else:
        max_sentences = turn_def["max_sentences"]
        max_words = turn_def["max_words"]

    sentences = _split_sentences(response)

    # Step 1: Remove filler sentences (turn-type aware)
    content_sentences = [s for s in sentences if not _is_filler_sentence(s, turn_type)]

    # If all sentences were filler, keep the first non-filler or the original first
    if not content_sentences:
        content_sentences = sentences[:1] if sentences else []

    # Step 2: Strip intra-sentence filler from remaining content
    content_sentences = [_strip_intra_filler(s) for s in content_sentences]
    content_sentences = [s for s in content_sentences if s and len(s.split()) > 1]

    if not content_sentences:
        content_sentences = sentences[:1] if sentences else []

    # Step 3: Sentence limit
    if len(content_sentences) > max_sentences:
        content_sentences = content_sentences[:max_sentences]

    # Ensure last sentence ends properly
    if content_sentences:
        last = content_sentences[-1]
        if last and last[-1] not in ".!?":
            content_sentences[-1] = last + "."

    result = " ".join(content_sentences)

    # Step 3: Word limit (cut at sentence boundary)
    words = result.split()
    if len(words) > max_words:
        truncated = " ".join(words[:max_words])
        last_end = max(
            truncated.rfind("."),
            truncated.rfind("!"),
            truncated.rfind("?"),
        )
        if last_end > len(truncated) * 0.3:
            result = truncated[:last_end + 1]
        else:
            result = truncated
            if result and result[-1] not in ".!?":
                result += "."

    # Capitalize first letter
    result = result.strip()
    if result and result[0].islower():
        result = result[0].upper() + result[1:]

    return result


# ── Queue management (public API) ─────────────────────────────────────

def queue_topics(
    session_id: str,
    new_topics: List[Dict[str, Any]],
) -> int:
    """Add topics to the session queue. Returns new queue depth."""
    if not _ENABLED or not new_topics:
        return 0

    queue = _load_queue(session_id)

    # Deduplicate by category+content
    existing = {(t["category"], t["content"][:50]) for t in queue}
    for topic in new_topics:
        key = (topic.get("category", ""), topic.get("content", "")[:50])
        if key not in existing:
            queue.append(topic)
            existing.add(key)

    # Cap queue at 10 topics
    queue = sorted(queue, key=lambda t: t.get("priority", 5))[:10]
    _save_queue(session_id, queue)

    return len(queue)


def pop_next_topic(session_id: str) -> Optional[Dict[str, Any]]:
    """Pop the highest-priority topic from the queue.

    Returns None if queue is empty or flag is off.
    """
    if not _ENABLED:
        return None

    queue = _load_queue(session_id)
    if not queue:
        return None

    topic = queue.pop(0)
    _save_queue(session_id, queue)
    return topic


def get_queue_depth(session_id: str) -> int:
    """How many topics remain in the queue."""
    if not _ENABLED:
        return 0
    return len(_load_queue(session_id))


# ── Convenience: full pacing pipeline ─────────────────────────────────

def pace_turn(
    session_id: str,
    message: str,
    is_first_turn: bool,
    is_closing: bool,
    is_emergency: bool,
    observations: List[Dict[str, Any]],
    tools_used: List[str],
    patient_name: str = "",
    emotional_register: str = "calm",
    patient_id: str = "",
) -> Dict[str, Any]:
    """Full pacing pipeline — call once per turn.

    Returns:
    {
        "pacing_instruction": str,   # inject into prompt
        "turn_type": str,
        "current_topic": dict|None,
        "queue_depth": int,
    }

    When flag is off, returns empty instruction (no-op).
    """
    if not _ENABLED:
        return {
            "pacing_instruction": "",
            "turn_type": "direct_answer",
            "current_topic": None,
            "queue_depth": 0,
        }

    # ── Intent Router delegation (flag-gated) ─────────────────────────
    # When USE_INTENT_ROUTER is on, the router handles classification
    # (with ack-prefix stripping) and builds prompt instructions.
    # The pacer still manages topic queuing and turn-type persistence.
    if os.getenv("USE_INTENT_ROUTER", "false").lower() == "true":
        from src.services.intent_router import route_intent

        router_result = route_intent(
            message=message,
            is_first_turn=is_first_turn,
            session_id=session_id,
            emotional_register=emotional_register or "calm",
            patient_name=patient_name,
            patient_id=patient_id,
        )
        _rtr_turn = router_result["turn_type"]
        _rtr_instruction = router_result["prompt_instruction"]

        new_topics = extract_topics_from_observations(observations, tools_used)
        if new_topics:
            queue_topics(session_id, new_topics)
        _rtr_depth = get_queue_depth(session_id)

        _rtr_topic = None
        if _rtr_turn in ("advise", "check", "inform", "direct_answer", "bridge", "nudge") and _rtr_depth > 0:
            _rtr_topic = pop_next_topic(session_id)
            _rtr_depth = get_queue_depth(session_id)

        _save_last_turn_type(session_id, _rtr_turn)

        return {
            "pacing_instruction": _rtr_instruction,
            "turn_type": _rtr_turn,
            "current_topic": _rtr_topic,
            "queue_depth": _rtr_depth,
            "max_tokens_hint": router_result.get("max_tokens_hint", 400),
            "intent": router_result.get("intent", "simple_question"),
        }

    # 1. Extract and queue topics from tool observations
    new_topics = extract_topics_from_observations(observations, tools_used)
    if new_topics:
        queue_topics(session_id, new_topics)

    queue_depth = get_queue_depth(session_id)

    # Estimate turn count from message history length
    # (We don't have direct access to turn count, so use queue state as proxy)
    _turn_estimate = 0
    try:
        r = _get_redis()
        _turn_key = f"turn_count:{session_id}"
        _tc = r.incr(_turn_key)
        r.expire(_turn_key, _QUEUE_TTL)
        _turn_estimate = _tc
    except Exception:
        pass

    # 2. Classify this turn
    turn_type = classify_turn_type(
        is_first_turn=is_first_turn,
        is_closing=is_closing,
        is_emergency=is_emergency,
        message=message,
        queue_depth=queue_depth,
        emotional_register=emotional_register,
        turn_count=_turn_estimate,
        session_id=session_id,
    )

    # Save turn type for multi-turn context (e.g. "yes" after plan)
    _save_last_turn_type(session_id, turn_type)

    # 3. Pop a topic if this is an advice-delivery turn
    current_topic = None
    topic_turns = ("advise", "check", "inform", "direct_answer", "bridge", "nudge")
    if turn_type in topic_turns and queue_depth > 0:
        current_topic = pop_next_topic(session_id)
        queue_depth = get_queue_depth(session_id)

    # 4. Build pacing instruction
    instruction = build_pacing_instruction(
        turn_type=turn_type,
        current_topic=current_topic,
        queue_depth=queue_depth,
        patient_name=patient_name,
    )

    return {
        "pacing_instruction": instruction,
        "turn_type": turn_type,
        "current_topic": current_topic,
        "queue_depth": queue_depth,
    }


# ── Async variant for four-layer router (requires await) ─────────────

async def async_pace_turn(
    session_id: str,
    message: str,
    is_first_turn: bool,
    is_closing: bool,
    is_emergency: bool,
    observations: List[Dict[str, Any]],
    tools_used: List[str],
    patient_name: str = "",
    emotional_register: str = "calm",
    patient_id: str = "",
) -> Dict[str, Any]:
    """Async pacing pipeline — uses four-layer router when enabled.

    Same return shape as pace_turn() plus stance/tool_suppression/layer_path
    when the four-layer router is active.
    """
    if not _ENABLED:
        return {
            "pacing_instruction": "",
            "turn_type": "direct_answer",
            "current_topic": None,
            "queue_depth": 0,
        }

    if os.getenv("USE_FOUR_LAYER_ROUTER", "false").lower() == "true":
        from src.services.four_layer_router import route as four_layer_route

        router_result = await four_layer_route(
            message=message,
            is_first_turn=is_first_turn,
            session_id=session_id,
            emotional_register=emotional_register or "calm",
            patient_name=patient_name,
            patient_id=patient_id,
        )
        _rtr_turn = router_result["turn_type"]
        _rtr_instruction = router_result["prompt_instruction"]

        new_topics = extract_topics_from_observations(observations, tools_used)
        if new_topics:
            queue_topics(session_id, new_topics)
        _rtr_depth = get_queue_depth(session_id)

        _rtr_topic = None
        if _rtr_turn in ("advise", "check", "inform", "direct_answer", "bridge", "nudge") and _rtr_depth > 0:
            _rtr_topic = pop_next_topic(session_id)
            _rtr_depth = get_queue_depth(session_id)

        _save_last_turn_type(session_id, _rtr_turn)

        return {
            "pacing_instruction": _rtr_instruction,
            "turn_type": _rtr_turn,
            "current_topic": _rtr_topic,
            "queue_depth": _rtr_depth,
            "max_tokens_hint": router_result.get("max_tokens_hint", 400),
            "intent": router_result.get("intent", "simple_question"),
            "stance": router_result.get("stance"),
            "tool_suppression": router_result.get("tool_suppression", []),
            "layer_path": router_result.get("layer_path", ""),
        }

    # Fallback: run the sync pace_turn logic
    return pace_turn(
        session_id=session_id,
        message=message,
        is_first_turn=is_first_turn,
        is_closing=is_closing,
        is_emergency=is_emergency,
        observations=observations,
        tools_used=tools_used,
        patient_name=patient_name,
        emotional_register=emotional_register,
        patient_id=patient_id,
    )
