# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""GENIE.AI auth client.

Calls the backend's `/login` and `/refresh-token` endpoints to obtain a JWT
that downstream services can use to authenticate as a service account.

Token lifecycle
---------------
- `login()` exchanges (loginName, password) for an accessToken + refreshToken.
- `refresh()` rotates the access token using the refresh token.
- `get_token()` is the entry point callers should use: it returns a valid
  access token, refreshing 30 s before expiry and falling back to a fresh
  login if the refresh fails (e.g. refresh token revoked).
- `auth_headers()` is a convenience that wraps `get_token()` into a
  `{"Authorization": "Bearer ..."}` dict.

Password is sent as the SHA-256 hex digest under `encPassword` — the backend
then bcrypts that hash. This matches the web frontend's hashing scheme.
"""

import hashlib
import time

from http_service import HttpService


class AuthService:
    """Stateful client. One instance per (base_url, login) pair; caches the
    access token in memory until expiry."""

    def __init__(self, base_url, login_name, password):
        self.http = HttpService(base_url)
        self.login_name = login_name
        self.password = password
        self.access_token = None
        self.refresh_token = None
        self.token_expiry = 0  # epoch seconds; 0 means "no token yet"

    def _hash_password(self, password: str) -> str:
        """Match the frontend hashing: SHA-256 hex of the UTF-8 plaintext."""
        return hashlib.sha256(password.encode("utf-8")).hexdigest()

    async def login(self):
        """Exchange credentials for a fresh access + refresh token pair."""
        enc_password = self._hash_password(self.password)
        data = await self.http.post(
            "/login",
            {"loginName": self.login_name, "encPassword": enc_password},
        )
        self.access_token = data["accessToken"]
        self.refresh_token = data["refreshToken"]
        # Default to 15 min when the server doesn't announce expiresIn —
        # tracks the backend's typical token TTL.
        self.token_expiry = time.time() + data.get("expiresIn", 15 * 60)
        return data

    async def refresh(self):
        """Rotate the access token without re-sending the password."""
        data = await self.http.post(
            "/refresh-token",
            {"refreshToken": self.refresh_token},
        )
        self.access_token = data["accessToken"]
        # Some servers rotate the refresh token too; keep the old one if not.
        self.refresh_token = data.get("refreshToken", self.refresh_token)
        self.token_expiry = time.time() + data.get("expiresIn", 15 * 60)
        return data

    async def get_token(self):
        """Return a valid access token. Refreshes 30 s before expiry and
        falls back to a fresh login if refresh fails (refresh-token revoked,
        expired, server reset)."""
        if not self.access_token or time.time() >= self.token_expiry - 30:
            try:
                await self.refresh()
            except Exception:
                await self.login()
        return self.access_token

    async def auth_headers(self):
        """Convenience: returns a Bearer-token header dict ready to spread
        into another HTTP call."""
        token = await self.get_token()
        return {"Authorization": f"Bearer {token}"}
