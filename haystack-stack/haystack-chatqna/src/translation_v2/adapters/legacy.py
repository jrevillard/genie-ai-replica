"""Adapters over the legacy Translator.

The legacy services.translator.Translator is the only live translation
path today. These adapters wrap it so future v2 router code can call it
through the v2 Protocols (TranslationProvider, LanguageDetector)
without any modification to the legacy class.

Design notes
------------
- Legacy `translate_batch` takes and returns `Dict[str, str]`. The v2
  `TranslationProvider.translate_batch` is list-based. The adapter
  converts using index-keyed dicts so order is preserved and
  duplicates are not collapsed.
- Legacy construction requires `settings.OPENAI_API_KEY` and a Redis
  connection. Tests inject a prebuilt `Translator` instance via the
  `legacy_translator` kwarg to bypass these.
- No behavior is added or removed relative to legacy. Quirks are
  preserved (e.g. legacy returns the input text on translation failure
  rather than raising).
- An optional v2 TranslationMemory can be injected. When the
  `USE_V2_TM_CACHE` flag is ON the adapter consults the v2 TM before
  delegating; when OFF the adapter is byte-identical to a plain
  legacy call.
"""
from __future__ import annotations

from typing import Any


class LegacyTranslatorAdapter:
    """Wraps legacy Translator → TranslationProvider protocol.

    Parameters
    ----------
    legacy_translator
        A pre-built legacy ``Translator`` instance. If omitted, the
        singleton from ``services.translator.get_translator()`` is
        resolved lazily.
    tm
        Optional v2 ``TranslationMemory``. Consulted only when
        ``translation_v2.flags.USE_V2_TM_CACHE`` is True. Default None
        = legacy-byte-identical behavior.
    """

    name: str = "legacy"

    def __init__(
        self,
        legacy_translator: Any | None = None,
        tm: Any | None = None,
    ) -> None:
        if legacy_translator is None:
            from services.translator import get_translator
            legacy_translator = get_translator()
        self._impl = legacy_translator
        self._tm = tm

    def _tm_enabled(self) -> bool:
        if self._tm is None:
            return False
        from translation_v2 import flags
        return bool(flags.USE_V2_TM_CACHE)

    @staticmethod
    def _is_translatable(text: str, source: str, target: str) -> bool:
        """Matches the legacy fast-path skips so the TM only sees real work."""
        if not text or not text.strip():
            return False
        if source == target:
            return False
        return True

    async def translate(self, text: str, source: str, target: str) -> str:
        if self._tm_enabled() and self._is_translatable(text, source, target):
            cached = await self._tm.get(text, source, target, provider=self.name)
            if cached is not None:
                return cached

        result = await self._impl.translate(text, source=source, target=target)

        # Only write back when legacy actually did a translation — not when
        # it returned the input unchanged due to error or shortcut.
        if (
            self._tm_enabled()
            and self._is_translatable(text, source, target)
            and result
            and result != text
        ):
            await self._tm.put(text, result, source, target, provider=self.name)

        return result

    async def translate_batch(
        self, texts: list[str], source: str, target: str
    ) -> list[str]:
        if not texts:
            return []
        # Use index-keyed dict so duplicates aren't collapsed and order is
        # preserved when mapping back to a list.
        # Batch translation intentionally does NOT consult v2 TM in Step 2 —
        # the legacy batch path already has its own Redis cache, and layering
        # a second cache on top of batching produces confusing double-writes.
        # Step 3 will handle batch TM once the v2 pipeline owns the batching.
        as_dict = {str(i): t for i, t in enumerate(texts)}
        result = await self._impl.translate_batch(
            as_dict, source=source, target=target
        )
        return [result.get(str(i), texts[i]) for i in range(len(texts))]


class LegacyDetector:
    """Wraps legacy detector methods → LanguageDetector protocol."""

    def __init__(self, legacy_translator: Any | None = None) -> None:
        if legacy_translator is None:
            from services.translator import get_translator
            legacy_translator = get_translator()
        self._impl = legacy_translator

    def detect_language(self, text: str) -> str:
        return self._impl.detect_language(text)

    def detect_mandinka_intent(self, text: str) -> dict:
        return self._impl.detect_mandinka_intent(text)
