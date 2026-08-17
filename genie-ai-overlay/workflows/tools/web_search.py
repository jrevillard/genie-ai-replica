# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""SearXNG-backed Web Search LangGraph Tool (Decision 6, FR17-18).

Integrates with a self-hosted SearXNG instance for privacy-preserving web search.
Returns results fused with source citations (FR20).
"""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx
import requests

logger = logging.getLogger(__name__)


class WebSearchError(Exception):
    """Raised when the web search backend fails."""


class SearxngBackend:
    """Pluggable search backend for SearXNG (FR18)."""

    def __init__(self, endpoint: str | None = None):
        self._endpoint = endpoint or os.getenv("SEARXNG_URL", "http://searxng:8080")

    def search_sync(self, query: str, num_results: int = 5) -> list[dict[str, Any]]:
        """Execute a synchronous search query against SearXNG."""
        try:
            response = requests.get(
                f"{self._endpoint}/search",
                params={
                    "q": query,
                    "format": "json",
                    "engines": "google,bing,duckduckgo",
                },
                timeout=10.0,
            )
            response.raise_for_status()
            data = response.json()

            results = []
            for res in data.get("results", [])[:num_results]:
                results.append(
                    {
                        "title": res.get("title", ""),
                        "url": res.get("url", ""),
                        "content": res.get("content", ""),
                    }
                )
            return results
        except Exception as exc:
            logger.error("SearXNG synchronous search failed: %s", exc)
            raise WebSearchError(f"Search backend unavailable: {exc}") from exc

    async def search(self, query: str, num_results: int = 5) -> list[dict[str, Any]]:
        """Execute an asynchronous search query against SearXNG."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{self._endpoint}/search",
                    params={
                        "q": query,
                        "format": "json",
                        "engines": "google,bing,duckduckgo",
                    },
                )
                response.raise_for_status()
                data = response.json()

                results = []
                for res in data.get("results", [])[:num_results]:
                    results.append(
                        {
                            "title": res.get("title", ""),
                            "url": res.get("url", ""),
                            "content": res.get("content", ""),
                        }
                    )
                return results

        except Exception as exc:
            logger.error("SearXNG search failed: %s", exc)
            raise WebSearchError(f"Search backend unavailable: {exc}") from exc


def perform_web_search_sync(parameters: dict[str, Any]) -> str:
    """Synchronous tool entry point."""
    query = parameters.get("query")
    if not query:
        raise ValueError("Missing 'query' parameter for web search")

    backend = SearxngBackend()
    results = backend.search_sync(query)

    if not results:
        return "No web search results found."

    formatted = []
    for i, res in enumerate(results, 1):
        formatted.append(f"[Source {i}]: {res['title']}\nURL: {res['url']}\nSnippet: {res['content']}\n")

    return "\n".join(formatted)


async def perform_web_search(parameters: dict[str, Any]) -> str:
    """LangGraph tool entry point for web search.

    Expected parameters:
        - query (str): The search query.

    Returns:
        A formatted string of search results with citations.
    """
    query = parameters.get("query")
    if not query:
        raise ValueError("Missing 'query' parameter for web search")

    backend = SearxngBackend()
    results = await backend.search(query)

    if not results:
        return "No web search results found."

    # Format results for the LLM
    formatted = []
    for i, res in enumerate(results, 1):
        formatted.append(f"[Source {i}]: {res['title']}\nURL: {res['url']}\nSnippet: {res['content']}\n")

    return "\n".join(formatted)
