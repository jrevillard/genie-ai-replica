# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Send outbound WhatsApp messages via the Meta Graph API."""

from __future__ import annotations

import logging

import config
import httpx

logger = logging.getLogger(__name__)

_client: httpx.AsyncClient | None = None


def init_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=30.0)
    return _client


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def _truncate(text: str) -> str:
    limit = config.WHATSAPP_MESSAGE_MAX_LENGTH
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


async def send_text(to: str, text: str) -> None:
    """Send a plain-text WhatsApp message; logs and swallows errors."""
    if not config.META_ACCESS_TOKEN or not config.META_PHONE_NUMBER_ID:
        logger.error("Cannot send: META_ACCESS_TOKEN or META_PHONE_NUMBER_ID not set")
        return

    url = f"{config.META_GRAPH_API_BASE}/{config.META_PHONE_NUMBER_ID}/messages"
    headers = {
        "Authorization": f"Bearer {config.META_ACCESS_TOKEN}",
        "Content-Type": "application/json",
    }
    body = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "text",
        "text": {"body": _truncate(text)},
    }

    client = init_client()
    try:
        response = await client.post(url, headers=headers, json=body)
        if response.status_code >= 400:
            logger.error("WhatsApp send failed (%s): %s", response.status_code, response.text)
            return
        logger.info("Sent WhatsApp reply to %s", to)
    except httpx.HTTPError as exc:
        logger.error("WhatsApp send error: %s", exc)
