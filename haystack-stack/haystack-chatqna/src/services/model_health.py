"""
AMINA Care — Model Health / Circuit Breaker
==============================================
Tracks per-model liveness so the resilient chat endpoint can skip models
that just failed instead of re-timing out on every request.

Design
------
Two states per model, stored in Redis hash `model_health:{model}`:

    status              "ok" | "down"
    last_failure_at     ISO 8601 UTC (blank when never failed)
    last_failure_reason short string ("timeout", "http_502", "tls_error", …)
    cooldown_until      ISO 8601 UTC — skip this model until after this ts
    consecutive_fails   integer (promotes transient blips out of cooldown
                                 faster than hard failures)
    last_success_at     ISO 8601 UTC

A model goes into cooldown for COOLDOWN_BASE_SECONDS * 2^(consecutive_fails-1)
capped at COOLDOWN_MAX_SECONDS. One successful call resets the counter.

Error classification is STRICT about the transport-vs-auth boundary the user
called out — a 401 / 403 / 402 is **never** classified as DOWN. Those get
surfaced to the UI's auth refresh flow untouched. Only network-level or 5xx
/ 429 signals trip the breaker.

Callers
-------
    is_model_live(model)         → bool   cheap boolean gate
    report_failure(model, reason, kind) → None
    report_success(model)        → None
    snapshot(model | None)       → dict | dict[model, dict]

    classify_error(exc_or_status_or_body) → {"kind": "DOWN|TOKEN|BILLING|BAD|OK",
                                              "reason": str}
"""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Union

logger = logging.getLogger(__name__)

# ── Config ───────────────────────────────────────────────────────────────────

COOLDOWN_BASE_SECONDS = int(os.getenv("MODEL_COOLDOWN_BASE_SECONDS", "60"))
COOLDOWN_MAX_SECONDS  = int(os.getenv("MODEL_COOLDOWN_MAX_SECONDS",  "900"))   # 15m cap
REDIS_KEY_PREFIX      = "model_health:"
RECORD_TTL_SECONDS    = 24 * 3600


# ── Redis connection ─────────────────────────────────────────────────────────

def _redis_client():
    """decode_responses=True client. Honors REDIS_URL then REDIS_HOST/PORT."""
    import redis
    url = os.getenv("REDIS_URL")
    if url:
        return redis.Redis.from_url(url, decode_responses=True)
    host = os.getenv("REDIS_HOST", "redis")
    port = int(os.getenv("REDIS_PORT", "6379"))
    return redis.Redis(host=host, port=port, db=0, decode_responses=True)


# ── Time helpers ─────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(ts: datetime) -> str:
    return ts.isoformat().replace("+00:00", "Z")


def _parse_iso(s: str) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


# ── Classifier ───────────────────────────────────────────────────────────────

# Compiled once, case-insensitive.
# Order of lookups in classify_error: BILLING → TOKEN → DOWN → BAD so that
# "quota" / "payment required" land under BILLING (which the UI renders as
# "billing issue") rather than either TOKEN (auth issue) or DOWN (provider
# down). None of those three switch the model — DOWN is the only kind that
# trips the circuit breaker.
_RE_BILLING = re.compile(
    r"(402|billing|payment[_ ]?required|insufficient[_ ]?(quota|funds|credit)"
    r"|quota[_ ]?(exceeded|depleted)|card[_ ]?(declined|expired)"
    r"|subscription[_ ]?(expired|cancelled))",
    re.IGNORECASE,
)
_RE_TOKEN = re.compile(
    r"(401|403|invalid[_ ]?api[_ ]?key|unauthorized|authentication[_ ]?error"
    r"|api[_ ]?key[_ ]?(invalid|missing|expired|revoked)|incorrect[_ ]?api[_ ]?key"
    r"|permission[_ ]?denied|access[_ ]?denied)",
    re.IGNORECASE,
)
_RE_DOWN = re.compile(
    r"(timeout|timed[_ ]?out|connection[_ ]?(refused|reset|aborted|error)"
    r"|econn|enotfound|eai_again|temporarily[_ ]?unavailable|service[_ ]?unavailable"
    r"|bad[_ ]?gateway|5\d\d|429|rate[_ ]?limit|too[_ ]?many[_ ]?requests"
    r"|upstream[_ ]?(timeout|error)|ssl|handshake[_ ]?failed)",
    re.IGNORECASE,
)
_RE_BAD = re.compile(
    r"(400|validation[_ ]?error|unprocessable|invalid[_ ]?request"
    r"|context[_ ]?length|max[_ ]?tokens|too[_ ]?long)",
    re.IGNORECASE,
)


