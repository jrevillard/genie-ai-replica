# server.py — Piper TTS Microservice

import os
import subprocess
import tempfile
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

app = FastAPI(title="Amina TTS Service", version="1.0.0")

MODEL_PATH = os.environ.get("PIPER_MODEL_PATH", "/models/piper/en_US-lessac-medium.onnx")


class TTSRequest(BaseModel):
    text: str


@app.get("/health")
def health():
    model_exists = os.path.exists(MODEL_PATH)
    return {"status": "ok" if model_exists else "no_model", "service": "tts-piper", "model": MODEL_PATH}


@app.post("/v1/tts")
async def tts(req: TTSRequest):
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(400, "Empty text")

    if not os.path.exists(MODEL_PATH):
        raise HTTPException(500, f"Piper model not found: {MODEL_PATH}")

    fd, tmp_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)

    try:
        proc = subprocess.run(
            ["piper", "--model", MODEL_PATH, "--output_file", tmp_path],
            input=text.encode("utf-8"),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=30,
        )

        if proc.returncode != 0:
            raise HTTPException(500, "Piper TTS synthesis failed")

        with open(tmp_path, "rb") as f:
            wav_bytes = f.read()

        if len(wav_bytes) < 100:
            raise HTTPException(500, "Piper produced empty audio")

        return Response(content=wav_bytes, media_type="audio/wav")

    except subprocess.TimeoutExpired:
        raise HTTPException(500, "TTS timed out")
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


@app.post("/v1/tts/ogg")
async def tts_ogg(req: TTSRequest):
    """Same as /v1/tts but returns OGG Opus (for Telegram/WhatsApp voice notes)."""
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(400, "Empty text")

    if not os.path.exists(MODEL_PATH):
        raise HTTPException(500, f"Piper model not found: {MODEL_PATH}")

    fd_wav, wav_path = tempfile.mkstemp(suffix=".wav")
    fd_ogg, ogg_path = tempfile.mkstemp(suffix=".ogg")
    os.close(fd_wav)
    os.close(fd_ogg)

    try:
        # Generate WAV
        proc = subprocess.run(
            ["piper", "--model", MODEL_PATH, "--output_file", wav_path],
            input=text.encode("utf-8"),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=30,
        )
        if proc.returncode != 0:
            raise HTTPException(500, "Piper TTS failed")

        # Convert to OGG Opus
        proc = subprocess.run(
            ["ffmpeg", "-y", "-i", wav_path, "-c:a", "libopus", "-b:a", "48k", "-ar", "48000", "-ac", "1", ogg_path],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=15,
        )
        if proc.returncode != 0:
            raise HTTPException(500, "OGG conversion failed")

        with open(ogg_path, "rb") as f:
            ogg_bytes = f.read()

        return Response(content=ogg_bytes, media_type="audio/ogg")

    finally:
        for p in [wav_path, ogg_path]:
            try:
                os.unlink(p)
            except OSError:
                pass
