"""
AMINA Care — DHIS2 History + Discovery API
=============================================
Admin-only endpoints that let the admin UI:

  GET /api/v1/dhis2/sync/history            — aggregate-push audit log
  GET /api/v1/dhis2/sync/history/tracker    — patient-level tracker audit log
  GET /api/v1/dhis2/discover                — live DHIS2 datasets
  GET /api/v1/dhis2/discover/dataset/{id}   — live dataset detail
  GET /api/v1/dhis2/discover/orgunit/{id}/children  — live OU children
  GET /api/v1/dhis2/mapping/current         — what's currently wired

Auth
----
All endpoints share the existing admin-only auth pattern from
dhis2_routes.py. We intentionally don't edit that file — we mount our
own router under the same `/api/v1/dhis2` prefix so the admin UI
reaches both families through the same base URL.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Request

from src.services import dhis2_history
from src.services.auth import verify_jwt

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/dhis2", tags=["dhis2-history"])


# Mirror DHIS2_DEV_ADMIN_BYPASS in dhis2_routes.py — keep both files in
# sync so a single env-var flip toggles the entire DHIS2 admin gate
# for local dev. See dhis2_routes.py for the security caveat.
import os as _os
DHIS2_DEV_ADMIN_BYPASS = (_os.getenv("DHIS2_DEV_ADMIN_BYPASS", "false") or "").lower() == "true"


def _require_admin(request: Request) -> dict:
    if DHIS2_DEV_ADMIN_BYPASS:
        return {"sub": "dev-admin-bypass", "role": "admin"}
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Admin authentication required")
    payload = verify_jwt(auth[7:])
    if not payload or payload.get("role") != "admin":
        raise HTTPException(403, "Admin access required")
    return payload


# ── Aggregate push history ─────────────────────────────────────────────────

@router.get("/sync/history")
def sync_history(
    request:  Request,
    limit:    int  = 50,
    since:    Optional[str] = None,
    until:    Optional[str] = None,
    success:  Optional[bool] = None,
    period:   Optional[str] = None,
):
    _require_admin(request)
    return dhis2_history.list_aggregate_history(
        limit=limit, since=since, until=until,
        success=success, period=period,
    )


# ── Tracker push history ───────────────────────────────────────────────────

@router.get("/sync/history/tracker")
def tracker_history(
    request: Request,
    limit:   int  = 50,
    since:   Optional[str] = None,
    until:   Optional[str] = None,
    success: Optional[bool] = None,
    patient_id: Optional[str] = None,
):
    _require_admin(request)
    return dhis2_history.list_tracker_history(
        limit=limit, since=since, until=until,
        success=success, patient_id=patient_id,
    )


# ── Live DHIS2 discovery ───────────────────────────────────────────────────

@router.get("/discover")
def discover(request: Request, page_size: int = 50):
    _require_admin(request)
    return dhis2_history.discover_datasets(page_size=page_size)


@router.get("/discover/dataset/{dataset_id}")
def discover_dataset(request: Request, dataset_id: str):
    _require_admin(request)
    return dhis2_history.describe_dataset(dataset_id)


@router.get("/discover/orgunit/{parent_id}/children")
def discover_orgunit_children(request: Request, parent_id: str, page_size: int = 50):
    _require_admin(request)
    return dhis2_history.discover_orgunit_children(parent_id, page_size=page_size)


@router.get("/mapping/current")
def current_mapping(request: Request):
    _require_admin(request)
    return dhis2_history.current_mapping()
