# src/services/tts_piper.py

"""
Piper TTS Client — calls the standalone TTS container via HTTP.
Container runs on http://voice-tts:5500 - standalone call made after seeing the coonflict with haystack-chatqna
"""

import logging
from typing import Optional

import httpx

from src.config import settings

log = logging.getLogger("tts_piper")


async def synthesize(text: str) -> Optional[bytes]:
    """Convert text to WAV audio via TTS container."""
    text = (text or "").strip()
    if not text:
        return None

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{settings.TTS_URL}/v1/tts",
                json={"text": text},
            )

        if resp.status_code != 200:
            log.error("tts_failed status=%s body=%s",
                      resp.status_code, resp.text[:200])
            return None

        if len(resp.content) < 100:
            log.error("tts_empty_audio")
            return None

        log.info("tts_done bytes=%d text_len=%d",
                 len(resp.content), len(text))
        return resp.content

    except httpx.TimeoutException:
        log.error("tts_timeout")
        return None
    except Exception as e:
        log.error("tts_error error=%s", str(e))
        return None


async def synthesize_ogg(text: str) -> Optional[bytes]:
    """Convert text to OGG Opus audio (for voice notes)."""
    text = (text or "").strip()
    if not text:
        return None

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{settings.TTS_URL}/v1/tts/ogg",
                json={"text": text},
            )

        if resp.status_code != 200:
            return None

        return resp.content if len(resp.content) > 100 else None

    except Exception as e:
        log.error("tts_ogg_error error=%s", str(e))
        return None