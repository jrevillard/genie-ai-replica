# app/services/tts_piper.py

from __future__ import annotations

import os
import subprocess
import tempfile
from dataclasses import dataclass
from typing import Optional

from app.services.core.config import settings
from app.services.core.logging import get_logger

log = get_logger("tts_piper")


def _get_model_path() -> str:
    return (
        getattr(settings, "PIPER_MODEL_PATH", None)
        or os.environ.get("PIPER_MODEL_PATH", "/models/piper/en_US-lessac-medium.onnx")
    )


@dataclass
class PiperTTSResult:
    audio_bytes: bytes
    content_type: str
    endpoint: str


class PiperTTSClient:
    """
    Piper TTS via CLI subprocess.
    Uses `piper` command installed by `pip install piper-tts`.
    Produces a proper WAV file every time — no Python wave header bugs.
    ~0.3-0.8s per sentence on CPU.
    """

    async def synthesize(
        self,
        text: str,
        speaker: Optional[str] = None,
        language: Optional[str] = None,
    ) -> PiperTTSResult:
        import asyncio

        text = (text or "").strip()
        if not text:
            raise ValueError("Empty text for TTS")

        audio_bytes = await asyncio.to_thread(self._synth, text)

        return PiperTTSResult(
            audio_bytes=audio_bytes,
            content_type="audio/wav",
            endpoint="piper-local",
        )

    def _synth(self, text: str) -> bytes:
        model_path = _get_model_path()

        if not os.path.exists(model_path):
            raise FileNotFoundError(f"Piper model not found: {model_path}")

        # Create temp WAV file for piper to write into
        fd, tmp_path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)

        try:
            # Call piper CLI — it handles all WAV formatting correctly
            proc = subprocess.run(
                [
                    "piper",
                    "--model", model_path,
                    "--output_file", tmp_path,
                ],
                input=text.encode("utf-8"),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=30,
            )

            if proc.returncode != 0:
                err_msg = proc.stderr.decode("utf-8", errors="replace").strip()
                log.error("piper_cli_error", returncode=proc.returncode, stderr=err_msg)
                raise RuntimeError(f"Piper failed ({proc.returncode}): {err_msg}")

            with open(tmp_path, "rb") as f:
                wav_bytes = f.read()

            if len(wav_bytes) <= 44:
                raise RuntimeError("Piper produced empty audio")

            log.info("piper_synth", text_len=len(text), wav_bytes=len(wav_bytes))
            return wav_bytes

        finally:
            # Always clean up temp file
            try:
                os.unlink(tmp_path)
            except OSError:
                pass