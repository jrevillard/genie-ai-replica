"""Monkey-patch src.services.translator.get_translator() to return a
v2-backed proxy that quacks exactly like the legacy Translator class.

Why
----
The Step 7 v1 compat middleware catches `/api/v1/agent/translate` and
`/translate/batch`. It does NOT catch internal callers of the legacy
`translator.translate()` method — notably `/api/v1/agent/chat`'s
response-translation step when a user sends `language="ma"`, and
`/prescription` analysis output translation.

This shim fills that gap. It follows the pattern established by
`main_with_tts_mandinka_fix.py`, which patches the module attributes
of `src.services.tts`. No edits to the legacy translator file.

Safety
------
The proxy **falls back to legacy** on any v2 error. Chat never breaks
because of a v2 problem; at worst a bad v2 deploy reverts invisibly.
The shim is idempotent — installing twice is a no-op.

Flag
----
When `USE_V2_FOR_LEGACY_TRANSLATOR=False` (default), the proxy still
delegates every call to the wrapped legacy Translator. Installing the
shim is therefore zero-risk; activation is a separate env flag flip.
"""
from __future__ import annotations

import logging
from typing import Any

from translation_v2 import flags

logger = logging.getLogger(__name__)

_ORIGINAL_GET: Any = None  # captured on install
_INSTALLED: bool = False


class LegacyProxyViaV2:
    """Satisfies the legacy Translator class surface.

    Exposes: ``translate``, ``translate_batch``, ``detect_language``,
    ``detect_mandinka_intent``, plus attribute delegation for anything
    else a caller might reach for.
    """

    def __init__(self, legacy_translator: Any, v2_router: Any) -> None:
        self._legacy = legacy_translator
        self._v2 = v2_router
        # Diagnostic attributes that downstream code sometimes logs.
        self.backend = "v2-proxy"
        self.model = getattr(legacy_translator, "model", "v2-routed")

    # ── TranslationProvider-shaped methods ─────────────────────────
    async def translate(
        self, text: str, source: str = "en", target: str = "ma"
    ) -> str:
        if not flags.USE_V2_FOR_LEGACY_TRANSLATOR:
            return await self._legacy.translate(text, source=source, target=target)

        try:
            return await self._v2.translate(text, source, target)
        except Exception as e:
            logger.warning(
                "legacy_shim: v2 translate failed, falling back to legacy: %s",
                e,
            )
            return await self._legacy.translate(text, source=source, target=target)

    async def translate_batch(
        self,
        texts: dict,
        source: str = "en",
        target: str = "ma",
    ) -> dict:
        if not flags.USE_V2_FOR_LEGACY_TRANSLATOR:
            return await self._legacy.translate_batch(
                texts, source=source, target=target
            )
        if source == target:
            return dict(texts)

        out: dict = {}
        try:
            for key, value in texts.items():
                if not isinstance(value, str) or not value.strip():
                    out[key] = value if isinstance(value, str) else ""
                    continue
                out[key] = await self._v2.translate(value, source, target)
            return out
        except Exception as e:
            logger.warning(
                "legacy_shim: v2 batch translate failed, falling back: %s", e
            )
            return await self._legacy.translate_batch(
                texts, source=source, target=target
            )

    # ── Pure-Python detector methods — always pass through ─────────
    def detect_language(self, text: str) -> str:
        return self._legacy.detect_language(text)

    def detect_mandinka_intent(self, text: str) -> dict:
        return self._legacy.detect_mandinka_intent(text)

    # ── Attribute delegation for anything else ─────────────────────
    def __getattr__(self, name: str) -> Any:
        # Only reached when normal attribute lookup fails. Forward to
        # the wrapped legacy translator so e.g. `.redis`, `.client`,
        # `._cache_key(...)` still work for existing callers that
        # reach in for diagnostics.
        return getattr(self._legacy, name)


def install() -> None:
    """Replace services.translator.get_translator with a proxy factory.

    Call once at application startup from main_with_translation_v2.py.
    Idempotent. Safe to call when the flag is off.
    """
    global _ORIGINAL_GET, _INSTALLED
    if _INSTALLED:
        return

    from src.services import translator as legacy_module

    _ORIGINAL_GET = legacy_module.get_translator
    _proxy_cache: dict[str, LegacyProxyViaV2] = {}

    def patched_get_translator():
        if "it" in _proxy_cache:
            return _proxy_cache["it"]
        legacy = _ORIGINAL_GET()
        try:
            from translation_v2.api.bootstrap import get_v2_router
            v2 = get_v2_router()
        except Exception as e:
            logger.warning(
                "legacy_shim: v2 router unavailable, returning unwrapped legacy: %s",
                e,
            )
            return legacy
        proxy = LegacyProxyViaV2(legacy, v2)
        _proxy_cache["it"] = proxy
        return proxy

    legacy_module.get_translator = patched_get_translator
    _INSTALLED = True
    logger.info(
        "legacy_shim installed: services.translator.get_translator is now v2-proxied "
        "(active when USE_V2_FOR_LEGACY_TRANSLATOR=true)"
    )


def uninstall() -> None:
    """Restore the original get_translator. Tests only."""
    global _ORIGINAL_GET, _INSTALLED
    if not _INSTALLED or _ORIGINAL_GET is None:
        return
    from src.services import translator as legacy_module
    legacy_module.get_translator = _ORIGINAL_GET
    _ORIGINAL_GET = None
    _INSTALLED = False
