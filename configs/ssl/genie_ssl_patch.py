"""
genie_ssl_patch.py — GPU node communication patch for OPEA services.

Installed as sitecustomize.py to run before any library imports.

Handles two concerns for remote GPU node communication:
  1. SSL bypass (self-signed certs): OPEA_SSL_SKIP_VERIFY=1
  2. Auth header injection: VLLM_API_KEY → Authorization: Bearer on aiohttp and requests calls

When both env vars are unset, this module is a no-op.

WARNING: Only enable in trusted network environments.
"""

import os

_SSL_SKIP = os.getenv("OPEA_SSL_SKIP_VERIFY", "") == "1"
_VLLM_API_KEY = os.getenv("VLLM_API_KEY", "")


# --- SSL verification bypass ---
if _SSL_SKIP:
    import ssl

    _unverified = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    _unverified.check_hostname = False
    _unverified.verify_mode = ssl.CERT_NONE

    # Nuclear option: wrap ssl.SSLContext.wrap_socket to always use unverified
    # context on client-side sockets. This catches ALL callers — urllib3, httpx,
    # requests, and raw sockets — without patching individual libraries.
    _orig_wrap_socket = ssl.SSLContext.wrap_socket

    def _patched_wrap_socket(
        self,
        sock,
        server_side=False,
        do_handshake_on_connect=True,
        suppress_ragged_eofs=True,
        server_hostname=None,
        session=None,
    ):
        if not server_side:
            return _orig_wrap_socket(
                _unverified,
                sock,
                server_side=False,
                server_hostname=server_hostname,
                session=session,
            )
        return _orig_wrap_socket(
            self,
            sock,
            server_side=server_side,
            do_handshake_on_connect=do_handshake_on_connect,
            suppress_ragged_eofs=suppress_ragged_eofs,
            server_hostname=server_hostname,
            session=session,
        )

    ssl.SSLContext.wrap_socket = _patched_wrap_socket
    ssl.create_default_context = lambda *a, **kw: _unverified


# --- Auth header injection (aiohttp) ---
# The OPEA mega service orchestrator calls component endpoints via aiohttp.
# When endpoints point to a remote GPU node, they need Authorization: Bearer.
# ChatOpenAI/httpx send this natively, but the orchestrator's aiohttp calls do not.
if _VLLM_API_KEY:
    try:
        import aiohttp

        _orig_aiohttp_post = aiohttp.ClientSession.post
        _orig_aiohttp_get = aiohttp.ClientSession.get

        def _patched_aiohttp_post(self, url, **kwargs):
            headers = kwargs.setdefault("headers", {})
            headers.setdefault("Authorization", f"Bearer {_VLLM_API_KEY}")
            return _orig_aiohttp_post(self, url, **kwargs)

        def _patched_aiohttp_get(self, url, **kwargs):
            headers = kwargs.setdefault("headers", {})
            headers.setdefault("Authorization", f"Bearer {_VLLM_API_KEY}")
            return _orig_aiohttp_get(self, url, **kwargs)

        aiohttp.ClientSession.post = _patched_aiohttp_post
        aiohttp.ClientSession.get = _patched_aiohttp_get
    except ImportError:
        pass

    # Patch for requests: inject Authorization header + force verify=False.
    # The OPEA orchestrator uses sync requests.post(stream=True) for LLM streaming.
    # ChatOpenAI/httpx send Authorization natively, but requests does not.
    try:
        import requests as req_lib

        _orig_req_request = req_lib.Session.request

        def _patched_req_request(self, method, url, **kwargs):
            kwargs["verify"] = False
            headers = kwargs.setdefault("headers", {})
            headers.setdefault("Authorization", f"Bearer {_VLLM_API_KEY}")
            return _orig_req_request(self, method, url, **kwargs)

        req_lib.Session.request = _patched_req_request
    except ImportError:
        pass
