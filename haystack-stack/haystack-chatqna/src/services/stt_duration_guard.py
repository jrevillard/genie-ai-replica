"""
STT Duration Guard
==================

Wraps stt_whisper.transcribe to reject audio whose decoded WAV duration
exceeds STT_MAX_DURATION_SECONDS (default 360 = 6 min) BEFORE the
audio is forwarded to whisper-server.

Why this exists
---------------
A small compressed audio file (e.g. 1 MB Opus @ 12 kbps) can decode
to 80+ minutes of WAV. Such "decompression bombs" bury whisper-server
even though the upload itself is well under any byte-size cap. The
upload-size guard catches obvious oversized POSTs; this duration
guard catches the bomb at the only layer that knows the truth -- the
decoded WAV.

Strategy
--------
Monkey-patch the live transcribe function (which may already be the
patched version from main_with_stt_fix.py). The patched transcribe:

  1. Calls the existing _normalize_audio() to produce 16 kHz WAV bytes
     (this is the work the original would do anyway).
  2. Reads the WAV header to compute decoded duration.
  3. If duration > cap, raises HTTPException(413) with a clear message.
  4. Otherwise calls the previously-installed transcribe so we keep
     all upstream behaviour (logging fix, etc.).

The double normalize is deliberately accepted as the only side effect
-- it adds ~50 ms per call, in exchange for safety. Acceptable given
the alternative is whisper-server burning 10+ min CPU on a bomb.

This module is purely additive -- no edits to any existing file.
"""
from __future__ import annotations

import logging
import os
import struct
import subprocess
import tempfile
from typing import Optional

logger = logging.getLogger(__name__)


_DEFAULT_MAX_SEC = 360  # 6 min — slightly above frontend's 5-min recording cap


# ──────────────────────────────────────────────────────────────────
#  FFPROBE-BASED DURATION (metadata only, ~50 ms vs full decode ~secs)
# ──────────────────────────────────────────────────────────────────

def probe_duration_seconds(audio_bytes: bytes, filename: str) -> Optional[float]:
    """Use ffprobe to read audio duration WITHOUT full decoding.
    Returns None if probe fails. Much cheaper than ffmpeg conversion --
    metadata read only, no PCM samples produced.
    """
    if not audio_bytes:
        return None
    suffix = os.path.splitext(filename)[1] or ".bin"
    fd, path = tempfile.mkstemp(suffix=suffix)
    try:
        os.close(fd)
        with open(path, "wb") as f:
            f.write(audio_bytes)
        proc = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                path,
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=5,
        )
        if proc.returncode != 0:
            return None
        out = proc.stdout.decode("utf-8", errors="ignore").strip()
        if not out or out == "N/A":
            return None
        return float(out)
    except Exception as e:
        logger.debug("probe_duration_seconds: ffprobe failed: %s", e)
        return None
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def _resolve_max_seconds(override: Optional[int]) -> int:
    if override and override > 0:
        return override
    env_val = os.getenv("STT_MAX_DURATION_SECONDS", "").strip()
    if env_val.isdigit():
        v = int(env_val)
        if v > 0:
            return v
    return _DEFAULT_MAX_SEC


# ──────────────────────────────────────────────────────────────────
#  WAV header parser
# ──────────────────────────────────────────────────────────────────

