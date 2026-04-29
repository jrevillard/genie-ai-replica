"""
Voice Concurrency Limiter
==========================

Caps the number of simultaneous in-flight requests on the audio-handling
endpoints to prevent whisper-server queue buildup when many callers
arrive at once.

When the cap is reached, new requests on guarded paths return 429
("voice_busy") immediately rather than queueing. Combined with the
upstream stt_upload_guard (byte cap), stt_duration_guard (decoded
duration cap), and rate_limiter (per-IP req/min), this is the final
layer that protects whisper-server from thundering-herd arrivals.

Per-worker semantics
--------------------
The counter is per-uvicorn-process (in-memory dict + asyncio.Lock).
With 4 uvicorn workers and VOICE_MAX_CONCURRENT=3, the global ceiling
is 4 * 3 = 12 simultaneous transcriptions. Per-worker counters are
intentional: this limiter is a safety net for bursty arrivals at a
single worker, the rate limiter (Redis-backed, distributed) handles
the global per-IP/global picture.

Why a shared counter across the 6 audio paths
---------------------------------------------
All six paths funnel into the same whisper-server process, so the
real bottleneck is whisper -- not the route. A single shared counter
across stt + voice-chat* + caregiver/voice-chat ensures the limit
reflects whisper's true capacity rather than letting each route
independently saturate.

Pure ASGI middleware -- no edits to existing routes.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Iterable, Optional

from fastapi import FastAPI

logger = logging.getLogger(__name__)


_DEFAULT_MAX_CONCURRENT = 3
_DEFAULT_PATHS = (
    "/api/v1/stt",
    "/api/v1/voice-chat",
    "/api/v1/voice-chat-audio",
    "/api/v1/agent/voice-chat",
    "/api/v1/agent/voice-chat-audio",
    "/api/v1/caregiver/voice-chat",
)


def _resolve_max(override: Optional[int]) -> int:
    if override is not None and override > 0:
        return int(override)
    env_val = os.getenv("VOICE_MAX_CONCURRENT", "").strip()
    if env_val.isdigit():
        v = int(env_val)
        if v > 0:
            return v
    return _DEFAULT_MAX_CONCURRENT


# ──────────────────────────────────────────────────────────────────
#  ASGI middleware
# ──────────────────────────────────────────────────────────────────

class VoiceConcurrencyLimiterASGI:
    """In-process semaphore-style limiter for audio paths.

    A shared counter (`active`) tracks how many guarded requests are
    currently in flight on this worker. New requests check the counter
    under an asyncio lock; if at cap, the request gets 429 with a
    structured `voice_busy` body. Otherwise the counter is incremented,
    the request is processed, and the counter is decremented in `finally`.
    """

    def __init__(
        self,
        app,
        max_concurrent: int,
        paths: Iterable[str],
    ):
        self.app = app
        self.max_concurrent = max_concurrent
        self.paths = set(paths)
        self.active = 0
        self.lock = asyncio.Lock()

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            return await self.app(scope, receive, send)

        path = scope.get("path") or ""
        if path not in self.paths:
            return await self.app(scope, receive, send)

        # Try to grab a slot
        async with self.lock:
            if self.active >= self.max_concurrent:
                logger.info(
                    "voice_concurrency_limiter: REJECTED %s -- %d/%d slots in use",
                    path, self.active, self.max_concurrent,
                )
                # Hold the lock long enough to send the 429 from a stable view
                return await self._send_429(send, path, self.active, self.max_concurrent)
            self.active += 1
            current_after = self.active

        # Wrap send so we can attach concurrency headers to the response
        async def send_with_headers(msg):
            if msg.get("type") == "http.response.start":
                headers = list(msg.get("headers") or [])
                headers.append((b"x-voice-concurrency-active", str(current_after).encode("ascii")))
                headers.append((b"x-voice-concurrency-limit", str(self.max_concurrent).encode("ascii")))
                msg["headers"] = headers
            await send(msg)

        try:
            await self.app(scope, receive, send_with_headers)
        finally:
            async with self.lock:
                self.active = max(0, self.active - 1)

    async def _send_429(self, send, path: str, active: int, limit: int):
        body = json.dumps({
            "code":    "voice_busy",
            "message": (
                f"Voice service is at capacity ({active}/{limit} simultaneous "
                "transcriptions on this worker). Please retry in a few seconds."
            ),
            "active":  active,
            "limit":   limit,
            "path":    path,
            # 1 second is a reasonable backoff; clients can poll and the
            # next finishing request will free a slot.
            "retry_after_seconds": 1,
        }).encode("utf-8")
        await send({
            "type": "http.response.start",
            "status": 429,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode("ascii")),
                (b"retry-after", b"1"),
                (b"x-voice-concurrency-active", str(active).encode("ascii")),
                (b"x-voice-concurrency-limit", str(limit).encode("ascii")),
            ],
        })
        await send({"type": "http.response.body", "body": body})


# ──────────────────────────────────────────────────────────────────
#  INSTALLER
# ──────────────────────────────────────────────────────────────────

def install_voice_concurrency_limiter(
    app: FastAPI,
    max_concurrent: Optional[int] = None,
    paths: Optional[Iterable[str]] = None,
) -> None:
    """Install the voice concurrency limiter ASGI middleware.

    Args:
        app: FastAPI app
        max_concurrent: per-worker cap. Falls back to env VOICE_MAX_CONCURRENT
                        then to 3. With 4 uvicorn workers and the default,
                        global max is 12 concurrent.
        paths: tuple of paths to guard. Defaults to all 6 audio endpoints.
    """
    cap = _resolve_max(max_concurrent)
    guarded_paths = tuple(paths or _DEFAULT_PATHS)

    app.add_middleware(
        VoiceConcurrencyLimiterASGI,
        max_concurrent=cap,
        paths=guarded_paths,
    )

    logger.info(
        "voice_concurrency_limiter installed (per-worker): "
        "max_concurrent=%d, paths=%d (global ceiling = workers * %d)",
        cap, len(guarded_paths), cap,
    )


__all__ = [
    "install_voice_concurrency_limiter",
    "VoiceConcurrencyLimiterASGI",
]
