"""
DHIS2 Integration API Routes
============================
Admin-only endpoints to drive the AMINA Care → DHIS2 aggregate sync.

  GET  /dhis2/config            → current DHIS2 configuration (redacted)
  POST /dhis2/sync/manual       → trigger a manual sync for a given day
  POST /dhis2/sync/dry-run      → preview the payload that would be sent
  GET  /dhis2/sync/status       → last sync metadata
  GET  /dhis2/metrics/today     → live daily aggregate preview (no push)
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, date, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from src.config import settings
from src.services.auth import verify_jwt
from src.services import dhis2_sync, dhis2_tracker, dhis2_pull, android_capture_export

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/dhis2", tags=["dhis2"])


# Dev / local-stack escape hatch.
# When DHIS2_DEV_ADMIN_BYPASS=true the admin gate is satisfied by ANY
# authenticated request (or no auth at all). Same intent as
# CARE_TRUST_BODY_ROLE in care_routes.py: in local dev the user often
# logs in as patient and uses the floating RoleSwitcher to act as admin
# — without this flag the DHIS2 panels show empty ("nothing works")
# because every config/sync/dry-run/push button comes back 401/403.
# KEEP "false" in production: DHIS2 connects to a real external system
# (MoH HIS) and exposes write endpoints; admin auth is intentional.
import os as _os
DHIS2_DEV_ADMIN_BYPASS = (_os.getenv("DHIS2_DEV_ADMIN_BYPASS", "false") or "").lower() == "true"


# ── Admin auth ───────────────────────────────────────────────────────────────

def _require_admin(request: Request) -> dict:
    if DHIS2_DEV_ADMIN_BYPASS:
        # Dev mode — return a synthetic admin payload so downstream code
        # that reads sub/role keeps working without changes.
        return {"sub": "dev-admin-bypass", "role": "admin"}
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Admin authentication required")
    payload = verify_jwt(auth[7:])
    if not payload or payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return payload


def _require_patient(request: Request) -> dict:
    """Patient-only auth — used for DHIS2 self-service endpoints."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    payload = verify_jwt(auth[7:])
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    if payload.get("role") in ("admin", "caregiver"):
        raise HTTPException(status_code=403, detail="Patients only")
    return payload


# ── Config ───────────────────────────────────────────────────────────────────

@router.get("/config")
async def get_config(request: Request):
    """Return current DHIS2 config (credentials redacted)."""
    _require_admin(request)

    base_url = getattr(settings, "DHIS2_BASE_URL", "") or ""
    username = getattr(settings, "DHIS2_USERNAME", "") or ""
    has_password = bool(getattr(settings, "DHIS2_PASSWORD", ""))
    has_token    = bool(getattr(settings, "DHIS2_API_TOKEN", ""))
    dataset_id   = getattr(settings, "DHIS2_DATASET_ID", "") or ""

    orgunit_map     = dhis2_sync._load_orgunit_map()
    dataelement_map = dhis2_sync._load_dataelement_map()

    return {
        "base_url":          base_url,
        "username":          username,
        "auth_method":       "token" if has_token else ("basic" if has_password else "none"),
        "dataset_id":        dataset_id,
        "orgunit_mapping":   orgunit_map,
        "dataelement_mapping": dataelement_map,
        "metric_keys":       dhis2_sync.METRIC_KEYS,
        "configured":        bool(base_url) and (has_token or has_password),
    }


# ── Manual sync / dry run ────────────────────────────────────────────────────

class SyncRequest(BaseModel):
    day: Optional[str] = None  # YYYY-MM-DD; defaults to yesterday UTC


def _parse_day(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="day must be YYYY-MM-DD")


@router.post("/sync/manual")
async def sync_manual(body: SyncRequest, request: Request):
    """Trigger a sync and push to DHIS2."""
    _require_admin(request)
    day = _parse_day(body.day)
    try:
        result = dhis2_sync.sync_day(day=day, dry_run=False)
        return result
    except Exception as e:
        logger.exception("dhis2 manual sync failed")
        raise HTTPException(status_code=500, detail=f"sync failed: {e}")


@router.post("/sync/dry-run")
async def sync_dry_run(body: SyncRequest, request: Request):
    """Collect metrics + build the DHIS2 payload without pushing."""
    _require_admin(request)
    day = _parse_day(body.day)
    try:
        return dhis2_sync.sync_day(day=day, dry_run=True)
    except Exception as e:
        logger.exception("dhis2 dry-run failed")
        raise HTTPException(status_code=500, detail=f"dry-run failed: {e}")


