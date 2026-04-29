"""Tests for the v2 TranslationMemory."""
from __future__ import annotations

import pytest

from translation_v2.tm import TranslationMemory


class TestBasicRoundtrip:
    @pytest.mark.asyncio
    async def test_get_miss_returns_none(self, fake_redis):
        tm = TranslationMemory(redis_client=fake_redis)
        assert await tm.get("hello", "en", "ma", "openai") is None

    @pytest.mark.asyncio
    async def test_put_then_get(self, fake_redis):
        tm = TranslationMemory(redis_client=fake_redis)
        await tm.put("hello", "Ŋ be fo", "en", "ma", "openai")
        got = await tm.get("hello", "en", "ma", "openai")
        assert got == "Ŋ be fo"

    @pytest.mark.asyncio
    async def test_ttl_applied(self, fake_redis):
        tm = TranslationMemory(redis_client=fake_redis, ttl_seconds=123)
        await tm.put("hello", "x", "en", "ma", "openai")
        assert fake_redis.set_calls[0][1] == 123


class TestKeyNamespacing:
    def test_namespace_prefix(self, fake_redis):
        tm = TranslationMemory(redis_client=fake_redis)
        key = tm._key("hello", "en", "ma", "openai", "v1")
        assert key.startswith("v2:tm:openai:v1:en:ma:")

    def test_different_provider_different_key(self, fake_redis):
        tm = TranslationMemory(redis_client=fake_redis)
        k1 = tm._key("hello", "en", "ma", "openai", "v1")
        k2 = tm._key("hello", "en", "ma", "nllb", "v1")
        assert k1 != k2

    def test_different_version_different_key(self, fake_redis):
        tm = TranslationMemory(redis_client=fake_redis)
        k1 = tm._key("hello", "en", "ma", "openai", "v1")
        k2 = tm._key("hello", "en", "ma", "openai", "v2")
        assert k1 != k2

    def test_whitespace_normalized_before_hash(self, fake_redis):
        tm = TranslationMemory(redis_client=fake_redis)
        k1 = tm._key("hello", "en", "ma", "openai", "v1")
        k2 = tm._key("  hello  ", "en", "ma", "openai", "v1")
        assert k1 == k2


class TestRedisFailureIsSwallowed:
    @pytest.mark.asyncio
    async def test_read_error_returns_none(self):
        class BadRedis:
            def get(self, key):
                raise RuntimeError("redis down")

            def setex(self, k, t, v):
                pass

        tm = TranslationMemory(redis_client=BadRedis())
        assert await tm.get("hello", "en", "ma", "openai") is None

    @pytest.mark.asyncio
    async def test_write_error_does_not_raise(self):
        class BadRedis:
            def get(self, k):
                return None

            def setex(self, k, t, v):
                raise RuntimeError("disk full")

        tm = TranslationMemory(redis_client=BadRedis())
        # Should not raise
        await tm.put("hello", "x", "en", "ma", "openai")


class TestNoOpCases:
    @pytest.mark.asyncio
    async def test_empty_text_get_returns_none(self, fake_redis):
        tm = TranslationMemory(redis_client=fake_redis)
        assert await tm.get("", "en", "ma", "openai") is None
        assert fake_redis.get_calls == []

    @pytest.mark.asyncio
    async def test_whitespace_only_get_returns_none(self, fake_redis):
        tm = TranslationMemory(redis_client=fake_redis)
        assert await tm.get("   ", "en", "ma", "openai") is None

    @pytest.mark.asyncio
    async def test_empty_translation_not_written(self, fake_redis):
        tm = TranslationMemory(redis_client=fake_redis)
        await tm.put("hello", "", "en", "ma", "openai")
        assert fake_redis.set_calls == []
