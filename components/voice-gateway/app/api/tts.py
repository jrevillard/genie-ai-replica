# app/api/tts.py

from typing import Optional

from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel

from app.services.core.config import settings
from app.services.core.errors import BadRequest
from app.services.core.logging import get_logger

log = get_logger("api_tts")
router = APIRouter()


class TTSRequest(BaseModel):
    text: str
    speaker: Optional[str] = None
    language: Optional[str] = None


@router.post("/tts")
async def tts(req: TTSRequest):
    if not settings.ENABLE_TTS:
        raise BadRequest("TTS is disabled")

    # ─── Piper TTS (fast, local, ~0.3-0.8s per sentence) ───
    from app.services.tts_piper import PiperTTSClient

    client = PiperTTSClient()
    result = await client.synthesize(
        req.text,
        speaker=req.speaker,
        language=req.language,
    )

    # ─── Coqui TTS (original — slow on CPU, ~8-15s) ───
    # from app.services.tts_conqui import CoquiTTSClient
    #
    # client = CoquiTTSClient()
    # result = await client.synthesize(
    #     req.text,
    #     speaker=req.speaker,
    #     language=req.language,
    # )

    log.info(
        "tts_done",
        endpoint=result.endpoint,
        bytes=len(result.audio_bytes),
    )

    return Response(
        content=result.audio_bytes,
        media_type=result.content_type or "audio/wav",
    )
