# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Tests for eval/keycloak.py — the only Keycloak token fetcher."""

from __future__ import annotations

import urllib.request

import keycloak


class _Resp:
    """Fake urlopen response: context manager + read() + getcode()."""

    def __init__(self, code=200, token="tok"):
        self.code = code
        self._b = ('{"access_token":"%s"}' % token).encode()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self):
        return self._b

    def getcode(self):
        return self.code


def test_fetch_realm_token_posts_form_and_hides_secret(monkeypatch):
    """Realm token: POST form, password in body (NOT URL), token extracted."""
    seen = {}

    def fake(req, timeout=None, context=None):
        seen["url"] = req.full_url
        seen["data"] = req.data.decode()
        seen["method"] = req.get_method()
        return _Resp()

    monkeypatch.setattr(urllib.request, "urlopen", fake)
    tok = keycloak.fetch_realm_token("https://kc/auth", "genie", "genie-app", "u", "S3CR3T")
    assert tok == "tok"
    assert seen["method"] == "POST"
    # secret MUST be in body, MUST NOT be in URL
    assert "S3CR3T" not in seen["url"], f"password leaked in URL: {seen['url']}"
    assert "S3CR3T" in seen["data"], f"password missing from form body: {seen['data']}"
    # form-encoded content-type so Keycloak accepts the request
    assert "grant_type=password" in seen["data"]
    assert "client_id=genie-app" in seen["data"]
    assert "username=u" in seen["data"]


def test_fetch_realm_token_non200_raises(monkeypatch):
    """Realm token: non-2xx response raises KeycloakError (no token returned)."""
    monkeypatch.setattr(
        urllib.request, "urlopen", lambda *a, **k: _Resp(code=401, token="")
    )
    try:
        keycloak.fetch_realm_token("https://kc/auth", "r", "c", "u", "p")
        raised = False
    except keycloak.KeycloakError:
        raised = True
    assert raised, "expected KeycloakError on HTTP 401"
