"""Proxy validated requests to the AMINA backend (haystack-chatqna)."""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional, Tuple

import httpx

from . import config

logger = logging.getLogger(__name__)


_CLIENT: Optional[httpx.AsyncClient] = None


def _get_client() -> httpx.AsyncClient:
    global _CLIENT
    if _CLIENT is None or _CLIENT.is_closed:
        _CLIENT = httpx.AsyncClient(
            timeout=httpx.Timeout(config.PROXY_TIMEOUT_S, connect=10.0),
            limits=httpx.Limits(
                max_connections=50,
                max_keepalive_connections=20,
            ),
        )
    return _CLIENT


async def post_json(
    backend_path: str,
    body: Dict[str, Any],
    *,
    headers: Optional[Dict[str, str]] = None,
) -> Tuple[int, Dict[str, Any], int]:
    """POST to backend. Returns (status_code, response_body, response_bytes)."""
    url = f"{config.BACKEND_URL}{backend_path}"
    fwd_headers = {"Content-Type": "application/json"}
    if headers:
        # Forward selected headers — explicit allowlist, not blanket
        # forwarding (don't pass through Authorization unless backend
        # also lives on the same trust boundary).
        for k in ("X-Request-ID", "X-Forwarded-For", "User-Agent"):
            if k in headers:
                fwd_headers[k] = headers[k]
    try:
        r = await _get_client().post(url, json=body, headers=fwd_headers)
    except httpx.TimeoutException as e:
        logger.warning("proxy: backend timeout for %s: %s", backend_path, e)
        return 504, {"error": "backend_timeout"}, 0
    except httpx.ConnectError as e:
        logger.warning("proxy: backend unreachable for %s: %s", backend_path, e)
        return 503, {"error": "backend_unreachable"}, 0
    except Exception as e:
        logger.warning("proxy: unexpected error for %s: %s", backend_path, e)
        return 502, {"error": "bad_gateway"}, 0

    response_bytes = len(r.content or b"")
    try:
        return r.status_code, r.json(), response_bytes
    except Exception:
        # Backend returned non-JSON; pass through as raw text wrapped.
        return r.status_code, {"raw": r.text}, response_bytes


async def close() -> None:
    global _CLIENT
    if _CLIENT and not _CLIENT.is_closed:
        try:
            await _CLIENT.aclose()
        except Exception:
            pass
