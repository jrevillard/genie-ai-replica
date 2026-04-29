"""
AMINA Care — Resilience API
==============================
Fronts the existing /api/v1/agent/chat with an automatic model-fallback layer.

    POST /api/v1/agent/chat-resilient   — drop-in for /agent/chat
    GET  /api/v1/models/status          — per-model health snapshot
    POST /api/v1/models/{model}/reset   — admin/dev: clear cooldown

Contract — /chat-resilient
--------------------------
- Accepts the same JSON body as /agent/chat (including `model_preference`).
- Response is the upstream response **plus** two added fields:
    model_used:     the model that actually produced the reply
    model_events:   list of {from, to, reason, kind} transitions we made
  Existing fields (response, suggest_form, triage_level, …) are preserved
  bit-for-bit so the frontend does not care whether it's talking to the
  resilient or the raw endpoint.
- Returns 503 if every candidate model in the chain fails.
- Surfaces TOKEN / BILLING / BAD signals as HTTP 401 / 402 / 400 respectively
  so the UI's existing auth-refresh flow keeps working — we never retry a
  model for those cases.

Implementation notes
--------------------
- The upstream call is made in-process via the FastAPI TestClient-style
  approach (httpx → loopback to 127.0.0.1:8000). This keeps the wrapper
  loose: when the real /agent/chat changes, we don't care.
- Circuit breaker trips on DOWN only. See model_health.py for the rule.
- The resilient endpoint never strips Authorization — JWT forwards.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from src.services import model_fallback, model_health, safety_consensus

logger = logging.getLogger(__name__)
router = APIRouter(tags=["resilience"])

# Where this process lives. The internal call is a loopback HTTP so the
# resilient endpoint stays decoupled from agent internals.
UPSTREAM_BASE     = os.getenv("RESILIENCE_UPSTREAM_BASE", "http://127.0.0.1:8000")
UPSTREAM_PATH     = "/api/v1/agent/chat"
UPSTREAM_TIMEOUT  = float(os.getenv("RESILIENCE_UPSTREAM_TIMEOUT", "90"))

# ── Models ───────────────────────────────────────────────────────────────────

class ModelEvent(BaseModel):
    from_: Optional[str] = Field(default=None, alias="from")
    to:    str
    reason: str
    kind:   str   # "DOWN" | "START"

    class Config:
        allow_population_by_field_name = True
        populate_by_name = True


class ModelsStatusResponse(BaseModel):
    chain:     List[str]
    live:      List[str]
    cooldown:  List[str]
    snapshots: Dict[str, Any]


# ── /chat-resilient ──────────────────────────────────────────────────────────

@router.post("/agent/chat-resilient")
async def chat_resilient(request: Request):
    body_bytes = await request.body()

    # Parse the body just enough to pull out the user's preferred model.
    # We forward the raw bytes afterwards so we don't accidentally strip
    # fields we don't know about.
    import json as _json
    try:
        body = _json.loads(body_bytes or b"{}")
    except Exception:
        body = {}
    preferred = (body.get("model_preference") or "").strip().lower() or None

    full_chain = model_fallback.chain_for(preferred)
    chain      = model_fallback.live_chain(preferred)
    skipped    = [m for m in full_chain if m not in chain]
    if not chain:
        # Everything is cooling down — try the full chain anyway so the
        # user gets *some* answer; this is the "nothing to lose" path.
        chain   = full_chain
        skipped = []
        logger.warning("resilience: all models in cooldown, trying anyway")

    forward_headers = _forward_headers(request.headers)
    events: List[Dict[str, Any]] = []
    last_status = 0
    last_detail = ""

    # Pre-emit DOWN events for any models the breaker filtered out so the
    # UI banner knows "we skipped your preferred because it's in cooldown"
    # even when the first attempt succeeded on the backup.
    for m in skipped:
        snap = model_health.snapshot(m)
        events.append({
            "from":   m,
            "to":     None,
            "reason": snap.get("last_failure_reason") or "cooldown",
            "kind":   "DOWN",
        })

    async with httpx.AsyncClient(timeout=UPSTREAM_TIMEOUT) as client:
        prev: Optional[str] = None
        for idx, model in enumerate(chain):
            # Mutate only the model_preference — preserve everything else.
            body["model_preference"] = model
            attempt_body = _json.dumps(body).encode("utf-8")

            events.append({
                "from":   prev,
                "to":     model,
                "reason": "preferred" if idx == 0 else "fallback",
                "kind":   "START" if idx == 0 else "FALLBACK",
            })

            try:
                r = await client.post(
                    f"{UPSTREAM_BASE}{UPSTREAM_PATH}",
                    content=attempt_body,
                    headers={**forward_headers, "Content-Type": "application/json"},
                )
            except httpx.HTTPError as e:
                cls = model_health.classify_error(e)
                _record_and_emit(events, model, cls)
                last_status, last_detail = 502, f"{type(e).__name__}: {e}"
                prev = model
                continue

            # Classify by status first, then by payload body.
            cls_status = model_health.classify_error(r.status_code)

            if cls_status["kind"] == "TOKEN":
                # DO NOT fall through — surface so the UI auth-refresh fires.
                logger.info(f"resilience: {model} returned TOKEN ({r.status_code})")
                return _passthrough(r, events, model, surface_auth=True)

            if cls_status["kind"] == "BILLING":
                return _passthrough(r, events, model, surface_auth=True)

            if cls_status["kind"] == "BAD":
                # Don't switch on BAD; surface to caller.
                return _passthrough(r, events, model)

            if cls_status["kind"] == "DOWN":
                _record_and_emit(events, model, cls_status)
                last_status, last_detail = r.status_code, r.text[:400]
                prev = model
                continue

            # status OK — still check body for embedded error (the agent
            # catches exceptions and returns 200 with an `error` field).
            try:
                payload = r.json()
            except Exception:
                payload = {"response": r.text}

            err_str = (payload.get("error") or "").strip()
            if err_str:
                cls_body = model_health.classify_error(err_str)
                if cls_body["kind"] == "TOKEN":
                    return _passthrough(r, events, model, surface_auth=True, body=payload)
                if cls_body["kind"] == "BILLING":
                    return _passthrough(r, events, model, surface_auth=True, body=payload)
                if cls_body["kind"] == "DOWN":
                    _record_and_emit(events, model, cls_body)
                    last_status, last_detail = 502, err_str[:400]
                    prev = model
                    continue
                # BAD / OK-with-error — surface to caller; don't churn models.

            # Success path.
            model_health.report_success(model)
            payload["model_used"]   = model
            payload["model_events"] = [e for e in events if e.get("kind") != "START" or len(events) > 1]
            # The frontend expects model_events to document *switches* that
            # happened. Always include at least the startup entry for
            # observability.
            if "model_events" not in payload or not payload["model_events"]:
                payload["model_events"] = events

            # Safety consensus guard — only runs when the reply contains
            # drug names / doses / prescribing verbs / emergency routing.
            # Never blocks: if the auditor is unreachable we fall open.
            primary_reply = str(payload.get("response") or "")
            auth_header   = forward_headers.get("Authorization") or forward_headers.get("authorization")
            try:
                guard = await safety_consensus.guard_reply(
                    user_message=str(body.get("message") or ""),
                    primary_reply=primary_reply,
                    primary_model=model,
                    auth_header=auth_header,
                )
            except Exception as e:  # defensive — guard itself must not break chat
                logger.warning(f"resilience: safety_consensus raised {type(e).__name__}: {e}")
                guard = {"action": "pass", "final_reply": primary_reply,
                         "safety_note": "",
                         "trace": {"skipped": "guard_exception", "error": str(e)[:200]}}

            if guard["action"] == "revise":
                payload["response_original"] = primary_reply
                payload["response"]          = guard["final_reply"]
            payload["safety_note"]  = guard.get("safety_note") or ""
            payload["safety_trace"] = guard.get("trace") or {}
            return JSONResponse(payload, status_code=200)

    # All candidates exhausted.
    logger.error(f"resilience: chain exhausted for {preferred!r}; events={events}")
    return JSONResponse(
        {
            "error":         "all_models_unavailable",
            "detail":        "Every configured model is currently unreachable.",
            "model_events":  events,
            "last_status":   last_status,
            "last_detail":   last_detail,
        },
        status_code=503,
    )


def _record_and_emit(events: List[Dict[str, Any]], model: str, cls: Dict[str, str]) -> None:
    model_health.report_failure(model, cls.get("reason", "unknown"), cls.get("kind", "DOWN"))
    events.append({
        "from":   model,
        "to":     None,
        "reason": cls.get("reason", "unknown"),
        "kind":   cls.get("kind", "DOWN"),
    })


def _passthrough(
    r: httpx.Response,
    events: List[Dict[str, Any]],
    model: str,
    surface_auth: bool = False,
    body: Optional[Dict[str, Any]] = None,
) -> JSONResponse:
    """
    Forward an upstream non-retryable response to the client with
    model_used / model_events appended. When surface_auth is True, we
    preserve the upstream status so the UI's existing 401 handling fires.
    """
    if body is None:
        try:
            body = r.json()
        except Exception:
            body = {"response": r.text}

    body["model_used"]   = model
    body["model_events"] = events
    return JSONResponse(body, status_code=r.status_code)


def _forward_headers(h) -> Dict[str, str]:
    """Keep Authorization + a few safe client-info headers, drop hop-by-hop."""
    keep = {}
    for k, v in h.items():
        lk = k.lower()
        if lk in ("authorization", "x-amina-session", "x-forwarded-for",
                  "accept-language", "user-agent"):
            keep[k] = v
    return keep


# ── /models/status ───────────────────────────────────────────────────────────

@router.get("/models/status", response_model=ModelsStatusResponse)
def models_status(preferred: Optional[str] = None):
    info = model_fallback.fallback_order(preferred)
    snaps = {m: model_health.snapshot(m) for m in info["chain"]}
    return ModelsStatusResponse(
        chain=info["chain"],
        live=info["live_order"],
        cooldown=info["cooldown"],
        snapshots=snaps,
    )


# ── /models/{model}/reset ────────────────────────────────────────────────────

@router.post("/models/{model}/reset")
def models_reset(model: str):
    if model not in model_fallback.KNOWN_MODELS:
        raise HTTPException(400, f"unknown model {model!r}")
    model_health.reset(model)
    return {"ok": True, "model": model, "reset": True}
