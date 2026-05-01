# server.py — Mandinka MMS-TTS Microservice
#
# Sibling to tts-service (Piper / English). Same HTTP contract so the
# chatqna-side client is a line-for-line mirror of tts_piper.py.
#
# Endpoints:
#   GET  /health        — readiness + loaded model metadata
#   POST /v1/tts        — { "text": "..." } → audio/wav  (22 050 Hz mono)
#   POST /v1/tts/ogg    — { "text": "..." } → audio/ogg  (Opus, 48 kHz mono)
#
# Backed by Meta's Massively Multilingual Speech (MMS) VITS model:
#   facebook/mms-tts-mnk  —  the only production-ready Mandinka TTS.
#   https://huggingface.co/facebook/mms-tts-mnk    (CC-BY-NC 4.0)
#
# Model is loaded once at startup (~5 s cold) and reused — inference is
# ~500 ms-1 s for a short sentence on modern CPU, <200 ms on GPU.

import io
import logging
import os
import re
import subprocess
import tempfile
import time
from typing import List, Optional

import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from transformers import AutoTokenizer, VitsModel


# ── Config ────────────────────────────────────────────────────────────
MODEL_ID        = os.environ.get("MMS_MODEL_ID", "facebook/mms-tts-mnk")
DEVICE          = os.environ.get("MMS_DEVICE", "cpu")  # "cpu" or "cuda"
LANG_LABEL      = os.environ.get("MMS_LANG_LABEL", "mandinka")
# 2026-05-02: bumped from 2000 to 5000 because long-form clinical
# replies (multi-day meal plans, care instructions) routinely run
# 1500-3000 chars. The internal chunker (CHUNK_MAX_CHARS) bounds the
# per-tensor synthesis cost, so MAX_CHARS is now just an outer safety
# net against absurd inputs rather than the architectural limit.
MAX_CHARS       = int(os.environ.get("MMS_MAX_CHARS", "5000"))
# Per-chunk cap fed to the VITS forward pass. The model's compute
# scales super-linearly with input length: 250 chars takes ~5 s on
# CPU, 1300 chars takes ~140 s. Splitting on sentence boundaries at
# this cap keeps each forward pass well under 30 s and the total
# wall-clock at roughly len(text)/250 * 5 s.
CHUNK_MAX_CHARS = int(os.environ.get("MMS_CHUNK_MAX_CHARS", "250"))
PITCH_SEMITONES = float(os.environ.get("MMS_PITCH_SEMITONES", "3.5"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("tts-mms")


# ── Lifecycle: load model at startup ─────────────────────────────────
app = FastAPI(title="Amina MMS-TTS (Mandinka)", version="1.0.0")

_MODEL: Optional[VitsModel] = None
_TOKENIZER = None
_SR: int = 16000     # overridden once model is loaded


@app.on_event("startup")
def _load_model():
    global _MODEL, _TOKENIZER, _SR
    log.info("loading MMS-TTS model: %s  (device=%s)", MODEL_ID, DEVICE)
    _TOKENIZER = AutoTokenizer.from_pretrained(MODEL_ID)
    _MODEL     = VitsModel.from_pretrained(MODEL_ID).to(DEVICE).eval()
    _SR        = int(_MODEL.config.sampling_rate)
    log.info("MMS-TTS ready (lang=%s, sample_rate=%d Hz)", LANG_LABEL, _SR)


# ── Schemas ──────────────────────────────────────────────────────────
class TTSRequest(BaseModel):
    text: str


# ── Health ───────────────────────────────────────────────────────────
@app.get("/health")
def health():
    ready = _MODEL is not None and _TOKENIZER is not None
    return {
        "status":           "ok" if ready else "loading",
        "service":          "tts-mms",
        "model":            MODEL_ID,
        "language":         LANG_LABEL,
        "sample_rate":      _SR if ready else None,
        "device":           DEVICE,
        "max_chars":        MAX_CHARS,
        "chunk_max_chars":  CHUNK_MAX_CHARS,
    }


# ── Pitch shifting (male → female voice) ────────────────────────────
def _feminize_wav(wav_bytes: bytes) -> bytes:
    """Shift pitch up via ffmpeg to feminize the MMS voice.

    Uses asetrate + aresample for pitch shift, then atempo to restore
    the original speaking speed. No extra Python dependencies needed.
    """
    if PITCH_SEMITONES <= 0:
        return wav_bytes

    factor = 2 ** (PITCH_SEMITONES / 12)
    tempo = 1.0 / factor

    fd_in, in_path = tempfile.mkstemp(suffix=".wav")
    fd_out, out_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd_in)
    os.close(fd_out)

    try:
        with open(in_path, "wb") as f:
            f.write(wav_bytes)

        proc = subprocess.run(
            ["ffmpeg", "-y", "-i", in_path,
             "-af", f"asetrate={_SR}*{factor:.4f},aresample={_SR},atempo={tempo:.4f}",
             "-ar", str(_SR), "-ac", "1",
             out_path],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=10,
        )
        if proc.returncode != 0:
            log.warning("pitch shift failed (rc=%d), returning original", proc.returncode)
            return wav_bytes

        with open(out_path, "rb") as f:
            return f.read()
    except Exception as e:
        log.warning("pitch shift error: %s — returning original", e)
        return wav_bytes
    finally:
        for p in (in_path, out_path):
            try:
                os.unlink(p)
            except OSError:
                pass


# ── Chunking ─────────────────────────────────────────────────────────
# Sentence terminators we split on first. Mandinka uses Latin
# punctuation, so the same set as English works. We also split on
# newlines for bullet-style replies (meal plans, care plan steps).
_SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+|\n+|(?<=:)\s+(?=-)")


def _split_into_chunks(text: str, max_chars: int = CHUNK_MAX_CHARS) -> List[str]:
    """Split ``text`` into chunks <= ``max_chars`` on sentence boundaries.

    Pass 1: split on sentence terminators (``.!?``) + newlines + ``: -``
    bullet markers. Pass 2: any segment still longer than ``max_chars``
    is force-wrapped on word boundaries (whitespace) so the VITS
    forward pass never sees an oversized input. Single tokens longer
    than ``max_chars`` are passed through as-is rather than mid-word
    cut, since splitting a Mandinka word would garble the phoneme.
    """
    text = (text or "").strip()
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]

    # Pass 1: sentence-level segments.
    raw_segments = [s.strip() for s in _SENTENCE_BOUNDARY.split(text) if s and s.strip()]
    if not raw_segments:
        raw_segments = [text]

    # Pass 2: pack segments into chunks, splitting any oversize segment
    # on word boundaries.
    chunks: List[str] = []
    current = ""
    for seg in raw_segments:
        if len(seg) > max_chars:
            # Flush current and word-split the big segment.
            if current:
                chunks.append(current)
                current = ""
            words = seg.split()
            buf = ""
            for w in words:
                candidate = (buf + " " + w).strip() if buf else w
                if len(candidate) > max_chars and buf:
                    chunks.append(buf)
                    buf = w
                else:
                    buf = candidate
            if buf:
                # Don't append yet -- let the outer loop's packing
                # logic absorb buf as the next "current" base so a
                # short trailing remnant pairs with the next segment.
                current = buf
            continue

        # Normal-size segment: pack into current chunk if it fits.
        candidate = (current + " " + seg).strip() if current else seg
        if len(candidate) <= max_chars:
            current = candidate
        else:
            if current:
                chunks.append(current)
            current = seg
    if current:
        chunks.append(current)
    return chunks


