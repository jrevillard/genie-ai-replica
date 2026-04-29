# app/api/voice.py

from __future__ import annotations

import json
from typing import Optional, List, Dict

from fastapi import APIRouter, File, Form, UploadFile
from pydantic import BaseModel

from app.services.core.config import settings
from app.services.core.errors import BadRequest
from app.services.core.logging import get_logger
from app.services.llm_openai import OpenAIClient
from app.services.stt_whispercpp import WhisperCppClient
from app.utils.audio import normalize_to_wav_16k_mono

log = get_logger("api_voice")

router = APIRouter()


def _guess_suffix(filename: str | None) -> str:
    if not filename or "." not in filename:
        return ".bin"
    ext = filename.rsplit(".", 1)[-1].lower().strip()
    return f".{ext}" if ext else ".bin"


def _enforce_audio_limits(raw: bytes) -> None:
    if not raw:
        raise BadRequest("Empty file uploaded")

    max_bytes = int(settings.MAX_AUDIO_MB) * 1024 * 1024
    if len(raw) > max_bytes:
        raise BadRequest(
            f"Audio too large. Max allowed is {settings.MAX_AUDIO_MB} MB"
        )


def _parse_history(history_json: Optional[str]) -> List[Dict[str, str]]:
    if not history_json or not history_json.strip():
        return []
    try:
        history = json.loads(history_json)
        if not isinstance(history, list):
            return []
        clean: List[Dict[str, str]] = []
        for msg in history:
            if isinstance(msg, dict):
                role = msg.get("role", "")
                content = msg.get("content", "")
                if role in ("user", "assistant") and isinstance(content, str) and content.strip():
                    clean.append({"role": role, "content": content.strip()})
        return clean
    except (json.JSONDecodeError, TypeError):
        return []


@router.post("/stt")
async def stt_only(file: UploadFile = File(...), language: str | None = None):
    """
    Upload audio -> normalize -> whisper.cpp -> transcript
    """
    if not settings.ENABLE_STT:
        raise BadRequest("STT is disabled")

    raw = await file.read()
    _enforce_audio_limits(raw)

    suffix = _guess_suffix(file.filename)
    log.info(
        "stt_request",
        filename=file.filename,
        suffix=suffix,
        size_bytes=len(raw),
        language=language,
    )

    normalized = normalize_to_wav_16k_mono(raw, input_suffix=suffix)

    stt = WhisperCppClient()
    result = await stt.transcribe(
        audio_bytes=normalized.wav_bytes,
        filename="audio.wav",
        content_type="audio/wav",
        language=language,
    )

    return {
        "transcript": result.text,
        "stt_endpoint": result.endpoint,
    }


@router.post("/stt-chat")
async def stt_chat(
    file: UploadFile = File(...),
    language: str | None = Form(default=None),
    history: str | None = Form(default=None),
):
    """
    Upload audio -> normalize -> whisper.cpp -> transcript -> OpenAI (with history) -> answer
    """
    if not settings.ENABLE_STT:
        raise BadRequest("STT is disabled")

    if not settings.ENABLE_LLM:
        raise BadRequest("Chat is disabled")

    raw = await file.read()
    _enforce_audio_limits(raw)

    suffix = _guess_suffix(file.filename)
    conversation_history = _parse_history(history)

    log.info(
        "stt_chat_request",
        filename=file.filename,
        suffix=suffix,
        size_bytes=len(raw),
        language=language,
        history_len=len(conversation_history),
    )

    normalized = normalize_to_wav_16k_mono(raw, input_suffix=suffix)

    stt = WhisperCppClient()
    stt_result = await stt.transcribe(
        audio_bytes=normalized.wav_bytes,
        filename="audio.wav",
        content_type="audio/wav",
        language=language,
    )

    transcript = (stt_result.text or "").strip()

    if not transcript:
        raise BadRequest("No speech detected / empty transcript")

    llm = OpenAIClient()
    answer = await llm.chat(
        user_text=transcript,
        history=conversation_history,
    )

    return {
        "transcript": transcript,
        "answer": answer,
    }


# ─── New: Text-only chat (no audio) ───

class TextChatRequest(BaseModel):
    text: str
    history: Optional[List[Dict[str, str]]] = None


@router.post("/text-chat")
async def text_chat(req: TextChatRequest):
    """
    Text -> OpenAI (with history) -> answer
    Used for tag clicks and typed messages — no audio processing needed.
    """
    if not settings.ENABLE_LLM:
        raise BadRequest("Chat is disabled")

    text = (req.text or "").strip()
    if not text:
        raise BadRequest("text is required")

    # Sanitize history
    clean_history: List[Dict[str, str]] = []
    if req.history:
        for msg in req.history:
            role = msg.get("role", "")
            content = msg.get("content", "")
            if role in ("user", "assistant") and isinstance(content, str) and content.strip():
                clean_history.append({"role": role, "content": content.strip()})

    log.info("text_chat_request", text_len=len(text), history_len=len(clean_history))

    llm = OpenAIClient()
    answer = await llm.chat(
        user_text=text,
        history=clean_history,
    )

    return {
        "transcript": text,
        "answer": answer,
    }
