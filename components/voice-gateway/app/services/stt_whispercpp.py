from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional, List, Sequence

import httpx

from app.services.core.config import settings
from app.services.core.errors import TimeoutError, UpstreamError
from app.services.core.logging import get_logger

log = get_logger("stt_whispercpp")


@dataclass
class STTResult:
    text: str
    raw: Dict[str, Any]
    endpoint: str
    field_name: str


class WhisperCppClient:
    """
    whisper.cpp HTTP client with auto-detection.

    Best practices:
    - Reuses one httpx.AsyncClient (connection pooling)
    - Can force endpoint via env WHISPER_ENDPOINT (optional)
    - Tries common endpoints + common multipart field names (file/audio)
    - Caches the first working combination (endpoint + field)
    """

    CANDIDATE_ENDPOINTS: List[str] = [
        "/inference",
        "/asr",
        "/transcribe",
        "/v1/audio/transcriptions",
    ]

    CANDIDATE_FILE_FIELDS: List[str] = ["file", "audio"]

    def __init__(
        self,
        base_url: str | None = None,
        timeout_s: int | None = None,
        preferred_endpoint: str | None = None,
        client: httpx.AsyncClient | None = None,
    ):
        self.base_url = str(base_url or settings.WHISPER_URL).rstrip("/")
        self.timeout_s = timeout_s or settings.STT_TIMEOUT_S

        # Optional override: let env force endpoint if user knows it later
        env_ep = getattr(settings, "WHISPER_ENDPOINT", None)  # safe if not in config yet
        if isinstance(env_ep, str) and env_ep.strip():
            preferred_endpoint = env_ep.strip()

        self._working_endpoint: Optional[str] = preferred_endpoint
        self._working_field: Optional[str] = None

        # Use injected client if provided (app-level singleton), else create one
        self._client = client or httpx.AsyncClient(timeout=self.timeout_s)

    def _url(self, path: str) -> str:
        if not path.startswith("/"):
            path = "/" + path
        return f"{self.base_url}{path}"

    async def aclose(self) -> None:
        await self._client.aclose()

    async def ping(self) -> dict:
        """
        Best-effort reachability check.
        """
        health_paths = ["/health", "/ready", "/"]
        for p in health_paths:
            try:
                r = await self._client.get(self._url(p), timeout=min(5, self.timeout_s))
                return {"reachable": True, "path": p, "status": r.status_code}
            except httpx.RequestError:
                continue
            except httpx.TimeoutException:
                continue
        return {"reachable": False}

    async def transcribe(
        self,
        audio_bytes: bytes,
        filename: str = "audio.wav",
        content_type: str = "audio/wav",
        language: Optional[str] = None,
        translate: bool = False,
        temperature: float = 0.0,
    ) -> STTResult:
        """
        Sends audio to whisper.cpp server and returns transcription text.
        Auto-detects a working endpoint + multipart field on first call.
        """
        if self._working_endpoint and self._working_field:
            return await self._try(
                endpoint=self._working_endpoint,
                field_name=self._working_field,
                audio_bytes=audio_bytes,
                filename=filename,
                content_type=content_type,
                language=language,
                translate=translate,
                temperature=temperature,
            )

        # If endpoint is forced but field is unknown, only probe fields
        endpoints: Sequence[str] = [self._working_endpoint] if self._working_endpoint else self.CANDIDATE_ENDPOINTS
        fields: Sequence[str] = self.CANDIDATE_FILE_FIELDS

        last_probe: Optional[str] = None
        for ep in endpoints:
            for field in fields:
                try:
                    result = await self._try(
                        endpoint=ep,
                        field_name=field,
                        audio_bytes=audio_bytes,
                        filename=filename,
                        content_type=content_type,
                        language=language,
                        translate=translate,
                        temperature=temperature,
                    )
                    self._working_endpoint = ep
                    self._working_field = field
                    log.info("whisper_route_selected", endpoint=ep, field=field)
                    return result
                except AppProbeError as e:
                    last_probe = str(e)
                    continue

        raise UpstreamError(
            upstream="whisper.cpp",
            message="Could not find a working whisper.cpp endpoint",
            detail={"tried_endpoints": list(endpoints), "tried_fields": list(fields), "last_error": last_probe},
            status_code=502,
        )

    async def _try(
        self,
        endpoint: str,
        field_name: str,
        audio_bytes: bytes,
        filename: str,
        content_type: str,
        language: Optional[str],
        translate: bool,
        temperature: float,
    ) -> STTResult:
        url = self._url(endpoint)

        # Multipart file + optional form fields (most common whisper servers)
        files = {field_name: (filename, audio_bytes, content_type)}
        data: Dict[str, Any] = {"temperature": str(temperature)}
        if language:
            data["language"] = language
        if translate:
            data["translate"] = "true"

        try:
            resp = await self._client.post(url, files=files, data=data)
        except httpx.TimeoutException as e:
            raise TimeoutError(upstream="whisper.cpp", detail=str(e))
        except httpx.RequestError as e:
            raise UpstreamError(
                upstream="whisper.cpp",
                message="Failed to reach whisper.cpp service",
                detail=str(e),
                status_code=502,
            )

        # These typically indicate: wrong endpoint or wrong form field
        if resp.status_code in (404, 405):
            raise AppProbeError(f"{endpoint} not available: {resp.status_code}")
        if resp.status_code in (415, 422):
            raise AppProbeError(f"{endpoint} rejected format/fields ({field_name}): {resp.status_code} {resp.text[:200]}")

        # 400 can happen due to unsupported params, but endpoint might still be correct.
        # We will treat 400 as probe-fail ONLY if it looks like a routing/validation issue.
        if resp.status_code == 400 and ("missing" in resp.text.lower() or "field" in resp.text.lower()):
            raise AppProbeError(f"{endpoint} likely wrong request shape ({field_name}): 400 {resp.text[:200]}")

        if resp.status_code >= 400:
            raise UpstreamError(
                upstream="whisper.cpp",
                message=f"whisper.cpp error {resp.status_code}",
                detail=resp.text[:1000],
                status_code=502,
            )

        payload, text = self._extract_text(resp)

        text = (text or "").strip()
        if not text:
            raise AppProbeError(f"{endpoint} returned empty transcription")

        log.info("stt_done", endpoint=endpoint, field=field_name, chars=len(text))
        return STTResult(text=text, raw=payload, endpoint=endpoint, field_name=field_name)

    def _extract_text(self, resp: httpx.Response) -> tuple[Dict[str, Any], str]:
        """
        Extract transcript from a variety of server response shapes.
        """
        ctype = (resp.headers.get("content-type") or "").lower()

        # JSON response
        if "application/json" in ctype:
            try:
                payload = resp.json()
            except Exception:
                raise UpstreamError(
                    upstream="whisper.cpp",
                    message="Invalid JSON response from whisper.cpp",
                    detail=resp.text[:500],
                    status_code=502,
                )

            # Common keys
            text = (
                payload.get("text")
                or payload.get("transcription")
                or payload.get("result")
                or ""
            )

            # Some wrappers nest it
            if not text and isinstance(payload.get("data"), dict):
                text = payload["data"].get("text") or payload["data"].get("transcription") or ""

            return payload, str(text)

        # Plain-text response fallback
        return {"raw": resp.text}, resp.text or ""


class AppProbeError(Exception):
    """Internal: indicates endpoint/field combo is likely incompatible."""
    pass
