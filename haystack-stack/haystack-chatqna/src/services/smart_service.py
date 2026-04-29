"""
AMINA Care — SMART-on-FHIR Authorization Server
==================================================
Minimal-yet-production-grade SMART App Launch implementation (v2). Enough
to make Amina embeddable in any SMART-on-FHIR-capable EHR or to be used as
a read-only FHIR endpoint by third-party apps (Apple Health, CMS BlueButton
apps, patient navigation apps).

Supported surface
-----------------
  GET  /.well-known/smart-configuration   — discovery
  GET  /smart/authorize                   — launch, validate, consent page
  POST /smart/approve                     — user approves consent
  GET  /smart/deny                        — user denies; redirect w/ error
  POST /smart/token                       — authorization_code -> JWT

Supports
--------
  - PKCE S256 (recommended by SMART v2)
  - public clients (mobile apps, SPAs) and confidential clients (via
    `client_secret` in basic-auth or form body)
  - `launch/patient` scope for EHR launch with `launch` context token
  - standalone launch (user-picker on consent page)

Access tokens
-------------
We issue standard JWTs signed with the existing JWT_SECRET (HS256). This
means the tokens are directly consumable by the existing FHIR routes in
src/api/fhir_routes.py without any changes there — the token's `sub`
claim is the patient_id, `fhirUser` is the URN, and `scope` lists granted
scopes. Duration: 1 hour by default, configurable.

State stores
------------
  pending_auth:<uuid>   — the authorization request, 10-minute TTL
  smart_code:<code>     — issued code, 10-minute TTL, single-use
  smart_launch:<token>  — EHR launch context (patient id + encounter id
                            + iss), 5-minute TTL

Client registry
---------------
Configured via the `SMART_CLIENTS` env var (JSON string) or defaults below.
Every client declares: client_id, display name, redirect_uris, allowed
scopes, optional client_secret (confidential), and requires_pkce boolean.

Audit
-----
Every token issuance logs: client_id, patient_id, scope, issued_at.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import secrets
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import jwt

from src.config import settings

logger = logging.getLogger(__name__)

# ── Config ───────────────────────────────────────────────────────────────────

ACCESS_TOKEN_TTL_SECONDS = int(os.getenv("SMART_ACCESS_TOKEN_TTL_SECONDS", "3600"))
CODE_TTL_SECONDS         = int(os.getenv("SMART_CODE_TTL_SECONDS", "600"))
LAUNCH_TTL_SECONDS       = int(os.getenv("SMART_LAUNCH_TTL_SECONDS", "300"))
PENDING_AUTH_TTL_SECONDS = int(os.getenv("SMART_PENDING_TTL_SECONDS", "600"))

SMART_BASE = os.getenv("SMART_PUBLIC_BASE", "http://localhost:8000")
FHIR_BASE  = os.getenv("SMART_FHIR_BASE",   "http://localhost:8000/api/v1/fhir")

SUPPORTED_SCOPES = (
    "openid",
    "profile",
    "fhirUser",
    "launch",
    "launch/patient",
    "patient/*.read",
    "patient/Patient.read",
    "patient/Observation.read",
    "patient/Condition.read",
    "patient/CarePlan.read",
    "patient/Encounter.read",
    "offline_access",
)

# ── Client registry ──────────────────────────────────────────────────────────

DEFAULT_CLIENTS: Dict[str, Dict[str, Any]] = {
    # Demo client wired into our own Postman / cURL test suite.
    "amina-demo-client": {
        "name":          "Amina Demo SMART Client",
        "redirect_uris": [
            "http://localhost:5173/smart/callback",
            "http://localhost:4000/smart/callback",
            "https://httpbin.org/anything",  # convenient dev sink
        ],
        "scopes":        list(SUPPORTED_SCOPES),
        "client_secret": None,               # public (PKCE required)
        "requires_pkce": True,
    },
    # Placeholder for a hospital EHR sandbox (e.g. Epic's sandbox). Real
    # deployment would register the EHR's exact redirect URIs here.
    "epic-sandbox": {
        "name":          "Epic SMART Sandbox",
        "redirect_uris": [
            "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/callback",
        ],
        "scopes":        list(SUPPORTED_SCOPES),
        "client_secret": None,
        "requires_pkce": True,
    },
}


def _load_clients() -> Dict[str, Dict[str, Any]]:
    raw = os.getenv("SMART_CLIENTS", "").strip()
    if not raw:
        return DEFAULT_CLIENTS
    try:
        overrides = json.loads(raw)
        merged = dict(DEFAULT_CLIENTS)
        if isinstance(overrides, dict):
            merged.update(overrides)
        return merged
    except Exception as e:
        logger.warning(f"smart: failed to parse SMART_CLIENTS env: {e}; using defaults")
        return DEFAULT_CLIENTS


CLIENTS: Dict[str, Dict[str, Any]] = _load_clients()


def get_client(client_id: str) -> Optional[Dict[str, Any]]:
    return CLIENTS.get((client_id or "").strip())


# ── Redis ────────────────────────────────────────────────────────────────────

def _redis_client():
    import redis
    url = os.getenv("REDIS_URL")
    if url:
        return redis.Redis.from_url(url, decode_responses=True)
    host = os.getenv("REDIS_HOST", "redis")
    port = int(os.getenv("REDIS_PORT", "6379"))
    return redis.Redis(host=host, port=port, db=0, decode_responses=True)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _now() -> int:
    return int(time.time())


def _random_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def _b64url_decode(s: str) -> bytes:
    padding = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode((s + padding).encode("ascii"))


def verify_pkce(verifier: str, challenge: str, method: str) -> bool:
    """Constant-time verification of PKCE (SMART v2 requires S256)."""
    method = (method or "S256").upper()
    if method == "PLAIN":
        # Accepted by the spec but not recommended; still support.
        return secrets.compare_digest(verifier or "", challenge or "")
    if method != "S256":
        return False
    try:
        digest = hashlib.sha256((verifier or "").encode("ascii")).digest()
        expected = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
        return secrets.compare_digest(expected, challenge or "")
    except Exception:
        return False


def validate_redirect_uri(client: Dict[str, Any], redirect_uri: str) -> bool:
    """Exact match only. No wildcards — SMART v2 requires exact."""
    return redirect_uri in (client.get("redirect_uris") or [])


def filter_scopes(requested: str, allowed: List[str]) -> str:
    """
    Trim requested scopes down to those the client is allowed to ask for.
    Unknown scopes are silently dropped. Returned string is space-joined.
    """
    req = [s.strip() for s in (requested or "").split() if s.strip()]
    granted = [s for s in req if s in allowed or s in SUPPORTED_SCOPES and s in allowed]
    return " ".join(granted)


# ── Launch context (EHR-initiated launch) ────────────────────────────────────

def stash_launch_context(
    *,
    patient_id: str,
    iss: str,
    encounter_id: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Creates a `launch` token the EHR passes through the authorize request.
    Our authorize endpoint resolves it back to the patient/encounter ids.
    """
    token = "lnc_" + _random_token(16)
    record = {
        "patient":    patient_id,
        "iss":        iss,
        "encounter":  encounter_id or "",
        "extra":      json.dumps(extra or {}),
        "created_at": str(_now()),
    }
    r = _redis_client()
    r.hset(f"smart_launch:{token}", mapping=record)
    r.expire(f"smart_launch:{token}", LAUNCH_TTL_SECONDS)
    return token


