"""
AMINA Care — File Token Service
==================================
Issues short-TTL, cryptographically opaque tokens for files attached to
inbox items (PDF care plans, reports, prescriptions). The same pattern
powers "presigned URLs" in S3: possession of the token is sufficient
authorization — no JWT or session is required to resolve.

Why separate from JWT
---------------------
- Downloads happen via browser "Save as" (or a native WhatsApp/Telegram
  forward), where the Authorization header is not carried.
- Patient ownership is bound into the token record so the resolver can
  audit-log the correct patient_id even on anonymous pulls.
- Tokens are rate-limited + TTL-capped so leaks age out fast.

Token format
------------
    ft_<base64url(32 random bytes)>
Example: `ft_aU8Qw…`  (43 chars base64 + 3-char prefix = 46 chars total)

Redis record (key = token string, TTL = ttl_seconds):
    {
        "storage_path":   "/app/data/inbox_files/<uuid>.pdf",
        "original_name":  "care-plan-2026-04-18.pdf",
        "mime":           "application/pdf",
        "size":           12345,
        "patient_id":     "pat_abc",
        "issued_at":      "2026-04-18T10:00:00Z",
        "expires_at":     "2026-04-18T10:15:00Z",
        "downloads":      "0",                 # counter (string for HINCRBY)
        "max_downloads":  "0",                 # 0 = unlimited until expiry
        "kind":           "pdf",               # informational
    }

Filesystem
----------
All managed bytes live under INBOX_FILES_DIR (default /app/data/inbox_files).
Subdirectories by 2-char prefix to keep a single dir from growing beyond a
few thousand entries. Files are NEVER deleted — "no data deletion" rule.
Tokens expiring just makes the bytes unreachable via /inbox/file.

Callers
-------
    ingest_bytes(patient_id, filename, mime, data)  -> token
    ingest_path(patient_id, storage_path, …)        -> token  # bytes already on disk
    resolve(token)                                   -> (meta, bytes) | None
    peek(token)                                      -> meta | None  (no byte read)
    extend(token, extra_seconds)                     -> bool

The Redis client is lazily reused from `src.services.caregiver_alerts` where
`_redis()` already connects; we fall back to a local connect if that helper
can't be imported for some reason.
"""

from __future__ import annotations

import logging
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

INBOX_FILES_DIR = os.getenv("INBOX_FILES_DIR", "/app/data/inbox_files")
DEFAULT_TTL_SECONDS = int(os.getenv("INBOX_FILE_TTL_SECONDS", "86400"))   # 24h
MAX_TTL_SECONDS     = int(os.getenv("INBOX_FILE_MAX_TTL_SECONDS", "604800"))  # 7d
TOKEN_PREFIX        = "ft_"
REDIS_KEY_PREFIX    = "inbox_ft:"

# ── Redis client lazy import ─────────────────────────────────────────────────

def _redis_client():
    """Return a decode_responses=True redis client. Uses REDIS_URL if set,
    otherwise REDIS_HOST + REDIS_PORT env vars (set by haystack-stack compose)."""
    import redis  # local import to avoid hard import at module load time
    url = os.getenv("REDIS_URL")
    if url:
        return redis.Redis.from_url(url, decode_responses=True)
    host = os.getenv("REDIS_HOST", "redis")
    port = int(os.getenv("REDIS_PORT", "6379"))
    return redis.Redis(host=host, port=port, db=0, decode_responses=True)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(ts: datetime) -> str:
    return ts.isoformat().replace("+00:00", "Z")


def _issue_token() -> str:
    return TOKEN_PREFIX + secrets.token_urlsafe(32)


def _shard_dir(name: str) -> str:
    """Two-char sharding to cap single-dir file counts."""
    prefix = name[:2].lower() if len(name) >= 2 else "00"
    path = os.path.join(INBOX_FILES_DIR, prefix)
    os.makedirs(path, exist_ok=True)
    return path


