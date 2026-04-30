"""
Caregiver Privacy Consent — Phase 5 warn-only middleware.
=========================================================

Phase 5 surfaces stale or missing caregiver privacy consent **without**
locking anyone out. Phase 2 already provides:

    * `cpc.find_current_consent(caregiver_id)` — returns the current
      version row or None
    * `cpc.has_current_consent(caregiver_id)` — bool
    * `cpc.check_caregiver_consent_or_raise` — flag-gated hard gate
      controlled by `AMINA_CAREGIVER_PRIVACY_REQUIRED` (default False)

Phase 5 layers an **observability** path on top of those primitives:

    * An ASGI middleware that, for every request to `/api/v1/caregiver/`,
      decodes the caregiver JWT (best-effort — never raises),
      calls `find_current_consent`, and adds a response header:

          X-Caregiver-Privacy-Stale: true | false

      Stale = the caregiver has no record at the current notice version.

    * A structured warning log line (safe-fields only) on stale, so
      operators can track the population that would be hit by an
      enforcement flip later.

    * `AMINA_CAREGIVER_PRIVACY_WARN_ONLY` env flag (default True) so
      the middleware itself can be flipped off in production once
      enforcement is on (or kept on alongside enforcement — they're
      independent: enforcement is the BLOCK gate, warn-only is the
      OBSERVABILITY signal).

Behavioural contract (mandatory, do not weaken):
    * Never blocks a request. Even on internal failure, the wrapped
      handler still runs.
    * Never leaks PHI. The header carries one of {true, false}; the
      log line uses the existing `_AUDIT_SAFE_KEYS` set.
    * Idempotent install — calling `install(app)` twice is a no-op.
    * Independent of `AMINA_CAREGIVER_PRIVACY_REQUIRED`. Operating with
      enforcement off (the default) is the whole point of Phase 5.

Phase 5 deliberate non-goals (covered later):
    * No retention sweeper.
    * No general AUDIT-005 audit-event store.
    * No re-accept endpoint — the existing
      `POST /api/v1/caregiver/privacy/consent` is already idempotent and
      version-aware (Phase 2). Phase 5 reuses it; no new route.
    * No patient-route auth refactor.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

import jwt

from src.config import settings
from src.services import caregiver_privacy_consent as cpc

logger = logging.getLogger(__name__)


# ── Flag ─────────────────────────────────────────────────────────────
def _parse_bool_env(name: str, default: bool = True) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


AMINA_CAREGIVER_PRIVACY_WARN_ONLY: bool = _parse_bool_env(
    "AMINA_CAREGIVER_PRIVACY_WARN_ONLY", default=True,
)


# ── Constants ────────────────────────────────────────────────────────
# Path prefix the middleware operates on. Anything outside is a no-op
# fast-path. Keep this aligned with the route file's prefixes; widening
# it would risk doing JWT work on unrelated traffic.
_CAREGIVER_PATH_PREFIX = "/api/v1/caregiver"

# Response-header name. Lower-cased on the wire (HTTP/1.1 is
# case-insensitive but ASGI delivers headers in lower-case bytes; we
# emit lower-case to match the convention).
_HEADER_NAME = b"x-caregiver-privacy-stale"

# Structured log event for grep-ability + downstream parsing. The shape
# matches the Phase 2 audit log convention (`event_type=...` + safe
# `key=value` pairs, no JSON, no PHI).
_LOG_EVENT_STALE = "caregiver_privacy_consent_stale"


# ── Helpers (best-effort, never raise) ───────────────────────────────
def _extract_bearer_token_from_scope(scope: dict) -> Optional[str]:
    """Pull the bearer token out of an ASGI scope's headers. Returns
    None if no token is present. Never raises."""
    try:
        for name, value in scope.get("headers", ()):
            if name == b"authorization":
                v = value.decode("latin-1", errors="ignore")
                if v.lower().startswith("bearer "):
                    return v[7:].strip() or None
                return None
    except Exception:
        pass
    return None


def _decode_caregiver_id(token: str) -> Optional[str]:
    """
    Decode the JWT and return the caregiver_id. The Phase 2 routes
    accept tokens with role='caregiver' and the caregiver id either in
    `sub` or `caregiver_id`. We mirror that lookup. Returns None for
    any decode error or non-caregiver role — that lets the middleware
    silently no-op on patient / admin / gov traffic.
    """
    try:
        payload = jwt.decode(
            token, settings.JWT_SECRET, algorithms=["HS256"],
        )
    except Exception:
        return None
    if (payload.get("role") or "").lower() != "caregiver":
        return None
    cg = payload.get("sub") or payload.get("caregiver_id") or ""
    return str(cg) or None


def _is_stale_safe(caregiver_id: str) -> bool:
    """Return True if the caregiver has no current-version record.
    Returns False on any error (fail-open — Phase 5 is observability,
    not enforcement)."""
    try:
        return not cpc.has_current_consent(caregiver_id)
    except Exception as exc:
        # Never block on storage hiccups. Log at debug so a noisy
        # backend doesn't dominate logs.
        logger.debug(
            "caregiver_privacy_warn: stale-check failed sid=%s err=%s",
            caregiver_id, exc,
        )
        return False


def _emit_stale_warning(caregiver_id: str) -> None:
    """Single warning line, safe fields only. Never raises."""
    try:
        logger.warning(
            "event_type=%s caregiver_id=%s notice_version=%s required_flag=%s warn_only=%s",
            _LOG_EVENT_STALE,
            caregiver_id,                                         # safe: opaque ID, not PHI
            cpc.CAREGIVER_PRIVACY_NOTICE_VERSION,                 # safe: pinned constant
            str(cpc.AMINA_CAREGIVER_PRIVACY_REQUIRED).lower(),    # safe: flag value
            str(AMINA_CAREGIVER_PRIVACY_WARN_ONLY).lower(),       # safe: flag value
        )
    except Exception:
        pass

    # Phase 9 (AUDIT-005): also append to the central audit-event store.
    # Lazy import + double-guarded so an audit-side outage cannot
    # weaken Phase 5's "never blocks, never raises" contract.
    try:
        from src.services import audit_event_store as _aes  # noqa: WPS433
        try:
            _aes.append_event(
                event_type="caregiver_privacy.stale.warned",
                actor_type="system",
                subject_type="caregiver",
                subject_id=caregiver_id,
                action="observe",
                resource="caregiver_privacy_warn_middleware",
                outcome="success",
                reason_code="stale",
                metadata={
                    "notice_version": cpc.CAREGIVER_PRIVACY_NOTICE_VERSION,
                    "required_flag":  bool(cpc.AMINA_CAREGIVER_PRIVACY_REQUIRED),
                    "warn_only":      bool(AMINA_CAREGIVER_PRIVACY_WARN_ONLY),
                },
            )
        except Exception:
            pass
    except Exception:
        pass


# ── Middleware ───────────────────────────────────────────────────────
class CaregiverPrivacyWarnMiddleware:
    """
    ASGI middleware that injects `X-Caregiver-Privacy-Stale` on
    responses to authenticated caregiver requests. Always pass-through
    on errors. Never blocks.
    """

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        # ── Fast-path ────────────────────────────────────────────────
        # Non-HTTP scopes (lifespan, websocket): pass through.
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        # If the warn-only flag is off, do nothing — the middleware
        # is a true no-op so it can sit in the stack without overhead.
        if not AMINA_CAREGIVER_PRIVACY_WARN_ONLY:
            await self.app(scope, receive, send)
            return

        # Only operate on caregiver routes.
        path = scope.get("path") or ""
        if not path.startswith(_CAREGIVER_PATH_PREFIX):
            await self.app(scope, receive, send)
            return

        # ── Compute stale state best-effort ──────────────────────────
        token = _extract_bearer_token_from_scope(scope)
        caregiver_id: Optional[str] = (
            _decode_caregiver_id(token) if token else None
        )
        # Default header value when we can't determine: false. This is
        # safe — it's the Phase 5 contract that says "authenticated
        # caregivers with stale consent get true; everyone else gets
        # false". A stale=true header is only ever emitted with a
        # confirmed caregiver_id, so the frontend can treat it as
        # authoritative.
        is_stale = False
        if caregiver_id:
            is_stale = _is_stale_safe(caregiver_id)
            if is_stale:
                _emit_stale_warning(caregiver_id)

        header_value = b"true" if is_stale else b"false"

        # ── Wrap send to inject the header on response start ─────────
        async def send_with_header(message):
            try:
                if message.get("type") == "http.response.start":
                    headers = list(message.get("headers") or [])
                    # Replace any prior copy (handlers may set it
                    # themselves; ours is authoritative for the gate).
                    headers = [
                        (k, v) for (k, v) in headers
                        if k != _HEADER_NAME
                    ]
                    headers.append((_HEADER_NAME, header_value))
                    new_msg = dict(message)
                    new_msg["headers"] = headers
                    await send(new_msg)
                    return
            except Exception:
                # Header injection must never break the response.
                pass
            await send(message)

        # Always delegate to the underlying app — never block.
        await self.app(scope, receive, send_with_header)


# ── Public install entry-point ───────────────────────────────────────
_INSTALLED_FLAG = "_caregiver_privacy_warn_installed"


def install(app) -> bool:
    """
    Mount the warn-only middleware on a FastAPI app. Idempotent:
    a second call is a no-op. Returns True on first install,
    False if already installed.

        from src.services.caregiver_privacy_warn import install
        install(app)
    """
    if app is None:
        return False
    if getattr(app, _INSTALLED_FLAG, False):
        logger.info("caregiver_privacy_warn: already installed (no-op)")
        return False
    try:
        app.add_middleware(CaregiverPrivacyWarnMiddleware)
        setattr(app, _INSTALLED_FLAG, True)
        logger.info(
            "caregiver_privacy_warn: installed (warn_only=%s, required=%s)",
            AMINA_CAREGIVER_PRIVACY_WARN_ONLY,
            cpc.AMINA_CAREGIVER_PRIVACY_REQUIRED,
        )
        return True
    except Exception as exc:
        logger.warning("caregiver_privacy_warn: install failed: %s", exc)
        return False


__all__ = [
    "AMINA_CAREGIVER_PRIVACY_WARN_ONLY",
    "CaregiverPrivacyWarnMiddleware",
    "install",
]
