"""
Tests for configs/ssl/genie_ssl_patch.py — SSL bypass & auth injection for OPEA services.

Run:
    pip install httpx aiohttp requests pytest
    python -m pytest tests/config/ssl/test_genie_ssl_patch.py -v

Note: monkey-patching is process-wide and irreversible within a single Python process.
Tests reload the module but cannot unpatch. The "restore" behavior must be verified
at deployment level (restart service with env var set to 0).
"""

import importlib.util
import os
import ssl
import sys
from unittest.mock import MagicMock

GENIE_SSL_PATCH_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "..",
    "..",
    "configs",
    "ssl",
    "genie_ssl_patch.py",
)


def reload_with_env(ssl_skip="", vllm_api_key=""):
    """Reload genie_ssl_patch with isolated env vars.

    Captures the original class methods before patching so tests can
    verify injection without being affected by previous test runs.
    """
    # Remove any previous patch module
    for mod_name in list(sys.modules):
        if "genie_ssl_patch" in mod_name:
            del sys.modules[mod_name]
    # Set env vars before import
    os.environ["OPEA_SSL_SKIP_VERIFY"] = ssl_skip
    os.environ.pop("VLLM_API_KEY", None)
    if vllm_api_key:
        os.environ["VLLM_API_KEY"] = vllm_api_key
    spec = importlib.util.spec_from_file_location(
        "genie_ssl_patch", GENIE_SSL_PATCH_PATH
    )
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
        reload_with_env(ssl_skip="0")

    def teardown_method(self):
        os.environ.pop("OPEA_SSL_SKIP_VERIFY", None)

    def test_ssl_verify_by_default(self):
        """Default: SSL verification is ON (CERT_REQUIRED)."""
        ctx = ssl.create_default_context()
        assert ctx.verify_mode == ssl.CERT_REQUIRED, "SSL should be verified by default"

    def test_ssl_skip_when_enabled(self):
        """OPEA_SSL_SKIP_VERIFY=1: SSL verification is OFF (CERT_NONE)."""
        reload_with_env(ssl_skip="1")
        ctx = ssl.create_default_context()
        assert ctx.verify_mode == ssl.CERT_NONE, "SSL should be bypassed when enabled"

    def test_ssl_skip_is_one_way(self):
        """Monkey-patch is process-wide and irreversible.
        Once OPEA_SSL_SKIP_VERIFY=1 is loaded, setting it to 0 does NOT
        restore verification — the service must be restarted."""
        reload_with_env(ssl_skip="1")
        assert ssl.create_default_context().verify_mode == ssl.CERT_NONE

        reload_with_env(ssl_skip="0")
        assert ssl.create_default_context().verify_mode == ssl.CERT_NONE, (
            "Patch is irreversible — restart service to restore"
        )


# =============================================================================
# Auth header injection tests (requests)
# =============================================================================


class TestRequestsAuthInjection:
    """Verify Authorization header injection on requests.Session.request.

    Strategy: install a mock as the original Session.request BEFORE reload,
    so the patch wraps the mock. Calls flow through: patched_fn → mock.
    """

    def teardown_method(self):
        os.environ.pop("VLLM_API_KEY", None)
        os.environ.pop("OPEA_SSL_SKIP_VERIFY", None)

    def test_requests_post_injects_auth(self):
        """VLLM_API_KEY set: requests.Session.request injects Authorization header."""
        import requests

        mock_request = MagicMock(return_value=MagicMock(status_code=200))
        requests.Session.request = mock_request
        reload_with_env(vllm_api_key="test-secret-key")

        session = requests.Session()
        session.request(
            "POST",
            "https://gpu.example.com/v1/chat/completions",
            json={"model": "test"},
        )

        mock_request.assert_called_once()
        call_kwargs = mock_request.call_args[1]
        assert call_kwargs["headers"]["Authorization"] == "Bearer test-secret-key"

    def test_requests_get_injects_auth(self):
        """VLLM_API_KEY set: GET requests also get Authorization header."""
        import requests

        mock_request = MagicMock(return_value=MagicMock(status_code=200))
        requests.Session.request = mock_request
        reload_with_env(vllm_api_key="test-secret-key")

        session = requests.Session()
        session.request("GET", "https://gpu.example.com/v1/models")

        call_kwargs = mock_request.call_args[1]
        assert call_kwargs["headers"]["Authorization"] == "Bearer test-secret-key"

    def test_requests_no_auth_when_key_unset(self):
        """VLLM_API_KEY empty: no Authorization header injected."""
        import requests

        mock_request = MagicMock(return_value=MagicMock(status_code=200))
        requests.Session.request = mock_request
        reload_with_env(vllm_api_key="")

        session = requests.Session()
        session.request(
            "POST",
            "https://gpu.example.com/v1/chat/completions",
            json={"model": "test"},
        )

        call_kwargs = mock_request.call_args[1]
        assert "headers" not in call_kwargs or "Authorization" not in call_kwargs.get(
            "headers", {}
        )

    def test_requests_preserves_existing_auth(self):
        """Existing Authorization header is preserved (setdefault behavior).
        Verifies the patch does NOT overwrite an already-set header with
        the VLLM_API_KEY value — setdefault only inserts when absent."""
        import requests

        mock_request = MagicMock(return_value=MagicMock(status_code=200))
        requests.Session.request = mock_request
        reload_with_env(vllm_api_key="test-secret-key")

        session = requests.Session()
        session.request(
            "POST",
            "https://gpu.example.com/v1/chat/completions",
            json={"model": "test"},
            headers={"Authorization": "Bearer custom-token"},
        )

        call_kwargs = mock_request.call_args[1]
        assert call_kwargs["headers"]["Authorization"] == "Bearer custom-token"
        assert call_kwargs["headers"]["Authorization"] != "Bearer test-secret-key"

    def test_requests_auth_with_ssl_skip(self):
        """Both VLLM_API_KEY and OPEA_SSL_SKIP_VERIFY: auth AND verify=False injected."""
        import requests

        mock_request = MagicMock(return_value=MagicMock(status_code=200))
        requests.Session.request = mock_request
        reload_with_env(ssl_skip="1", vllm_api_key="test-secret-key")

        session = requests.Session()
        session.request(
            "POST",
            "https://gpu.example.com/v1/chat/completions",
            json={"model": "test"},
        )

        call_kwargs = mock_request.call_args[1]
        assert call_kwargs["headers"]["Authorization"] == "Bearer test-secret-key"
        assert call_kwargs["verify"] is False


