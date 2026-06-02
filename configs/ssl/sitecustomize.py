"""
sitecustomize.py — SSL bypass + API key injection for OPEA services.

Controls:
  OPEA_SSL_SKIP_VERIFY=1  Disable SSL cert verification (self-signed certs)
  OPEA_API_KEY=<key>       Inject X-API-Key header into all outbound HTTP calls

When both env vars are unset, this file is a no-op.

WARNING: Only enable in trusted network environments.
"""

import os

_SSL_SKIP = os.getenv("OPEA_SSL_SKIP_VERIFY", "") == "1"
_API_KEY = os.getenv("OPEA_API_KEY", "")


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


# --- API key header injection ---
def _get_headers(kwargs):
    """Extract headers dict from kwargs, defaulting to empty dict."""
    h = kwargs.get("headers")
    if h is None:
        kwargs["headers"] = {}
        return kwargs["headers"]
    return h


if _API_KEY:
    # httpx (used by embedding, reranker, OpenAI client, etc.)
    try:
        import httpx

        _orig_httpx_request = httpx.AsyncClient.request

        async def _patched_httpx_request(self, method, url, **kwargs):
            _get_headers(kwargs).setdefault("X-API-Key", _API_KEY)
            return await _orig_httpx_request(self, method, url, **kwargs)

        httpx.AsyncClient.request = _patched_httpx_request
    except ImportError:
        pass

    # aiohttp (used by OPEA orchestrator in chatqna)
    try:
        import aiohttp

        _orig_aiohttp_post = aiohttp.ClientSession.post
        _orig_aiohttp_get = aiohttp.ClientSession.get

        async def _patched_aiohttp_post(self, url, **kwargs):
            _get_headers(kwargs).setdefault("X-API-Key", _API_KEY)
            return await _orig_aiohttp_post(self, url, **kwargs)

        async def _patched_aiohttp_get(self, url, **kwargs):
            _get_headers(kwargs).setdefault("X-API-Key", _API_KEY)
            return await _orig_aiohttp_get(self, url, **kwargs)

        aiohttp.ClientSession.post = _patched_aiohttp_post
        aiohttp.ClientSession.get = _patched_aiohttp_get
    except ImportError:
        pass

    # requests (used by OPEA health checks, etc.)
    try:
        import requests as req_lib

        _orig_requests_request = req_lib.Session.request

        def _patched_requests_request(self, method, url, **kwargs):
            _get_headers(kwargs).setdefault("X-API-Key", _API_KEY)
            if _SSL_SKIP:
                kwargs.setdefault("verify", False)
            return _orig_requests_request(self, method, url, **kwargs)

        req_lib.Session.request = _patched_requests_request
    except ImportError:
        pass
