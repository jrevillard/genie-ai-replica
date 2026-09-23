# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""
Unit tests for keycloak_token_validator.

Strategy: pure-function paths are tested directly; the JWKS-fetch + JWT-decode
paths are tested via mocks (httpx + jose) to avoid coupling to Keycloak /
cryptographic state.
"""

from unittest.mock import AsyncMock, patch

import pytest


def test_find_key_returns_match():
    """_find_key returns the key whose kid matches."""
    from chatqna.keycloak_token_validator import _find_key

    keys = [{"kid": "abc", "kty": "RSA"}, {"kid": "def", "kty": "RSA"}]
    assert _find_key(keys, "def") == {"kid": "def", "kty": "RSA"}
    assert _find_key(keys, "abc") == {"kid": "abc", "kty": "RSA"}


def test_find_key_returns_none_for_missing_kid():
    """_find_key returns None when no key matches."""
    from chatqna.keycloak_token_validator import _find_key

    keys = [{"kid": "abc", "kty": "RSA"}]
    assert _find_key(keys, "xyz") is None
    assert _find_key([], "abc") is None


@pytest.mark.asyncio
async def test_validate_token_empty_returns_none():
    """Empty / None tokens return None without hitting the network."""
    from chatqna.keycloak_token_validator import validate_token

    assert await validate_token("") is None
    assert await validate_token(None) is None  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_validate_token_malformed_returns_none():
    """Malformed JWT strings return None (caller jose raises JWSError)."""
    from chatqna.keycloak_token_validator import validate_token

    # No httpx mock needed — jose.get_unverified_header raises before any
    # network call when the string is not a JWT.
    with patch("chatqna.keycloak_token_validator.jwt.get_unverified_header", side_effect=Exception("not a JWT")):
        assert await validate_token("not-a-jwt") is None


@pytest.mark.asyncio
async def test_validate_token_missing_kid_returns_none():
    """A JWT without a kid header is rejected before JWKS lookup."""
    from chatqna.keycloak_token_validator import validate_token

    with patch("chatqna.keycloak_token_validator.jwt.get_unverified_header", return_value={"alg": "RS256"}):
        assert await validate_token("any-token") is None


@pytest.mark.asyncio
async def test_validate_token_jwks_unavailable_returns_none():
    """If JWKS fetch fails AND there is no cached fallback, the token is rejected."""
    from chatqna.keycloak_token_validator import validate_token

    with (
        patch(
            "chatqna.keycloak_token_validator.jwt.get_unverified_header", return_value={"kid": "abc", "alg": "RS256"}
        ),
        patch("chatqna.keycloak_token_validator._fetch_jwks", new=AsyncMock(return_value=None)),
    ):
        # Clear the module-level cache so the "no cached keys" branch is taken
        import chatqna.keycloak_token_validator as v

        v._jwks_keys = None
        assert await validate_token("any-token") is None


@pytest.mark.asyncio
async def test_validate_token_unknown_kid_returns_none():
    """A kid that doesn't match any JWKS key is rejected."""
    from chatqna.keycloak_token_validator import validate_token

    with (
        patch(
            "chatqna.keycloak_token_validator.jwt.get_unverified_header",
            return_value={"kid": "unknown", "alg": "RS256"},
        ),
        patch(
            "chatqna.keycloak_token_validator._fetch_jwks", new=AsyncMock(return_value=[{"kid": "abc", "kty": "RSA"}])
        ),
    ):
        assert await validate_token("any-token") is None


@pytest.mark.asyncio
async def test_validate_token_expired_signature_returns_none():
    """Expired tokens return None (jose raises ExpiredSignatureError → None)."""
    from jose import jwt as jose_jwt

    from chatqna.keycloak_token_validator import validate_token

    fake_key = {"kid": "abc", "kty": "RSA"}

    with (
        patch(
            "chatqna.keycloak_token_validator.jwt.get_unverified_header", return_value={"kid": "abc", "alg": "RS256"}
        ),
        patch("chatqna.keycloak_token_validator._fetch_jwks", new=AsyncMock(return_value=[fake_key])),
        patch("jose.jwk.construct", return_value="fake-public-key"),
        patch("chatqna.keycloak_token_validator.jwt.decode", side_effect=jose_jwt.ExpiredSignatureError("expired")),
    ):
        assert await validate_token("any-token") is None


@pytest.mark.asyncio
async def test_concurrent_fetchers_share_single_http_get(monkeypatch):
    """When N coroutines call ``_fetch_jwks`` simultaneously and the cache is cold,
    only ONE HTTP GET should reach Keycloak — the others await the lock and pick
    up the freshly-cached result. This is the single-flight guarantee."""
    import asyncio

    from chatqna import keycloak_token_validator as v

    # Cold cache.
    v._jwks_keys = None
    v._jwks_fetched_at = 0

    call_count = 0
    fake_keys = [{"kid": "abc", "kty": "RSA"}]

    class _FakeResp:
        def __init__(self, payload):
            self._payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return {"keys": self._payload}

    async def slow_get(self, url):
        nonlocal call_count
        call_count += 1
        # Yield control so the other N-1 coroutines queue up at the lock boundary.
        await asyncio.sleep(0.01)
        return _FakeResp(fake_keys)

    monkeypatch.setattr("httpx.AsyncClient.get", slow_get)

    results = await asyncio.gather(*[v._fetch_jwks() for _ in range(20)])
    assert results.count(fake_keys) == 20
    assert call_count == 1, f"expected 1 HTTP GET under single-flight, got {call_count}"
    # Cache populated by the single winner.
    assert v._jwks_keys == fake_keys


@pytest.mark.asyncio
async def test_expired_cache_triggers_single_refresh():
    """Once the TTL expires, a subsequent fetcher must refresh exactly once."""
    import asyncio

    from chatqna import keycloak_token_validator as v

    v._jwks_keys = [{"kid": "old", "kty": "RSA"}]
    v._jwks_fetched_at = 0.0  # ancient → expired

    new_keys = [{"kid": "new", "kty": "RSA"}]
    call_count = 0

    class _FakeResp:
        def raise_for_status(self):
            return None

        def json(self):
            return {"keys": new_keys}

    async def slow_get(self, url):
        nonlocal call_count
        call_count += 1
        await asyncio.sleep(0.01)
        return _FakeResp()

    with patch("httpx.AsyncClient.get", new=slow_get):
        results = await asyncio.gather(*[v._fetch_jwks() for _ in range(10)])
    assert all(r == new_keys for r in results)
    assert call_count == 1
