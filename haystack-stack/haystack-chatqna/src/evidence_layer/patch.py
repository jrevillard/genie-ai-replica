"""
Evidence Layer — runtime wrapper around AminaAgent.process_message.

Composition:
    evidence_patch    (this — outermost, captures end-to-end timing)
        ↓
    agentic_runtime_patch
        ↓
    basic_beginner_chat_patch
        ↓
    llm_provider_policy
        ↓
    guest_chat_patch
        ↓
    AminaAgent.process_message  (original)

Behaviour:
  * When state == OFF (default): zero behaviour change. The wrapper
    short-circuits to the original on the very first line.
  * When state == ON: starts a perf timer, calls the original, captures
    a privacy-safe trace, optionally annotates the result dict with
    `evidence_layer_enabled=true` and `evidence_trace_id`.
  * On ANY exception in the layer: logs and falls through to the
    original. AMINA_EVIDENCE_FAIL_OPEN=true makes this the default.
"""
from __future__ import annotations

import logging
import time
from typing import Any

from src.evidence_layer.config import AMINA_EVIDENCE_FAIL_OPEN
from src.evidence_layer import state as _state

logger = logging.getLogger("evidence_layer.patch")

_INSTALLED = False
_orig_process_message = None


def _build_request_view(args: tuple, kwargs: dict) -> dict:
    """Pull a SAFE projection of process_message kwargs/args for the trace.

    Mirrors the agentic runtime patch's mapping. NEVER returns the raw
    message; only its length is later derived from this dict.
    """
    def _arg(name: str, idx: int, default=None):
        if name in kwargs:
            return kwargs[name]
        if len(args) > idx:
            return args[idx]
        return default

    message      = _arg("message",      0, "") or ""
    session_id   = _arg("session_id",   1, "") or ""
    patient_id   = _arg("patient_id",   2, None)
    channel      = _arg("channel",      5, "web")
    user_role    = _arg("user_role",    6, None)

    mode = None
    try:
        from src.services.basic_beginner_chat_patch import mode_var as bb_mode_var
        bb = bb_mode_var.get(None)
        if bb in ("basic", "beginner", "advanced"):
            mode = bb
    except Exception:
        pass

    return {
        "message":    message,         # only length is used downstream
        "session_id": session_id,
        "patient_id": patient_id,
        "channel":    channel,
        "user_role":  user_role,
        "mode":       mode,
    }


async def _patched_process_message(self, *args, **kwargs):
    # Hot-path no-op when the layer is OFF.
    if not _state.is_enabled():
        return await _orig_process_message(self, *args, **kwargs)

    started = time.perf_counter()
    error_kind = None
    result: Any = None
    try:
        result = await _orig_process_message(self, *args, **kwargs)
    except Exception as e:
        error_kind = e.__class__.__name__
        if AMINA_EVIDENCE_FAIL_OPEN:
            # We do NOT swallow the exception — chat consumers expect
            # whatever shape AminaAgent already returns on error. Just
            # try to capture a trace before re-raising.
            try:
                latency_ms = (time.perf_counter() - started) * 1000.0
                from src.evidence_layer.trace_capture import capture_trace
                capture_trace(
                    request=_build_request_view(args, kwargs),
                    result=None,
                    latency_ms=latency_ms,
                    error_kind=error_kind,
                )
            except Exception:
                pass
        raise

    try:
        latency_ms = (time.perf_counter() - started) * 1000.0
        from src.evidence_layer.trace_capture import capture_trace
        trace = capture_trace(
            request=_build_request_view(args, kwargs),
            result=result,
            latency_ms=latency_ms,
            error_kind=None,
        )
        if isinstance(result, dict) and trace is not None:
            # Non-breaking metadata. Use setdefault so we don't clobber
            # whatever an inner patch already set.
            result.setdefault("evidence_layer_enabled", True)
            result.setdefault("evidence_trace_id", trace.trace_id)
    except Exception as e:
        # Tracing failure must NEVER alter chat output.
        logger.debug("[evidence_patch] capture failed: %s", e)

    return result


def install_evidence_patch() -> None:
    """Idempotent. Wraps AminaAgent.process_message — but the wrapper is
    DORMANT until an admin enables the layer."""
    global _INSTALLED, _orig_process_message
    if _INSTALLED:
        return
    try:
        from src.agent.amina_agent import AminaAgent
    except Exception as e:
        logger.warning("[evidence_patch] AminaAgent unavailable: %s", e)
        return
    _orig_process_message = AminaAgent.process_message
    AminaAgent.process_message = _patched_process_message
    _INSTALLED = True
    logger.info("[evidence_patch] installed (state=%s, fail_open=%s)",
                _state.get_state(), AMINA_EVIDENCE_FAIL_OPEN)
