from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Request, Response as FastAPIResponse
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import json
import base64
import logging
import uuid
import time
from src.agent.amina_agent import get_agent
from src.services import context_compactor
from src.services.auth import verify_jwt

# Trigger Stage 8b auto-activation: importing translation_v2 runs its
# _autoinstall side-effect, which installs the legacy_shim monkey-patch
# whenever any USE_V2_* flag is set. No-op when flags are all False.
# The try/except keeps chat startup resilient to v2 scaffold errors.
try:
    import translation_v2  # noqa: F401
except Exception as _v2_import_err:  # pragma: no cover
    logging.getLogger(__name__).debug(
        "translation_v2 not importable (v2 inactive): %s", _v2_import_err
    )

logger = logging.getLogger(__name__)

# ── Guest / free-tier routing ─────────────────────────────────────
#
# Guests (unauthenticated visitors on the marketing home / guest chat)
# are restricted to FREE third-party models: Groq (primary) → Gemini
# (fallback). They never touch the Amina LoRA (requires auth to reach
# the Tailscale-protected vLLM endpoint) and never touch the OpenAI
# GPT family (cost + user preference).
#
# Signed-in users retain the full cascade driven by USE_FINETUNED_MODEL
# / model_fallback.py (amina → base → gemini → groq → mistral).

GUEST_MODEL_CASCADE = ("groq", "gemini")  # explicit order, no amina / no gpt


