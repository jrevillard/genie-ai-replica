"""Proxy validated requests to the AMINA backend (haystack-chatqna).

Two modes:
  * post_json()           - structured JSON proxy used by the existing
                            public/chat + public/translate endpoints. Strips
                            credentials, runs through schema validation
                            first, returns (status, body, bytes).
  * transparent_forward() - byte-for-byte reverse proxy used by the
                            catch-all route in main.py. Forwards method,
                            headers (incl. Authorization), body, query
                            string. Streams the response so SSE chat works.

The two modes coexist - the structured one is used where the gateway
needs to inspect the body (jailbreak detection); the transparent one
is used for everything else now that the public hostname routes
api.amina-design.com -> amina-gateway:8443 (step 6).
"""
from __future__ import annotations

import logging
from typing import Any, AsyncIterator, Dict, Optional, Tuple

import httpx
from fastapi import Request
from fastapi.responses import StreamingResponse

from . import config

logger = logging.getLogger(__name__)


_CLIENT: Optional[httpx.AsyncClient] = None


# Hop-by-hop headers per RFC 7230 - never forward these. Plus Host (which
# httpx sets per the new target) and Content-Length (httpx recomputes).
_HOP_BY_HOP = frozenset({
    "host", "connection", "keep-alive", "proxy-authenticate",
    "proxy-authorization", "te", "trailers", "transfer-encoding",
    "upgrade", "content-length",
})


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


# ── Transparent reverse proxy ────────────────────────────────────────

async def transparent_forward(request: Request, full_path: str) -> StreamingResponse:
    """Stream-forward an arbitrary request to the haystack backend.

    Preserves method, headers (Authorization included - the gateway sits
    on the same trust boundary as the backend, since both are inside the
    docker network and only the tunnel reaches them externally), body,
    and query string. Streams the response so SSE endpoints
    (/api/v1/agent/chat-stream) keep working.
    """
    backend_url = f"{config.BACKEND_URL}/{full_path}"
    if request.url.query:
        backend_url += f"?{request.url.query}"

    fwd_headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in _HOP_BY_HOP
    }
    # Add the real client IP so the backend's audit log doesn't see the
    # gateway as the source of every request. CF sets cf-connecting-ip;
    # otherwise fall back to the immediate peer.
    real_ip = (
        request.headers.get("cf-connecting-ip")
        or (request.client.host if request.client else "")
    )
    if real_ip:
        existing = fwd_headers.get("x-forwarded-for", "")
        fwd_headers["x-forwarded-for"] = (
            f"{existing}, {real_ip}" if existing else real_ip
        )

    body = await request.body() if request.method not in ("GET", "HEAD") else None

    client = _get_client()

    # ── Bridged-restart resilience ────────────────────────────────────
    # When haystack-chatqna is recreated (env-file change) docker drops
    # its endpoint from the user-defined network briefly; cloudflared +
    # the gateway both see a 1-3 s window of "no such host" /
    # "connection refused". Retry a few times before surfacing 503 so
    # routine restarts don't user-visibly fail.
    #
    # IMPORTANT: only safe to retry IDEMPOTENT requests. POSTs against
    # /agent/chat are at-most-once on the haystack side (it doesn't run
    # the LLM until the request is fully accepted), so a connect-stage
    # retry won't double-bill. We retry on:
    #   * httpx.ConnectError (DNS NX, TCP refused)
    #   * httpx.RemoteProtocolError (server closed mid-handshake)
    # We do NOT retry on:
    #   * 5xx response status (server may have started processing)
    #   * timeout (the request may already be in-flight on the backend)
    import asyncio as _asyncio
    backoffs = (0.2, 0.5, 1.0, 2.0)   # ~3.7s total ceiling
    backend_resp = None
    last_err: Optional[Exception] = None

    for attempt, delay in enumerate([0.0] + list(backoffs)):
        if delay > 0:
            await _asyncio.sleep(delay)
        # Build a fresh Request each attempt; httpx's stream consumes
        # the underlying body iterator, so we can't re-send the same one.
        req = client.build_request(
            method=request.method,
            url=backend_url,
            headers=fwd_headers,
            content=body,
        )
        try:
            backend_resp = await client.send(req, stream=True)
            break
        except httpx.TimeoutException as e:
            # Don't retry timeouts — request may be in flight on backend.
            return StreamingResponse(
                iter([b'{"error":"backend_timeout","detail":"Backend took too long to respond. Please try again in a moment."}']),
                status_code=504,
                media_type="application/json",
            )
        except (httpx.ConnectError, httpx.RemoteProtocolError) as e:
            last_err = e
            logger.info("transparent_forward retry %d/%d: %s %s -> %s",
                        attempt + 1, len(backoffs) + 1, request.method, full_path, type(e).__name__)
            continue
        except Exception as e:
            logger.warning("transparent_forward: %s %s -> %s",
                           request.method, full_path, e)
            return StreamingResponse(
                iter([b'{"error":"bad_gateway","detail":"The care service had an unexpected error. Please try again."}']),
                status_code=502,
                media_type="application/json",
            )

    if backend_resp is None:
        # All retries exhausted — backend genuinely unreachable.
        logger.warning("transparent_forward exhausted retries for %s %s: %s",
                       request.method, full_path, last_err)
        return StreamingResponse(
            iter([
                b'{"error":"backend_starting",'
                b'"detail":"AMINA is briefly restarting. Please retry in a few seconds."}'
            ]),
            status_code=503,
            media_type="application/json",
        )

    # Strip hop-by-hop headers from the backend's response too, plus
    # Content-Length (Starlette recomputes for streamed responses).
    response_headers = {
        k: v for k, v in backend_resp.headers.items()
        if k.lower() not in _HOP_BY_HOP
    }

    async def body_iterator() -> AsyncIterator[bytes]:
        try:
            async for chunk in backend_resp.aiter_raw():
                yield chunk
        finally:
            await backend_resp.aclose()

    return StreamingResponse(
        body_iterator(),
        status_code=backend_resp.status_code,
        headers=response_headers,
        media_type=backend_resp.headers.get("content-type"),
    )


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
