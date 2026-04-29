"""
Diagnostic + fixed-path routes for Mandinka TTS.

Mounted additively by src/main_with_tts_mandinka_fix.py. The existing
/api/v1/tts route also receives the fix via monkey-patch in that overlay,
so the frontend does NOT need to change which URL it calls.

Routes:
  GET  /api/v1/tts/diag           — structured health report
  POST /api/v1/tts/diag/translate — test EN→MA translation only
  POST /api/v1/tts/v2             — same contract as /tts but returns
                                    structured JSON errors instead of a
                                    blanket 500 on pipeline failure.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from src.services.tts_mandinka_fix import (
    MandinkaTTSError,
    probe,
    synthesize_wav,
    synthesize_ogg,
)

log = logging.getLogger("tts_mandinka_routes")

router = APIRouter(tags=["tts-mandinka"])


class TTSv2Request(BaseModel):
    text: str
    lang: str | None = "ma"
    source_lang: str | None = "en"
    fmt: str | None = "wav"  # "wav" | "ogg"


class TranslateProbeRequest(BaseModel):
    text: str
    source: str | None = "en"
    target: str | None = "ma"


@router.get("/tts/diag")
async def tts_diag():
    """Aggregate health — translator, MMS container, env flags. Use this
    FIRST when debugging: it tells you which hop is down."""
    return await probe()


@router.post("/tts/diag/translate")
async def tts_diag_translate(req: TranslateProbeRequest):
    """Translate only — no synthesis. Confirms the translator LLM is
    reachable and producing Mandinka. If this returns input unchanged,
    your OPENAI_API_KEY / Gemma endpoint is the problem, not MMS."""
    try:
        from src.services.translator import get_translator
        tr = get_translator()
    except Exception as e:
        raise HTTPException(503, f"translator_init_failed: {e}")

    try:
        out = await tr.translate(req.text, source=req.source or "en",
                                 target=req.target or "ma")
    except Exception as e:
        raise HTTPException(502, f"translator_call_failed: {e}")

    return {
        "input":            req.text,
        "output":           out,
        "unchanged":        (out or "").strip() == req.text.strip(),
        "backend":          getattr(tr, "backend", "unknown"),
        "model":            getattr(tr, "model", "unknown"),
    }


@router.post("/tts/v2")
async def tts_v2(req: TTSv2Request):
    """Same contract as /api/v1/tts but returns structured error bodies on
    pipeline failure so the frontend can tell translator-down from
    container-down from empty-text."""
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(400, "empty_text")

    fmt = (req.fmt or "wav").lower()
    synth = synthesize_ogg if fmt == "ogg" else synthesize_wav
    media = "audio/ogg"      if fmt == "ogg" else "audio/wav"

    try:
        audio = await synth(text, lang=req.lang or "ma",
                            source_lang=req.source_lang or "en")
    except MandinkaTTSError as e:
        status = {
            "translator_unavailable":  503,
            "translator_failed":       502,
            "translator_empty":        502,
            "translator_passthrough":  502,
            "mms_failed":              503,
        }.get(e.stage, 500)
        log.warning("tts_v2 failed stage=%s detail=%s", e.stage, e.detail)
        return JSONResponse(
            status_code=status,
            content={"error": e.stage, "detail": e.detail},
        )

    if not audio:
        raise HTTPException(500, "synthesis_returned_empty")
    return Response(content=audio, media_type=media)
