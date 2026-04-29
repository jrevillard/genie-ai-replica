from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import socket

from app.services.core.config import settings
from app.services.core.errors import AppError
from app.services.core.http import (
    RequestIdMiddleware,
    app_error_handler,
    unhandled_exception_handler,
)
from app.services.core.logging import configure_logging, get_logger

from app.api.tts import router as tts_router
from app.api.voice import router as voice_router

log = get_logger("main")


def _cors_origins() -> list[str]:
    origins = list(settings.ALLOWED_ORIGINS or [])
    origins = [o.strip().rstrip("/") for o in origins if o and o.strip()]

    dev_defaults = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]
    for d in dev_defaults:
        if d not in origins:
            origins.append(d)

    return [o for o in origins if o != "*"]


def _assert_dns(host: str):
    try:
        socket.gethostbyname(host)
    except Exception as e:
        raise RuntimeError(f"DNS resolution failed for '{host}': {e}")


def create_app() -> FastAPI:
    configure_logging(settings.LOG_LEVEL)

    app = FastAPI(
        title=settings.APP_NAME,
        version="0.1.0",
        debug=settings.DEBUG,
    )

    app.add_middleware(RequestIdMiddleware)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-Id"],
        max_age=86400,
    )

    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)

    # Health
    @app.get("/health")
    def health():
        return {"ok": True, "service": settings.APP_NAME, "env": settings.ENV}

    # Routers
    app.include_router(tts_router, prefix="/v1", tags=["tts"])
    app.include_router(voice_router, prefix="/v1", tags=["voice"])

    @app.on_event("startup")
    async def startup_checks():
        log.info("startup_config", app=settings.APP_NAME, env=settings.ENV)

        if settings.ENV == "docker":
            log.info("checking_docker_dns")
            _assert_dns("voice-tts")
            _assert_dns("voice-stt")
            log.info("docker_dns_ok")

    return app


app = create_app()