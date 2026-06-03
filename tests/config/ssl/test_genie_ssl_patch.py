"""
Tests for configs/ssl/genie_ssl_patch.py — SSL bypass + API key injection.

Run:
    pip install httpx aiohttp requests pytest
    OPEA_SSL_SKIP_VERIFY=1 OPEA_API_KEY=test-key-123 python -m pytest tests/config/ssl/test_genie_ssl_patch.py -v

Note: monkey-patching is process-wide and irreversible within a single Python process.
Tests reload the module but cannot unpatch. The "restore" behavior must be verified
at deployment level (restart service with env var set to 0).
"""

import asyncio
import importlib.util
import os
import ssl
import sys
from unittest import mock

GENIE_SSL_PATCH_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "..",
    "..",
    "configs",
    "ssl",
    "genie_ssl_patch.py",
)


def reload_with_env(ssl_skip="", api_key=""):
    """Reload genie_ssl_patch with isolated env vars."""
    # Remove any previous patch
    for mod_name in list(sys.modules):
        if "genie_ssl_patch" in mod_name:
            del sys.modules[mod_name]
    # Set env vars before import
    os.environ["OPEA_SSL_SKIP_VERIFY"] = ssl_skip
    os.environ["OPEA_API_KEY"] = api_key
    spec = importlib.util.spec_from_file_location("genie_ssl_patch", GENIE_SSL_PATCH_PATH)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["genie_ssl_patch"] = mod
    spec.loader.exec_module(mod)
    return mod


# =============================================================================
# SSL bypass tests
# =============================================================================


class TestSSLBypass:
    """Verify SSL verification bypass."""

    def setup_method(self):
        reload_with_env(ssl_skip="0", api_key="")

    def teardown_method(self):
        os.environ.pop("OPEA_SSL_SKIP_VERIFY", None)
        os.environ.pop("OPEA_API_KEY", None)

    def test_ssl_verify_by_default(self):
        """Default: SSL verification is ON (CERT_REQUIRED)."""
        ctx = ssl.create_default_context()
        assert ctx.verify_mode == ssl.CERT_REQUIRED, "SSL should be verified by default"

    def test_ssl_skip_when_enabled(self):
        """OPEA_SSL_SKIP_VERIFY=1: SSL verification is OFF (CERT_NONE)."""
        reload_with_env(ssl_skip="1", api_key="")
        ctx = ssl.create_default_context()
        assert ctx.verify_mode == ssl.CERT_NONE, "SSL should be bypassed when enabled"

    def test_ssl_skip_is_one_way(self):
        """Monkey-patch is process-wide and irreversible.
        Once OPEA_SSL_SKIP_VERIFY=1 is loaded, setting it to 0 does NOT
        restore verification — the service must be restarted."""
        reload_with_env(ssl_skip="1", api_key="")
        assert ssl.create_default_context().verify_mode == ssl.CERT_NONE

        reload_with_env(ssl_skip="0", api_key="")
        assert ssl.create_default_context().verify_mode == ssl.CERT_NONE, (
            "Patch is irreversible — restart service to restore"
        )


# =============================================================================
# _get_headers helper tests
# =============================================================================


class TestGetHeaders:
    """Verify the _get_headers helper function."""

    def setup_method(self):
        self.mod = reload_with_env(ssl_skip="0", api_key="")

    def teardown_method(self):
        os.environ.pop("OPEA_SSL_SKIP_VERIFY", None)
        os.environ.pop("OPEA_API_KEY", None)

    def test_creates_dict_when_headers_missing(self):
        """_get_headers creates empty dict when headers key absent from kwargs."""
        kwargs = {}
        result = self.mod._get_headers(kwargs)
        assert result == {}
        assert "headers" in kwargs

    def test_creates_dict_when_headers_none(self):
        """_get_headers converts None headers to empty dict (no AttributeError)."""
        kwargs = {"headers": None}
        result = self.mod._get_headers(kwargs)
        assert result == {}
        assert kwargs["headers"] == {}

    def test_returns_existing_headers(self):
        """_get_headers returns existing headers dict unchanged."""
        h = {"Authorization": "Bearer token"}
        kwargs = {"headers": h}
        result = self.mod._get_headers(kwargs)
        assert result is h
        assert result == {"Authorization": "Bearer token"}


# =============================================================================
# API key injection tests
# =============================================================================


