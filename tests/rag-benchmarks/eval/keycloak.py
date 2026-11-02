# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""The ONLY Keycloak token fetcher for the eval toolchain.

Secrets stay in the POST body (never argv / URL). SSL verification is
disabled to match `curl -sk` against self-signed Keycloak deployments.
"""

from __future__ import annotations

import json
import ssl
import urllib.error
import urllib.parse
import urllib.request


class KeycloakError(RuntimeError):
    """Raised on non-2xx responses or missing access_token in the payload."""


_SSL_CTX = ssl._create_unverified_context()


def _post_token(url: str, form: dict[str, str], timeout: float) -> str:
    data = urllib.parse.urlencode(form).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_SSL_CTX) as resp:
            payload = json.load(resp)
    except urllib.error.HTTPError as e:
        raise KeycloakError(f"token endpoint HTTP {e.code}: {e.read()[:200]!r}") from e
    token = payload.get("access_token")
    if not token:
        raise KeycloakError(f"no access_token in response: {list(payload)[:5]}")
    return token


def fetch_realm_token(
    kc_url: str,
    realm: str,
    client_id: str,
    username: str,
    password: str,
    timeout: float = 30.0,
) -> str:
    """Fetch a realm-scoped ROPC access token (Direct Access Grants).

    Caller must have already enabled ROPC on the target client; ROPC is
    intentionally disabled by default in production realms.
    """
    return _post_token(
        f"{kc_url.rstrip('/')}/realms/{urllib.parse.quote(realm)}/protocol/openid-connect/token",
        {
            "grant_type": "password",
            "client_id": client_id,
            "username": username,
            "password": password,
        },
        timeout,
    )