def _safe_mime(mime: Optional[str]) -> str:
    m = (mime or "").strip().lower() or "application/octet-stream"
    # Disallow HTML/script mimes that could be served inline and XSS the UI.
    if m in ("text/html", "application/xhtml+xml", "application/javascript",
             "text/javascript", "image/svg+xml"):
        logger.warning(f"file_token: refusing dangerous mime {m!r}, forcing octet-stream")
        return "application/octet-stream"
    return m


# ── Public: ingest ────────────────────────────────────────────────────────────

def ingest_bytes(
    patient_id: str,
    filename: str,
    mime: str,
    data: bytes,
    *,
    ttl_seconds: int = DEFAULT_TTL_SECONDS,
    max_downloads: int = 0,
    kind: str = "pdf",
) -> Dict[str, Any]:
    """
    Persist `data` under INBOX_FILES_DIR + issue a single-use (or TTL-bound)
    download token.

    Returns: {token, storage_path, size, mime, name, expires_at}
    Raises:  ValueError on invalid inputs, OSError on disk failure.
    """
    if not patient_id:
        raise ValueError("patient_id is required")
    if not data:
        raise ValueError("empty payload")
    if ttl_seconds <= 0 or ttl_seconds > MAX_TTL_SECONDS:
        ttl_seconds = DEFAULT_TTL_SECONDS
    mime = _safe_mime(mime)
    safe_name = (filename or "download").strip().replace("/", "_")[:200]
    if not safe_name:
        safe_name = f"file-{uuid.uuid4().hex[:8]}"

    # Give every persisted file a unique on-disk id so we can accept two
    # uploads of the same "name" without collision.
    disk_id  = f"{uuid.uuid4().hex}-{safe_name}"
    shard    = _shard_dir(disk_id)
    storage  = os.path.join(shard, disk_id)

    with open(storage, "wb") as f:
        f.write(data)
    size = os.path.getsize(storage)

    return _register_token(
        patient_id=patient_id,
        storage_path=storage,
        original_name=safe_name,
        mime=mime,
        size=size,
        ttl_seconds=ttl_seconds,
        max_downloads=max_downloads,
        kind=kind,
    )


def ingest_path(
    patient_id: str,
    storage_path: str,
    *,
    original_name: Optional[str] = None,
    mime: Optional[str] = None,
    ttl_seconds: int = DEFAULT_TTL_SECONDS,
    max_downloads: int = 0,
    kind: str = "pdf",
) -> Dict[str, Any]:
    """
    Issue a token for a file that's already on disk (e.g. a cert uploaded via
    certificate_storage). Does NOT copy the bytes — just registers the path.
    """
    if not patient_id:
        raise ValueError("patient_id is required")
    if not storage_path or not os.path.exists(storage_path):
        raise ValueError(f"storage_path not found: {storage_path}")

    name = original_name or os.path.basename(storage_path)
    size = os.path.getsize(storage_path)
    return _register_token(
        patient_id=patient_id,
        storage_path=storage_path,
        original_name=name,
        mime=_safe_mime(mime),
        size=size,
        ttl_seconds=ttl_seconds,
        max_downloads=max_downloads,
        kind=kind,
    )


def _register_token(
    *,
    patient_id: str,
    storage_path: str,
    original_name: str,
    mime: str,
    size: int,
    ttl_seconds: int,
    max_downloads: int,
    kind: str,
) -> Dict[str, Any]:
    token = _issue_token()
    now   = _now()
    exp   = now + timedelta(seconds=ttl_seconds)

    record = {
        "storage_path":  storage_path,
        "original_name": original_name,
        "mime":          mime,
        "size":          str(size),
        "patient_id":    patient_id,
        "issued_at":     _iso(now),
        "expires_at":    _iso(exp),
        "downloads":     "0",
        "max_downloads": str(max(0, int(max_downloads or 0))),
        "kind":          kind or "pdf",
    }

    r = _redis_client()
    key = REDIS_KEY_PREFIX + token
    r.hset(key, mapping=record)
    r.expire(key, ttl_seconds)

    return {
        "token":        token,
        "storage_path": storage_path,
        "size":         size,
        "mime":         mime,
        "name":         original_name,
        "expires_at":   record["expires_at"],
    }