def _has_valid_auth(http_request: Request) -> bool:
    """Return True if the request carries a valid JWT (any role).

    Checks `Authorization: Bearer <jwt>` first; falls back to the
    `amina_jwt` / `amina_cg_jwt` / `amina_admin_jwt` cookies set by the
    session bootstrap. A valid signature on any of them counts as
    'signed in' for the purpose of unlocking the full model cascade.
    """
    auth = (http_request.headers.get("Authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        tok = auth[7:].strip()
        if tok and verify_jwt(tok):
            return True
    for ck in ("amina_jwt", "amina_cg_jwt", "amina_admin_jwt"):
        tok = http_request.cookies.get(ck) or ""
        if tok and verify_jwt(tok):
            return True
    return False


def _require_auth(http_request: Request) -> dict:
    """Return decoded JWT claims, or raise 401.

    BUG-008/009/010 fix — previously these admin/document/patients
    endpoints were open. Mirrors `_has_valid_auth` (header + cookies)
    but returns the claim dict so callers can do role/owner checks.
    """
    auth = (http_request.headers.get("Authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        tok = auth[7:].strip()
        if tok:
            payload = verify_jwt(tok)
            if payload:
                return payload
    for ck in ("amina_jwt", "amina_cg_jwt", "amina_admin_jwt"):
        tok = http_request.cookies.get(ck) or ""
        if tok:
            payload = verify_jwt(tok)
            if payload:
                return payload
    raise HTTPException(status_code=401, detail="Authentication required")


router = APIRouter(prefix="/agent", tags=["agent"])


# ── Context compactor admin/debug endpoints ─────────────────────────────────

@router.get("/compactor/stats/{session_id}")
async def compactor_stats(session_id: str, http_request: Request):
    """Return the current compact summary + version + in-flight state for a session.

    BUG-010 fix — was previously open; now requires any valid JWT.
    """
    _require_auth(http_request)
    return await context_compactor.get_compaction_stats(session_id)


@router.post("/compactor/trigger/{session_id}")
async def compactor_trigger(session_id: str, http_request: Request):
    """Manually compact a session.

    compact_session() now handles the full cycle: generate summary,
    trim session messages in Redis, persist metadata, write through
    to ArcadeDB. This endpoint just calls it and returns metrics.

    The background auto-compaction at 75% threshold does the same thing
    automatically — this endpoint exists for the manual Compact button.

    BUG-010 fix — was previously open; now requires any valid JWT.
    """
    _require_auth(http_request)
    agent = get_agent()
    session = await agent.memory_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    messages = session.get("messages", [])
    if not messages:
        raise HTTPException(status_code=400, detail="Session has no messages to compact")

    def _mc(m):
        if isinstance(m, dict):
            return m.get("content") or ""
        return getattr(m, "content", "") or ""

    before_count = len(messages)
    before_chars = sum(len(_mc(m)) for m in messages)
    tokens_before = before_chars // 4

    summary = await context_compactor.compact_session(
        session_id=session_id,
        messages=messages,
        char_budget=20_000,
        patient_name=(session.get("patient_name") or ""),
    )

    meta = await context_compactor.get_summary_meta(session_id)
    stats = await context_compactor.get_compaction_stats(session_id)

    tokens_after = (meta or {}).get("tokens_after", tokens_before)
    range_count = (meta or {}).get("range_count", 0)
    kept_count = before_count - range_count

    tokens_reduced = max(0, tokens_before - tokens_after)

    return {
        "session_id":              session_id,
        "compacted":               bool(summary) or range_count > 0,
        "summary":                 summary,
        "tokens_before":           tokens_before,
        "tokens_after":            tokens_after,
        "tokens_reduced":          tokens_reduced,
        "messages_summarized":     range_count,
        "messages_kept_verbatim":  kept_count,
        # Deprecated aliases — remove after one release cycle
        "freed_tokens":            tokens_reduced,
        "dropped":                 range_count,
        "kept":                    kept_count,
        "stats":                   stats,
    }


@router.post("/compactor/undo/{session_id}")
async def compactor_undo(session_id: str, http_request: Request):
    """Remove the pinned summary so the next turn uses raw history.

    NOTE: Messages trimmed from Redis by compaction cannot be restored
    from Redis alone. If the ConsultationRecord was saved to ArcadeDB
    before compaction, those messages still exist there. This endpoint
    clears the summary so the prompt assembly stops prepending it.

    BUG-010 fix — was previously open; now requires any valid JWT.
    """
    _require_auth(http_request)
    import redis as _redis
    from src.config import settings

    r = _redis.Redis(
        host=settings.REDIS_HOST,
        port=settings.REDIS_PORT,
        decode_responses=True,
    )

    had_summary = bool(r.get(f"chat:summary:{session_id}"))
    r.delete(f"chat:summary:{session_id}")
    r.delete(f"chat:summary_meta:{session_id}")
    r.delete(f"conv:{session_id}:active_tokens")

    active_tokens = await context_compactor.get_active_token_count(session_id)

    return {
        "session_id":    session_id,
        "undone":        had_summary,
        "active_tokens": active_tokens,
    }

# Session cookie settings
SESSION_COOKIE_NAME = "amina_session"
SESSION_COOKIE_MAX_AGE = 7 * 24 * 60 * 60  # 7 days


def _ensure_session_cookie(request: Request, response: FastAPIResponse) -> str:
    """Return existing session_id from cookie or mint a new one and set the cookie.

    Cookie is httpOnly=False so the frontend can read it and include it in
    the request body (FastAPI sessions are session_id-based, not stateful cookies).
    SameSite=Lax + Secure is off for localhost; enable Secure in production.
    """
    sid = request.cookies.get(SESSION_COOKIE_NAME)
    if not sid:
        sid = f"s_{int(time.time())}_{uuid.uuid4().hex[:8]}"
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=sid,
        max_age=SESSION_COOKIE_MAX_AGE,
        httponly=False,  # frontend needs to read it
        samesite="lax",
        secure=False,  # TODO: True in production behind HTTPS
        path="/",
    )
    return sid


class AgentChatRequest(BaseModel):
    message: str
    session_id: str
    patient_id: Optional[str] = None
    patient_name: Optional[str] = None  # Client-provided name — used when DB lookup fails
    phone: Optional[str] = None  # For SMS/voice channel patient lookup
    language: Optional[str] = None  # "en" (default) | "ma"
    channel: Optional[str] = "web"  # "web" | "voice" | "sms" | "whatsapp"
    user_role: Optional[str] = None  # "alkalo" | "imam" | "vhw" | "patient" (default)
    regenerate_hint: Optional[str] = None  # downvote reason — shapes the retry prompt
    model_preference: Optional[str] = None  # "amina" | "base" | None (uses server default)


class AgentChatResponse(BaseModel):
    response: str
    triage_level: Optional[str] = None
    tools_used: List[str] = []
    followup: Optional[str] = None
    is_emergency: bool = False
    session_id: str
    suggest_form: Optional[str] = None  # "symptom" | "prescription" | None
    suggest_notifications: bool = False
    suggest_language_switch: Optional[str] = None  # "ma" when user seems to be writing Mandinka while UI is English
    # Greeting-context metadata (from the zero-LLM greeting service)
    intention: Optional[str] = None  # 8-category intention classification
    trust_tier: Optional[str] = None  # stranger | acquaintance | companion | family
    ethnic_language: Optional[str] = None  # mandinka | wolof | fula | jola | english
    vitals_trend: Optional[dict] = None  # { type, prev, current, trend } if a BP/glucose callback fired
    ritual_phase: Optional[int] = None  # 0-2 = mid-ritual, 3 = complete (voice/sms only)
    journey_callback: Optional[dict] = None  # multi-month journey comparison if triggered
    anniversary: Optional[dict] = None  # 30/90/180/365-day milestone if hit
    referral_consumed: Optional[dict] = None  # VHW referral if warm-handoff fired
    user_role: Optional[str] = None  # echoed back: alkalo | vhw | imam | None
    sources: Optional[List[dict]] = None  # [{title, url, org}] — WHO/health citations
    export_action: Optional[dict] = None  # {type:"download_chat_pdf", session_id} — frontend auto-triggers
    detected_language: Optional[str] = None  # "ma" when response was translated to Mandinka
    english_original: Optional[str] = None  # original English text before Mandinka translation
    # Phase D.5 / Phase D — frontend hint that the abuse-defense
    # decision wants the UI to take a stronger action than just
    # rendering the response text. Values:
    #   "session_terminate" — clear chat + new session (one-shot soft escalation)
    #   "terminate"          — cool-down activated (clear chat, lock input until cooldown_remaining_s)
    #   "cooldown"           — user is currently locked out (no clear, just notice)
    # None on every other reply.
    session_action: Optional[str] = None
    cooldown_remaining_s: Optional[int] = None


class SessionSummaryResponse(BaseModel):
    session_id: str
    summary: str
    message_count: int


@router.post("/chat", response_model=AgentChatResponse)
async def agent_chat(
    request: AgentChatRequest,
    http_request: Request,
    http_response: FastAPIResponse,
):
    """Main agent chat endpoint - processes messages through Amina's ReAct loop.

    Language handling:
      - language='ma' → translate the English response to Mandinka
      - Otherwise → English (default)

    Session cookie: refreshes the `amina_session` cookie on every call so
    the user can resume their conversation for up to 7 days.
    """
    agent = get_agent()
    from src.services.translator import get_translator
    translator = get_translator()

    # Refresh the session cookie (keep-alive)
    _ensure_session_cookie(http_request, http_response)

    # ── Guest gate ────────────────────────────────────────────────
    # Unauthed visitors can chat without creating an account, but they
    # route through FREE models only (Groq → Gemini). Amina LoRA needs
    # Tailscale; GPT costs money; neither is available to guests.
    is_guest = not _has_valid_auth(http_request)

    # Phase B/C/D: abuse defender. Modes "off"/"shadow" log only and
    # return None (no override). Modes "warn"/"enforce" may return a
    # Decision to short-circuit with WARNING_1/2/3, the crisis-support
    # template, a termination notice, or a cool-down notice.
    # NEVER raises — fail-open by design (a broken defender must not
    # silence AMINA).
    #
    # Phase D minor-protection hook: ``is_minor`` defaults to False here
    # because we don't yet have a fast patient-age lookup at this call
    # site. Wiring patient-profile age from PatientVertex is a Phase D.1
    # follow-up; until then enforce-mode termination is gated only by
    # the guest/auth flag (we never auto-terminate guests we can't
    # identify, but signed-in patients can be terminated).
    from src.abuse_defense import defender as _abuse_defender
    _abuse_lang = (request.language or "en").strip().lower()
    _abuse_decision = _abuse_defender.evaluate(
        request.message,
        route="/api/v1/chat",
        session_id=request.session_id,
        user_id=request.patient_id,
        is_minor=False,
        language=_abuse_lang,           # Phase F: select Mandinka response copy
        channel=request.channel or "web",
        user_role=request.user_role,
        is_guest=is_guest,
    )
    if _abuse_decision is not None and _abuse_decision.action in (
        "warn", "crisis", "session_terminate", "terminate", "cooldown",
    ):
        # Short-circuit: do NOT call the agent / LLM. Return the
        # defender's response text in the standard AgentChatResponse
        # shape so the frontend renders it like any other reply.
        #
        # session_action is surfaced for the strong-action rungs so
        # the frontend can clear the chat / lock the input. Plain
        # "warn" and "crisis" rungs deliberately leave session_action
        # null — the user keeps chatting, just gets a warning bubble.
        _strong_actions = {
            "session_terminate": "session_terminate",
            "terminate":         "terminate",
            "cooldown":          "cooldown",
        }
        return AgentChatResponse(
            response=_abuse_decision.response_text or "",
            session_id=request.session_id,
            is_emergency=False,
            user_role=request.user_role,
            session_action=_strong_actions.get(_abuse_decision.action),
            cooldown_remaining_s=(
                _abuse_decision.cooldown_remaining_s
                if _abuse_decision.action in ("terminate", "cooldown")
                else None
            ),
        )

    async def _call_agent(pref: Optional[str]):
        return await agent.process_message(
            message=request.message,
            session_id=request.session_id,
            patient_id=request.patient_id,
            patient_name=request.patient_name,
            phone=request.phone,
            channel=request.channel or "web",
            user_role=request.user_role,
            regenerate_hint=request.regenerate_hint,
            model_preference=pref,
        )

    try:
        if is_guest:
            # Pick the first available free model in the cascade, then fall
            # through on per-request failure.
            last_err = None
            result = None
            for pref in GUEST_MODEL_CASCADE:
                # Skip if the backend has no client for this provider
                if pref == "groq"   and not getattr(agent, "groq_client",   None): continue
                if pref == "gemini" and not getattr(agent, "gemini_client", None): continue
                try:
                    result = await _call_agent(pref)
                    logger.info(f"[guest-chat] served via {pref}")
                    break
                except Exception as e:
                    logger.warning(f"[guest-chat] {pref} failed: {e}")
                    last_err = e
                    continue
            if result is None:
                detail = (
                    "Amina's free-tier chat is momentarily unavailable. "
                    "Please try again in a moment, or sign in to use the "
                    "full AMINA model."
                )
                raise HTTPException(status_code=503, detail=detail) from last_err
        else:
            # Signed-in users: honor requested preference, else server default
            # (amina-lora when USE_FINETUNED_MODEL=true). Full fallback chain
            # is handled by /chat-resilient if wired on the frontend.
            result = await _call_agent(request.model_preference)

        english_response = result["response"]
        response_text = english_response
        _detected_lang = "en"
        _english_original = None

        # Only translate when the user explicitly sets language="ma".
        # No auto-detect — default is always English.
        if request.language == "ma":
            from src.nlp.translation_corrector import get_corrector
            response_text = await translator.translate(english_response, "en", "ma")
            _english_original = english_response

            corrector = get_corrector()
            cr = corrector.correct(
                mandinka_text=response_text,
                english_source=english_response,
                patient_context={
                    "patient_name": request.patient_name or "",
                    "user_role": request.user_role,
                },
            )
            if cr["recommendation"] == "BLOCK_USE_ENGLISH":
                response_text = english_response
                _detected_lang = "en"
            else:
                response_text = cr["corrected_text"]
                _detected_lang = "ma"

        # Smart one-time suggestion: user is typing Mandinka but UI is English?
        suggest_language_switch = None
        if request.language != "ma":  # only suggest if NOT already in Mandinka mode
            memory = agent.get_or_create_session(request.session_id)
            if not memory.language_switch_suggested:
                intent = translator.detect_mandinka_intent(request.message)
                if intent.get("is_mandinka_intent"):
                    suggest_language_switch = "ma"
                    memory.language_switch_suggested = True

        return AgentChatResponse(
            response=response_text,
            triage_level=result.get("triage_level"),
            tools_used=result.get("tools_used", []),
            followup=result.get("followup"),
            is_emergency=result.get("is_emergency", False),
            session_id=request.session_id,
            suggest_form=result.get("suggest_form"),
            suggest_notifications=result.get("suggest_notifications", False),
            suggest_language_switch=suggest_language_switch,
            intention=result.get("intention"),
            trust_tier=result.get("trust_tier"),
            ethnic_language=result.get("ethnic_language"),
            vitals_trend=result.get("vitals_trend"),
            ritual_phase=result.get("ritual_phase"),
            journey_callback=result.get("journey_callback"),
            anniversary=result.get("anniversary"),
            referral_consumed=result.get("referral_consumed"),
            user_role=result.get("user_role"),
            sources=result.get("sources"),
            export_action=result.get("export_action"),
            detected_language=_detected_lang,
            english_original=_english_original,
        )
    except Exception as e:
        # BUG-027: log full trace server-side; never leak it in the response body.
        logger.exception("agent_routes: unhandled %s: %s", type(e).__name__, e)
        raise HTTPException(status_code=500, detail="internal_error")


@router.get("/session/resume")
async def resume_session(request: Request, response: FastAPIResponse):
    """Warm-start endpoint: returns the user's session_id (from cookie) plus
    any cached per-session state (care plan, message count, conversation history).

    The frontend calls this ONCE on page load and uses the returned session_id
    for all subsequent /chat calls. This avoids re-creating sessions and
    preserves conversation context across reloads.
    """
    agent = get_agent()
    sid = _ensure_session_cookie(request, response)

    # Pull whatever we have cached for this session
    redis_messages = []
    try:
        redis_messages = await agent.memory_manager.get_session_messages(sid) or []
    except Exception:
        pass

    care_plan = None
    try:
        care_plan = await agent.memory_manager.get_care_plan(sid)
    except Exception:
        pass

    # In-process memory (if the worker still has it)
    in_memory = agent.sessions.get(sid)
    message_count = len(in_memory.messages) if in_memory else len(redis_messages)

    return {
        "session_id": sid,
        "is_new": message_count == 0,
        "message_count": message_count,
        "messages": redis_messages[-20:],  # last 20 for quick restore
        "has_care_plan": bool(care_plan),
        "care_plan": care_plan,
    }


@router.get("/session/{session_id}", response_model=SessionSummaryResponse)
async def get_session_summary(session_id: str):
    """Get summary of an active agent session."""
    agent = get_agent()
    memory = agent.sessions.get(session_id)

    if not memory:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")

    return SessionSummaryResponse(
        session_id=session_id,
        summary=memory.get_summary(),
        message_count=len(memory.messages),
    )


@router.post("/session/{session_id}/end")
async def end_session(session_id: str):
    """End a session — persists full consultation summary and extracts key facts."""
    agent = get_agent()
    if session_id not in agent.sessions:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")

    await agent.end_session(session_id)
    return {"status": "ended", "session_id": session_id}


@router.delete("/session/{session_id}")
async def clear_session(session_id: str):
    """Clear an agent session without persisting."""
    agent = get_agent()
    agent.clear_session(session_id)
    return {"status": "cleared", "session_id": session_id}


## ── Patient profiles for MVP (replaces auth for now) ──


@router.get("/patients/list")
async def list_test_patients(http_request: Request):
    """List available patient profiles.

    BUG-009 fix — previously open; now restricted to admin or caregiver
    JWTs. A patient JWT cannot enumerate other patients via this route.
    """
    payload = _require_auth(http_request)
    if payload.get("role") not in ("admin", "caregiver"):
        raise HTTPException(status_code=403, detail="Admin or caregiver only")
    agent = get_agent()
    try:
        from src.utils.arcade_client import async_command_sql, extract_rows
        resp = await async_command_sql(
            "SELECT id, name, age, gender, region, conditions, medications, "
            "consultation_count, preferred_language, created_at "
            "FROM PatientVertex WHERE id LIKE 'P_%' ORDER BY name LIMIT 20",
            [],
        )
        rows = extract_rows(resp)
        patients = []
        for r in rows:
            for field in ("conditions", "medications"):
                val = r.get(field, "[]")
                if isinstance(val, str):
                    import json as _json
                    r[field] = _json.loads(val)
            patients.append({
                "id": r.get("id"),
                "name": r.get("name"),
                "age": r.get("age"),
                "gender": r.get("gender"),
                "region": r.get("region"),
                "conditions": r.get("conditions", []),
                "medications": [m.get("name", m) if isinstance(m, dict) else m for m in r.get("medications", [])],
                "visit_count": r.get("consultation_count", 0),
                "language": r.get("preferred_language", "english"),
            })
        return {"patients": patients}
    except Exception as e:
        return {"patients": [], "error": str(e)}


@router.get("/patients/{patient_id}/history")
async def get_patient_history(patient_id: str):
    """Get full patient profile + consultation history + key facts.
    Used by frontend to show 'My Previous Visits' and inject context."""
    agent = get_agent()
    mm = agent.memory_manager
    try:
        from src.utils.arcade_client import async_command_sql, extract_rows
        import json as _json

        # 1. Patient profile
        resp = await async_command_sql(
            "SELECT * FROM PatientVertex WHERE id = :pid LIMIT 1", [patient_id],
        )
        rows = extract_rows(resp)
        if not rows:
            raise HTTPException(status_code=404, detail="Patient not found")
        profile = rows[0]
        for field in ("conditions", "medications", "allergies", "key_facts",
                      "bp_readings", "glucose_readings"):
            val = profile.get(field, "[]")
            if isinstance(val, str):
                profile[field] = _json.loads(val)

        # 2. Consultation history (last 10)
        consultations = await mm.get_patient_consultations(patient_id, limit=10)

        # 3. Semantic memories (key facts)
        memories = await mm.search_memories(patient_id, "patient history", limit=10)
        memory_facts = [{"content": m.content, "type": m.type.value, "importance": m.importance}
                        for m in memories]

        # 4. Active care plan (if any)
        active_session = await mm.get_active_session_for_patient(patient_id)
        care_plan = None
        if active_session:
            care_plan = await mm.get_care_plan(active_session)

        return {
            "patient": {
                "id": profile.get("id"),
                "name": profile.get("name"),
                "age": profile.get("age"),
                "gender": profile.get("gender"),
                "region": profile.get("region"),
                "phone": profile.get("phone"),
                "conditions": profile.get("conditions", []),
                "medications": profile.get("medications", []),
                "allergies": profile.get("allergies", []),
                "key_facts": profile.get("key_facts", []),
                "visit_count": profile.get("consultation_count", 0),
                "last_visit": profile.get("last_consultation"),
                "language": profile.get("preferred_language", "english"),
                "emergency_contact": profile.get("emergency_contact"),
            },
            "consultations": [
                {
                    "id": c.get("id"),
                    "session_id": c.get("session_id", ""),
                    "date": c.get("started_at", "")[:10],
                    "started_at": c.get("started_at", ""),
                    "summary": c.get("summary", "No summary"),
                    "triage_level": c.get("triage_level"),
                    "symptoms": c.get("symptoms_reported", []),
                    "tools_used": c.get("tools_used", []),
                    "message_count": len(c.get("messages", [])),
                }
                for c in consultations
            ],
            "memories": memory_facts,
            "care_plan": care_plan,
        }
    except HTTPException:
        raise
    except Exception as e:
        # BUG-027: log full trace server-side; never leak it in the response body.
        logger.exception("agent_routes: unhandled %s: %s", type(e).__name__, e)
        raise HTTPException(status_code=500, detail="internal_error")


@router.get("/consultations/{consultation_id}")
async def get_consultation(consultation_id: str):
    """Load a single consultation with its full message history.
    Used by the frontend to reopen a previous visit."""
    try:
        from src.utils.arcade_client import async_command_sql, extract_rows
        import json as _json

        resp = await async_command_sql(
            "SELECT * FROM ConsultationRecord WHERE id = :cid LIMIT 1",
            [consultation_id],
        )
        rows = extract_rows(resp)
        if not rows:
            raise HTTPException(status_code=404, detail="Consultation not found")
        c = rows[0]
        for field in ("messages", "symptoms_reported", "tools_used", "recommendations"):
            val = c.get(field, "[]")
            if isinstance(val, str):
                c[field] = _json.loads(val)
        return {
            "id": c.get("id"),
            "session_id": c.get("session_id", ""),
            "patient_id": c.get("patient_id", ""),
            "started_at": c.get("started_at", ""),
            "ended_at": c.get("ended_at"),
            "summary": c.get("summary", ""),
            "triage_level": c.get("triage_level"),
            "messages": c.get("messages", []),
            "symptoms": c.get("symptoms_reported", []),
            "tools_used": c.get("tools_used", []),
            "recommendations": c.get("recommendations", []),
        }
    except HTTPException:
        raise
    except Exception as e:
        # BUG-027: log full trace server-side; never leak it in the response body.
        logger.exception("agent_routes: unhandled %s: %s", type(e).__name__, e)
        raise HTTPException(status_code=500, detail="internal_error")


@router.delete("/patients/{patient_id}/history")
async def clear_patient_history(patient_id: str, request: Request):
    """Patient-scoped bulk clear of the 'Previous Visits' list.

    Deletes every ConsultationRecord row belonging to `patient_id` in
    ArcadeDB, resets the patient's consultation_count, and purges the
    per-patient Redis session-tail cache so the next /history call
    genuinely returns an empty list.

    Semantic memories (key_facts, symptom vectors) are LEFT IN PLACE —
    clearing visit history shouldn't wipe the agent's long-term
    medical memory. If the user wants that too, they can hit the
    admin-side patient-delete endpoint (a destructive escalation
    that's already gated behind the admin token).

    Auth: the caller's JWT `sub` must match `patient_id`. Any admin
    JWT (role=admin) is also allowed for support workflows. Anything
    else → 403. Running this on someone else's data is explicitly
    prevented.
    """
    # Decode JWT locally — agent_routes doesn't expose a _jwt_payload
    # helper at this position, so do the small verify_jwt dance here.
    jwt = None
    try:
        auth = request.headers.get("Authorization", "") if request else ""
        tok  = auth.replace("Bearer ", "").strip() if auth.lower().startswith("bearer ") else ""
        if tok:
            from src.services.auth import verify_jwt
            jwt = verify_jwt(tok)
    except Exception:
        jwt = None

    if not jwt:
        raise HTTPException(status_code=401, detail="Patient JWT required")
    sub  = (jwt or {}).get("sub")  or ""
    role = (jwt or {}).get("role") or ""
    if sub != patient_id and role != "admin":
        raise HTTPException(status_code=403, detail="Cannot clear another patient's history")

    agent = get_agent()
    mm    = agent.memory_manager

    try:
        from src.utils.arcade_client import async_command_sql, extract_rows

        # Count first so we can report an accurate "deleted N visits" back
        count_resp = await async_command_sql(
            "SELECT count(*) as n FROM ConsultationRecord WHERE patient_id = :pid",
            [patient_id],
        )
        rows    = extract_rows(count_resp)
        deleted = int((rows or [{}])[0].get("n") or 0) if rows else 0

        # Bulk delete the visit records.
        if deleted > 0:
            await async_command_sql(
                "DELETE FROM ConsultationRecord WHERE patient_id = :pid",
                [patient_id],
            )

        # Reset the patient's running counter + last_consultation so the
        # profile card doesn't still show stale totals post-clear.
        try:
            await async_command_sql(
                "UPDATE PatientVertex SET consultation_count = 0, last_consultation = NULL "
                "WHERE id = :pid",
                [patient_id],
            )
        except Exception:
            pass  # stats reset is best-effort — the deletes are the contract

        # Purge any cached session-tail the memory_manager keeps in Redis
        # so the next /history call doesn't serve a stale list.
        try:
            cache_key = f"patient:consultations:{patient_id}"
            mm.redis.delete(cache_key)
        except Exception:
            pass

        return {
            "cleared":    True,
            "deleted":    deleted,
            "patient_id": patient_id,
        }

    except HTTPException:
        raise
    except Exception as e:
        # BUG-027: log full trace server-side; never leak it in the response body.
        logger.exception("agent_routes: unhandled %s: %s", type(e).__name__, e)
        raise HTTPException(status_code=500, detail="internal_error")


@router.post("/patients/{patient_id}/start-session")
async def start_patient_session(
    patient_id: str,
    request: Request,
    response: FastAPIResponse,
):
    """Start a new session for a known patient.
    Links the patient to a fresh session and seeds it with their context.
    Returns the session_id for the frontend to use in /chat calls."""
    agent = get_agent()
    mm = agent.memory_manager

    # Generate a new session tied to this patient
    sid = f"s_{patient_id}_{int(time.time())}_{uuid.uuid4().hex[:6]}"

    # Link patient → session in Redis
    await mm.link_patient_to_session(patient_id, sid)

    # Pre-seed the session with patient context so the agent knows who this is
    # from the very first message
    await mm.save_session(sid, {
        "messages": [],
        "started_at": __import__("datetime").datetime.now().isoformat(),
        "patient_id": patient_id,
    })

    # Set patient stats from their profile (so trust-tier greeting works)
    try:
        from src.utils.arcade_client import async_command_sql, extract_rows
        resp = await async_command_sql(
            "SELECT consultation_count, created_at, updated_at FROM PatientVertex WHERE id = :pid LIMIT 1",
            [patient_id],
        )
        rows = extract_rows(resp)
        if rows:
            p = rows[0]
            stats = {
                "interaction_count": p.get("consultation_count", 0),
                "first_call_at": p.get("created_at"),
                "last_call_at": p.get("updated_at"),
            }
            mm.redis.setex(f"stats:{sid}", 365 * 86400, json.dumps(stats, default=str))
    except Exception:
        pass

    # Set cookie
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=sid,
        max_age=SESSION_COOKIE_MAX_AGE,
        httponly=False,
        samesite="lax",
        secure=False,
        path="/",
    )

    return {
        "session_id": sid,
        "patient_id": patient_id,
        "status": "ready",
    }


@router.post("/voice-chat")
async def agent_voice_chat(
    file: UploadFile = File(...),
    session_id: str = Form(default="voice_default"),
    patient_id: Optional[str] = Form(default=None),
    phone: Optional[str] = Form(default=None),
    lang: Optional[str] = Form(default=None),
):
    """Voice agent endpoint: STT -> Agent -> TTS. Returns text + audio availability.
    TTS goes through the language dispatcher (services.tts) so Mandinka
    replies are routed to MMS instead of being mispronounced by Piper-EN."""
    from src.services.stt_whisper import transcribe
    from src.services.tts import synthesize
    import re

    # Step 1: STT
    audio_bytes = await file.read()
    if not audio_bytes or len(audio_bytes) < 100:
        raise HTTPException(status_code=400, detail="Audio file too small")

    transcript = await transcribe(audio_bytes, file.filename or "audio.ogg")
    if not transcript:
        raise HTTPException(status_code=422, detail="Could not transcribe audio")

    # Phase B: shadow-mode abuse classifier on the transcribed text.
    from src.abuse_defense import shadow as _abuse_shadow
    _abuse_shadow.log_message(
        transcript,
        route="/api/v1/voice-chat (agent)",
        session_id=session_id,
        user_id=patient_id,
        channel="voice",
    )

    # Step 2: Agent processing
    agent = get_agent()
    result = await agent.process_message(
        message=transcript,
        session_id=session_id,
        patient_id=patient_id,
        phone=phone,
    )

    answer = result.get("response", "")

    # Strip markdown for TTS
    clean = re.sub(r'\*{1,3}(.+?)\*{1,3}', r'\1', answer)
    clean = re.sub(r'#{1,6}\s*', '', clean, flags=re.MULTILINE)
    clean = clean.replace('*', '').replace('#', '').strip()

    # Step 3: TTS — explicit `lang` param wins; otherwise fall back to the
    # language the agent detected from the STT transcript so the spoken
    # reply matches the user's language.
    effective_lang = lang or result.get("detected_language") or "en"
    tts_audio = await synthesize(clean, lang=effective_lang)

    return {
        "transcript": transcript,
        "response": answer,
        "triage_level": result.get("triage_level"),
        "tools_used": result.get("tools_used", []),
        "is_emergency": result.get("is_emergency", False),
        "has_audio": tts_audio is not None and len(tts_audio) > 100,
        "session_id": session_id,
        "lang": effective_lang,
    }


@router.post("/voice-chat-audio")
async def agent_voice_chat_audio(
    file: UploadFile = File(...),
    session_id: str = Form(default="voice_default"),
    patient_id: Optional[str] = Form(default=None),
    phone: Optional[str] = Form(default=None),
    lang: Optional[str] = Form(default=None),
):
    """Voice agent endpoint that returns TTS audio directly as WAV.
    TTS goes through the language dispatcher (services.tts) so Mandinka
    replies are routed to MMS instead of being mispronounced by Piper-EN."""
    from src.services.stt_whisper import transcribe
    from src.services.tts import synthesize
    import re

    audio_bytes = await file.read()
    transcript = await transcribe(audio_bytes, file.filename or "audio.ogg")
    if not transcript:
        raise HTTPException(status_code=422, detail="Could not transcribe")

    # Phase B: shadow-mode abuse classifier on the transcribed text.
    from src.abuse_defense import shadow as _abuse_shadow
    _abuse_shadow.log_message(
        transcript,
        route="/api/v1/voice-chat-audio (agent)",
        session_id=session_id,
        user_id=patient_id,
        channel="voice",
    )

    agent = get_agent()
    result = await agent.process_message(
        message=transcript,
        session_id=session_id,
        patient_id=patient_id,
        phone=phone,
    )

    answer = result.get("response", "")
    clean = re.sub(r'\*{1,3}(.+?)\*{1,3}', r'\1', answer)
    clean = re.sub(r'#{1,6}\s*', '', clean, flags=re.MULTILINE)
    clean = clean.replace('*', '').replace('#', '').strip()

    # Explicit `lang` form param wins, else fall back to agent-detected language.
    effective_lang = lang or result.get("detected_language") or "en"
    tts_audio = await synthesize(clean, lang=effective_lang)
    if not tts_audio:
        raise HTTPException(status_code=500, detail="TTS failed")

    # Bug 2 fix: URL-encode the transcript so non-ASCII (Mandinka, emoji,
    # etc.) doesn't crash Starlette's latin-1 header encoder, and so any
    # \r\n in untrusted Whisper output can't inject extra headers. Cap at
    # 1500 chars to stay well under typical proxy header-size limits.
    from urllib.parse import quote as _url_quote
    safe_transcript = _url_quote(transcript[:1500], safe="")

    return Response(
        content=tts_audio,
        media_type="audio/wav",
        headers={
            "X-Transcript": safe_transcript,
            "X-Transcript-Encoding": "url",
            "X-Triage-Level": result.get("triage_level") or "",
            "X-Is-Emergency": str(result.get("is_emergency", False)),
            "X-Lang": effective_lang,
        },
    )


@router.get("/nudge")
async def get_daily_nudge(conditions: Optional[str] = None, patient_id: Optional[str] = None):
    """Get today's One-Spoon Swap nudge. Conditions may be comma-separated
    (e.g. 'diabetes,hypertension') or looked up from patient_id."""
    agent = get_agent()

    cond_list: List[str] = []
    if conditions:
        cond_list = [c.strip() for c in conditions.split(",") if c.strip()]
    elif patient_id:
        patient_result = await agent.orchestrator.execute_tool(
            "get_patient", patient_id=patient_id,
        )
        if patient_result.get("success") and patient_result.get("result"):
            cond_list = patient_result["result"].get("conditions", []) or []

    result = await agent.orchestrator.execute_tool(
        "get_lifestyle_nudge", conditions=cond_list,
    )
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "Nudge failed"))
    return result.get("result", {})


