"""
Tests for configs/ssl/genie_ssl_patch.py — SSL bypass for OPEA services.

Run:
    pip install httpx aiohttp requests pytest
    OPEA_SSL_SKIP_VERIFY=1 python -m pytest tests/config/ssl/test_genie_ssl_patch.py -v

Note: monkey-patching is process-wide and irreversible within a single Python process.
Tests reload the module but cannot unpatch. The "restore" behavior must be verified
at deployment level (restart service with env var set to 0).
"""

import importlib.util
import os
import ssl
import sys

GENIE_SSL_PATCH_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "..",
    "..",
    "configs",
    "ssl",
    "genie_ssl_patch.py",
)


def reload_with_env(ssl_skip=""):
    """Reload genie_ssl_patch with isolated env vars."""
    # Remove any previous patch
    for mod_name in list(sys.modules):
        if "genie_ssl_patch" in mod_name:
            del sys.modules[mod_name]
    # Set env vars before import
    os.environ["OPEA_SSL_SKIP_VERIFY"] = ssl_skip
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