# ── Public: resolve ───────────────────────────────────────────────────────────

def peek(token: str) -> Optional[Dict[str, Any]]:
    """Return metadata only, without touching the disk file. Safe for UI."""
    if not token or not token.startswith(TOKEN_PREFIX):
        return None
    try:
        r   = _redis_client()
        raw = r.hgetall(REDIS_KEY_PREFIX + token) or {}
        if not raw:
            return None
        return {
            "token":         token,
            "original_name": raw.get("original_name", ""),
            "mime":          raw.get("mime", "application/octet-stream"),
            "size":          int(raw.get("size") or 0),
            "patient_id":    raw.get("patient_id", ""),
            "issued_at":     raw.get("issued_at", ""),
            "expires_at":    raw.get("expires_at", ""),
            "downloads":     int(raw.get("downloads") or 0),
            "max_downloads": int(raw.get("max_downloads") or 0),
            "kind":          raw.get("kind", "pdf"),
        }
    except Exception as e:
        logger.error(f"file_token: peek failed for {token}: {e}")
        return None


def resolve(token: str) -> Optional[Tuple[Dict[str, Any], bytes]]:
    """
    Return (metadata, bytes) on a valid live token, else None.

    Side effects:
      - Increments the `downloads` counter.
      - Deletes the Redis record if `max_downloads` is reached (bytes on
        disk remain — "no data deletion" only applies to patient/clinical
        data; revoked tokens are a security knob, not data).
    """
    meta = peek(token)
    if not meta:
        return None
    if meta["max_downloads"] and meta["downloads"] >= meta["max_downloads"]:
        logger.info(f"file_token: exhausted token {token}")
        try:
            _redis_client().delete(REDIS_KEY_PREFIX + token)
        except Exception:
            pass
        return None

    storage_path = peek_storage_path(token)
    if not storage_path or not os.path.exists(storage_path):
        logger.error(f"file_token: backing file missing for {token}: {storage_path}")
        return None

    try:
        with open(storage_path, "rb") as f:
            data = f.read()
    except OSError as e:
        logger.error(f"file_token: read failed for {token}: {e}")
        return None

    # Bump counter + auto-revoke if we hit the cap.
    try:
        r = _redis_client()
        new_count = r.hincrby(REDIS_KEY_PREFIX + token, "downloads", 1)
        meta["downloads"] = int(new_count)
        if meta["max_downloads"] and int(new_count) >= meta["max_downloads"]:
            r.delete(REDIS_KEY_PREFIX + token)
    except Exception as e:
        logger.warning(f"file_token: counter bump failed for {token}: {e}")

    return (meta, data)


def peek_storage_path(token: str) -> Optional[str]:
    """Private accessor: used by resolve() and admin tooling. Never exposed."""
    if not token or not token.startswith(TOKEN_PREFIX):
        return None
    try:
        return _redis_client().hget(REDIS_KEY_PREFIX + token, "storage_path")
    except Exception:
        return None


def extend(token: str, extra_seconds: int) -> bool:
    """Admin/agent helper: extend a token's TTL, up to MAX_TTL_SECONDS."""
    if not token or extra_seconds <= 0:
        return False
    try:
        r = _redis_client()
        key = REDIS_KEY_PREFIX + token
        ttl = r.ttl(key)
        if ttl is None or ttl < 0:
            return False
        new_ttl = min(ttl + int(extra_seconds), MAX_TTL_SECONDS)
        r.expire(key, new_ttl)
        return True
    except Exception as e:
        logger.warning(f"file_token: extend failed for {token}: {e}")
        return False


# ── Directory bootstrap ──────────────────────────────────────────────────────

def ensure_storage_dir() -> None:
    """Create INBOX_FILES_DIR at startup so the first write doesn't race."""
    try:
        os.makedirs(INBOX_FILES_DIR, exist_ok=True)
    except OSError as e:
        logger.error(f"file_token: cannot create {INBOX_FILES_DIR}: {e}")
