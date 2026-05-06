# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Thin async HTTP wrapper used by the auth client.

Exists so call-sites don't have to repeat the
`async with httpx.AsyncClient() as client` boilerplate, and so a single
`base_url` + `default_headers` set can be reused across calls. Each request
opens a fresh client — keep-alive is not optimized here because the auth
flow only fires a handful of requests per process lifetime.
"""

import httpx


class HttpService:
    """Tiny GET/POST client. Raises on 4xx/5xx, returns parsed JSON otherwise."""

    def __init__(self, base_url: str, default_headers: dict = None):
        # Strip a trailing slash so callers can pass either "https://x" or
        # "https://x/" — the endpoint they pass always begins with "/".
        self.base_url = base_url.rstrip("/")
        self.default_headers = default_headers or {}

    async def get(self, endpoint: str, headers: dict = None):
        """GET <base_url><endpoint>. Per-request `headers` shallow-merge over
        `default_headers`."""
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{self.base_url}{endpoint}",
                headers={**self.default_headers, **(headers or {})},
            )
            resp.raise_for_status()
            return resp.json()

    async def post(self, endpoint: str, data: dict = None, headers: dict = None):
        """POST <base_url><endpoint> with a JSON body. Same header merge rule
        as `get`."""
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self.base_url}{endpoint}",
                json=data,
                headers={**self.default_headers, **(headers or {})},
            )
            resp.raise_for_status()
            return resp.json()