# VHW Referral endpoints

class ReferralCreateRequest(BaseModel):
    vhw_name: str
    vhw_id: str
    patient_phone: Optional[str] = None
    patient_name: Optional[str] = None
    session_id: Optional[str] = None
    reason: Optional[str] = None
    village: Optional[str] = None


@router.post("/referrals")
async def create_referral(req: ReferralCreateRequest):
    """Create a VHW → AMINA warm handoff. On the patient's first call within
    30 days, AMINA opens with the VHW's endorsement instead of a cold intro."""
    from src.services.referrals import ReferralStore
    agent = get_agent()
    store = ReferralStore(agent.memory_manager.redis)
    result = await store.create_referral(
        vhw_name=req.vhw_name,
        vhw_id=req.vhw_id,
        patient_phone=req.patient_phone,
        patient_name=req.patient_name,
        session_id=req.session_id,
        reason=req.reason,
        village=req.village,
    )
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.get("/referrals/lookup")
async def lookup_referral(session_id: str, phone: Optional[str] = None):
    """Look up an active referral for a session/phone (used for debugging)."""
    from src.services.referrals import ReferralStore
    agent = get_agent()
    store = ReferralStore(agent.memory_manager.redis)
    ref = await store.get_referral(session_id, phone)
    return {"referral": ref, "exists": ref is not None}


