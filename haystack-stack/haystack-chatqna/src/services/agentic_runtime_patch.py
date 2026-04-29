"""
AMINA Agent Platform v1 — runtime patch.

Monkey-patches AminaAgent.process_message with the SMALLEST possible
wrapper that:

  1. Builds an AgenticRequest from process_message's kwargs.
  2. Calls runtime.maybe_run_agentic_prepass(request).
  3. In OFF / SHADOW mode: calls the ORIGINAL process_message and
     returns its result unchanged. (Shadow attaches non-breaking
     metadata if the result is a dict.)
  4. In ASSIST / STRICT mode: prepends the agentic context block to
     the user message before calling the original process_message,
     so the existing safety stack still runs after generation.
  5. NEVER raises in production (_ap_config.AMINA_AGENTIC_FAIL_OPEN=true) — any
     exception falls back to the original implementation.

Compose order in main_with_rag_tuning.py (head → original):

    agentic_runtime_patch  (this — outermost)
        |
        v
    basic_beginner_chat_patch
        |
        v
    llm_provider_policy
        |
        v
    guest_chat_patch
        |
        v
    AminaAgent.process_message  (original)
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from src.agent_platform import config as _ap_config
from src.agent_platform.config import AgentMode
from src.agent_platform.models import AgenticRequest
from src.agent_platform.runtime import get_runtime

logger = logging.getLogger("agentic_runtime_patch")

_INSTALLED = False
_orig_process_message = None


# ── Helpers ────────────────────────────────────────────────────────
def _build_request(kwargs: dict, args: tuple) -> AgenticRequest:
    """
    Map process_message arguments into an AgenticRequest. Works for
    both kwarg-style and positional calls.

    process_message signature (per amina_agent.py:795):
        process_message(message, session_id, patient_id=None,
                        patient_name=None, phone=None, channel="web",
                        user_role=None, regenerate_hint=None,
                        model_preference=None)
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
    patient_name = _arg("patient_name", 3, None)
    phone        = _arg("phone",        4, None)
    channel      = _arg("channel",      5, "web")
    user_role    = _arg("user_role",    6, None)

    # Mode comes from the basic_beginner_chat_patch contextvar OR
    # session_id pattern. Default to "advanced" if no other signal —
    # operators should set _ap_config.AMINA_AGENTIC_MODES_ALLOWED=advanced for
    # the staged rollout (shadow → advanced-assist).
    mode = "advanced"
    try:
        from src.services.basic_beginner_chat_patch import mode_var as bb_mode_var
        bb = bb_mode_var.get(None)
        if bb in ("basic", "beginner"):
            mode = bb
    except Exception:
        pass

    # Guest detection
    sid = session_id or ""
    is_guest = bool(isinstance(sid, str) and sid.startswith("guest_"))
    role = (user_role or "").strip().lower() or ("guest" if is_guest else "patient")

    return AgenticRequest(
        message=message,
        session_id=session_id,
        patient_id=patient_id,
        patient_name=patient_name,
        phone=phone,
        mode=mode,
        channel=channel,
        role=role,
        is_emergency=False,  # the planner does its own emergency detection
        conditions=[],       # left empty — adapter pulls from profile when needed
    )


def _attach_metadata(result: Any, prepass) -> Any:
    """Attach trace metadata to a dict result without breaking shape."""
    if not isinstance(result, dict):
        return result
    if not getattr(prepass, "enabled", False):
        return result
    # Shadow + assist both surface the same metadata for ops
    plan = getattr(prepass, "plan", None)
    result.setdefault("agentic_trace_id",   prepass.trace_id)
    result.setdefault("agentic_mode",       prepass.mode)
    result.setdefault("agentic_plan_intent",
                      getattr(plan, "intent", "") if plan else "")
    result.setdefault("agentic_tool_count",
                      len(prepass.approved_tool_results or []))
    return result


# ── Patched process_message ───────────────────────────────────────
async def _patched_process_message(self, *args, **kwargs):
    # Fast path: mode=off → zero behaviour change.
    if _ap_config.AMINA_AGENTIC_MODE == AgentMode.OFF:
        return await _orig_process_message(self, *args, **kwargs)

    try:
        request = _build_request(kwargs, args)
    except Exception as e:
        logger.warning("[agentic_patch] failed to build request: %s", e)
        return await _orig_process_message(self, *args, **kwargs)

    # Skip the entire prepass if the message is empty.
    if not (request.message or "").strip():
        return await _orig_process_message(self, *args, **kwargs)

    # 1. Run the prepass (planner + policy + maybe-execute).
    runtime = get_runtime()
    try:
        prepass = await runtime.maybe_run_agentic_prepass(request)
    except Exception as e:
        logger.exception("[agentic_patch] prepass raised: %s", e)
        if _ap_config.AMINA_AGENTIC_FAIL_OPEN:
            return await _orig_process_message(self, *args, **kwargs)
        raise

    # 2. Mode handling
    mode_val = (prepass.mode or _ap_config.AMINA_AGENTIC_MODE.value).lower()

    # SHADOW: do not touch the user message; original speaks.
    if mode_val in ("shadow", "off") or not prepass.enabled:
        result = await _orig_process_message(self, *args, **kwargs)
        return _attach_metadata(result, prepass)

    # ASSIST / STRICT: prepend the context block to the user message.
    # The existing safety stack (medication gate, safety supervisor,
    # topic anchor, etc.) still runs after generation because we don't
    # bypass anything — we only enrich the input.
    enriched_kwargs = dict(kwargs)
    if prepass.context_block:
        original_message = (
            kwargs.get("message")
            if "message" in kwargs
            else (args[0] if args else "")
        )
        enriched_kwargs["message"] = (
            f"{prepass.context_block}\n\n{original_message}"
        )
        # We must not pass `message` both positionally and as kwarg.
        if args and "message" not in kwargs:
            args = args[1:]  # drop positional message; it's now in kwargs

    try:
        result = await _orig_process_message(self, *args, **enriched_kwargs)
    except Exception as e:
        logger.exception("[agentic_patch] enriched call raised: %s", e)
        if _ap_config.AMINA_AGENTIC_FAIL_OPEN:
            # Fall back to the unenriched original.
            return await _orig_process_message(self, *args, **kwargs)
        raise

    return _attach_metadata(result, prepass)


# ── Install ────────────────────────────────────────────────────────
def install_agentic_patch() -> None:
    """Idempotent. Wraps AminaAgent.process_message with our prepass."""
    global _INSTALLED, _orig_process_message
    if _INSTALLED:
        return
    try:
        from src.agent.amina_agent import AminaAgent
    except Exception as e:
        logger.warning("[agentic_patch] AminaAgent unavailable: %s", e)
        return
    _orig_process_message = AminaAgent.process_message
    AminaAgent.process_message = _patched_process_message
    _INSTALLED = True
    logger.info(
        "[agentic_patch] installed (mode=%s, fail_open=%s)",
        _ap_config.AMINA_AGENTIC_MODE.value, _ap_config.AMINA_AGENTIC_FAIL_OPEN,
    )


# Allow side-effect import too (parity with other patches).
install_agentic_patch()
