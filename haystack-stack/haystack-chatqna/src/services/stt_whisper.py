# src/services/stt_whisper.py

"""
Whisper.cpp STT Client.
Calls the whisper.cpp Docker container (voice-stt) via HTTP.
Handles audio normalization to 16kHz mono WAV before sending.
"""

import logging
import os
import subprocess
import tempfile
from typing import Optional

import httpx

from src.config import settings

log = logging.getLogger("stt_whisper")


async def transcribe(audio_bytes: bytes, filename: str = "audio.ogg") -> Optional[str]:
    """
    Transcribe audio bytes to text via Whisper.cpp.

    Steps:
    1. Normalize audio to 16kHz mono WAV (ffmpeg)
    2. POST to Whisper.cpp /inference endpoint
    3. Return transcript text
    """
    if not audio_bytes or len(audio_bytes) < 100:
        return None

    # Normalize to 16kHz mono WAV
    wav_bytes = _normalize_audio(audio_bytes, filename)
    if not wav_bytes:
        log.error("audio_normalization_failed")
        return None

    # Send to Whisper.cpp
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
            # %-formatting (not kwargs) — stdlib logger rejects unknown kwargs
            # with TypeError at _log(). Pre-fix this line raised TypeError on
            # every Whisper non-200, hiding the real status + body in logs.
            log.error("whisper_failed status=%s body=%s",
                      resp.status_code, resp.text[:200])
            return None

        data = resp.json()

        # Whisper.cpp returns {"text": "..."} or may have different format
        text = data.get("text", "")
        if not text and isinstance(data, dict):
            # Try alternative response formats
            text = data.get("transcription", "")
            if not text:
                for key in data:
                    if isinstance(data[key], str) and len(data[key]) > 0:
                        text = data[key]
                        break

        transcript = text.strip()
        log.info("stt_done chars=%d", len(transcript))
        return transcript if transcript else None

    except httpx.TimeoutException:
        log.error("whisper_timeout")
        return None
    except Exception as e:
        #log.error(f"whisper_error", error=str(e))
        log.error(f"whisper_error: {e}")
        return None


def _normalize_audio(audio_bytes: bytes, filename: str) -> Optional[bytes]:
    """Convert any audio to 16kHz mono WAV using ffmpeg."""
    suffix = os.path.splitext(filename)[1] or ".ogg"
    fd_in, in_path = tempfile.mkstemp(suffix=suffix)
    fd_out, out_path = tempfile.mkstemp(suffix=".wav")

    try:
        os.close(fd_out)
        with open(in_path, "wb") as f:
            f.write(audio_bytes)
        os.close(fd_in)

        proc = subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", in_path,
                "-ar", "16000",
                "-ac", "1",
                "-sample_fmt", "s16",
                "-f", "wav",
                out_path,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=30,
        )

        if proc.returncode != 0:
            return None

        with open(out_path, "rb") as f:
            return f.read()

    except Exception as e:
        log.error("normalize_failed error=%s", e)
        return None
    finally:
        for p in [in_path, out_path]:
            try:
                os.unlink(p)
            except OSError:
                pass