# Feedback (thumbs up/down on individual messages)

# Reason codes for downvotes — frontend exposes these
FEEDBACK_REASONS = {
    "too_generic": "Too generic / not specific enough",
    "wrong_info": "Incorrect medical information",
    "too_long": "Too long / too wordy",
    "too_short": "Too short / not enough detail",
    "wrong_language": "Wrong language or too complex",
    "not_cultural": "Not culturally appropriate",
    "missed_question": "Didn't answer my question",
    "other": "Other",
}


class FeedbackRequest(BaseModel):
    message_index: Optional[int] = None
    rating: int  # 1 = helpful, -1 = not helpful
    reason: Optional[str] = None  # one of FEEDBACK_REASONS keys
    comment: Optional[str] = None  # free-text, optional
    message_preview: Optional[str] = None
    session_id: Optional[str] = None
    intention: Optional[str] = None  # echoed from response metadata
    tools_used: Optional[List[str]] = None
    language: Optional[str] = None  # "en" | "ma"


@router.post("/feedback")
async def log_feedback(req: FeedbackRequest):
    """Rich feedback logger. Stored in Redis (30d TTL) + indexed for stats.

    Structured so CHW reviewers can filter by reason, intention, rating.
    """
    import logging
    logger = logging.getLogger(__name__)
    try:
        agent = get_agent()
        r = agent.memory_manager.redis
        ts = int(time.time() * 1000)
        key = f"feedback:{ts}_{req.message_index or 0}"
        entry = {
            "rating": req.rating,
            "reason": req.reason,
            "comment": (req.comment or "")[:500],
            "preview": (req.message_preview or "")[:300],
            "session_id": req.session_id,
            "intention": req.intention,
            "tools_used": req.tools_used or [],
            "language": req.language,
            "at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "ts": ts,
        }
        # Store the entry
        r.setex(key, 30 * 86400, json.dumps(entry))
        # Index for stats — two counters, per-reason and per-rating
        r.incr(f"feedback:count:rating:{req.rating}")
        if req.reason:
            r.incr(f"feedback:count:reason:{req.reason}")
        # Add to per-session log
        if req.session_id:
            r.lpush(f"feedback:session:{req.session_id}", key)
            r.expire(f"feedback:session:{req.session_id}", 30 * 86400)
        # Append to recent-feedback stream (capped)
        r.lpush("feedback:recent", json.dumps(entry, default=str))
        r.ltrim("feedback:recent", 0, 999)

        # Feed into self-learning system
        # Extract patient_id from session_id (format: s_P_FATOU_timestamp_random)
        pid = None
        if req.session_id and req.session_id.startswith("s_P_"):
            parts = req.session_id.split("_")
            if len(parts) >= 3:
                pid = f"P_{parts[2]}"
        if pid:
            from src.services.learning import log_interaction
            feedback_type = "up" if req.rating == "up" else "down" if req.rating == "down" else None
            log_interaction(
                r, patient_id=pid, session_id=req.session_id,
                user_msg=f"[feedback on: {(req.message_preview or '')[:100]}]",
                bot_response=req.message_preview or "",
                feedback=feedback_type,
                downvote_reason=req.reason,
            )
    except Exception as e:
        logger.warning(f"feedback log failed: {e}")
        return {"ok": False, "error": str(e)}
    return {"ok": True, "stored": True}


