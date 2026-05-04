"""Mandinka translations of abuse-defense response copy (Phase F).

Strings are produced at app startup by the existing ``translator_v4``
Mandinka pipeline (``src.services.translator``) and cached in memory.
The cache is populated ONCE per process via ``bootstrap_async()``,
which is wired into the FastAPI startup event in ``main.py``.

Fail-open semantics (matches the rest of abuse-defense):

  * If the translator service is unreachable at startup, bootstrap
    catches the failure, marks itself "done" so we don't keep
    retrying on every request, and the cache stays empty. Every
    Mandinka-mode lookup then falls back to the English original.

  * If the translator returns an empty/garbage string for one entry,
    that single entry stays English while the rest are cached.

  * ``mandinka_text(en)`` is sync, lock-free, dict-lookup. It NEVER
    raises and NEVER blocks the chat hot-path even if bootstrap is
    still in flight.

NOT YET REVIEWED BY NATIVE SPEAKERS. The cache is populated by
machine translation. Phase F.1 = swap the cache contents (or override
via env) for native-reviewed strings before promoting to production.
"""
from __future__ import annotations

import asyncio
import logging
import threading
from typing import Dict, List

from . import responses as _en


_log = logging.getLogger("amina.abuse_defense.responses_mn")
_LOCK = threading.RLock()

# Cache: English source -> Mandinka translation. Populated by
# bootstrap_async(); read by mandinka_text().
_CACHE: Dict[str, str] = {}

_BOOTSTRAP_DONE: bool   = False
_BOOTSTRAP_FAILED: bool = False
_BOOTSTRAP_STATS: Dict[str, int] = {"translated": 0, "skipped": 0, "errored": 0}


def _static_strings() -> List[str]:
    """All static English strings that need Mandinka translation.
    Static = non-parameterised; no ``{time}`` slots. The dynamic
    cooldown_text is excluded -- Phase F.1 will introduce a
    parameterised Mandinka template for it."""
    return [
        _en.WARNING_1,
        _en.WARNING_2,
        _en.WARNING_3,
        _en.CRISIS_RESPONSE,
        _en.SESSION_TERMINATION_RESPONSE,
        _en.TERMINATION_FIRST,
        _en.TERMINATION_SECOND,
        _en.TERMINATION_THIRD,
    ]


def is_ready() -> bool:
    """True iff bootstrap has run AND populated at least one entry.
    A bootstrap that completes with zero translations counts as 'not
    ready' so callers see English rather than thinking translation
    is on when it isn't."""
    return _BOOTSTRAP_DONE and bool(_CACHE)


def is_bootstrap_done() -> bool:
    """True iff bootstrap has run (regardless of success). Used by
    diagnostics so we can distinguish "haven't tried yet" from
    "tried and failed"."""
    return _BOOTSTRAP_DONE


def cache_size() -> int:
    return len(_CACHE)


def mandinka_text(en_text: str) -> str:
    """Sync lookup. Returns the cached Mandinka translation if we have
    one, else falls back to the English original. NEVER raises."""
    if not en_text:
        return ""
    return _CACHE.get(en_text, en_text)


async def bootstrap_async() -> Dict[str, int]:
    """Pre-translate all static strings via translator_v4.

    Idempotent: subsequent calls are a no-op.

    NEVER raises -- the worst case is that the cache stays empty and
    Mandinka users see English copy.

    Returns a stats dict: {translated, skipped, errored}.
    """
    global _BOOTSTRAP_DONE, _BOOTSTRAP_FAILED

    if _BOOTSTRAP_DONE:
        return dict(_BOOTSTRAP_STATS)

    try:
        # Lazy import so the abuse_defense module is loadable in
        # contexts that don't have the translator service available
        # (eval suites, sandbox tests, etc.).
        from src.services.translator import get_translator
        translator = get_translator()

        translated = 0
        skipped    = 0
        errored    = 0

        for src in _static_strings():
            try:
                mn = await translator.translate(src, "en", "ma")
                if mn and isinstance(mn, str) and mn.strip():
                    with _LOCK:
                        _CACHE[src] = mn
                    translated += 1
                else:
                    skipped += 1
                    _log.warning(
                        "MN translate returned empty for %r",
                        (src or "")[:50],
                    )
            except Exception as exc:
                errored += 1
                _log.warning(
                    "MN translate failed for %r: %s",
                    (src or "")[:50], exc,
                )

        _BOOTSTRAP_STATS["translated"] = translated
        _BOOTSTRAP_STATS["skipped"]    = skipped
        _BOOTSTRAP_STATS["errored"]    = errored

    except Exception as exc:
        # Translator service is wholly unavailable. Mark bootstrap
        # done so we don't keep retrying per request; cache stays empty.
        _log.warning("MN bootstrap failed wholesale: %s", exc)
        _BOOTSTRAP_FAILED = True

    finally:
        _BOOTSTRAP_DONE = True

    return dict(_BOOTSTRAP_STATS)


def status_snapshot() -> Dict[str, object]:
    """Diagnostic-only view of the Mandinka cache state."""
    return {
        "bootstrap_done":   _BOOTSTRAP_DONE,
        "bootstrap_failed": _BOOTSTRAP_FAILED,
        "cache_size":       cache_size(),
        "is_ready":         is_ready(),
        "stats":            dict(_BOOTSTRAP_STATS),
    }


# ── Test helpers ────────────────────────────────────────────────────
# These are NOT for production use. They let the eval suite drive the
# module without booting the translator service.

def reset_for_test() -> None:
    """Wipe cache + bootstrap state. Test-only."""
    global _BOOTSTRAP_DONE, _BOOTSTRAP_FAILED
    with _LOCK:
        _CACHE.clear()
        _BOOTSTRAP_DONE   = False
        _BOOTSTRAP_FAILED = False
        _BOOTSTRAP_STATS["translated"] = 0
        _BOOTSTRAP_STATS["skipped"]    = 0
        _BOOTSTRAP_STATS["errored"]    = 0


def set_translation_for_test(en: str, mn: str) -> None:
    """Inject a translation pair without calling the real translator.
    Test-only -- production code should populate via bootstrap_async()."""
    global _BOOTSTRAP_DONE
    with _LOCK:
        _CACHE[en] = mn
        _BOOTSTRAP_DONE = True
