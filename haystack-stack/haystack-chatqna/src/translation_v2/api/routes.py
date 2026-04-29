"""FastAPI APIRouter for v2 translation endpoints.

Mounted by `main_with_translation_v2.py` under prefix `/api/v2`. The
existing v1 agent_routes router is NOT touched — v1 endpoints remain
byte-compatible.

Endpoints:
  POST /agent/translate   v2 single-text translation (flag-gated)
  GET  /agent/translate/health  flag + provider snapshot

Flag behavior:
  USE_V2_TRANSLATION_PIPELINE=false (default) AND no override header
    → 503 with instructions.
  Either flag ON or header `X-Translation-Pipeline: v2`
    → request routes through the v2 Router.

Per-request provider override:
  Header `X-V2-Provider: <openai|gemma|nllb>` forces that provider for
  the single request, bypassing primary/fallback selection.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import PlainTextResponse

from translation_v2 import flags
from translation_v2.api.bootstrap import get_v2_router
from translation_v2.api.schemas import (
    HealthResponse,
    TranslateRequest,
    TranslateResponse,
)
from translation_v2.observability import log_event, metrics_registry

logger = logging.getLogger(__name__)

router = APIRouter(tags=["translation_v2"])


def _is_enabled(header_override: str | None) -> bool:
    if flags.USE_V2_TRANSLATION_PIPELINE:
        return True
    return (header_override or "").strip().lower() == "v2"


@router.post("/agent/translate", response_model=TranslateResponse)
async def v2_translate(
    req: TranslateRequest,
    x_translation_pipeline: str | None = Header(
        default=None, alias="X-Translation-Pipeline"
    ),
    x_v2_provider: str | None = Header(default=None, alias="X-V2-Provider"),
) -> TranslateResponse:
    if not _is_enabled(x_translation_pipeline):
        raise HTTPException(
            status_code=503,
            detail=(
                "v2 translation pipeline is not enabled. Set "
                "USE_V2_TRANSLATION_PIPELINE=true or send header "
                "'X-Translation-Pipeline: v2'."
            ),
        )

    try:
        v2_router = get_v2_router()
    except RuntimeError as e:
        # Startup-level misconfig (e.g. primary provider unavailable)
        raise HTTPException(status_code=500, detail=str(e)) from e

    try:
        translated = await v2_router.translate(
            req.text,
            req.source,
            req.target,
            provider_override=x_v2_provider,
        )
    except Exception as e:
        log_event(
            "v2_translate_error",
            error=str(e),
            source=req.source,
            target=req.target,
        )
        raise HTTPException(status_code=502, detail=f"translation failed: {e}") from e

    return TranslateResponse(
        translated=translated,
        source=req.source,
        target=req.target,
    )


@router.get("/agent/translate/health", response_model=HealthResponse)
async def v2_health() -> HealthResponse:
    """Snapshot of the v2 pipeline's configuration. Safe to call anytime."""
    try:
        r = get_v2_router()
        available = r.available_providers()
        primary = r.primary.name
        fallback = r.fallback.name if r.fallback else None
        local = r.local.name if r.local else None
    except Exception as e:
        # Surface the startup error in the body so operators don't need to
        # check logs to see why v2 isn't coming up.
        return HealthResponse(
            pipeline_active=False,
            primary_provider="<unavailable>",
            fallback_provider=None,
            local_provider=None,
            flags={**flags.snapshot(), "bootstrap_error": str(e)},
            available_providers=[],
        )
    return HealthResponse(
        pipeline_active=flags.USE_V2_TRANSLATION_PIPELINE,
        primary_provider=primary,
        fallback_provider=fallback,
        local_provider=local,
        flags=flags.snapshot(),
        available_providers=available,
    )


@router.get("/agent/metrics", response_class=PlainTextResponse)
async def v2_metrics() -> str:
    """Prometheus text-format metrics for the v2 pipeline.

    Always accessible — no flag gate. Returns an empty string when no
    metrics have been recorded yet (normal right after boot).
    """
    return metrics_registry().render_prometheus()