def wav_duration_seconds(wav_bytes: bytes) -> Optional[float]:
    """Compute decoded duration in seconds from a WAV file's header.
    Returns None if the header is malformed or unrecognized.

    Supports standard PCM WAV with arbitrary chunk ordering. Walks
    the chunk list looking for 'fmt ' (sample rate, channels, bits)
    and 'data' (byte size).
    """
    if not wav_bytes or len(wav_bytes) < 44:
        return None
    if wav_bytes[:4] != b"RIFF" or wav_bytes[8:12] != b"WAVE":
        return None

    sample_rate: Optional[int] = None
    bits_per_sample: Optional[int] = None
    num_channels: Optional[int] = None
    data_size: Optional[int] = None

    try:
        offset = 12
        n = len(wav_bytes)
        while offset + 8 <= n:
            chunk_id = wav_bytes[offset : offset + 4]
            chunk_size = struct.unpack("<I", wav_bytes[offset + 4 : offset + 8])[0]
            body_off = offset + 8

            if chunk_id == b"fmt " and chunk_size >= 16 and body_off + 16 <= n:
                num_channels = struct.unpack("<H", wav_bytes[body_off + 2 : body_off + 4])[0]
                sample_rate = struct.unpack("<I", wav_bytes[body_off + 4 : body_off + 8])[0]
                bits_per_sample = struct.unpack(
                    "<H", wav_bytes[body_off + 14 : body_off + 16]
                )[0]
            elif chunk_id == b"data":
                data_size = chunk_size
                break

            # Chunks are word-aligned (pad byte if odd size)
            offset = body_off + chunk_size + (chunk_size % 2)

        if (
            sample_rate is None
            or bits_per_sample is None
            or num_channels is None
            or data_size is None
        ):
            return None
        if sample_rate <= 0 or num_channels <= 0 or bits_per_sample <= 0:
            return None

        bytes_per_sample = bits_per_sample // 8
        if bytes_per_sample == 0:
            return None
        return data_size / (sample_rate * num_channels * bytes_per_sample)
    except Exception as e:
        logger.debug("wav_duration_seconds: parse failed: %s", e)
        return None


# ──────────────────────────────────────────────────────────────────
#  MONKEY-PATCH INSTALLER
# ──────────────────────────────────────────────────────────────────

_INSTALLED = False


def install_duration_guard(max_seconds: Optional[int] = None) -> None:
    """Wrap stt_whisper._normalize_audio to enforce a decoded-duration cap.

    Wrapping at the normalize layer (instead of transcribe) means we run
    ffmpeg exactly ONCE per request -- the wrapper inspects the WAV bytes
    that normalize already produces, and returns None if duration > cap.
    The downstream transcribe sees None and returns None, which the route
    handler maps to a 422 "Could not transcribe audio".

    Trade-off: user gets a generic 422 instead of a specific 413, but the
    system stays performant under load (no 2x ffmpeg overhead). The log
    line is explicit about what was rejected and why.

    Idempotent: re-installing will not double-wrap.
    """
    global _INSTALLED
    if _INSTALLED:
        return

    cap = _resolve_max_seconds(max_seconds)

    try:
        import src.services.stt_whisper as _stt_mod
    except Exception as e:
        logger.warning("stt_duration_guard: stt_whisper not importable: %s", e)
        return

    if not hasattr(_stt_mod, "_normalize_audio"):
        logger.warning("stt_duration_guard: stt_whisper missing _normalize_audio")
        return

    _previous_normalize = _stt_mod._normalize_audio

    def _guarded_normalize(audio_bytes, filename):
        # Stage 1: cheap ffprobe metadata read (~50 ms). Catches
        # compression bombs BEFORE the expensive ffmpeg full decode.
        probed = probe_duration_seconds(audio_bytes, filename)
        if probed is not None and probed > cap:
            logger.warning(
                "stt_duration_guard: REJECTED %.1fs audio at probe stage "
                "(cap %ds, file=%s) -- bomb blocked before decode",
                probed, cap, filename,
            )
            return None

        # Stage 2: real ffmpeg normalize (only if probe didn't reject).
        wav_bytes = _previous_normalize(audio_bytes, filename)
        if wav_bytes is None:
            return None
        duration = wav_duration_seconds(wav_bytes)
        if duration is None:
            # Header unreadable -- let through, transcribe will handle
            return wav_bytes
        if duration > cap:
            logger.warning(
                "stt_duration_guard: REJECTED %.1fs audio at decode stage "
                "(cap %ds, file=%s) -- bomb slipped past probe",
                duration, cap, filename,
            )
            return None  # signals normalize failure → transcribe returns None → 422
        return wav_bytes

    _stt_mod._normalize_audio = _guarded_normalize
    _INSTALLED = True
    logger.info(
        "stt_duration_guard installed (max=%d sec / %d min) "
        "-- wraps stt_whisper._normalize_audio (single ffmpeg per request)",
        cap, cap // 60,
    )


__all__ = ["install_duration_guard", "wav_duration_seconds"]
