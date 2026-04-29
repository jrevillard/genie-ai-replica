# app/services/core/logging.py

from __future__ import annotations

import logging
import sys
import uuid
from contextvars import ContextVar

import structlog

_request_id_ctx: ContextVar[str] = ContextVar("request_id", default="")


def set_request_id(value: str | None = None) -> str:
    """
    Store request_id in a contextvar so logs can include it.
    """
    rid = value or str(uuid.uuid4())
    _request_id_ctx.set(rid)
    structlog.contextvars.bind_contextvars(request_id=rid)
    return rid


def get_request_id() -> str:
    return _request_id_ctx.get() or ""


def configure_logging(level: str = "INFO") -> None:
    """
    Configure stdlib logging + structlog JSON output.
    """
    lvl = getattr(logging, level.upper(), logging.INFO)
    logging.basicConfig(stream=sys.stdout, format="%(message)s", level=lvl)

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(lvl),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str = "voice-gateway"):
    return structlog.get_logger(name)
