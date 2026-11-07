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
async def test_validate_token_jwks_unavailable_raises():
    """Round-5 F1: when _fetch_jwks raises JwksUnavailableError (cold cache
    + Keycloak down + first request), validate_token must propagate the
    typed error so the route layer at genieai_chatqna.py:2229 renders the
    canonical 503 envelope — NOT swallow it into a generic 401
    'Token validation failed' that masks the outage from monitoring."""
    # Import JwksUnavailableError + validate_token locally so the test
    # stays self-contained (matches the style of the other tests in this
    # file, which also import inside the test body). Ruff F811 flags
    # duplicates only when the same symbol is imported in the SAME
    # scope; importing inside the test avoids any conflict with
    # sibling tests that also import `validate_token`.
    import chatqna.keycloak_token_validator as v
    from chatqna.keycloak_token_validator import JwksUnavailableError

    with (
        patch(
            "chatqna.keycloak_token_validator.jwt.get_unverified_header", return_value={"kid": "abc", "alg": "RS256"}
        ),
        patch(
            "chatqna.keycloak_token_validator._fetch_jwks",
            new=AsyncMock(side_effect=JwksUnavailableError("Keycloak JWKS unreachable")),
        ),
    ):
        v._jwks_keys = None
        with pytest.raises(JwksUnavailableError):
            await v.validate_token("any-token")


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


# ── #1636: the issuer SET ────────────────────────────────────────────────────
# The minting host stamps iss (this realm has no pinned frontendUrl), and
# okf-server's service-token mints via KEYCLOAK_INTERNAL_URL since that var
# was set (2026-11-06) — so serve-mode service tokens carry
# iss=http://keycloak:8080/realms/genie while the validator expected exactly
# the public-URL issuer. Every RAGAS serve-mode run aborted 401. The fix
# widens the ISSUER CLAIM ONLY to the deployment's two hosts; signature
# validation is unchanged.


def test_expected_issuers_lists_public_and_internal(monkeypatch):
    """Both deployment hosts are accepted; order: public first (the issuer the
    rest of the stack expects)."""
    from chatqna import keycloak_token_validator as v

    monkeypatch.setattr(v, "KEYCLOAK_URL", "https://192.168.18.16/auth")
    monkeypatch.setattr(v, "KEYCLOAK_INTERNAL_URL", "http://keycloak:8080")
    assert v._expected_issuers() == [
        "https://192.168.18.16/auth/realms/genie",
        "http://keycloak:8080/realms/genie",
    ]


def test_expected_issuers_dedupes_when_hosts_match(monkeypatch):
    """KEYCLOAK_INTERNAL_URL defaults to http://keycloak:8080 — when it equals
    the public URL (or public defaults to the same host), one entry, not two
    identical strings (jose would accept either, but the list must stay
    clean for logs and tests)."""
    from chatqna import keycloak_token_validator as v

    monkeypatch.setattr(v, "KEYCLOAK_URL", "http://keycloak:8080")
    monkeypatch.setattr(v, "KEYCLOAK_INTERNAL_URL", "http://keycloak:8080")
    assert v._expected_issuers() == ["http://keycloak:8080/realms/genie"]


@pytest.mark.asyncio
async def test_validate_token_accepts_internal_host_issuer(monkeypatch):
    """THE #1636 regression: a token minted via the INTERNAL host (iss =
    http://keycloak:8080/realms/genie) validates when KEYCLOAK_INTERNAL_URL is
    set, against a public KEYCLOAK_URL. Real jose round-trip — real RSA
    keypair, real signature verification, only the JWKS fetch mocked."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from jose import jwk as jose_jwk
    from jose import jwt as jose_jwt

    from chatqna import keycloak_token_validator as v

    monkeypatch.setattr(v, "KEYCLOAK_URL", "https://192.168.18.16/auth")
    monkeypatch.setattr(v, "KEYCLOAK_INTERNAL_URL", "http://keycloak:8080")
    monkeypatch.setattr(v, "KC_REALM", "genie")

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    jwk_dict = jose_jwk.construct(
        key.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        ),
        algorithm="RS256",
    ).to_dict()
    jwk_dict["kid"] = "abc"

    claims = {
        "iss": "http://keycloak:8080/realms/genie",
        "sub": "service-account-okf-server",
        "exp": 9999999999,
    }
    token = jose_jwt.encode(claims, private_pem, algorithm="RS256", headers={"kid": "abc"})

    with (
        patch(
            "chatqna.keycloak_token_validator.jwt.get_unverified_header", return_value={"kid": "abc", "alg": "RS256"}
        ),
        patch("chatqna.keycloak_token_validator._fetch_jwks", new=AsyncMock(return_value=[jwk_dict])),
    ):
        v._jwks_keys = [jwk_dict]
        payload = await v.validate_token(token)
    assert payload is not None, "internal-host issuer must validate (the #1636 401)"
    assert payload["sub"] == "service-account-okf-server"


@pytest.mark.asyncio
async def test_validate_token_still_rejects_foreign_issuer(monkeypatch):
    """The widening is two hosts, not open: a FOREIGN issuer (an attacker's
    realm with its own key the validator was tricked into trusting) must still
    fail the claim check. Same real-key round-trip, foreign iss."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from jose import jwk as jose_jwk
    from jose import jwt as jose_jwt

    from chatqna import keycloak_token_validator as v

    monkeypatch.setattr(v, "KEYCLOAK_URL", "https://192.168.18.16/auth")
    monkeypatch.setattr(v, "KEYCLOAK_INTERNAL_URL", "http://keycloak:8080")

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    jwk_dict = jose_jwk.construct(
        key.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        ),
        algorithm="RS256",
    ).to_dict()
    jwk_dict["kid"] = "abc"

    claims = {
        "iss": "https://evil.example.com/realms/genie",
        "sub": "attacker",
        "exp": 9999999999,
    }
    token = jose_jwt.encode(claims, private_pem, algorithm="RS256", headers={"kid": "abc"})

    with (
        patch(
            "chatqna.keycloak_token_validator.jwt.get_unverified_header", return_value={"kid": "abc", "alg": "RS256"}
        ),
        patch("chatqna.keycloak_token_validator._fetch_jwks", new=AsyncMock(return_value=[jwk_dict])),
    ):
        v._jwks_keys = [jwk_dict]
        assert await v.validate_token(token) is None, "a foreign issuer must still be rejected"
