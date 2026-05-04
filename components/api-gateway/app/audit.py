"""ApiAuditLog — ArcadeDB-backed tamper-evident audit log.

Mirrors the pattern from haystack-chatqna/src/translation_v4/stage8_telemetry.py:
  * lazy schema bootstrap on first persist
  * idempotent CREATE PROPERTY IF NOT EXISTS
  * fire-and-forget persist; failures never block the request

The hash chain links each log entry to the previous one
(sha256(prev_hash + this_log_data)) so a deletion or in-place edit
becomes detectable. This is a defence-in-depth mechanism, not a
cryptographic guarantee on its own — the chain root must be backed
up out-of-band for true tamper evidence.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import httpx

from . import config

logger = logging.getLogger(__name__)


_SCHEMA_BOOTSTRAPPED = False
_LAST_HASH = "GENESIS"   # in-memory chain head; lost on restart, but the
                         # chain still validates per-batch when the
                         # service is up. For prod-grade tamper evidence
                         # we'd seed _LAST_HASH from ArcadeDB on startup.

_SCHEMA_TYPE_SQL = "CREATE VERTEX TYPE ApiAuditLog IF NOT EXISTS"
_SCHEMA_PROPERTY_SQLS = [
    "CREATE PROPERTY ApiAuditLog.log_id              IF NOT EXISTS STRING",
    "CREATE PROPERTY ApiAuditLog.timestamp           IF NOT EXISTS STRING",
    "CREATE PROPERTY ApiAuditLog.caller_id           IF NOT EXISTS STRING",
    "CREATE PROPERTY ApiAuditLog.ip_hash             IF NOT EXISTS STRING",
    "CREATE PROPERTY ApiAuditLog.endpoint            IF NOT EXISTS STRING",
    "CREATE PROPERTY ApiAuditLog.method              IF NOT EXISTS STRING",
    "CREATE PROPERTY ApiAuditLog.status_code         IF NOT EXISTS INTEGER",
    "CREATE PROPERTY ApiAuditLog.request_size        IF NOT EXISTS INTEGER",
    "CREATE PROPERTY ApiAuditLog.response_size       IF NOT EXISTS INTEGER",
    "CREATE PROPERTY ApiAuditLog.latency_ms          IF NOT EXISTS DOUBLE",
    "CREATE PROPERTY ApiAuditLog.security_flags      IF NOT EXISTS STRING",
    "CREATE PROPERTY ApiAuditLog.jailbreak_pattern   IF NOT EXISTS STRING",
    "CREATE PROPERTY ApiAuditLog.jailbreak_severity  IF NOT EXISTS STRING",
    "CREATE PROPERTY ApiAuditLog.blocked             IF NOT EXISTS BOOLEAN",
    # Phase 2a additions:
    "CREATE PROPERTY ApiAuditLog.jwt_scopes          IF NOT EXISTS STRING",
    "CREATE PROPERTY ApiAuditLog.jwt_jti             IF NOT EXISTS STRING",
    "CREATE PROPERTY ApiAuditLog.auth_outcome        IF NOT EXISTS STRING",
    # Phase 3 additions (PHI redactor):
    "CREATE PROPERTY ApiAuditLog.phi_redactions_count IF NOT EXISTS INTEGER",
    "CREATE PROPERTY ApiAuditLog.phi_redaction_summary IF NOT EXISTS STRING",
    # Phase 4 additions (rate limit):
    "CREATE PROPERTY ApiAuditLog.rate_limit_outcome  IF NOT EXISTS STRING",
    "CREATE PROPERTY ApiAuditLog.rate_limit_tier     IF NOT EXISTS STRING",
    "CREATE PROPERTY ApiAuditLog.rate_limit_remaining IF NOT EXISTS INTEGER",
    "CREATE PROPERTY ApiAuditLog.chain_hash          IF NOT EXISTS STRING",
    "CREATE PROPERTY ApiAuditLog.prev_chain_hash     IF NOT EXISTS STRING",
]


@dataclass
class AuditEntry:
    log_id:             str = field(default_factory=lambda: f"AUDIT-{uuid.uuid4().hex[:12]}")
    timestamp:          str = ""
    caller_id:          str = "anonymous"
    ip_hash:            str = ""
    endpoint:           str = ""
    method:             str = ""
    status_code:        int = 0
    request_size:       int = 0
    response_size:      int = 0
    latency_ms:         float = 0.0
    security_flags:     str = "[]"
    jailbreak_pattern:  str = ""
    jailbreak_severity: str = ""
    blocked:            bool = False
    # Phase 2a:
    jwt_scopes:         str = ""    # JSON-encoded list of granted scopes
    jwt_jti:            str = ""
    auth_outcome:       str = ""    # "ok" | "missing" | "invalid" | "expired" | "scope_denied" | "ip_mismatch" | "replay" | "n/a"
    # Phase 3:
    phi_redactions_count:  int = 0
    phi_redaction_summary: str = "[]"   # JSON list of {field, pattern, action, severity}
    # Phase 4:
    rate_limit_outcome:    str = "n/a"  # "allowed" | "throttled_burst" | "throttled_ip" | "throttled_caller" | "n/a"
    rate_limit_tier:       str = ""
    rate_limit_remaining:  int = 0
    chain_hash:         str = ""
    prev_chain_hash:    str = ""


def hash_ip(ip: str) -> str:
    if not ip:
        return ""
    return hashlib.sha256(ip.encode("utf-8")).hexdigest()[:16]


def _compute_chain_hash(entry: AuditEntry) -> str:
    """sha256(prev_chain_hash || canonical-json-of-entry-without-chain_hash).

    Produces a hex digest. Truncated to 32 chars to keep the audit
    table compact; full 64 is overkill at our volume.
    """
    payload = {
        "log_id":             entry.log_id,
        "timestamp":          entry.timestamp,
        "caller_id":          entry.caller_id,
        "ip_hash":            entry.ip_hash,
        "endpoint":           entry.endpoint,
        "method":             entry.method,
        "status_code":        entry.status_code,
        "request_size":       entry.request_size,
        "response_size":      entry.response_size,
        "latency_ms":         round(entry.latency_ms, 3),
        "security_flags":     entry.security_flags,
        "jailbreak_pattern":  entry.jailbreak_pattern,
        "jailbreak_severity": entry.jailbreak_severity,
        "blocked":            entry.blocked,
        "jwt_scopes":              entry.jwt_scopes,
        "jwt_jti":                 entry.jwt_jti,
        "auth_outcome":            entry.auth_outcome,
        "phi_redactions_count":    entry.phi_redactions_count,
        "phi_redaction_summary":   entry.phi_redaction_summary,
        "rate_limit_outcome":      entry.rate_limit_outcome,
        "rate_limit_tier":         entry.rate_limit_tier,
        "rate_limit_remaining":    entry.rate_limit_remaining,
        "prev_chain_hash":         entry.prev_chain_hash,
    }
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()[:32]


# ── ArcadeDB client (httpx async, mirrors arcade_client.py shape) ─────

_ARCADE_CLIENT: Optional[httpx.AsyncClient] = None


def _get_client() -> httpx.AsyncClient:
    global _ARCADE_CLIENT
    if _ARCADE_CLIENT is None or _ARCADE_CLIENT.is_closed:
        _ARCADE_CLIENT = httpx.AsyncClient(
            timeout=httpx.Timeout(10.0, connect=5.0),
            auth=(config.ARCADE_USER, config.ARCADE_PASS),
        )
    return _ARCADE_CLIENT


async def _arcade_command(sql: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    url = f"{config.ARCADE_URL}/api/v1/command/{config.ARCADE_DB}"
    payload: Dict[str, Any] = {"language": "sql", "command": sql}
    if params:
        payload["params"] = params
    r = await _get_client().post(url, json=payload)
    r.raise_for_status()
    return r.json()


async def bootstrap_schema() -> bool:
    """Idempotent. Safe to call multiple times. Returns True on success."""
    global _SCHEMA_BOOTSTRAPPED
    if _SCHEMA_BOOTSTRAPPED:
        return True
    try:
        await _arcade_command(_SCHEMA_TYPE_SQL)
        for stmt in _SCHEMA_PROPERTY_SQLS:
            try:
                await _arcade_command(stmt)
            except Exception as e:
                # ArcadeDB versions vary on whether IF NOT EXISTS is
                # honoured for CREATE PROPERTY — tolerate per-property
                # failure as long as the type itself was created.
                logger.debug("audit: property stmt skipped: %s", e)
        _SCHEMA_BOOTSTRAPPED = True
        logger.info("audit: ApiAuditLog schema ready")
        return True
    except Exception as e:
        logger.warning("audit: schema bootstrap failed (%s: %s)", type(e).__name__, e)
        return False


async def write(entry: AuditEntry) -> None:
    """Fire-and-forget. Never raises. Never blocks the request path."""
    global _LAST_HASH
    if not config.AUDIT_LOG_ENABLED:
        return

    if not entry.timestamp:
        entry.timestamp = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    entry.prev_chain_hash = _LAST_HASH
    entry.chain_hash      = _compute_chain_hash(entry)
    _LAST_HASH = entry.chain_hash

    # Always log a structured line — even if ArcadeDB is unreachable.
    log_blob = {
        "log_id":             entry.log_id,
        "ts":                 entry.timestamp,
        "caller":             entry.caller_id,
        "endpoint":           entry.endpoint,
        "status":             entry.status_code,
        "blocked":            entry.blocked,
        "jailbreak_pattern":  entry.jailbreak_pattern or None,
        "jailbreak_severity": entry.jailbreak_severity or None,
        "latency_ms":         round(entry.latency_ms, 1),
    }
    if entry.blocked:
        logger.warning("[GATEWAY_AUDIT_BLOCK] %s", json.dumps(log_blob))
    else:
        logger.info("[GATEWAY_AUDIT] %s", json.dumps(log_blob))

    if not await bootstrap_schema():
        return

    try:
        sets = ", ".join(f"{k} = :{k}" for k in (
            "log_id", "timestamp", "caller_id", "ip_hash", "endpoint",
            "method", "status_code", "request_size", "response_size",
            "latency_ms", "security_flags", "jailbreak_pattern",
            "jailbreak_severity", "blocked",
            "jwt_scopes", "jwt_jti", "auth_outcome",
            "phi_redactions_count", "phi_redaction_summary",
            "rate_limit_outcome", "rate_limit_tier", "rate_limit_remaining",
            "chain_hash", "prev_chain_hash",
        ))
        params = {
            "log_id":                 entry.log_id,
            "timestamp":              entry.timestamp,
            "caller_id":              entry.caller_id,
            "ip_hash":                entry.ip_hash,
            "endpoint":               entry.endpoint,
            "method":                 entry.method,
            "status_code":            entry.status_code,
            "request_size":           entry.request_size,
            "response_size":          entry.response_size,
            "latency_ms":             round(entry.latency_ms, 3),
            "security_flags":         entry.security_flags,
            "jailbreak_pattern":      entry.jailbreak_pattern,
            "jailbreak_severity":     entry.jailbreak_severity,
            "blocked":                entry.blocked,
            "jwt_scopes":             entry.jwt_scopes,
            "jwt_jti":                entry.jwt_jti,
            "auth_outcome":           entry.auth_outcome,
            "phi_redactions_count":   entry.phi_redactions_count,
            "phi_redaction_summary":  entry.phi_redaction_summary,
            "rate_limit_outcome":     entry.rate_limit_outcome,
            "rate_limit_tier":        entry.rate_limit_tier,
            "rate_limit_remaining":   entry.rate_limit_remaining,
            "chain_hash":             entry.chain_hash,
            "prev_chain_hash":        entry.prev_chain_hash,
        }
        await _arcade_command(f"CREATE VERTEX ApiAuditLog SET {sets}", params)
    except Exception as e:
        logger.debug("audit: persist failed (%s: %s)", type(e).__name__, e)


# ── Read-side helpers (used by /security/status) ──────────────────────

async def recent_block_count(window_minutes: int = 60) -> int:
    """Count blocked requests in the last N minutes. Best-effort."""
    if not _SCHEMA_BOOTSTRAPPED:
        ok = await bootstrap_schema()
        if not ok:
            return 0
    try:
        cutoff = time.strftime(
            "%Y-%m-%dT%H:%M:%S.000Z",
            time.gmtime(time.time() - window_minutes * 60),
        )
        resp = await _arcade_command(
            "SELECT count(*) AS n FROM ApiAuditLog "
            "WHERE blocked = true AND timestamp > :cutoff",
            {"cutoff": cutoff},
        )
        rows = resp.get("result") or []
        if rows:
            return int(rows[0].get("n", 0))
    except Exception as e:
        logger.debug("audit: block count query failed (%s)", e)
    return 0


async def recent_total_count(window_minutes: int = 60) -> int:
    if not _SCHEMA_BOOTSTRAPPED:
        ok = await bootstrap_schema()
        if not ok:
            return 0
    try:
        cutoff = time.strftime(
            "%Y-%m-%dT%H:%M:%S.000Z",
            time.gmtime(time.time() - window_minutes * 60),
        )
        resp = await _arcade_command(
            "SELECT count(*) AS n FROM ApiAuditLog WHERE timestamp > :cutoff",
            {"cutoff": cutoff},
        )
        rows = resp.get("result") or []
        if rows:
            return int(rows[0].get("n", 0))
    except Exception as e:
        logger.debug("audit: total count query failed (%s)", e)
    return 0
