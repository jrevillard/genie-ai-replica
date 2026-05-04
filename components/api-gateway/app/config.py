"""Gateway configuration. All values are env-driven; sane defaults for dev."""
from __future__ import annotations

import os


def _bool(name: str, default: bool) -> bool:
    raw = (os.environ.get(name) or "").strip().lower()
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    return default


# Master flag. False -> service exits at startup with a friendly log.
# Default true so the gateway is part of the demo by default.
GATEWAY_ENABLED = _bool("AMINA_GATEWAY_ENABLED", True)

# Where to forward validated requests.
BACKEND_URL = os.environ.get(
    "AMINA_BACKEND_URL", "http://haystack-chatqna:8000",
).rstrip("/")

# Bind address + port.
HOST = os.environ.get("AMINA_GATEWAY_HOST", "0.0.0.0")
PORT = int(os.environ.get("AMINA_GATEWAY_PORT", "8443"))

# ArcadeDB for audit log (mirrors translation_v4/stage8_telemetry).
ARCADE_URL = os.environ.get("ARCADEDB_URL", "http://arcadedb:2480").rstrip("/")
ARCADE_DB  = os.environ.get("ARCADEDB_DB",  "genie")
ARCADE_USER = os.environ.get("ARCADEDB_USER", "root")
ARCADE_PASS = os.environ.get("ARCADEDB_ROOT_PASSWORD", "genieRoot123")

# Audit toggles.
AUDIT_LOG_ENABLED = _bool("AMINA_GATEWAY_AUDIT_ENABLED", True)
JAILBREAK_DETECTION_ENABLED = _bool("AMINA_GATEWAY_JAILBREAK_ENABLED", True)

# Per-endpoint body-size caps (bytes). Schema validation runs after this.
MAX_BODY_BYTES_CHAT      = int(os.environ.get("AMINA_GATEWAY_MAX_CHAT_BYTES", "10240"))   # 10KB
MAX_BODY_BYTES_TRANSLATE = int(os.environ.get("AMINA_GATEWAY_MAX_TRANSLATE_BYTES", "51200"))  # 50KB

# Backend request timeout (seconds). Long enough for v4.2 30-sentence
# warm path (~2.2 s) + Mandinka TTS (handled by separate :5501 path).
PROXY_TIMEOUT_S = float(os.environ.get("AMINA_GATEWAY_PROXY_TIMEOUT_S", "120"))

# ── Phase 2a: JWT auth ────────────────────────────────────────────────
# Master toggle. False -> /api/v1/public/chat + /translate run with NO
# JWT requirement. Useful only for local debug / smoke testing; default
# true so federation callers must always authenticate.
JWT_ENABLED = _bool("AMINA_GATEWAY_JWT_ENABLED", True)

# Path to a mounted RS256 PEM private key (PKCS8). When unset or the
# file is missing, the gateway generates an ephemeral keypair at boot
# and logs a warning -- tokens issued before a restart become invalid
# after. Mount a persistent file in production.
GATEWAY_JWT_PRIVATE_KEY_PATH = os.environ.get(
    "AMINA_GATEWAY_JWT_PRIVATE_KEY_PATH", "",
)

# Default token TTL on /admin/issue-token. Callers can request shorter
# (never longer) via the request body. 1 hour mirrors the original
# Phase 2 spec ("expiry: 3600").
DEFAULT_TOKEN_TTL_S = int(os.environ.get("AMINA_GATEWAY_TOKEN_TTL_S", "3600"))
MAX_TOKEN_TTL_S     = int(os.environ.get("AMINA_GATEWAY_MAX_TOKEN_TTL_S", "28800"))

# Admin secret guarding /admin/issue-token. When unset we generate a
# random hex per process and log it ONCE so a fresh dev container can
# still issue tokens. In production this MUST be set explicitly so
# admins can run scripts/issue_token.py from outside the container.
import secrets as _secrets  # noqa: E402  (lazy import keeps cold-start fast)
ADMIN_SECRET = (os.environ.get("AMINA_GATEWAY_ADMIN_SECRET") or "").strip()
_ADMIN_SECRET_GENERATED = False
if not ADMIN_SECRET:
    ADMIN_SECRET = _secrets.token_hex(24)
    _ADMIN_SECRET_GENERATED = True

# ── Phase 4: L2 adaptive rate limit ───────────────────────────────────
# DEFAULT OFF on purpose. The UNICC demo flow runs through the gateway
# during evaluation; a misconfigured threshold would 429 a tester at
# the worst possible moment. Operators flip this to true in production
# (or in `.env` for staged testing).
RATE_LIMIT_ENABLED = _bool("AMINA_GATEWAY_RATE_LIMIT_ENABLED", False)

# Redis URL. Default points at the same amina-redis container the
# rest of AMINA uses. The gateway falls back to in-memory counters
# when Redis is unreachable so a Redis outage doesn't take the
# gateway with it (BUG-016 pattern).
RATE_LIMIT_REDIS_URL = os.environ.get(
    "AMINA_GATEWAY_RATE_LIMIT_REDIS_URL",
    "redis://amina-redis:6379/3",   # /3 keeps gw counters off shared dbs 0/1/2
)


def snapshot() -> dict:
    """Single source of truth for /security/status + ops debug.

    NEVER include the admin secret or private key in this output --
    /security/status is public.
    """
    return {
        "gateway_enabled":            GATEWAY_ENABLED,
        "backend_url":                BACKEND_URL,
        "audit_log_enabled":          AUDIT_LOG_ENABLED,
        "jailbreak_detection_enabled": JAILBREAK_DETECTION_ENABLED,
        "jwt_enabled":                JWT_ENABLED,
        "default_token_ttl_s":        DEFAULT_TOKEN_TTL_S,
        "max_token_ttl_s":            MAX_TOKEN_TTL_S,
        "rate_limit_enabled":         RATE_LIMIT_ENABLED,
        "max_body_bytes": {
            "chat":      MAX_BODY_BYTES_CHAT,
            "translate": MAX_BODY_BYTES_TRANSLATE,
        },
        "proxy_timeout_s":            PROXY_TIMEOUT_S,
    }
