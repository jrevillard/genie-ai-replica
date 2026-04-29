"""
OpenAPI schema recovery patch.

Pre-existing issue: Pydantic 2.12 + FastAPI 0.129 cannot resolve
ForwardRef annotations on Pydantic models defined inside functions
(e.g. reranker_feedback.get_feedback_router has its FeedbackRequest
and CycleRequest classes nested inside the function body, combined
with `from __future__ import annotations` at the module top).

This module is purely additive. It wraps app.openapi() so that:
  1. First it tries the normal generator.
  2. On PydanticUserError, it generates the schema from only the
     routes that successfully introspect, skipping the broken ones.

Result: /docs and /openapi.json work, with the 2 broken reranker
routes silently omitted (they still function over HTTP normally).
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi

logger = logging.getLogger(__name__)


def install_openapi_recovery(app: FastAPI) -> None:
    """Wrap app.openapi() with a fallback that skips broken routes."""

    original_openapi = app.openapi

    def patched_openapi() -> dict:
        if app.openapi_schema:
            return app.openapi_schema
        try:
            schema = original_openapi()
            app.openapi_schema = schema
            return schema
        except Exception as e:
            logger.warning(
                "openapi_recovery: full schema gen failed (%s) -- "
                "falling back to per-route schema",
                type(e).__name__,
            )

        ok_routes = []
        skipped = []
        for r in app.routes:
            try:
                get_openapi(
                    title=app.title,
                    version=app.version,
                    routes=[r],
                )
                ok_routes.append(r)
            except Exception:
                skipped.append(getattr(r, "path", str(r)))

        schema = get_openapi(
            title=app.title,
            version=app.version,
            description=(app.description or "")
            + "\n\nNote: some routes were skipped from this schema "
              "due to a Pydantic/FastAPI ForwardRef compatibility issue. "
              "They remain functional over HTTP.",
            routes=ok_routes,
        )
        if skipped:
            logger.warning(
                "openapi_recovery: skipped %d routes from schema: %s",
                len(skipped), skipped,
            )
        app.openapi_schema = schema
        return schema

    app.openapi = patched_openapi  # type: ignore[method-assign]
    logger.info("openapi_recovery: installed (handles ForwardRef failures)")


__all__ = ["install_openapi_recovery"]
