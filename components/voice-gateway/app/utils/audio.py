# app/utils/audio.py

from __future__ import annotations

import os
import subprocess
import tempfile
from dataclasses import dataclass

from app.services.core.config import settings
from app.services.core.errors import BadRequest, UpstreamError
from app.services.core.logging import get_logger

log = get_logger("audio_utils")


@dataclass
class NormalizedAudio:
    wav_bytes: bytes
    mime: str = "audio/wav"
    filename: str = "audio.wav"


def normalize_to_wav_16k_mono(input_bytes: bytes, input_suffix: str = ".bin") -> NormalizedAudio:
    """
    Convert arbitrary audio to 16kHz mono WAV PCM using ffmpeg.
    Works for webm/m4a/mp3/wav/ogg etc as long as ffmpeg supports it.
    """
    if not input_bytes:
        raise BadRequest("Empty audio payload")

    # Basic size guard (MB)
    max_bytes = settings.MAX_AUDIO_MB * 1024 * 1024
    if len(input_bytes) > max_bytes:
        raise BadRequest(f"Audio too large. Max {settings.MAX_AUDIO_MB} MB")

    ffmpeg = settings.FFMPEG_PATH

    with tempfile.TemporaryDirectory() as td:
        inp = os.path.join(td, f"input{input_suffix}")
        out = os.path.join(td, "out.wav")

        with open(inp, "wb") as f:
            f.write(input_bytes)

        # -vn ignore video track (incl WebM) pcm_s16le is standard wav encoding
        cmd = [
            ffmpeg, "-y",
            "-i", inp,
            "-vn",
            "-ac", str(settings.TARGET_CHANNELS),
            "-ar", str(settings.TARGET_SAMPLE_RATE),
            "-acodec", "pcm_s16le",
            out,
        ]

        try:
            p = subprocess.run(cmd, capture_output=True, text=True)
        except FileNotFoundError:
            raise UpstreamError(
                upstream="ffmpeg",
                message="ffmpeg not found. Check FFMPEG_PATH or install ffmpeg.",
                detail={"FFMPEG_PATH": ffmpeg},
            )

        if p.returncode != 0:
            log.error("ffmpeg_failed", stderr=p.stderr[:500], stdout=p.stdout[:200])
            raise BadRequest(
                "Audio conversion failed (unsupported format or corrupt audio).",
                detail=p.stderr[:500],
            )

        with open(out, "rb") as f:
            wav_bytes = f.read()

    return NormalizedAudio(wav_bytes=wav_bytes)
