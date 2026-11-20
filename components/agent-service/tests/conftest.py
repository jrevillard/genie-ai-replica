# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Shared test doubles for the adapter suites.

The whole transport surface the HTTP adapters use: one GET, one tuple back.
Imported by the adapter test suites so a change to the fake's surface — say,
recording headers — lands once for every adapter.
"""

from capabilities.adapters.http import TransportError


class FakeTransport:
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
