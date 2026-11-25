# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The production transport: a Session per transport instance.

A shared Session would persist one caller's cookies into another caller's
GET — ambient credential bleed the per-call bearer design exists to avoid.

The credential's SCHEME belongs to the transport: the caller may hand over
the bare token or the whole Authorization header value ("Bearer <jwt>" —
the shape the BFF forwards in the run body). The transport must send ONE
well-formed header in both cases.
"""

from capabilities.adapters.http import RequestsTransport, _bearer_token


def test_each_transport_instance_owns_its_session():
    assert RequestsTransport()._session is not RequestsTransport()._session


def test_a_bare_token_keeps_its_shape():
    assert _bearer_token("abc.def.ghi") == "abc.def.ghi"


def test_a_header_value_loses_its_scheme_prefix():
    # The double-prefix defect: the transport prefixed the scheme onto a
    # value that already carried it, so the downstream service read
    # "Bearer Bearer <jwt>" and rejected the token.
    assert _bearer_token("Bearer abc.def.ghi") == "abc.def.ghi"


def test_the_scheme_prefix_is_matched_case_insensitively():
    assert _bearer_token("bearer abc.def.ghi") == "abc.def.ghi"
    assert _bearer_token("BEARER abc.def.ghi") == "abc.def.ghi"


def test_the_surrounding_whitespace_is_ignored():
    assert _bearer_token("  Bearer abc.def.ghi  ") == "abc.def.ghi"
    assert _bearer_token("  abc.def.ghi  ") == "abc.def.ghi"


class _RecordingSession:
    """A session that records the headers of the last GET."""

    def __init__(self):
        self.headers = None
        self.url = None

    def get(self, url, headers=None, timeout=None):
        self.url = url
        self.headers = headers
        return _Response()


class _Response:
    status_code = 200

    @staticmethod
    def json():
        return {"ok": True}


def _transport_with_recording_session():
    transport = RequestsTransport()
    transport._session = _RecordingSession()
    return transport


def test_the_transport_sends_one_scheme_for_a_header_value():
    transport = _transport_with_recording_session()
    transport.get_json("http://doc-repo/api/files/x", "Bearer abc.def.ghi", 1.0)
    assert transport._session.headers["Authorization"] == "Bearer abc.def.ghi"


def test_the_transport_sends_one_scheme_for_a_bare_token():
    transport = _transport_with_recording_session()
    transport.get_json("http://doc-repo/api/files/x", "abc.def.ghi", 1.0)
    assert transport._session.headers["Authorization"] == "Bearer abc.def.ghi"


def test_the_transport_sends_no_authorization_without_a_bearer():
    transport = _transport_with_recording_session()
    transport.get_json("http://doc-repo/api/files/x", None, 1.0)
    assert "Authorization" not in transport._session.headers