def resolve_launch_context(token: str) -> Optional[Dict[str, Any]]:
    if not token:
        return None
    try:
        r = _redis_client()
        raw = r.hgetall(f"smart_launch:{token}") or {}
    except Exception:
        return None
    if not raw:
        return None
    try:
        extra = json.loads(raw.get("extra") or "{}")
    except Exception:
        extra = {}
    return {
        "patient":   raw.get("patient", ""),
        "iss":       raw.get("iss", ""),
        "encounter": raw.get("encounter", ""),
        "extra":     extra,
    }


# ── Pending auth request (stash while user sees consent page) ────────────────

@dataclass
class AuthRequest:
    request_id:          str
    client_id:           str
    redirect_uri:        str
    scope:               str
    state:               str
    code_challenge:      str
    code_challenge_method: str
    aud:                 str
    launch_patient_id:   str
    launch_token:        str
    created_at:          int = field(default_factory=_now)
    # Populated after the user chooses a patient / grants consent:
    patient_id:          str = ""
    user_id:             str = ""     # AMINA patient or caregiver id
    user_role:           str = ""

    def to_raw(self) -> Dict[str, str]:
        return {k: str(v) for k, v in self.__dict__.items() if v is not None}

    @classmethod
    def from_raw(cls, raw: Dict[str, str]) -> "AuthRequest":
        return cls(
            request_id=raw.get("request_id", ""),
            client_id=raw.get("client_id", ""),
            redirect_uri=raw.get("redirect_uri", ""),
            scope=raw.get("scope", ""),
            state=raw.get("state", ""),
            code_challenge=raw.get("code_challenge", ""),
            code_challenge_method=raw.get("code_challenge_method", ""),
            aud=raw.get("aud", ""),
            launch_patient_id=raw.get("launch_patient_id", ""),
            launch_token=raw.get("launch_token", ""),
            created_at=int(raw.get("created_at") or _now()),
            patient_id=raw.get("patient_id", ""),
            user_id=raw.get("user_id", ""),
            user_role=raw.get("user_role", ""),
        )


