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
import subprocess
import tempfile
from typing import Optional

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
MAX_CHARS       = int(os.environ.get("MMS_MAX_CHARS", "2000"))
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
        "status":        "ok" if ready else "loading",
        "service":       "tts-mms",
        "model":         MODEL_ID,
        "language":      LANG_LABEL,
        "sample_rate":   _SR if ready else None,
        "device":        DEVICE,
        "max_chars":     MAX_CHARS,
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


# ── Core synthesis ───────────────────────────────────────────────────
def _synthesize_wav(text: str) -> bytes:
    """Run the VITS model on `text` and return 16-bit PCM WAV bytes."""
    if _MODEL is None or _TOKENIZER is None:
        raise HTTPException(503, "TTS model not yet loaded")

    text = (text or "").strip()
    if not text:
        raise HTTPException(400, "Empty text")
    if len(text) > MAX_CHARS:
        raise HTTPException(413, f"Text exceeds {MAX_CHARS} characters")

    try:
        inputs = _TOKENIZER(text, return_tensors="pt").to(DEVICE)
        with torch.no_grad():
            output = _MODEL(**inputs).waveform
        # [1, audio_len] → [audio_len]
        waveform = output.squeeze(0).detach().cpu().numpy().astype(np.float32)
        # Safe clamp — MMS output occasionally goes slightly outside [-1, 1]
        waveform = np.clip(waveform, -1.0, 1.0)

        buf = io.BytesIO()
        sf.write(buf, waveform, _SR, format="WAV", subtype="PCM_16")
        wav_bytes = buf.getvalue()

        # Feminize the voice via pitch shift
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
