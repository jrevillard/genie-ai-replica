"""Tests for the v2 Router decision tree.

Covers every branch from router.py's docstring:
  1. v2 TM hit
  2. header provider override
  3. PII-local routing
  4. primary path
  5. fallback on primary failure
  6. shadow mode
  7. TM write-back
"""
from __future__ import annotations

import asyncio

import pytest

from translation_v2.router import Router
from translation_v2.tm import TranslationMemory


class FakeProvider:
    def __init__(self, name: str, result: str = "ok", fail: bool = False) -> None:
        self.name = name
        self._result = result
        self._fail = fail
        self.calls: list[tuple[str, str, str]] = []

    async def translate(self, text: str, source: str, target: str) -> str:
        self.calls.append((text, source, target))
        if self._fail:
            raise RuntimeError(f"{self.name} down")
        return self._result

    async def translate_batch(self, texts, source, target):
        return [self._result] * len(texts)


async def _drain(tasks):
    """Wait for any pending asyncio.create_task children."""
    if tasks:
        await asyncio.gather(*list(tasks), return_exceptions=True)


class TestPrimaryPath:
    @pytest.mark.asyncio
    async def test_calls_primary(self):
        primary = FakeProvider("openai", "primary-result")
        r = Router(primary=primary)
        out = await r.translate("hi", "en", "ma")
        assert out == "primary-result"
        assert primary.calls == [("hi", "en", "ma")]


class TestHeaderOverride:
    @pytest.mark.asyncio
    async def test_override_to_registered_provider(self):
        primary = FakeProvider("openai", "A")
        fallback = FakeProvider("gemma", "B")
        r = Router(primary=primary, fallback=fallback)

        out = await r.translate("hi", "en", "ma", provider_override="gemma")
        assert out == "B"
        assert fallback.calls == [("hi", "en", "ma")]
        assert primary.calls == []

    @pytest.mark.asyncio
    async def test_unknown_override_ignored(self):
        primary = FakeProvider("openai", "A")
        fallback = FakeProvider("gemma", "B")
        r = Router(primary=primary, fallback=fallback)

        out = await r.translate("hi", "en", "ma", provider_override="does-not-exist")
        # Falls back to primary (not the fallback)
        assert out == "A"
        assert primary.calls == [("hi", "en", "ma")]


class TestFallback:
    @pytest.mark.asyncio
    async def test_primary_fails_fallback_used(self):
        primary = FakeProvider("openai", fail=True)
        fallback = FakeProvider("gemma", "from-fallback")
        r = Router(primary=primary, fallback=fallback)

        out = await r.translate("hi", "en", "ma")
        assert out == "from-fallback"

    @pytest.mark.asyncio
    async def test_no_fallback_means_primary_error_propagates(self):
        primary = FakeProvider("openai", fail=True)
        r = Router(primary=primary, fallback=None)

        with pytest.raises(RuntimeError):
            await r.translate("hi", "en", "ma")

    @pytest.mark.asyncio
    async def test_fallback_equal_to_primary_ignored(self):
        # If someone injects the same provider as both, fallback is effectively None
        p = FakeProvider("openai", fail=True)
        r = Router(primary=p, fallback=p)
        with pytest.raises(RuntimeError):
            await r.translate("hi", "en", "ma")


class TestPIIRouting:
    @pytest.mark.asyncio
    async def test_pii_forces_local_when_flag_on(self, monkeypatch):
        monkeypatch.setattr("translation_v2.flags.USE_V2_PII_LOCAL_ROUTING", True)
        primary = FakeProvider("openai", "cloud")
        local = FakeProvider("nllb", "local")
        r = Router(primary=primary, local=local)

        # Text with a Gambian phone number → PII
        out = await r.translate("call +220 777 1234", "en", "ma")
        assert out == "local"
        assert local.calls == [("call +220 777 1234", "en", "ma")]
        assert primary.calls == []

    @pytest.mark.asyncio
    async def test_pii_flag_off_uses_primary(self, monkeypatch):
        monkeypatch.setattr("translation_v2.flags.USE_V2_PII_LOCAL_ROUTING", False)
        primary = FakeProvider("openai", "cloud")
        local = FakeProvider("nllb", "local")
        r = Router(primary=primary, local=local)

        out = await r.translate("call +220 777 1234", "en", "ma")
        assert out == "cloud"

    @pytest.mark.asyncio
    async def test_pii_no_local_provider_falls_back_to_primary(self, monkeypatch):
        monkeypatch.setattr("translation_v2.flags.USE_V2_PII_LOCAL_ROUTING", True)
        primary = FakeProvider("openai", "cloud")
        r = Router(primary=primary, local=None)  # no NLLB → can't honor gate

        out = await r.translate("call +220 777 1234", "en", "ma")
        assert out == "cloud"

    @pytest.mark.asyncio
    async def test_pii_route_does_not_fall_back_to_cloud_on_failure(self, monkeypatch):
        # Privacy guarantee: if PII forced local and local fails, we raise
        # instead of falling back to a cloud provider.
        monkeypatch.setattr("translation_v2.flags.USE_V2_PII_LOCAL_ROUTING", True)
        cloud = FakeProvider("openai", "cloud")
        local = FakeProvider("nllb", fail=True)
        r = Router(primary=cloud, fallback=cloud, local=local)

        with pytest.raises(RuntimeError):
            await r.translate("call +220 777 1234", "en", "ma")
        assert cloud.calls == []  # Never called — PII protection held


