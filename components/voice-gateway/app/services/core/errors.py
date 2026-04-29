# app/services/core/errors.py

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional


@dataclass
class AppError(Exception):
    """
    Base application error that can be converted to JSON by the exception handler.
    """
    message: str
    code: str = "APP_ERROR"
    status_code: int = 500
    detail: Optional[Any] = None

    def to_dict(self) -> dict:
        payload = {"error": self.code, "message": self.message}
        if self.detail is not None:
            payload["detail"] = self.detail
        return payload


class BadRequest(AppError):
    def __init__(self, message: str = "Bad request", detail: Any = None):
        super().__init__(message=message, code="BAD_REQUEST", status_code=400, detail=detail)


class Unauthorized(AppError):
    def __init__(self, message: str = "Unauthorized", detail: Any = None):
        super().__init__(message=message, code="UNAUTHORIZED", status_code=401, detail=detail)


class NotFound(AppError):
    def __init__(self, message: str = "Not found", detail: Any = None):
        super().__init__(message=message, code="NOT_FOUND", status_code=404, detail=detail)


class UpstreamError(AppError):
    def __init__(
        self,
        message: str = "Upstream service error",
        upstream: str = "unknown",
        status_code: int = 502,
        detail: Any = None,
    ):
        super().__init__(
            message=message,
            code="UPSTREAM_ERROR",
            status_code=status_code,
            detail={"upstream": upstream, "info": detail},
        )


class TimeoutError(AppError):
    def __init__(self, message: str = "Request timed out", upstream: str = "unknown", detail: Any = None):
        super().__init__(
            message=message,
            code="TIMEOUT",
            status_code=504,
            detail={"upstream": upstream, "info": detail},
        )