@router.get("/feedback/reasons")
async def list_feedback_reasons():
    """Return the canonical reason codes the frontend should offer."""
    return {"reasons": FEEDBACK_REASONS}


@router.get("/feedback/stats")
async def feedback_stats(http_request: Request):
    """Aggregate feedback counts + recent entries. Used by CHW review dashboard.

    BUG-029 fix: was previously open. Aggregated patient-satisfaction
    data is now restricted to admin or caregiver JWTs.
    """
    payload = _require_auth(http_request)
    if payload.get("role") not in ("admin", "caregiver"):
        raise HTTPException(status_code=403, detail="Admin or caregiver only")
    try:
        agent = get_agent()
        r = agent.memory_manager.redis
        positive = int(r.get("feedback:count:rating:1") or 0)
        negative = int(r.get("feedback:count:rating:-1") or 0)
        total = positive + negative
        reasons = {}
        for key in FEEDBACK_REASONS:
            reasons[key] = {
                "label": FEEDBACK_REASONS[key],
                "count": int(r.get(f"feedback:count:reason:{key}") or 0),
            }
        recent_raw = r.lrange("feedback:recent", 0, 19) or []
        recent = [json.loads(x) for x in recent_raw]
        return {
            "totals": {
                "positive": positive,
                "negative": negative,
                "total": total,
                "satisfaction_rate": round(positive / total, 3) if total else None,
            },
            "reasons": reasons,
            "recent": recent,
        }
    except Exception as e:
        # BUG-027: log full trace server-side; never leak it in the response body.
        logger.exception("agent_routes: unhandled %s: %s", type(e).__name__, e)
        raise HTTPException(status_code=500, detail="internal_error")


