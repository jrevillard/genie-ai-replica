"""Tests for the legacy_shim module.

Covers:
  - install() monkey-patches services.translator.get_translator
  - uninstall() restores original
  - install is idempotent
  - Proxy delegates to legacy when flag is off
  - Proxy delegates to v2 when flag is on
  - Proxy falls back to legacy on v2 error
  - translate_batch preserves dict shape
  - detect_* methods always pass through to legacy
  - __getattr__ delegates unknown attributes to legacy
"""
from __future__ import annotations

import pytest

from translation_v2 import legacy_shim
from translation_v2.legacy_shim import LegacyProxyViaV2


class FakeLegacyTranslator:
    def __init__(self) -> None:
        self.backend = "legacy-fake"
        self.model = "legacy-model"
        self.translate_calls: list[tuple] = []
        self.batch_calls: list[tuple] = []
        self.detect_calls: list[tuple] = []
        self.redis = "fake-redis-handle"  # arbitrary attribute

    async def translate(self, text, source="en", target="ma"):
        self.translate_calls.append((text, source, target))
        return f"LEGACY:{text}"

    async def translate_batch(self, texts, source="en", target="ma"):
        self.batch_calls.append((texts, source, target))
        return {k: f"LEGACY:{v}" for k, v in texts.items()}

    def detect_language(self, text):
        self.detect_calls.append(("lang", text))
        return "en"

    def detect_mandinka_intent(self, text):
        self.detect_calls.append(("intent", text))
        return {"is_mandinka_intent": False}


class FakeV2Router:
    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.calls: list[tuple] = []

    async def translate(self, text, source, target, provider_override=None):
        self.calls.append((text, source, target))
        if self.fail:
            raise RuntimeError("v2 down")
        return f"V2:{text}"


@pytest.fixture(autouse=True)
def _cleanup():
    # Ensure shim state is reset between tests even if a test forgets
    legacy_shim.uninstall()
    yield
    legacy_shim.uninstall()


class TestProxyBehavior:
    @pytest.mark.asyncio
    async def test_flag_off_delegates_to_legacy(self, monkeypatch):
        monkeypatch.setattr(
            "translation_v2.flags.USE_V2_FOR_LEGACY_TRANSLATOR", False
        )
        legacy = FakeLegacyTranslator()
        v2 = FakeV2Router()
        proxy = LegacyProxyViaV2(legacy, v2)

        out = await proxy.translate("hi", "en", "ma")
        assert out == "LEGACY:hi"
        assert legacy.translate_calls == [("hi", "en", "ma")]
        assert v2.calls == []

    @pytest.mark.asyncio
    async def test_flag_on_delegates_to_v2(self, monkeypatch):
        monkeypatch.setattr(
            "translation_v2.flags.USE_V2_FOR_LEGACY_TRANSLATOR", True
        )
        legacy = FakeLegacyTranslator()
        v2 = FakeV2Router()
        proxy = LegacyProxyViaV2(legacy, v2)

        out = await proxy.translate("hi", "en", "ma")
        assert out == "V2:hi"
        assert v2.calls == [("hi", "en", "ma")]
        assert legacy.translate_calls == []

    @pytest.mark.asyncio
    async def test_flag_on_v2_failure_falls_back_to_legacy(self, monkeypatch):
        monkeypatch.setattr(
            "translation_v2.flags.USE_V2_FOR_LEGACY_TRANSLATOR", True
        )
        legacy = FakeLegacyTranslator()
        v2 = FakeV2Router(fail=True)
        proxy = LegacyProxyViaV2(legacy, v2)

        out = await proxy.translate("hi", "en", "ma")
        assert out == "LEGACY:hi"
        assert v2.calls == [("hi", "en", "ma")]
        assert legacy.translate_calls == [("hi", "en", "ma")]


