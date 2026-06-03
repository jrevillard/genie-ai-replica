"""
genie_ssl_patch.py — SSL bypass for OPEA services.

Import as the first line of any Python entry point that needs to call remote
GPU node endpoints with self-signed certificates.

Controls:
  OPEA_SSL_SKIP_VERIFY=1  Disable SSL cert verification (self-signed certs)

When unset, this module is a no-op.

WARNING: Only enable in trusted network environments.
"""

import os

_SSL_SKIP = os.getenv("OPEA_SSL_SKIP_VERIFY", "") == "1"


# --- SSL verification bypass ---
if _SSL_SKIP:
    import ssl

    _unverified = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    _unverified.check_hostname = False
    _unverified.verify_mode = ssl.CERT_NONE

    ssl.create_default_context = lambda *a, **kw: _unverified

    # aiohttp: ClientSession creates TCPConnector internally;
    # patch the constructor to inject ssl=False into the connector.
    try:
        import aiohttp

        _orig_session_init = aiohttp.ClientSession.__init__

        def _patched_session_init(self, *args, **kwargs):
            if "connector" not in kwargs:
                kwargs["connector"] = aiohttp.TCPConnector(ssl=False)
            return _orig_session_init(self, *args, **kwargs)

        aiohttp.ClientSession.__init__ = _patched_session_init
    except ImportError:
        pass
