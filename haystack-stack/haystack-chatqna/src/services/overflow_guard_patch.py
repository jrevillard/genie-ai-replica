"""
AMINA Care — Overflow Guard Installer
======================================
Monkey-patches `AminaAgent.__init__` so every AminaAgent instance — patient
chat, caregiver chat, admin tools, etc. — has overflow protection installed
on ALL of its OpenAI-compatible clients (amina LoRA, OpenAI, Gemini, Groq,
Mistral).

This module is imported by `src/main_with_guard.py` BEFORE `src.main` is
imported. Since `get_agent()` is called lazily on the first request
(amina_agent.py defines it as a module-level singleton factory), the patch
lands before any instance ever exists.

The patch is idempotent: re-importing this module is a no-op, and instances
that already have the wrappers installed won't be re-wrapped.

No existing files are modified.
"""

from __future__ import annotations

import logging

from src.services.overflow_guard import wrap_client_completions

logger = logging.getLogger(__name__)

_INSTALLED = False


def install() -> None:
    """Install the overflow guard on AminaAgent. Safe to call multiple times."""
    global _INSTALLED
    if _INSTALLED:
        return

    try:
        from src.agent import amina_agent as _aa
    except Exception as e:
        logger.error("overflow_guard_patch: could not import amina_agent: %s", e)
        return

    AminaAgent = getattr(_aa, "AminaAgent", None)
    if AminaAgent is None:
        logger.error("overflow_guard_patch: AminaAgent class not found in amina_agent module")
        return

    original_init = AminaAgent.__init__
    if getattr(original_init, "_overflow_guard_patched", False):
        _INSTALLED = True
        return

    def patched_init(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        _wrap_all_clients(self)

    patched_init._overflow_guard_patched = True  # type: ignore[attr-defined]
    AminaAgent.__init__ = patched_init  # type: ignore[method-assign]

    # Also patch the caregiver service factory, which creates fresh AsyncOpenAI
    # clients per-request inside `handle_caregiver_turn`. We wrap those too.
    _patch_caregiver_service()

    _INSTALLED = True
    logger.info(
        "overflow_guard_patch: installed on AminaAgent.__init__ + caregiver service"
    )


def _wrap_all_clients(agent_instance) -> None:
    """Apply the wrapper to every AsyncOpenAI client attribute on the agent."""
    client_attrs = [
        ("amina_client",   "amina-lora"),
        ("openai_client",  "openai"),
        ("gemini_client",  "gemini"),
        ("groq_client",    "groq"),
        ("mistral_client", "mistral"),
        ("client",         "default"),
    ]
    wrapped = 0
    for attr, label in client_attrs:
        c = getattr(agent_instance, attr, None)
        if c is None:
            continue
        try:
            if wrap_client_completions(c, label=label):
                wrapped += 1
        except Exception as e:
            logger.warning(
                "overflow_guard_patch: failed to wrap %s (%s): %s",
                attr, label, e,
            )
    logger.info(
        "overflow_guard_patch: wrapped %d client(s) on %s",
        wrapped, type(agent_instance).__name__,
    )


def _patch_caregiver_service() -> None:
    """The caregiver pipeline in `src/services/caregiver_amina_service.py`
    creates fresh AsyncOpenAI clients inline per request. We shim AsyncOpenAI
    inside that module so every new client is auto-wrapped."""
    try:
        from src.services import caregiver_amina_service as _cg
    except Exception as e:
        logger.debug("overflow_guard_patch: caregiver service not importable: %s", e)
        return

    # The module's `AsyncOpenAI` is imported at top. Replace it with a
    # subclass that auto-wraps on construction.
    original_cls = getattr(_cg, "AsyncOpenAI", None)
    if original_cls is None:
        logger.debug("overflow_guard_patch: caregiver service has no AsyncOpenAI attr")
        return
    if getattr(original_cls, "_overflow_guard_shim", False):
        return

    from src.services.overflow_guard import wrap_client_completions as _wrap

    class _GuardedAsyncOpenAI(original_cls):  # type: ignore[misc,valid-type]
        _overflow_guard_shim = True

        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            try:
                _wrap(self, label="caregiver-service")
            except Exception as e:
                logger.warning("overflow_guard_patch: caregiver client wrap failed: %s", e)

    _cg.AsyncOpenAI = _GuardedAsyncOpenAI  # type: ignore[attr-defined]
    logger.info("overflow_guard_patch: caregiver AsyncOpenAI shim installed")


# Install at import time.
install()
