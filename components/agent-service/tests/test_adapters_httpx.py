# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The httpx-backed transport: the verbs it speaks and the timeout it raises."""

import httpx
import pytest

from capabilities.adapters.httpx import HttpxTransport, TransportTimeoutError


def test_a_timed_out_call_raises_the_transport_timeout() -> None:
    transport = HttpxTransport(verify=True)
    with pytest.raises(TransportTimeoutError) as caught:
        transport._client(httpx.ConnectTimeout("read timed out"))
    assert "ConnectTimeout" in str(caught.value)
    assert isinstance(caught.value, TimeoutError)


def test_any_other_failure_travels_unwrapped() -> None:
    transport = HttpxTransport(verify=True)
    failure = httpx.ConnectError("connection refused")
    with pytest.raises(httpx.ConnectError):
        transport._client(failure)
