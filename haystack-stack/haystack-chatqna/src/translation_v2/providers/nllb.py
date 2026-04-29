"""NLLB-200 provider — v2 implementation.

Hits a separate HTTP container serving NLLB-200 (seq2seq model, so
HuggingFace transformers + FastAPI is the expected deployment —
vLLM does not support seq2seq). Contract:

  POST {base_url}/translate
      body:  {"text": "...", "source": "eng_Latn", "target": "mnk_Latn"}
      reply: {"translation": "..."}

  POST {base_url}/translate_batch
      body:  {"texts": [...], "source": "eng_Latn", "target": "mnk_Latn"}
      reply: {"translations": [...]}

NLLB-specific language codes are mapped from the short codes the rest
of the pipeline uses (`en` → `eng_Latn`, `ma`/`mnk` → `mnk_Latn`).

The container itself is **not** deployed as part of this step — the
deployment conversation is Step 3.5. Until the container is live,
calls raise and the router falls through to its fallback.
"""
from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)


_LANG_CODE_MAP: dict[str, str] = {
    "en": "eng_Latn",
    "eng": "eng_Latn",
    "ma": "mnk_Latn",
    "mnk": "mnk_Latn",
}


def _nllb_code(short: str) -> str:
    return _LANG_CODE_MAP.get(short, short)


class NLLBProvider:
    name = "nllb"

    def __init__(
        self,
        http_client: Any | None = None,
        base_url: str | None = None,
        timeout_seconds: float = 30.0,
    ) -> None:
        self._base_url = (
            base_url or os.getenv("NLLB_BASE_URL", "http://nllb-mnk:5600")
        ).rstrip("/")
        self._owns_client = http_client is None
        if http_client is None:
            import httpx
            http_client = httpx.AsyncClient(timeout=timeout_seconds)
        self._http = http_client

    async def translate(self, text: str, source: str, target: str) -> str:
        if not text or not text.strip() or source == target:
            return text
        payload = {
            "text": text,
            "source": _nllb_code(source),
            "target": _nllb_code(target),
        }
        resp = await self._http.post(f"{self._base_url}/translate", json=payload)
        resp.raise_for_status()
        data = resp.json()
        translation = data.get("translation")
        if not isinstance(translation, str):
            raise ValueError(
                f"NLLB response missing 'translation' string: {data!r}"
            )
        return translation

    async def translate_batch(
        self, texts: list[str], source: str, target: str
    ) -> list[str]:
        if not texts:
            return []
        if source == target:
            return list(texts)
        payload = {
            "texts": list(texts),
            "source": _nllb_code(source),
            "target": _nllb_code(target),
        }
        resp = await self._http.post(
            f"{self._base_url}/translate_batch", json=payload
        )
        resp.raise_for_status()
        data = resp.json()
        translations = data.get("translations")
        if not isinstance(translations, list) or len(translations) != len(texts):
            logger.warning(
                "NLLB batch length mismatch: got %r for %d inputs",
                translations,
                len(texts),
            )
            return list(texts)
        return [t if isinstance(t, str) else src for t, src in zip(translations, texts)]

    async def aclose(self) -> None:
        """Release the underlying HTTP client if we own it."""
        if self._owns_client and hasattr(self._http, "aclose"):
            await self._http.aclose()
