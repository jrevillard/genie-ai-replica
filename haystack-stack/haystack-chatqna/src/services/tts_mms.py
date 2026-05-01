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


# ── Adaptive timeout ─────────────────────────────────────────────────
# A fixed timeout is the wrong abstraction for this service: synthesis
# is CPU-bound and scales super-linearly with input length, so any
# constant ceiling (30 s, 60 s, 120 s) gets blown out the moment a
# response gets long enough. The server-side chunker keeps each
# forward pass bounded, but the TOTAL wall-clock still grows with the
# number of chunks.
#
# Calibration from CPU runs on the prebuilt MMS-mnk model:
#   61 chars   ->  6.6 s   (~108 ms/char + base overhead)
#   386 chars  -> 36.8 s   (~95 ms/char)
#   1293 chars -> 113 s    (~87 ms/char, 6 chunks)
#
# We pick a generous 200 ms/char + a 30 s base + a 30 s connect-tail
# margin. That's roughly 2x the observed rate so a slow GC pause or
# an ffmpeg hiccup at chunk boundaries doesn't trip the client.
# Callers can still pass an explicit ``timeout=`` to override (e.g.
# the health probe wants a tight 5 s).
_PER_CHAR_S         = 0.20
_BASE_OVERHEAD_S    = 30.0
_MIN_TIMEOUT_S      = 60.0


def _adaptive_timeout(text: str) -> float:
    """Return a generous read timeout sized to the input length.

    The result is at least ``_MIN_TIMEOUT_S`` so very short inputs
    don't get unfairly clipped by a few seconds of cold-start jitter
    on the server side.
    """
    return max(_MIN_TIMEOUT_S, _BASE_OVERHEAD_S + _PER_CHAR_S * len(text or ""))


async def synthesize(text: str, *, url: Optional[str] = None, timeout: Optional[float] = None) -> Optional[bytes]:
    """Convert Mandinka text to WAV audio via the MMS TTS container.

    ``timeout`` is adaptive by default -- scales with text length so a
    multi-paragraph clinical response gets the budget it needs without
    starving short greetings of responsiveness. Pass an explicit float
    to override (e.g. for tests, or to enforce a hard ceiling).
    """
    text = (text or "").strip()
    if not text:
        return None

    effective_timeout = timeout if timeout is not None else _adaptive_timeout(text)
    log.debug("mms_tts_call chars=%d timeout=%.1fs", len(text), effective_timeout)

    base = (url or _MMS_URL).rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=effective_timeout) as client:
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
        log.error("mms_tts_timeout chars=%d budget=%.1fs", len(text), effective_timeout)
        return None
    except Exception as e:
        log.error("mms_tts_error error=%s", str(e))
        return None


async def synthesize_ogg(text: str, *, url: Optional[str] = None, timeout: Optional[float] = None) -> Optional[bytes]:
    """Convert Mandinka text to OGG Opus audio (Telegram / WhatsApp voice notes).

    Adaptive timeout, see :func:`synthesize`.
    """
    text = (text or "").strip()
    if not text:
        return None

    effective_timeout = timeout if timeout is not None else _adaptive_timeout(text)

    base = (url or _MMS_URL).rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=effective_timeout) as client:
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
