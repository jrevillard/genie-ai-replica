# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""
Keycloak JWT token validator for ChatQnA service.

Validates Bearer tokens forwarded by the backend using JWKS.
Provides defense-in-depth: each service validates tokens independently.
"""

import asyncio
import logging
import os
from datetime import UTC, datetime

import httpx
from jose import JWSError, jwt

logger = logging.getLogger("GENIE.AI_CHATQNA")

KEYCLOAK_URL = os.getenv("KEYCLOAK_URL", "http://keycloak:8080")
KC_REALM = os.getenv("KC_REALM", "genie")
KEYCLOAK_INTERNAL_URL = os.getenv("KEYCLOAK_INTERNAL_URL", "http://keycloak:8080")

# JWKS cache + single-flight lock. JWKS validation runs on every authenticated
# request, so concurrent requests at the TTL boundary must coalesce into a single
# Keycloak fetch instead of each issuing its own GET /certs request.
_jwks_keys: list | None = None
_jwks_fetched_at: float = 0.0
_JWKS_CACHE_TTL = 300  # 5 minutes
# One lock per running event loop. ``asyncio.Lock`` binds to whichever loop
# created it; pytest-asyncio spawns a fresh loop per test, so a module-level
# lock breaks across the second test. Key by ``id(loop)`` to stay portable.
#
# The dict lookup + ``Lock()`` construction between awaits is single-threaded by
# asyncio's cooperative scheduling, so the get-or-create is race-free within one
# loop. In rare CPython builds the same address could be reused after a loop is
# GC'd; the operational impact is one extra Keycloak fetch on the next cold
# request, not a correctness bug.
_jwks_locks: dict[int, asyncio.Lock] = {}


def _jwks_lock() -> asyncio.Lock:
    """Return the single-flight lock bound to the current running event loop."""
    loop = asyncio.get_running_loop()
    lock = _jwks_locks.get(id(loop))
    if lock is None:
        lock = asyncio.Lock()
        _jwks_locks[id(loop)] = lock
    return lock


async def _fetch_jwks():
    """Fetch JWKS from Keycloak with caching. Concurrent callers share one HTTP GET."""
    global _jwks_keys, _jwks_fetched_at

    now = datetime.now(UTC).timestamp()
    # Fast path: cached and still fresh → return without taking the lock.
    if _jwks_keys and (now - _jwks_fetched_at) < _JWKS_CACHE_TTL:
        return _jwks_keys

    async with _jwks_lock():
        # Double-check under the lock: a parallel fetcher may have just refreshed it.
        now = datetime.now(UTC).timestamp()
        if _jwks_keys and (now - _jwks_fetched_at) < _JWKS_CACHE_TTL:
            return _jwks_keys

        jwks_uri = f"{KEYCLOAK_INTERNAL_URL}/realms/{KC_REALM}/protocol/openid-connect/certs"
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(jwks_uri)
                response.raise_for_status()
                _jwks_keys = response.json().get("keys", [])
                _jwks_fetched_at = now
                logger.info(f"JWKS refreshed from {jwks_uri} ({len(_jwks_keys)} keys)")
                return _jwks_keys
        except Exception as e:
            if _jwks_keys:
                logger.warning(f"JWKS refresh failed, using cached keys: {e}")
                return _jwks_keys
            logger.error(f"JWKS fetch failed and no cached keys: {e}")
            return None


def _find_key(keys, kid):
    """Find a matching key from JWKS by kid."""
    for key_data in keys:
        if key_data.get("kid") == kid:
            return key_data
    return None


async def validate_token(token: str) -> dict | None:
    """
    Validate a Keycloak JWT token using JWKS.

    Validates: signature, issuer, expiration.

    Args:
        token: Raw JWT string

    Returns:
        Decoded payload dict if valid, None if invalid.
    """
    if not token:
        return None

    try:
        # Decode header without verification to get kid
        header = jwt.get_unverified_header(token)
        kid = header.get("kid")
        if not kid:
            logger.warning("Token missing kid header")
            return None

        keys = await _fetch_jwks()
        if not keys:
            return None

        key_data = _find_key(keys, kid)
        if not key_data:
            logger.warning(f"No matching JWKS key for kid: {kid}")
            return None

        # Build RSA public key from JWKS
        from jose import jwk as jose_jwk

        public_key = jose_jwk.construct(key_data)

        expected_issuer = f"{KEYCLOAK_URL}/realms/{KC_REALM}"

        payload = jwt.decode(
            token,
            public_key,
            issuer=expected_issuer,
            options={"verify_aud": False},
        )

        return payload

    except jwt.ExpiredSignatureError:
        logger.warning("Token has expired")
        return None
    except jwt.JWTClaimsError as e:
        logger.warning(f"Token claim validation failed: {e}")
        return None
    except JWSError as e:
        logger.warning(f"Token signature verification failed: {e}")
        return None
    except Exception as e:
        logger.error(f"Token validation error: {e}")
        return None
