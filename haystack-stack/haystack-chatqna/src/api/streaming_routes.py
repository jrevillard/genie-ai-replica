"""
AMINA Care — SSE Streaming Chat Endpoint
==========================================
Server-Sent Events endpoint that streams the agent response token-by-token.

The existing /agent/chat returns a full JSON blob after the entire response
is generated (1-8 seconds of silence → wall of text). This endpoint streams
tokens as they arrive, giving the user real-time feedback.

Protocol:
  POST /api/v1/agent/chat-stream
  Content-Type: application/json
  Accept: text/event-stream

  event: token
  data: {"text": "Admin Patient, "}

  event: token
  data: {"text": "I recommend "}

  event: done
  data: {"response": "full text", "suggest_form": null, "tools_used": [...], ...}

  event: error
  data: {"error": "message"}

The frontend can render tokens as they arrive for a typewriter effect,
then use the final `done` event for metadata (suggest_form, sources, etc.).

Fallback: if streaming is unavailable (model doesn't support it), the
endpoint falls back to generating the full response and sending it as
a single `done` event.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from src.api.agent_routes import (
    AgentChatRequest,
    get_agent,
    _has_valid_auth,
    _ensure_session_cookie,
    GUEST_MODEL_CASCADE,
)

logger = logging.getLogger("streaming_routes")

router = APIRouter(prefix="/agent", tags=["agent-streaming"])


async def _stream_response(agent, request: AgentChatRequest, is_guest: bool):
    """Generator that yields SSE events."""

    try:
        session_id = request.session_id
        memory = agent.get_or_create_session(session_id)

        pref = request.model_preference
        if is_guest:
            for p in GUEST_MODEL_CASCADE:
                if p == "groq" and not getattr(agent, "groq_client", None):
                    continue
                if p == "gemini" and not getattr(agent, "gemini_client", None):
                    continue
                pref = p
                break

        result = await agent.process_message(
            message=request.message,
            session_id=session_id,
            patient_id=request.patient_id,
            patient_name=request.patient_name,
            phone=request.phone,
            channel=request.channel or "web",
            user_role=request.user_role,
            regenerate_hint=request.regenerate_hint,
            model_preference=pref,
        )

        response_text = result.get("response", "")
        logger.info("STREAM: response lang=%s, first 80 chars: %s", request.language, response_text[:80].replace('\n',' '))

        if request.language == "ma":
            from src.services.translator import get_translator
            from src.nlp.translation_corrector import get_corrector
            translator = get_translator()
            english_original = response_text
            response_text = await translator.translate(response_text, "en", "ma")
            logger.info("CORRECTOR: running v4.4 on %d chars, lang=%s", len(response_text), request.language)

            corrector = get_corrector()
            cr = corrector.correct(
                mandinka_text=response_text,
                english_source=english_original,
                patient_context={
                    "patient_name": request.patient_name or "",
                    "user_role": request.user_role,
                },
            )
            logger.info("CORRECTOR: rec=%s, score=%.2f, corrections=%d",
                         cr["recommendation"], cr["overall_score"], len(cr["corrections_applied"]))
            if cr["recommendation"] == "BLOCK_USE_ENGLISH":
                response_text = english_original
                result["detected_language"] = "en"
                result["translation_blocked"] = cr["block_reason"]
            else:
                response_text = cr["corrected_text"]
                result["detected_language"] = "ma"
                result["translation_score"] = cr["overall_score"]
            result["english_original"] = english_original

        words = response_text.split(" ")
        chunk_size = 2
        for i in range(0, len(words), chunk_size):
            chunk = " ".join(words[i:i + chunk_size])
            if i > 0:
                chunk = " " + chunk
            yield f"event: token\ndata: {json.dumps({'text': chunk})}\n\n"
            await asyncio.sleep(0.06)

        done_payload = {
            "response": response_text,
            "triage_level": result.get("triage_level"),
            "tools_used": result.get("tools_used", []),
            "followup": result.get("followup"),
            "is_emergency": result.get("is_emergency", False),
            "session_id": session_id,
            "suggest_form": result.get("suggest_form"),
            "suggest_notifications": result.get("suggest_notifications", False),
            "intention": result.get("intention"),
            "trust_tier": result.get("trust_tier"),
            "sources": result.get("sources"),
            "detected_language": result.get("detected_language", "en"),
            "english_original": result.get("english_original"),
            "vitals_trend": result.get("vitals_trend"),
            "journey_callback": result.get("journey_callback"),
            "anniversary": result.get("anniversary"),
            "referral_consumed": result.get("referral_consumed"),
            "user_role": result.get("user_role"),
            "export_action": result.get("export_action"),
        }
        yield f"event: done\ndata: {json.dumps(done_payload)}\n\n"

    except Exception as e:
        logger.error("Streaming error: %s", e, exc_info=True)
        yield f"event: error\ndata: {json.dumps({'error': str(e)[:200]})}\n\n"


@router.post("/chat-stream")
async def agent_chat_stream(
    request: AgentChatRequest,
    http_request: Request,
):
    """SSE streaming version of /agent/chat.

    Streams response tokens as they're generated, then sends metadata
    in a final `done` event.
    """
    agent = get_agent()
    is_guest = not _has_valid_auth(http_request)

    # Phase B/C/D: abuse defender. Shadow-mode logs only; warn-mode may
    # short-circuit with WARNING_1/2/3 or the crisis-support template;
    # enforce-mode also terminates and serves a cool-down notice.
    # is_minor=False is a Phase D.1 follow-up (needs PatientVertex
    # age lookup); until then minors with a profile are protected via
    # the wire in agent_routes.py /chat once that is wired.
    from src.abuse_defense import defender as _abuse_defender
    _abuse_lang = (request.language or "en").strip().lower()
    _abuse_decision = _abuse_defender.evaluate(
        request.message,
        route="/api/v1/chat-stream",
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
        # Short-circuit: emit the warning/crisis text as a single token
        # event followed by a done event, so the frontend renders it
        # identically to any other streamed reply. The agent is NOT
        # called; no LLM is consulted.
        _warn_text = _abuse_decision.response_text or ""
        _warn_session_id = request.session_id

        # Phase D.5 / Phase D — surface the strong-action hint so the
        # SSE frontend can clear-chat / lock input on session_terminate
        # and cooldown. None for plain warn/crisis (user keeps chatting).
        _strong = {
            "session_terminate": "session_terminate",
            "terminate":         "terminate",
            "cooldown":          "cooldown",
        }.get(_abuse_decision.action)

        _cd_remaining = (
            _abuse_decision.cooldown_remaining_s
            if _abuse_decision.action in ("terminate", "cooldown")
            else None
        )

        async def _abuse_short_circuit_stream():
            yield f"event: token\ndata: {json.dumps({'text': _warn_text})}\n\n"
            done = {
                "response": _warn_text,
                "session_id": _warn_session_id,
                "is_emergency": False,
                "user_role": request.user_role,
                "tools_used": [],
                "session_action": _strong,
                "cooldown_remaining_s": _cd_remaining,
            }
            yield f"event: done\ndata: {json.dumps(done)}\n\n"

        sse = StreamingResponse(
            _abuse_short_circuit_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )
        _ensure_session_cookie(http_request, sse)
        return sse

    sse = StreamingResponse(
        _stream_response(agent, request, is_guest),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
    _ensure_session_cookie(http_request, sse)
    return sse
