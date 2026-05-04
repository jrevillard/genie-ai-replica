"""Abuse-defense admin endpoints (Phase E).

All endpoints are gated by the existing admin JWT (Bearer token with
``role=admin``) — same auth pattern used by ``admin_routes.py``.

Endpoints:
    GET  /api/v1/admin/abuse/status                 — module config snapshot
    GET  /api/v1/admin/abuse/flagged                — list admin-flagged users
    GET  /api/v1/admin/abuse/recent                 — recent classifications
    GET  /api/v1/admin/abuse/user/{key}             — full state snapshot
    POST /api/v1/admin/abuse/user/{key}/release     — manually clear cool-down
    GET  /api/v1/admin/abuse/stats                  — aggregate counts over window

NEVER raises 5xx for "no data" cases; helpers return empty lists / zero
counts on missing files. The admin UI can always render *something*.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from src.services.auth import verify_jwt
from src.abuse_defense import admin_api


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/abuse", tags=["abuse-admin"])


# ── Auth helper ─────────────────────────────────────────────────────
# Mirrors ``admin_routes._verify_admin``. We re-implement here rather
# than import to avoid a circular dependency through the abuse_defense
# module: admin_routes pulls in many dependencies (ArcadeDB SQL, etc.)
# that we don't need on this route file.
def _verify_admin(request: Request) -> Dict[str, Any]:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Admin authentication required")
    token = auth[7:].strip()
    payload = verify_jwt(token) or {}
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return payload


# ── Request bodies ──────────────────────────────────────────────────

class ReleaseRequest(BaseModel):
    reason: str
    also_clear_session_terminate: bool = False


# ── Routes ──────────────────────────────────────────────────────────

@router.get("/status")
def abuse_admin_status(request: Request):
    _verify_admin(request)
    return admin_api.status_snapshot()


@router.get("/flagged")
def abuse_admin_flagged(
    request: Request,
    days_back: int = Query(default=30, ge=1, le=365),
):
    _verify_admin(request)
    rows = admin_api.list_admin_flags(days_back=days_back)
    return {
        "days_back": days_back,
        "count":     len(rows),
        "rows":      rows,
    }


@router.get("/recent")
def abuse_admin_recent(
    request: Request,
    limit: int        = Query(default=100, ge=1, le=1000),
    abuse_only: bool  = Query(default=False),
    days_back: int    = Query(default=7, ge=1, le=90),
    category:  Optional[str] = Query(default=None),
    user_id:   Optional[str] = Query(default=None),
    session_id: Optional[str] = Query(default=None),
):
    _verify_admin(request)
    rows = admin_api.list_recent_classifications(
        limit=limit,
        abuse_only=abuse_only,
        days_back=days_back,
        category=category,
        user_id=user_id,
        session_id=session_id,
    )
    return {
        "limit":      limit,
        "abuse_only": abuse_only,
        "days_back":  days_back,
        "filters": {
            "category":   category,
            "user_id":    user_id,
            "session_id": session_id,
        },
        "count":      len(rows),
        "rows":       rows,
    }


@router.get("/user/{key:path}")
def abuse_admin_user(request: Request, key: str):
    _verify_admin(request)
    if not key or not key.strip():
        raise HTTPException(status_code=400, detail="key is required")
    return admin_api.get_user_state(key.strip())


@router.post("/user/{key:path}/release")
def abuse_admin_release(
    request:    Request,
    key:        str,
    body:       ReleaseRequest,
):
    payload = _verify_admin(request)
    admin_id = payload.get("sub") or "unknown_admin"
    if not key or not key.strip():
        raise HTTPException(status_code=400, detail="key is required")
    if not (body.reason or "").strip():
        raise HTTPException(status_code=400, detail="reason is required for audit")
    result = admin_api.release_user(
        key.strip(),
        admin_id=admin_id,
        reason=body.reason.strip(),
        also_clear_session_terminate=body.also_clear_session_terminate,
    )
    return result


@router.get("/stats")
def abuse_admin_stats(
    request:   Request,
    days_back: int = Query(default=7, ge=1, le=90),
):
    _verify_admin(request)
    return admin_api.aggregate_stats(days_back=days_back)