class TestApiKeyInjection:
    """Verify X-API-Key header injection into HTTP libraries.

    Strategy: reload genie_ssl_patch with OPEA_API_KEY set, then mock the
    inner _orig_* function that the patched wrapper delegates to.
    This way the patched code actually runs and we capture what it passes.
    """

    def setup_method(self):
        reload_with_env(ssl_skip="0", api_key="")

    def teardown_method(self):
        os.environ.pop("OPEA_SSL_SKIP_VERIFY", None)
        os.environ.pop("OPEA_API_KEY", None)

    # --- httpx ---

    def test_httpx_async_injects_key(self):
        """httpx.AsyncClient.request injects X-API-Key when OPEA_API_KEY is set."""
        mod = reload_with_env(ssl_skip="0", api_key="test-api-key-123")
        import httpx

        called = {}
        orig_inner = mod._orig_httpx_request

        async def fake_inner(self, method, url, **kwargs):
            called["headers"] = kwargs.get("headers")
            return mock.AsyncMock(status_code=200)

        mod._orig_httpx_request = fake_inner
        try:
            asyncio.run(
                httpx.AsyncClient.request(None, "GET", "https://example.com/test")
            )
        except Exception:
            pass
        finally:
            mod._orig_httpx_request = orig_inner

        assert called.get("headers") is not None, "headers should be passed to inner"
        assert called["headers"].get("X-API-Key") == "test-api-key-123"

    def test_httpx_no_patch_when_empty(self):
        """httpx is NOT patched when OPEA_API_KEY is empty."""
        mod = reload_with_env(ssl_skip="0", api_key="")
        assert not hasattr(mod, "_orig_httpx_request"), (
            "Should not have patched httpx when API key is empty"
        )

    def test_httpx_injects_into_none_headers(self):
        """httpx injects X-API-Key even when headers kwarg is None."""
        mod = reload_with_env(ssl_skip="0", api_key="test-key")
        import httpx

        called = {}
        orig_inner = mod._orig_httpx_request

        async def fake_inner(self, method, url, **kwargs):
            called["headers"] = kwargs.get("headers")
            return mock.AsyncMock(status_code=200)

        mod._orig_httpx_request = fake_inner
        try:
            asyncio.run(
                httpx.AsyncClient.request(
                    None, "GET", "https://example.com/test", headers=None
                )
            )
        except Exception:
            pass
        finally:
            mod._orig_httpx_request = orig_inner

        assert called.get("headers") is not None
        assert called["headers"].get("X-API-Key") == "test-key"

    def test_httpx_preserves_existing_headers(self):
        """httpx preserves existing headers and adds X-API-Key alongside."""
        mod = reload_with_env(ssl_skip="0", api_key="test-api-key-123")
        import httpx

        called = {}
        orig_inner = mod._orig_httpx_request

        async def fake_inner(self, method, url, **kwargs):
            called["headers"] = kwargs.get("headers")
            return mock.AsyncMock(status_code=200)

        mod._orig_httpx_request = fake_inner
        try:
            asyncio.run(
                httpx.AsyncClient.request(
                    None,
                    "GET",
                    "https://example.com/test",
                    headers={"Authorization": "Bearer xyz"},
                )
            )
        except Exception:
            pass
        finally:
            mod._orig_httpx_request = orig_inner

        assert called["headers"]["Authorization"] == "Bearer xyz"
        assert called["headers"]["X-API-Key"] == "test-api-key-123"

    # --- aiohttp ---

    def test_aiohttp_post_injects_key(self):
        """aiohttp.ClientSession.post injects X-API-Key when OPEA_API_KEY is set."""
        mod = reload_with_env(ssl_skip="0", api_key="test-api-key-123")
        import aiohttp

        called = {}
        orig_inner = mod._orig_aiohttp_post

        async def fake_inner(self, url, **kwargs):
            called["headers"] = kwargs.get("headers")
            return mock.AsyncMock()

        mod._orig_aiohttp_post = fake_inner
        try:
            asyncio.run(aiohttp.ClientSession.post(None, "https://example.com/test"))
        except Exception:
            pass
        finally:
            mod._orig_aiohttp_post = orig_inner

        assert called.get("headers") is not None
        assert called["headers"].get("X-API-Key") == "test-api-key-123"

    def test_aiohttp_get_injects_key(self):
        """aiohttp.ClientSession.get injects X-API-Key when OPEA_API_KEY is set."""
        mod = reload_with_env(ssl_skip="0", api_key="test-api-key-123")
        import aiohttp

        called = {}
        orig_inner = mod._orig_aiohttp_get

        async def fake_inner(self, url, **kwargs):
            called["headers"] = kwargs.get("headers")
            return mock.AsyncMock()

        mod._orig_aiohttp_get = fake_inner
        try:
            asyncio.run(aiohttp.ClientSession.get(None, "https://example.com/test"))
        except Exception:
            pass
        finally:
            mod._orig_aiohttp_get = orig_inner

        assert called.get("headers") is not None
        assert called["headers"].get("X-API-Key") == "test-api-key-123"

    def test_aiohttp_no_patch_when_empty(self):
        """aiohttp is NOT patched when OPEA_API_KEY is empty."""
        mod = reload_with_env(ssl_skip="0", api_key="")
        assert not hasattr(mod, "_orig_aiohttp_post"), (
            "Should not have patched aiohttp when API key is empty"
        )

    # --- requests ---

    def test_requests_session_injects_key(self):
        """requests.Session.request injects X-API-Key when OPEA_API_KEY is set."""
        mod = reload_with_env(ssl_skip="0", api_key="test-api-key-123")
        import requests as req_lib

        called = {}
        orig_inner = mod._orig_requests_request

        def fake_inner(self, method, url, **kwargs):
            called["headers"] = kwargs.get("headers")
            return mock.Mock(status_code=200)

        mod._orig_requests_request = fake_inner
        try:
            req_lib.Session().request("GET", "https://example.com/test")
        except Exception:
            pass
        finally:
            mod._orig_requests_request = orig_inner

        assert called.get("headers") is not None
        assert called["headers"].get("X-API-Key") == "test-api-key-123"

    def test_requests_no_patch_when_empty(self):
        """requests is NOT patched when OPEA_API_KEY is empty."""
        mod = reload_with_env(ssl_skip="0", api_key="")
        assert not hasattr(mod, "_orig_requests_request"), (
            "Should not have patched requests when API key is empty"
        )

    def test_requests_injects_into_none_headers(self):
        """requests injects X-API-Key even when headers kwarg is None."""
        mod = reload_with_env(ssl_skip="0", api_key="test-key")
        import requests as req_lib

        called = {}
        orig_inner = mod._orig_requests_request

        def fake_inner(self, method, url, **kwargs):
            called["headers"] = kwargs.get("headers")
            return mock.Mock(status_code=200)

        mod._orig_requests_request = fake_inner
        try:
            req_lib.Session().request("GET", "https://example.com/test", headers=None)
        except Exception:
            pass
        finally:
            mod._orig_requests_request = orig_inner

        assert called.get("headers") is not None
        assert called["headers"].get("X-API-Key") == "test-key"

    def test_requests_skips_ssl_verify_when_enabled(self):
        """requests.Session.request sets verify=False when OPEA_SSL_SKIP_VERIFY=1."""
        mod = reload_with_env(ssl_skip="1", api_key="test-api-key-123")
        import requests as req_lib

        called = {}
        orig_inner = mod._orig_requests_request

        def fake_inner(self, method, url, **kwargs):
            called["verify"] = kwargs.get("verify")
            called["headers"] = kwargs.get("headers")
            return mock.Mock(status_code=200)

        mod._orig_requests_request = fake_inner
        try:
            req_lib.Session().request("GET", "https://example.com/test")
        except Exception:
            pass
        finally:
            mod._orig_requests_request = orig_inner

        assert called["verify"] is False, "verify should be False when SSL_SKIP enabled"
        assert called["headers"].get("X-API-Key") == "test-api-key-123"

    def test_requests_no_verify_override_when_disabled(self):
        """requests does NOT set verify=False when OPEA_SSL_SKIP_VERIFY is off."""
        mod = reload_with_env(ssl_skip="0", api_key="test-api-key-123")
        import requests as req_lib

        called = {}
        orig_inner = mod._orig_requests_request

        def fake_inner(self, method, url, **kwargs):
            called["verify"] = kwargs.get("verify", "NOT_SET")
            called["headers"] = kwargs.get("headers")
            return mock.Mock(status_code=200)

        mod._orig_requests_request = fake_inner
        try:
            req_lib.Session().request("GET", "https://example.com/test")
        except Exception:
            pass
        finally:
            mod._orig_requests_request = orig_inner

        assert called["verify"] == "NOT_SET", (
            "verify should NOT be injected when SSL_SKIP disabled"
        )
        assert called["headers"].get("X-API-Key") == "test-api-key-123"
