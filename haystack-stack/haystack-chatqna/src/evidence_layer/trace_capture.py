"""
Evidence Layer — privacy-safe trace capture.

Hard rules:
  * Never store the raw user message. Only its character length.
  * Never store phone numbers, patient names, or full patient IDs —
    only sha256[:10] hashes salted with AMINA_EVIDENCE_HASH_SALT.
  * Never store raw tool output. Only tool *names* used.
  * On any persistence failure, drop the trace silently. Chat must
    never be impacted by tracing.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from src.evidence_layer.config import (
    AMINA_EVIDENCE_HASH_SALT,
    AMINA_EVIDENCE_MAX_FIELD_LEN,
    AMINA_EVIDENCE_REPORTS_DIR,
    AMINA_EVIDENCE_TRACE_ENABLED,
)
from src.evidence_layer.models import EvidenceTrace
from src.evidence_layer import state as _state

logger = logging.getLogger("evidence_layer.trace_capture")

_jsonl_lock = threading.RLock()

# Fields that NEVER make it into a trace, even if they appear upstream.
_FORBIDDEN_KEYS = frozenset({
    "message", "user_message", "raw_message", "text", "content", "prompt",
    "phone", "phone_number", "patient_name", "name", "full_name",
    "patient_id", "patientId", "session_id", "jwt", "token", "authorization",
    "access_token", "refresh_token", "secret", "api_key",
    "tool_output", "tool_outputs", "raw_response", "raw_tool_result",
})


# ── Hashing ────────────────────────────────────────────────────────
def hash_id(value: Optional[str]) -> str:
    """sha256[:10] of (salt + value). Empty in -> empty out."""
    if not value:
        return ""
    h = hashlib.sha256()
    h.update((AMINA_EVIDENCE_HASH_SALT or "").encode("utf-8"))
    h.update(b"|")
    h.update(str(value).encode("utf-8"))
    return h.hexdigest()[:10]


# ── Redaction ──────────────────────────────────────────────────────
def _truncate(v: Any) -> Any:
    if isinstance(v, str) and len(v) > AMINA_EVIDENCE_MAX_FIELD_LEN:
        return v[:AMINA_EVIDENCE_MAX_FIELD_LEN] + "…"
    return v


def redact_trace(event: Dict[str, Any]) -> Dict[str, Any]:
    """Drop forbidden keys, truncate strings, keep scalars only.

    Accepts arbitrary dicts. Returns a new dict that is safe to log.
    """
    if not isinstance(event, dict):
        return {}
    out: Dict[str, Any] = {}
    for k, v in event.items():
        if not isinstance(k, str):
            continue
        kl = k.lower()
        if kl in _FORBIDDEN_KEYS:
            continue
        # Drop any key that looks like an auth header.
        if "secret" in kl or "token" in kl or "authorization" in kl or "api_key" in kl:
            continue
        if isinstance(v, dict):
            # Allow a shallow nested dict for things like kwargs, but redact it too.
            out[k] = redact_trace(v)
        elif isinstance(v, (list, tuple)):
            out[k] = [_truncate(x) if isinstance(x, (str, int, float, bool)) else
                      (redact_trace(x) if isinstance(x, dict) else None)
                      for x in v]
        elif isinstance(v, (str, int, float, bool)) or v is None:
            out[k] = _truncate(v)
        # Anything else (custom objects) is dropped.
    return out


# ── Trace builder ──────────────────────────────────────────────────
def _safe_provider_from_result(result: Any) -> Optional[str]:
    if isinstance(result, dict):
        for k in ("provider", "llm_provider", "model_provider"):
            v = result.get(k)
            if isinstance(v, str) and v:
                return v
    return None


def _safe_latency_from_result(result: Any) -> Optional[float]:
    if isinstance(result, dict):
        for k in ("latency_ms", "duration_ms", "elapsed_ms"):
            v = result.get(k)
            if isinstance(v, (int, float)) and v >= 0:
                return float(v)
    return None


def _safety_flags_from_result(result: Any) -> List[str]:
    flags: List[str] = []
    if isinstance(result, dict):
        for k in ("safety_flags", "policy_flags", "risk_flags"):
            v = result.get(k)
            if isinstance(v, list):
                flags.extend(str(x)[:64] for x in v if isinstance(x, (str, int, float)))
        if result.get("is_emergency"):
            flags.append("is_emergency")
    return flags[:16]


def _tools_from_result(result: Any) -> List[str]:
    if isinstance(result, dict):
        v = result.get("tools_used")
        if isinstance(v, list):
            # tool *names* only, never tool outputs
            return [str(x)[:64] for x in v if isinstance(x, str)][:32]
    return []


def build_trace(
    *,
    request: Dict[str, Any],
    result: Any,
    latency_ms: float,
    error_kind: Optional[str] = None,
) -> EvidenceTrace:
    """Construct a privacy-safe trace from a process_message round-trip."""
    res_latency = _safe_latency_from_result(result)
    final_latency = res_latency if res_latency is not None else float(latency_ms or 0.0)

    # routing/intent/domain — best-effort scrape
    route = None
    intent = None
    domain_hint = None
    triage_level = None
    is_emergency = False
    fallback_used = False
    cost_estimate = None
    if isinstance(result, dict):
        route        = (result.get("routing_source") or result.get("route")) or None
        intent       = result.get("intention") or result.get("intent") or None
        domain_hint  = result.get("domain_hint") or None
        triage_level = result.get("triage_level") or None
        is_emergency = bool(result.get("is_emergency"))
        fallback_used = bool(result.get("fallback_used") or result.get("provider_fallback"))
        v = result.get("cost_estimate_usd")
        if isinstance(v, (int, float)) and v >= 0:
            cost_estimate = float(v)

    return EvidenceTrace(
        trace_id          = uuid.uuid4().hex,
        timestamp         = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        session_hash      = hash_id(request.get("session_id")),
        patient_hash      = hash_id(request.get("patient_id")) if request.get("patient_id") else None,
        role              = (request.get("user_role") or "")[:24],
        mode              = request.get("mode"),
        channel           = (request.get("channel") or "web")[:24],
        provider          = _safe_provider_from_result(result),
        fallback_used     = fallback_used,
        latency_ms        = final_latency,
        route             = route,
        intent            = intent,
        domain_hint       = domain_hint,
        triage_level      = triage_level,
        is_emergency      = is_emergency,
        safety_flags      = _safety_flags_from_result(result),
        tools_used        = _tools_from_result(result),
        cost_estimate_usd = cost_estimate,
        error_kind        = error_kind,
        user_message_len  = len(str(request.get("message") or "")),
    )


# ── Persistence (JSONL) ────────────────────────────────────────────
def _jsonl_path() -> str:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    base = AMINA_EVIDENCE_REPORTS_DIR
    folder = os.path.join(base, "traces")
    try:
        os.makedirs(folder, exist_ok=True)
    except Exception:
        folder = os.path.join("/tmp", "amina_evidence_traces")
        os.makedirs(folder, exist_ok=True)
    return os.path.join(folder, f"traces-{today}.jsonl")


def _persist_jsonl(trace_dict: Dict[str, Any]) -> None:
    try:
        path = _jsonl_path()
        line = json.dumps(trace_dict, default=str, ensure_ascii=False)
        with _jsonl_lock:
            with open(path, "a", encoding="utf-8") as f:
                f.write(line + "\n")
    except Exception as e:
        logger.debug("[evidence] jsonl persist failed: %s", e)


# ── Public capture ─────────────────────────────────────────────────
def capture_trace(
    *,
    request: Dict[str, Any],
    result: Any,
    latency_ms: float,
    error_kind: Optional[str] = None,
) -> Optional[EvidenceTrace]:
    """Build, redact, persist. Returns the EvidenceTrace or None on
    failure. NEVER raises."""
    if not AMINA_EVIDENCE_TRACE_ENABLED:
        return None
    try:
        trace = build_trace(
            request=request, result=result,
            latency_ms=latency_ms, error_kind=error_kind,
        )
    except Exception as e:
        logger.debug("[evidence] build_trace failed: %s", e)
        return None
    # Redaction is defense in depth — build_trace already strips
    # everything sensitive, but we run redact_trace once more.
    try:
        safe = redact_trace(trace.to_dict())
    except Exception as e:
        logger.debug("[evidence] redact failed: %s", e)
        return None
    try:
        _state.push_recent_trace(safe)
    except Exception:
        pass
    try:
        _persist_jsonl(safe)
    except Exception:
        pass
    return trace