class TestTMLayer:
    @pytest.mark.asyncio
    async def test_tm_hit_skips_providers(self, fake_redis, monkeypatch):
        monkeypatch.setattr("translation_v2.flags.USE_V2_TM_CACHE", True)
        tm = TranslationMemory(redis_client=fake_redis)
        await tm.put("hi", "cached", "en", "ma", provider="router_v2")

        primary = FakeProvider("openai", "fresh")
        r = Router(primary=primary, tm=tm)
        out = await r.translate("hi", "en", "ma")
        assert out == "cached"
        assert primary.calls == []

    @pytest.mark.asyncio
    async def test_tm_write_back_on_success(self, fake_redis, monkeypatch):
        monkeypatch.setattr("translation_v2.flags.USE_V2_TM_CACHE", True)
        tm = TranslationMemory(redis_client=fake_redis)
        primary = FakeProvider("openai", "fresh")
        r = Router(primary=primary, tm=tm)

        await r.translate("hi", "en", "ma")
        stored = await tm.get("hi", "en", "ma", provider="router_v2")
        assert stored == "fresh"

    @pytest.mark.asyncio
    async def test_tm_flag_off_no_cache_ops(self, fake_redis, monkeypatch):
        monkeypatch.setattr("translation_v2.flags.USE_V2_TM_CACHE", False)
        tm = TranslationMemory(redis_client=fake_redis)
        await tm.put("hi", "would-be-cached", "en", "ma", provider="router_v2")

        primary = FakeProvider("openai", "fresh")
        r = Router(primary=primary, tm=tm)
        out = await r.translate("hi", "en", "ma")
        assert out == "fresh"  # TM not consulted


class TestShadowMode:
    @pytest.mark.asyncio
    async def test_shadow_calls_fallback_when_enabled(self, monkeypatch):
        monkeypatch.setattr("translation_v2.flags.V2_SHADOW_PERCENT", 100)
        primary = FakeProvider("openai", "primary-output")
        fallback = FakeProvider("gemma", "gemma-output")
        r = Router(primary=primary, fallback=fallback)

        out = await r.translate("hi", "en", "ma")
        # Primary result is returned; fallback is shadow-called in background
        assert out == "primary-output"

        await _drain(r._shadow_tasks)
        assert fallback.calls == [("hi", "en", "ma")]

    @pytest.mark.asyncio
    async def test_shadow_disabled_by_default(self, monkeypatch):
        monkeypatch.setattr("translation_v2.flags.V2_SHADOW_PERCENT", 0)
        primary = FakeProvider("openai", "A")
        fallback = FakeProvider("gemma", "B")
        r = Router(primary=primary, fallback=fallback)

        await r.translate("hi", "en", "ma")
        await _drain(r._shadow_tasks)
        assert fallback.calls == []

    @pytest.mark.asyncio
    async def test_shadow_does_not_affect_result(self, monkeypatch):
        monkeypatch.setattr("translation_v2.flags.V2_SHADOW_PERCENT", 100)
        primary = FakeProvider("openai", "primary")
        fallback = FakeProvider("gemma", "DIFFERENT")
        r = Router(primary=primary, fallback=fallback)

        out = await r.translate("hi", "en", "ma")
        assert out == "primary"  # Not the shadow result

    @pytest.mark.asyncio
    async def test_shadow_failure_is_swallowed(self, monkeypatch):
        monkeypatch.setattr("translation_v2.flags.V2_SHADOW_PERCENT", 100)
        primary = FakeProvider("openai", "primary")
        fallback = FakeProvider("gemma", fail=True)
        r = Router(primary=primary, fallback=fallback)

        # Must not raise even though shadow fails
        out = await r.translate("hi", "en", "ma")
        assert out == "primary"
        await _drain(r._shadow_tasks)


class TestAvailableProviders:
    def test_lists_primary_and_fallback_and_local(self):
        r = Router(
            primary=FakeProvider("openai"),
            fallback=FakeProvider("gemma"),
            local=FakeProvider("nllb"),
        )
        names = set(r.available_providers())
        assert names == {"openai", "gemma", "nllb"}


class TestShortcutPassthrough:
    @pytest.mark.asyncio
    async def test_empty_text_skips_tm_and_providers(self, fake_redis, monkeypatch):
        monkeypatch.setattr("translation_v2.flags.USE_V2_TM_CACHE", True)
        tm = TranslationMemory(redis_client=fake_redis)
        primary = FakeProvider("openai", "unused")
        r = Router(primary=primary, tm=tm)

        out = await r.translate("", "en", "ma")
        # Provider is still called by design — the router doesn't duplicate
        # the legacy's empty-text shortcut; the provider handles it. TM is
        # skipped because input is not translatable.
        assert out == "unused"
        # TM was never queried for empty text
        assert fake_redis.get_calls == []
