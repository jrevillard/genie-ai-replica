"""v4.2 Engine C -- NLLB-200 over the sidecar HTTP API.

Matches the prebuilt ``ghcr.io/winstxnhdw/nllb-api`` interface. Falls
back to a ``/health`` probe when ``/api/v4/health`` is unavailable so
self-built fallback images work too. All network calls are bounded by
``NLLB_TIMEOUT_MS`` (default 10s) so a hung sidecar can never hang the
agent's response path.

Availability is cached per process so we don't hammer the sidecar on
every translate. Once we observe a failure we mark the engine
unavailable for ``_AVAILABILITY_TTL_S`` and revert to v3.5 behaviour
until the next probe succeeds.
"""
from __future__ import annotations

import logging
import time
from typing import Any, Dict, Optional

from .. import config

logger = logging.getLogger(__name__)


# Re-probe availability after this many seconds of being marked-down.
# Short enough that a sidecar restart doesn't strand the engine for
# long, slow enough that we don't probe every translation call.
_AVAILABILITY_TTL_S = 30


class NLLBEngine:
    """Stateless wrapper around the NLLB sidecar's HTTP endpoints."""

    def __init__(self) -> None:
        self.api_url = config.NLLB_API_URL.rstrip("/")
        self._timeout_s = max(1.0, config.NLLB_TIMEOUT_MS / 1000.0)
        # None  = never probed,  True/False = last result
        self._available: Optional[bool] = None
        self._available_checked_at: float = 0.0
        self._session = None  # aiohttp.ClientSession, lazily constructed

    # ── lifecycle ────────────────────────────────────────────────────

    async def _get_session(self):
        """Lazy session creation -- avoids importing aiohttp at module
        load time so test fixtures that don't have aiohttp installed
        can still import this module to mock things out."""
        if self._session is None or getattr(self._session, "closed", True):
            try:
                import aiohttp  # type: ignore
            except ImportError:
                logger.warning("v4.2.nllb: aiohttp not installed -- engine disabled")
                return None
            self._session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=self._timeout_s),
            )
        return self._session

    async def close(self) -> None:
        if self._session and not getattr(self._session, "closed", True):
            try:
                await self._session.close()
            except Exception:
                pass

    # ── availability ─────────────────────────────────────────────────

    async def is_available(self, force: bool = False) -> bool:
        """True if the sidecar's health endpoint responded 200 recently."""
        if not config.NLLB_ENABLED:
            return False
        now = time.time()
        if (
            not force
            and self._available is not None
            and now - self._available_checked_at < _AVAILABILITY_TTL_S
        ):
            return bool(self._available)

        session = await self._get_session()
        if session is None:
            self._available = False
            self._available_checked_at = now
            return False

        # Try /api/v4/health first (prebuilt image), then /health (fallback).
        for path in ("/api/v4/health", "/health"):
            try:
                async with session.get(self.api_url + path) as resp:
                    if resp.status == 200:
                        self._available = True
                        self._available_checked_at = now
                        return True
            except Exception as e:
                logger.debug("v4.2.nllb: health probe %s failed: %s", path, e)
        self._available = False
        self._available_checked_at = now
        return False

    # ── translation surface ──────────────────────────────────────────

    async def _translate(self, text: str, source: str, target: str) -> Dict[str, Any]:
        """One-shot translation via /api/v4/translator. Returns a dict
        with text/error and timing -- never raises."""
        started = time.perf_counter()
        out: Dict[str, Any] = {
            "text":         None,
            "source":       source,
            "target":       target,
            "latency_ms":   0,
            "error":        None,
        }
        if not config.NLLB_ENABLED or not (text or "").strip():
            out["error"] = "disabled_or_empty"
            out["latency_ms"] = int((time.perf_counter() - started) * 1000)
            return out

        if not await self.is_available():
            out["error"] = "sidecar_unavailable"
            out["latency_ms"] = int((time.perf_counter() - started) * 1000)
            return out

        session = await self._get_session()
        if session is None:
            out["error"] = "no_aiohttp"
            return out

        try:
            params = {"text": text, "source": source, "target": target}
            async with session.get(self.api_url + "/api/v4/translator", params=params) as resp:
                if resp.status != 200:
                    out["error"] = f"http_{resp.status}"
                else:
                    body = await resp.json(content_type=None)
                    # The prebuilt ghcr.io/winstxnhdw/nllb-api image
                    # returns ``{"result": "..."}``. Older self-built
                    # forks have used ``{"text": "..."}``. Accept either
                    # so a sidecar swap doesn't silently produce empty
                    # translations downstream.
                    translated = ""
                    if isinstance(body, dict):
                        translated = (body.get("result") or body.get("text") or "")
                    if translated.strip():
                        out["text"] = translated.strip()
                    else:
                        out["error"] = "empty_response"
        except Exception as e:
            # Mark down on connection error so we don't loop on a dead sidecar.
            self._available = False
            self._available_checked_at = time.time()
            out["error"] = f"{type(e).__name__}: {str(e)[:120]}"
            logger.debug("v4.2.nllb: translate failed: %s", e)

        out["latency_ms"] = int((time.perf_counter() - started) * 1000)
        return out

    async def translate_to_bambara(self, english_text: str) -> Dict[str, Any]:
        """English -> Bambara. Stage 3 adapts the Bambara to Mandinka."""
        result = await self._translate(english_text, "eng_Latn", "bam_Latn")
        return {
            "bambara_text":     result.get("text"),
            "confidence":       0.75 if result.get("text") else 0.0,
            "latency_ms":       result.get("latency_ms", 0),
            "engine":           "nllb-200-distilled-600M",
            "source_lang":      "eng_Latn",
            "target_lang":      "bam_Latn",
            "error":            result.get("error"),
        }

    async def translate_bambara_to_english(self, bambara_text: str) -> Dict[str, Any]:
        """Bambara -> English. Used by Stage 4 for cross-model back-translation
        (Mandinka shares ~65% vocabulary with Bambara, so the round-trip
        catches negation flips and dropped numbers even though it's lossy)."""
        result = await self._translate(bambara_text, "bam_Latn", "eng_Latn")
        return {
            "english_text":     result.get("text"),
            "confidence":       0.70 if result.get("text") else 0.0,
            "latency_ms":       result.get("latency_ms", 0),
            "error":            result.get("error"),
        }
