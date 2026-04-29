"""Adapter + v2 TranslationMemory integration.

Contract under test: when `USE_V2_TM_CACHE` is OFF the adapter's
behavior is byte-identical to a plain legacy call. When ON, the v2 TM
sits in front of legacy: a hit skips legacy entirely; a miss calls
legacy and writes the result back to TM.
"""
from __future__ import annotations

import pytest

from translation_v2.adapters.legacy import LegacyTranslatorAdapter
from translation_v2.tm import TranslationMemory


class TestFlagOffByteIdentical:
    @pytest.mark.asyncio
    async def test_tm_not_consulted_when_flag_off(
        self, legacy_translator_with_fakes, fake_redis, monkeypatch
    ):
        monkeypatch.setattr("translation_v2.flags.USE_V2_TM_CACHE", False)
        tm = TranslationMemory(redis_client=fake_redis)
        adapter = LegacyTranslatorAdapter(legacy_translator_with_fakes, tm=tm)

        await adapter.translate("hello", "en", "ma")

        # No v2 TM read/write calls (only the legacy setex into same fake_redis
        # from translator's own cache). The v2 keys live under "v2:tm:*".
        v2_keys = [c for c in fake_redis.set_calls if c[0].startswith("v2:tm:")]
        assert v2_keys == []

    @pytest.mark.asyncio
    async def test_without_tm_injected_behaves_as_before(
        self, legacy_translator_with_fakes, monkeypatch
    ):
        # Flag ON but no TM injected → must not blow up
        monkeypatch.setattr("translation_v2.flags.USE_V2_TM_CACHE", True)
        adapter = LegacyTranslatorAdapter(legacy_translator_with_fakes, tm=None)
        out = await adapter.translate("hello", "en", "ma")
        assert out == "Ŋ be kuuraŋo la"


class TestFlagOnHit:
    @pytest.mark.asyncio
    async def test_tm_hit_skips_legacy(
        self, legacy_translator_with_fakes, fake_redis, monkeypatch
    ):
        monkeypatch.setattr("translation_v2.flags.USE_V2_TM_CACHE", True)
        tm = TranslationMemory(redis_client=fake_redis)
        # Pre-populate v2 TM
        await tm.put("hello", "Ŋ be fo (v2)", "en", "ma", "legacy")

        adapter = LegacyTranslatorAdapter(legacy_translator_with_fakes, tm=tm)
        out = await adapter.translate("hello", "en", "ma")

        assert out == "Ŋ be fo (v2)"
        legacy_translator_with_fakes.client.chat.completions.create.assert_not_awaited()


class TestFlagOnMiss:
    @pytest.mark.asyncio
    async def test_tm_miss_calls_legacy_and_writes_back(
        self, legacy_translator_with_fakes, fake_redis, monkeypatch
    ):
        monkeypatch.setattr("translation_v2.flags.USE_V2_TM_CACHE", True)
        tm = TranslationMemory(redis_client=fake_redis)

        adapter = LegacyTranslatorAdapter(legacy_translator_with_fakes, tm=tm)
        out = await adapter.translate("hello", "en", "ma")

        assert out == "Ŋ be kuuraŋo la"
        # v2 TM now contains the translation
        stored = await tm.get("hello", "en", "ma", "legacy")
        assert stored == "Ŋ be kuuraŋo la"

    @pytest.mark.asyncio
    async def test_llm_failure_does_not_write_to_tm(
        self, legacy_translator_with_fakes, fake_redis, monkeypatch
    ):
        from unittest.mock import AsyncMock

        monkeypatch.setattr("translation_v2.flags.USE_V2_TM_CACHE", True)
        t = legacy_translator_with_fakes
        t.client.chat.completions.create = AsyncMock(side_effect=RuntimeError("API down"))
        tm = TranslationMemory(redis_client=fake_redis)

        adapter = LegacyTranslatorAdapter(t, tm=tm)
        out = await adapter.translate("hello", "en", "ma")

        # Legacy returns original text on error — v2 TM must NOT cache that
        assert out == "hello"
        assert await tm.get("hello", "en", "ma", "legacy") is None


class TestFlagOnShortcuts:
    @pytest.mark.asyncio
    async def test_empty_text_does_not_touch_tm(
        self, legacy_translator_with_fakes, fake_redis, monkeypatch
    ):
        monkeypatch.setattr("translation_v2.flags.USE_V2_TM_CACHE", True)
        tm = TranslationMemory(redis_client=fake_redis)
        adapter = LegacyTranslatorAdapter(legacy_translator_with_fakes, tm=tm)

        await adapter.translate("", "en", "ma")
        assert fake_redis.get_calls == []

    @pytest.mark.asyncio
    async def test_same_source_target_does_not_touch_tm(
        self, legacy_translator_with_fakes, fake_redis, monkeypatch
    ):
        monkeypatch.setattr("translation_v2.flags.USE_V2_TM_CACHE", True)
        tm = TranslationMemory(redis_client=fake_redis)
        adapter = LegacyTranslatorAdapter(legacy_translator_with_fakes, tm=tm)

        await adapter.translate("hello", "en", "en")
        assert fake_redis.get_calls == []


class TestBatchStillUsesLegacyCacheOnly:
    @pytest.mark.asyncio
    async def test_batch_does_not_use_v2_tm_in_step_2(
        self, make_translator_with_response, fake_redis, monkeypatch
    ):
        # Step 2 scope: TM wraps single translate only; batch is legacy-only
        # until Step 3 owns batching end-to-end.
        monkeypatch.setattr("translation_v2.flags.USE_V2_TM_CACHE", True)
        t = make_translator_with_response("[1] one\n[2] two")
        tm = TranslationMemory(redis_client=fake_redis)
        adapter = LegacyTranslatorAdapter(t, tm=tm)

        result = await adapter.translate_batch(["a", "b"], "en", "ma")
        assert result == ["one", "two"]
        # No v2 TM writes from batch
        v2_keys = [c for c in fake_redis.set_calls if c[0].startswith("v2:tm:")]
        assert v2_keys == []