@router.get("/sync/status")
async def sync_status(request: Request):
    """Return metadata about the most recent sync."""
    _require_admin(request)
    try:
        import redis as _redis
        r = _redis.Redis(host=settings.REDIS_HOST, port=settings.REDIS_PORT, decode_responses=True)
        raw = r.get("dhis2:last_sync")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"redis unavailable: {e}")

    if not raw:
        return {"last_sync": None, "message": "No syncs recorded yet"}
    try:
        return {"last_sync": json.loads(raw)}
    except Exception:
        return {"last_sync": None, "message": "last-sync record corrupt"}


@router.get("/metrics/today")
async def metrics_today(request: Request):
    """Live preview of today's aggregate metrics (no push)."""
    _require_admin(request)
    today = datetime.utcnow().date()
    metrics = dhis2_sync.collect_daily_metrics(today)
    return {
        "day":    today.isoformat(),
        "period": dhis2_sync._dhis2_period(today),
        "by_region": metrics,
        "totals": {
            k: sum(b[k] for b in metrics.values()) for k in dhis2_sync.METRIC_KEYS
        },
    }


# ── Phase 2.3 — Tracker API (patient-level push) ────────────────────────────

class TrackerPushRequest(BaseModel):
    patient_id: str
    force:      bool = False  # Admin override for consent check


class TrackerBatchRequest(BaseModel):
    patient_ids: list[str]
    force:       bool = False


@router.get("/tracker/config")
async def tracker_config(request: Request):
    """Current DHIS2 Tracker configuration (redacted)."""
    _require_admin(request)
    return {
        "enabled":          dhis2_tracker._tracker_enabled(),
        "program_id":       dhis2_tracker._program_id(),
        "program_stage_id": dhis2_tracker._program_stage_id(),
        "tei_type_id":      dhis2_tracker._tei_type_id(),
        "attribute_map":    dhis2_tracker._load_attribute_map(),
        "data_element_map": dhis2_tracker._load_data_element_map(),
        "orgunit_count":    len(dhis2_sync._load_orgunit_map()),
        "configured":       bool(
            dhis2_tracker._tracker_enabled()
            and dhis2_tracker._program_id()
            and dhis2_tracker._program_stage_id()
            and dhis2_tracker._tei_type_id()
            and dhis2_tracker._load_attribute_map()
        ),
    }


@router.post("/tracker/push")
async def tracker_push(body: TrackerPushRequest, request: Request):
    """Push a single patient (TEI + enrollment + events) to DHIS2 Tracker."""
    _require_admin(request)
    try:
        return dhis2_tracker.push_patient(body.patient_id, dry_run=False, force=body.force)
    except Exception as e:
        logger.exception("dhis2 tracker push failed")
        raise HTTPException(status_code=500, detail=f"push failed: {e}")


@router.post("/tracker/dry-run")
async def tracker_dry_run(body: TrackerPushRequest, request: Request):
    """Build TEI/enrollment/event payloads without posting to DHIS2."""
    _require_admin(request)
    try:
        return dhis2_tracker.push_patient(body.patient_id, dry_run=True, force=body.force)
    except Exception as e:
        logger.exception("dhis2 tracker dry-run failed")
        raise HTTPException(status_code=500, detail=f"dry-run failed: {e}")


@router.post("/tracker/batch")
async def tracker_batch(body: TrackerBatchRequest, request: Request):
    """Push multiple patients sequentially."""
    _require_admin(request)
    if len(body.patient_ids) > 100:
        raise HTTPException(status_code=400, detail="Max 100 patients per batch")
    try:
        return dhis2_tracker.push_batch(body.patient_ids, dry_run=False)
    except Exception as e:
        logger.exception("dhis2 tracker batch failed")
        raise HTTPException(status_code=500, detail=f"batch failed: {e}")


# ── Phase 2.6 — Bi-directional pull ──────────────────────────────────────────

class PullRequest(BaseModel):
    since: Optional[str] = None   # ISO timestamp
    dry_run: bool = False


@router.post("/pull/manual")
async def pull_manual(body: PullRequest, request: Request):
    """Manually trigger a DHIS2 referral pull."""
    _require_admin(request)
    try:
        return dhis2_pull.run_pull(since=body.since, dry_run=body.dry_run)
    except Exception as e:
        logger.exception("dhis2 pull failed")
        raise HTTPException(status_code=500, detail=f"pull failed: {e}")


