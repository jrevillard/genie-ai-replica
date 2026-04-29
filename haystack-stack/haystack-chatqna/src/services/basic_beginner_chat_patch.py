"""
AMINA Care — Basic/Beginner Chat Patch
=========================================
Composes with the existing chat pipeline. Mounts:

  1. A pure ASGI middleware (`ModeHeaderMiddleware`) that reads the
     `X-AMINA-Mode` request header and stores its lowercased value
     ("basic" or "beginner") on a contextvar so `process_message` can
     see it without any changes to the route or request model.

  2. A monkey-patch on `AminaAgent.process_message` that:
       - For mode != basic|beginner   → falls through unchanged
         (advanced flow is byte-identical, never sees this code)
       - For mode == basic|beginner   → consults
         `basic_beginner_intent_router.classify_basic_beginner_intent`
         and short-circuits the response when the intent is one of the
         canned UX intents (greeting, goodbye, thanks, acknowledgement,
         guest personal_records_request).
       - For emergency / medical_question / authenticated personal_records
         → falls through to the existing chain (which is in turn
         `llm_provider_policy → guest_chat_patch → original`).

  Install order in main_with_rag_tuning.py is:

      guest_chat_patch          (innermost)
      llm_provider_policy
      basic_beginner_chat_patch (outermost — installs LAST)

  So the call chain is:
      basic_beginner → llm_policy → guest → original

  The advanced-mode flow is preserved exactly: when no `X-AMINA-Mode`
  header is present (or it's not "basic"/"beginner"), the patch is a
  pass-through with one trivial contextvar read.

The intent router itself lives in
src/services/basic_beginner_intent_router.py — pure regex, no imports
of the advanced router (intent_router.py / four_layer_router.py /
stance_classifier.py) so the two systems are fully isolated.
"""
from __future__ import annotations

import contextvars
import logging
from typing import Any, Optional

from src.services.basic_beginner_intent_router import (
    VALID_MODES,
    classify_basic_beginner_intent,
    deterministic_response,
)

logger = logging.getLogger("basic_beginner_chat_patch")

# ── Contextvars ───────────────────────────────────────────────────
# mode_var: set by the middleware from X-AMINA-Mode header.
# router_marker_var: set by the patch when it short-circuits, projected
#   by the middleware as X-AMINA-Intent-Router on the response so the
#   admin UI / tests can verify the deterministic gate fired.
mode_var: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "amina_ux_mode", default=None,
)
router_marker_var: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "amina_intent_router_marker", default=None,
)
intent_label_var: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "amina_intent_label", default=None,
)
domain_hint_var: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "amina_domain_hint", default=None,
)


# ── ASGI middleware ───────────────────────────────────────────────
class ModeHeaderMiddleware:
    """Read X-AMINA-Mode at request entry and stash it on a contextvar.
    Pure ASGI (not BaseHTTPMiddleware) so the value is visible to the
    handler in the same task, and to any downstream wrapper.

    Also projects the router-marker contextvar (set by the patch when
    it short-circuits) onto X-AMINA-Intent-Router on the response."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        # Reset all contextvars at request entry so a stale value from a
        # worker re-use cannot leak across requests.
        mode_var.set(None)
        router_marker_var.set(None)
        intent_label_var.set(None)
        domain_hint_var.set(None)
        try:
            for k, v in scope.get("headers", []) or []:
                if k == b"x-amina-mode":
                    val = v.decode("ascii", "ignore").strip().lower()
                    if val in VALID_MODES:
                        mode_var.set(val)
                    break
        except Exception:
            # Header parsing must never break the request.
            pass

        async def send_wrapper(message):
            try:
                if message.get("type") == "http.response.start":
                    marker = router_marker_var.get(None)
                    domain = domain_hint_var.get(None)
                    if marker or domain:
                        headers = list(message.get("headers", []) or [])
                        # Remove any prior copies (case-insensitive).
                        drop = (
                            b"x-amina-intent-router",
                            b"x-amina-intent",
                            b"x-amina-domain-hint",
                        )
                        headers = [(hk, hv) for (hk, hv) in headers
                                   if hk.lower() not in drop]
                        if marker:
                            headers.append((b"x-amina-intent-router",
                                            marker.encode("ascii", "ignore")))
                            label = intent_label_var.get(None)
                            if label:
                                headers.append((b"x-amina-intent",
                                                label.encode("ascii", "ignore")))
                        if domain and domain != "unknown":
                            headers.append((b"x-amina-domain-hint",
                                            domain.encode("ascii", "ignore")))
                        message["headers"] = headers
            except Exception:
                pass
            await send(message)

        await self.app(scope, receive, send_wrapper)


# ── Helpers ───────────────────────────────────────────────────────
def _detect_guest(session_id, patient_id, patient_name, phone, user_role) -> bool:
    """Same heuristic as guest_chat_patch — duplicated locally so the
    two patches don't have a runtime import dependency on each other."""
    sid = session_id or ""
    if isinstance(sid, str) and sid.startswith("guest_"):
        return True
    return (
        not (patient_id and str(patient_id).strip())
        and not (patient_name and str(patient_name).strip())
        and not (phone and str(phone).strip())
        and not (user_role and str(user_role).strip())
    )


