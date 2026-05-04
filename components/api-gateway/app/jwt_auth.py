"""JWT issuance + verification (RS256).

Phase 2a deliverable. Asymmetric on purpose: even if the verification
public key leaks, an attacker can't forge tokens. Private key never
leaves the gateway process.

What this gives:
  * RS256 keypair, ephemeral by default (regenerated on every container
    restart) OR loaded from a mounted file path for production.
  * issue_token(subject, scopes, requester_ip, ttl) -> compact JWT
  * verify_token(token, required_scope, requester_ip) -> claims dict
    or raises a typed exception.
  * jti replay tracking: each token's jti is one-time-use; reuse
    rejected. Tracker is in-memory with TTL eviction.
  * IP binding: token claim contains sha256(ip); verification rejects
    if the requester's IP doesn't match.

Limitations to flag (Phase 2b / sprint backlog):
  * Ephemeral keys lose all valid tokens on restart. Production should
    mount a persistent key file (see config.GATEWAY_JWT_PRIVATE_KEY_PATH).
  * jti tracker is in-memory; multi-instance deployments will allow
    replay across instances. Move to Redis sliding-set when scaling.
  * No automatic key rotation. Add a kid header + key-version map
    when introducing rotation.
"""
from __future__ import annotations

import hashlib
import logging
import os
import time
import uuid
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from . import config, scopes as scope_module

logger = logging.getLogger(__name__)


# ── Key management ───────────────────────────────────────────────────

_PRIVATE_KEY_PEM: Optional[bytes] = None
_PUBLIC_KEY_PEM:  Optional[bytes] = None
_KEY_KID:         Optional[str] = None  # short id derived from public key