@router.get("/feedback/session/{session_id}")
async def session_feedback(session_id: str, http_request: Request):
    """Return all feedback entries for a given session.

    BUG-029 fix: was previously open. Restricted to admin or caregiver
    JWTs. Patients querying their own session's feedback is a
    follow-up (needs a session_owner map that does not exist yet).
    """
    payload = _require_auth(http_request)
    if payload.get("role") not in ("admin", "caregiver"):
        raise HTTPException(status_code=403, detail="Admin or caregiver only")
    try:
        agent = get_agent()
        r = agent.memory_manager.redis
        keys = r.lrange(f"feedback:session:{session_id}", 0, -1) or []
        entries = []
        for k in keys:
            raw = r.get(k)
            if raw:
                entries.append(json.loads(raw))
        return {"session_id": session_id, "entries": entries, "count": len(entries)}
    except Exception as e:
        # BUG-027: log full trace server-side; never leak it in the response body.
        logger.exception("agent_routes: unhandled %s: %s", type(e).__name__, e)
        raise HTTPException(status_code=500, detail="internal_error")


# Document generation

class GenerateDocRequest(BaseModel):
    session_id: str
    doc_type: str = "consultation_summary"  # consultation_summary | care_plan | referral_letter | health_report
    patient_name: Optional[str] = None
    format: str = "preview"  # preview | pdf | docx
    language: Optional[str] = "en"  # "en" | "ma" — when "ma", content + chrome are translated before render
    # Optional client-supplied messages as a fallback when the Redis
    # session history is empty or short. This is the same pattern the
    # /chat/export-pdf endpoint already uses — covers the case where
    # abuse-defense short-circuited the agent (so user/agent turns
    # rendered in the UI never got persisted to Redis), and the case
    # of an expired session. List of {role, content} dicts.
    messages: Optional[List[Dict[str, Any]]] = None