# ── Patch ─────────────────────────────────────────────────────────
_INSTALLED = False
_orig_process_message = None


async def _patched_process_message(self, *args, **kwargs):
    mode = mode_var.get(None)
    if mode not in VALID_MODES:
        # Advanced / unspecified mode — fall through with zero behaviour change.
        return await _orig_process_message(self, *args, **kwargs)

    # Resolve the args we need without disturbing the original signature.
    def _arg(name: str, idx: int, default=None):
        if name in kwargs:
            return kwargs[name]
        if len(args) > idx:
            return args[idx]
        return default

    message      = _arg("message",      0, "")
    session_id   = _arg("session_id",   1, "")
    patient_id   = _arg("patient_id",   2, None)
    patient_name = _arg("patient_name", 3, None)
    phone        = _arg("phone",        4, None)
    user_role    = _arg("user_role",    6, None)

    is_guest = _detect_guest(session_id, patient_id, patient_name, phone, user_role)
    classification = classify_basic_beginner_intent(message or "", is_guest, mode)
    intent          = classification.get("intent",               "unknown")
    confidence      = float(classification.get("confidence",     0.0))
    reason          = classification.get("reason",               "")
    route           = classification.get("route",                "fallthrough")
    short_circuit   = bool(classification.get("should_short_circuit", False))
    domain_hint     = classification.get("domain_hint",          "unknown")
    language_hint   = classification.get("language_hint",        "unknown")

    # Surface the domain hint on a header for every Basic/Beginner call,
    # not just deterministic ones. Useful for admin observability.
    if domain_hint:
        domain_hint_var.set(domain_hint)

    # Safe-metadata logging only — never log the raw user message.
    logger.info(
        "[basic_beginner] mode=%s guest=%s intent=%s conf=%.2f route=%s "
        "domain=%s lang=%s short_circuit=%s reason=%r",
        mode, is_guest, intent, confidence, route,
        domain_hint, language_hint, short_circuit, reason,
    )

    if short_circuit:
        deterministic = deterministic_response(
            intent,
            is_guest=is_guest,
            patient_name=patient_name or "",
        )
        if deterministic is not None:
            deterministic["mode"]                   = mode
            deterministic["context_classification"] = classification
            # Stamp contextvars so the response middleware can project the
            # marker onto X-AMINA-Intent-Router / X-AMINA-Intent headers.
            router_marker_var.set("basic_beginner")
            intent_label_var.set(intent)
            return deterministic
        # Defensive: if the classifier said short-circuit but no canned
        # response exists, fall through rather than break the request.
        logger.warning(
            "[basic_beginner] short_circuit=true but no deterministic "
            "response for intent=%s — falling through", intent,
        )

    # emergency / medical_question / authed-personal-records / unknown
    # → fall through to the existing pipeline (llm_policy → guest → original).
    return await _orig_process_message(self, *args, **kwargs)


def install() -> None:
    global _INSTALLED, _orig_process_message
    if _INSTALLED:
        return
    try:
        from src.agent.amina_agent import AminaAgent
    except ImportError as e:
        logger.warning("basic_beginner_chat_patch: AminaAgent not available: %s", e)
        return
    _orig_process_message = AminaAgent.process_message
    AminaAgent.process_message = _patched_process_message
    _INSTALLED = True
    logger.info("basic_beginner_chat_patch installed: short-circuit for Basic/Beginner UX intents")


def install_middleware(app) -> None:
    """Mount the ASGI X-AMINA-Mode reader. Idempotent."""
    if getattr(app.state, "_basic_beginner_mw", False):
        return
    app.state._basic_beginner_mw = True
    app.add_middleware(ModeHeaderMiddleware)
    logger.info("basic_beginner_chat_patch middleware installed (X-AMINA-Mode header reader)")


# Install the method patch at import time. The middleware needs an `app`,
# so it's mounted from main_with_rag_tuning via install_middleware(app).
install()
