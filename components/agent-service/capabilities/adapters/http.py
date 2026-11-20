# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The one HTTP surface the adapters share: a GET that returns the status
and the parsed body, or raises on transport failure.

The transport is injected, so the tests drive the adapters without a network.
The production transport wraps ``requests`` (already pinned in the runtime
tree) and runs in a worker thread — the port is async, the driver is not.
"""

from typing import Any, Protocol

import requests


class TransportError(Exception):
    """The request did not reach an HTTP answer (DNS, connect, timeout)."""


class HttpTransport(Protocol):
    """The GET the adapters need: ``(status, body)`` or a raised error."""

    def get_json(self, url: str, bearer: str | None, timeout_s: float) -> tuple[int, Any]: ...


class RequestsTransport:
    """The production transport: one GET, bearer forwarded when present."""

    def get_json(self, url: str, bearer: str | None, timeout_s: float) -> tuple[int, Any]:
        headers = {"Accept": "application/json"}
        if bearer:
            headers["Authorization"] = f"Bearer {bearer}"
        try:
            response = requests.get(url, headers=headers, timeout=timeout_s)
        except requests.RequestException as error:
            raise TransportError(str(error)) from error
        try:
            body: Any = response.json()
        except ValueError:
            body = None
        return response.status_code, body
