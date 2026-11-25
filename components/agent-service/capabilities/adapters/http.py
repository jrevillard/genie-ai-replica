# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The one HTTP surface the adapters share: a GET that returns the status
and the parsed body, or raises on transport failure.

The transport is injected, so the tests drive the adapters without a network.
The production transport wraps ``requests`` (already pinned in the runtime
tree) and runs in a worker thread — the port is async, the driver is not.
"""

from http.cookiejar import DefaultCookiePolicy
from typing import Any, Protocol

import requests


class TransportError(Exception):
    """The request did not reach an HTTP answer (DNS, connect, timeout)."""


class HttpTransport(Protocol):
    """The GET the adapters need: ``(status, body)`` or a raised error."""

    def get_json(self, url: str, bearer: str | None, timeout_s: float) -> tuple[int, Any]: ...


class _NoCookiePolicy(DefaultCookiePolicy):
    """A cookie policy that neither stores nor returns a cookie.

    The adapters' upstreams authenticate with the per-call bearer, and a
    cookie is ambient state: one that a caller received would travel on the
    NEXT caller's request. The session therefore keeps no cookie — the
    pooled connection survives, the ambient credential does not.
    """

    def set_ok(self, cookie, request) -> bool:
        """Never accept a cookie into the jar."""
        return False

    def return_ok(self, cookie, request) -> bool:
        """Never send a stored cookie."""
        return False


class RequestsTransport:
    """The production transport: one GET, bearer forwarded when present.

    The ``Session`` is per transport INSTANCE, not shared: a shared Session
    would persist one caller's cookies into another caller's GET (ambient
    credential bleed the per-call bearer design exists to avoid). Pooled
    connections still save the handshake within one instance's lifetime, and
    the bearer — the only per-request credential — travels per call in the
    headers, never on the session. The session's cookie jar is empty by
    policy, so the isolation the per-instance session provides survives an
    upstream that answers with a ``Set-Cookie``.
    """

    def __init__(self) -> None:
        self._session = requests.Session()
        self._session.cookies.set_policy(_NoCookiePolicy())

    def get_json(self, url: str, bearer: str | None, timeout_s: float) -> tuple[int, Any]:
        headers = {"Accept": "application/json"}
        token = _token_of(bearer)
        if token:
            headers["Authorization"] = f"Bearer {token}"
        try:
            response = self._session.get(url, headers=headers, timeout=timeout_s)
        except requests.RequestException as error:
            raise TransportError(str(error)) from error
        try:
            body: Any = response.json()
        except ValueError:
            body = None
        return response.status_code, body


def _token_of(bearer: str | None) -> str:
    """The bare token of a caller credential.

    The caller forwards the Authorization header value it received, scheme
    included; the scheme is added again here, so a full header value would
    reach the upstream as ``Bearer Bearer <token>`` and be refused.
    """
    token = str(bearer or "").strip()
    if token.lower().startswith("bearer "):
        token = token[len("bearer ") :].strip()
    return token
