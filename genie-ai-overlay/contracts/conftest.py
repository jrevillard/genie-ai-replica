# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Contract-suite fixtures — real comps from the built image, never the mock.

This conftest is DELIBERATELY the OPPOSITE of ``tests/conftest.py``: instead of
stubbing ``comps`` in ``sys.modules`` (which is what makes the mocked suite
blind to runtime comps API changes), the ``comps`` fixture here returns the REAL
vendored ``comps`` from the built image and skips the test when it is absent
(isolation — no green-on-green).
"""

import _harness
import pytest


@pytest.fixture(scope="session")
def comps():
    """The real vendored ``comps`` module (skip in the mocked dev env)."""
    return _harness.require_real_comps()


@pytest.fixture()
def fake_http():
    """Install the fake HTTP layer; restore the real one after the test.

    The fake patches module-level ``aiohttp.ClientSession`` and
    ``requests.post``/``get`` globally — without restore it would leak into
    subsequent tests in the same pytest process (the in-image CI jobs run the
    whole suite in one process).
    """
    import aiohttp
    import requests

    orig_session = aiohttp.ClientSession
    orig_post = requests.post
    orig_get = requests.get
    session = _harness.install_fake_aiohttp()
    yield session
    aiohttp.ClientSession = orig_session
    requests.post = orig_post
    requests.get = orig_get
