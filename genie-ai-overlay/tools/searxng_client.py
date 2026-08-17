# Copyright (C) 2026 ITU
# SPDX-License-Identifier: Apache-2.0
"""Pluggable search backend — SearXNG by default (FR16, FR18).

SearXNG is consumed **purely over its HTTP JSON API, as an unmodified upstream Docker
image**. That is load-bearing: SearXNG is AGPL-3.0, and NFR26 permits AGPL solely for
"unmodified API-consumed services". Do not patch the image, do not vendor its source,
do not import its code. It is the only AGPL component in SST, and the exception only
holds while consumption stays arm's-length. Legal sign-off is tracked as OQ-SST-5.

The call is synchronous on the request path (Decision 6) with an ``httpx.AsyncClient``,
and must return inside NFR1's 2-second P95 budget *including* the mandatory PII
redaction that wraps it.

Backend selection is behind :class:`SearchBackend` so an alternate provider can be
substituted without touching the tool surface (FR18).
"""

from __future__ import annotations

import logging
import os
from abc import ABC, abstractmethod

from tools.schemas import CitationSourceType, ToolResult

logger = logging.getLogger(__name__)

DEFAULT_SEARXNG_URL = "http://searxng:8080"


class SearchBackendError(Exception):
    """The backend was unreachable or returned an unusable response.

    Raised rather than returning an empty list, so the governance pipeline can
    distinguish "the backend is broken" (trip the breaker) from "the backend found
    nothing" (a legitimate empty result). Conflating the two would mean a genuinely
    empty web for a niche query slowly opens the circuit.
    """


class SearchBackend(ABC):
    """A web-search provider (FR18)."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Backend identifier, used in logs and span attributes."""

    @abstractmethod
    async def search(self, query: str, limit: int = 10) -> list[ToolResult]:
        """Return up to *limit* results for *query*.

        Raises:
            SearchBackendError: transport failure, non-2xx, or unparseable body.
        """


class SearxngBackend(SearchBackend):
    """SearXNG over its JSON API (FR16 — the default backend).

    Requires ``json`` in the instance's ``search.formats`` setting; a stock SearXNG
    image ships with only ``html`` enabled and will answer with 403, which surfaces
    here as :class:`SearchBackendError`. The deployed ``searxng`` service sets this.
    """

    def __init__(
        self,
        base_url: str | None = None,
        timeout_seconds: float = 1.5,
        language: str = "auto",
        safesearch: int = 1,
    ) -> None:
        # Timeout defaults below the 2 s NFR1 budget on purpose: redaction, fusion, and
        # the audit write all have to fit in the same envelope after the search returns.
        self._base_url = (base_url or os.getenv("SEARXNG_URL", DEFAULT_SEARXNG_URL)).rstrip("/")
        self._timeout = timeout_seconds
        self._language = language
        self._safesearch = safesearch

    @property
    def name(self) -> str:
        return "searxng"

    async def search(self, query: str, limit: int = 10) -> list[ToolResult]:
        if not query or not query.strip():
            return []

        import httpx

        params = {
            "q": query.strip(),
            "format": "json",
            "language": self._language,
            "safesearch": str(self._safesearch),
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.get(f"{self._base_url}/search", params=params)
                response.raise_for_status()
                payload = response.json()
        except Exception as exc:
            raise SearchBackendError(f"SearXNG query failed against {self._base_url}: {exc}") from exc

        raw = payload.get("results")
        if raw is None:
            raise SearchBackendError("SearXNG response has no 'results' key — is format=json enabled?")

        return [r for r in (self._to_result(item, i, len(raw)) for i, item in enumerate(raw[:limit])) if r]

    @staticmethod
    def _to_result(item: dict, index: int, total: int) -> ToolResult | None:
        """Map one SearXNG hit into the normalized shape, or ``None`` if unusable.

        SearXNG's ``score`` is an unbounded engine-agreement number, not a 0-1
        relevance value, so it cannot be used as a confidence directly. When present we
        keep its *ordering* by normalizing on rank instead: position 0 scores highest,
        decaying linearly. That keeps :class:`ToolResult.score` comparable with the
        RAG retriever's cosine scores, which fusion needs (FR19).
        """
        url = (item.get("url") or "").strip()
        content = (item.get("content") or "").strip()
        if not url or not content:
            # A hit with no snippet cannot be fused into an LLM prompt and cannot be
            # meaningfully cited, so it is dropped rather than padded.
            return None
        rank_score = 1.0 - (index / max(total, 1)) * 0.5  # 1.0 → 0.5 across the page
        return ToolResult(
            content=content,
            url=url,
            title=(item.get("title") or "").strip(),
            score=round(rank_score, 4),
            source_type=CitationSourceType.WEB_SEARCH,
        )


def build_backend(impl: str | None = None) -> SearchBackend:
    """Construct the configured search backend (FR16, FR18).

    Args:
        impl: Override for ``SEARCH_BACKEND``. Only ``searxng`` ships today.

    Raises:
        SearchBackendError: unrecognized backend name. Failing loudly beats silently
            falling back to SearXNG, which would hide a typo in a deployment's config.
    """
    value = (impl if impl is not None else os.getenv("SEARCH_BACKEND", "searxng")).strip().lower()
    if value == "searxng":
        return SearxngBackend()
    raise SearchBackendError(f"Unrecognized SEARCH_BACKEND={value!r}. Only 'searxng' is implemented.")
