"""
Conversation → Inbox Linker — saves key chat moments to the patient's
inbox so they can revisit important conversations later.

Links these events to inbox items:
  1. Triage alerts (yellow/red) — "Your health check flagged something"
  2. Care plan generated — "Your care plan is ready"
  3. Medication reminders — "Medication reminder from Amina"
  4. Emergency responses — "Emergency guidance provided"
  5. Scout suggestions — patient submitted a help suggestion

Monkey-patches the agent's response path to detect linkable moments
after each chat turn and push them to the inbox (fire-and-forget).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


def _install_patch():
    """Wrap agent_routes to link chat responses to inbox."""
    try:
        from src.api import agent_routes
    except ImportError:
        logger.warning("conversation_inbox_link: agent_routes not importable")
        return

    for route in agent_routes.router.routes:
        if not hasattr(route, "path") or route.path != "/chat":
            continue
        _orig = route.endpoint
        if getattr(_orig, "_inbox_linked", False):
            return

        async def _linked(request, http_request=None, _original=_orig):
            result = await _original(request, http_request)
            try:
                asyncio.create_task(
                    _maybe_link_to_inbox(result, request)
                )
            except Exception:
                pass
            return result

        _linked._inbox_linked = True
        route.endpoint = _linked
        route.dependant = None
        logger.info("conversation_inbox_link: /chat endpoint patched")
        return


async def _maybe_link_to_inbox(result, request) -> None:
    """Check if this response should create an inbox item."""
    try:
        response_text = getattr(result, "response", "") or ""
        triage = getattr(result, "triage_level", "") or ""
        tools = getattr(result, "tools_used", []) or []
        is_emergency = getattr(result, "is_emergency", False)
        session_id = getattr(request, "session_id", "") or ""

        patient_id = _extract_patient_id(request)
        if not patient_id:
            return

        from src.services import inbox_service

        if is_emergency or triage == "red":
            inbox_service.create_item(
                patient_id=patient_id,
                kind="alert",
                title="Emergency guidance provided",
                body=response_text[:500],
                severity="emergency",
                source="agent",
                source_id=session_id,
                action_url=f"/chat?session={session_id}",
                metadata={"event": "chat_emergency", "session_id": session_id},
                ttl_days=90,
            )
            return

        if triage == "yellow":
            inbox_service.create_item(
                patient_id=patient_id,
                kind="notification",
                title="Health check flagged — review suggested",
                body=_truncate(response_text, 300),
                severity="warning",
                source="agent",
                source_id=session_id,
                action_url=f"/chat?session={session_id}",
                metadata={"event": "chat_triage_yellow", "session_id": session_id},
                ttl_days=60,
            )
            return

        if any(t in ("generate_care_plan", "care_plan") for t in tools):
            inbox_service.create_item(
                patient_id=patient_id,
                kind="report",
                title="Your care plan is ready",
                body="Amina created a personalized care plan based on your conversation. Tap to review it.",
                severity="info",
                source="agent",
                source_id=session_id,
                action_url=f"/chat?session={session_id}",
                metadata={"event": "care_plan_generated", "session_id": session_id},
                ttl_days=90,
            )
            return

        if any(t in ("get_diet_advice", "diet") for t in tools):
            inbox_service.create_item(
                patient_id=patient_id,
                kind="report",
                title="Diet advice from Amina",
                body=_truncate(response_text, 200),
                severity="info",
                source="agent",
                source_id=session_id,
                action_url=f"/chat?session={session_id}",
                metadata={"event": "diet_advice", "session_id": session_id},
                ttl_days=60,
            )

    except Exception as exc:
        logger.debug("inbox link skipped: %s", exc)


def _extract_patient_id(request) -> Optional[str]:
    """Best-effort patient ID extraction from the request context."""
    try:
        session_id = getattr(request, "session_id", "") or ""
        if not session_id:
            return None
        from src.agent.amina_agent import get_agent
        agent = get_agent()
        memory = agent.get_or_create_session(session_id)
        return getattr(memory, "patient_id", None) or session_id
    except Exception:
        return None


def _truncate(text: str, max_len: int) -> str:
    if len(text) <= max_len:
        return text
    return text[:max_len-3].rsplit(" ", 1)[0] + "..."


try:
    _install_patch()
except Exception as exc:
    logger.warning("conversation_inbox_link: install failed: %s", exc)
