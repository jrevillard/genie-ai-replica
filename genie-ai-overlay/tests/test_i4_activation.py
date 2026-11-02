"""
I.4 review-activation pins — the token forward switches ON three dormant mechanisms
in chatqna; these pins hold their safety in place:

F1 — azp allowlist: both realm clients (web + agrivisory-mobile) accepted; unknown
     azp rejected. (A single-client equality check would break mobile chat.)
F2 — validator rejection is a REAL 401 (was a 200-wrapped dict — invisible).
F3 — per-request token: the singleton profile client must not bleed one user's
     Bearer into a concurrent request (ContextVar isolation).
F4 — kid-miss on a warm JWKS cache forces ONE refresh before rejecting (Keycloak
     key rotation would otherwise silently break chat for up to the 5-min TTL).
"""

import asyncio
import importlib.util
from contextvars import copy_context
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest


def _load_real_validator():
    """conftest registers a MagicMock for keycloak_token_validator (import shield);
    load the REAL module from its file for behavior tests. jose is a container-only
    dep — pre-register it (conftest idiom) so the module import succeeds; the
    signature path is mocked per-test anyway."""
    import sys
    from unittest.mock import MagicMock as _MM

    if "jose" not in sys.modules:
        jose = _MM()
        jose.JWSError = type("JWSError", (Exception,), {})
        jose.jwt = _MM()
        sys.modules["jose"] = jose
        sys.modules["jose.jwt"] = jose.jwt
        sys.modules["jose.jwk"] = _MM()
    import os
    os.environ.setdefault("KC_CLIENT_ID", "itu-agrivisory-client")  # live compose value
    path = Path(__file__).parent.parent / "chatqna" / "keycloak_token_validator.py"
    spec = importlib.util.spec_from_file_location("ktv_real_i4", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _primed_validator(monkeypatch, payload):
    """Validator with signature machinery mocked: JWKS has kid 'k1', the token
    header claims kid 'k1', jwt.decode returns `payload`."""
    ktv = _load_real_validator()
    fake_keys = [{"kid": "k1", "kty": "RSA", "n": "x", "e": "AQAB"}]
    monkeypatch.setattr(ktv, "_fetch_jwks", AsyncMock(return_value=fake_keys))
    monkeypatch.setattr(ktv.jwt, "get_unverified_header", MagicMock(return_value={"kid": "k1"}))
    monkeypatch.setattr(ktv.jwt, "decode", MagicMock(return_value=payload))
    return ktv


class TestAzpAllowlist:
    def test_mobile_client_azp_accepted(self, monkeypatch):
        ktv = _primed_validator(monkeypatch, {"azp": "agrivisory-mobile", "sub": "u1"})
        assert asyncio.run(ktv.validate_token("t")) == {"azp": "agrivisory-mobile", "sub": "u1"}

    def test_web_client_azp_accepted(self, monkeypatch):
        ktv = _primed_validator(monkeypatch, {"azp": "itu-agrivisory-client", "sub": "u1"})
        assert asyncio.run(ktv.validate_token("t")) is not None

    def test_unknown_azp_rejected(self, monkeypatch):
        ktv = _primed_validator(monkeypatch, {"azp": "evil-client", "sub": "u1"})
        assert asyncio.run(ktv.validate_token("t")) is None


class TestKidMissRefresh:
    def test_rotation_triggers_one_refresh_then_accepts(self, monkeypatch):
        ktv = _primed_validator(monkeypatch, {"azp": "itu-agrivisory-client"})
        old_keys = [{"kid": "old-kid"}]
        new_keys = [{"kid": "k1", "kty": "RSA", "n": "x", "e": "AQAB"}]
        fetch = AsyncMock(side_effect=[old_keys, new_keys])
        monkeypatch.setattr(ktv, "_fetch_jwks", fetch)

        assert asyncio.run(ktv.validate_token("t")) is not None
        assert fetch.await_count == 2  # cache-warm first pass, forced refresh second

    def test_unknown_kid_even_after_refresh_rejected(self, monkeypatch):
        ktv = _primed_validator(monkeypatch, {"azp": "itu-agrivisory-client"})
        fetch = AsyncMock(return_value=[{"kid": "some-other-kid"}])
        monkeypatch.setattr(ktv, "_fetch_jwks", fetch)

        assert asyncio.run(ktv.validate_token("t")) is None


class TestPerRequestToken:
    def test_concurrent_requests_do_not_bleed_tokens(self):
        import chatqna.genieai_chatqna as chatqna_module

        client = chatqna_module.GenieUserProfileClient()
        results = {}

        async def user(name, token):
            client.set_token(token)
            await asyncio.sleep(0.01)  # interleave: both set before either reads
            results[name] = client._token

        async def run():
            await asyncio.gather(user("alice", "Bearer alice"), user("bob", "Bearer bob"))

        asyncio.run(run())
        assert results["alice"] == "Bearer alice"
        assert results["bob"] == "Bearer bob"

    def test_outer_context_not_polluted_after_task(self):
        """Production property: a request task runs in a COPIED context — its token
        set must not overwrite the parent context's value (other tests may have set
        the var in this thread's context; that's how ContextVars work)."""
        import chatqna.genieai_chatqna as chatqna_module

        client = chatqna_module.GenieUserProfileClient()
        client.set_token("Bearer outer")

        async def task():
            client.set_token("Bearer inner")
            assert client._token == "Bearer inner"

        ctx = copy_context()
        ctx.run(asyncio.run, task())
        assert client._token == "Bearer outer"


class TestValidatorRejectionIsReal401:
    @pytest.mark.asyncio
    async def test_handle_request_returns_401_response_object(self, monkeypatch):
        import chatqna.genieai_chatqna as chatqna_module

        # create_chatqna_service idiom (test_chatqna.py): bypass heavy __init__
        svc = chatqna_module.ChatQnAService.__new__(chatqna_module.ChatQnAService)
        svc.host, svc.port = "0.0.0.0", 8888
        svc.megaservice = MagicMock()
        svc.endpoint = "/v1/chatqna"
        svc.user_profile_client = chatqna_module.GenieUserProfileClient()

        request = MagicMock()
        request.headers = {"Authorization": "Bearer bad-token"}
        request.json = AsyncMock(return_value={"messages": []})

        # handle_request imports validate_token inside the function — patch the
        # module it imports from. conftest's MagicMock shield means that name is
        # the mock module: set the attribute on it.
        import sys
        ktv = sys.modules["keycloak_token_validator"]
        monkeypatch.setattr(ktv, "validate_token", AsyncMock(return_value=None))

        resp = await svc.handle_request(request)

        assert getattr(resp, "status_code", None) == 401
