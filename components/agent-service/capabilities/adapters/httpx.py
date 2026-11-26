# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The async HTTP transport: the two verbs the core's clients speak.

The transport is the adapter of an HTTP call. It is built by the composition
root and handed to the client that needs it; the core names the Protocol, not
this class.

A timed-out call raises :class:`TransportTimeoutError` — a builtin
``TimeoutError`` — so the core can classify a timeout without naming an HTTP
library. Every other failure travels unwrapped: the core reads the upstream
error body off the exception, and a wrapper would hide it.
"""

from typing import Any

import httpx


class TransportTimeoutError(TimeoutError):
    """The call timed out; the core classifies it as a timeout."""


class HttpxTransport:
    """The production transport: one ``AsyncClient`` per call.

    The per-call client is the deployed seam's shape (the deployed module
    builds an ``AsyncClient`` per request with the call's timeout and the
    TLS-verify knob); what the per-call shape trades away is connection
    pooling, never credential isolation — the bearer travels per call in the
    headers.
    """

    def __init__(self, verify: bool):
        self._verify = verify

    def _raise_transport_failure(self, failure: Exception) -> None:
        """Raise ``failure`` the way the core must read it.

        A timeout becomes the core's timeout type; anything else travels
        unchanged, with its upstream body attached.
        """
        if isinstance(failure, httpx.TimeoutException):
            raise TransportTimeoutError(f"{type(failure).__name__}: {failure}") from failure
        raise failure

    async def get_json(self, url: str, headers: dict, timeout_s: float) -> tuple[int, Any]:
        try:
            async with httpx.AsyncClient(timeout=timeout_s, verify=self._verify) as client:
                response = await client.get(url, headers=headers)
        except httpx.TimeoutException as failure:
            self._raise_transport_failure(failure)
        return response.status_code, response.json()

    async def post_json(self, url: str, headers: dict, payload: dict, timeout_s: float) -> tuple[int, Any]:
        try:
            async with httpx.AsyncClient(timeout=timeout_s, verify=self._verify) as client:
                response = await client.post(url, headers=headers, json=payload)
        except httpx.TimeoutException as failure:
            self._raise_transport_failure(failure)
        return response.status_code, response.json()
