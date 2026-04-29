"""Protocol conformance + delegation tests for the legacy adapter."""
from __future__ import annotations

import pytest

from translation_v2.adapters.legacy import LegacyDetector, LegacyTranslatorAdapter
from translation_v2.interfaces import LanguageDetector, TranslationProvider


class TestAdapterProtocolConformance:
    def test_translator_adapter_satisfies_protocol(
        self, legacy_translator_with_fakes
    ):
        adapter = LegacyTranslatorAdapter(legacy_translator_with_fakes)
        assert isinstance(adapter, TranslationProvider)
        assert adapter.name == "legacy"

    def test_detector_satisfies_protocol(self, bare_legacy_translator):
        detector = LegacyDetector(bare_legacy_translator)
        assert isinstance(detector, LanguageDetector)


class TestAdapterDelegation:
    @pytest.mark.asyncio
    async def test_translate_delegates_to_wrapped(
        self, legacy_translator_with_fakes
    ):
        adapter = LegacyTranslatorAdapter(legacy_translator_with_fakes)
        out = await adapter.translate("hello", "en", "ma")
        assert out == "Ŋ be kuuraŋo la"

    @pytest.mark.asyncio
    async def test_translate_passes_source_and_target(
        self, legacy_translator_with_fakes
    ):
        adapter = LegacyTranslatorAdapter(legacy_translator_with_fakes)
        await adapter.translate("hello", "en", "ma")
        call = legacy_translator_with_fakes.client.chat.completions.create
        call.assert_awaited()
        messages = call.call_args.kwargs["messages"]
        content = messages[0]["content"]
        assert "English" in content
        assert "Mandinka" in content
        assert "hello" in content

    def test_detector_delegates_detect_language(self, bare_legacy_translator):
        detector = LegacyDetector(bare_legacy_translator)
        for text in ("", "isama", "please help me"):
            assert detector.detect_language(text) == bare_legacy_translator.detect_language(text)

    def test_detector_delegates_mandinka_intent(self, bare_legacy_translator):
        detector = LegacyDetector(bare_legacy_translator)
        for text in ("", "isama", "please help me"):
            assert detector.detect_mandinka_intent(text) == bare_legacy_translator.detect_mandinka_intent(text)


class TestAdapterPreservesLegacyQuirks:
    """The adapter must faithfully expose legacy quirks — fixing them is
    Step 3+ work and must be done in v2, not by the adapter."""

    @pytest.mark.asyncio
    async def test_source_equals_target_returns_input_unchanged(
        self, legacy_translator_with_fakes
    ):
        adapter = LegacyTranslatorAdapter(legacy_translator_with_fakes)
        out = await adapter.translate("unchanged", "en", "en")
        assert out == "unchanged"
        # And the LLM was not called
        legacy_translator_with_fakes.client.chat.completions.create.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_empty_text_returns_input_unchanged(
        self, legacy_translator_with_fakes
    ):
        adapter = LegacyTranslatorAdapter(legacy_translator_with_fakes)
        out = await adapter.translate("", "en", "ma")
        assert out == ""
        legacy_translator_with_fakes.client.chat.completions.create.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_unsupported_language_returns_input_unchanged(
        self, legacy_translator_with_fakes
    ):
        # Per translator.py:138–139 — unsupported → passthrough
        adapter = LegacyTranslatorAdapter(legacy_translator_with_fakes)
        out = await adapter.translate("hello", "en", "zz")
        assert out == "hello"
        legacy_translator_with_fakes.client.chat.completions.create.assert_not_awaited()


class TestAdapterLazyImport:
    def test_can_inject_translator_without_triggering_legacy_import(
        self, legacy_translator_with_fakes
    ):
        # If this raises ImportError, legacy was imported eagerly (bad).
        adapter = LegacyTranslatorAdapter(legacy_translator_with_fakes)
        assert adapter._impl is legacy_translator_with_fakes

    def test_detector_can_be_injected(self, bare_legacy_translator):
        detector = LegacyDetector(bare_legacy_translator)
        assert detector._impl is bare_legacy_translator
