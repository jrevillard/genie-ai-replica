# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The doc-repo metadata adapter (story 1.7): resolution of a legacy file id.

The adapter performs the GET the deployed fleet performs — one metadata read,
every response envelope unwrapped — and maps the outcome to the port's
vocabulary: 404 is "does not resolve", everything else that is not 200 is a
transient failure, and a transport error is a transient failure too. The
caller's bearer rides along, because the document repository authenticates
its callers.
"""

import asyncio

import pytest

from capabilities.adapters.docrepo import DocRepoAdapter
from capabilities.adapters.http import TransportError
from capabilities.contract import TransientError


class FakeTransport:
    """The whole transport surface the adapters use: one GET, one tuple back."""

    def __init__(self, status=200, body=None, error=None):
        self.status = status
        self.body = body if body is not None else {}
        self.error = error
        self.calls = []

    def get_json(self, url, bearer, timeout_s):
        self.calls.append({"url": url, "bearer": bearer, "timeout_s": timeout_s})
        if self.error is not None:
            raise TransportError(str(self.error))
        return self.status, self.body


def adapter(transport):
    return DocRepoAdapter(base_url="http://document-repository:3001", transport=transport)


def test_metadata_get_hits_the_file_route_with_the_bearer_forwarded():
    transport = FakeTransport(status=200, body={"success": True, "data": {"file_id": "42"}})
    metadata = asyncio.run(adapter(transport).fetch_metadata("42", bearer="tok-1"))
    assert metadata == {"file_id": "42"}
    assert transport.calls[0]["url"] == "http://document-repository:3001/api/files/42"
    assert transport.calls[0]["bearer"] == "tok-1"


def test_envelope_shapes_all_unwrap_to_the_file_record():
    for body in [
        {"file": {"file_id": "1"}},
        {"data": {"file": {"file_id": "2"}}},
        {"data": {"file_id": "3"}},
        {"file_id": "4"},
    ]:
        transport = FakeTransport(status=200, body=body)
        metadata = asyncio.run(adapter(transport).fetch_metadata("x", bearer=None))
        assert isinstance(metadata, dict)


def test_absent_file_maps_to_none():
    transport = FakeTransport(status=404, body={})
    assert asyncio.run(adapter(transport).fetch_metadata("99", bearer=None)) is None


@pytest.mark.parametrize("status", [401, 403, 500, 503])
def test_non_404_refusal_is_transient(status):
    transport = FakeTransport(status=status, body={})
    with pytest.raises(TransientError):
        asyncio.run(adapter(transport).fetch_metadata("42", bearer=None))


def test_transport_error_is_transient():
    transport = FakeTransport(error=ConnectionError("dns"))
    with pytest.raises(TransientError):
        asyncio.run(adapter(transport).fetch_metadata("42", bearer=None))
