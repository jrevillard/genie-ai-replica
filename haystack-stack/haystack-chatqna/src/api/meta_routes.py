"""
Meta Ingestion Routes — WhatsApp Business Cloud + Facebook Messenger webhooks.

Mounts under /api/v1/meta. MVP showcase for UNICC: receive webhook, verify
signature, ack fast (<5s), then run the Amina agent in a background task
and reply via Graph API.

Endpoints:
    GET  /meta/webhook/whatsapp    — verify handshake (hub.challenge echo)
    POST /meta/webhook/whatsapp    — inbound WhatsApp Cloud API events
    GET  /meta/webhook/messenger   — verify handshake
    POST /meta/webhook/messenger   — inbound Messenger Platform events
    GET  /meta/status              — health probe for both channels

To activate, add these two lines to src/main.py (after the other
`include_router` calls):

    from src.api.meta_routes import router as meta_router
    app.include_router(meta_router, prefix="/api/v1")

This file is otherwise standalone — no edits to main.py or config.py needed.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse

from src.services.meta_bridge import (
    MessengerBridge,
    MESSENGER_APP_SECRET,
    WhatsAppBridge,
    WHATSAPP_APP_SECRET,
    handle_meta_payload,
    verify_xhub_signature,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/meta", tags=["meta"])


# ── WhatsApp ─────────────────────────────────────────────────────────────────

@router.get("/webhook/whatsapp", response_class=PlainTextResponse)
async def whatsapp_verify(
    hub_mode:         str = Query(..., alias="hub.mode"),
    hub_verify_token: str = Query(..., alias="hub.verify_token"),
    hub_challenge:    str = Query(..., alias="hub.challenge"),
):
    """
    One-time verification handshake used by Meta when you register the
    webhook URL in the WhatsApp Cloud API dashboard.
    """
    challenge = WhatsAppBridge.verify(hub_mode, hub_verify_token, hub_challenge)
    if challenge is None:
        raise HTTPException(status_code=403, detail="verify token mismatch")
    return challenge


@router.post("/webhook/whatsapp")
async def whatsapp_inbound(
    request: Request,
    background_tasks: BackgroundTasks,
    x_hub_signature_256: str | None = Header(default=None, alias="X-Hub-Signature-256"),
):
    """
    Inbound WhatsApp webhook. Meta requires a <5s ack, so we verify the
    signature, parse the payload into JSON, and push the actual agent call
    onto a BackgroundTask. Returns 200 immediately.
    """
    raw = await request.body()
    if not verify_xhub_signature(raw, x_hub_signature_256 or "", WHATSAPP_APP_SECRET):
        logger.warning("whatsapp signature mismatch")
        raise HTTPException(status_code=403, detail="bad signature")

    try:
        payload = await request.json()
    except Exception:
        logger.warning("whatsapp webhook: invalid json body")
        return {"status": "ignored", "reason": "invalid_json"}

    # Shared inbound -> agent -> outbound pipeline (handle_meta_payload)
    # picks the right adapter from the registry by channel name.
    background_tasks.add_task(handle_meta_payload, "whatsapp", payload)
    return {"status": "ok"}


# ── Messenger ────────────────────────────────────────────────────────────────

@router.get("/webhook/messenger", response_class=PlainTextResponse)
async def messenger_verify(
    hub_mode:         str = Query(..., alias="hub.mode"),
    hub_verify_token: str = Query(..., alias="hub.verify_token"),
    hub_challenge:    str = Query(..., alias="hub.challenge"),
):
    challenge = MessengerBridge.verify(hub_mode, hub_verify_token, hub_challenge)
    if challenge is None:
        raise HTTPException(status_code=403, detail="verify token mismatch")
    return challenge


@router.post("/webhook/messenger")
async def messenger_inbound(
    request: Request,
    background_tasks: BackgroundTasks,
    x_hub_signature_256: str | None = Header(default=None, alias="X-Hub-Signature-256"),
):
    raw = await request.body()
    if not verify_xhub_signature(raw, x_hub_signature_256 or "", MESSENGER_APP_SECRET):
        logger.warning("messenger signature mismatch")
        raise HTTPException(status_code=403, detail="bad signature")

    try:
        payload = await request.json()
    except Exception:
        logger.warning("messenger webhook: invalid json body")
        return {"status": "ignored", "reason": "invalid_json"}

    # Shared inbound -> agent -> outbound pipeline (handle_meta_payload)
    # picks the right adapter from the registry by channel name.
    background_tasks.add_task(handle_meta_payload, "messenger", payload)
    return {"status": "ok"}


# ── Status ───────────────────────────────────────────────────────────────────

@router.get("/status")
async def meta_status():
    """Quick probe so the frontend/ops can see which meta channels are live."""
    return {
        "whatsapp":  {
            "enabled":          WhatsAppBridge.enabled(),
            "signature_checks": bool(WHATSAPP_APP_SECRET),
        },
        "messenger": {
            "enabled":          MessengerBridge.enabled(),
            "signature_checks": bool(MESSENGER_APP_SECRET),
        },
    }
