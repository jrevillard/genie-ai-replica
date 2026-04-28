# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""
Keycloak service account token management for Dataprep.

Obtains and caches tokens via client_credentials grant.
Falls back to the legacy http-service token endpoint when Keycloak is unavailable.
Auto-renews when token is near expiry.
"""

import asyncio
import logging
import os
import time

import aiohttp

logger = logging.getLogger("GENIE_DATAPREP_SERVICE_ACCOUNT")

# Configuration from environment
KEYCLOAK_URL = os.getenv("KEYCLOAK_URL", "")
KC_REALM = os.getenv("KC_REALM", "genie")
KC_DATAPREP_CLIENT_ID = os.getenv("KC_DATAPREP_CLIENT_ID", "")
KC_DATAPREP_CLIENT_SECRET = os.getenv("KC_DATAPREP_CLIENT_SECRET", "")
FALLBACK_TOKEN_URL = os.getenv(
    "GET_AUTH_TOKEN_URL", "http://http-service:6666/get-token"
)

# Token cache
_cached_token = None
_token_expiry = 0
_BUFFER_SECONDS = 60  # Renew 60s before expiry
_token_lock = asyncio.Lock()


def _get_token_endpoint() -> str:
    return f"{KEYCLOAK_URL}/realms/{KC_REALM}/protocol/openid-connect/token"


async def get_service_account_token() -> str:
    """
    Get a valid service account token.
    Returns cached token if still valid, otherwise obtains a new one.
    Tries Keycloak first, falls back to legacy http-service token endpoint.
    Uses asyncio.Lock to prevent concurrent token refresh.
    """
    global _cached_token, _token_expiry

    if _cached_token and time.time() < (_token_expiry - _BUFFER_SECONDS):
        return _cached_token

    async with _token_lock:
        # Double-check after acquiring lock (another coroutine may have refreshed)
        if _cached_token and time.time() < (_token_expiry - _BUFFER_SECONDS):
            return _cached_token

        # Try Keycloak first (if configured)
        if KC_DATAPREP_CLIENT_ID and KC_DATAPREP_CLIENT_SECRET:
            try:
                token_url = _get_token_endpoint()
                payload = {
                    "grant_type": "client_credentials",
                    "client_id": KC_DATAPREP_CLIENT_ID,
                    "client_secret": KC_DATAPREP_CLIENT_SECRET,
                }
                async with aiohttp.ClientSession() as session, session.post(
                    token_url,
                    data=payload,
                    timeout=aiohttp.ClientTimeout(total=5),
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        _cached_token = data["access_token"]
                        _token_expiry = time.time() + data.get("expires_in", 300)
                        logger.info(
                            "Service account token obtained via Keycloak"
                        )
                        return _cached_token
                    else:
                        error_text = await response.text()
                        logger.warning(
                            f"Keycloak returned {response.status}: {error_text}, "
                            "falling back to http-service"
                        )
            except Exception as e:
                logger.warning(
                    f"Keycloak unavailable ({e}), falling back to http-service"
                )

        # Fallback to legacy http-service token endpoint
        try:
            async with aiohttp.ClientSession() as session, session.get(
                FALLBACK_TOKEN_URL,
                timeout=aiohttp.ClientTimeout(total=10),
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    token = data.get("accessToken")
                    if token:
                        _cached_token = token
                        # http-service tokens last ~24h; refresh after 14 min
                        _token_expiry = time.time() + 840
                        logger.info(
                            "Service account token obtained via http-service fallback"
                        )
                        return _cached_token
                    else:
                        logger.error(
                            f"http-service returned 200 but no accessToken: {data}"
                        )
                        raise Exception("No accessToken in http-service response")
                else:
                    error_text = await response.text()
                    logger.error(
                        f"http-service returned {response.status}: {error_text}"
                    )
                    raise Exception(
                        f"http-service token request failed: {response.status}"
                    )
        except Exception as e:
            logger.error(
                f"Failed to obtain service account token from both "
                f"Keycloak and http-service: {e}"
            )
            raise
