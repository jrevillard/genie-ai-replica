"""Characterization tests for legacy Redis caching behavior.

Per translator.py, the cache:
  - Key format: translate:{backend}:{source}:{target}:{sha1[:16]}
  - TTL: 30 days (30 * 86400 = 2592000 seconds)
  - Read failures are swallowed (warning logged), translation proceeds
  - Write failures are swallowed (warning logged), result still returned

These tests lock those invariants in.
"""
from __future__ import annotations

import pytest

from translation_v2.adapters.legacy import LegacyTranslatorAdapter


class TestCacheHit:
    @pytest.mark.asyncio
    async def test_cache_hit_skips_llm(self, legacy_translator_with_fakes):
        t = legacy_translator_with_fakes
        # Prepopulate cache
        key = t._cache_key("hello", "en", "ma")
        t._redis.store[key] = "Ŋ be fo"

        adapter = LegacyTranslatorAdapter(t)
        out = await adapter.translate("hello", "en", "ma")

        assert out == "Ŋ be fo"
        t.client.chat.completions.create.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_cache_hit_does_not_write_back(self, legacy_translator_with_fakes):
        t = legacy_translator_with_fakes
        key = t._cache_key("hello", "en", "ma")
        t._redis.store[key] = "cached"

        adapter = LegacyTranslatorAdapter(t)
        await adapter.translate("hello", "en", "ma")

        # Only the pre-populated set; no setex call from translate()
        assert t._redis.set_calls == []


class TestCacheMiss:
    @pytest.mark.asyncio
    async def test_cache_miss_calls_llm(self, legacy_translator_with_fakes):
        t = legacy_translator_with_fakes
        adapter = LegacyTranslatorAdapter(t)
        await adapter.translate("hello", "en", "ma")
        t.client.chat.completions.create.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_cache_miss_writes_result_with_30d_ttl(
        self, legacy_translator_with_fakes
    ):
        t = legacy_translator_with_fakes
        adapter = LegacyTranslatorAdapter(t)
        await adapter.translate("hello", "en", "ma")

        assert len(t._redis.set_calls) == 1
        key, ttl, value = t._redis.set_calls[0]
        assert ttl == 30 * 86400
        assert value == "Ŋ be kuuraŋo la"
        assert key == t._cache_key("hello", "en", "ma")


class TestCacheFailureIsSwallowed:
    @pytest.mark.asyncio
    async def test_cache_read_error_falls_through_to_llm(
        self, legacy_translator_class, make_translator_with_response
    ):
        t = make_translator_with_response("translated")

        class BadRedis:
            def get(self, key):
                raise RuntimeError("redis down")

            def setex(self, key, ttl, value):
                pass

        t._redis = BadRedis()
        adapter = LegacyTranslatorAdapter(t)

        # Should not raise — legacy swallows the error
        out = await adapter.translate("hello", "en", "ma")
        assert out == "translated"
        t.client.chat.completions.create.assert_awaited()

    @pytest.mark.asyncio
    async def test_cache_write_error_does_not_break_translate(
        self, make_translator_with_response
    ):
        t = make_translator_with_response("translated")

        class WriteFailRedis:
            def __init__(self):
                self.store = {}

            def get(self, key):
                return None

            def setex(self, key, ttl, value):
                raise RuntimeError("disk full")

        t._redis = WriteFailRedis()
        adapter = LegacyTranslatorAdapter(t)

        # Legacy swallows write errors; result is still returned.
        out = await adapter.translate("hello", "en", "ma")
        assert out == "translated"


class TestCacheKeyNamespacing:
    def test_cache_key_includes_backend(self, legacy_translator_with_fakes):
        t = legacy_translator_with_fakes
        key = t._cache_key("hello", "en", "ma")
        assert key.startswith(f"translate:{t.backend}:en:ma:")

    def test_same_text_different_lang_pair_has_different_key(
        self, legacy_translator_with_fakes
    ):
        t = legacy_translator_with_fakes
        k1 = t._cache_key("hello", "en", "ma")
        k2 = t._cache_key("hello", "ma", "en")
        assert k1 != k2


class TestLLMFailureFallback:
    @pytest.mark.asyncio
    async def test_llm_exception_returns_original_text(
        self, legacy_translator_with_fakes
    ):
        from unittest.mock import AsyncMock

        t = legacy_translator_with_fakes
        t.client.chat.completions.create = AsyncMock(side_effect=RuntimeError("API down"))
        adapter = LegacyTranslatorAdapter(t)

        # Legacy contract (translator.py:165–167): failure returns original text
        out = await adapter.translate("hello", "en", "ma")
        assert out == "hello"

    @pytest.mark.asyncio
    async def test_quoting_is_stripped_from_llm_output(
        self, make_translator_with_response
    ):
        # Per translator.py:164 — strip quotes the model might add
        t = make_translator_with_response('"Ŋ be fo"')
        adapter = LegacyTranslatorAdapter(t)
        out = await adapter.translate("hello", "en", "ma")
        assert out == "Ŋ be fo"
