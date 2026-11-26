# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The httpx-backed transport: the verbs it speaks and the timeout it raises.

The assertions drive the PUBLIC path — the verbs the core calls — because
the contract the core depends on is what the verbs do: a timeout arrives
as the builtin ``TimeoutError``, every other failure arrives unwrapped.
The private helper is the implementation, not the contract.
"""

import asyncio

import httpx
import pytest

from capabilities.adapters.httpx import HttpxTransport, TransportTimeoutError


class _RaisingClient:
    """The httpx client double: every call raises the canned failure."""

    def __init__(self, failure: Exception, **kwargs) -> None:
        self._failure = failure

    async def __aenter__(self) -> "_RaisingClient":
        return self

    async def __aexit__(self, *exc_info) -> bool:
        return False

    async def get(self, *args, **kwargs) -> None:
        raise self._failure

    async def post(self, *args, **kwargs) -> None:
        raise self._failure


def _client_raising(monkeypatch, failure: Exception) -> None:
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: _RaisingClient(failure, **kwargs))


@pytest.mark.parametrize("verb", ["get", "post"])
def test_a_timed_out_call_raises_the_transport_timeout(monkeypatch, verb) -> None:
    """The core classifies a timeout by its TYPE — the builtin
    ``TimeoutError``. A transport that let the library's own timeout type
    escape would make the core report a generic failure where a timeout
    happened (the preparation's FALLBACK_TIMEOUT vs FALLBACK_ERROR)."""

    _client_raising(monkeypatch, httpx.ReadTimeout("read timed out"))
    transport = HttpxTransport(verify=True)

    with pytest.raises(TransportTimeoutError) as caught:
        asyncio.run(_call(transport, verb))

    assert "ReadTimeout" in str(caught.value)
    assert isinstance(caught.value, TimeoutError)


@pytest.mark.parametrize("verb", ["get", "post"])
def test_any_other_failure_travels_unwrapped(monkeypatch, verb) -> None:
    """A connection failure travels unchanged: the core reads the upstream
    error body off the exception, and a wrapper would hide it."""

    _client_raising(monkeypatch, httpx.ConnectError("connection refused"))
    transport = HttpxTransport(verify=True)

    with pytest.raises(httpx.ConnectError):
        asyncio.run(_call(transport, verb))


def _call(transport: HttpxTransport, verb: str):
    """One call of the named verb — the two the core's clients speak."""

    if verb == "get":
        return transport.get_json("https://example.invalid/thing", {"authorization": "Bearer t"}, 1.0)
    return transport.post_json("https://example.invalid/thing", {"authorization": "Bearer t"}, {"q": "x"}, 1.0)