# ── Core synthesis ───────────────────────────────────────────────────
def _synthesize_chunk(text: str) -> np.ndarray:
    """Run VITS once on a single chunk and return the float32 waveform."""
    inputs = _TOKENIZER(text, return_tensors="pt").to(DEVICE)
    with torch.no_grad():
        output = _MODEL(**inputs).waveform
    waveform = output.squeeze(0).detach().cpu().numpy().astype(np.float32)
    # Safe clamp -- MMS output occasionally goes slightly outside [-1, 1].
    return np.clip(waveform, -1.0, 1.0)


def _synthesize_wav(text: str) -> bytes:
    """Synthesize ``text`` to 16-bit PCM WAV bytes.

    Long inputs are split into sentence-level chunks of <= CHUNK_MAX_CHARS
    and synthesized one at a time. The resulting waveforms are joined
    with a short silence between chunks (~120 ms) so the audio doesn't
    feel like one breathless run-on. Pitch shift runs once on the
    concatenated WAV at the end.

    Without chunking, a 1300-char input takes ~140 s on CPU and
    routinely trips client timeouts (httpx default 30 s in tts_mms.py).
    With chunking, the same input completes in ~50-70 s as ~5 small
    forward passes of <15 s each.
    """
    if _MODEL is None or _TOKENIZER is None:
        raise HTTPException(503, "TTS model not yet loaded")

    text = (text or "").strip()
    if not text:
        raise HTTPException(400, "Empty text")
    if len(text) > MAX_CHARS:
        raise HTTPException(413, f"Text exceeds {MAX_CHARS} characters")

    try:
        chunks = _split_into_chunks(text, CHUNK_MAX_CHARS)
        log.info("mms_tts_synth chars=%d chunks=%d", len(text), len(chunks))

        if not chunks:
            raise HTTPException(400, "Text produced no synthesizable chunks")

        # Inter-chunk silence. 120 ms at the model's native sample rate.
        silence = np.zeros(int(_SR * 0.12), dtype=np.float32)

        waveforms: List[np.ndarray] = []
        t_start = time.perf_counter()
        for i, ch in enumerate(chunks):
            t_ch = time.perf_counter()
            w = _synthesize_chunk(ch)
            log.info(
                "mms_tts_chunk idx=%d/%d chars=%d audio_s=%.2f synth_s=%.2f",
                i + 1, len(chunks), len(ch), len(w) / _SR, time.perf_counter() - t_ch,
            )
            waveforms.append(w)
            if i < len(chunks) - 1:
                waveforms.append(silence)

        full = np.concatenate(waveforms) if len(waveforms) > 1 else waveforms[0]
        log.info(
            "mms_tts_done chunks=%d total_audio_s=%.2f total_synth_s=%.2f",
            len(chunks), len(full) / _SR, time.perf_counter() - t_start,
        )

        buf = io.BytesIO()
        sf.write(buf, full, _SR, format="WAV", subtype="PCM_16")
        wav_bytes = buf.getvalue()

        # Feminize the voice via pitch shift -- ONCE, on the concatenated
        # WAV. Doing this per-chunk would amplify ffmpeg startup cost N
        # times and risk small per-chunk artifacts at boundaries.
        wav_bytes = _feminize_wav(wav_bytes)

        return wav_bytes
    except HTTPException:
        raise
    except Exception as e:
        log.exception("mms_tts_failed")
        raise HTTPException(500, f"MMS-TTS synthesis failed: {e}") from e


