"""Tests for the NLLB provider.

Uses httpx.MockTransport to avoid real network. Locks in:
  - language code mapping (en → eng_Latn, ma/mnk → mnk_Latn)
  - single translation contract
  - batch translation contract + length-mismatch fallback
  - error propagation on HTTP failure
"""
from __future__ import annotations

import json

import httpx
import pytest

from translation_v2.providers.nllb import NLLBProvider, _nllb_code


class TestLangCodeMapping:
    def test_en_maps_to_eng_latn(self):
        assert _nllb_code("en") == "eng_Latn"

    def test_ma_maps_to_mnk_latn(self):
        assert _nllb_code("ma") == "mnk_Latn"

    def test_mnk_maps_to_mnk_latn(self):
        assert _nllb_code("mnk") == "mnk_Latn"

    def test_unknown_code_passthrough(self):
        assert _nllb_code("zz") == "zz"


def _mock_client(handler):
    transport = httpx.MockTransport(handler)
    return httpx.AsyncClient(transport=transport)


class TestTranslateSingle:
    @pytest.mark.asyncio
    async def test_basic_call(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["url"] = str(request.url)
            seen["body"] = json.loads(request.content)
            return httpx.Response(200, json={"translation": "Ŋ be fo"})

        client = _mock_client(handler)
        p = NLLBProvider(http_client=client, base_url="http://nllb:5600")
        out = await p.translate("hello", "en", "ma")
        assert out == "Ŋ be fo"
        assert seen["url"].endswith("/translate")
        assert seen["body"]["source"] == "eng_Latn"
        assert seen["body"]["target"] == "mnk_Latn"
        assert seen["body"]["text"] == "hello"
        await p.aclose()

    @pytest.mark.asyncio
    async def test_empty_text_no_call(self):
        def handler(request):
            raise AssertionError("should not be called")

        p = NLLBProvider(http_client=_mock_client(handler))
        out = await p.translate("", "en", "ma")
        assert out == ""

    @pytest.mark.asyncio
    async def test_same_lang_no_call(self):
        def handler(request):
            raise AssertionError("should not be called")

        p = NLLBProvider(http_client=_mock_client(handler))
        out = await p.translate("hello", "en", "en")
        assert out == "hello"

    @pytest.mark.asyncio
    async def test_http_error_raises(self):
        def handler(request):
            return httpx.Response(503, json={"detail": "down"})

        p = NLLBProvider(http_client=_mock_client(handler))
        with pytest.raises(httpx.HTTPStatusError):
            await p.translate("hello", "en", "ma")

    @pytest.mark.asyncio
    async def test_missing_translation_key_raises(self):
        def handler(request):
            return httpx.Response(200, json={"unexpected": "shape"})

        p = NLLBProvider(http_client=_mock_client(handler))
        with pytest.raises(ValueError):
            await p.translate("hello", "en", "ma")


class TestTranslateBatch:
    @pytest.mark.asyncio
    async def test_batch_roundtrip(self):
        def handler(request):
            return httpx.Response(
                200,
                json={"translations": ["Ŋ be a", "Ŋ be b"]},
            )

        p = NLLBProvider(http_client=_mock_client(handler))
        out = await p.translate_batch(["a", "b"], "en", "ma")
        assert out == ["Ŋ be a", "Ŋ be b"]

    @pytest.mark.asyncio
    async def test_length_mismatch_falls_back_to_originals(self):
        def handler(request):
            return httpx.Response(
                200,
                json={"translations": ["only one"]},  # input is 2 items
            )

        p = NLLBProvider(http_client=_mock_client(handler))
        out = await p.translate_batch(["a", "b"], "en", "ma")
        assert out == ["a", "b"]

    @pytest.mark.asyncio
    async def test_empty_batch_skips_http(self):
        def handler(request):
            raise AssertionError("should not be called")

        p = NLLBProvider(http_client=_mock_client(handler))
        out = await p.translate_batch([], "en", "ma")
        assert out == []

    @pytest.mark.asyncio
    async def test_name_attribute(self):
        p = NLLBProvider(http_client=_mock_client(lambda r: httpx.Response(200)))
        assert p.name == "nllb"