@router.get("/pull/referrals/{patient_id}")
async def get_patient_referrals(patient_id: str, request: Request, unack_only: bool = False):
    """Return DHIS2 referrals for a specific patient."""
    _require_admin(request)
    rows = dhis2_pull.get_referrals_for_patient(patient_id, unacknowledged_only=unack_only)
    return {"patient_id": patient_id, "total": len(rows), "referrals": rows}


@router.get("/pull/referrals/unlinked/all")
async def get_unlinked_referrals(request: Request, limit: int = 50):
    """Admin reconciliation queue — referrals that couldn't be mapped to an AMINA patient."""
    _require_admin(request)
    rows = dhis2_pull.get_unlinked_referrals(limit=limit)
    return {"total": len(rows), "referrals": rows}


@router.post("/pull/acknowledge/{referral_id}")
async def acknowledge_referral(referral_id: str, request: Request):
    """Mark a referral as acknowledged (caregiver has read it)."""
    _require_admin(request)
    ok = dhis2_pull.acknowledge_referral(referral_id)
    if not ok:
        raise HTTPException(status_code=500, detail="acknowledge failed")
    return {"ok": True, "referral_id": referral_id}


# ── Patient self-service referral endpoints (Phase B UI) ─────────────────────

@router.get("/pull/my-referrals")
async def get_my_referrals(request: Request, unack_only: bool = False):
    """
    Patient self-service: return DHIS2 referrals addressed to this patient.
    Uses the caller's JWT patient_id — not a URL parameter — so one patient
    can never fetch another patient's referrals.
    """
    patient = _require_patient(request)
    pid = patient.get("sub", "")
    rows = dhis2_pull.get_referrals_for_patient(pid, unacknowledged_only=unack_only)
    return {"patient_id": pid, "total": len(rows), "referrals": rows}


@router.post("/pull/my-referrals/{referral_id}/ack")
async def acknowledge_my_referral(referral_id: str, request: Request):
    """
    Patient self-service: mark a referral as acknowledged.
    The referral must belong to the caller — verified against its patient_id.
    """
    patient = _require_patient(request)
    pid = patient.get("sub", "")
    # Verify the referral belongs to this patient
    my_refs = dhis2_pull.get_referrals_for_patient(pid)
    owned = any(r.get("referral_id") == referral_id for r in my_refs)
    if not owned:
        raise HTTPException(status_code=403, detail="Referral not found or not yours")
    ok = dhis2_pull.acknowledge_referral(referral_id)
    if not ok:
        raise HTTPException(status_code=500, detail="acknowledge failed")
    return {"ok": True, "referral_id": referral_id}


# ── Phase 2.7 — DHIS2 Android Capture export ────────────────────────────────

class AndroidExportRegion(BaseModel):
    region: str
    include_unconsented: bool = False


class AndroidExportIds(BaseModel):
    patient_ids: list[str]
    include_unconsented: bool = False


@router.post("/android/export/region")
async def android_export_region(body: AndroidExportRegion, request: Request):
    """Export an offline-capable DHIS2 trackerImport bundle for all patients in a region."""
    _require_admin(request)
    try:
        return android_capture_export.export_region(
            body.region, include_unconsented=body.include_unconsented,
        )
    except Exception as e:
        logger.exception("android export region failed")
        raise HTTPException(status_code=500, detail=f"export failed: {e}")


@router.post("/android/export/ids")
async def android_export_ids(body: AndroidExportIds, request: Request):
    """Export an offline-capable bundle for a specific list of patient IDs."""
    _require_admin(request)
    if len(body.patient_ids) > 500:
        raise HTTPException(status_code=400, detail="Max 500 patients per export")
    try:
        return android_capture_export.export_patient_ids(
            body.patient_ids, include_unconsented=body.include_unconsented,
        )
    except Exception as e:
        logger.exception("android export ids failed")
        raise HTTPException(status_code=500, detail=f"export failed: {e}")


@router.get("/tracker/audit")
async def tracker_audit(request: Request, patient_id: Optional[str] = None, limit: int = 50):
    """
    Phase 2.10 — read the patient-level Tracker push audit log.

    Every TEI/enrollment/event push is recorded with: patient_id, TEI uid,
    consent version at push time, success/failure, triggered_by.
    """
    _require_admin(request)
    if limit > 500:
        limit = 500
    rows = dhis2_tracker.get_tracker_audit(patient_id=patient_id, limit=limit)
    return {
        "total":   len(rows),
        "filter":  {"patient_id": patient_id, "limit": limit},
        "entries": rows,
    }