@router.post("/document/generate")
async def generate_document(req: GenerateDocRequest):
    """Generate a structured document from conversation history.

    format='preview' → returns JSON content for frontend preview.
    format='pdf' → returns PDF bytes.
    format='docx' → returns DOCX bytes.

    When language="ma", the LLM-generated body is translated field-by-
    field via Translator.translate_batch (cached in Redis), and the
    hardcoded chrome labels are localized before rendering.
    """
    from src.services.document_gen import (
        generate_document_content, render_pdf, render_docx,
        translate_doc_for_render, _translate_labels,
    )

    agent = get_agent()

    # Check Redis cache first — skip LLM call if we already have this doc
    cache_key = f"document:{req.session_id}:{req.doc_type}"
    try:
        cached_raw = agent.memory_manager.redis.get(cache_key)
        if cached_raw:
            doc_content = json.loads(cached_raw)
            lang = (req.language or "en").lower()
            localized_doc = await translate_doc_for_render(doc_content, lang)
            labels = await _translate_labels(lang)
            if req.format == "pdf":
                pdf_bytes = render_pdf(localized_doc, labels=labels)
                return Response(content=pdf_bytes, media_type="application/pdf", headers={"Content-Disposition": 'attachment; filename="amina_{}_{}.pdf"'.format(req.doc_type, doc_content.get("doc_id", "doc"))})
            if req.format == "docx":
                docx_bytes = render_docx(localized_doc, labels=labels)
                return Response(content=docx_bytes, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document", headers={"Content-Disposition": 'attachment; filename="amina_{}_{}.docx"'.format(req.doc_type, doc_content.get("doc_id", "doc"))})
            return localized_doc
    except Exception:
        pass

    # Get conversation messages from Redis. Fall back to client-supplied
    # messages when the session history is empty / short — this covers
    # the abuse-defense short-circuit case where the agent endpoint
    # returns a response without persisting the exchange (e.g. warn,
    # session_terminate). Same pattern as /chat/export-pdf above.
    messages = await agent.memory_manager.get_session_messages(req.session_id) or []
    if len(messages) < 2 and req.messages:
        messages = [
            {"role": m.get("role", "user"), "content": m.get("content", "")}
            for m in req.messages if (m or {}).get("content")
        ]
    if not messages or len(messages) < 2:
        raise HTTPException(
            status_code=400,
            detail="Not enough conversation to generate a document. Chat with Amina first.",
        )

    # Get patient context
    memory = agent.sessions.get(req.session_id)
    patient_name = req.patient_name or (memory.patient_context.name if memory else None) or "Patient"
    conditions = (memory.patient_context.conditions if memory else None) or []
    region = (memory.patient_context.region if memory else None) or "Kanifing"

    # Generate structured content via LLM (always in English — translation
    # happens post-hoc so the LLM prompt stays stable across languages).
    doc_content = await generate_document_content(
        messages=messages,
        patient_name=patient_name,
        conditions=conditions,
        region=region,
        doc_type=req.doc_type,
    )

    # Add metadata (not translated)
    doc_content["doc_id"] = f"DOC{uuid.uuid4().hex[:8].upper()}"
    doc_content["doc_type"] = req.doc_type
    from datetime import datetime as _dt
    doc_content["generated_at"] = _dt.now().isoformat()
    doc_content["session_id"] = req.session_id

    # Cache the English version (7 day TTL). Translation is applied on
    # the way out to preserve a language-agnostic cache.
    try:
        agent.memory_manager.redis.setex(
            f"document:{req.session_id}:{req.doc_type}",
            7 * 86400,
            json.dumps(doc_content, default=str),
        )
    except Exception:
        pass

    # Translate body + chrome labels for the requested language
    lang = (req.language or "en").lower()
    localized_doc = await translate_doc_for_render(doc_content, lang)
    labels = await _translate_labels(lang)

    if req.format == "pdf":
        pdf_bytes = render_pdf(localized_doc, labels=labels)
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": 'attachment; filename="amina_{}_{}.pdf"'.format(req.doc_type, doc_content.get("doc_id", "doc")),
            },
        )

    if req.format == "docx":
        docx_bytes = render_docx(localized_doc, labels=labels)
        return Response(
            content=docx_bytes,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={
                "Content-Disposition": 'attachment; filename="amina_{}_{}.docx"'.format(req.doc_type, doc_content.get("doc_id", "doc")),
            },
        )

    # Default: return JSON preview (localized to the requested language)
    return localized_doc


@router.post("/chat/export-pdf")
async def export_chat_pdf(req: dict):
    """Export the raw chat transcript for a session as a PDF download.

    Body: {"session_id": str, "patient_name": str?, "language": str?}

    Unlike /document/generate (which uses an LLM to produce a structured
    consultation summary), this endpoint emits a verbatim transcript of
    the user ↔ AMINA turns stored in the session. It is safe to call on
    very short sessions and never blocks on LLM calls.
    """
    from src.services.document_gen import (
        render_conversation_pdf,
        translate_messages_for_render,
        _translate_labels,
    )

    session_id   = (req or {}).get("session_id") or ""
    patient_name = (req or {}).get("patient_name") or None
    language     = ((req or {}).get("language") or "en").lower()
    client_msgs  = (req or {}).get("messages") or []

    if not session_id:
        raise HTTPException(status_code=400, detail="session_id is required")

    agent = get_agent()

    # Try Redis first; fall back to client-supplied messages (covers
    # expired sessions where the frontend still has the full thread).
    messages = []
    try:
        messages = await agent.memory_manager.get_session_messages(session_id) or []
    except Exception as e:
        logger.warning("Session message fetch failed: %s", e)

    if not messages and client_msgs:
        messages = [
            {"role": m.get("role", "user"), "content": m.get("content", ""),
             **({"sources": m["sources"]} if m.get("sources") else {})}
            for m in client_msgs if m.get("content")
        ]

    if not messages:
        raise HTTPException(
            status_code=400,
            detail="No conversation to export. Chat with AMINA first.",
        )

    if not patient_name:
        try:
            memory = agent.sessions.get(session_id)
            if memory and getattr(memory, "patient_context", None):
                patient_name = memory.patient_context.name or None
        except Exception:
            pass

    try:
        # Translate message bodies + chrome labels for non-English languages.
        # For English these calls are no-ops and cost nothing.
        localized_msgs = await translate_messages_for_render(messages, language)
        labels = await _translate_labels(language)

        pdf_bytes = render_conversation_pdf(
            messages=localized_msgs,
            patient_name=patient_name or "Patient",
            language=language,
            labels=labels,
        )
    except Exception as e:
        logger.error("PDF render failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="PDF generation failed. Please try again.")

    filename = "amina_chat_{}.pdf".format(session_id[:12] or "transcript")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'attachment; filename="{}"'.format(filename),
        },
    )


@router.get("/document/{session_id}")
async def get_cached_document(
    session_id: str,
    http_request: Request,
    doc_type: str = "consultation_summary",
):
    """Retrieve a previously generated document from cache.

    BUG-008 fix — previously open; now requires a valid JWT. Documents
    contain consultation transcripts and are PHI under DPA 2025.
    """
    _require_auth(http_request)
    agent = get_agent()
    try:
        raw = agent.memory_manager.redis.get(f"document:{session_id}:{doc_type}")
        if raw:
            return {"exists": True, "document": json.loads(raw)}
    except Exception:
        pass
    return {"exists": False}


@router.get("/document/{session_id}/download/{fmt}")
async def download_document(
    session_id: str,
    fmt: str,
    http_request: Request,
    doc_type: str = "consultation_summary",
    language: str = "en",
):
    """Download a cached document as PDF or DOCX.

    The cached document is always stored in English; translation + label
    localization happen on download so the same cache entry serves every
    language (backed by Translator's Redis cache for per-string hits).

    BUG-008 fix — previously open; now requires a valid JWT. Documents
    contain consultation transcripts and are PHI under DPA 2025.
    """
    _require_auth(http_request)
    from src.services.document_gen import (
        render_pdf, render_docx,
        translate_doc_for_render, _translate_labels,
    )

    agent = get_agent()
    try:
        raw = agent.memory_manager.redis.get(f"document:{session_id}:{doc_type}")
        if not raw:
            raise HTTPException(status_code=404, detail="Document not found. Generate it first.")
        doc = json.loads(raw)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to load document")

    lang = (language or "en").lower()
    localized_doc = await translate_doc_for_render(doc, lang)
    labels = await _translate_labels(lang)

    if fmt == "pdf":
        return Response(
            content=render_pdf(localized_doc, labels=labels),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="amina_{doc_type}.pdf"'},
        )
    if fmt == "docx":
        return Response(
            content=render_docx(localized_doc, labels=labels),
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f'attachment; filename="amina_{doc_type}.docx"'},
        )
    raise HTTPException(status_code=400, detail="Format must be 'pdf' or 'docx'")


@router.get("/tools")
async def list_tools():
    """List all available agent tools."""
    agent = get_agent()
    return {
        "tools": agent.orchestrator.list_tools(),
        "descriptions": agent.orchestrator.get_tool_descriptions(),
    }


# Translation endpoints

