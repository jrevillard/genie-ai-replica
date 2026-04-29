"""
AMINA Care — LLM Provider Response-Header Middleware (ASGI)
=============================================================
Reads the per-request provider metadata that
src/services/llm_provider_policy.py sets on a contextvar, and projects
it onto X-LLM-* response headers for /api/v1/agent/chat* responses.

Why a custom ASGI middleware instead of @app.middleware("http")?
----------------------------------------------------------------
Starlette's BaseHTTPMiddleware (the implementation behind the
@app.middleware("http") decorator) wraps the downstream call in
`anyio.create_task_group()`, which spawns the handler in a CHILD task.
ContextVar changes made in the child do not propagate back to the
parent task once the child finishes, so reading the contextvar from
the middleware after `call_next(request)` returns gives stale defaults.

A pure ASGI middleware that just delegates `await self.app(scope,
receive, send)` stays in the same task as the handler, so the
contextvar value the patch wrote inside `process_message` is visible
to our `send` wrapper here. We use this pattern via `app.add_middleware`.

Headers added (only when the contextvar is non-empty):
  X-LLM-Provider              groq | gemini | openai | amina-lora | …
  X-LLM-Preferred             same set
  X-LLM-Fallback-Used         true | false
  X-LLM-Latency-Ms            integer milliseconds
  X-LLM-Context               guest | auth
  X-LLM-Mode                  graceful | warn | strict
  X-LLM-Show-Badge            true | false  (operator hint to the UI)
  X-LLM-Provider-Error        first 120 chars of the primary error, if any

Also exposes a tiny diagnostic GET endpoint:
  /api/v1/llm/policy → {mode, fallback_chain, require_lora, ...}

Both reads only — no behaviour change. Wired by main_with_rag_tuning.py.
"""
from __future__ import annotations

import logging
from typing import Iterable, List, Tuple

import json
import re

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from src.services.llm_provider_policy import (
    SHOW_BADGE,
    provider_meta_var,
    policy_snapshot,
)

logger = logging.getLogger("llm_provider_middleware")


# ── Helpers ───────────────────────────────────────────────────────
def _add_or_replace_header(
    headers: List[Tuple[bytes, bytes]],
    name: str,
    value: str,
) -> None:
    """Idempotently set a header, replacing any prior value (case-insensitive)."""
    if value is None:
        return
    name_b   = name.lower().encode("ascii")
    value_b  = str(value).encode("ascii", "ignore")
    # Drop any prior value with the same name.
    headers[:] = [(k, v) for (k, v) in headers if k.lower() != name_b]
    headers.append((name_b, value_b))


def _project_meta_onto_headers(meta: dict, raw_headers: Iterable[Tuple[bytes, bytes]]) -> List[Tuple[bytes, bytes]]:
    headers: List[Tuple[bytes, bytes]] = list(raw_headers)
    if meta.get("provider_used"):
        _add_or_replace_header(headers, "X-LLM-Provider",      meta["provider_used"])
    if meta.get("preferred_provider"):
        _add_or_replace_header(headers, "X-LLM-Preferred",     meta["preferred_provider"])
    _add_or_replace_header(headers, "X-LLM-Fallback-Used",     "true" if meta.get("fallback_used") else "false")
    _add_or_replace_header(headers, "X-LLM-Latency-Ms",        str(int(meta.get("latency_ms") or 0)))
    if meta.get("context"):
        _add_or_replace_header(headers, "X-LLM-Context",       meta["context"])
    if meta.get("mode"):
        _add_or_replace_header(headers, "X-LLM-Mode",          meta["mode"])
    _add_or_replace_header(headers, "X-LLM-Show-Badge",        "true" if SHOW_BADGE else "false")
    err = meta.get("provider_error_summary")
    if err:
        _add_or_replace_header(headers, "X-LLM-Provider-Error", str(err)[:120])
    return headers


# ── ASGI middleware class ─────────────────────────────────────────
class LLMProviderHeaderASGIMiddleware:
    """Pure ASGI middleware. Runs in the same task as the handler so
    contextvar values written inside the route function are visible
    here when we wrap http.response.start."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "") or ""
        is_chat = path.startswith("/api/v1/agent/") or path.startswith("/agent/")
        if not is_chat:
            await self.app(scope, receive, send)
            return

        # Reset contextvar at the start of every chat request so a
        # stale value from a worker re-use can't leak across requests.
        provider_meta_var.set(None)

        async def send_wrapper(message):
            try:
                if message.get("type") == "http.response.start":
                    meta = provider_meta_var.get(None)
                    if isinstance(meta, dict) and meta:
                        message["headers"] = _project_meta_onto_headers(
                            meta, message.get("headers", []) or [],
                        )
            except Exception:
                # Never break the response over header projection.
                pass
            await send(message)

        await self.app(scope, receive, send_wrapper)


# ── Diagnostic /llm/policy + installer ────────────────────────────
def install_provider_middleware(app) -> None:
    """Install the ASGI middleware + diagnostic route. Idempotent."""
    if getattr(app.state, "_llm_provider_mw", False):
        return
    app.state._llm_provider_mw = True

    app.add_middleware(LLMProviderHeaderASGIMiddleware)

    # ── Strict-mode exception unwrapping ─────────────────────────────
    # The chat route at src/api/agent_routes.py wraps every uncaught
    # exception from process_message in HTTPException(500, str(e)) —
    # which mangles our strict-mode HTTPException(503, {code:...}) into
    # a 500 with a stringified detail. Detect that pattern and re-emit
    # as a clean 503 JSON so the frontend can display the right code.
    _STRICT_RE = re.compile(
        r"^503:\s*(\{.*['\"]code['\"]\s*:\s*['\"](?:amina_lora_unavailable|all_providers_unavailable)['\"].*\})",
        re.DOTALL,
    )

    @app.exception_handler(HTTPException)
    async def _llm_unwrap_strict(request: Request, exc: HTTPException):
        try:
            if (
                exc.status_code == 500
                and isinstance(exc.detail, str)
                and exc.detail.startswith("503:")
            ):
                m = _STRICT_RE.match(exc.detail)
                if m:
                    # Detail was a Python repr of a dict, not JSON. Use ast.literal_eval.
                    import ast
                    try:
                        payload = ast.literal_eval(m.group(1))
                    except Exception:
                        payload = {"code": "amina_lora_unavailable",
                                   "message": "Amina model is temporarily unavailable."}
                    headers = {}
                    meta = provider_meta_var.get(None)
                    if isinstance(meta, dict) and meta:
                        headers = {
                            "X-LLM-Mode":             str(meta.get("mode") or "strict"),
                            "X-LLM-Preferred":        str(meta.get("preferred_provider") or ""),
                            "X-LLM-Fallback-Used":    "false",
                            "X-LLM-Show-Badge":       "true" if SHOW_BADGE else "false",
                            "X-LLM-Provider-Error":   str(meta.get("provider_error_summary") or "")[:120],
                        }
                    return JSONResponse(
                        status_code=503,
                        content={"detail": payload},
                        headers=headers,
                    )
        except Exception:
            pass
        # Fall through to FastAPI's default for everything else.
        from fastapi.exception_handlers import http_exception_handler
        return await http_exception_handler(request, exc)

    diag = APIRouter(prefix="/llm", tags=["llm-policy"])

    @diag.get("/policy")
    async def get_policy():
        return policy_snapshot()

    app.include_router(diag, prefix="/api/v1")
    logger.info(
        "llm_provider_middleware installed (ASGI X-LLM-* headers + /llm/policy + strict-503 unwrapper)"
    )
