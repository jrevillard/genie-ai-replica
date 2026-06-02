# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""
Keycloak service account token management for Dataprep.

Obtains and caches tokens via client_credentials grant.
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
    Uses asyncio.Lock to prevent concurrent token refresh.
    """
    global _cached_token, _token_expiry

    if _cached_token and time.time() < (_token_expiry - _BUFFER_SECONDS):
        return _cached_token

    async with _token_lock:
        # Double-check after acquiring lock (another coroutine may have refreshed)
        if _cached_token and time.time() < (_token_expiry - _BUFFER_SECONDS):
            return _cached_token

        token_url = _get_token_endpoint()
        payload = {
            "grant_type": "client_credentials",
            "client_id": KC_DATAPREP_CLIENT_ID,
            "client_secret": KC_DATAPREP_CLIENT_SECRET,
        }

        try:
            _skip_ssl = os.getenv("KEYCLOAK_SSL_SKIP_VERIFY", "") == "1"
            connector = aiohttp.TCPConnector(ssl=not _skip_ssl)
            async with aiohttp.ClientSession(connector=connector) as session, session.post(token_url, data=payload) as response:
                if response.status != 200:
                    error_text = await response.text()
                    logger.error(f"Failed to obtain service account token: {response.status} - {error_text}")
                    raise Exception(f"Token request failed: {response.status}")

                data = await response.json()
                _cached_token = data["access_token"]
                _token_expiry = time.time() + data.get("expires_in", 300)

                logger.info("Service account token obtained successfully")
                return _cached_token

        except Exception as e:
            logger.error(f"Error obtaining service account token: {e}")
            raise