def stash_auth_request(req: AuthRequest) -> None:
    r = _redis_client()
    k = f"pending_auth:{req.request_id}"
    r.hset(k, mapping=req.to_raw())
    r.expire(k, PENDING_AUTH_TTL_SECONDS)


def load_auth_request(request_id: str) -> Optional[AuthRequest]:
    if not request_id:
        return None
    try:
        raw = _redis_client().hgetall(f"pending_auth:{request_id}") or {}
    except Exception:
        return None
    if not raw:
        return None
    return AuthRequest.from_raw(raw)


def discard_auth_request(request_id: str) -> None:
    try:
        _redis_client().delete(f"pending_auth:{request_id}")
    except Exception:
        pass


# ── Authorization code issuance ──────────────────────────────────────────────

@dataclass
class CodeRecord:
    code:                str
    client_id:           str
    redirect_uri:        str
    scope:               str
    patient_id:          str
    user_id:             str
    user_role:           str
    code_challenge:      str
    code_challenge_method: str
    issued_at:           int = field(default_factory=_now)


def issue_code(pending: AuthRequest) -> str:
    """Swap a consented pending-auth into a one-time authorization code."""
    code = "ac_" + _random_token(24)
    rec = CodeRecord(
        code=code,
        client_id=pending.client_id,
        redirect_uri=pending.redirect_uri,
        scope=pending.scope,
        patient_id=pending.patient_id or pending.launch_patient_id,
        user_id=pending.user_id,
        user_role=pending.user_role or "patient",
        code_challenge=pending.code_challenge,
        code_challenge_method=pending.code_challenge_method,
    )
    r = _redis_client()
    r.hset(f"smart_code:{code}", mapping={k: str(v) for k, v in rec.__dict__.items()})
    r.expire(f"smart_code:{code}", CODE_TTL_SECONDS)
    logger.info(
        f"smart: issued code for client={rec.client_id} patient={rec.patient_id} "
        f"scope='{rec.scope}' user={rec.user_role}:{rec.user_id}"
    )
    return code


