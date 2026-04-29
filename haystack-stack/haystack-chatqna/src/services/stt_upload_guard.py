"""
STT Upload Guard
================

Rejects oversized audio uploads to /api/v1/stt before they hit
whisper-server, preventing queue saturation from runaway client-side
recording bugs.

Background: a frontend bug can submit gigantic audio buffers (e.g. 30+
minutes of accumulated audio) which whisper-small cannot encode within
its timeout. Every queued huge blob blocks subsequent legit calls,
breaking STT for all users until the queue drains. This middleware
short-circuits oversized requests with a 413 before they reach the
STT service.

Limit: 8 MB by default (configurable via STT_MAX_UPLOAD_BYTES env var).
At 16 kHz mono 16-bit PCM that's ~4 minutes of audio; with WebM/Opus
compression it's roughly 30+ minutes of speech -- well above any
realistic single utterance.

Purely additive: no edits to existing routes or services.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from fastapi import FastAPI
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


_DEFAULT_MAX = 8 * 1024 * 1024  # 8 MB


def _resolve_max_bytes(override: Optional[int]) -> int:
    if override and override > 0:
        return override
    env_val = os.getenv("STT_MAX_UPLOAD_BYTES", "").strip()
    if env_val.isdigit():
        v = int(env_val)
        if v > 0:
            return v
    return _DEFAULT_MAX


_DEFAULT_AUDIO_PATHS = (
    "/api/v1/stt",
    "/api/v1/voice-chat",
    "/api/v1/voice-chat-audio",
    "/api/v1/agent/voice-chat",
    "/api/v1/agent/voice-chat-audio",
    "/api/v1/caregiver/voice-chat",
)


def _too_large_response(received: int, cap: int, path: str, kind: str = "header"):
    return JSONResponse(
        status_code=413,
        content={
            "code": "audio_too_large",
            "message": (
                f"Audio upload too large "
                f"({received // 1024} KB). Maximum is "
                f"{cap // 1024} KB. Recorder may be "
                "accumulating an unbounded buffer -- "
                "use shorter utterances or refresh "
                "the page."
            ),
            "max_bytes": cap,
            "received_bytes": received,
            "path": path,
            "rejected_at": kind,
        },
    )


class STTUploadGuardASGI:
    """Pure ASGI middleware that enforces a body-size cap on guarded paths.

    Streams the request body and short-circuits with a 413 the moment the
    accumulated body exceeds `max_bytes`. Works for both Content-Length-
    declared uploads and Transfer-Encoding: chunked uploads (which is what
    browsers' fetch() with FormData actually sends).
    """

    def __init__(self, app, max_bytes: int, paths: tuple):
        self.app = app
        self.max_bytes = max_bytes
        self.paths = set(paths)

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            return await self.app(scope, receive, send)

        path = scope.get("path") or ""
        method = (scope.get("method") or "").upper()
        if not (method == "POST" and path in self.paths):
            return await self.app(scope, receive, send)

        # Layer 1: Content-Length header check
        headers = {k.decode("latin-1").lower(): v.decode("latin-1")
                   for k, v in (scope.get("headers") or [])}
        cl = headers.get("content-length")
        if cl and cl.isdigit():
            n = int(cl)
            if n > self.max_bytes:
                logger.warning(
                    "stt_upload_guard: header-rejected %d-byte audio to %s",
                    n, path,
                )
                return await self._send_413(send, n, path, kind="header")

        # Layer 2: stream counting
        body_total = 0
        rejected = {"flag": False}

        async def receive_counting():
            nonlocal body_total
            if rejected["flag"]:
                return {"type": "http.disconnect"}
            msg = await receive()
            if msg.get("type") == "http.request":
                body_total += len(msg.get("body") or b"")
                if body_total > self.max_bytes:
                    rejected["flag"] = True
                    logger.warning(
                        "stt_upload_guard: stream-rejected at %d bytes to %s",
                        body_total, path,
                    )
            return msg

        sent_response = {"flag": False}

        async def send_intercepting(msg):
            # Suppress downstream response if we already rejected
            if rejected["flag"] and not sent_response["flag"]:
                sent_response["flag"] = True
                await self._send_413(send, body_total, path, kind="stream")
                return
            if rejected["flag"]:
                return
            await send(msg)

        try:
            await self.app(scope, receive_counting, send_intercepting)
        except Exception as e:
            if rejected["flag"]:
                # Downstream barfed because of disconnect -- fine, we've already 413'd
                logger.debug("stt_upload_guard: app raised after reject: %s", e)
            else:
                raise

        # If the handler returned without sending and we rejected, send now
        if rejected["flag"] and not sent_response["flag"]:
            await self._send_413(send, body_total, path, kind="stream")

    async def _send_413(self, send, received: int, path: str, kind: str):
        import json as _json
        body = _json.dumps({
            "code": "audio_too_large",
            "message": (
                f"Audio upload too large ({received // 1024} KB). "
                f"Maximum is {self.max_bytes // 1024} KB. "
                "Recorder may be accumulating an unbounded buffer -- "
                "use shorter utterances or refresh the page."
            ),
            "max_bytes": self.max_bytes,
            "received_bytes": received,
            "path": path,
            "rejected_at": kind,
        }).encode("utf-8")
        await send({
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode("ascii")),
                (b"x-stt-guard-rejected", kind.encode("ascii")),
            ],
        })
        await send({"type": "http.response.body", "body": body})


def install_stt_upload_guard(
    app: FastAPI,
    max_bytes: Optional[int] = None,
    paths: Optional[tuple] = None,
) -> None:
    """Install the STT upload-size guard ASGI middleware on `app`.

    Guards every endpoint that forwards audio to whisper-server. Pure-ASGI
    so it correctly intercepts streamed/chunked bodies (browsers' fetch()
    with FormData often sends Transfer-Encoding: chunked without a
    Content-Length header).
    """
    cap = _resolve_max_bytes(max_bytes)
    guarded_paths = tuple(paths or _DEFAULT_AUDIO_PATHS)

    app.add_middleware(STTUploadGuardASGI, max_bytes=cap, paths=guarded_paths)

    logger.info(
        "stt_upload_guard installed (ASGI 2-layer): %d paths guarded, max_bytes=%d (%.1f MB)",
        len(guarded_paths), cap, cap / 1024 / 1024,
    )


__all__ = ["install_stt_upload_guard"]
