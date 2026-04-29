# app/services/llm_openai.py

from __future__ import annotations

import re
from typing import List, Dict, Any, Optional

import httpx

from app.services.core.config import settings
from app.services.core.errors import TimeoutError, UpstreamError, Unauthorized
from app.services.core.logging import get_logger

log = get_logger("llm_openai")

# ═══════════════════════════════════════════════════════════
# SYSTEM PROMPT — NCD & Health Focused
# ═══════════════════════════════════════════════════════════

SYSTEM_PROMPT = (
    settings.SYSTEM_PROMPT
    if hasattr(settings, "SYSTEM_PROMPT") and settings.SYSTEM_PROMPT
    else """You are Amina, a specialized AI health assistant focused on Non-Communicable Diseases (NCDs) and general wellness.

## Your Expertise (PRIMARY FOCUS)
You specialize in these Non-Communicable Diseases and health areas:

1. Diabetes (Type 1, Type 2, gestational, prediabetes)
   - Blood sugar management, HbA1c, insulin, oral medications
   - Diet planning, carb counting, glycemic index
   - Complications: neuropathy, retinopathy, nephropathy, foot care

2. Cardiovascular Disease
   - Hypertension (high blood pressure) management
   - Heart disease risk factors, cholesterol (LDL/HDL)
   - Stroke awareness and prevention
   - Heart-healthy lifestyle changes

3. Cancer Awareness
   - Common warning signs and screening schedules
   - Risk factors and prevention strategies
   - Supporting patients through treatment side effects
   - When to seek immediate medical attention

4. Chronic Respiratory Disease
   - Asthma management and triggers
   - COPD management and breathing exercises
   - Smoking cessation guidance
   - Air quality and lung health

5. Mental Health & Wellness
   - Stress management and coping techniques
   - Anxiety and depression awareness
   - Sleep hygiene and insomnia
   - Mind-body connection with chronic disease

6. General Wellness & Prevention
   - Nutrition and healthy eating
   - Physical activity and exercise
   - Weight management
   - Preventive screenings and checkups
   - Medication adherence and drug interactions
   - Chronic pain management

## Your Personality
- Warm, empathetic, and professional
- Culturally sensitive, especially to African and developing-world health contexts
- You remember everything the user tells you within the conversation
- You refer back to previous context naturally
- You ask follow-up questions to give better, personalized advice

## Response Rules
- Never diagnose. Always say "this could be" or "you might want to check with your doctor"
- If the user shares symptoms, ask clarifying questions before advising
- Remember allergies, conditions, and preferences mentioned earlier
- Keep responses conversational and natural since they will be spoken aloud
- If unsure, say so honestly rather than guessing
- Do not use asterisks, bold markers, or markdown formatting symbols
- Give actionable, concise advice (2-4 sentences unless more detail is requested)
- Always recommend professional medical consultation for serious or urgent concerns
- For emergencies (chest pain, difficulty breathing, stroke symptoms), immediately tell the user to call emergency services

## OFF-TOPIC HANDLING
If the user asks about something unrelated to health, wellness, or NCDs:
- Acknowledge their question warmly
- Gently explain that you specialize in health and NCD guidance
- Redirect back to health topics
- Example: "That's a great question, but my expertise is really in health and wellness. I'm best at helping with things like managing diabetes, blood pressure, nutrition, or mental wellness. Is there anything health-related I can help you with?"

Do NOT answer questions about:
- Politics, religion, or controversial social topics
- Financial advice, legal advice, or business guidance
- Technical support, coding, or IT help
- Entertainment, sports, or celebrity gossip
- Homework, academic assignments, or general knowledge trivia
- Cooking recipes (unless specifically related to managing a health condition like diabetes-friendly meals)

For these topics, always redirect warmly and professionally back to health.
"""
)


# ═══════════════════════════════════════════════════════════
# TOPIC GUARDRAIL — Fast check before calling LLM
# ═══════════════════════════════════════════════════════════

# Health-related keywords (if ANY match, it's on-topic → send to LLM)
_HEALTH_KEYWORDS = {
    # NCD diseases
    "diabetes", "diabetic", "blood sugar", "glucose", "insulin", "hba1c", "a1c",
    "hypertension", "blood pressure", "bp", "cholesterol", "ldl", "hdl",
    "heart", "cardiac", "cardiovascular", "stroke", "artery", "arteries",
    "cancer", "tumor", "tumour", "chemo", "chemotherapy", "oncology", "biopsy",
    "asthma", "copd", "bronchitis", "lung", "respiratory", "breathing",
    "obesity", "overweight", "bmi", "weight",
    # Mental health
    "depression", "anxiety", "stress", "mental health", "insomnia", "sleep",
    "panic", "therapy", "counseling", "counselling", "burnout", "ptsd",
    # Symptoms
    "pain", "ache", "headache", "migraine", "fever", "cough", "fatigue",
    "dizzy", "dizziness", "nausea", "vomit", "diarrhea", "constipation",
    "swelling", "rash", "itch", "bleeding", "numbness", "tingling",
    "shortness of breath", "chest pain", "palpitation",
    # General health
    "health", "healthy", "wellness", "wellbeing", "doctor", "hospital",
    "medication", "medicine", "drug", "pill", "tablet", "dose", "dosage",
    "prescription", "side effect", "allergy", "allergic",
    "diet", "nutrition", "vitamin", "supplement", "exercise", "fitness",
    "vaccine", "vaccination", "immunization",
    "pregnancy", "pregnant", "prenatal", "postnatal",
    "screening", "checkup", "check-up", "test result", "lab result",
    "smoking", "alcohol", "quit smoking", "addiction",
    "surgery", "operation", "procedure",
    "infection", "flu", "cold", "malaria", "hiv", "aids", "tuberculosis", "tb",
    # Body parts
    "kidney", "liver", "pancreas", "thyroid", "bone", "joint", "muscle",
    "eye", "vision", "ear", "hearing", "skin", "teeth", "dental",
    # Greetings and conversation (always allow)
    "hello", "hi", "hey", "good morning", "good evening", "good afternoon",
    "how are you", "thank", "thanks", "bye", "goodbye", "help",
    "what can you do", "who are you", "your name", "amina",
}