def classify_error(signal: Union[Exception, int, str, Dict[str, Any], None]) -> Dict[str, str]:
    """
    Normalize any of these into {kind, reason}:
      - Exception instance (network, SSL, OSError, TimeoutError, HTTPError…)
      - HTTP status code (int)
      - Error body string (provider-returned error text)
      - Response dict with 'error' and/or 'status_code'

    kind ∈ {"DOWN", "TOKEN", "BILLING", "BAD", "OK"}.
    TOKEN and BILLING are NEVER treated as DOWN — they surface to the auth flow.
    """
    if signal is None:
        return {"kind": "OK", "reason": ""}

    # Response-shaped dict
    if isinstance(signal, dict):
        status = signal.get("status_code") or signal.get("status") or 0
        body   = str(signal.get("error") or signal.get("detail") or signal.get("message") or "")
        if status:
            r = classify_error(int(status))
            if r["kind"] != "OK" or body:
                # Merge: status-kind wins unless body reveals auth
                bclass = classify_error(body) if body else {"kind": "OK", "reason": ""}
                if bclass["kind"] in ("TOKEN", "BILLING"):
                    return bclass
                return r
        return classify_error(body)

    # Integer HTTP status
    if isinstance(signal, int):
        if 200 <= signal < 300:
            return {"kind": "OK", "reason": ""}
        if signal in (401, 403):
            return {"kind": "TOKEN", "reason": f"http_{signal}"}
        if signal == 402:
            return {"kind": "BILLING", "reason": "http_402"}
        if signal == 400 or signal == 422:
            return {"kind": "BAD", "reason": f"http_{signal}"}
        if signal == 429 or 500 <= signal < 600:
            return {"kind": "DOWN", "reason": f"http_{signal}"}
        return {"kind": "DOWN", "reason": f"http_{signal}"}

    # Exception
    if isinstance(signal, BaseException):
        name = type(signal).__name__
        msg  = f"{name}: {signal}"
        # Status-bearing exceptions (requests.HTTPError, httpx.HTTPStatusError…)
        resp = getattr(signal, "response", None)
        if resp is not None:
            try:
                return classify_error(int(resp.status_code))
            except Exception:
                pass
        # Network-y exceptions — map to DOWN regardless of message
        if any(s in name for s in (
            "Timeout", "ConnectError", "ConnectTimeout", "ReadTimeout",
            "ConnectionError", "SSLError", "NewConnectionError", "ProtocolError",
        )):
            return {"kind": "DOWN", "reason": f"exc_{name}"}
        # Fall back to string matching
        return classify_error(msg)

    # String
    s = str(signal).strip()
    if not s:
        return {"kind": "OK", "reason": ""}
    # Order matters: BILLING → TOKEN → DOWN → BAD. BILLING and TOKEN are
    # checked first so "payment required" / "insufficient quota" don't fall
    # through into DOWN just because no other positive signal was found.
    # TOKEN and BILLING must never be classed as DOWN — switching models
    # won't fix an auth or credit problem.
    if _RE_BILLING.search(s):
        return {"kind": "BILLING", "reason": _first_keyword(s, _RE_BILLING) or "billing"}
    if _RE_TOKEN.search(s):
        return {"kind": "TOKEN", "reason": _first_keyword(s, _RE_TOKEN) or "auth"}
    if _RE_DOWN.search(s):
        return {"kind": "DOWN", "reason": _first_keyword(s, _RE_DOWN) or "down"}
    if _RE_BAD.search(s):
        return {"kind": "BAD", "reason": _first_keyword(s, _RE_BAD) or "bad_request"}
    # Unknown error strings default to DOWN — safer to swap models than to
    # wedge on a partial response. BAD/TOKEN/BILLING require positive signal.
    return {"kind": "DOWN", "reason": "unknown"}


def _first_keyword(text: str, pattern: re.Pattern) -> str:
    m = pattern.search(text or "")
    return (m.group(0) if m else "").lower().replace(" ", "_")[:40]


