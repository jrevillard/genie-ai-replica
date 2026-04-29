"""Characterization tests for legacy batch translation via the adapter.

The adapter converts between v2's list-based API and legacy's dict-based
API. These tests lock in order preservation, duplicate preservation,
and batch response parsing.
"""
from __future__ import annotations

import pytest

from translation_v2.adapters.legacy import LegacyTranslatorAdapter


class TestListDictConversion:
    @pytest.mark.asyncio
    async def test_empty_list_returns_empty_list(
        self, legacy_translator_with_fakes
    ):
        adapter = LegacyTranslatorAdapter(legacy_translator_with_fakes)
        result = await adapter.translate_batch([], "en", "ma")
        assert result == []
        # No LLM call for empty input
        legacy_translator_with_fakes.client.chat.completions.create.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_batch_preserves_order(self, make_translator_with_response):
        # Legacy batch returns "[N] text" numbered format. Adapter must
        # return a list whose indices match the input order.
        t = make_translator_with_response("[1] one\n[2] two\n[3] three")
        adapter = LegacyTranslatorAdapter(t)

        result = await adapter.translate_batch(
            ["alpha", "beta", "gamma"], "en", "ma"
        )
        assert result == ["one", "two", "three"]

    @pytest.mark.asyncio
    async def test_duplicate_inputs_are_not_collapsed(
        self, make_translator_with_response
    ):
        # Crucial: indexed dict keys ensure dupes don't collapse.
        t = make_translator_with_response("[1] x\n[2] y\n[3] z")
        adapter = LegacyTranslatorAdapter(t)

        result = await adapter.translate_batch(
            ["same", "same", "same"], "en", "ma"
        )
        assert len(result) == 3
        assert result == ["x", "y", "z"]


class TestBatchCacheBehavior:
    @pytest.mark.asyncio
    async def test_all_cache_hits_skip_llm(self, legacy_translator_with_fakes):
        t = legacy_translator_with_fakes
        for text in ("one", "two"):
            t._redis.store[t._cache_key(text, "en", "ma")] = f"cached-{text}"

        adapter = LegacyTranslatorAdapter(t)
        result = await adapter.translate_batch(["one", "two"], "en", "ma")
        assert result == ["cached-one", "cached-two"]
        t.client.chat.completions.create.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_mixed_hits_and_misses(self, make_translator_with_response):
        t = make_translator_with_response("[1] new-two")
        # Pre-populate cache for "one"
        t._redis.store[t._cache_key("one", "en", "ma")] = "cached-one"

        adapter = LegacyTranslatorAdapter(t)
        result = await adapter.translate_batch(["one", "two"], "en", "ma")

        # one comes from cache, two comes from LLM
        assert result == ["cached-one", "new-two"]


class TestBatchSourceEqualsTarget:
    @pytest.mark.asyncio
    async def test_same_lang_returns_input_unchanged(
        self, legacy_translator_with_fakes
    ):
        # Legacy shortcut: translator.py:187–188
        adapter = LegacyTranslatorAdapter(legacy_translator_with_fakes)
        result = await adapter.translate_batch(["a", "b"], "en", "en")
        assert result == ["a", "b"]


class TestBatchEmptyStrings:
    @pytest.mark.asyncio
    async def test_empty_string_in_batch_is_passed_through(
        self, make_translator_with_response
    ):
        # translator.py:194–196 — empty strings are returned as-is, not sent to LLM
        t = make_translator_with_response("[1] hi-ma")
        adapter = LegacyTranslatorAdapter(t)
        result = await adapter.translate_batch(["", "hi"], "en", "ma")
        assert result[0] == ""
        assert result[1] == "hi-ma"


class TestBatchLLMFailureFallback:
    @pytest.mark.asyncio
    async def test_llm_failure_returns_originals_for_misses(
        self, make_translator_with_response
    ):
        from unittest.mock import AsyncMock

        t = make_translator_with_response("unused")
        t.client.chat.completions.create = AsyncMock(side_effect=RuntimeError("down"))

        adapter = LegacyTranslatorAdapter(t)
        # Legacy contract (translator.py:231–236): on LLM failure, return originals
        result = await adapter.translate_batch(["one", "two"], "en", "ma")
        assert result == ["one", "two"]
