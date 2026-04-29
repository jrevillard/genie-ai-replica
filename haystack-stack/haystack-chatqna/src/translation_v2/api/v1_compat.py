"""Middleware: transparently route v1 translate endpoints to v2.

Opt-in. Off by default. Activated in one of two ways:

  1. Environment flag ``USE_V2_FOR_V1_ENDPOINTS=true``      (global)
  2. Per-request header ``X-Translation-Pipeline: v2``      (targeted)

When activated AND the request path is one of the two v1 translate
endpoints, the middleware consumes the request body, calls the v2
Router, and returns a response with the **byte-identical v1 shape**:

  POST /api/v1/agent/translate
      request: { "text", "source", "target" }
      legacy response: { "source", "target", "original", "translated" }
      shim response:   { "source", "target", "original", "translated" }  ← same

  POST /api/v1/agent/translate/batch
      request: { "texts": { key: text, ... }, "source", "target" }
      legacy response: { "source", "target", "translations": { key: text, ... } }
      shim response:   { "source", "target", "translations": { key: text, ... } }  ← same

When the flag is OFF and the header is absent, this middleware is a
pure pass-through — requests reach the existing v1 route handler
untouched.

Why middleware and not a new route? FastAPI keeps the first match;
registering a new route at the same path would be ignored. Middleware
intercepts before routing.

Why call the body "frontend-transparent"? Both the top English/Mandinka
toggle (which calls /translate/batch via autoTranslator) and the
per-message "Mandinka" button (which calls /translate) hit these two
endpoints. Flipping one flag routes both through v2 with no frontend
change. The legacy translator stays callable and is one flag flip away.
"""
from __future__ import annotations

import logging
from typing import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from translation_v2 import flags

logger = logging.getLogger(__name__)

_SUPPORTED_LANGS: frozenset[str] = frozenset({"en", "ma"})
_SINGLE_PATH: str = "/api/v1/agent/translate"
_BATCH_PATH: str = "/api/v1/agent/translate/batch"


def _v2_opt_in(request: Request) -> bool:
    if flags.USE_V2_FOR_V1_ENDPOINTS:
        return True
    header = request.headers.get("x-translation-pipeline") or ""
    return header.strip().lower() == "v2"


class V1ToV2CompatMiddleware(BaseHTTPMiddleware):
    """Transparently route the two v1 translate endpoints to v2."""

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        if request.method != "POST" or not _v2_opt_in(request):
            return await call_next(request)
        path = request.url.path
        if path == _SINGLE_PATH:
            return await self._handle_single(request)
        if path == _BATCH_PATH:
            return await self._handle_batch(request)
        return await call_next(request)

    @staticmethod
    async def _parse_json(request: Request) -> tuple[dict | None, JSONResponse | None]:
        try:
            body = await request.json()
        except Exception as e:
            return None, JSONResponse(
                {"detail": f"invalid JSON: {e}"}, status_code=400
            )
        if not isinstance(body, dict):
            return None, JSONResponse(
                {"detail": "request body must be a JSON object"},
                status_code=400,
            )
        return body, None

    async def _handle_single(self, request: Request) -> Response:
        body, err = await self._parse_json(request)
        if err is not None:
            return err
        assert body is not None

        text = body.get("text", "")
        source = body.get("source", "en")
        target = body.get("target", "ma")

        if source not in _SUPPORTED_LANGS or target not in _SUPPORTED_LANGS:
            # Mirror legacy 400
            return JSONResponse({"detail": "Unsupported language"}, status_code=400)

        try:
            from translation_v2.api.bootstrap import get_v2_router
            router = get_v2_router()
            translated = await router.translate(text, source, target)
        except Exception as e:
            logger.exception("v1→v2 single shim failed")
            return JSONResponse(
                {"detail": f"v2 translation failed: {e}"}, status_code=502
            )

        return JSONResponse(
            {
                "source": source,
                "target": target,
                "original": text,
                "translated": translated,
            }
        )

    async def _handle_batch(self, request: Request) -> Response:
        body, err = await self._parse_json(request)
        if err is not None:
            return err
        assert body is not None

        texts = body.get("texts") or {}
        source = body.get("source", "en")
        target = body.get("target", "ma")

        if source not in _SUPPORTED_LANGS or target not in _SUPPORTED_LANGS:
            return JSONResponse({"detail": "Unsupported language"}, status_code=400)
        if not isinstance(texts, dict):
            return JSONResponse(
                {"detail": "texts must be an object {key: text}"},
                status_code=400,
            )

        try:
            from translation_v2.api.bootstrap import get_v2_router
            router = get_v2_router()
            translations: dict[str, str] = {}
            for key, value in texts.items():
                if not isinstance(value, str) or not value.strip() or source == target:
                    translations[key] = value if isinstance(value, str) else ""
                    continue
                translations[key] = await router.translate(value, source, target)
        except Exception as e:
            logger.exception("v1→v2 batch shim failed")
            return JSONResponse(
                {"detail": f"v2 batch translation failed: {e}"},
                status_code=502,
            )

        return JSONResponse(
            {
                "source": source,
                "target": target,
                "translations": translations,
            }
        )
