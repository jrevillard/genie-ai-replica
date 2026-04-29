"""
AMINA Care — Guest Chat Patch
==============================
Strict-additive monkey-patch on AminaAgent.process_message that bypasses
the patient-counseling CHW pipeline for guest sessions.

Why
---
The base system prompt at src/agent/amina_agent.py:1696-1728 instructs
Groq/Gemini to act as a "Gambian community health worker (CHW) with 10
years experience" and to "ALWAYS recommend specific Gambian foods by
name — moringa porridge, Lumo market, sweet potato". It also addresses
"the patient" and tells the model to "ask the patient a question to
keep the conversation going". That prompt is appropriate for signed-in
patients but wrong for guests who:

  - Have no patient profile and no consent for personalised advice.
  - Have not chosen a country, language, or culture context.
  - Should never receive answers framed as if Amina remembers them.

The bug surface: a guest types "hi" and Amina replies with personalised
blood-sugar advice mentioning moringa porridge and Lumo market, because
the LLM is faithfully following the hardcoded CHW prompt.

What changes
------------
- We monkey-patch AminaAgent.process_message so that guest sessions
  short-circuit the heavy CHW pipeline and call Groq/Gemini directly
  with a guest-safe system prompt that:
    * does not reference specific foods, markets, or places
    * acknowledges the user is not signed in
    * tells the user to sign in for personal records / medications
    * gives general health education with safety disclaimers
- Authenticated sessions fall through to the original implementation
  byte-for-byte. No behaviour change for signed-in patients/caregivers.

Guest detection
---------------
A request is treated as a guest if EITHER:
  1. session_id starts with "guest_" (the format set by ChatPage.jsx
     and BeginnerChat.jsx for unauthenticated users), OR
  2. patient_id, patient_name, and phone are all empty AND user_role
     is empty/None — i.e. the call carries zero personalised context.

Either condition is sufficient. The session_id check protects against
stale auth-tokens, and the empty-context check protects against stale
session_ids.

Result shape
------------
The returned dict matches the keys agent_routes.AgentChatResponse and
streaming_routes._stream_response read, so guests work transparently
through both /api/v1/agent/chat and /api/v1/agent/chat-stream.

Idempotent install — calling install() twice is a no-op. Wired by
main_with_rag_tuning.py.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger("guest_chat_patch")

_INSTALLED = False
_orig_process_message = None

_GUEST_SESSION_PREFIX = "guest_"

_GUEST_SYS = (
    "You are Amina, a general health-information assistant. "
    "The user is NOT signed in. You DO NOT know their name, age, gender, "
    "country, language, conditions, medications, allergies, location, or care plan. "
    "Do not invent personal context. Do not assume the user lives anywhere "
    "in particular. Do not refer to specific local foods, markets, regions, "
    "or place names unless the user mentions them first. "
    "If the user greets you (e.g. 'hi', 'hello'), reply with a short neutral "
    "greeting and ask how you can help with their health question. "
    "If the user asks about their own records, medications, lab results, "
    "appointments, care plan, or caregiver, tell them they need to sign in "
    "before you can access personal information. "
    "If the user asks a general health question, give brief, evidence-based "
    "education in plain language (2-4 short paragraphs). Encourage them to "
    "sign in if they want personalised guidance, and to consult a clinician "
    "for diagnosis or treatment decisions. "
    "If the user describes symptoms that may be an emergency (chest pain, "
    "difficulty breathing, severe bleeding, signs of stroke, suicidal "
    "thoughts), advise them to seek immediate medical care. "
    "Never name or prescribe specific medications or doses. Never speculate "
    "about the user's diagnosis."
)


# ── LLM call ────────────────────────────────────────────────────────
async def _guest_llm_call(
    agent,
    message: str,
    model_preference: Optional[str],
    short_history: List[Dict[str, str]],
) -> str:
    """Call Groq → Gemini in cascade. Returns the text or raises if all fail."""
    candidates: List[str] = []
    pref = (model_preference or "").lower()
    if pref in ("groq", "gemini"):
        candidates.append(pref)
    for p in ("groq", "gemini"):
        if p not in candidates:
            candidates.append(p)

    messages: List[Dict[str, str]] = [{"role": "system", "content": _GUEST_SYS}]
    if short_history:
        messages.extend(short_history)
    messages.append({"role": "user", "content": message})

    last_err: Optional[Exception] = None
    for p in candidates:
        client = getattr(agent, f"{p}_client", None)
        model  = getattr(agent, f"{p}_model_name", None)
        if not client or not model:
            continue
        try:
            resp = await client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=0.4,
                max_tokens=400,
            )
            text = (resp.choices[0].message.content or "").strip()
            if text:
                logger.info("[guest_chat_patch] served via %s (%d chars)", p, len(text))
                return text
        except Exception as e:
            last_err = e
            logger.warning("[guest_chat_patch] %s failed: %s", p, e)
            continue

    raise RuntimeError(f"all guest-tier models failed; last error: {last_err}")


# ── Per-session short history (in-memory, no patient context) ──────
# We keep a small ring buffer of the last few turns per guest session so
# follow-up questions like "what about diabetes?" still make sense. This
# is independent from AminaAgent.session_memories — guests never touch
# the patient memory store.
_GUEST_HISTORY: Dict[str, List[Dict[str, str]]] = {}
_HISTORY_TURNS = 4


def _record(session_id: str, role: str, text: str) -> None:
    if not session_id or not text:
        return
    buf = _GUEST_HISTORY.setdefault(session_id, [])
    buf.append({"role": role, "content": text[:1500]})
    if len(buf) > _HISTORY_TURNS * 2:
        del buf[0 : len(buf) - _HISTORY_TURNS * 2]


def _short_history(session_id: str) -> List[Dict[str, str]]:
    return list(_GUEST_HISTORY.get(session_id, []))


# ── Result envelope ────────────────────────────────────────────────
def _empty_result(text: str) -> Dict[str, Any]:
    """Result dict matching the keys the chat / stream routes read."""
    return {
        "response":              text,
        "triage_level":          None,
        "tools_used":            [],
        "followup":              None,
        "is_emergency":          False,
        "suggest_form":          None,
        "suggest_notifications": False,
        "intention":             None,
        "trust_tier":            None,
        "ethnic_language":       None,
        "vitals_trend":          None,
        "ritual_phase":          None,
        "journey_callback":      None,
        "anniversary":           None,
        "referral_consumed":     None,
        "user_role":             "guest",
        "sources":               [],
        "export_action":         None,
    }


# ── Wrapper ────────────────────────────────────────────────────────
async def _guest_aware_process_message(self, *args, **kwargs):
    # Resolve common args from positional or kwargs. We mirror the
    # original signature: process_message(message, session_id, patient_id=...,
    # patient_name=..., phone=..., channel=..., user_role=..., regenerate_hint=...,
    # model_preference=...)
    def _arg(name: str, idx: int, default=""):
        if name in kwargs:
            return kwargs[name]
        if len(args) > idx:
            return args[idx]
        return default

    message          = _arg("message",          0, "")
    session_id       = _arg("session_id",       1, "")
    patient_id       = _arg("patient_id",       2, None)
    patient_name     = _arg("patient_name",     3, None)
    phone            = _arg("phone",            4, None)
    user_role        = _arg("user_role",        6, None)
    model_preference = _arg("model_preference", 8, None)

    is_guest_by_sid = isinstance(session_id, str) and session_id.startswith(_GUEST_SESSION_PREFIX)
    is_guest_by_ctx = (
        not (patient_id and str(patient_id).strip())
        and not (patient_name and str(patient_name).strip())
        and not (phone and str(phone).strip())
        and not (user_role and str(user_role).strip())
    )
    is_guest = is_guest_by_sid or is_guest_by_ctx

    if not is_guest:
        return await _orig_process_message(self, *args, **kwargs)

    # ── Guest path ────────────────────────────────────────────────
    history = _short_history(session_id)
    try:
        response_text = await _guest_llm_call(
            self, message or "", model_preference or "groq", history)
    except Exception as e:
        logger.error("[guest_chat_patch] all models failed: %s", e)
        response_text = (
            "I'm temporarily unable to respond on the free tier. "
            "Please try again in a moment, or sign in to use the full Amina experience."
        )

    _record(session_id, "user",      message or "")
    _record(session_id, "assistant", response_text or "")
    return _empty_result(response_text)


# ── Install ────────────────────────────────────────────────────────
def install() -> None:
    global _INSTALLED, _orig_process_message
    if _INSTALLED:
        return
    try:
        from src.agent.amina_agent import AminaAgent
    except ImportError as e:
        logger.warning("guest_chat_patch: AminaAgent not available: %s", e)
        return
    _orig_process_message = AminaAgent.process_message
    AminaAgent.process_message = _guest_aware_process_message
    _INSTALLED = True
    logger.info("guest_chat_patch installed: guest sessions bypass CHW pipeline")


install()
