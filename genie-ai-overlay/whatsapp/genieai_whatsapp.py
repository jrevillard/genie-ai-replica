# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""WhatsApp AI Agent — FastAPI webhook adapter.

Receives Meta WhatsApp Cloud API webhooks, routes inbound text messages to the
GENIE.AI OPEA ChatQnA pipeline, and sends the AI reply back via the Graph API.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

import config
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.responses import PlainTextResponse
from models.webhook import WhatsAppMessage, WhatsAppWebhookPayload
from services import conversation, opea_client, whatsapp_sender

logging.basicConfig(
    level=getattr(logging, config.LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("whatsapp")


@asynccontextmanager
async def lifespan(_: FastAPI):
    opea_client.init_client()
    whatsapp_sender.init_client()
    try:
        await conversation.init_redis()
    except Exception as exc:
        logger.warning("Redis init failed at startup: %s", exc)
    yield
    await opea_client.close_client()
    await whatsapp_sender.close_client()
    await conversation.close_redis()


app = FastAPI(title="GENIE.AI WhatsApp Agent", lifespan=lifespan)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/webhook/whatsapp")
async def verify_webhook(
    hub_mode: str = Query(default="", alias="hub.mode"),
    hub_verify_token: str = Query(default="", alias="hub.verify_token"),
    hub_challenge: str = Query(default="", alias="hub.challenge"),
):
    """Meta webhook verification handshake."""
    if not config.META_VERIFY_TOKEN:
        logger.error("META_VERIFY_TOKEN is not configured")
        raise HTTPException(status_code=500, detail="verify token not configured")
    if hub_mode == "subscribe" and hub_verify_token == config.META_VERIFY_TOKEN:
        logger.info("Webhook verification succeeded")
        return PlainTextResponse(content=hub_challenge)
    logger.warning("Webhook verification failed (mode=%s)", hub_mode)
    raise HTTPException(status_code=403, detail="verification failed")


def _extract_first_text_message(
    payload: WhatsAppWebhookPayload,
) -> WhatsAppMessage | None:
    for entry in payload.entry:
        for change in entry.changes:
            messages = change.value.messages
            if not messages:
                continue
            for message in messages:
                return message
    return None


async def _process_message(message: WhatsAppMessage) -> None:
    phone = message.from_

    if await conversation.is_message_processed(message.id):
        logger.info("Skipping duplicate message %s", message.id)
        return

    if message.type != "text" or message.text is None:
        logger.info("Unsupported message type from %s: %s", phone, message.type)
        await whatsapp_sender.send_text(phone, config.WHATSAPP_UNSUPPORTED_TYPE_MESSAGE)
        return

    user_text = message.text.body.strip()
    if not user_text:
        return

    try:
        history = await conversation.add_message(phone, "user", user_text)
    except Exception as exc:
        logger.error("Redis write failed for %s: %s", phone, exc)
        history = [{"role": "user", "content": user_text}]

    ai_reply = await opea_client.chat(history)

    try:
        await conversation.add_message(phone, "assistant", ai_reply)
    except Exception as exc:
        logger.error("Redis assistant-write failed for %s: %s", phone, exc)

    await whatsapp_sender.send_text(phone, ai_reply)


@app.post("/webhook/whatsapp")
async def receive_webhook(payload: WhatsAppWebhookPayload, background_tasks: BackgroundTasks) -> dict:
    """Acknowledge Meta within 20s; process the message in the background."""
    message = _extract_first_text_message(payload)
    if message is None:
        # Status receipt (delivery/read) — nothing to do.
        return {"status": "ok"}

    background_tasks.add_task(_process_message, message)
    return {"status": "ok"}