def consume_code(
    code: str,
    *,
    client_id: str,
    redirect_uri: str,
    code_verifier: Optional[str],
) -> Optional[CodeRecord]:
    """
    Validate + single-use consume. Returns the record on success, None on
    any validation failure.
    """
    if not code:
        return None
    r = _redis_client()
    key = f"smart_code:{code}"
    try:
        raw = r.hgetall(key) or {}
    except Exception:
        return None
    if not raw:
        return None
    rec = CodeRecord(
        code=raw.get("code", ""),
        client_id=raw.get("client_id", ""),
        redirect_uri=raw.get("redirect_uri", ""),
        scope=raw.get("scope", ""),
        patient_id=raw.get("patient_id", ""),
        user_id=raw.get("user_id", ""),
        user_role=raw.get("user_role", "patient"),
        code_challenge=raw.get("code_challenge", ""),
        code_challenge_method=raw.get("code_challenge_method", ""),
        issued_at=int(raw.get("issued_at") or _now()),
    )

    # Must match the original client + redirect exactly.
    if rec.client_id != client_id:
        logger.info(f"smart: code {code} client mismatch")
        return None
    if rec.redirect_uri != redirect_uri:
        logger.info(f"smart: code {code} redirect mismatch")
        return None

    # PKCE: required if the code was issued with a challenge.
    if rec.code_challenge:
        if not code_verifier:
            logger.info(f"smart: code {code} missing code_verifier")
            return None
        if not verify_pkce(code_verifier, rec.code_challenge, rec.code_challenge_method):
            logger.info(f"smart: code {code} pkce mismatch")
            return None

    # Single-use: delete regardless of outcome from here.
    try:
        r.delete(key)
    except Exception:
        pass
    return rec


# ── Token issuance ───────────────────────────────────────────────────────────

def issue_access_token(rec: CodeRecord) -> Dict[str, Any]:
    """
    Mint a JWT access token carrying SMART scopes + fhirUser. Format is
    compatible with the existing /api/v1/fhir/* routes so they keep
    working without modification.
    """
    now = _now()
    exp = now + ACCESS_TOKEN_TTL_SECONDS
    patient_id = rec.patient_id
    fhir_user  = f"urn:aminacare:patient:{patient_id}"

    payload = {
        "iss":        SMART_BASE,
        "sub":        patient_id,           # subject = patient id for FHIR routes
        "aud":        FHIR_BASE,
        "iat":        now,
        "exp":        exp,
        "scope":      rec.scope,
        "fhirUser":   fhir_user,
        "patient":    patient_id,
        "client_id":  rec.client_id,
        "user_role":  rec.user_role,        # usually "patient"
        "amina_smart": True,                # marker so fhir_routes can short-
                                            # circuit if they want to distinguish
                                            # SMART-issued tokens later.
    }
    access_token = jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")

    # id_token: only if openid was requested.
    id_token = ""
    if "openid" in (rec.scope or "").split():
        id_payload = {
            "iss":       SMART_BASE,
            "sub":       rec.user_id or patient_id,
            "aud":       rec.client_id,
            "iat":       now,
            "exp":       exp,
            "fhirUser":  fhir_user,
        }
        id_token = jwt.encode(id_payload, settings.JWT_SECRET, algorithm="HS256")

    logger.info(
        f"smart: issued access_token for {rec.client_id} "
        f"patient={patient_id} scope='{rec.scope}' ttl={ACCESS_TOKEN_TTL_SECONDS}s"
    )

    resp = {
        "access_token": access_token,
        "token_type":   "Bearer",
        "expires_in":   ACCESS_TOKEN_TTL_SECONDS,
        "scope":        rec.scope,
        "patient":      patient_id,
        "fhirUser":     fhir_user,
    }
    if id_token:
        resp["id_token"] = id_token
    return resp


# ── Discovery document ───────────────────────────────────────────────────────

def smart_configuration() -> Dict[str, Any]:
    return {
        "issuer":                 SMART_BASE,
        "authorization_endpoint": f"{SMART_BASE}/api/v1/smart/authorize",
        "token_endpoint":         f"{SMART_BASE}/api/v1/smart/token",
        "token_endpoint_auth_methods_supported": ["none", "client_secret_post", "client_secret_basic"],
        "scopes_supported":       list(SUPPORTED_SCOPES),
        "response_types_supported": ["code"],
        "grant_types_supported":    ["authorization_code"],
        "code_challenge_methods_supported": ["S256"],
        "capabilities": [
            "launch-ehr",
            "launch-standalone",
            "client-public",
            "client-confidential-symmetric",
            "context-standalone-patient",
            "context-ehr-patient",
            "context-ehr-encounter",
            "permission-patient",
            "sso-openid-connect",
        ],
    }
