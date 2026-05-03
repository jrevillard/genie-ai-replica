# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

import logging
import os
from pathlib import Path
from typing import Dict, Generator, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

try:
    from piper import PiperVoice
except ImportError as exc:
    raise SystemExit("piper-tts is not installed; check requirements.txt") from exc


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("genieai_tts")
logflag = os.getenv("LOGFLAG", "").lower() in ("1", "true", "yes")

VOICES_DIR = Path(os.getenv("TTS_PIPER_VOICES_DIR", "/voices"))
HOST = os.getenv("TTS_PIPER_HOST", "0.0.0.0")
PORT = int(os.getenv("TTS_PIPER_PORT", "9200"))

LANG_TO_DEFAULT_VOICE = {
    "fr": os.getenv("TTS_PIPER_DEFAULT_VOICE_FR", "fr_FR-siwis-medium"),
    "en": os.getenv("TTS_PIPER_DEFAULT_VOICE_EN", "en_US-libritts_r-medium"),
    "es": os.getenv("TTS_PIPER_DEFAULT_VOICE_ES", "es_MX-claude-high"),
    # Swahili — only one voice ships in the Piper catalog.
    "sw": os.getenv("TTS_PIPER_DEFAULT_VOICE_SW", "sw_CD-lanfrica-medium"),
}

# Per-language gender mapping. The voice field of an incoming request
# accepts "female" or "male" (case-insensitive) and is resolved here.
# Swahili has only one voice — both genders fall back to it.
GENDER_VOICES = {
    "female": {
        "en": os.getenv("TTS_PIPER_VOICE_FEMALE_EN", "en_US-lessac-high"),
        "fr": os.getenv("TTS_PIPER_VOICE_FEMALE_FR", "fr_FR-siwis-medium"),
        "es": os.getenv("TTS_PIPER_VOICE_FEMALE_ES", "es_ES-sharvard-medium"),
        "sw": os.getenv("TTS_PIPER_VOICE_FEMALE_SW", "sw_CD-lanfrica-medium"),
    },
    "male": {
        "en": os.getenv("TTS_PIPER_VOICE_MALE_EN", "en_US-ryan-high"),
        "fr": os.getenv("TTS_PIPER_VOICE_MALE_FR", "fr_FR-tom-medium"),
        "es": os.getenv("TTS_PIPER_VOICE_MALE_ES", "es_MX-claude-high"),
        "sw": os.getenv("TTS_PIPER_VOICE_MALE_SW", "sw_CD-lanfrica-medium"),
    },
}

app = FastAPI(title="GENIE.AI TTS (Piper)")
_voice_cache: Dict[str, PiperVoice] = {}


class SynthesizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)
    language: Optional[str] = Field(None, description="fr | en | es; ignored if voice is provided")
    voice: Optional[str] = Field(None, description="Piper voice name, e.g. fr_FR-siwis-medium")


def _resolve_voice(language: Optional[str], voice: Optional[str]) -> str:
    """Resolve a Piper voice file name from language + voice fields.

    `voice` may be:
      - "female" or "male" (case-insensitive) — looked up in GENDER_VOICES
      - a full Piper voice file name (e.g. "en_US-ryan-high") — returned as-is
      - empty/None — falls back to LANG_TO_DEFAULT_VOICE[language]
    """
    if voice:
        v = voice.strip().lower()
        if v in GENDER_VOICES:
            if not language:
                raise HTTPException(status_code=400, detail="Language is required when voice is a gender token")
            mapping = GENDER_VOICES[v].get(language.lower())
            if not mapping:
                raise HTTPException(status_code=400, detail=f"No {v} voice configured for language={language}")
            return mapping
        # Full voice file name — pass through as-is
        return voice
    if not language:
        raise HTTPException(status_code=400, detail="Either language or voice must be provided")
    name = LANG_TO_DEFAULT_VOICE.get(language.lower())
    if not name:
        raise HTTPException(status_code=400, detail=f"No default voice for language={language}")
    return name


