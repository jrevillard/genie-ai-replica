"""
agent_audit_bridge — emit ApiAuditLog rows from the haystack agent path
=========================================================================
Why this exists:

  The gateway's "Jailbreak protection active" badge in the patient SPA
  polls /api/v1/public/security/status, whose `last_60_min.blocked`
  counter is sourced from the ArcadeDB ApiAuditLog vertex
  (components/api-gateway/app/audit.py:266).

  The gateway only writes that vertex for requests that hit ITS handlers
  (/api/v1/public/chat, /api/v1/public/translate). Real chat traffic
  goes through /api/v1/agent/chat and /api/v1/agent/chat-stream which
  the gateway forwards transparently — those bypass the gateway's
  audit write. So when haystack's app-layer jailbreak detector blocks
  a request, the badge counter never moved.

  This bridge fixes that by writing a minimal ApiAuditLog row from the
  haystack side every time the agent-layer jailbreak block fires. The
  badge counter then reflects ALL blocks regardless of which path the
  request took.

Design:

  * Best-effort. Never raises. A failed write must not break chat.
  * Uses the same vertex name + property shape as the gateway, so a
    single SELECT count(*) FROM ApiAuditLog WHERE blocked=true ...
    sums both sources.
  * No chain_hash on this side — the gateway maintains the genuine
    hash chain for its own writes; rows from haystack carry a
    "haystack-bridge" prev_chain_hash sentinel so an auditor can tell
    which subsystem wrote the row.
"""
from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any, Dict, Optional

from src.utils.arcade_client import command_sql

logger = logging.getLogger(__name__)


_BRIDGE_SENTINEL = "haystack-bridge"


def emit_block(
    *,
    endpoint: str,
    method: str = "POST",
    pattern: str = "",
    severity: str = "",
    snippet: str = "",
    caller_id: str = "anonymous",
    ip_hash: str = "",
    status_code: int = 200,
    request_size: int = 0,
) -> None:
    """Write a `blocked=True` audit row matching the gateway's schema.

    Called from agent_routes / streaming_routes when the application-layer
    jailbreak detector decides to short-circuit. Returns synchronously; the
    write is single-statement so it adds <50ms in the happy path.

    NEVER raises. A logging-only fallback runs if ArcadeDB is unreachable.
    """
    log_id    = f"AUDIT-{uuid.uuid4().hex[:12]}"
    timestamp = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())

    flags = json.dumps([{
        "type":     "jailbreak_pattern",
        "name":     pattern or "unknown",
        "severity": severity or "high",
        "snippet":  (snippet or "")[:120],
        "source":   "haystack_agent_layer",
    }], ensure_ascii=False)

    sql = (
        "INSERT INTO ApiAuditLog SET "
        "  log_id              = :log_id, "
        "  timestamp           = :timestamp, "
        "  caller_id           = :caller_id, "
        "  ip_hash             = :ip_hash, "
        "  endpoint            = :endpoint, "
        "  method              = :method, "
        "  status_code         = :status_code, "
        "  request_size        = :request_size, "
        "  response_size       = 0, "
        "  latency_ms          = 0.0, "
        "  security_flags      = :flags, "
        "  jailbreak_pattern   = :pattern, "
        "  jailbreak_severity  = :severity, "
        "  blocked             = true, "
        "  jwt_scopes          = '[]', "
        "  jwt_jti             = '', "
        "  auth_outcome        = 'n/a', "
        "  phi_redactions_count = 0, "
        "  phi_redaction_summary = '[]', "
        "  rate_limit_outcome  = 'n/a', "
        "  rate_limit_tier     = '', "
        "  rate_limit_remaining = 0, "
        "  prev_chain_hash     = :sentinel, "
        "  chain_hash          = ''"
    )

    params: Dict[str, Any] = {
        "log_id":       log_id,
        "timestamp":    timestamp,
        "caller_id":    caller_id or "anonymous",
        "ip_hash":      ip_hash or "",
        "endpoint":     endpoint or "",
        "method":       method or "POST",
        "status_code":  int(status_code or 200),
        "request_size": int(request_size or 0),
        "flags":        flags,
        "pattern":      pattern or "",
        "severity":     severity or "",
        "sentinel":     _BRIDGE_SENTINEL,
    }

    try:
        command_sql(sql, params)
    except Exception as exc:
        # The badge counter will under-count by this row, but chat must
        # not break. Log INFO not WARNING — this is expected if ArcadeDB
        # is briefly unavailable.
        logger.info("agent_audit_bridge: skip-on-error %s (%s)", type(exc).__name__, exc)
