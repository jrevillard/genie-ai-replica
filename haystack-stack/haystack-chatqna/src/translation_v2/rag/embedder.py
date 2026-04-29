"""Text embedding client.

Targets a TEI (text-embeddings-inference) HTTP service, the same one
the existing haystack-stack uses. Default: http://tei:80 with whatever
model is loaded there. The `V2_RAG_EMBED_MODEL` flag is informational
(TEI only serves one model per container); it's kept so ops can see at
a glance which embedding space the v2 pipeline expects.

Endpoint contract (TEI v1 HuggingFace):
    POST {base_url}/embed
        body:  {"inputs": [str, ...]}
        reply: [[float, ...], [float, ...], ...]
"""
from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)


class TEIEmbedder:
    name: str = "tei"

    def __init__(
        self,
        base_url: str | None = None,
        http_client: Any | None = None,
        timeout_seconds: float = 30.0,
    ) -> None:
        self._base_url = (
            base_url or os.getenv("V2_RAG_EMBED_URL", "http://tei:80")
        ).rstrip("/")
        self._owns_client = http_client is None
        if http_client is None:
            import httpx
            http_client = httpx.AsyncClient(timeout=timeout_seconds)
        self._http = http_client

    async def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        resp = await self._http.post(
            f"{self._base_url}/embed",
            json={"inputs": list(texts)},
        )
        resp.raise_for_status()
        data = resp.json()
        if not isinstance(data, list):
            raise ValueError(
                f"TEI response must be a list, got {type(data).__name__}"
            )
        if len(data) != len(texts):
            raise ValueError(
                f"TEI returned {len(data)} vectors for {len(texts)} inputs"
            )
        for vec in data:
            if not isinstance(vec, list):
                raise ValueError("TEI vector is not a list")
        return data

    async def aclose(self) -> None:
        if self._owns_client and hasattr(self._http, "aclose"):
            await self._http.aclose()