# ── Circuit breaker ──────────────────────────────────────────────────────────

def _key(model: str) -> str:
    return REDIS_KEY_PREFIX + (model or "unknown")


def is_model_live(model: str) -> bool:
    """True when the model may be tried. False when in cooldown."""
    if not model:
        return False
    try:
        r = _redis_client()
        cu = r.hget(_key(model), "cooldown_until")
        if not cu:
            return True
        until = _parse_iso(cu)
        if not until:
            return True
        return _now() >= until
    except Exception as e:
        logger.debug(f"model_health: is_model_live fallthrough for {model}: {e}")
        return True


def report_failure(model: str, reason: str, kind: str = "DOWN") -> None:
    """Record a failure; set cooldown_until with exponential back-off."""
    if not model:
        return
    # TOKEN/BILLING/BAD are deliberately NOT persisted as circuit trips —
    # they don't mean the provider is down, and we don't want to push the
    # user onto an alt-model just because their API key expired.
    if kind not in ("DOWN",):
        return
    try:
        r = _redis_client()
        k = _key(model)
        fails_raw = r.hget(k, "consecutive_fails") or "0"
        fails     = int(fails_raw) + 1
        wait      = min(COOLDOWN_BASE_SECONDS * (2 ** (fails - 1)), COOLDOWN_MAX_SECONDS)
        now       = _now()
        until     = now + timedelta(seconds=wait)
        r.hset(k, mapping={
            "status":             "down",
            "last_failure_at":    _iso(now),
            "last_failure_reason": (reason or "unknown")[:80],
            "cooldown_until":     _iso(until),
            "consecutive_fails":  str(fails),
        })
        r.expire(k, RECORD_TTL_SECONDS)
        logger.info(
            f"model_health: {model} DOWN ({reason}) — cooldown {wait}s "
            f"(fail #{fails}), resume at {_iso(until)}"
        )
    except Exception as e:
        logger.warning(f"model_health: report_failure for {model} failed: {e}")


def report_success(model: str) -> None:
    """Clear the cooldown + reset the failure counter."""
    if not model:
        return
    try:
        r = _redis_client()
        k = _key(model)
        r.hset(k, mapping={
            "status":            "ok",
            "cooldown_until":    "",
            "consecutive_fails": "0",
            "last_success_at":   _iso(_now()),
        })
        r.expire(k, RECORD_TTL_SECONDS)
    except Exception as e:
        logger.debug(f"model_health: report_success for {model} failed: {e}")


def snapshot(model: Optional[str] = None) -> Dict[str, Any]:
    """Return one model's snapshot or a dict of them for /models/status."""
    try:
        r = _redis_client()
        if model:
            raw = r.hgetall(_key(model)) or {}
            return _raw_to_snapshot(model, raw)
        # All known — scan prefixed keys
        out: Dict[str, Any] = {}
        for k in r.scan_iter(match=REDIS_KEY_PREFIX + "*"):
            m = k.replace(REDIS_KEY_PREFIX, "")
            out[m] = _raw_to_snapshot(m, r.hgetall(k) or {})
        return out
    except Exception as e:
        logger.error(f"model_health: snapshot failed: {e}")
        return {} if not model else _raw_to_snapshot(model or "unknown", {})


def _raw_to_snapshot(model: str, raw: Dict[str, str]) -> Dict[str, Any]:
    cu    = raw.get("cooldown_until") or ""
    until = _parse_iso(cu)
    live  = (not until) or (_now() >= until)
    return {
        "model":              model,
        "status":             "ok" if live else "down",
        "live":               live,
        "last_failure_at":    raw.get("last_failure_at", ""),
        "last_failure_reason": raw.get("last_failure_reason", ""),
        "cooldown_until":     cu,
        "consecutive_fails":  int(raw.get("consecutive_fails") or 0),
        "last_success_at":    raw.get("last_success_at", ""),
    }


# ── Debug helper: wipe a model's state (admin/dev only) ─────────────────────

def reset(model: str) -> None:
    """Operator-facing: clear all cooldown state for a model. Not a user flow."""
    if not model:
        return
    try:
        _redis_client().delete(_key(model))
        logger.info(f"model_health: reset {model}")
    except Exception as e:
        logger.warning(f"model_health: reset for {model} failed: {e}")
