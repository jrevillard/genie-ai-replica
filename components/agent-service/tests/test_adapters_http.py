# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The production transport: a cookie-free Session per transport instance,
and the caller credential normalized to exactly one scheme prefix.

A shared cookie jar would persist one caller's cookies into another
caller's GET — ambient credential bleed the per-call bearer design exists
to avoid. And the caller forwards the Authorization header value it
received (scheme included); the transport adds the scheme again, so a full
header value must never reach the upstream doubled.
"""

import http.server
import json
import socketserver
import threading

from capabilities.adapters.http import RequestsTransport


def test_each_transport_instance_owns_its_session():
    assert RequestsTransport()._session is not RequestsTransport()._session


class _SetCookieHandler(http.server.BaseHTTPRequestHandler):
    """One GET, answered with a session cookie and a JSON body."""

    def do_GET(self):
        self.send_response(200)
        self.send_header("Set-Cookie", "session=SECRET; Path=/")
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def log_message(self, *args):  # the test runner's output stays clean
        pass


class _EchoHandler(http.server.BaseHTTPRequestHandler):
    """One GET, answered with the request's ambient headers as JSON."""

    def do_GET(self):
        body = json.dumps(
            {"cookie": self.headers.get("Cookie"), "authorization": self.headers.get("Authorization")}
        ).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def _serve(handler):
    server = socketserver.TCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}/"


def test_a_set_cookie_never_survives_to_the_next_request():
    cookie_server, cookie_url = _serve(_SetCookieHandler)
    echo_server, echo_url = _serve(_EchoHandler)
    try:
        transport = RequestsTransport()
        status, _body = transport.get_json(cookie_url, None, 5.0)
        assert status == 200
        assert dict(transport._session.cookies) == {}
        _status, body = transport.get_json(echo_url, None, 5.0)
        assert body["cookie"] is None
    finally:
        cookie_server.shutdown()
        echo_server.shutdown()


def test_a_full_header_value_is_sent_with_one_scheme_prefix():
    echo_server, echo_url = _serve(_EchoHandler)
    try:
        transport = RequestsTransport()
        _status, body = transport.get_json(echo_url, "Bearer abc.def", 5.0)
        assert body["authorization"] == "Bearer abc.def"
        _status, body = transport.get_json(echo_url, "abc.def", 5.0)
        assert body["authorization"] == "Bearer abc.def"
    finally:
        echo_server.shutdown()