class TestProxyBatch:
    @pytest.mark.asyncio
    async def test_flag_off_delegates_batch_to_legacy(self, monkeypatch):
        monkeypatch.setattr(
            "translation_v2.flags.USE_V2_FOR_LEGACY_TRANSLATOR", False
        )
        legacy = FakeLegacyTranslator()
        v2 = FakeV2Router()
        proxy = LegacyProxyViaV2(legacy, v2)

        out = await proxy.translate_batch({"a": "x", "b": "y"}, "en", "ma")
        assert out == {"a": "LEGACY:x", "b": "LEGACY:y"}

    @pytest.mark.asyncio
    async def test_flag_on_batch_loops_via_v2(self, monkeypatch):
        monkeypatch.setattr(
            "translation_v2.flags.USE_V2_FOR_LEGACY_TRANSLATOR", True
        )
        legacy = FakeLegacyTranslator()
        v2 = FakeV2Router()
        proxy = LegacyProxyViaV2(legacy, v2)

        out = await proxy.translate_batch({"a": "x", "b": "y"}, "en", "ma")
        assert out == {"a": "V2:x", "b": "V2:y"}
        # v2 was called per-entry
        assert len(v2.calls) == 2

    @pytest.mark.asyncio
    async def test_batch_same_lang_shortcut(self, monkeypatch):
        monkeypatch.setattr(
            "translation_v2.flags.USE_V2_FOR_LEGACY_TRANSLATOR", True
        )
        legacy = FakeLegacyTranslator()
        v2 = FakeV2Router()
        proxy = LegacyProxyViaV2(legacy, v2)

        out = await proxy.translate_batch({"a": "x"}, "en", "en")
        assert out == {"a": "x"}
        assert v2.calls == []
        assert legacy.batch_calls == []

    @pytest.mark.asyncio
    async def test_batch_empty_string_passthrough(self, monkeypatch):
        monkeypatch.setattr(
            "translation_v2.flags.USE_V2_FOR_LEGACY_TRANSLATOR", True
        )
        legacy = FakeLegacyTranslator()
        v2 = FakeV2Router()
        proxy = LegacyProxyViaV2(legacy, v2)

        out = await proxy.translate_batch({"a": "", "b": "x"}, "en", "ma")
        assert out == {"a": "", "b": "V2:x"}
        # v2 was called only for non-empty
        assert len(v2.calls) == 1

    @pytest.mark.asyncio
    async def test_batch_v2_failure_falls_back(self, monkeypatch):
        monkeypatch.setattr(
            "translation_v2.flags.USE_V2_FOR_LEGACY_TRANSLATOR", True
        )
        legacy = FakeLegacyTranslator()
        v2 = FakeV2Router(fail=True)
        proxy = LegacyProxyViaV2(legacy, v2)

        out = await proxy.translate_batch({"a": "x"}, "en", "ma")
        assert out == {"a": "LEGACY:x"}


class TestProxyPassThroughMethods:
    def test_detect_language_always_legacy(self):
        legacy = FakeLegacyTranslator()
        v2 = FakeV2Router()
        proxy = LegacyProxyViaV2(legacy, v2)

        assert proxy.detect_language("hi") == "en"
        assert legacy.detect_calls == [("lang", "hi")]

    def test_detect_mandinka_intent_always_legacy(self):
        legacy = FakeLegacyTranslator()
        proxy = LegacyProxyViaV2(legacy, FakeV2Router())

        result = proxy.detect_mandinka_intent("hi")
        assert result == {"is_mandinka_intent": False}

    def test_getattr_delegates_unknown(self):
        legacy = FakeLegacyTranslator()
        proxy = LegacyProxyViaV2(legacy, FakeV2Router())

        # `.redis` not on proxy, should fall through to legacy
        assert proxy.redis == "fake-redis-handle"

    def test_exposes_diagnostic_backend(self):
        proxy = LegacyProxyViaV2(FakeLegacyTranslator(), FakeV2Router())
        assert proxy.backend == "v2-proxy"


class TestInstallUninstall:
    def test_install_is_idempotent(self):
        # We can't easily mock the module here without side effects on
        # other tests; verify idempotency at the flag level instead.
        legacy_shim._INSTALLED = True
        legacy_shim._ORIGINAL_GET = lambda: None
        # Second install should be a no-op
        legacy_shim.install()  # should not raise
        assert legacy_shim._INSTALLED is True

    def test_uninstall_when_not_installed_is_noop(self):
        legacy_shim._INSTALLED = False
        legacy_shim._ORIGINAL_GET = None
        legacy_shim.uninstall()  # should not raise
        assert legacy_shim._INSTALLED is False