# ── /v1/tts → WAV ────────────────────────────────────────────────────
@app.post("/v1/tts")
def tts(req: TTSRequest):
    wav = _synthesize_wav(req.text)
    if len(wav) < 100:
        raise HTTPException(500, "Produced empty audio")
    return Response(content=wav, media_type="audio/wav")


# ── /v1/tts/ogg → OGG Opus (Telegram / WhatsApp voice notes) ─────────
@app.post("/v1/tts/ogg")
def tts_ogg(req: TTSRequest):
    wav = _synthesize_wav(req.text)

    fd_wav, wav_path = tempfile.mkstemp(suffix=".wav")
    fd_ogg, ogg_path = tempfile.mkstemp(suffix=".ogg")
    os.close(fd_wav)
    os.close(fd_ogg)

    try:
        with open(wav_path, "wb") as f:
            f.write(wav)

        proc = subprocess.run(
            ["ffmpeg", "-y", "-i", wav_path,
             "-c:a", "libopus", "-b:a", "48k",
             "-ar", "48000", "-ac", "1", ogg_path],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=15,
        )
        if proc.returncode != 0:
            raise HTTPException(500, "OGG conversion failed")

        with open(ogg_path, "rb") as f:
            ogg_bytes = f.read()
        if len(ogg_bytes) < 100:
            raise HTTPException(500, "Empty OGG output")
        return Response(content=ogg_bytes, media_type="audio/ogg")

    except HTTPException:
        raise
    except subprocess.TimeoutExpired:
        raise HTTPException(500, "OGG conversion timed out")
    finally:
        for p in (wav_path, ogg_path):
            try:
                os.unlink(p)
            except OSError:
                pass
