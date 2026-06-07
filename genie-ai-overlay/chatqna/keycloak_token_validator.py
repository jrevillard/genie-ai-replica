# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""
Keycloak JWT token validator for ChatQnA service.

Validates Bearer tokens forwarded by the backend using JWKS.
Provides defense-in-depth: each service validates tokens independently.
"""

import os
import logging
from datetime import datetime, timezone

from jose import jwt, jwk, JWSError
from jose.utils import base64url_decode
import httpx

logger = logging.getLogger("GENIE.AI_CHATQNA")

KEYCLOAK_URL = os.getenv("KEYCLOAK_URL", "http://keycloak:8080")
KC_REALM = os.getenv("KC_REALM", "genie")
KC_CLIENT_ID = os.getenv("KC_CLIENT_ID", "genie-app")

# Add SSL verify toggle (for ip only adress)
SSL_VERIFY = os.getenv("SSL_VERIFY", "true").lower() not in ("0", "false", "no")


# JWKS cache
_jwks_keys = None
_jwks_fetched_at = 0
_JWKS_CACHE_TTL = 300  # 5 minutes


async def _fetch_jwks():
    """Fetch JWKS from Keycloak with caching."""
    global _jwks_keys, _jwks_fetched_at

    now = datetime.now(timezone.utc).timestamp()
    if _jwks_keys and (now - _jwks_fetched_at) < _JWKS_CACHE_TTL:
        return _jwks_keys

    jwks_uri = f"{KEYCLOAK_URL}/realms/{KC_REALM}/protocol/openid-connect/certs"

    # Try to fetch JWKS with SSL verify
    try:
        async with httpx.AsyncClient(timeout=10.0, verify=SSL_VERIFY) as client:   
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

    Validates: signature, issuer, expiration, audience (azp).

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
            options={"verify_aud": False},  # Keycloak 26+ uses aud=account; azp is checked below
        )

        # Validate azp (authorized party) — the client that requested the token
        if "azp" in payload and payload["azp"] != KC_CLIENT_ID:
            logger.warning(f"Token azp mismatch: {payload['azp']} != {KC_CLIENT_ID}")
            return None

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
