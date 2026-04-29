"""Shared tests for OpenAI-compatible providers (OpenAI + Gemma).

Both concrete providers inherit from the same base; verifying the base
here covers both — plus a small identity test per concrete class to
lock in their `name` attribute.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from translation_v2.providers._openai_compatible import OpenAICompatibleProvider
from translation_v2.providers.gemma import GemmaProvider
from translation_v2.providers.openai import OpenAIProvider


def _fake_client(content: str) -> MagicMock:
    msg = MagicMock()
    msg.content = content
    choice = MagicMock()
    choice.message = msg
    response = MagicMock()
    response.choices = [choice]

    client = MagicMock()
    client.chat.completions.create = AsyncMock(return_value=response)
    return client


@pytest.fixture
def provider_factory():
    def _make(reply: str, model: str = "test-model") -> OpenAICompatibleProvider:
        return OpenAICompatibleProvider(client=_fake_client(reply), model=model)
    return _make


class TestTranslateSingle:
    @pytest.mark.asyncio
    async def test_basic_translate(self, provider_factory):
        p = provider_factory("Ŋ be fo")
        out = await p.translate("hello", "en", "ma")
        assert out == "Ŋ be fo"

    @pytest.mark.asyncio
    async def test_quote_stripping(self, provider_factory):
        p = provider_factory('"Ŋ be fo"')
        out = await p.translate("hello", "en", "ma")
        assert out == "Ŋ be fo"

    @pytest.mark.asyncio
    async def test_single_quotes_stripped(self, provider_factory):
        p = provider_factory("'Ŋ be fo'")
        out = await p.translate("hello", "en", "ma")
        assert out == "Ŋ be fo"

    @pytest.mark.asyncio
    async def test_empty_text_skips_llm(self, provider_factory):
        p = provider_factory("unused")
        out = await p.translate("", "en", "ma")
        assert out == ""
        p._client.chat.completions.create.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_same_lang_skips_llm(self, provider_factory):
        p = provider_factory("unused")
        out = await p.translate("hello", "en", "en")
        assert out == "hello"
        p._client.chat.completions.create.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_system_prompt_sent(self, provider_factory):
        p = provider_factory("done")
        await p.translate("hi", "en", "ma")
        call = p._client.chat.completions.create
        messages = call.call_args.kwargs["messages"]
        assert messages[0]["role"] == "system"
        assert "English" in messages[0]["content"]
        assert "Mandinka" in messages[0]["content"]

    @pytest.mark.asyncio
    async def test_llm_exception_propagates(self, provider_factory):
        p = provider_factory("done")
        p._client.chat.completions.create = AsyncMock(side_effect=RuntimeError("boom"))
        with pytest.raises(RuntimeError):
            await p.translate("hi", "en", "ma")

    @pytest.mark.asyncio
    async def test_custom_system_prompt_fn(self):
        calls = []

        def fn(source, target):
            calls.append((source, target))
            return "CUSTOM"

        p = OpenAICompatibleProvider(
            client=_fake_client("result"),
            model="m",
            system_prompt_fn=fn,
        )
        await p.translate("hi", "en", "ma")
        assert calls == [("en", "ma")]


class TestTranslateBatch:
    @pytest.mark.asyncio
    async def test_empty_batch_returns_empty(self, provider_factory):
        p = provider_factory("unused")
        out = await p.translate_batch([], "en", "ma")
        assert out == []

    @pytest.mark.asyncio
    async def test_parses_numbered_response(self, provider_factory):
        p = provider_factory("[1] one\n[2] two\n[3] three")
        out = await p.translate_batch(["a", "b", "c"], "en", "ma")
        assert out == ["one", "two", "three"]

    @pytest.mark.asyncio
    async def test_missing_numbers_fall_back_to_original(self, provider_factory):
        p = provider_factory("[1] one\n[3] three")  # number 2 missing
        out = await p.translate_batch(["a", "b", "c"], "en", "ma")
        assert out == ["one", "b", "three"]

    @pytest.mark.asyncio
    async def test_same_lang_returns_inputs(self, provider_factory):
        p = provider_factory("unused")
        out = await p.translate_batch(["a", "b"], "en", "en")
        assert out == ["a", "b"]
        p._client.chat.completions.create.assert_not_awaited()


class TestConcreteProviderNames:
    def test_openai_name(self):
        p = OpenAIProvider(client=_fake_client("x"), model="gpt-4o-mini")
        assert p.name == "openai"

    def test_gemma_name(self):
        p = GemmaProvider(client=_fake_client("x"), model="google/gemma-3-4b-it")
        assert p.name == "gemma"
