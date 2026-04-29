"""Auto-install the legacy shim when any translation_v2 flag is active.

Activation strategy (Stage 8b)
------------------------------
The legacy translator's ``get_translator()`` factory is monkey-patched
by ``legacy_shim.install()``. Historically that call was made from
``main_with_translation_v2.py`` — an alternative uvicorn entry point.
Production runs a different entry point (``main_with_emergency``), so
the shim never ran and every ``USE_V2_*`` flag was dead in the water.

This module restores activation *without* changing the entry point:

  * ``translation_v2/__init__.py`` imports this module as a side-effect.
  * On first import, we check the flags. If any v2 behaviour is
    requested, we invoke ``legacy_shim.install()``.
  * Installation is idempotent and the shim still falls back to the
    legacy translator on any v2 error, so this is zero-risk.

Disabled-by-default semantics are preserved: with every ``USE_V2_*``
flag at its default (False), this module is a no-op.

Failure mode
------------
Any exception raised while installing is logged at WARNING level and
swallowed. The app must start even if the v2 scaffold is broken —
chat falls back to the legacy translator path untouched.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def _should_install() -> bool:
    """True if any v2-behavioural flag is active.

    We install the shim whenever the caller might want v2 anywhere
    (chat translation, v1 endpoint shim, glossary injection, bridge
    polish). The shim itself re-checks per-request flags, so turning
    an individual feature off later is instant.
    """
    try:
        from translation_v2 import flags
    except Exception as e:  # pragma: no cover - scaffold import error
        logger.warning("translation_v2 flags unavailable: %s", e)
        return False

    return any(
        (
            flags.USE_V2_TRANSLATION_PIPELINE,
            flags.USE_V2_FOR_LEGACY_TRANSLATOR,
            flags.USE_V2_FOR_V1_ENDPOINTS,
            flags.USE_V2_GLOSSARY,
            flags.USE_V2_BRIDGE_POLISH,
            flags.USE_V2_TM_CACHE,
        )
    )


def _install_once() -> None:
    """Install the legacy shim a single time per process."""
    try:
        from translation_v2 import legacy_shim
    except Exception as e:
        logger.warning(
            "translation_v2 legacy_shim import failed; "
            "chat will continue on the legacy translator: %s",
            e,
        )
        return

    try:
        legacy_shim.install()
        logger.info(
            "translation_v2._autoinstall: legacy shim installed "
            "(per-request behaviour still gated on individual USE_V2_* flags)"
        )
    except Exception as e:
        logger.warning(
            "translation_v2._autoinstall: install() raised %s; "
            "chat will continue on the legacy translator",
            e,
        )


# Run on import. Safe to run under every entry point because the shim's
# own _INSTALLED flag guarantees idempotency.
if _should_install():
    _install_once()
