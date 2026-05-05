# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

import io
import logging
import os
import time
from typing import Optional

import numpy as np
from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from faster_whisper import WhisperModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("genieai_asr")
logflag = os.getenv("LOGFLAG", "").lower() in ("1", "true", "yes")

MODEL_NAME = os.getenv("ASR_WHISPER_MODEL", "large-v3-turbo")
DEVICE = os.getenv("ASR_WHISPER_DEVICE", "cuda")
COMPUTE_TYPE = os.getenv("ASR_WHISPER_COMPUTE_TYPE", "float16")
SUPPORTED_LANGS = [s.strip() for s in os.getenv("ASR_WHISPER_LANGUAGES", "fr,en,es").split(",") if s.strip()]
HOST = os.getenv("ASR_WHISPER_HOST", "0.0.0.0")
PORT = int(os.getenv("ASR_WHISPER_PORT", "9100"))

app = FastAPI(title="GENIE.AI ASR (faster-whisper)")
_model: Optional[WhisperModel] = None


def get_model() -> WhisperModel:
    global _model
    if _model is None:
        logger.info("Loading faster-whisper model=%s device=%s compute_type=%s", MODEL_NAME, DEVICE, COMPUTE_TYPE)
        _model = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE_TYPE)
        logger.info("Model loaded")
    return _model


@app.on_event("startup")
def _startup() -> None:
    get_model()


@app.get("/health")
def health() -> JSONResponse:
    return JSONResponse({"ok": _model is not None, "model": MODEL_NAME, "device": DEVICE, "languages": SUPPORTED_LANGS})


@app.post("/v1/microservice/asr")
async def transcribe(
    file: UploadFile = File(...),
    language: Optional[str] = Form(None),
    prompt: Optional[str] = Form(None),
) -> JSONResponse:
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio payload")

    lang = (language or "auto").lower()
    if lang != "auto" and lang not in SUPPORTED_LANGS:
        raise HTTPException(status_code=400, detail=f"language must be one of: auto, {', '.join(SUPPORTED_LANGS)}")

    started = time.time()
    try:
        model = get_model()
        segments, info = model.transcribe(
            io.BytesIO(audio_bytes),
            language=None if lang == "auto" else lang,
            initial_prompt=prompt,
            vad_filter=False,
            beam_size=1,
        )
        seg_list = [{"start": s.start, "end": s.end, "text": s.text.strip()} for s in segments]
    except Exception as exc:
        logger.exception("Transcription failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    text = " ".join(s["text"] for s in seg_list).strip()
    elapsed_ms = int((time.time() - started) * 1000)
    if logflag:
        logger.info("ASR ok lang=%s ms=%s text=%r", info.language, elapsed_ms, text[:120])
    return JSONResponse({
        "text": text,
        "language": info.language,
        "language_probability": info.language_probability,
        "duration_ms": elapsed_ms,
        "segments": seg_list,
    })


@app.post("/v1/audio/transcriptions")
async def openai_compatible_transcribe(
    file: UploadFile = File(...),
    model: Optional[str] = Form(None),
    language: Optional[str] = Form(None),
    prompt: Optional[str] = Form(None),
    response_format: Optional[str] = Form("json"),
) -> JSONResponse:
    """OpenAI Whisper-API-compatible alias for `/v1/microservice/asr`.

    Lets `livekit-plugins-openai`'s STT class call this service unchanged.
    """
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio payload")

    lang = (language or "auto").lower()
    started = time.time()
    try:
        whisper = get_model()
        segments, info = whisper.transcribe(
            io.BytesIO(audio_bytes),
            language=None if lang == "auto" else lang,
            initial_prompt=prompt,
            vad_filter=False,
            beam_size=1,
        )
        text = " ".join(s.text.strip() for s in segments).strip()
    except Exception as exc:
        logger.exception("Transcription failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if logflag:
        logger.info("OpenAI-shape ASR ok lang=%s ms=%s", info.language, int((time.time() - started) * 1000))
    return JSONResponse({"text": text, "language": info.language})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
