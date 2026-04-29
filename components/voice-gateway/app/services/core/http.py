# app/services/core/http.py

from __future__ import annotations

from typing import Callable

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.services.core.errors import AppError
from app.services.core.logging import get_logger, set_request_id

log = get_logger("http")


class RequestIdMiddleware(BaseHTTPMiddleware):
    """
    Adds/propagates X-Request-Id for each request.
    If the client sends X-Request-Id, we reuse it; otherwise we generate one.
    """

    async def dispatch(self, request: Request, call_next: Callable):
        rid = request.headers.get("x-request-id")
        rid = set_request_id(rid)

        try:
            response = await call_next(request)
        except Exception:
            log.exception("Unhandled exception")
            raise

        response.headers["X-Request-Id"] = rid
        return response


def app_error_handler(_: Request, exc: AppError) -> JSONResponse:
    """
    Convert known AppError into consistent JSON response.
    """
    return JSONResponse(status_code=exc.status_code, content=exc.to_dict())


def unhandled_exception_handler(_: Request, exc: Exception) -> JSONResponse:
    """
    Fallback for unexpected exceptions.
    """
    log.exception("Unhandled exception", err=str(exc))
    return JSONResponse(
        status_code=500,
        content={"error": "INTERNAL_SERVER_ERROR", "message": "Something went wrong"},
    )