# =============================================================================
# Auth header injection tests (aiohttp)
# =============================================================================


class TestAiohttpAuthInjection:
    """Verify Authorization header injection on aiohttp.ClientSession.post/get.

    Strategy: install mocks as original methods BEFORE reload,
    so the patch wraps the mocks. Also mock __init__ to avoid
    real TCPConnector creation.
    """

    def teardown_method(self):
        os.environ.pop("VLLM_API_KEY", None)
        os.environ.pop("OPEA_SSL_SKIP_VERIFY", None)

    def test_aiohttp_post_injects_auth(self):
        """VLLM_API_KEY set: aiohttp.ClientSession.post injects Authorization header."""
        import aiohttp

        mock_init = MagicMock(return_value=None)
        mock_post = MagicMock(return_value=MagicMock())
        aiohttp.ClientSession.__init__ = mock_init
        aiohttp.ClientSession.post = mock_post
        reload_with_env(vllm_api_key="test-secret-key")

        session = aiohttp.ClientSession()
        session.post(
            "https://gpu.example.com/v1/chat/completions", json={"model": "test"}
        )

        mock_post.assert_called_once()
        call_kwargs = mock_post.call_args[1]
        assert call_kwargs["headers"]["Authorization"] == "Bearer test-secret-key"

    def test_aiohttp_get_injects_auth(self):
        """VLLM_API_KEY set: aiohttp.ClientSession.get injects Authorization header."""
        import aiohttp

        mock_init = MagicMock(return_value=None)
        mock_get = MagicMock(return_value=MagicMock())
        aiohttp.ClientSession.__init__ = mock_init
        aiohttp.ClientSession.get = mock_get
        reload_with_env(vllm_api_key="test-secret-key")

        session = aiohttp.ClientSession()
        session.get("https://gpu.example.com/v1/models")

        call_kwargs = mock_get.call_args[1]
        assert call_kwargs["headers"]["Authorization"] == "Bearer test-secret-key"

    def test_aiohttp_no_auth_when_key_unset(self):
        """VLLM_API_KEY empty: no Authorization header injected."""
        import aiohttp

        mock_init = MagicMock(return_value=None)
        mock_post = MagicMock(return_value=MagicMock())
        aiohttp.ClientSession.__init__ = mock_init
        aiohttp.ClientSession.post = mock_post
        reload_with_env(vllm_api_key="")

        session = aiohttp.ClientSession()
        session.post(
            "https://gpu.example.com/v1/chat/completions", json={"model": "test"}
        )

        call_kwargs = mock_post.call_args[1]
        assert "headers" not in call_kwargs or "Authorization" not in call_kwargs.get(
            "headers", {}
        )

    def test_aiohttp_preserves_existing_auth(self):
        """Existing Authorization header is preserved (setdefault behavior).
        Verifies the patch does NOT overwrite an already-set header with
        the VLLM_API_KEY value — setdefault only inserts when absent."""
        import aiohttp

        mock_init = MagicMock(return_value=None)
        mock_post = MagicMock(return_value=MagicMock())
        aiohttp.ClientSession.__init__ = mock_init
        aiohttp.ClientSession.post = mock_post
        reload_with_env(vllm_api_key="test-secret-key")

        session = aiohttp.ClientSession()
        session.post(
            "https://gpu.example.com/v1/chat/completions",
            json={"model": "test"},
            headers={"Authorization": "Bearer custom-token"},
        )

        call_kwargs = mock_post.call_args[1]
        assert call_kwargs["headers"]["Authorization"] == "Bearer custom-token"
        assert call_kwargs["headers"]["Authorization"] != "Bearer test-secret-key"