def _generate_keypair() -> tuple[bytes, bytes]:
    """Fresh RS256 keypair. PEM-encoded."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    priv_pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    pub_pem = key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return priv_pem, pub_pem


def _load_or_generate() -> None:
    global _PRIVATE_KEY_PEM, _PUBLIC_KEY_PEM, _KEY_KID
    path = config.GATEWAY_JWT_PRIVATE_KEY_PATH
    if path and os.path.exists(path):
        try:
            with open(path, "rb") as f:
                priv_pem = f.read()
            key = serialization.load_pem_private_key(priv_pem, password=None)
            pub_pem = key.public_key().public_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PublicFormat.SubjectPublicKeyInfo,
            )
            _PRIVATE_KEY_PEM = priv_pem
            _PUBLIC_KEY_PEM  = pub_pem
            _KEY_KID = hashlib.sha256(pub_pem).hexdigest()[:8]
            logger.info("jwt: loaded keypair from %s (kid=%s)", path, _KEY_KID)
            return
        except Exception as e:
            logger.warning(
                "jwt: failed to load keypair from %s (%s); generating ephemeral",
                path, e,
            )
    priv_pem, pub_pem = _generate_keypair()
    _PRIVATE_KEY_PEM = priv_pem
    _PUBLIC_KEY_PEM  = pub_pem
    _KEY_KID = hashlib.sha256(pub_pem).hexdigest()[:8]
    logger.warning(
        "jwt: ephemeral keypair generated (kid=%s). All tokens will "
        "become invalid on container restart. Set "
        "GATEWAY_JWT_PRIVATE_KEY_PATH to a mounted file for "
        "persistent tokens.", _KEY_KID,
    )


def public_key_pem() -> str:
    """For GET /api/v1/admin/jwt-public-key — anyone can fetch this."""
    if _PUBLIC_KEY_PEM is None:
        _load_or_generate()
    return _PUBLIC_KEY_PEM.decode("utf-8") if _PUBLIC_KEY_PEM else ""


def kid() -> str:
    if _KEY_KID is None:
        _load_or_generate()
    return _KEY_KID or ""


# ── jti replay tracker (in-memory) ───────────────────────────────────
# Single-instance only. For multi-instance deployments move to Redis.

_USED_JTI: Dict[str, float] = {}   # jti -> unix-ts-of-expiry
_USED_JTI_MAX = 100_000             # safety cap to bound memory


def _gc_jti() -> None:
    """Evict expired entries. Cheap because dict iter is O(n) but n is
    bounded by token TTL * issuance rate."""
    if len(_USED_JTI) < 1000:
        return  # not worth the scan
    now = time.time()
    expired = [k for k, exp in _USED_JTI.items() if exp <= now]
    for k in expired:
        _USED_JTI.pop(k, None)
    # Hard cap: if we still have too many, drop oldest half.
    if len(_USED_JTI) > _USED_JTI_MAX:
        ordered = sorted(_USED_JTI.items(), key=lambda kv: kv[1])
        for k, _ in ordered[: len(_USED_JTI) // 2]:
            _USED_JTI.pop(k, None)


def _jti_seen(jti: str) -> bool:
    return jti in _USED_JTI


def _jti_mark(jti: str, expires_at_unix: float) -> None:
    _gc_jti()
    _USED_JTI[jti] = expires_at_unix


# ── Issue + verify ───────────────────────────────────────────────────

ISSUER   = "amina-gateway"
AUDIENCE = "amina-api"


@dataclass
class IssuedToken:
    token:      str
    jti:        str
    subject:    str
    scopes:     List[str]
    expires_at: int   # unix
    kid:        str


class JWTError(Exception):
    """Base — has a public-safe ``code`` and ``status_code`` for HTTP."""
    code:        str = "jwt_error"
    status_code: int = 401


class TokenMissing(JWTError):
    code = "token_missing"
class TokenInvalid(JWTError):
    code = "token_invalid"
class TokenExpired(JWTError):
    code = "token_expired"
class TokenReplay(JWTError):
    code = "token_replay"
    status_code = 401
class ScopeDenied(JWTError):
    code = "scope_denied"
    status_code = 403
class IPBindingMismatch(JWTError):
    code = "ip_binding_mismatch"
    status_code = 401


def hash_ip(ip: str) -> str:
    if not ip:
        return ""
    return hashlib.sha256(ip.encode("utf-8")).hexdigest()[:16]


def issue_token(
    *,
    subject:        str,
    requested_scopes: List[str],
    requester_ip:   str,
    ttl_seconds:    int,
) -> IssuedToken:
    if _PRIVATE_KEY_PEM is None:
        _load_or_generate()
    now = int(time.time())
    granted = scope_module.validate_scopes(requested_scopes)
    payload: Dict[str, Any] = {
        "iss":     ISSUER,
        "aud":     AUDIENCE,
        "sub":     subject,
        "iat":     now,
        "exp":     now + ttl_seconds,
        "jti":     uuid.uuid4().hex,
        "scopes":  granted,
        "ip_hash": hash_ip(requester_ip),
    }
    token = jwt.encode(
        payload,
        _PRIVATE_KEY_PEM,
        algorithm="RS256",
        headers={"kid": _KEY_KID or ""},
    )
    return IssuedToken(
        token      = token,
        jti        = payload["jti"],
        subject    = subject,
        scopes     = granted,
        expires_at = payload["exp"],
        kid        = _KEY_KID or "",
    )


def verify_token(
    raw:           Optional[str],
    *,
    required_scope: str,
    requester_ip:   str,
) -> Dict[str, Any]:
    """Validate signature, expiry, audience, scope, ip-binding, and
    not-replayed. Returns the decoded claims dict on success.
    Raises a JWTError subclass on any failure."""
    if not raw:
        raise TokenMissing("Authorization header missing or malformed")

    if _PUBLIC_KEY_PEM is None:
        _load_or_generate()

    try:
        claims = jwt.decode(
            raw,
            _PUBLIC_KEY_PEM,
            algorithms=["RS256"],
            audience=AUDIENCE,
            issuer=ISSUER,
            options={"require": ["exp", "iat", "iss", "aud", "sub", "jti"]},
        )
    except jwt.ExpiredSignatureError:
        raise TokenExpired("Token expired")
    except jwt.InvalidTokenError as e:
        raise TokenInvalid(f"Token rejected: {e}")

    # Scope check.
    granted_scopes = claims.get("scopes") or []
    if required_scope not in granted_scopes:
        raise ScopeDenied(
            f"Token does not include scope '{required_scope}' "
            f"(has: {', '.join(granted_scopes) or 'none'})"
        )

    # IP binding check.
    if claims.get("ip_hash") and claims["ip_hash"] != hash_ip(requester_ip):
        raise IPBindingMismatch(
            "Token was issued to a different IP. Re-issue with current IP."
        )

    # Replay check.
    jti = claims.get("jti")
    if not jti:
        raise TokenInvalid("Token missing jti")
    if _jti_seen(jti):
        raise TokenReplay("Token already used (jti replay)")
    _jti_mark(jti, float(claims.get("exp", time.time() + 3600)))

    return claims


def parse_authorization_header(header_value: Optional[str]) -> Optional[str]:
    """Extract the bearer token from an Authorization header. Returns
    None if missing or not a bearer scheme."""
    if not header_value:
        return None
    parts = header_value.strip().split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip()
