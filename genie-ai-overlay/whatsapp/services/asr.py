# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""ASR (Whisper) client — transcribes audio bytes to text.

Talks to the same internal whisper service that the web chat uses
(`/v1/microservice/asr`). Multipart-uploads the bytes; expects {text} back."""

from __future__ import annotations

import logging
import os

import httpx

logger = logging.getLogger(__name__)

ASR_WHISPER_URL = os.getenv("ASR_WHISPER_URL", "http://asr-whisper:9100")
ASR_TIMEOUT = float(os.getenv("ASR_TIMEOUT", "60"))


async def transcribe(audio_bytes: bytes, mime_type: str, language: str = "en") -> str:
    """Transcribe a single audio blob. Returns "" on any failure."""
    if not audio_bytes:
        return ""
    # Whisper expects a 2-letter lang code (en/fr/es/...). Drop encoding suffixes.
    lang = (language or "en").lower()[:2]
    # Filename is mostly cosmetic for the upstream; pick an extension that hints
    # at the codec so logs are readable. WhatsApp voice notes are OGG/Opus.
    ext = "ogg" if "ogg" in (mime_type or "") else "bin"

    files = {"file": (f"voice.{ext}", audio_bytes, mime_type or "application/octet-stream")}
    data = {"language": lang}

    async with httpx.AsyncClient(timeout=ASR_TIMEOUT) as client:
        try:
            resp = await client.post(
                f"{ASR_WHISPER_URL}/v1/microservice/asr",
                files=files,
                data=data,
            )
        except httpx.HTTPError as exc:
            logger.error("ASR network error: %s", exc)
            return ""
        if resp.status_code >= 400:
            logger.error("ASR failed (%s): %s", resp.status_code, resp.text[:300])
            return ""

        try:
            payload = resp.json()
        except ValueError:
            logger.error("ASR returned non-JSON body: %s", resp.text[:200])
            return ""
        text = (payload.get("text") or "").strip()
        logger.info("ASR transcript: %r (lang=%s, bytes=%d)", text, lang, len(audio_bytes))
        return text
