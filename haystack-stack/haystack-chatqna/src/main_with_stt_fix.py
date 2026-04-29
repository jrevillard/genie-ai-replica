"""
AMINA Care — STT Logging Fix
=============================
Strict superset of main_with_intent_review.

Patches stt_whisper.transcribe to fix a logging call that uses
structlog-style keyword arguments (``log.info("stt_done", chars=N)``)
with a stdlib logger — which raises TypeError and silently discards
the successful Whisper transcription.

Uvicorn target: src.main_with_stt_fix:app
"""
from __future__ import annotations

import logging

from src.main_with_intent_review import app  # noqa: E402,F401

_log = logging.getLogger("src.main_with_stt_fix")

# ── Monkey-patch stt_whisper.transcribe ─────────────────────────────
# The original function crashes on line 70:
#   log.info("stt_done", chars=len(transcript))
# stdlib Logger doesn't accept arbitrary kwargs.

try:
    import src.services.stt_whisper as _stt_mod

    _original_transcribe = _stt_mod.transcribe

    async def _patched_transcribe(audio_bytes, filename="audio.ogg"):
        import hashlib
        import os
        import subprocess
        import tempfile

        import httpx

        from src.config import settings

        stt_log = logging.getLogger("stt_whisper")

        if not audio_bytes or len(audio_bytes) < 100:
            return None

        wav_bytes = _stt_mod._normalize_audio(audio_bytes, filename)
        if not wav_bytes:
            stt_log.error("audio_normalization_failed")
            return None

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(
                    f"{settings.WHISPER_URL}/inference",
                    files={"file": ("audio.wav", wav_bytes, "audio/wav")},
                    data={
                        "response_format": "json",
                        "temperature": "0.0",
                    },
                )

            if resp.status_code != 200:
                stt_log.error("whisper_failed status=%d body=%s", resp.status_code, resp.text[:200])
                return None

            data = resp.json()

            text = data.get("text", "")
            if not text and isinstance(data, dict):
                text = data.get("transcription", "")
                if not text:
                    for key in data:
                        if isinstance(data[key], str) and len(data[key]) > 0:
                            text = data[key]
                            break

            transcript = text.strip()
            stt_log.info("stt_done chars=%d", len(transcript))
            return transcript if transcript else None

        except httpx.TimeoutException:
            stt_log.error("whisper_timeout")
            return None
        except Exception as e:
            stt_log.error("whisper_error: %s", e)
            return None

    _stt_mod.transcribe = _patched_transcribe
    _log.info("✅ STT logging fix applied (stt_whisper.transcribe patched)")

except Exception as e:
    _log.warning("STT logging fix failed (non-fatal): %s", e)


__all__ = ["app"]
