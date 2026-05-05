# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""HTTP client for the GENIE.AI OPEA ChatQnA mega-service.

The chatqna service accepts a ``ChatCompletionRequest`` and returns a JSON body
shaped like ``{"response": "...", "metadata": {...}}``. Authorization is
optional: when the Bearer token is missing the service logs a warning and
proceeds without user-profile enrichment, which is acceptable for a WhatsApp
adapter that has no Keycloak identity for the sender.
"""

from __future__ import annotations

import logging

import config
import httpx

logger = logging.getLogger(__name__)

_client: httpx.AsyncClient | None = None


def init_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=config.CHATQNA_TIMEOUT)
    return _client


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def _strip_prompt_artifacts(text: str) -> str:
    """Strip assembled-prompt prefix that chatqna sometimes returns alongside
    the LLM completion. The prompt template uses fixed section headers; if any
    appear in the response we keep only the text after the last marker."""
    markers = (
        "CONTENT FROM THE KNOWLEDGE BASE:",
        "[Returned Documents]",
        "[Retrieved Document]",
        "CHAT HISTORY:",
        "USER INFORMATION:",
    )
    cut = -1
    for m in markers:
        idx = text.rfind(m)
        if idx > cut:
            cut = idx + len(m)
    if cut > 0:
        # Trim past the marker and the next blank line if present.
        tail = text[cut:].lstrip("\n").lstrip()
        # If the tail starts with the user's echoed query line, drop the first line.
        if tail and tail[0] != "\n":
            first_nl = tail.find("\n\n")
            if first_nl != -1 and first_nl < 200:
                tail = tail[first_nl + 2:]
        return tail.strip()
    return text


def _extract_response_text(payload: object) -> str | None:
    if isinstance(payload, dict):
        text = payload.get("response")
        if isinstance(text, str) and text.strip():
            return _strip_prompt_artifacts(text.strip()) or text.strip()
    return None


async def chat(messages: list[dict]) -> str:
    """Send the conversation to OPEA ChatQnA and return the assistant reply.

    Falls back to ``WHATSAPP_FALLBACK_MESSAGE`` on any network/parse failure so
    the caller can always send something back to the user.
    """
    client = init_client()
    body = {
        "messages": messages,
        "context": {
            "categoryLabel": config.CHATQNA_DEFAULT_CATEGORY,
            "serviceLabels": [],
            "language": config.CHATQNA_DEFAULT_LANGUAGE,
        },
        "stream": False,
    }
    try:
        response = await client.post(config.CHATQNA_URL, json=body)
        response.raise_for_status()
    except httpx.TimeoutException:
        logger.warning("ChatQnA call timed out after %ss", config.CHATQNA_TIMEOUT)
        return config.WHATSAPP_FALLBACK_MESSAGE
    except httpx.HTTPError as exc:
        logger.warning("ChatQnA call failed: %s", exc)
        return config.WHATSAPP_FALLBACK_MESSAGE

    try:
        data = response.json()
    except ValueError:
        logger.warning("ChatQnA returned non-JSON body")
        return config.WHATSAPP_FALLBACK_MESSAGE

    text = _extract_response_text(data)
    if not text:
        logger.warning("ChatQnA response missing 'response' field: %s", data)
        return config.WHATSAPP_FALLBACK_MESSAGE
    return text
