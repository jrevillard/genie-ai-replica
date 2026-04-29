"""
Dual-Path Care Ledger API — multi-entry records with 10-entry cap.
====================================================================

Same shape as supply_ledger_routes but for the four dual-path sections:
  - traditional  (practitioner, practices[], last_visit_days_ago, notes)
  - modern       (facility, chw_name, medications[], last_visit_days_ago, notes)
  - interaction  (safe: bool, notes)
  - progress     (bp_current, months_on_plan)

The legacy PUT /api/v1/care/dualpath/{sid}/{segment} endpoints overwrite
one record per segment. This ledger keeps each segment as a list so
clinicians can log multiple visits / interaction reviews / BP readings
over time without losing history, each with per-entry edit + delete.

Endpoints
---------
  GET    /api/v1/care/dualpath_ledger/{sid}
         → {
              traditional: envelope,
              modern:      envelope,
              interaction: envelope,
              progress:    envelope,
              cap: int,
              cap_per_type: int,
            }

  GET    /api/v1/care/dualpath_ledger/{sid}/{type}
         → envelope for one type
         envelope = { entries, count, cap, cap_remaining, limit_reached,
                      updated_at, updated_by }

  POST   /api/v1/care/dualpath_ledger/{sid}/{type}/add
         409 LIMIT_REACHED when type is at cap.

  PATCH  /api/v1/care/dualpath_ledger/{sid}/{type}/{index}

  DELETE /api/v1/care/dualpath_ledger/{sid}/{type}/{index}

Role gating
-----------
All writes go through the same `_resolve_effective_role` helper as the
legacy care routes; only roles in CAREPATH_WRITE_ROLES (= clinician,
admin) can mutate. Reads are public. That matches the existing
"care-path edits are locked to clinicians" rule in the UI.

Storage
-------
Separate Redis key: `care:dualpath_ledger:{session_id}` — a dict with
the 4 lists. Distinct from the legacy `care:dualpath:{session_id}` so
both endpoints coexist without stepping on each other.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from src.api.care_routes import (
    CAREPATH_WRITE_ROLES,
    _check_carepath_write_role,
    _resolve_effective_role,
    _get_service,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/care/dualpath_ledger", tags=["care", "dualpath_ledger"])

_TYPES = ("traditional", "modern", "interaction", "progress")

try:
    _CAP = int(os.getenv("DUALPATH_LEDGER_CAP", "10"))
except ValueError:
    _CAP = 10
DUALPATH_LEDGER_CAP = max(1, min(50, _CAP))


# ── helpers ────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now().isoformat()


def _key(session_id: str) -> str:
    return f"care:dualpath_ledger:{session_id}"


def _empty_store() -> Dict[str, Any]:
    return {
        "traditional": [],
        "modern":      [],
        "interaction": [],
        "progress":    [],
        "updated_at":  None,
        "updated_by":  None,
    }


def _load(session_id: str) -> Dict[str, Any]:
    """Read the ledger store. Never raises — defaults to an empty store."""
    svc = _get_service()
    try:
        raw = svc.redis.get(_key(session_id))
        if raw:
            data = json.loads(raw)
            # Backfill missing keys so envelopes stay stable if we add a
            # new type later.
            for t in _TYPES:
                data.setdefault(t, [])
            return data
    except Exception as exc:
        logger.warning(f"dualpath_ledger: load failed ({exc}) — using empty store")
    return _empty_store()


def _persist(session_id: str, data: Dict[str, Any], who: str) -> None:
    svc = _get_service()
    data["updated_at"] = _now_iso()
    data["updated_by"] = who
    svc.redis.setex(_key(session_id), svc.ttl, json.dumps(data, default=str))
    # Best-effort Arcade write-through (matches supply_ledger pattern).
    try:
        import asyncio
        coro = svc._persist_to_arcade(
            f"dualpath_ledger:{session_id}", "dualpath_ledger",
            data, who, "dualpath_ledger",
        )
        loop = asyncio.get_running_loop()
        loop.create_task(coro)
    except Exception as exc:
        logger.debug(f"arcade persist skipped: {exc}")


def _type_or_404(type_: str) -> str:
    t = (type_ or "").lower()
    if t not in _TYPES:
        raise HTTPException(
            status_code=404,
            detail={"code": "UNKNOWN_TYPE",
                    "message": f"Unknown dual-path type {type_!r}. "
                               f"Valid: {', '.join(_TYPES)}."},
        )
    return t


def _envelope(entries: List[Dict[str, Any]], data: Dict[str, Any]) -> Dict[str, Any]:
    count = len(entries)
    return {
        "entries":       entries,
        "count":         count,
        "cap":           DUALPATH_LEDGER_CAP,
        "cap_remaining": max(0, DUALPATH_LEDGER_CAP - count),
        "limit_reached": count >= DUALPATH_LEDGER_CAP,
        "updated_at":    data.get("updated_at"),
        "updated_by":    data.get("updated_by"),
    }


def _enforce_cap(entries: List[Dict[str, Any]], type_: str):
    if len(entries) >= DUALPATH_LEDGER_CAP:
        raise HTTPException(
            status_code=409,
            detail={
                "code":    "LIMIT_REACHED",
                "message": f"Dual-path {type_} ledger is at the "
                           f"{DUALPATH_LEDGER_CAP}-entry cap. Delete an entry "
                           f"before adding another.",
                "cap":     DUALPATH_LEDGER_CAP,
                "count":   len(entries),
                "type":    type_,
            },
        )


def _split_csv(val) -> List[str]:
    """Accept either a list or a comma-separated string (matches UI)."""
    if isinstance(val, list):
        return [str(x).strip() for x in val if str(x).strip()]
    if isinstance(val, str):
        return [p.strip() for p in val.split(",") if p.strip()]
    return []


# ── per-type entry normalizers ─────────────────────────────────────────

def _norm_traditional(body: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "practitioner":        str(body.get("practitioner") or "").strip(),
        "practices":           _split_csv(body.get("practices")),
        "last_visit_days_ago": int(body.get("last_visit_days_ago") or 0),
        "notes":               str(body.get("notes") or "").strip(),
        "logged_at":           _now_iso(),
    }


def _norm_modern(body: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "facility":            str(body.get("facility") or "").strip(),
        "chw_name":            str(body.get("chw_name") or "").strip(),
        "medications":         _split_csv(body.get("medications")),
        "last_visit_days_ago": int(body.get("last_visit_days_ago") or 0),
        "notes":               str(body.get("notes") or "").strip(),
        "logged_at":           _now_iso(),
    }


def _norm_interaction(body: Dict[str, Any]) -> Dict[str, Any]:
    safe = body.get("safe")
    return {
        "safe":      True if safe is None else bool(safe),
        "notes":     str(body.get("notes") or "").strip(),
        "logged_at": _now_iso(),
    }


def _norm_progress(body: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "bp_current":     str(body.get("bp_current") or "").strip(),
        "months_on_plan": int(body.get("months_on_plan") or 0),
        "notes":          str(body.get("notes") or "").strip(),
        "logged_at":      _now_iso(),
    }


_NORMALIZERS = {
    "traditional": _norm_traditional,
    "modern":      _norm_modern,
    "interaction": _norm_interaction,
    "progress":    _norm_progress,
}


def _merge_patch(type_: str, existing: Dict[str, Any], body: Dict[str, Any]) -> Dict[str, Any]:
    """Shallow-merge PATCH payload into an existing entry, per type.
    Unspecified keys keep their current values."""
    out = dict(existing)
    if type_ == "traditional":
        if "practitioner" in body:        out["practitioner"]        = str(body["practitioner"] or "").strip()
        if "practices"    in body:        out["practices"]           = _split_csv(body["practices"])
        if "last_visit_days_ago" in body: out["last_visit_days_ago"] = int(body["last_visit_days_ago"] or 0)
        if "notes"        in body:        out["notes"]               = str(body["notes"] or "").strip()
    elif type_ == "modern":
        if "facility"     in body:        out["facility"]            = str(body["facility"] or "").strip()
        if "chw_name"     in body:        out["chw_name"]            = str(body["chw_name"] or "").strip()
        if "medications"  in body:        out["medications"]         = _split_csv(body["medications"])
        if "last_visit_days_ago" in body: out["last_visit_days_ago"] = int(body["last_visit_days_ago"] or 0)
        if "notes"        in body:        out["notes"]               = str(body["notes"] or "").strip()
    elif type_ == "interaction":
        if "safe"  in body:               out["safe"]  = bool(body["safe"])
        if "notes" in body:               out["notes"] = str(body["notes"] or "").strip()
    elif type_ == "progress":
        if "bp_current"     in body:      out["bp_current"]     = str(body["bp_current"] or "").strip()
        if "months_on_plan" in body:      out["months_on_plan"] = int(body["months_on_plan"] or 0)
        if "notes"          in body:      out["notes"]          = str(body["notes"] or "").strip()
    out["logged_at"] = existing.get("logged_at") or _now_iso()
    out["edited_at"] = _now_iso()
    return out


# ── schemas ────────────────────────────────────────────────────────────

class AddRequest(BaseModel):
    # Accept everything; the per-type normalizer plucks what matters.
    practitioner:        Optional[str]  = None
    practices:           Optional[Any]  = None
    facility:            Optional[str]  = None
    chw_name:            Optional[str]  = None
    medications:         Optional[Any]  = None
    last_visit_days_ago: Optional[int]  = None
    notes:               Optional[str]  = None
    safe:                Optional[bool] = None
    bp_current:          Optional[str]  = None
    months_on_plan:      Optional[int]  = None
    role:                str = "clinician"


class PatchRequest(AddRequest):
    pass


class DeleteQuery(BaseModel):
    role: str = "clinician"


# ── routes ─────────────────────────────────────────────────────────────

@router.get("/{session_id}")
async def list_all(session_id: str):
    data = _load(session_id)
    return {
        "traditional":  _envelope(data["traditional"],  data),
        "modern":       _envelope(data["modern"],       data),
        "interaction":  _envelope(data["interaction"],  data),
        "progress":     _envelope(data["progress"],     data),
        "cap_per_type": DUALPATH_LEDGER_CAP,
    }


@router.get("/{session_id}/{type_}")
async def list_one(session_id: str, type_: str):
    t = _type_or_404(type_)
    data = _load(session_id)
    return _envelope(data[t], data)


@router.post("/{session_id}/{type_}/add")
async def add_entry(session_id: str, type_: str, req: AddRequest, request: Request):
    t = _type_or_404(type_)
    effective = _resolve_effective_role(request, req.role)
    _check_carepath_write_role(effective, tab=t)

    data = _load(session_id)
    entries = data[t]
    _enforce_cap(entries, t)

    entry = _NORMALIZERS[t](req.dict())
    entries.append(entry)
    data[t] = entries
    _persist(session_id, data, effective)
    logger.info(f"dualpath_ledger: +1 {t} total={len(entries)} "
                f"by={effective} sid={session_id}")

    env = _envelope(entries, data)
    env["added_index"] = len(entries) - 1
    return env


@router.patch("/{session_id}/{type_}/{index}")
async def patch_entry(
    session_id: str, type_: str, index: int,
    req: PatchRequest, request: Request,
):
    t = _type_or_404(type_)
    effective = _resolve_effective_role(request, req.role)
    _check_carepath_write_role(effective, tab=t)

    data = _load(session_id)
    entries = data[t]
    if index < 0 or index >= len(entries):
        raise HTTPException(
            status_code=404,
            detail={"code": "INDEX_OUT_OF_RANGE",
                    "message": f"No {t} entry at index {index} (count={len(entries)})."},
        )

    entries[index] = _merge_patch(t, entries[index], req.dict(exclude_unset=True))
    data[t] = entries
    _persist(session_id, data, effective)
    logger.info(f"dualpath_ledger: patch {t}[{index}] by={effective} sid={session_id}")

    env = _envelope(entries, data)
    env["updated_index"] = index
    return env


@router.delete("/{session_id}/{type_}/{index}")
async def delete_entry(
    session_id: str, type_: str, index: int,
    request: Request,
    role: Optional[str] = None,
):
    t = _type_or_404(type_)
    effective = _resolve_effective_role(request, role or "clinician")
    _check_carepath_write_role(effective, tab=t)

    data = _load(session_id)
    entries = data[t]
    if index < 0 or index >= len(entries):
        raise HTTPException(
            status_code=404,
            detail={"code": "INDEX_OUT_OF_RANGE",
                    "message": f"No {t} entry at index {index} (count={len(entries)})."},
        )

    removed = entries.pop(index)
    data[t] = entries
    _persist(session_id, data, effective)
    logger.info(f"dualpath_ledger: -1 {t} ({removed}) remaining={len(entries)} "
                f"by={effective} sid={session_id}")

    env = _envelope(entries, data)
    env["removed_index"] = index
    env["removed"]       = removed
    return env
