from openai import AsyncOpenAI
from typing import Dict, Any, Optional, List
import json
import os
import re
import asyncio
import logging
import uuid
from datetime import datetime

from src.config import settings
from src.agent.prompts import AMINA_SYSTEM_PROMPT
from src.agent.memory import ConversationMemory
from src.agent.memory_manager import MemoryManager, get_memory_manager
from src.agent.orchestrator import ToolOrchestrator
from src.models.memory import ConsultationRecord
from src.services.learning import (
    log_interaction, get_learned_context,
    extract_clinical_insights, update_behavior_profile,
    promote_to_knowledge_chunks,
)
from src.services.empathy import (
    classify_emotional_state, calibrate_assertiveness,
    should_use_reasoning, build_reasoning_chain,
    build_intelligence_block, classify_conversation_intent,
)

logger = logging.getLogger(__name__)


# REGENERATE HINT → PROMPT INSTRUCTION
# Maps a downvote reason to a concrete instruction for the retry.
_REGEN_INSTRUCTIONS = {
    "too_generic": (
        "REGENERATION HINT — last reply was too generic. "
        "Give specific numbers, named foods, named facilities. "
        "Drop every phrase that could apply to any patient."
    ),
    "wrong_info": (
        "REGENERATION HINT — last reply had incorrect info. "
        "Be extra careful with clinical numbers. Stick to WHO PEN protocols. "
        "If uncertain, say so and refer to CHW/health post."
    ),
    "too_long": (
        "REGENERATION HINT — last reply was too long. "
        "Aim for under 40 words. Cut every word that isn't essential."
    ),
    "too_short": (
        "REGENERATION HINT — last reply was too short. "
        "Give more detail — at least one concrete example and one warning sign."
    ),
    "wrong_language": (
        "REGENERATION HINT — last reply used wrong language or too complex wording. "
        "Use simple, short sentences a rural patient with low literacy would understand."
    ),
    "not_cultural": (
        "REGENERATION HINT — last reply wasn't culturally appropriate. "
        "Use Gambian foods (benachin, domoda, supakanja), Gambian facilities, Gambian figures "
        "(CHW, Alkallo, health post). Drop anything that sounds like foreign medical advice."
    ),
    "missed_question": (
        "REGENERATION HINT — last reply didn't answer the patient's actual question. "
        "Re-read the question carefully and address EXACTLY what they asked FIRST."
    ),
    "other": (
        "REGENERATION HINT — last reply was not helpful. "
        "Try a different angle, be more specific, and make sure you answer the patient's question."
    ),
}

# Temperature bump per hint — encourages lexical diversity on retry
_REGEN_TEMPERATURE_BUMP = 0.15


# Keywords that signal the user wants a detailed plan/chart/schedule
# — override the 60-word limit when these appear
_PLAN_KEYWORDS = [
    "diet chart", "diet plan", "meal plan", "weekly plan", "7 day",
    "7-day", "week plan", "day by day", "daily plan", "schedule",
    "care plan", "treatment plan", "exercise plan", "routine",
    "list of", "give me a plan", "detailed", "full plan",
    # Conversational variants
    "step by step", "step-by-step", "everyday plan", "every day plan",
    "1 week", "one week", "gimme a plan", "give me a guide",
    "week guide", "weekly guide", "daily guide", "day plan",
    "monday to", "mon to", "breakfast lunch dinner",
    "what to eat each day", "what to eat every day",
]


def _wants_detailed_plan(message: str) -> bool:
    msg_l = message.lower()
    if any(kw in msg_l for kw in _PLAN_KEYWORDS):
        return True
    _diet_w = {"diet", "food", "eat", "meal", "meals", "breakfast",
               "lunch", "dinner", "cooking", "cook", "nutrition"}
    _time_w = {"week", "weeks", "daily", "days", "monday", "tuesday",
               "wednesday", "thursday", "friday", "saturday", "sunday",
               "everyday", "weekday", "weekdays"}
    tokens = set(re.sub(r"[^\w\s]", "", msg_l).split())
    return bool(tokens & _diet_w and tokens & _time_w)


def _get_length_instruction(message: str) -> str:
    if _wants_detailed_plan(message):
        return (
            "The user asked for a DETAILED PLAN. You may use up to 200 words.\n"
            "Structure it clearly — use day labels (Monday, Tuesday...) or numbered steps.\n"
            "Still use Gambian foods and practical advice. No generic padding.\n"
            "Reply as Amina the CHW:"
        )
    return (
        "Reply as Amina the CHW. 3-6 sentences. ONE point. End with a question or action.\n"
        "If you do not yet know the patient's readings/medicines/diet → ASK first, do not advise yet."
    )


def _get_max_tokens(message: str) -> int:
    """
    Dynamic output token cap for OpenAI models.

    Tiers:
      greeting / ack (<25 chars or simple words)  →  100 tokens
      short question  (<80 chars)                 →  300 tokens
      standard health question (<250 chars)       →  500 tokens
      long / multi-part message                   →  700 tokens
      detailed plan request (keywords match)      →  1000 tokens
    """
    if _wants_detailed_plan(message):
        return 1000
    msg = message.strip().lower()
    _SIMPLE_ACKS = {"ok", "okay", "yes", "no", "thanks", "thank you", "good",
                    "got it", "understood", "noted", "sure", "alright", "fine"}
    if len(msg) < 25 or msg in _SIMPLE_ACKS:
        return 100
    if len(msg) < 80:
        return 300
    if len(msg) < 250:
        return 500
    return 700



def _build_regenerate_instruction(hint: Optional[str]) -> str:
    if not hint:
        return ""
    return _REGEN_INSTRUCTIONS.get(hint, _REGEN_INSTRUCTIONS["other"])


