# app/services/audio.py

"""Audio conversion utilities for messaging platforms."""

import logging
import os
import subprocess
import tempfile
from typing import Optional

log = logging.getLogger("audio")


def convert_to_ogg_opus(wav_bytes: bytes) -> Optional[bytes]:
    """Convert WAV audio to OGG Opus (for Telegram/WhatsApp voice notes)."""
    if not wav_bytes or len(wav_bytes) < 100:
        return None

    fd_in, in_path = tempfile.mkstemp(suffix=".wav")
    fd_out, out_path = tempfile.mkstemp(suffix=".ogg")

    try:
        os.close(fd_out)
        with open(in_path, "wb") as f:
            f.write(wav_bytes)
        os.close(fd_in)

        proc = subprocess.run(
            ["ffmpeg", "-y", "-i", in_path, "-c:a", "libopus", "-b:a", "48k", "-ar", "48000", "-ac", "1", out_path],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15,
        )
        if proc.returncode != 0:
            return None

        with open(out_path, "rb") as f:
            return f.read()

    except Exception as e:
        log.error("ogg_convert_failed: %s", str(e))
        return None
    finally:
        for p in [in_path, out_path]:
            try:
                os.unlink(p)
            except OSError:
                pass