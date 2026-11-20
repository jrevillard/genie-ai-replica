# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The production transport: a Session per transport instance.

A shared Session would persist one caller's cookies into another caller's
GET — ambient credential bleed the per-call bearer design exists to avoid.
"""

from capabilities.adapters.http import RequestsTransport


def test_each_transport_instance_owns_its_session():
    assert RequestsTransport()._session is not RequestsTransport()._session