# Off-topic polite redirect (returned WITHOUT calling the LLM — saves tokens)
_REDIRECT_RESPONSE = (
    "That's an interesting question! However, my expertise is specifically in "
    "health and wellness, particularly Non-Communicable Diseases like diabetes, "
    "heart disease, respiratory conditions, and mental health. "
    "Is there anything health-related I can help you with today? "
    "For example, I can help with managing blood pressure, understanding medications, "
    "nutrition advice, or stress management."
)


def _is_health_related(text: str) -> bool:
    """
    Quick keyword check to determine if a message is health-related.
    Returns True if on-topic (proceed to LLM), False if clearly off-topic.

    This is a FAST pre-filter — borderline cases pass through to the LLM,
    which has its own off-topic handling in the system prompt.
    """
    lower = text.lower().strip()

    # Short messages (< 4 words) are usually greetings or follow-ups — allow
    if len(lower.split()) < 4:
        return True

    # Check if any health keyword appears
    for kw in _HEALTH_KEYWORDS:
        if kw in lower:
            return True

    # Questions that start with health-adjacent patterns
    health_patterns = [
        r"^(what|how|why|can|should|is|are|do|does|will|could|would).*(health|symptom|disease|condition|treat|manage|prevent|cure|diagnose|medic|doctor|hospital)",
        r"^(i have|i feel|i got|i'm feeling|i am feeling|my .* hurts|my .* is)",
        r"^(tell me about|explain|what is|what are|how to|how do i)",
    ]
    for pattern in health_patterns:
        if re.search(pattern, lower):
            return True

    return False


# ═══════════════════════════════════════════════════════════
# MARKDOWN STRIPPER
# ═══════════════════════════════════════════════════════════

def _strip_markdown(text: str) -> str:
    """Remove any markdown formatting that slipped through."""
    text = re.sub(r'\*{1,3}(.+?)\*{1,3}', r'\1', text)
    text = re.sub(r'_{1,3}(.+?)_{1,3}', r'\1', text)
    text = re.sub(r'^#{1,6}\s*', '', text, flags=re.MULTILINE)
    text = re.sub(r'^[\s]*[-*•]\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'^[\s]*\d+\.\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'^>\s*', '', text, flags=re.MULTILINE)
    text = re.sub(r'`(.+?)`', r'\1', text)
    text = text.replace('*', '')
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


# ═══════════════════════════════════════════════════════════
# OPENAI CLIENT
# ═══════════════════════════════════════════════════════════

class OpenAIClient:
    def __init__(self):
        if not settings.OPENAI_API_KEY:
            raise Unauthorized("OPENAI_API_KEY is not set")

        self.base_url = str(settings.OPENAI_BASE_URL).rstrip("/")
        self.model = settings.OPENAI_MODEL
        self.timeout_s = settings.LLM_TIMEOUT_S

    async def chat(
        self,
        user_text: str,
        history: Optional[List[Dict[str, str]]] = None,
        system_prompt: Optional[str] = None,
    ) -> str:
        """
        Calls OpenAI Chat Completions API with full conversation history.

        Two-layer topic filtering:
        1. Fast keyword check (_is_health_related) — skips LLM for clearly off-topic
        2. System prompt instructions — LLM handles borderline cases itself
        """

        # ── Layer 1: Fast guardrail (saves LLM tokens for obvious off-topic) ──
        if not _is_health_related(user_text):
            log.info("topic_redirect", text=user_text[:50], reason="off_topic")
            return _REDIRECT_RESPONSE

        # ── Layer 2: Send to LLM (system prompt handles subtle off-topic) ──
        url = f"{self.base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
            "Content-Type": "application/json",
        }

        messages: List[Dict[str, str]] = [
            {"role": "system", "content": system_prompt or SYSTEM_PROMPT},
        ]

        if history:
            for msg in history:
                role = msg.get("role", "user")
                content = msg.get("content", "")
                if role in ("user", "assistant") and content.strip():
                    messages.append({"role": role, "content": content})

        messages.append({"role": "user", "content": user_text})

        body: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.3,
        }

        log.info(
            "llm_request",
            model=self.model,
            history_len=len(history) if history else 0,
            total_messages=len(messages),
        )

        try:
            async with httpx.AsyncClient(timeout=self.timeout_s) as client:
                resp = await client.post(url, headers=headers, json=body)
        except httpx.TimeoutException as e:
            raise TimeoutError(upstream="openai", detail=str(e))
        except httpx.RequestError as e:
            raise UpstreamError(
                upstream="openai",
                message="Failed to reach OpenAI",
                detail=str(e),
            )

        if resp.status_code == 401:
            raise Unauthorized("OpenAI auth failed. Check OPENAI_API_KEY.")

        if resp.status_code >= 400:
            raise UpstreamError(
                upstream="openai",
                message=f"OpenAI error {resp.status_code}",
                detail=resp.text,
            )

        data = resp.json()

        try:
            answer = data["choices"][0]["message"]["content"]
        except Exception:
            raise UpstreamError(
                upstream="openai",
                message="Unexpected OpenAI response",
                detail=data,
            )

        answer = (answer or "").strip()
        answer = _strip_markdown(answer)

        log.info("llm_done", chars=len(answer))
        return answer