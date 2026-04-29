"""Tests for TEIEmbedder — uses httpx.MockTransport, no real network."""
from __future__ import annotations

import json

import httpx
import pytest

from translation_v2.rag.embedder import TEIEmbedder


def _mock_client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


class TestBasicCall:
    @pytest.mark.asyncio
    async def test_posts_to_embed_endpoint(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["url"] = str(request.url)
            seen["body"] = json.loads(request.content)
            return httpx.Response(200, json=[[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]])

        embedder = TEIEmbedder(http_client=_mock_client(handler), base_url="http://tei:80")
        vecs = await embedder.embed(["a", "b"])
        assert vecs == [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]
        assert seen["url"].endswith("/embed")
        assert seen["body"] == {"inputs": ["a", "b"]}
        await embedder.aclose()

    @pytest.mark.asyncio
    async def test_empty_batch_returns_empty_no_http(self):
        def handler(request):
            raise AssertionError("should not be called")

        e = TEIEmbedder(http_client=_mock_client(handler))
        assert await e.embed([]) == []


class TestBadResponses:
    @pytest.mark.asyncio
    async def test_non_list_response_raises(self):
        def handler(request):
            return httpx.Response(200, json={"oops": "not-a-list"})

        e = TEIEmbedder(http_client=_mock_client(handler))
        with pytest.raises(ValueError):
            await e.embed(["x"])

    @pytest.mark.asyncio
    async def test_length_mismatch_raises(self):
        def handler(request):
            return httpx.Response(200, json=[[0.1, 0.2]])

        e = TEIEmbedder(http_client=_mock_client(handler))
        with pytest.raises(ValueError):
            await e.embed(["one", "two"])

    @pytest.mark.asyncio
    async def test_nested_non_list_raises(self):
        def handler(request):
            return httpx.Response(200, json=[[0.1, 0.2], "not a vector"])

        e = TEIEmbedder(http_client=_mock_client(handler))
        with pytest.raises(ValueError):
            await e.embed(["a", "b"])

    @pytest.mark.asyncio
    async def test_http_error_raises(self):
        def handler(request):
            return httpx.Response(503, json={"detail": "down"})

        e = TEIEmbedder(http_client=_mock_client(handler))
        with pytest.raises(httpx.HTTPStatusError):
            await e.embed(["x"])


class TestBaseUrlHandling:
    def test_trailing_slash_stripped(self):
        e = TEIEmbedder(base_url="http://tei:80/", http_client=_mock_client(lambda r: httpx.Response(200)))
        assert e._base_url == "http://tei:80"
