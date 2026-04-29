# src/services/tts_mms.py

"""
MMS TTS Client — Mandinka text-to-speech.

Sibling to tts_piper.py. Same shape so the dispatcher in services/tts.py
can call either one based on language. The heavy inference (Meta's
facebook/mms-tts-mnk VITS model, ~150 MB) runs in a standalone
container at http://voice-tts-mnk:5500 — see haystack-stack/tts-mms-service/.

Keeping MMS out-of-process mirrors the reason Piper was extracted:
transformers + torch conflict with the chatqna image's RAG + ArcadeDB
dependency graph.
"""

import logging
import os
from typing import Optional

import httpx

log = logging.getLogger("tts_mms")


# Read the URL directly so tts_mms.py can be used in isolation (ad-hoc
# scripts, tests) without importing the full settings object. Falls back
# to the docker-compose service hostname.
_MMS_URL = os.environ.get("MMS_TTS_URL", "http://voice-tts-mnk:5500").rstrip("/")


async def synthesize(text: str, *, url: Optional[str] = None, timeout: float = 30.0) -> Optional[bytes]:
    """Convert Mandinka text to WAV audio via the MMS TTS container."""
    text = (text or "").strip()
    if not text:
        return None

    base = (url or _MMS_URL).rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(f"{base}/v1/tts", json={"text": text})

        if resp.status_code != 200:
            log.error("mms_tts_failed status=%s body=%s",
                      resp.status_code, resp.text[:200])
            return None

        if len(resp.content) < 100:
            log.error("mms_tts_empty_audio")
            return None

        log.info("mms_tts_done bytes=%d text_len=%d", len(resp.content), len(text))
        return resp.content

    except httpx.TimeoutException:
        log.error("mms_tts_timeout")
        return None
    except Exception as e:
        log.error("mms_tts_error error=%s", str(e))
        return None


async def synthesize_ogg(text: str, *, url: Optional[str] = None, timeout: float = 30.0) -> Optional[bytes]:
    """Convert Mandinka text to OGG Opus audio (Telegram / WhatsApp voice notes)."""
    text = (text or "").strip()
    if not text:
        return None

    base = (url or _MMS_URL).rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(f"{base}/v1/tts/ogg", json={"text": text})

        if resp.status_code != 200:
            log.error("mms_tts_ogg_failed status=%s body=%s",
                      resp.status_code, resp.text[:200])
            return None

        return resp.content if len(resp.content) > 100 else None

    except Exception as e:
        log.error("mms_tts_ogg_error error=%s", str(e))
        return None


async def health(*, url: Optional[str] = None, timeout: float = 5.0) -> dict:
    """Liveness + model-readiness probe. Used by the dispatcher to fall back
    gracefully when the Mandinka container hasn't finished loading yet."""
    base = (url or _MMS_URL).rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(f"{base}/health")
        if resp.status_code != 200:
            return {"status": "error", "http_status": resp.status_code}
        return resp.json()
    except Exception as e:
        return {"status": "unreachable", "error": str(e)}