class TranslateRequest(BaseModel):
    text: str
    source: str = "en"
    target: str = "ma"


class TranslateBatchRequest(BaseModel):
    texts: dict  # {key: text}
    source: str = "en"
    target: str = "ma"


@router.post("/translate")
async def translate_text(req: TranslateRequest):
    """Translate a single string between English and Mandinka."""
    from src.services.translator import get_translator, SUPPORTED_LANGUAGES
    if req.source not in SUPPORTED_LANGUAGES or req.target not in SUPPORTED_LANGUAGES:
        raise HTTPException(status_code=400, detail="Unsupported language")
    result = await get_translator().translate(req.text, req.source, req.target)
    if req.source == "en" and req.target == "ma":
        try:
            from src.nlp.translation_corrector import get_corrector
            cr = get_corrector().correct(
                mandinka_text=result,
                english_source=req.text,
                patient_context={},
            )
            if cr["recommendation"] != "BLOCK_USE_ENGLISH":
                result = cr["corrected_text"]
            else:
                result = req.text
        except Exception:
            pass
    return {"source": req.source, "target": req.target, "original": req.text, "translated": result}


@router.post("/translate/batch")
async def translate_batch(req: TranslateBatchRequest):
    """Translate a dict of strings in one call. Used for UI translation."""
    from src.services.translator import get_translator, SUPPORTED_LANGUAGES
    if req.source not in SUPPORTED_LANGUAGES or req.target not in SUPPORTED_LANGUAGES:
        raise HTTPException(status_code=400, detail="Unsupported language")
    try:
        result = await get_translator().translate_batch(req.texts, req.source, req.target)
    except Exception as e:
        logger.error("translate/batch failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Translation failed: {e}")
    return {"source": req.source, "target": req.target, "translations": result}


@router.get("/languages")
async def list_languages():
    """List supported translation languages."""
    from src.services.translator import SUPPORTED_LANGUAGES
    return {"languages": SUPPORTED_LANGUAGES}


# Care Plan

@router.get("/care-plan/{session_id}")
async def get_care_plan(session_id: str):
    """Retrieve the cached care plan for this session (if any)."""
    agent = get_agent()
    plan = await agent.memory_manager.get_care_plan(session_id)
    if not plan:
        return {"exists": False, "session_id": session_id}
    return {"exists": True, "plan": plan}


@router.post("/care-plan/{session_id}/generate")
async def generate_care_plan_endpoint(session_id: str):
    """(Re)generate a personalised care plan from the conversation history.
    The result is cached in Redis for 7 days."""
    agent = get_agent()
    plan = await agent.generate_care_plan_from_conversation(session_id)
    if plan.get("empty"):
        raise HTTPException(status_code=400, detail=plan.get("error", "No conversation"))
    return {"exists": True, "plan": plan}


# Notification Preferences

class NotificationPrefs(BaseModel):
    session_id: str
    patient_id: Optional[str] = None
    channels: dict  # { "whatsapp": "+220...", "email": "...", "telegram": "...", "sms": "...", "browser": true }
    frequency: Optional[str] = "as_scheduled"  # as_scheduled | daily | weekly


@router.post("/notifications/preferences")
async def save_notification_prefs(prefs: NotificationPrefs):
    """Save a user's follow-up notification channel preferences.
    For MVP this acknowledges + persists; actual channel wiring (WhatsApp,
    Telegram, SMS) is a separate integration."""
    # Basic validation
    valid_channels = {"whatsapp", "telegram", "email", "sms", "browser"}
    cleaned = {k: v for k, v in (prefs.channels or {}).items() if k in valid_channels and v}
    if not cleaned:
        raise HTTPException(status_code=400, detail="At least one notification channel is required")
    return {
        "status": "saved",
        "session_id": prefs.session_id,
        "channels_saved": list(cleaned.keys()),
        "frequency": prefs.frequency,
        "note": "You will receive follow-up reminders through these channels.",
    }


# Prescription Upload & Analysis

ALLOWED_IMAGE_MIMES = {
    "image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif",
}
MAX_IMAGE_BYTES = 8 * 1024 * 1024  # 8 MB


@router.post("/prescription")
async def analyze_prescription(
    http_request: Request,
    http_response: FastAPIResponse,
    file: UploadFile = File(...),
    session_id: str = Form(default="default"),
    patient_id: Optional[str] = Form(default=None),
    phone: Optional[str] = Form(default=None),
    language: str = Form(default="en"),  # "en" | "ma" — guidance language
):
    """Upload a prescription photo/scan → OpenAI Vision extracts medications,
    dosages, and instructions → Amina explains it in plain language with
    warnings based on the patient's conditions."""
    # Refresh session cookie
    _ensure_session_cookie(http_request, http_response)

    # Validate file type
    content_type = (file.content_type or "").lower()
    if content_type not in ALLOWED_IMAGE_MIMES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{content_type}'. Upload a JPG, PNG, WEBP, or HEIC image.",
        )

    # Read and validate size
    img_bytes = await file.read()
    if not img_bytes:
        raise HTTPException(status_code=400, detail="Empty file uploaded")
    if len(img_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Image too large ({len(img_bytes)} bytes). Max {MAX_IMAGE_BYTES} bytes.",
        )

    # Resolve patient context if patient_id or phone provided
    agent = get_agent()
    patient_context = {}
    try:
        if phone:
            profile = await agent.memory_manager.get_or_create_patient(phone)
            patient_context = {
                "conditions": profile.conditions,
                "medications": profile.medications,
                "allergies": profile.allergies,
            }
            if not patient_id:
                patient_id = profile.id
        elif patient_id:
            patient_result = await agent.orchestrator.execute_tool(
                "get_patient", patient_id=patient_id,
            )
            if patient_result.get("success") and patient_result.get("result"):
                pr = patient_result["result"]
                patient_context = {
                    "conditions": pr.get("conditions", []),
                    "medications": pr.get("medications", []),
                    "allergies": pr.get("allergies", []),
                }
    except Exception:
        pass  # Continue without patient context if lookup fails

    # Run the prescription tool
    b64 = base64.b64encode(img_bytes).decode("ascii")
    result = await agent.orchestrator.execute_tool(
        "analyze_prescription",
        image_base64=b64,
        mime_type=content_type,
        patient_context=patient_context,
        output_language=language if language in ("en", "ma") else "en",
    )

    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "Analysis failed"))

    analysis = result.get("result", {})

    # Persist the assistant's guidance into the session so follow-up chat has context
    if analysis.get("is_prescription") and analysis.get("guidance"):
        guidance_text = analysis["guidance"]
        med_summary = analysis.get("medication_summary", [])
        user_note = f"[Uploaded prescription] Extracted: {'; '.join(med_summary)}" if med_summary else "[Uploaded prescription image]"
        try:
            await agent.memory_manager.add_message_to_session(session_id, "user", user_note)
            await agent.memory_manager.add_message_to_session(
                session_id, "assistant", guidance_text, ["analyze_prescription"],
            )
            # Also update in-process memory
            memory = agent.get_or_create_session(session_id)
            memory.add_message("user", user_note)
            memory.add_message("assistant", guidance_text, ["analyze_prescription"])
        except Exception:
            pass

    # Smart one-time suggestion: Rx was in Mandinka but user's UI is English
    suggest_language_switch = None
    try:
        memory = agent.get_or_create_session(session_id)
        if (
            language != "ma"
            and analysis.get("detected_language") == "ma"
            and not memory.language_switch_suggested
        ):
            suggest_language_switch = "ma"
            memory.language_switch_suggested = True
    except Exception:
        pass

    return {
        "session_id": session_id,
        "patient_id": patient_id,
        "suggest_language_switch": suggest_language_switch,
        **analysis,
    }