def _load_voice(name: str) -> PiperVoice:
    if name in _voice_cache:
        return _voice_cache[name]
    onnx_path = VOICES_DIR / f"{name}.onnx"
    json_path = VOICES_DIR / f"{name}.onnx.json"
    if not onnx_path.exists() or not json_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Voice files missing under {VOICES_DIR}: {onnx_path.name}, {json_path.name}",
        )
    logger.info("Loading Piper voice %s", name)
    voice = PiperVoice.load(str(onnx_path), config_path=str(json_path))
    _voice_cache[name] = voice
    return voice


def _stream_pcm(voice: PiperVoice, text: str) -> Generator[bytes, None, None]:
    for chunk in voice.synthesize_stream_raw(text):
        yield chunk


@app.get("/health")
def health() -> JSONResponse:
    voices_present = sorted(p.stem for p in VOICES_DIR.glob("*.onnx")) if VOICES_DIR.exists() else []
    return JSONResponse({
        "ok": VOICES_DIR.exists(),
        "voices_dir": str(VOICES_DIR),
        "voices_installed": voices_present,
        "language_defaults": LANG_TO_DEFAULT_VOICE,
    })


@app.get("/v1/microservice/tts/voices")
def list_voices() -> JSONResponse:
    if not VOICES_DIR.exists():
        return JSONResponse({"voices": [], "language_defaults": LANG_TO_DEFAULT_VOICE})
    voices = sorted(p.stem for p in VOICES_DIR.glob("*.onnx"))
    return JSONResponse({"voices": voices, "language_defaults": LANG_TO_DEFAULT_VOICE})


@app.post("/v1/microservice/tts")
def synthesize(req: SynthesizeRequest) -> StreamingResponse:
    voice_name = _resolve_voice(req.language, req.voice)
    voice = _load_voice(voice_name)
    if logflag:
        logger.info("TTS voice=%s text=%r", voice_name, req.text[:80])
    return StreamingResponse(
        _stream_pcm(voice, req.text),
        media_type="application/octet-stream",
        headers={
            "X-Voice-Name": voice_name,
            "X-Sample-Rate": str(voice.config.sample_rate),
            "X-Audio-Format": "pcm_s16le_mono",
        },
    )


class OpenAISpeechRequest(BaseModel):
    model: Optional[str] = "tts-1"
    input: str = Field(..., min_length=1, max_length=4000)
    voice: str = Field(..., description="One of fr|en|es or a Piper voice name")
    response_format: Optional[str] = Field("wav", pattern="^(wav|pcm)$")


@app.post("/v1/audio/speech")
def openai_compatible_speech(req: OpenAISpeechRequest) -> StreamingResponse:
    """OpenAI TTS-compatible alias for `/v1/microservice/tts`.

    `voice` can be a language code (fr|en|es) — mapped to the configured default
    voice — or a full Piper voice name.
    """
    voice_name = LANG_TO_DEFAULT_VOICE.get(req.voice.lower(), req.voice)
    voice = _load_voice(voice_name)
    if logflag:
        logger.info("OpenAI-shape TTS voice=%s text=%r", voice_name, req.input[:80])

    if req.response_format == "pcm":
        return StreamingResponse(
            _stream_pcm(voice, req.input),
            media_type="application/octet-stream",
            headers={
                "X-Voice-Name": voice_name,
                "X-Sample-Rate": str(voice.config.sample_rate),
                "X-Audio-Format": "pcm_s16le_mono",
            },
        )

    import io
    import wave

    def _wav_stream():
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(voice.config.sample_rate)
            for chunk in voice.synthesize_stream_raw(req.input):
                wav_file.writeframes(chunk)
        buf.seek(0)
        while True:
            block = buf.read(4096)
            if not block:
                return
            yield block

    return StreamingResponse(_wav_stream(), media_type="audio/wav", headers={"X-Voice-Name": voice_name})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
