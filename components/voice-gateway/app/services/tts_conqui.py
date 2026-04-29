# app/services/tts_coqui.py

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional

import httpx

from app.services.core.config import settings
from app.services.core.errors import TimeoutError, UpstreamError, BadRequest
from app.services.core.logging import get_logger

log = get_logger("tts_coqui")


@dataclass
class TTSResult:
    audio_bytes: bytes
    content_type: str
    raw: Dict[str, Any]
    endpoint: str


class CoquiTTSClient:
    """
    Coqui TTS server client with auto-detection.

    The default Coqui TTS server (/api/tts) expects query parameters, not JSON.
    Other server variants may use JSON body. We try both.
    """

    # Order matters: try query-param style first (default Coqui), then JSON
    CANDIDATE_STRATEGIES = [
        # (endpoint, style)
        ("/api/tts", "query"),
        ("/api/tts", "json"),
        ("/tts", "query"),
        ("/tts", "json"),
        ("/synthesize", "json"),
    ]

    def __init__(self, base_url: str | None = None, timeout_s: int | None = None):
        self.base_url = str(base_url or settings.TTS_URL).rstrip("/")
        self.timeout_s = timeout_s or settings.TTS_TIMEOUT_S
        self._client = httpx.AsyncClient(timeout=self.timeout_s)
        self._working_strategy = None  # cache: (endpoint, style)

    def _url(self, path: str) -> str:
        if not path.startswith("/"):
            path = "/" + path
        return f"{self.base_url}{path}"

    async def aclose(self) -> None:
        await self._client.aclose()

    async def synthesize(
        self,
        text: str,
        speaker: Optional[str] = None,
        language: Optional[str] = None,
    ) -> TTSResult:
        if not text or not text.strip():
            raise BadRequest("text is required for TTS")

        text = text.strip()

        # Use cached strategy if available
        if self._working_strategy:
            ep, style = self._working_strategy
            return await self._try_endpoint(ep, style, text, speaker, language)

        # Probe all strategies
        last_err: Optional[str] = None
        for ep, style in self.CANDIDATE_STRATEGIES:
            try:
                result = await self._try_endpoint(ep, style, text, speaker, language)
                self._working_strategy = (ep, style)
                log.info("tts_route_selected", endpoint=ep, style=style)
                return result
            except AppProbeError as e:
                last_err = str(e)
                continue

        raise UpstreamError(
            upstream="coqui-tts",
            message="Could not find a working Coqui TTS endpoint",
            detail={
                "tried": [(ep, style) for ep, style in self.CANDIDATE_STRATEGIES],
                "last_error": last_err,
            },
            status_code=502,
        )

    async def _try_endpoint(
        self,
        endpoint: str,
        style: str,
        text: str,
        speaker: Optional[str],
        language: Optional[str],
    ) -> TTSResult:
        url = self._url(endpoint)

        try:
            if style == "query":
                # Coqui default: GET or POST with query params
                params: Dict[str, str] = {"text": text}
                if speaker:
                    params["speaker_id"] = speaker
                if language:
                    params["language_id"] = language
                resp = await self._client.get(url, params=params)
            else:
                # JSON body style
                body: Dict[str, Any] = {"text": text}
                if speaker:
                    body["speaker"] = speaker
                if language:
                    body["language"] = language
                resp = await self._client.post(url, json=body)
        except httpx.TimeoutException as e:
            raise TimeoutError(upstream="coqui-tts", detail=str(e))
        except httpx.RequestError as e:
            raise UpstreamError(
                upstream="coqui-tts",
                message="Failed to reach Coqui TTS",
                detail=str(e),
            )

        # Wrong endpoint
        if resp.status_code in (404, 405):
            raise AppProbeError(f"{endpoint} ({style}) not available: {resp.status_code}")

        if resp.status_code >= 400:
            # 500 with query style likely means wrong format, try next
            if resp.status_code == 500:
                raise AppProbeError(
                    f"{endpoint} ({style}) returned 500: {resp.text[:200]}"
                )
            raise UpstreamError(
                upstream="coqui-tts",
                message=f"Coqui TTS error {resp.status_code}",
                detail=resp.text[:1000],
                status_code=502,
            )

        ctype = (resp.headers.get("content-type") or "").lower()

        # Raw audio response (most common for Coqui)
        if "audio" in ctype or "application/octet-stream" in ctype:
            audio = resp.content
            if not audio:
                raise AppProbeError(f"{endpoint} ({style}) returned empty audio")
            log.info(
                "tts_synthesized",
                endpoint=endpoint,
                style=style,
                bytes=len(audio),
                content_type=ctype,
            )
            return TTSResult(
                audio_bytes=audio,
                content_type=ctype or "audio/wav",
                raw={},
                endpoint=endpoint,
            )

        # JSON response (some wrappers)
        if "application/json" in ctype:
            try:
                payload = resp.json()
            except Exception:
                raise AppProbeError(
                    f"{endpoint} ({style}) returned non-audio, non-json response"
                )

            audio_url = payload.get("audio_url") or payload.get("url")
            if audio_url:
                audio_resp = await self._client.get(audio_url)
                if audio_resp.status_code >= 400:
                    raise UpstreamError(
                        upstream="coqui-tts",
                        message="Failed to fetch audio_url",
                        detail=audio_resp.text,
                    )
                return TTSResult(
                    audio_bytes=audio_resp.content,
                    content_type=(
                        audio_resp.headers.get("content-type") or "audio/wav"
                    ),
                    raw=payload,
                    endpoint=endpoint,
                )

            raise AppProbeError(
                f"{endpoint} ({style}) returned json but no audio_url"
            )

        raise AppProbeError(
            f"{endpoint} ({style}) returned unsupported content-type: {ctype}"
        )


class AppProbeError(Exception):
    pass