class AminaAgent:
    def __init__(self):
        # Always init both clients so per-request model switching works
        self.openai_client = AsyncOpenAI(
            api_key=settings.OPENAI_API_KEY,
            base_url=settings.OPENAI_BASE_URL,
        )
        self.openai_model_name = settings.OPENAI_MODEL

        self.amina_client = None
        self.amina_model_name = settings.AMINA_MODEL_NAME
        if settings.AMINA_MODEL_URL:
            self.amina_client = AsyncOpenAI(
                api_key="not-needed",  # vLLM doesn't require API key
                base_url=settings.AMINA_MODEL_URL,
            )
            logger.info(f"AMINA v2 client ready: {settings.AMINA_MODEL_URL}")

        # Gemini via OpenAI-compatible endpoint
        self.gemini_client = None
        self.gemini_model_name = settings.GEMINI_MODEL
        if settings.GOOGLE_API_KEY:
            self.gemini_client = AsyncOpenAI(
                api_key=settings.GOOGLE_API_KEY,
                base_url=settings.GEMINI_BASE_URL,
            )
            logger.info(f"Gemini client ready: {settings.GEMINI_MODEL}")

        # Groq via OpenAI-compatible endpoint (free tier, Llama 3.3 70B)
        self.groq_client = None
        self.groq_model_name = settings.GROQ_MODEL
        if settings.GROQ_API_KEY:
            self.groq_client = AsyncOpenAI(
                api_key=settings.GROQ_API_KEY,
                base_url=settings.GROQ_BASE_URL,
            )
            logger.info(f"Groq client ready: {settings.GROQ_MODEL}")

        # Mistral AI via OpenAI-compatible endpoint (free credits, open-mistral-7b)
        self.mistral_client = None
        self.mistral_model_name = settings.MISTRAL_MODEL
        if settings.MISTRAL_API_KEY:
            self.mistral_client = AsyncOpenAI(
                api_key=settings.MISTRAL_API_KEY,
                base_url=settings.MISTRAL_BASE_URL,
            )
            logger.info(f"Mistral client ready: {settings.MISTRAL_MODEL}")

        # Default client — controlled by USE_FINETUNED_MODEL env var
        if settings.USE_FINETUNED_MODEL and self.amina_client:
            self.client = self.amina_client
            self.model_name = self.amina_model_name
            logger.info("Default: AMINA v2 fine-tuned model")
        else:
            self.client = self.openai_client
            self.model_name = self.openai_model_name
            logger.info(f"Default: OpenAI ({self.model_name})")
        self.orchestrator = ToolOrchestrator()
        self.sessions: Dict[str, ConversationMemory] = {}
        self.memory_manager: MemoryManager = get_memory_manager()

    # Keyword → tool routing (fast deterministic replacement for LLM "think" step)
    TOOL_ROUTES = [
        (["blood pressure", "my bp", "bp is", "bp was", "systolic", "diastolic"], "record_vitals"),
        (["blood sugar", "glucose", "my sugar", "sugar was", "sugar is", "hba1c"], "record_vitals"),
        (["diabetes", "diabetic", "type 2", "type ii", "metformin"], "manage_diabetes"),
        (["hypertension", "high blood pressure", "high bp"], "manage_hypertension"),
        (["asthma", "inhaler", "wheezing"], "assess_respiratory"),
        (["copd", "chronic cough", "breathing difficulty"], "assess_respiratory"),
        (["lump", "cervical", "abnormal bleeding", "tumor"], "screen_cancer"),
        (["prescribed", "prescription", "doctor gave me", "nurse gave me", "just got", "was given"], "get_medication_info"),
        (["medication", "my medicine", "my pills", "dosage", "amlodipine", "lisinopril", "glibenclamide"], "get_medication_info"),
        (["diet", "eat", "food", "benachin", "domoda", "supakanja", "nutrition", "should i eat"], "get_diet_advice"),
        (["nearest clinic", "health center", "hospital", "facility", "refer me", "where can i go"], "find_facility"),
        (["care plan", "my plan", "treatment plan"], "generate_care_plan"),
        (["ramadan", "fasting", "suhoor", "iftar"], "check_ramadan"),
        (["heart attack risk", "cvd risk", "cardiovascular risk"], "assess_cvd_risk"),
        (["quit smoking", "stop smoking", "tobacco", "quit tobacco"], "counsel_lifestyle"),
        (["daily tip", "daily nudge", "one-spoon", "one spoon", "small swap", "what should i do today"], "get_lifestyle_nudge"),
        (["pain", "ache", "hurts", "sore", "fever", "dizzy", "nausea", "vomit", "swelling", "numb", "tingling", "rash", "symptom", "not feeling well", "feel sick", "feeling unwell"], "assess_triage"),
        (["afraid to go", "scared to go", "don't want to go", "dont want to go", "can't go", "cant go", "won't let me", "wont let me", "will not let me", "will not allow", "not allowed", "husband says", "husband won't", "husband wont", "husband will not", "family says", "family won't", "ashamed", "embarrassed", "too expensive", "cannot afford", "can't afford", "cant afford", "no permission", "need permission"], "suggest_community_support"),
    ]

    # Health-domain tools that benefit from supplementary RAG evidence
    _HEALTH_TOOLS = {
        "manage_diabetes", "manage_hypertension", "assess_respiratory",
        "screen_cancer", "counsel_lifestyle", "assess_cvd_risk",
        "get_diet_advice", "get_medication_info", "assess_triage",
    }

    def _route_tools(self, message: str) -> List[str]:
        """Pick tools from keywords. Much faster than an LLM 'think' call.

        NEW: when a health-domain tool fires AND the query is substantive
        (>4 words), also run search_knowledge in parallel so the LLM gets
        both the tool's structured data AND relevant WHO document chunks.
        """
        msg = message.lower()
        selected = []
        for keywords, tool_name in self.TOOL_ROUTES:
            if any(kw in msg for kw in keywords):
                if tool_name not in selected:
                    selected.append(tool_name)

        is_chitchat = any(g in msg for g in [
            "hi", "hello", "hey", "good morning", "good afternoon",
            "good evening", "thanks", "thank you", "bye", "how are you",
        ])
        # Short affirmatives should NOT trigger tools — they're continuation cues
        is_affirmative = msg.strip() in [
            "yes", "yeah", "yea", "yep", "ok", "okay", "sure", "alright",
            "right", "hmm", "mhm", "true", "correct", "fine", "good",
            "no", "nah", "nope", "not really",
        ]
        if is_affirmative:
            return []  # No tools — let the LLM continue the conversation naturally

        # v2.0: Basic emotion flag for tool routing (full analysis in process_message)
        self._emotional_message = any(ew in msg for ew in [
            "scared", "afraid", "worry", "worried", "anxious",
            "depressed", "sad", "lonely", "hopeless", "overwhelm",
            "crying", "can't cope", "cant cope", "stressed",
            "ashamed", "embarrassed", "confused", "helpless",
            "just found out", "just diagnosed", "told me i have",
        ])

        if not selected:
            # Fallback: no specific tool matched → use knowledge search
            if len(msg.split()) > 4 and not is_chitchat:
                selected.append("search_knowledge")
        elif len(msg.split()) > 5 and not is_chitchat:
            # Health tools fire: ALSO add knowledge search for supplementary
            # WHO document evidence (runs in parallel, doesn't block)
            has_health_tool = any(t in self._HEALTH_TOOLS for t in selected)
            if has_health_tool and "search_knowledge" not in selected:
                selected.append("search_knowledge")

        return selected[:3]  # Cap at 3 tools to bound latency

    def _build_tool_params(self, tool_name: str, message: str, pc) -> Dict:
        """Build params for each tool from message + patient context."""
        if tool_name == "search_knowledge":
            return {"query": message}
        base = {}
        if tool_name in ("find_facility", "get_diet_advice", "manage_hypertension",
                         "manage_diabetes", "assess_respiratory", "assess_cvd_risk"):
            base["region"] = pc.region
            if pc.conditions:
                base["conditions"] = pc.conditions
        if tool_name == "record_vitals":
            base["patient_id"] = pc.patient_id or ""
            bp_match = re.search(r'(\d{2,3})\s*/\s*(\d{2,3})', message)
            if bp_match:
                base["vital_type"] = "blood_pressure"
                base["value"] = f"{bp_match.group(1)}/{bp_match.group(2)}"
            else:
                glucose_match = re.search(r'\b(\d{2,3})\b', message)
                if glucose_match and ("sugar" in message.lower() or "glucose" in message.lower()):
                    base["vital_type"] = "blood_glucose"
                    base["value"] = glucose_match.group(1)
        if tool_name in ("get_medication_info", "check_ramadan"):
            meds = [m.get("name", "") for m in pc.medications] if pc.medications else []
            if meds:
                base["medications"] = meds
        if tool_name == "get_medication_info":
            # Try to extract a medication name from the user's message
            # (matches known DB entries first, else grabs the word after
            # "prescribed"/"given"/"taking")
            known = ["metformin", "amlodipine", "lisinopril", "hydrochlorothiazide",
                    "glibenclamide", "aspirin", "atorvastatin", "gliclazide",
                    "amoxicillin", "paracetamol", "ibuprofen", "losartan",
                    "simvastatin", "insulin"]
            msg_l = message.lower()
            for med in known:
                if med in msg_l:
                    base["medication_name"] = med
                    break
            if "medication_name" not in base:
                m = re.search(
                    r'(?:prescribed|gave me|given|taking|on)\s+([A-Za-z][A-Za-z\-]{2,})',
                    message, re.IGNORECASE,
                )
                if m:
                    base["medication_name"] = m.group(1).lower()
        if tool_name == "generate_care_plan":
            base["patient_id"] = pc.patient_id or ""
            base["conditions"] = pc.conditions or []
            base["medications"] = [m.get("name", "") for m in pc.medications] if pc.medications else []
            base["region"] = pc.region
        if tool_name == "get_diet_advice":
            base["condition"] = pc.conditions[0] if pc.conditions else "general"
        if tool_name == "assess_triage":
            base["symptoms"] = message
            if pc.conditions:
                base["conditions"] = pc.conditions
            if pc.medications:
                base["medications"] = [m.get("name", "") for m in pc.medications]
        if tool_name == "get_lifestyle_nudge":
            base["conditions"] = pc.conditions or []
        if tool_name == "suggest_community_support":
            msg_l = message.lower()
            if any(w in msg_l for w in ["husband", "family says", "won't let me", "wont let me", "permission"]):
                base["barrier_type"] = "permission"
            elif any(w in msg_l for w in ["ashamed", "embarrassed", "shame", "stigma"]):
                base["barrier_type"] = "stigma"
            elif any(w in msg_l for w in ["expensive", "afford", "cost", "money"]):
                base["barrier_type"] = "cost"
            elif any(w in msg_l for w in ["allah", "insha", "alhamd", "imam", "mosque", "religion"]):
                base["barrier_type"] = "religious"
                base["religious_context"] = True
            else:
                base["barrier_type"] = "fear"
        return base

    # Symptom/prescription phrases that usually need more detail
    SYMPTOM_KEYWORDS = [
        "pain", "ache", "hurts", "hurting", "sore", "fever", "cough",
        "dizzy", "dizziness", "nausea", "vomit", "swelling", "numb",
        "tingling", "rash", "bleeding", "headache", "stomach ache",
        "not feeling well", "feel sick", "feeling unwell", "symptom",
        "i feel", "i am feeling", "having trouble", "can't sleep",
        "cant sleep", "tired all the time", "weak", "dizziness",
        "itching", "burning", "stiff", "cramping", "cramps",
    ]
    PRESCRIPTION_KEYWORDS = [
        "prescribed", "prescription", "doctor gave me", "nurse gave me",
        "was given", "new medication", "new medicine", "new pill",
        "new tablet", "started taking", "just got", "paper from the doctor",
        "paper from doctor", "doctor wrote", "pharmacist gave",
        "look at my prescription", "read my prescription", "read this medicine",
        "tell me about this medicine", "what is this medicine", "check this medicine",
        "sent me home with", "took these pills", "supposed to take",
    ]
    DETAIL_MARKERS = [
        # Time-related
        "day", "days", "week", "weeks", "hour", "hours", "minute",
        "month", "months", "year", "years", "yesterday", "today", "morning",
        "evening", "night", "since",
        # Severity-related
        "mild", "moderate", "severe", "bad", "worse", "little",
        "/10", "out of 10", "1-10", "scale",
        # Location-related
        "left", "right", "upper", "lower", "chest", "head", "stomach",
        "back", "leg", "arm", "neck", "knee", "shoulder",
        # Prescription-detail
        "mg", "ml", "tablet", "pill", "twice", "once", "three times",
        "daily", "morning and", "500", "250", "1000", "50mg", "100mg",
    ]

    def _detect_form_suggestion(
        self, message: str, tools_used: List[str],
    ) -> Optional[str]:
        """Decide whether to nudge the user to fill a structured form.

        Returns 'symptom' | 'prescription' | None

        Logic:
          - If the message mentions symptoms/prescription but is short AND
            lacks concrete detail markers (duration, severity, dosage…),
            suggest the corresponding form.
          - If the message is already rich with detail, don't suggest anything —
            the user has given us enough to work with.
          - If the user is asking a general question (not about their own
            condition), don't suggest anything.
        """
        msg_l = message.lower()
        word_count = len(msg_l.split())

        # Count detail markers present. Use word-boundary matching to avoid
        # "day" matching inside "today", "left" matching "leftover", etc.
        detail_hits = 0
        for m in self.DETAIL_MARKERS:
            # Multi-word phrases: substring is fine
            if " " in m or "/" in m or "-" in m or any(c.isdigit() for c in m):
                if m in msg_l:
                    detail_hits += 1
            else:
                # Single word: word-boundary match
                if re.search(rf"\b{re.escape(m)}\b", msg_l):
                    detail_hits += 1

        has_symptom_kw = any(kw in msg_l for kw in self.SYMPTOM_KEYWORDS)
        has_rx_kw = any(kw in msg_l for kw in self.PRESCRIPTION_KEYWORDS)

        # Skip if this is a "what is" / "how do I" / "can I" info question
        info_question_markers = [
            "what is", "what are", "what causes", "how do i", "how can i",
            "can i", "should i", "is it", "are they", "why do",
        ]
        if any(m in msg_l for m in info_question_markers):
            return None

        # Prescription: mentioned but too short/thin
        if has_rx_kw and word_count < 15 and detail_hits < 2:
            return "prescription"

        # Symptom: mentioned but too short/thin
        # Only if assess_triage or emergency wasn't just the whole answer —
        # we want to ask for more info when the user was vague
        if has_symptom_kw and word_count < 14 and detail_hits < 2:
            return "symptom"

        return None

    async def generate_care_plan_from_conversation(
        self, session_id: str,
    ) -> Dict[str, Any]:
        """Build a personalised care plan by reading the conversation history,
        extracting the patient's conditions/medications/concerns with the LLM,
        then running the structured care_plan tool with that context.

        The result is cached in Redis for 7 days so it's always available.
        """
        memory = self.get_or_create_session(session_id)

        if not memory.messages:
            return {
                "error": "No conversation yet. Chat with Amina a bit first so she can tailor your plan.",
                "empty": True,
            }

        # Build a transcript string (last 20 messages)
        transcript = "\n".join(
            f"{m.role.upper()}: {m.content}" for m in memory.messages[-20:]
        )

        # Ask the LLM to extract structured context from the transcript
        extraction_prompt = f"""Read this conversation between a Gambian patient and Amina (healthcare assistant).
Extract structured information about the patient. Return ONLY valid JSON:

{{
  "conditions": ["diabetes", "hypertension", ...],
  "medications": ["metformin", "amlodipine", ...],
  "symptoms_mentioned": ["headache", "dizziness", ...],
  "concerns": ["can't afford medicine", "afraid to visit clinic", ...],
  "lifestyle_notes": ["smokes", "doesn't exercise", "Ramadan fasting", ...],
  "goals_from_patient": ["wants to lose weight", "wants to stop smoking", ...]
}}

CONVERSATION:
{transcript}

Return ONLY the JSON, no prose."""

        try:
            extraction = await self.client.chat.completions.create(
                model=self.model_name,
                messages=[{"role": "user", "content": extraction_prompt}],
                temperature=0.1,
                max_tokens=400,
            )
            extracted_text = extraction.choices[0].message.content or "{}"
            extracted_text = extracted_text.strip()
            if extracted_text.startswith("```"):
                extracted_text = re.sub(r"^```(?:json)?\s*", "", extracted_text)
                extracted_text = re.sub(r"```\s*$", "", extracted_text)
            ctx = json.loads(extracted_text)
        except Exception as e:
            logger.warning(f"Care plan extraction failed: {e}")
            ctx = {
                "conditions": memory.patient_context.conditions or [],
                "medications": [m.get("name", "") for m in (memory.patient_context.medications or [])],
                "symptoms_mentioned": [],
                "concerns": [],
                "lifestyle_notes": [],
                "goals_from_patient": [],
            }

        # Merge with stored patient context
        conditions = list({*(ctx.get("conditions") or []), *(memory.patient_context.conditions or [])})
        medications = list({*(ctx.get("medications") or []),
                           *(m.get("name", "") for m in (memory.patient_context.medications or []))})
        medications = [m for m in medications if m]

        # Run the structured care plan tool
        base_plan_result = await self.orchestrator.execute_tool(
            "generate_care_plan",
            patient_id=memory.patient_context.patient_id or "",
            conditions=conditions,
            medications=medications,
            region=memory.patient_context.region or "Kanifing",
        )
        base_plan = base_plan_result.get("result", {}) if base_plan_result.get("success") else {}

        # Use the LLM once more to add a personalised summary + priorities
        summary_prompt = f"""Based on the patient's conversation, write a warm 2-3 sentence personal summary
and pick their TOP 3 PRIORITY actions for this week. Use the patient's words and concerns.

Patient context:
- Conditions: {', '.join(conditions) or 'not specified'}
- Medications: {', '.join(medications) or 'not specified'}
- Symptoms mentioned: {', '.join(ctx.get('symptoms_mentioned') or []) or 'none'}
- Concerns: {', '.join(ctx.get('concerns') or []) or 'none'}
- Lifestyle: {', '.join(ctx.get('lifestyle_notes') or []) or 'not specified'}
- Patient's goals: {', '.join(ctx.get('goals_from_patient') or []) or 'not specified'}

Return ONLY JSON:
{{
  "personal_summary": "...",
  "top_priorities": ["priority 1", "priority 2", "priority 3"]
}}"""

        personal_summary = ""
        top_priorities: List[str] = []
        try:
            summ = await self.client.chat.completions.create(
                model=self.model_name,
                messages=[{"role": "user", "content": summary_prompt}],
                temperature=0.5,
                max_tokens=300,
            )
            stext = (summ.choices[0].message.content or "").strip()
            if stext.startswith("```"):
                stext = re.sub(r"^```(?:json)?\s*", "", stext)
                stext = re.sub(r"```\s*$", "", stext)
            sj = json.loads(stext)
            personal_summary = sj.get("personal_summary", "")
            top_priorities = sj.get("top_priorities", [])[:3]
        except Exception as e:
            logger.warning(f"Care plan summary failed: {e}")
            personal_summary = "Amina is tracking your progress."
            top_priorities = (base_plan.get("goals") or [])[:3]

        # Assemble final plan
        final_plan = {
            **base_plan,
            "session_id": session_id,
            "generated_at": datetime.now().isoformat(),
            "personal_summary": personal_summary,
            "top_priorities": top_priorities,
            "extracted_context": ctx,
        }

        # Cache for 7 days
        await self.memory_manager.save_care_plan(session_id, final_plan)

        return final_plan

    def _build_templated_greeting(
        self, greeting_ctx: Dict[str, Any], memory,
        referral: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Construct a zero-LLM greeting line combining time-of-day, trust tier,
        ethnic language, special days, VHW endorsement, and user role (Alkalo/VHW).

        This runs in ~100us — pure string assembly.
        """
        time_ctx = greeting_ctx["time"]
        trust = greeting_ctx["trust"]
        special = greeting_ctx["special_day"]
        signals = greeting_ctx["signals"]
        intention = greeting_ctx["intention"]

        # Urgent hour or crisis intention → skip warm greeting
        if intention["intention"] == "EMERGENCY":
            return ""  # emergency protocol already handles this
        if signals.get("unusual_hour") and intention["intention"] in ("IN_PAIN", "EMERGENCY"):
            return "Salaam aleikum. It is late — tell me what is happening."

        # ROLE-BASED REGISTER — Alkalo / VHW / Imam get special greetings
    
        role = getattr(memory, "user_role", None)
        if role == "alkalo":
            name = memory.patient_context.name or ""
            addr = f"Alkalo {name}" if name else "Alkalo"
            return (
                f"Salaam aleikum, {addr}. I greet you with the respect of your position. "
                "Your village's health is my concern. How can I serve you today?"
            )
        if role == "vhw":
            name = memory.patient_context.name or ""
            addr = f"VHW {name}" if name else "VHW"
            return (
                f"Salaam aleikum, {addr}. Thank you for the work you do. "
                "Are you checking in on a patient or asking for yourself?"
            )
        if role == "imam":
            name = memory.patient_context.name or ""
            addr = f"Imam {name}" if name else "Imam"
            return (
                f"Salaam aleikum, {addr}. May Allah bless your work. "
                "How can I help you today?"
            )
        if role == "scout":
            # Scout gets a personalized greeting with duties + badge + elders status
            try:
                from src.services.community_admin import CommunityAdminService
                admin = CommunityAdminService(self.memory_manager.redis)
                import asyncio
                # We're in an async context, but _build_templated_greeting is sync.
                # Use the cached scout data if available, otherwise default greeting.
                raw = self.memory_manager.redis.get("community:scout:default")
                if raw:
                    import json as _json
                    scout_data = _json.loads(raw)
                    greeting_text = admin._get_scout_greeting(scout_data)
                    return f"Salaam aleikum. {greeting_text}"
            except Exception:
                pass
            name = memory.patient_context.name or "Scout"
            return (
                f"Salaam aleikum, {name}! Welcome back. "
                "Check your elders this week and report any high BP to your VHW."
            )

        # Always start with "Salaam aleikum" (universal, 95% Muslim)
        parts = ["Salaam aleikum."]

        # Time-of-day greeting (Mandinka by default; user's language picks up if detected later)
        time_greeting = time_ctx["mandinka_greeting"]
        if time_greeting and time_greeting != "Salaam aleikum.":
            parts.append(time_greeting)

        # Trust-tier personalisation
        name = memory.patient_context.name or ""
        if trust["tier"] == "stranger":
            if name:
                parts.append(f"{name}, welcome.")
            else:
                parts.append("Welcome.")
        elif trust["tier"] == "acquaintance":
            if name:
                parts.append(f"{name}, I be di?")
            else:
                parts.append("I be di?")
        elif trust["tier"] == "companion":
            if name:
                parts.append(f"Ah {name}! I was thinking about you. I be di?")
            else:
                parts.append("I was thinking about you. I be di?")
        else:  # family (Month 4+)
            # Rotate 3 playful openers deterministically by day-of-year so the
            # same patient on the same day gets the same message (not random).
            doy = datetime.now().timetuple().tm_yday
            family_openers = [
                "Tanante! I be di?",
                "Ah, it has been some days! How is the compound?",
                "I saw the sun and thought of you. I be di?",
            ]
            opener = family_openers[doy % len(family_openers)]
            if name:
                parts.append(f"{name}! {opener}")
            else:
                parts.append(opener)

        # Returning-after-absence softener
        if trust["is_returning_user"] and trust["tier"] != "stranger":
            parts.append("Welcome back.")

        # VHW endorsement — only on first-ever call (trust=stranger)
        if referral and trust["tier"] == "stranger":
            from src.services.referrals import build_vhw_greeting_line
            parts.append(build_vhw_greeting_line(referral))

        # Special day modifier (Jummah, Lumo)
        if special:
            parts.append(special["modifier"])

        return " ".join(parts).strip()

    def _get_citations(self, tools_used: List[str], message: str, response: str = "") -> List[Dict]:
        """Return source citations only when Amina shares substantive health info."""
        try:
            from src.services.citations import get_citations
            return get_citations(tools_used, message, response=response, max_citations=3)
        except Exception:
            return []

    def get_or_create_session(self, session_id: str) -> ConversationMemory:
        if session_id not in self.sessions:
            memory = ConversationMemory()
            memory.session_id = session_id
            # HYDRATE from Redis so cross-worker turns have conversation history
            try:
                import json as _json
                raw = self.memory_manager.redis.get(f"session:{session_id}")
                if raw:
                    session_data = _json.loads(raw)
                    for m in session_data.get("messages", [])[-10:]:
                        memory.add_message(m["role"], m["content"], m.get("tools_used", []))
            except Exception:
                pass
            self.sessions[session_id] = memory
        return self.sessions[session_id]

    # ── Chat-export intent (pre-LLM) ──────────────────────────────────────
    # Patterns that mean "the user is asking AMINA to export the
    # conversation as a PDF". Kept deliberately narrow so we don't
    # hijack unrelated chat about PDFs or documents.
    _EXPORT_PDF_PATTERNS = [
        # "send/give/make/download/export/save me a pdf of the chat/conversation"
        r"\b(send|give|get|make|create|download|export|save|share)\b[^.?!]*\bpdf\b[^.?!]*\b(chat|conversation|talk|transcript|messages?)\b",
        # "pdf of the chat/conversation"
        r"\bpdf\b[^.?!]*\b(of|from|for)\b[^.?!]*\b(chat|conversation|talk|transcript|messages?)\b",
        # "chat/conversation to pdf", "chat as pdf"
        r"\b(chat|conversation|transcript|messages?)\b[^.?!]*\b(to|as|into)\b[^.?!]*\bpdf\b",
        # "download/export/save the chat/conversation"
        r"\b(download|export|save)\b[^.?!]*\b(the\s+|this\s+|our\s+|whole\s+|entire\s+)?(chat|conversation|transcript|messages?)\b",
        # "can I get a pdf", "can you send a pdf" (as a pdf request, anywhere)
        r"\b(can|could|would|please|pls)\b[^.?!]*\b(send|give|make|download|export|save|share)\b[^.?!]*\bpdf\b",
    ]

    def check_chat_export_intent(self, message: str) -> bool:
        """True if the user is asking to export the chat transcript as a PDF.

        This runs BEFORE the LLM so trivial "send me a pdf of our chat"
        requests bypass reasoning and return an immediate download action.
        """
        if not message:
            return False
        import re as _re
        text = message.lower().strip()
        # Cheap early-out: must mention a document format or an export verb
        if not any(k in text for k in ("pdf", "download", "export", "save", "share")):
            return False
        for pat in self._EXPORT_PDF_PATTERNS:
            if _re.search(pat, text):
                return True
        return False

    async def check_emergency(self, message: str) -> Optional[Dict]:
        """Check for emergency indicators FIRST before any other processing."""
        emergency_keywords = [
            "chest pain", "can't breathe", "cant breathe", "difficulty breathing",
            "heart attack", "stroke", "can't see", "vision loss", "fainting", "fainted",
            "unconscious", "severe pain", "bleeding heavily", "seizure",
            "overdose", "suicide", "want to die", "kill myself",
            # Added after E2E testing — these catch real emergency reports
            "collapsed", "passed out", "not breathing", "face drooping",
            "face is drooping", "can't speak", "cant speak", "slurred speech",
            "sudden weakness", "sudden headache", "worst headache",
        ]

        message_lower = message.lower()
        for keyword in emergency_keywords:
            if keyword in message_lower:
                emergency_result = await self.orchestrator.execute_tool(
                    "check_emergency",
                    symptoms=message,
                    region="Kanifing",
                )
                if emergency_result.get("success"):
                    return emergency_result.get("result")
        return None

    async def process_message(
        self,
        message: str,
        session_id: str,
        patient_id: Optional[str] = None,
        patient_name: Optional[str] = None,
        phone: Optional[str] = None,
        channel: str = "web",
        user_role: Optional[str] = None,
        regenerate_hint: Optional[str] = None,
        model_preference: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Main agent processing loop using ReAct pattern with 3-tier memory.

        model_preference: "amina" → use AMINA v2 fine-tuned model
                          "base"  → use OpenAI (gpt-4o-mini)
                          None    → use default (controlled by USE_FINETUNED_MODEL)
        """

        # Per-request model selection
        if model_preference == "amina" and self.amina_client:
            _client = self.amina_client
            _model = self.amina_model_name
        elif model_preference == "gemini" and self.gemini_client:
            _client = self.gemini_client
            _model = self.gemini_model_name
        elif model_preference == "groq" and self.groq_client:
            _client = self.groq_client
            _model = self.groq_model_name
        elif model_preference == "mistral" and self.mistral_client:
            _client = self.mistral_client
            _model = self.mistral_model_name
        elif model_preference == "base":
            _client = self.openai_client
            _model = self.openai_model_name
        else:
            _client = self.client
            _model = self.model_name

        memory = self.get_or_create_session(session_id)

        # Step 0a: CHAT-EXPORT INTENT — pre-LLM shortcut. If the user is
        # asking "send me a pdf of our chat", acknowledge, tell the
        # frontend to trigger the download, and skip the LLM entirely.
        if self.check_chat_export_intent(message):
            export_ack = (
                "Here's a PDF of our conversation so far. Your download "
                "should start automatically in a moment. If it doesn't, "
                "tap the \"Download chat (PDF)\" button in the quick "
                "actions row."
            )
            memory.add_message("user", message)
            memory.add_message("assistant", export_ack, ["export_chat_pdf"])
            try:
                await self.memory_manager.add_message_to_session(session_id, "user", message)
                await self.memory_manager.add_message_to_session(
                    session_id, "assistant", export_ack, ["export_chat_pdf"],
                )
            except Exception as _e:
                logger.debug(f"chat-export memory persist failed: {_e}")
            return {
                "response": export_ack,
                "triage_level": "ROUTINE",
                "tools_used": ["export_chat_pdf"],
                "is_emergency": False,
                "export_action": {
                    "type": "download_chat_pdf",
                    "session_id": session_id,
                },
            }

        # Step 0: EMERGENCY CHECK — always first (bypasses ritual)
        emergency = await self.check_emergency(message)
        if emergency and emergency.get("is_emergency"):
            memory.add_message("user", message)
            emergency_response = self._format_emergency_response(emergency)
            memory.add_message("assistant", emergency_response, ["check_emergency"])

            # Persist to Redis (Tier 1)
            await self.memory_manager.add_message_to_session(session_id, "user", message)
            await self.memory_manager.add_message_to_session(
                session_id, "assistant", emergency_response, ["check_emergency"],
            )

            return {
                "response": emergency_response,
                "triage_level": "EMERGENCY",
                "tools_used": ["check_emergency"],
                "followup": "Immediate - Call 199 or go to EFSTH",
                "is_emergency": True,
            }

        # Step 1: Resolve patient identity
        # Auto-detect patient_id from session_id format: s_P_FATOU_timestamp_random
        if not patient_id and session_id.startswith("s_P_"):
            parts = session_id.split("_")
            if len(parts) >= 3:
                patient_id = f"P_{parts[2]}"  # e.g., "P_FATOU"

        # If phone given (SMS/voice), use MemoryManager to get/create profile
        # If patient_id given (web), load from tools
        if phone and not memory.patient_context.patient_id:
            try:
                profile = await self.memory_manager.get_or_create_patient(phone)
                memory.update_patient_context(
                    patient_id=profile.id,
                    name=profile.name,
                    age=profile.age,
                    gender=profile.gender,
                    region=profile.region,
                    conditions=profile.conditions,
                    medications=profile.medications,
                    allergies=profile.allergies,
                    emergency_contact=profile.emergency_contact,
                )
                patient_id = profile.id
                await self.memory_manager.link_patient_to_session(profile.id, session_id)
            except Exception as e:
                logger.warning(f"Failed to resolve patient by phone: {e}")

        if patient_id and not memory.patient_context.patient_id:
            # Try loading from ArcadeDB PatientVertex first (richer data)
            try:
                from src.utils.arcade_client import async_command_sql, extract_rows
                resp = await async_command_sql(
                    "SELECT * FROM PatientVertex WHERE id = :pid LIMIT 1",
                    [patient_id],
                )
                rows = extract_rows(resp)
                if rows:
                    p = rows[0]
                    for field in ("conditions", "medications", "allergies", "key_facts"):
                        val = p.get(field, "[]")
                        if isinstance(val, str):
                            p[field] = json.loads(val)
                    memory.update_patient_context(
                        patient_id=p.get("id"),
                        name=p.get("name"),
                        age=p.get("age"),
                        gender=p.get("gender"),
                        region=p.get("region"),
                        conditions=p.get("conditions", []),
                        medications=p.get("medications", []),
                        allergies=p.get("allergies", []),
                        emergency_contact=p.get("emergency_contact"),
                    )
                    # Store key facts for context injection
                    memory.key_facts = p.get("key_facts", [])
            except Exception as e:
                logger.warning(f"Failed to load patient from ArcadeDB: {e}")
                # Fallback to tool-based lookup
                patient_result = await self.orchestrator.execute_tool(
                    "get_patient", patient_id=patient_id,
                )
                if patient_result.get("success") and patient_result.get("result"):
                    memory.update_patient_context(**patient_result["result"])

        # Fallback: if name still missing but client sent it directly (DB may be empty/wiped)
        if patient_name and not memory.patient_context.name:
            memory.update_patient_context(
                patient_id=patient_id or memory.patient_context.patient_id,
                name=patient_name,
            )

        # Step 2: Add user message to in-process memory AND Redis (Tier 1)
        memory.add_message("user", message)
        await self.memory_manager.add_message_to_session(session_id, "user", message)

        # Step 2b: Determine if this is TRULY the first turn.
        # Check Redis (cross-worker) not just local memory (worker-local).
        # This prevents greeting duplication when requests hit different workers.
        is_first_turn = len(memory.messages) == 1
        if is_first_turn:
            try:
                redis_msgs = await self.memory_manager.get_session_messages(session_id)
                # Redis already has messages from a prior worker → NOT first turn
                if len(redis_msgs) > 1:
                    is_first_turn = False
            except Exception:
                pass
        if is_first_turn:
            try:
                stats = await self.memory_manager.touch_patient_stats(session_id)
                memory.interaction_count = stats["interaction_count"]
                memory.days_since_first_call = stats["days_since_first_call"]
                memory.days_since_last_call = stats["days_since_last_call"]
            except Exception as e:
                logger.warning(f"touch_patient_stats failed: {e}")

        # Step 3: Build greeting+intention+signal context (zero LLM, ~5ms)
        # Hydrate cross-worker state from Redis
        if is_first_turn:
            try:
                memory.ritual_phase = await self.memory_manager.get_ritual_phase(session_id)
                memory.ethnic_language = await self.memory_manager.get_ethnic_language(session_id)
            except Exception:
                pass

        from src.services.greeting import build_greeting_context
        greeting_ctx = build_greeting_context(
            message=message,
            interaction_count=memory.interaction_count,
            days_since_first_call=memory.days_since_first_call,
            days_since_last_call=memory.days_since_last_call,
        )
        # Persist detected ethnic language for the session
        if greeting_ctx["ethnic_language"]["confidence"] != "low":
            memory.ethnic_language = greeting_ctx["ethnic_language"]["language"]
            try:
                await self.memory_manager.set_ethnic_language(session_id, memory.ethnic_language)
            except Exception:
                pass

        # Apply explicit user_role if provided (alkalo/vhw/imam/patient)
        if user_role and user_role in ("alkalo", "vhw", "imam", "clinician", "scout"):
            memory.user_role = user_role

        # Look up VHW referral (one-shot, first-turn only)
        referral = None
        if is_first_turn:
            try:
                from src.services.referrals import ReferralStore
                store = ReferralStore(self.memory_manager.redis)
                referral = await store.get_referral(session_id, phone)
                if referral and not referral.get("consumed"):
                    await store.consume_referral(session_id, phone)
                else:
                    referral = None  # ignore already-consumed referrals
            except Exception as e:
                logger.warning(f"Referral lookup failed: {e}")

        # Build the greeting line (templated, no LLM)
        greeting = ""
        if is_first_turn:
            greeting = self._build_templated_greeting(greeting_ctx, memory, referral=referral)
            # "Welcome back" injection for returning patients with known history
            pc = memory.patient_context
            if pc.patient_id and pc.name and memory.interaction_count >= 2:
                # Fetch last visit info for personalized welcome
                try:
                    last_consults = await self.memory_manager.get_patient_consultations(pc.patient_id, limit=1)
                    if last_consults:
                        last_date = (last_consults[0].get("started_at") or "")[:10]
                        last_summary = last_consults[0].get("summary", "")
                        if last_date and last_summary:
                            greeting += f" Last time we spoke was {last_date}."
                except Exception:
                    pass
                # Check for commitments to follow up on
                key_facts = getattr(memory, "key_facts", []) or []
                commitments = [f for f in key_facts if f.startswith("Committed")]
                if commitments:
                    latest = commitments[-1].replace("Committed on ", "You said on ").rstrip(".")
                    greeting += f" {latest} — how did that go?"

        # Step 3b: GREETING RITUAL (voice/sms/whatsapp channels ONLY).
        # Short-circuits the LLM when we're in the middle of the cultural
        # ritual — returns a templated response in ~5ms.
        from src.services.greeting import (
            is_ritual_channel, should_bypass_ritual, get_ritual_response,
        )
        if is_ritual_channel(channel):
            # Hydrate ritual_phase from Redis if we don't have it yet
            if memory.ritual_phase == -1 and not is_first_turn:
                try:
                    memory.ritual_phase = await self.memory_manager.get_ritual_phase(session_id)
                except Exception:
                    pass

            # Ritual NOT started yet (-1) — this is the first-ever message
            if memory.ritual_phase == -1:
                if should_bypass_ritual(message):
                    memory.ritual_phase = 3
                    await self.memory_manager.set_ritual_phase(session_id, 3)
                elif memory.interaction_count >= 5:
                    memory.ritual_phase = 3
                    await self.memory_manager.set_ritual_phase(session_id, 3)
                else:
                    memory.ritual_phase = 0
                    await self.memory_manager.set_ritual_phase(session_id, 0)
                    ritual_reply = greeting
                    memory.add_message("assistant", ritual_reply, ["greeting_ritual"])
                    await self.memory_manager.add_message_to_session(
                        session_id, "assistant", ritual_reply, ["greeting_ritual"],
                    )
                    return {
                        "response": ritual_reply,
                        "triage_level": None,
                        "tools_used": ["greeting_ritual"],
                        "followup": None,
                        "is_emergency": False,
                        "session_id": session_id,
                        "intention": "GREETING_RITUAL",
                        "trust_tier": greeting_ctx["trust"]["tier"],
                        "ethnic_language": memory.ethnic_language,
                        "ritual_phase": 0,
                    }
            # Ritual IN PROGRESS (0-2) — advance
            elif 0 <= memory.ritual_phase < 3:
                if should_bypass_ritual(message):
                    memory.ritual_phase = 3
                    await self.memory_manager.set_ritual_phase(session_id, 3)
                else:
                    next_phase = memory.ritual_phase + 1
                    ritual_reply = get_ritual_response(
                        memory.ritual_phase, memory.ethnic_language,
                    )
                    memory.ritual_phase = next_phase
                    await self.memory_manager.set_ritual_phase(session_id, next_phase)
                    if ritual_reply:
                        memory.add_message("assistant", ritual_reply, ["greeting_ritual"])
                        await self.memory_manager.add_message_to_session(
                            session_id, "assistant", ritual_reply, ["greeting_ritual"],
                        )
                        return {
                            "response": ritual_reply,
                            "triage_level": None,
                            "tools_used": ["greeting_ritual"],
                            "followup": None,
                            "is_emergency": False,
                            "session_id": session_id,
                            "intention": "GREETING_RITUAL",
                            "trust_tier": greeting_ctx["trust"]["tier"],
                            "ethnic_language": memory.ethnic_language,
                            "ritual_phase": next_phase,
                        }

        # Step 3c: Extract + store vitals deterministically for trend callbacks.
        # Runs in ~1ms. Produces a safe callback line like
        # "Last week 160/100, today 145/90 — better by 15 points."
        vitals_callback = ""
        vitals_trend_data = None
        bp_match = re.search(r'(\d{2,3})\s*/\s*(\d{2,3})', message)
        gl_match = re.search(r'\b(\d{2,3})\b', message) if not bp_match else None
        if bp_match:
            bp_value = f"{bp_match.group(1)}/{bp_match.group(2)}"
            # Get PREVIOUS trend BEFORE recording new reading
            prev_trend = await self.memory_manager.get_vital_trend(session_id, "bp")
            # Now record this new reading
            await self.memory_manager.record_vital_reading(session_id, "bp", bp_value)
            # Outcome tracking: link this reading to previous advice
            if memory.patient_context.patient_id:
                from src.services.learning import track_outcome
                asyncio.create_task(track_outcome(
                    memory.patient_context.patient_id, "bp", bp_value,
                    self.memory_manager.redis,
                ))
            # Build callback from the prior trend
            if prev_trend.get("count", 0) >= 1 and prev_trend.get("current"):
                prev_reading = prev_trend["current"]
                # Compute delta between the new reading and the stored one
                try:
                    cs, cd = [int(x) for x in bp_value.split("/")]
                    ps, pd = [int(x) for x in prev_reading.split("/")]
                    ds, dd = cs - ps, cd - pd
                    if ds <= -3 and dd <= -3:
                        vitals_callback = f"Last time {prev_reading}, today {bp_value} — better by {abs(ds)}/{abs(dd)} points."
                        vitals_trend_data = {"type": "bp", "prev": prev_reading, "current": bp_value, "trend": "improving"}
                    elif ds >= 5 or dd >= 5:
                        vitals_callback = f"Last time {prev_reading}, today {bp_value} — higher by {ds}/{dd}."
                        vitals_trend_data = {"type": "bp", "prev": prev_reading, "current": bp_value, "trend": "worsening"}
                    else:
                        vitals_callback = f"Last time {prev_reading}, today {bp_value} — similar."
                        vitals_trend_data = {"type": "bp", "prev": prev_reading, "current": bp_value, "trend": "stable"}
                except Exception:
                    pass
        elif gl_match and any(w in message.lower() for w in ["sugar", "glucose", "sugar was", "sugar is"]):
            gl_value = gl_match.group(1)
            prev_trend = await self.memory_manager.get_vital_trend(session_id, "glucose")
            await self.memory_manager.record_vital_reading(session_id, "glucose", gl_value)
            # Outcome tracking for glucose
            if memory.patient_context.patient_id:
                from src.services.learning import track_outcome
                asyncio.create_task(track_outcome(
                    memory.patient_context.patient_id, "glucose", gl_value,
                    self.memory_manager.redis,
                ))
            if prev_trend.get("count", 0) >= 1 and prev_trend.get("current"):
                prev_reading = prev_trend["current"]
                try:
                    c = float(gl_value)
                    p = float(prev_reading)
                    d = round(c - p, 1)
                    if d <= -10:
                        vitals_callback = f"Last time sugar was {prev_reading}, today {gl_value} — better by {abs(d):.0f}."
                        vitals_trend_data = {"type": "glucose", "prev": prev_reading, "current": gl_value, "trend": "improving"}
                    elif d >= 15:
                        vitals_callback = f"Last time sugar was {prev_reading}, today {gl_value} — higher by {d:.0f}."
                        vitals_trend_data = {"type": "glucose", "prev": prev_reading, "current": gl_value, "trend": "worsening"}
                    else:
                        vitals_callback = f"Last time {prev_reading}, today {gl_value} — similar."
                        vitals_trend_data = {"type": "glucose", "prev": prev_reading, "current": gl_value, "trend": "stable"}
                except Exception:
                    pass

        # Step 3d: JOURNEY CALLBACKS — multi-month "since we started" comparisons.
        # Only fires when we have 3+ readings spanning 7+ days (deterministic).
        # Zero LLM, pure Redis list fetch + arithmetic (~3ms).
        journey_callback = ""
        journey_data = None
        anniversary_data = None
        try:
            from src.services.journey import build_journey_callback, build_anniversary_callback
            # BP journey (only if we just recorded a BP reading)
            if bp_match:
                bp_readings = await self.memory_manager.get_vital_readings_raw(session_id, "bp")
                jc = build_journey_callback("bp", bp_readings)
                if jc:
                    journey_callback = jc["message"]
                    journey_data = jc
            # Glucose journey
            elif gl_match and any(w in message.lower() for w in ["sugar", "glucose"]):
                gl_readings = await self.memory_manager.get_vital_readings_raw(session_id, "glucose")
                jc = build_journey_callback("glucose", gl_readings)
                if jc:
                    journey_callback = jc["message"]
                    journey_data = jc
            # Anniversary (30/90/180/365-day milestones) — fires on first-turn only
            if is_first_turn:
                ann = build_anniversary_callback(
                    memory.days_since_first_call, memory.interaction_count,
                )
                if ann:
                    anniversary_data = ann
                    # Prepend anniversary to journey callback if not already set
                    if not journey_callback:
                        journey_callback = ann["message"]
        except Exception as e:
            logger.warning(f"Journey callback build failed: {e}")

        # Step 4: Build context — now enriched with semantic memory (Tier 2+3)
        context = await self._build_context(memory, message)

        # Step 4b: MEDICATION SAFETY GATE — runs BEFORE LLM, BEFORE tool routing.
        # If the query is a medication request/dosage/interaction → BLOCK the LLM
        # entirely and return a safe templated response. Zero LLM calls.
        from src.safety.medication_gate import MedicationSafetyGate
        from src.safety.medication_responses import get_medication_response
        from src.safety.audit_log import log_medication_query

        med_gate = MedicationSafetyGate()
        med_intent, med_action = med_gate.classify(message)

        if med_gate.should_block_llm(med_action):
            # BLOCKED — return safe templated response, no LLM call
            lang = "en"  # TODO: use session language
            # For BLOCK_WITH_FIRST_AID, detect the acute scenario for
            # scenario-specific interim care (eat honey, sit and breathe, etc.)
            acute_scenario = med_gate._detect_acute_scenario(message.lower()) if med_action == "BLOCK_WITH_FIRST_AID" else None
            med_resp = get_medication_response(med_intent.value, lang, acute_scenario=acute_scenario)
            safe_response = med_resp["response"] or "Please visit your nearest health centre for medication advice."

            # Prepend greeting on first turn
            if greeting:
                safe_response = f"{greeting} {safe_response}"

            memory.add_message("assistant", safe_response, ["medication_safety_gate"])
            await self.memory_manager.add_message_to_session(
                session_id, "assistant", safe_response, ["medication_safety_gate"],
            )

            # Audit log (async, non-blocking)
            asyncio.create_task(log_medication_query(
                self.memory_manager.redis, session_id, message,
                med_intent.value, med_action, safe_response,
            ))

            # DHIS2 daily counter — safety gate block
            try:
                from src.services.dhis2_sync import bump_daily_counter
                _region = (getattr(memory.patient_context, "region", "") or "").lower() or "unknown"
                bump_daily_counter(_region, "AMINA_SAFETY_BLOCKS", amount=1)
            except Exception:
                pass

            # Build context-aware citations based on what the patient asked about
            med_sources = []
            msg_l = message.lower()
            if any(w in msg_l for w in ["diabetes", "sugar", "glucose", "metformin", "insulin"]):
                med_sources.append({"title": "WHO PEN — Diabetes Protocol", "url": "https://www.who.int/publications/i/item/who-pen-protocol-1", "org": "WHO"})
            if any(w in msg_l for w in ["blood pressure", "bp", "hypertension", "amlodipine", "lisinopril"]):
                med_sources.append({"title": "WHO PEN — Cardiovascular Risk Management", "url": "https://www.who.int/publications/i/item/9789240009226", "org": "WHO"})
            if any(w in msg_l for w in ["asthma", "inhaler", "breathing", "copd", "wheezing"]):
                med_sources.append({"title": "WHO PEN — Respiratory Disease Protocol", "url": "https://www.who.int/publications/i/item/who-pen-protocol-4", "org": "WHO"})
            if any(w in msg_l for w in ["ramadan", "fasting", "suhoor", "iftar"]):
                med_sources.append({"title": "IDF-DAR — Diabetes and Ramadan Guidelines", "url": "https://idf.org/our-activities/education/diabetes-and-ramadan.html", "org": "IDF"})
            # Always include WHO PEN as fallback if no specific match
            if not med_sources:
                med_sources.append({"title": "WHO PEN — Package of Essential NCD Interventions", "url": "https://www.who.int/publications/i/item/9789240009226", "org": "WHO"})
            # Cap at 3
            med_sources = med_sources[:3]

            return {
                "response": safe_response,
                "triage_level": "EMERGENCY" if med_action == "EMERGENCY" else None,
                "tools_used": ["medication_safety_gate"],
                "followup": "Immediate - Call 199" if med_action == "EMERGENCY" else None,
                "is_emergency": med_action == "EMERGENCY",
                "session_id": session_id,
                "suggest_form": med_resp.get("suggest_form"),
                "suggest_notifications": False,
                "intention": med_intent.value,
                "trust_tier": greeting_ctx["trust"]["tier"],
                "ethnic_language": greeting_ctx["ethnic_language"]["language"],
                "sources": med_sources,
                "medication_blocked": True,
                "medication_action": med_resp.get("action"),
            }

        # For ALLOW_CAUTION / ALLOW_EDUCATION — log the query but let the LLM proceed
        # (the system prompt will prevent it from prescribing)
        if med_action not in ("PASS",):
            asyncio.create_task(log_medication_query(
                self.memory_manager.redis, session_id, message,
                med_intent.value, med_action, "allowed_to_llm",
            ))

        # Step 5: Route tools and execute
        tools_used = []
        observations = []
        _routing_source = "keyword"

        try:
            # ── LLM Tool Router (Transformation 2, flag-gated) ─────────────
            # When USE_LLM_TOOL_ROUTER is true, keyword matches are checked
            # for confidence first. High-confidence matches use the fast-path
            # (identical to current behavior). Low/medium-confidence or no
            # matches go through a small LLM call for smarter routing.
            # When the flag is false, this entire block is skipped.
            if settings.USE_LLM_TOOL_ROUTER:
                try:
                    from src.services.llm_tool_router import route_tools_llm, execute_agentic_loop
                    _keyword_matches = self._route_tools(message)
                    _route_result = await route_tools_llm(
                        message=message,
                        keyword_matches=_keyword_matches,
                        patient_context=memory.patient_context,
                        dialogue_state=_dialogue_state_obj,
                    )
                    tools_to_run = _route_result.get("tools", [])
                    _requires_seq = _route_result.get("requires_sequential", False)
                    _routing_source = _route_result.get("source", "llm")

                    if tools_to_run:
                        tools_used, observations = await execute_agentic_loop(
                            orchestrator=self.orchestrator,
                            tools_to_run=tools_to_run,
                            build_params_fn=self._build_tool_params,
                            message=message,
                            patient_context=memory.patient_context,
                            requires_sequential=_requires_seq,
                        )
                except Exception as _llm_route_err:
                    logger.warning(f"LLM tool router failed, falling back to keyword: {_llm_route_err}")
                    # Fall through to keyword routing below
                    tools_used = []
                    observations = []
                    _routing_source = "keyword_fallback"

            # Original keyword routing (used when flag is off, or as fallback)
            if (not settings.USE_LLM_TOOL_ROUTER) or (_routing_source == "keyword_fallback"):
                tools_to_run = self._route_tools(message)
                if tools_to_run:
                    tool_tasks = []
                    for tool_name in tools_to_run:
                        params = self._build_tool_params(tool_name, message, memory.patient_context)
                        tool_tasks.append(self.orchestrator.execute_tool(tool_name, **params))

                    results = await asyncio.gather(*tool_tasks, return_exceptions=True)
                    for tool_name, result in zip(tools_to_run, results):
                        tools_used.append(tool_name)
                        if isinstance(result, Exception):
                            observations.append({"tool": tool_name, "result": f"error: {result}"})
                        else:
                            observations.append({
                                "tool": tool_name,
                                "result": result.get("result") if result.get("success") else result.get("error"),
                            })

            # Detect early if we'll need a structured form so we can tell
            # the agent to ask for it
            early_form_suggestion = self._detect_form_suggestion(message, tools_used)
            form_instruction = ""
            # How many times have we already nudged for this form?
            prompts_so_far = memory.form_prompts_given.get(early_form_suggestion or "", 0) if early_form_suggestion else 0

            if early_form_suggestion == "symptom":
                if prompts_so_far == 0:
                    # First time — give advice + gently offer the form
                    form_instruction = (
                        "\n\nIMPORTANT — user described symptoms briefly. Your job:\n"
                        "1. GIVE SAFE GENERAL ADVICE based on what they DID say (rest, hydration, monitoring, typical causes, when to seek care).\n"
                        "2. ASK ONE natural follow-up question to learn more (e.g. 'How long has it been?' or 'How bad is it on a scale of 1–10?').\n"
                        "3. At the END, gently mention: 'If you want me to assess this more precisely, tap the Symptom button to fill a short form.'\n"
                        "4. DO NOT refuse to help. DO NOT force them to use the form. DO NOT diagnose firmly from limited info.\n"
                    )
                else:
                    # They've seen the form offer — gather info conversationally
                    form_instruction = (
                        "\n\nIMPORTANT — user described symptoms briefly and you already mentioned the form before. Your job now:\n"
                        "1. DO NOT mention the Symptom form again. The user prefers to chat.\n"
                        "2. Give safe, practical general advice for what they described.\n"
                        "3. Ask ONE specific follow-up question each turn to build a fuller picture over the conversation.\n"
                        "4. If you have gathered enough (duration + severity + location OR associated symptoms), give a triage opinion.\n"
                        "5. Always mention emergency signs to watch for.\n"
                    )
            elif early_form_suggestion == "prescription":
                if prompts_so_far == 0:
                    form_instruction = (
                        "\n\nIMPORTANT — user mentioned a prescription without details. Your job:\n"
                        "1. ASK them warmly what medicine, dosage, and how often they were told to take it.\n"
                        "2. Once you know the medication name, you can give general guidance (with food, common side effects, etc.).\n"
                        "3. Gently mention at the END: 'If it's easier, you can tap Upload Rx to send a photo, or tap Rx to fill in the details.'\n"
                        "4. DO NOT guess medication names. DO NOT force them to use the form.\n"
                    )
                else:
                    form_instruction = (
                        "\n\nIMPORTANT — you already mentioned the Rx form. Now:\n"
                        "1. DO NOT mention the Rx form again.\n"
                        "2. Ask ONE specific question about the medication each turn (name first, then dose, then frequency, then how long).\n"
                        "3. Once you know the medication name, give general safe guidance even if other details are missing.\n"
                    )

            # Track that we're about to send a form prompt
            if early_form_suggestion:
                memory.form_prompts_given[early_form_suggestion] = prompts_so_far + 1

            # Load behavior profile for assertiveness calibration
            behavior_profile = None
            try:
                raw_bp = self.memory_manager.redis.get(f"behavior:{pc.patient_id}")
                if raw_bp:
                    behavior_profile = json.loads(raw_bp)
            except Exception:
                pass

            # v2.0: Multi-signal conversation intent classification
            conv_intent = classify_conversation_intent(
                message,
                conversation_history=[{"role": m.role, "content": m.content} for m in memory.messages[-6:]],
                behavior_profile=behavior_profile,
                turn_count=len([m for m in memory.messages if m.role == "user"]),
            )
            is_goodbye = conv_intent["intent"] == "closing"
            closing_instruction = conv_intent.get("closing_instruction", "")

            # Step 6: Single OpenAI call to generate response from observations
            # Use the same cross-worker is_first_turn from earlier
            greeting_line = "DO NOT write any greeting, salaam, welcome, or opening line. The greeting is already handled. Start your reply directly with the health content." if is_first_turn and greeting else "No greeting. Do NOT say Salaam, Welcome, or any opener. We are already talking. Answer directly."

            # Intention + tone guidance derived from the greeting context (no LLM)
            intention_kind = greeting_ctx["intention"]["intention"]

            # ── Structured Intent Extraction (Gap 1, flag-gated) ──────────
            # When USE_LLM_INTENT_EXTRACTION is true, replaces keyword intent
            # with a rich structured extraction for ambiguous messages.
            _intent_extraction = None
            _intent_prompt_block = ""
            if settings.USE_LLM_INTENT_EXTRACTION:
                try:
                    from src.services.intent_extractor import (
                        extract_intent, get_legacy_intention, render_intent_for_prompt,
                        get_tools_for_intent,
                    )
                    _intent_extraction = await extract_intent(
                        message=message,
                        keyword_intention=intention_kind,
                        patient_context=memory.patient_context,
                        dialogue_state=_dialogue_state_obj if '_dialogue_state_obj' in dir() else None,
                    )
                    if _intent_extraction:
                        intention_kind = get_legacy_intention(_intent_extraction)
                        _intent_prompt_block = render_intent_for_prompt(_intent_extraction)
                except Exception as _ie_err:
                    logger.debug(f"intent_extractor failed (non-fatal): {_ie_err}")

            intention_hint = {
                "EMERGENCY": "CRITICAL: User is in crisis. Be firm and directive. Skip pleasantries.",
                "IN_PAIN": "User is in pain/distress. Acknowledge it in the first sentence. Ask location and duration.",
                "WORRIED_ABOUT_OTHER": "User is asking ABOUT someone else (family). Address them as the carer, not the patient.",
                "SEEKING_INFO": "User wants knowledge. Explain simply with local analogies. Offer to assess their own risk.",
                "LONELY": "User may be lonely. Health is real here — engage warmly. Gently mention Bantaba Circle.",
                "FIRST_TIME": "New user. Extra patience. Brief self-introduction only if they ask who you are.",
                "ROUTINE_CHECKIN": "Regular user doing a check-in. Quick, warm, reference prior readings if known.",
                "HEALTH_GENERAL": "",
            }.get(intention_kind, "")

            # Tone signals from text
            tone_flags = greeting_ctx["signals"]
            tone_adjustments = []
            if tone_flags.get("unusual_hour"):
                tone_adjustments.append("It is late/early — ask if everything is okay.")
            if tone_flags.get("extended_greeting"):
                tone_adjustments.append("Patient wants social connection — be warm, take time.")
            if tone_flags.get("flat_response"):
                tone_adjustments.append("Patient gave a flat 'fine' — gently check if they are truly well.")
            if tone_flags.get("short_reply"):
                tone_adjustments.append("Patient is shy or terse — use simple language, invite them.")
            if tone_flags.get("scout_mode"):
                tone_adjustments.append("Youth is checking on an elder — treat them as the family carer.")
            if tone_flags.get("privacy_needed"):
                tone_adjustments.append("Patient wants privacy — acknowledge confidentiality.")
            if tone_flags.get("shouting"):
                tone_adjustments.append("Patient is using ALL CAPS — they may be urgent or frustrated.")
            tone_adjust_line = " ".join(tone_adjustments) if tone_adjustments else ""

            # Trust tier affects warmth
            trust_tier = greeting_ctx["trust"]["tier"]
            trust_hint = {
                "stranger": "First time meeting — be respectful, introduce yourself if asked.",
                "acquaintance": "Building trust — you know their name now.",
                "companion": "Trusted companion — warmer, reference their health journey.",
                "family": "Known for months — can be playful, ask about specific family.",
            }.get(trust_tier, "")

            # Build cross-session patient memory context
            patient_memory_block = ""
            pc = memory.patient_context
            if pc.patient_id and pc.name:
                mem_parts = []
                mem_parts.append(f"RETURNING PATIENT: {pc.name}, {pc.age}y {pc.gender}, {pc.region}")
                if pc.conditions:
                    mem_parts.append(f"Known conditions: {', '.join(pc.conditions)}")
                if pc.medications:
                    meds = [m.get("name", str(m)) if isinstance(m, dict) else str(m) for m in pc.medications]
                    mem_parts.append(f"Current medications: {', '.join(meds)}")
                if pc.allergies:
                    mem_parts.append(f"Allergies: {', '.join(pc.allergies)}")
                if getattr(memory, 'key_facts', None):
                    mem_parts.append("Key facts from previous visits:")
                    for fact in memory.key_facts[:5]:
                        mem_parts.append(f"  • {fact}")
                patient_memory_block = "\n".join(mem_parts)

            # ── v2.0: Empathy Engine + Assertiveness Calibration + Reasoning ──
            emotional_state = classify_emotional_state(
                message,
                conversation_history=[{"role": m.role, "content": m.content} for m in memory.messages[-4:]],
                patient_context={"name": pc.name, "conditions": pc.conditions} if pc.name else None,
            )

            assertiveness = calibrate_assertiveness(
                emotional_state=emotional_state,
                patient_context={"conditions": pc.conditions, "medications": pc.medications},
                behavior_profile=behavior_profile,
                trust_tier=trust_tier,
                conversation_turn=len([m for m in memory.messages if m.role == "user"]),
                tools_used=tools_used,
            )

            # Multi-turn reasoning for complex cases
            use_reasoning = should_use_reasoning(message, {
                "conditions": pc.conditions, "medications": pc.medications,
            })
            reasoning_chain = ""
            if use_reasoning:
                reasoning_chain = build_reasoning_chain(message, {
                    "conditions": pc.conditions, "medications": pc.medications,
                }, observations)

            # Build the unified intelligence block
            intelligence_block = build_intelligence_block(
                message, emotional_state, assertiveness,
                use_reasoning, reasoning_chain,
                {"name": pc.name, "conditions": pc.conditions},
            )

            # Extract knowledge base evidence separately for prominent display
            rag_evidence = ""
            other_observations = []
            for obs in observations:
                if obs["tool"] == "search_knowledge" and isinstance(obs.get("result"), dict):
                    snippets = obs["result"].get("snippets", [])
                    if snippets:
                        rag_evidence = "\n".join(
                            f"[Source {i+1}]: {s[:350]}" for i, s in enumerate(snippets[:3])
                        )
                else:
                    other_observations.append(obs)

            # Retrieve learned behavior patterns for this patient
            learned_behavior = ""
            if memory.patient_context.patient_id:
                learned_behavior = get_learned_context(
                    self.memory_manager.redis, memory.patient_context.patient_id
                )

            # ── Dialogue State Tracker (Transformation 1) ──────────────────
            # Load persistent conversation state for prompt injection.
            # Flag-gated: when USE_DIALOGUE_STATE_TRACKER is false, this
            # block produces an empty string and changes nothing.
            _dialogue_state_block = ""
            _dialogue_state_obj = None
            try:
                from src.services.dialogue_state import load_state, render_state_for_prompt
                _dialogue_state_obj = await load_state(session_id)
                _dialogue_state_block = await render_state_for_prompt(_dialogue_state_obj)
            except Exception as _ds_err:
                logger.debug(f"dialogue_state load/render failed (non-fatal): {_ds_err}")

            # ── Response Shape Decision (Transformation 3, flag-gated) ─────
            # When USE_RESPONSE_SHAPE_DECISION is true, selects a response
            # shape (greeting_full, empathy_first, straight_to_concern, etc.)
            # and builds a prompt instruction block. When false, this produces
            # an empty string and the pipeline behaves exactly as before.
            _shape_instruction = ""
            _response_shape = None
            if settings.USE_RESPONSE_SHAPE_DECISION and not settings.USE_CONVERSATIONAL_PACER:
                try:
                    from src.services.response_shaper import select_response_shape, build_shape_instruction
                    _response_shape = select_response_shape(
                        message=message,
                        is_first_turn=is_first_turn,
                        greeting_ctx=greeting_ctx,
                        dialogue_state=_dialogue_state_obj,
                        emotional_state=emotional_state,
                        is_emergency=False,
                        is_closing=is_goodbye,
                    )
                    _shape_instruction = build_shape_instruction(
                        shape=_response_shape,
                        greeting_text=greeting,
                        greeting_ctx=greeting_ctx,
                        is_first_turn=is_first_turn,
                    )
                except Exception as _shape_err:
                    logger.debug(f"response_shaper failed (non-fatal): {_shape_err}")

            # ── Safety Contract pre-generation constraints (Gap 5) ────────
            # When USE_SAFETY_CONTRACT is on, inject preventive constraints
            # into the prompt BEFORE generation (prevents violations vs catching).
            _safety_constraints = ""
            if settings.USE_SAFETY_CONTRACT:
                try:
                    from src.services.safety_contract import get_preemptive_constraints
                    _safety_constraints = get_preemptive_constraints(
                        user_message=message,
                        patient_context=memory.patient_context,
                        intent_extraction=_intent_extraction,
                    )
                except Exception as _sc_err:
                    logger.debug(f"safety_contract pre-gen failed (non-fatal): {_sc_err}")

            # ── Conversational Pacer (Pipeline Redesign, flag-gated) ────────
            # Forces short turn-based conversation: one topic per turn,
            # max 3 sentences, topics queued across turns.
            _pacing_instruction = ""
            _turn_type = "inform"
            _router_max_tokens = 0
            if settings.USE_CONVERSATIONAL_PACER:
                try:
                    _ds_register = "calm"
                    if _dialogue_state_obj and isinstance(_dialogue_state_obj, dict):
                        _ds_register = _dialogue_state_obj.get("current_register", "calm")
                    _pace_kwargs = dict(
                        session_id=session_id,
                        message=message,
                        is_first_turn=is_first_turn,
                        is_closing=is_goodbye,
                        is_emergency=False,
                        observations=observations,
                        tools_used=tools_used,
                        patient_name=memory.patient_context.name or "",
                        emotional_register=_ds_register,
                        patient_id=memory.patient_context.patient_id or "",
                    )
                    if os.getenv("USE_FOUR_LAYER_ROUTER", "false").lower() == "true":
                        from src.services.conversational_pacer import async_pace_turn
                        _pace_result = await async_pace_turn(**_pace_kwargs)
                    else:
                        from src.services.conversational_pacer import pace_turn
                        _pace_result = pace_turn(**_pace_kwargs)
                    _pacing_instruction = _pace_result["pacing_instruction"]
                    _turn_type = _pace_result["turn_type"]
                    _router_max_tokens = _pace_result.get("max_tokens_hint", 0)
                    logger.info(
                        f"PACER_CLASSIFY turn_type={_turn_type} "
                        f"intent={_pace_result.get('intent','')} "
                        f"stance={_pace_result.get('stance',{}).get('stance','') if isinstance(_pace_result.get('stance'), dict) else ''} "
                        f"layer={_pace_result.get('layer_path','')} "
                        f"msg={message[:80]}"
                    )
                except Exception as _pace_err:
                    logger.warning(f"conversational_pacer failed (non-fatal): {_pace_err}")

            # ── Unified compact prompt builder ──────────────────────────────
            # All models use dynamic budget allocation to minimise token usage.
            # Budgets are tuned per model based on context window + rate limits.
            #
            # char_budget  : max input chars (~3.5 chars per token, conservative)
            # max_out_tok  : max output tokens
            # hist_turns   : max conversation history turns to include
            #
            # Free-tier TPM limits drive the tighter budgets:
            #   AMINA LoRA : 4096 token context window (hard limit)
            #   Groq        : 6,000 tokens/min free tier
            #   Mistral     : free tier quota conscious
            #   Gemini      : 1M context, still compact for speed
            #   GPT-4o mini : 128k context, compact for cost
            # ────────────────────────────────────────────────────────────────

            if _pacing_instruction and _turn_type == "structured_plan":
                _COMPACT_SYS = (
                    "You are AMINA, a Gambian community health worker (CHW) with 10 years experience. "
                    "The patient asked for a structured plan — generate the COMPLETE plan they requested. "
                    "Use ONLY specific Gambian foods by name — never generic advice like 'eat healthy' or 'whole grains'. "
                    "Gambian foods: moringa porridge, benachin (jollof rice), domoda (groundnut stew), supakanja (okra stew), "
                    "churaa gerté (groundnut paste), mbahal, chere (couscous), nyaankataŋ (bean cake), "
                    "baobab juice (bouye), bissap, lemon grass tea, tapalapa bread, findi, laaciiri, tia durango. "
                    "Seasonal: moringa leaves year-round, bitter tomato (jaxatu) in dry season, okra in rainy season, "
                    "sweet potato Nov-Mar, watermelon Mar-Jun. Lumo market days have fresh local produce. "
                    "Never name or prescribe specific medication doses. Emergencies → call 199 or nearest health post."
                )
            elif _pacing_instruction:
                _COMPACT_SYS = (
                    "You are AMINA, a Gambian community health worker (CHW) with 10 years experience. "
                    "You speak like a warm friend, not a textbook. One topic per turn, short and specific. "
                    "ALWAYS recommend specific Gambian foods by name — never generic advice like 'eat healthy' or 'whole grains'. "
                    "Gambian foods: moringa porridge, benachin (jollof rice), domoda (groundnut stew), supakanja (okra stew), "
                    "churaa gerté (groundnut paste), mbahal, chere (couscous), nyaankataŋ (bean cake), "
                    "baobab juice (bouye), bissap, lemon grass tea, tapalapa bread. "
                    "Seasonal: moringa leaves year-round, bitter tomato (jaxatu) in dry season, okra in rainy season, "
                    "sweet potato Nov-Mar, watermelon Mar-Jun. Lumo market days have fresh local produce. "
                    "Ask the patient a question to keep the conversation going. "
                    "Never name or prescribe specific medication doses. Emergencies → call 199 or nearest health post."
                )
            else:
                _COMPACT_SYS = (
                    "You are AMINA, a Gambian community health worker (CHW) with 10 years experience. "
                    "Answer the patient's question directly and warmly using WHO guidelines and Gambian context. "
                    "Format: 2-4 short paragraphs. Use plain numbered lists only when listing steps or warning signs. "
                    "Do NOT ask clarifying questions — give practical advice based on what the patient shared. "
                    "Never name or prescribe specific medication doses. Emergencies → call 199 or nearest health post. "
                    "Ground advice in local context: benachin, domoda, moringa, CHW, health post, Alkallo, EFSTH."
                )

            _pref = model_preference or "base"
            _base_out = _get_max_tokens(message)

            # (char_budget, max_output_tokens, history_turns)
            # Gemini 2.5-flash-lite: no thinking overhead, safe at _base_out
            # Gemini 2.5-flash: has thinking tokens that eat the budget — use 800
            _gemini_max = 800 if "flash-lite" in self.gemini_model_name else max(_base_out, 800)
            # Budget format: (char_budget, max_output_tokens, history_turns)
            # LoRA: vLLM max_model_len is 8192 (bumped from 4096) — safe ~6K input + 500 out
            # The context compactor auto-compresses older turns when the budget fills up,
            # so the conversation can run indefinitely without quality loss.
            _MODEL_BUDGETS = {
                "amina":   (20_000, 900,           6),
                "groq":    (10_000, min(_base_out, 500), 4),
                "mistral": (10_000, min(_base_out, 500), 4),
                "gemini":  (22_000, _gemini_max,   6),
                "base":    (18_000, _base_out,     6),
            }
            _char_budget, _max_tok, _hist_turns = _MODEL_BUDGETS.get(_pref, _MODEL_BUDGETS["base"])

            if _turn_type == "structured_plan":
                _max_tok = max(_max_tok, 1000)

            if _router_max_tokens:
                _max_tok = max(_max_tok, _router_max_tokens)

            if _pref == "amina":
                # ── LoRA dedicated pipeline ───────────────────────────────────────
                # 4K context window. No RAG (LoRA already knows health guidelines).
                # Patient profile injected compactly at the top of the user turn.
                # Direct advice tone — no intake questioning.
                if _pacing_instruction and _turn_type == "structured_plan":
                    _LORA_SYS = (
                        "You are AMINA, a Gambian CHW who knows this patient personally. "
                        "Use their name. Generate the COMPLETE structured plan they requested. "
                        "Use ONLY specific Gambian foods — never generic 'eat healthy' or 'whole grains'. "
                        "Foods: moringa porridge, benachin, domoda, supakanja, churaa gerté, chere, baobab juice, bissap, findi, laaciiri. "
                        "Seasonal: moringa year-round, okra rainy season, sweet potato Nov-Mar, watermelon Mar-Jun. "
                        "Reference their conditions and medications when relevant. "
                        "Never prescribe doses. Emergencies → call 199 or nearest health post."
                    )
                elif _pacing_instruction:
                    _LORA_SYS = (
                        "You are AMINA, a Gambian CHW who knows this patient personally. "
                        "Use their name. Speak like a warm friend, one topic per turn. "
                        "ALWAYS recommend specific Gambian foods by name — never 'eat healthy' or 'whole grains'. "
                        "Foods: moringa porridge, benachin, domoda, supakanja, churaa gerté, chere, baobab juice (bouye), bissap. "
                        "Seasonal: moringa year-round, okra rainy season, sweet potato Nov-Mar, watermelon Mar-Jun. "
                        "Ask the patient a question to keep the conversation going. "
                        "Reference their conditions and medications when relevant. "
                        "Never prescribe doses. Emergencies → call 199 or nearest health post."
                    )
                else:
                    _LORA_SYS = (
                        "You are AMINA, a Gambian CHW who knows this patient personally. "
                        "Use their name. Give direct, warm, specific advice based on their "
                        "conditions and what they just told you. "
                        "Format: 2-3 short paragraphs. Do NOT ask clarifying questions. "
                        "Reference their conditions and medications when relevant. "
                        "Local context: moringa, benachin, health post, Alkallo, EFSTH, lumo. "
                        "Never prescribe doses. Emergencies → call 199 or nearest health post."
                    )
                pc = memory.patient_context
                _pat_lines = []
                if pc.name:
                    _pat_lines.append(f"Patient: {pc.name}")
                if pc.conditions:
                    _pat_lines.append(f"Conditions: {', '.join(pc.conditions)}")
                if pc.medications:
                    _med_names = [
                        m.get("name", str(m)) if isinstance(m, dict) else str(m)
                        for m in pc.medications
                    ]
                    _pat_lines.append(f"Medications: {', '.join(_med_names)}")
                if getattr(memory, "key_facts", []):
                    _pat_lines.append(f"Notes: {'; '.join(memory.key_facts[:3])}")
                _pat_ctx = "\n".join(_pat_lines)
                # Inject intent + dialogue state + response shape (flag-gated)
                _intent_section = f"\n\n{_intent_prompt_block}" if _intent_prompt_block else ""
                _ds_section = f"\n\n{_dialogue_state_block}" if _dialogue_state_block else ""
                _shape_section = f"\n\n{_shape_instruction}" if _shape_instruction else ""
                _safety_section = f"\n\n{_safety_constraints}" if _safety_constraints else ""
                _pacing_section = f"\n\n{_pacing_instruction}" if _pacing_instruction else ""
                _context_block = f"{_pat_ctx}{_intent_section}{_ds_section}{_shape_section}{_safety_section}{_pacing_section}" if _pat_ctx else f"{_intent_section}{_ds_section}{_shape_section}{_safety_section}{_pacing_section}"
                _user_prompt = (
                    f"{_context_block}\n\nPatient says: \"{message}\"\n\nRespond as AMINA:"
                    if _context_block.strip() else
                    f"Patient says: \"{message}\"\n\nRespond as AMINA:"
                )
                # ── Context compactor integration (auto-refresh on overflow) ──
                # Before building the LoRA prompt, check if we have a pinned
                # compact_summary of older turns from a prior background run.
                # If yes, prepend it to the system prompt so LoRA has full
                # conversational continuity without exceeding its 8K window.
                try:
                    from src.services.context_compactor import get_summary_for_session
                    _pinned_summary = await get_summary_for_session(session_id)
                except Exception:
                    _pinned_summary = None

                if _pinned_summary:
                    _LORA_SYS = (
                        _LORA_SYS
                        + "\n\nPrior conversation summary (compressed for context): "
                        + _pinned_summary[:800]
                    )

                # Structured clinical state (Gap 6) — richer than prose summary
                if settings.USE_STRUCTURED_COMPACTION:
                    try:
                        from src.services.structured_compactor import (
                            load_clinical_state, render_state_for_prompt,
                        )
                        _clinical_state = await load_clinical_state(
                            memory.patient_context.patient_id or ""
                        )
                        _clinical_block = render_state_for_prompt(_clinical_state)
                        if _clinical_block:
                            _LORA_SYS = _LORA_SYS + "\n\n" + _clinical_block[:600]
                    except Exception as _cs_err:
                        logger.debug(f"structured_compactor load failed (non-fatal): {_cs_err}")

                # 6-turn history, 500 chars per message (Phase A bump from 4×350)
                prior_msgs = memory.messages[:-1]
                prior_filtered = []
                for m in prior_msgs[-_hist_turns:]:
                    if not prior_filtered or m.role != prior_filtered[-1].role:
                        prior_filtered.append(m)
                chat_messages = [{"role": "system", "content": _LORA_SYS}]
                for m in prior_filtered:
                    chat_messages.append({"role": m.role, "content": m.content[:500]})
                chat_messages.append({"role": "user", "content": _user_prompt})
                # Respect the budget table above (900 for Amina LoRA).
                # Removed the old hard-coded 400 cap that was silently
                # clobbering the tuple and truncating replies mid-sentence.

                # Schedule background compaction if this turn approaches the budget.
                # Non-blocking — the user never waits for compaction.
                try:
                    from src.services.context_compactor import maybe_schedule_compaction
                    maybe_schedule_compaction(
                        session_id=session_id,
                        messages=memory.messages,
                        char_budget=_char_budget,
                        patient_name=memory.patient_context.name or "",
                    )
                except Exception as _e:
                    logger.debug(f"LoRA compactor schedule failed (non-fatal): {_e}")

                # Structured extraction alongside compaction (Gap 6)
                if settings.USE_STRUCTURED_COMPACTION and len(memory.messages) >= 8:
                    try:
                        from src.services.structured_compactor import extract_and_update
                        asyncio.create_task(extract_and_update(
                            patient_id=memory.patient_context.patient_id or "",
                            session_id=session_id,
                            messages=memory.messages[:-4],
                            patient_name=memory.patient_context.name or "",
                            turn_count=len(memory.messages),
                        ))
                    except Exception as _cs_err:
                        logger.debug(f"structured_compactor schedule failed: {_cs_err}")

            else:
                # ── Generic pipeline (base / gemini / groq / mistral) ─────────────
                if _turn_type == "structured_plan" and _pacing_instruction:
                    _sys_prompt = _COMPACT_SYS
                elif _pref in ("gemini", "base"):
                    _sys_prompt = AMINA_SYSTEM_PROMPT
                else:
                    _sys_prompt = _COMPACT_SYS

                # ── Context compactor integration (auto-refresh on overflow) ──
                # Shared across ALL models — the summary is keyed by session_id,
                # so switching model mid-conversation preserves continuity.
                try:
                    from src.services.context_compactor import get_summary_for_session
                    _pinned_summary = await get_summary_for_session(session_id)
                except Exception:
                    _pinned_summary = None

                if _pinned_summary:
                    _sys_prompt = (
                        _sys_prompt
                        + "\n\nPrior conversation summary (compressed for context): "
                        + _pinned_summary[:800]
                    )

                # Structured clinical state (Gap 6) — richer than prose summary
                if settings.USE_STRUCTURED_COMPACTION:
                    try:
                        from src.services.structured_compactor import (
                            load_clinical_state, render_state_for_prompt,
                        )
                        _clinical_state = await load_clinical_state(
                            memory.patient_context.patient_id or ""
                        )
                        _clinical_block = render_state_for_prompt(_clinical_state)
                        if _clinical_block:
                            _sys_prompt = _sys_prompt + "\n\n" + _clinical_block[:600]
                    except Exception as _cs_err:
                        logger.debug(f"structured_compactor load failed (non-fatal): {_cs_err}")

                _fixed_chars = len(_sys_prompt) + len(message) + len(_dialogue_state_block) + len(_shape_instruction) + len(_intent_prompt_block) + len(_safety_constraints) + len(_pacing_instruction) + 60
                _flex = max(0, _char_budget - _fixed_chars)
                _pat_limit  = int(_flex * 0.35)
                _rag_limit  = int(_flex * 0.35)
                _hist_chars = int(_flex * 0.30)

                _patient_part = f"Patient history: {patient_memory_block[:_pat_limit]}\n" if patient_memory_block and _pat_limit > 50 else ""
                _rag_part     = f"Relevant knowledge: {rag_evidence[:_rag_limit]}\n"       if rag_evidence     and _rag_limit  > 50 else ""
                _intent_part  = f"{_intent_prompt_block}\n" if _intent_prompt_block else ""
                _ds_part      = f"{_dialogue_state_block}\n" if _dialogue_state_block else ""
                _shape_part   = f"{_shape_instruction}\n" if _shape_instruction else ""
                _safety_part  = f"{_safety_constraints}\n" if _safety_constraints else ""
                _pacing_part  = f"{_pacing_instruction}\n" if _pacing_instruction else ""
                _user_prompt  = f"{_patient_part}{_rag_part}{_intent_part}{_ds_part}{_shape_part}{_safety_part}{_pacing_part}Patient says: \"{message}\"\n\nRespond as AMINA:"

                prior_msgs = memory.messages[:-1]
                prior_filtered = []
                for m in prior_msgs[-_hist_turns:]:
                    if not prior_filtered or m.role != prior_filtered[-1].role:
                        prior_filtered.append(m)
                _per_msg_chars = max(60, _hist_chars // max(1, len(prior_filtered)))

                chat_messages = [{"role": "system", "content": _sys_prompt}]
                for m in prior_filtered:
                    chat_messages.append({"role": m.role, "content": m.content[:_per_msg_chars]})
                chat_messages.append({"role": "user", "content": _user_prompt})

                # Schedule background compaction if approaching this model's budget.
                # Non-blocking — user's response is unaffected.
                try:
                    from src.services.context_compactor import maybe_schedule_compaction
                    maybe_schedule_compaction(
                        session_id=session_id,
                        messages=memory.messages,
                        char_budget=_char_budget,
                        patient_name=memory.patient_context.name or "",
                    )
                except Exception as _e:
                    logger.debug(f"Generic compactor schedule failed (non-fatal): {_e}")

                # Structured extraction alongside compaction (Gap 6)
                if settings.USE_STRUCTURED_COMPACTION and len(memory.messages) >= 8:
                    try:
                        from src.services.structured_compactor import extract_and_update
                        asyncio.create_task(extract_and_update(
                            patient_id=memory.patient_context.patient_id or "",
                            session_id=session_id,
                            messages=memory.messages[:-4],
                            patient_name=memory.patient_context.name or "",
                            turn_count=len(memory.messages),
                        ))
                    except Exception as _cs_err:
                        logger.debug(f"structured_compactor schedule failed: {_cs_err}")

            try:
                completion = await _client.chat.completions.create(
                    model=_model,
                    messages=chat_messages,
                    temperature=0.5 + (_REGEN_TEMPERATURE_BUMP if regenerate_hint else 0),
                    max_tokens=_max_tok,
                )
            except Exception as _llm_err:
                _err_str = str(_llm_err)
                # Gemini quota exhausted → auto-fallback to Groq (free, fast)
                if ("429" in _err_str or "RESOURCE_EXHAUSTED" in _err_str or "quota" in _err_str.lower()) \
                        and _client is self.gemini_client and self.groq_client:
                    logger.warning("Gemini quota exceeded — falling back to Groq (Llama 3.3 70B)")
                    completion = await self.groq_client.chat.completions.create(
                        model=self.groq_model_name,
                        messages=chat_messages,
                        temperature=0.5 + (_REGEN_TEMPERATURE_BUMP if regenerate_hint else 0),
                        max_tokens=min(_max_tok, 250),  # Groq TPM budget
                    )
                else:
                    raise
            response_text = completion.choices[0].message.content or ""

            # Sentence-boundary trim when the model hit its max_tokens
            # cap. OpenAI-compatible APIs expose this via finish_reason
            # == "length"; when present the last sentence is almost
            # certainly incomplete ("… and I encourage you to keep a"
            # stopping mid-word). Trim back to the last ./!/? so we
            # never leave the patient with a dangling clause. If the
            # model finished cleanly (finish_reason == "stop") we
            # leave the text alone.
            # Auto-continuation: if the model hit its token limit, ask it
            # to finish its thought. Up to 2 continuation rounds so long
            # responses (care plans, multi-step advice) complete naturally.
            _MAX_CONTINUATIONS = 2
            _continuation_round = 0
            try:
                _finish = getattr(completion.choices[0], "finish_reason", None)
                while _finish == "length" and response_text and _continuation_round < _MAX_CONTINUATIONS:
                    _continuation_round += 1
                    logger.info(
                        "response hit max_tokens (round %d) — requesting continuation",
                        _continuation_round,
                    )
                    _cont_messages = list(chat_messages) + [
                        {"role": "assistant", "content": response_text},
                        {"role": "user", "content": "Continue from where you left off. Do not repeat anything you already said."},
                    ]
                    try:
                        _cont_completion = await _client.chat.completions.create(
                            model=_model,
                            messages=_cont_messages,
                            temperature=0.5,
                            max_tokens=_max_tok,
                        )
                        _cont_text = (_cont_completion.choices[0].message.content or "").strip()
                        if _cont_text:
                            response_text = response_text.rstrip() + " " + _cont_text
                        _finish = getattr(_cont_completion.choices[0], "finish_reason", "stop")
                    except Exception as _cont_err:
                        logger.warning("continuation call failed: %s", _cont_err)
                        break

                # Final sentence-boundary trim if still truncated after continuations
                if _finish == "length" and response_text:
                    import re as _re
                    _cleaned = response_text.rstrip()
                    _matches = list(_re.finditer(r"[.!?](?:\s|$)", _cleaned))
                    if _matches:
                        _end = _matches[-1].end()
                        _trimmed = _cleaned[:_end].rstrip()
                        if _trimmed and _trimmed != _cleaned:
                            logger.info(
                                "response truncated after %d continuations — "
                                "trimmed %d → %d chars to last sentence boundary",
                                _continuation_round, len(_cleaned), len(_trimmed),
                            )
                            response_text = _trimmed
            except Exception as _trim_err:
                logger.debug(f"continuation/sentence-trim failed: {_trim_err}")

            # Strip ALL greeting-like content from EVERY LLM response.
            # On first turn: strip then prepend the exact template.
            # On later turns: just strip (no greeting should appear).
            # When T3 (Response Shape Decision) or Conversational Pacer is on,
            # the model already received shape/pacing instructions and the
            # pacer enforces filler stripping — skip the greeting strip+prepend.
            if not (settings.USE_RESPONSE_SHAPE_DECISION or settings.USE_CONVERSATIONAL_PACER):
                _GREETING_FRAGMENTS = [
                    # Full greetings
                    "Salaam aleikum.", "Salaam Aleikum.", "Salam aleikum.",
                    "Salaam aleikum,", "Salaam Aleikum,",
                    "Isama!", "Itileetaa!", "Iwurara!", "Iwulaara!",
                    "Iwulaara jang!", "Isama jang!", "Itilii jang!",
                    "Iwurara jang!", "I be di?", "I be di!",
                    "Welcome.", "Welcome!",
                    # Role-specific greetings the LLM might echo
                    "Salaam aleikum, VHW.", "Salaam aleikum, Alkalo.",
                    "Salaam aleikum, Imam.", "Salaam aleikum, Clinician.",
                    "Thank you for the work you do.",
                    "Are you checking in on a patient or asking for yourself?",
                    "I greet you with the respect of your position.",
                    "Your village's health is my concern.",
                    "How can I serve you today?",
                    # Lumo / Jummah
                    "Today is lumo day.", "Today is Lumo day.",
                    "Jumaa Mubarak!", "Jumaa Mubarak.",
                    "At the market, remember: moringa leaves and bitter tomato for your heart.",
                    "At the market, remember:",
                    # Generic openers
                    "I'm Amina, your community health worker.",
                    "How can I help you today?",
                ]
                t = response_text.lstrip()
                changed = True
                while changed:
                    changed = False
                    for opener in _GREETING_FRAGMENTS:
                        if t.startswith(opener):
                            t = t[len(opener):].lstrip()
                            changed = True
                if greeting:
                    response_text = f"{greeting} {t}".strip()
                else:
                    response_text = t.strip()
                    # Capitalise first letter if it got lowercased
                    if response_text and response_text[0].islower():
                        response_text = response_text[0].upper() + response_text[1:]

            # ── SAFETY — contract-based (Gap 5) or LLM-review (legacy) ────
            # When USE_SAFETY_CONTRACT is on: deterministic validation,
            # fail-closed. When off: existing LLM review, fail-open.
            if settings.USE_SAFETY_CONTRACT:
                try:
                    from src.services.safety_contract import validate_response
                    _safety_result = validate_response(
                        response=response_text,
                        user_message=message,
                        patient_medications=getattr(memory.patient_context, "medications", None),
                    )
                    if not _safety_result.safe:
                        logger.warning(
                            f"safety_contract: blocked response with "
                            f"{len(_safety_result.violations)} violations"
                        )
                        # Regenerate is not implemented yet — for now, prepend
                        # the fix hints to the response as a visible warning.
                        # Future: re-call LLM with regeneration_prompt injected.
                        _fix_hints = "; ".join(
                            v.fix_hint for v in _safety_result.violations
                            if v.severity == "critical"
                        )
                        response_text = (
                            f"⚠ I need to be careful here. {_fix_hints} "
                            f"Please consult your doctor or healthcare provider "
                            f"for specific medical advice."
                        )
                except Exception as _sc_err:
                    logger.warning(f"safety_contract validation failed (fail-closed): {_sc_err}")
                    response_text = (
                        "I want to give you the right advice. Please speak with "
                        "your doctor or visit your nearest health centre for guidance."
                    )
            else:
                response_text = await self._safety_review(response_text, message, memory)

            # ── Density Compression (Gap 7, flag-gated) ─────────────────
            # Post-generation density pass: strips filler, compresses if
            # over density budget. Replaces hard 80-word cap with substance-
            # aware limits. When off, word limits are advisory only.
            if settings.USE_DENSITY_COMPRESSION and not settings.USE_CONVERSATIONAL_PACER:
                try:
                    from src.services.density_compressor import compress_if_needed
                    response_text = await compress_if_needed(
                        response=response_text,
                        response_shape=_response_shape,
                    )
                except Exception as _dc_err:
                    logger.debug(f"density_compressor failed (non-fatal): {_dc_err}")

            # ── Conversational Pacer hard enforcement ─────────────────────
            # Architectural backstop: if model ignored pacing instruction,
            # truncate to sentence/word limits for the turn type.
            if settings.USE_CONVERSATIONAL_PACER:
                try:
                    from src.services.conversational_pacer import enforce_turn_limits
                    _pre_pacer = response_text
                    response_text = enforce_turn_limits(response_text, _turn_type)
                    logger.info(f"PACER [{_turn_type}] pre={len(_pre_pacer.split())}w post={len(response_text.split())}w | PRE: {_pre_pacer[:200]} | POST: {response_text[:200]}")
                except Exception as _pace_err:
                    logger.debug(f"pacer enforcement failed (non-fatal): {_pace_err}")

            # Extract triage level
            triage_level = None
            for obs in observations:
                if obs["tool"] == "assess_triage" and isinstance(obs["result"], dict):
                    triage_level = obs["result"].get("level")
                    memory.update_patient_context(triage_level=triage_level)

            # Schedule follow-up
            followup = None
            if triage_level:
                followup_result = await self.orchestrator.execute_tool(
                    "schedule_followup",
                    triage_level=triage_level,
                    condition=memory.patient_context.conditions[0] if memory.patient_context.conditions else "general",
                )
                if followup_result.get("success"):
                    followup = followup_result["result"].get("next_checkin")

            # Save assistant message to in-process memory AND Redis (Tier 1)
            memory.add_message("assistant", response_text, tools_used)
            await self.memory_manager.add_message_to_session(
                session_id, "assistant", response_text, tools_used,
            )

            # ── Dialogue State update (fire-and-forget, fully async) ───────
            # Runs AFTER response is persisted. Never blocks the response path.
            try:
                from src.services.dialogue_state import update_state_async
                asyncio.create_task(update_state_async(
                    conversation_id=session_id,
                    user_message=message,
                    assistant_response=response_text,
                    tools_used=tools_used,
                    triage_level=triage_level,
                ))
            except Exception as _ds_err:
                logger.debug(f"dialogue_state update schedule failed (non-fatal): {_ds_err}")

            # Save consultation to ArcadeDB (Tier 2) if patient exists
            if memory.patient_context.patient_id:
                await self._persist_consultation(
                    session_id=session_id,
                    patient_id=memory.patient_context.patient_id,
                    message=message,
                    response=response_text,
                    triage_level=triage_level,
                    tools_used=tools_used,
                )

            # Log interaction for self-learning (sync, <1ms)
            if memory.patient_context.patient_id:
                log_interaction(
                    self.memory_manager.redis,
                    patient_id=memory.patient_context.patient_id,
                    session_id=session_id,
                    user_msg=message,
                    bot_response=response_text,
                    tools_used=tools_used,
                )

            # ── Intent Learner: miss detection + ArcadeDB flush (background) ─
            if os.getenv("USE_INTENT_LEARNER", "false").lower() == "true":
                try:
                    from src.services.intent_learner import (
                        detect_suspected_miss,
                        flush_classification_log,
                        flush_miss_queue,
                    )
                    _learner_intent = _pace_result.get("intent", "") if settings.USE_CONVERSATIONAL_PACER else ""
                    detect_suspected_miss(
                        session_id=session_id,
                        current_message=message,
                        current_intent=_learner_intent,
                        patient_id=memory.patient_context.patient_id or "",
                    )
                    asyncio.create_task(flush_classification_log(batch_size=20))
                    asyncio.create_task(flush_miss_queue(batch_size=10))
                except Exception as _il_err:
                    logger.debug(f"intent_learner background failed (non-fatal): {_il_err}")

            # Only show the form CTA the FIRST time we mention it — after
            # that the user has chosen to keep chatting, so we respect that
            cta_form = early_form_suggestion if prompts_so_far == 0 else None

            # Decide whether to prompt the user for notification preferences.
            # Trigger when:
            #  - We've exchanged enough to be useful (>= 3 user messages OR a followup was just scheduled)
            #  - We haven't already asked this session
            #  - The user isn't in the middle of an emergency flow
            suggest_notifications = False
            user_msg_count = sum(1 for m in memory.messages if m.role == "user")
            goodbye_signal = any(
                w in message.lower() for w in
                ["thanks", "thank you", "goodbye", "bye", "that's all", "thats all", "okay thanks", "nothing else"]
            )
            if not memory.notifications_asked and not memory.patient_context.triage_level == "EMERGENCY":
                if followup or user_msg_count >= 4 or goodbye_signal:
                    suggest_notifications = True
                    memory.notifications_asked = True

            return {
                "response": response_text,
                "triage_level": triage_level,
                "tools_used": tools_used,
                "followup": followup,
                "is_emergency": False,
                "session_id": session_id,
                "suggest_form": cta_form,
                "suggest_notifications": suggest_notifications,
                # Greeting context — surfaced for observability + frontend tone
                "intention": intention_kind,
                "trust_tier": trust_tier,
                "ethnic_language": greeting_ctx["ethnic_language"]["language"],
                "detected_markers": greeting_ctx["ethnic_language"]["markers"],
                "vitals_trend": vitals_trend_data,
                "journey_callback": journey_data,
                "anniversary": anniversary_data,
                "referral_consumed": referral,
                "user_role": memory.user_role,
                # Source citations (deterministic, <1ms)
                "sources": self._get_citations(tools_used, message, response_text),
                # Routing observability (T2)
                "routing_source": _routing_source,
                # Response shape observability (T3)
                "response_shape": _response_shape,
                # Intent extraction observability (Gap 1)
                "intent_extraction": _intent_extraction,
                # Conversational pacer observability
                "turn_type": _turn_type if settings.USE_CONVERSATIONAL_PACER else None,
            }

        except Exception as e:
            logger.error(f"Agent processing error: {e}")
            error_response = (
                "I apologize, I'm having some difficulty right now. "
                "If this is an emergency, please call 199 immediately or go to the nearest health facility. "
                "Otherwise, please try again in a moment."
            )
            memory.add_message("assistant", error_response)
            return {
                "response": error_response,
                "triage_level": None,
                "tools_used": [],
                "followup": None,
                "is_emergency": False,
                "error": str(e),
            }

    
    # CONTEXT BUILDING (now uses all 3 tiers)
   

    async def _build_context(self, memory: ConversationMemory, current_message: str) -> str:
        context_parts = ["CONVERSATION CONTEXT:"]

        pc = memory.patient_context

        # If we have a patient, pull semantic memory context (Tier 2+3)
        if pc.patient_id:
            try:
                persistent_context = await self.memory_manager.build_context_for_query(
                    pc.patient_id, current_message,
                )
                if persistent_context:
                    context_parts.append(persistent_context)
            except Exception as e:
                logger.warning(f"Failed to build persistent context: {e}")
                # Fallback to in-memory context
                context_parts.append(f"\nPatient: {pc.name}, {pc.age}y {pc.gender}")
                if pc.conditions:
                    context_parts.append(f"Conditions: {', '.join(pc.conditions)}")
        else:
            context_parts.append("\nNew patient - no history available")

        context_parts.append(f"Region: {pc.region}")

        # In-session conversation history (Tier 1 in-process)
        if len(memory.messages) > 1:
            context_parts.append("\nRecent conversation:")
            for msg in memory.messages[-6:]:
                context_parts.append(f"{msg.role.upper()}: {msg.content[:200]}...")

        return "\n".join(context_parts)

    # ================================================================
    # SESSION END → PERSIST (Tier 2 + Tier 3)
    # ================================================================

    async def _persist_consultation(
        self,
        session_id: str,
        patient_id: str,
        message: str,
        response: str,
        triage_level: str = None,
        tools_used: list = None,
    ):
        """Save consultation record (Tier 2) then fire-and-forget
        the expensive LLM calls (summary + fact extraction) so they
        don't block the user response."""
        consultation = ConsultationRecord(
            id=f"C{uuid.uuid4().hex[:8].upper()}",
            patient_id=patient_id,
            session_id=session_id,
            started_at=datetime.now(),
            messages=[
                {"role": "user", "content": message},
                {"role": "assistant", "content": response},
            ],
            triage_level=triage_level,
            tools_used=tools_used or [],
        )

        # Save the raw consultation — fast, no LLM call
        try:
            await self.memory_manager.save_consultation(consultation)
        except Exception as e:
            logger.warning(f"Non-fatal: failed to persist consultation: {e}")
            return

        # Fire-and-forget: summary generation + fact extraction
        # These make LLM calls — we don't want to block the response
        import asyncio
        asyncio.create_task(
            self._background_enrich(patient_id, consultation)
        )

    async def _background_enrich(self, patient_id: str, consultation: ConsultationRecord):
        """Background task: generate summary + extract facts + update profile.
        Runs after the response has already been sent to the user.

        Progressive profiling: extracts new info the patient shared (age,
        conditions, meds, diet, family) and updates their PatientVertex.

        Care plan tracking: detects commitments ("I will try half Maggi cube")
        and stores them as key_facts so next visit Amina can follow up.
        """
        try:
            await self.memory_manager.generate_and_save_summary(consultation)
        except Exception as e:
            logger.warning(f"Background summary failed: {e}")

        try:
            await self.memory_manager.extract_and_save_facts(patient_id, consultation)
        except Exception as e:
            logger.warning(f"Background fact extraction failed: {e}")

        # NOTE: behavior patterns + interaction chunks are processed at
        # SESSION END only (see end_session), not after every message.
        # Per-message enrichment is limited to profile updates above.

        # Progressive profiling + care plan commitment extraction
        try:
            await self._extract_profile_updates(patient_id, consultation)
        except Exception as e:
            logger.warning(f"Background profile update failed: {e}")

    async def _extract_profile_updates(
        self, patient_id: str, consultation: ConsultationRecord,
    ):
        """Extract profile updates and commitments from conversation.
        Updates PatientVertex with any new info learned (progressive profiling)
        and stores care plan commitments as key_facts for follow-up."""
        messages = consultation.messages[-10:]
        if len(messages) < 2:
            return

        transcript = "\n".join(
            f"{m.get('role','user')}: {m.get('content','')}" for m in messages
        )

        try:
            client = AsyncOpenAI(
                api_key=settings.OPENAI_API_KEY,
                base_url=settings.OPENAI_BASE_URL,
            )
            resp = await client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                messages=[{"role": "user", "content": f"""Extract any NEW information about the patient from this conversation.
Return ONLY valid JSON with these fields (use null for unknown, empty arrays for none):

{{
  "new_conditions": ["any conditions mentioned for the first time"],
  "new_medications": ["any medications the patient says their doctor prescribed"],
  "new_allergies": ["any allergies mentioned"],
  "age_mentioned": null,
  "name_mentioned": null,
  "commitments": ["things the patient agreed to try, e.g. 'will use half Maggi cube', 'will walk 30 min daily'"],
  "concerns": ["worries or barriers the patient expressed"],
  "vitals_reported": {{"bp": null, "glucose": null}}
}}

Only include items explicitly stated by the USER (not Amina's advice).

CONVERSATION:
{transcript}

JSON:"""}],
                temperature=0.1,
                max_tokens=300,
            )
            text = (resp.choices[0].message.content or "").strip()
            if text.startswith("```"):
                import re as _re
                text = _re.sub(r"^```(?:json)?\s*", "", text)
                text = _re.sub(r"```\s*$", "", text)
            updates = json.loads(text)
        except Exception as e:
            logger.warning(f"Profile extraction LLM call failed: {e}")
            return

        # Apply progressive profile updates to PatientVertex
        from src.utils.arcade_client import async_command_sql, extract_rows
        try:
            # Load current profile
            resp = await async_command_sql(
                "SELECT conditions, medications, allergies, key_facts FROM PatientVertex WHERE id = :pid LIMIT 1",
                [patient_id],
            )
            rows = extract_rows(resp)
            if not rows:
                return
            current = rows[0]
            for field in ("conditions", "medications", "allergies", "key_facts"):
                val = current.get(field, "[]")
                if isinstance(val, str):
                    current[field] = json.loads(val)

            changed = False

            # Merge new conditions
            new_conds = updates.get("new_conditions") or []
            existing_conds = [c.lower() for c in current["conditions"]]
            for c in new_conds:
                if c and c.lower() not in existing_conds:
                    current["conditions"].append(c)
                    changed = True

            # Merge new allergies
            new_allergies = updates.get("new_allergies") or []
            existing_allergies = [a.lower() for a in current["allergies"]]
            for a in new_allergies:
                if a and a.lower() not in existing_allergies:
                    current["allergies"].append(a)
                    changed = True

            # Store commitments as key_facts for next-visit follow-up
            commitments = updates.get("commitments") or []
            concerns = updates.get("concerns") or []
            new_facts = []
            for c in commitments:
                if c:
                    new_facts.append(f"Committed on {datetime.now().strftime('%b %d')}: {c}")
            for c in concerns:
                if c:
                    new_facts.append(f"Concern: {c}")
            if new_facts:
                current["key_facts"] = (current.get("key_facts") or []) + new_facts
                # Cap at 20 facts (remove oldest)
                current["key_facts"] = current["key_facts"][-20:]
                changed = True

            # Update age/name if newly learned
            set_parts = []
            params = []
            age = updates.get("age_mentioned")
            if age and isinstance(age, int) and age > 0:
                set_parts.append("age = :age")
                params.append(age)
            name = updates.get("name_mentioned")
            if name and isinstance(name, str) and len(name) > 1:
                set_parts.append("name = :name")
                params.append(name)

            if changed:
                set_parts.append("conditions = :conds")
                params.append(json.dumps(current["conditions"]))
                set_parts.append("allergies = :allerg")
                params.append(json.dumps(current["allergies"]))
                set_parts.append("key_facts = :facts")
                params.append(json.dumps(current["key_facts"]))

            if set_parts:
                set_parts.append("updated_at = :updated")
                params.append(datetime.now().isoformat())
                params.append(patient_id)
                sql = f"UPDATE PatientVertex SET {', '.join(set_parts)} WHERE id = :pid"
                await async_command_sql(sql, params)
                logger.info(f"Progressive profile update for {patient_id}: {set_parts}")

        except Exception as e:
            logger.warning(f"Failed to apply profile updates: {e}")

    async def end_session(self, session_id: str):
        """Explicitly end a session — triggers final summary and cleanup."""
        memory = self.sessions.get(session_id)
        if not memory:
            return

        # Build a final consultation record from the full session
        if memory.patient_context.patient_id and len(memory.messages) > 1:
            full_consultation = ConsultationRecord(
                id=f"C{uuid.uuid4().hex[:8].upper()}",
                patient_id=memory.patient_context.patient_id,
                session_id=session_id,
                started_at=memory.started_at,
                ended_at=datetime.now(),
                messages=[
                    {"role": m.role, "content": m.content}
                    for m in memory.messages
                ],
                triage_level=memory.patient_context.triage_level,
                tools_used=list({t for m in memory.messages for t in m.tools_used}),
            )

            try:
                await self.memory_manager.save_consultation(full_consultation)
                await self.memory_manager.extract_and_save_facts(
                    memory.patient_context.patient_id, full_consultation,
                )
            except Exception as e:
                logger.warning(f"End-session persist failed: {e}")

            # ── SELF-LEARNING (session end only) ──
            # 1. Extract behavior patterns from interaction history
            # 2. Convert interactions into ArcadeDB knowledge chunks
            # Both run async — no user latency impact
            pid = memory.patient_context.patient_id
            asyncio.create_task(self._background_learning(pid))

        self.clear_session(session_id)

    async def _background_learning(self, patient_id: str):
        """Session-end learning: extract patterns + create knowledge chunks.

        Triggered ONCE per session (not per message) to avoid:
        - Duplicate chunk creation
        - Wasted LLM calls on partial conversations
        - Overlapping pattern extraction
        """
        # Check if enough NEW interactions since last chunk processing
        redis = self.memory_manager.redis
        interaction_count = redis.llen(f"interactions:{patient_id}") or 0
        last_processed = redis.get(f"chunks_processed:{patient_id}")
        last_count = 0
        if last_processed:
            try:
                last_count = json.loads(last_processed).get("count", 0)
            except Exception:
                pass

        # Layer 2: Extract clinical insights (quality-gated)
        try:
            await extract_clinical_insights(patient_id, redis, self.client)
        except Exception as e:
            logger.warning(f"Clinical insight extraction failed: {e}")

        # Layer 3: Update behavior profile
        try:
            await update_behavior_profile(patient_id, redis, self.client)
        except Exception as e:
            logger.warning(f"Behavior profile update failed: {e}")

        # Layer 4: Promote quality insights to RAG chunks (threshold-gated)
        new_interactions = interaction_count - last_count
        if new_interactions >= 10:
            try:
                chunks = await promote_to_knowledge_chunks(patient_id, redis)
                logger.info(f"Learning: promoted {chunks} insights to knowledge chunks for {patient_id}")
            except Exception as e:
                logger.warning(f"Chunk promotion failed: {e}")
        else:
            logger.debug(f"Learning: {new_interactions} new interactions for {patient_id} (need 10+ for promotion)")

    async def _safety_review(self, response: str, user_message: str, memory) -> str:
        """Safety Supervisor Agent — reviews every response before sending.

        Checks for:
          1. MEDICATION PRESCRIBING — does the response recommend specific drugs?
          2. CLINICAL ACCURACY — are numbers/thresholds correct per WHO PEN?
          3. EMERGENCY MISS — does the response miss emergency signs?
          4. HARMFUL ADVICE — could following this advice cause harm?

        If issues found: rewrites the problematic parts.
        If clean: returns response unchanged.

        Uses the OpenAI client (not fine-tuned model) for reliability.
        Adds ~300ms latency but prevents dangerous responses.
        """
        if not response or len(response) < 20:
            return response

        try:
            review = await self.openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": f"""You are a clinical safety reviewer for a Gambian healthcare AI.
Review this response for safety issues. Be strict.

PATIENT SAID: "{user_message[:200]}"

AI RESPONSE TO REVIEW:
"{response}"

CHECK THESE RULES:
1. MEDICATION: Does it recommend, prescribe, or suggest ANY specific medication or dosage? (Saying "take your prescribed medicine" is OK. Saying "take metformin 500mg" is NOT OK unless patient said their doctor prescribed it.)
2. ACCURACY: Are any clinical numbers wrong? (BP target should be <140/90, glucose target 70-130, etc.)
3. EMERGENCY: If patient mentioned chest pain, can't breathe, BP>180, sugar<50 or >400 — does the response tell them to call 199 or go to hospital?
4. HARM: Could following this advice cause harm to the patient?

Respond with ONLY valid JSON:
{{
  "safe": true or false,
  "issues": ["list of issues found, or empty"],
  "rewrite": "if not safe, provide a corrected version. if safe, set to null"
}}

JSON:"""}],
                temperature=0.1,
                max_tokens=300,
            )

            text = (review.choices[0].message.content or "").strip()
            if text.startswith("```"):
                text = re.sub(r"^```(?:json)?\s*", "", text)
                text = re.sub(r"```\s*$", "", text)

            result = json.loads(text)

            if not result.get("safe", True) and result.get("rewrite"):
                logger.warning(f"Safety review BLOCKED response. Issues: {result.get('issues')}")
                return result["rewrite"]

            return response

        except Exception as e:
            # If safety review fails, let the response through
            # (better to respond than to block on reviewer failure)
            logger.warning(f"Safety review failed (allowing response): {e}")
            return response

    def _format_emergency_response(self, emergency: Dict) -> str:
        response = "EMERGENCY ALERT\n\n"
        response += "This sounds like a medical emergency. Please act immediately:\n\n"
        response += f"1. CALL 199 (Ambulance) NOW\n"
        response += f"2. Or go directly to: {emergency.get('nearest_facility', 'EFSTH - Edward Francis Small Teaching Hospital')}\n"
        response += f"3. {emergency.get('immediate_action', 'Stay calm and do not move unless necessary')}\n\n"

        if emergency.get("warning_signs"):
            response += f"Watch for: {emergency.get('warning_signs')}\n\n"

        response += "If someone is with you, have them call while you prepare to leave.\n"
        response += "Stay strong — help is on the way."

        return response

    def clear_session(self, session_id: str):
        if session_id in self.sessions:
            del self.sessions[session_id]


# Singleton instance
_agent_instance = None


def get_agent() -> AminaAgent:
    global _agent_instance
    if _agent_instance is None:
        _agent_instance = AminaAgent()
    return _agent_instance
