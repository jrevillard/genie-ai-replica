"""
Supply Ledger API — multi-entry medicine supply with 10-entry cap.
====================================================================

The existing PUT /api/v1/care/supply/{sid} "upserts" a medication by
name: it updates when the name already exists, appends otherwise. That
gives us a growing medications[] list but no cap, no per-entry edit
(only by-name), and no delete. The UI can't surface a proper multi-
entry ledger on top of that.

This additive router layers the missing ops beside the existing ones
WITHOUT touching care_routes.py:

  GET    /api/v1/care/supply_ledger/{sid}
         → { medications, count, cap, limit_reached, cap_remaining }

  POST   /api/v1/care/supply_ledger/{sid}/add
         Body:  { medication_name, tablets_remaining, cost_per_pack,
                  refill_location, in_stock, dosage, frequency,
                  tablets_per_day, role }
         Adds a NEW row. Refuses with 409 LIMIT_REACHED if the list
         is already at the cap, so the UI can surface the cap banner
         instead of silently appending. Duplicate names get a numeric
         suffix (e.g. "Amlodipine (2)") so clinicians can keep two
         parallel records without merging.

  PATCH  /api/v1/care/supply_ledger/{sid}/medications/{index}
         Partial update of an existing row, addressed by list index
         (NOT name — names can duplicate and rows reorder when earlier
         entries are deleted).

  DELETE /api/v1/care/supply_ledger/{sid}/medications/{index}
         Removes a row. Cap + re-derived stock flags are recomputed on
         the next read.

Role gating
-----------
Writes reuse the same effective-role resolver from care_routes so the
admin-impersonation flow keeps working. The ledger shares the
`SUPPLY_WRITE_ROLES = {clinician, vhw, admin}` allowlist. Reads are
public (no auth).

Storage
-------
The router reads / writes the same Redis supply record used by the
existing care service (`PatientCareService._supply_key`). We do NOT
maintain a parallel store — so the existing PUT /care/supply and the
dashboard composer both see ledger edits immediately.

Why a cap?
----------
The UI is a small card, not a pharmacy. We let up to 10 rows accumulate
so clinicians can keep running notes (e.g. old prescriptions, dose
history) without the card growing unbounded and forcing scrolling
behavior the card isn't designed for. 10 is stored in env
SUPPLY_LEDGER_CAP so it's easy to retune later without touching code.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

# Reuse the effective-role resolver + gate set from care_routes so the
# admin-impersonation flow matches exactly — no divergence between
# legacy PUT /care/supply and the new ledger endpoints.
from src.api.care_routes import (
    SUPPLY_WRITE_ROLES,
    _check_write_role,
    _resolve_effective_role,
    _get_service,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/care/supply_ledger", tags=["care", "supply_ledger"])

# Cap is configurable — operations team can retune without a code push.
# Clamped to [1, 50] so a misconfigured env var can't accidentally
# disable the cap or blow out the UI.
try:
    _CAP = int(os.getenv("SUPPLY_LEDGER_CAP", "10"))
except ValueError:
    _CAP = 10
SUPPLY_LEDGER_CAP = max(1, min(50, _CAP))


# ── helpers ────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now().isoformat()


async def _load(session_id: str) -> Dict[str, Any]:
    """Fetch the canonical supply record via the existing service (keeps
    the auto-decay + auto-seed behavior — no duplicate logic here)."""
    svc = _get_service()
    return await svc.get_supply(session_id)


def _persist_direct(svc, session_id: str, data: Dict[str, Any]) -> None:
    """Write the supply record back to Redis + best-effort Arcade. We
    reach into the service's private helpers rather than round-tripping
    through update_supply() because update_supply is name-upsert; we
    need index-addressed semantics here."""
    key = svc._supply_key(session_id)
    svc.redis.setex(key, svc.ttl, json.dumps(data, default=str))
    # Arcade persistence is best-effort — never 500 on a Redis-only env.
    try:
        import asyncio
        coro = svc._persist_to_arcade(
            f"supply:{session_id}", "supply", data,
            data.get("updated_by", "system"), "supply_ledger",
        )
        # _persist_to_arcade is async — call it fire-and-forget.
        loop = asyncio.get_running_loop()
        loop.create_task(coro)
    except Exception as exc:
        logger.debug(f"arcade persist skipped: {exc}")


def _derive_stock_flags(med: Dict[str, Any]) -> None:
    """Recompute days_remaining / low_stock / critical_stock in-place.
    Mirrors the auto-decay block in PatientCareService.get_supply so a
    freshly-added row shows sensible flags on the very next read."""
    tabs = med.get("tablets_remaining", 0) or 0
    per_day = med.get("tablets_per_day", 1) or 1
    days = max(0, tabs // per_day) if per_day > 0 else 0
    med["days_remaining"] = days
    med["low_stock"] = days <= 7
    med["critical_stock"] = days <= 3
    med["estimated_runout"] = (
        (datetime.now().replace(microsecond=0).isoformat()
         if days == 0 else None)
    )


def _dedupe_name(existing: List[Dict[str, Any]], name: str) -> str:
    """If `name` already exists, append a numeric suffix so the clinician
    can keep parallel records. Case-insensitive."""
    norm = (name or "").strip()
    if not norm:
        raise HTTPException(status_code=400, detail="medication_name required")
    names_lower = {(m.get("name") or "").lower() for m in existing}
    if norm.lower() not in names_lower:
        return norm
    suffix = 2
    while f"{norm} ({suffix})".lower() in names_lower:
        suffix += 1
    return f"{norm} ({suffix})"


def _ledger_envelope(data: Dict[str, Any]) -> Dict[str, Any]:
    meds = data.get("medications") or []
    count = len(meds)
    return {
        "medications":    meds,
        "count":          count,
        "cap":            SUPPLY_LEDGER_CAP,
        "cap_remaining":  max(0, SUPPLY_LEDGER_CAP - count),
        "limit_reached":  count >= SUPPLY_LEDGER_CAP,
        "updated_at":     data.get("updated_at"),
        "updated_by":     data.get("updated_by"),
    }


# ── Pydantic schemas ───────────────────────────────────────────────────

class LedgerAddRequest(BaseModel):
    medication_name:   str
    tablets_remaining: Optional[int]  = 0
    tablets_per_day:   Optional[int]  = 1
    cost_per_pack:     Optional[str]  = ""
    refill_location:   Optional[str]  = ""
    dosage:            Optional[str]  = ""
    frequency:         Optional[str]  = ""
    in_stock:          Optional[bool] = True
    role:              str = "clinician"


class LedgerPatchRequest(BaseModel):
    medication_name:   Optional[str]  = None
    tablets_remaining: Optional[int]  = None
    tablets_per_day:   Optional[int]  = None
    cost_per_pack:     Optional[str]  = None
    refill_location:   Optional[str]  = None
    dosage:            Optional[str]  = None
    frequency:         Optional[str]  = None
    in_stock:          Optional[bool] = None
    role:              str = "clinician"


class LedgerDeleteRequest(BaseModel):
    role: str = "clinician"


# ── routes ─────────────────────────────────────────────────────────────

@router.get("/{session_id}")
async def list_ledger(session_id: str):
    """Public read — returns the full medication list + cap metadata."""
    data = await _load(session_id)
    return _ledger_envelope(data)


@router.post("/{session_id}/add")
async def add_ledger_entry(session_id: str, req: LedgerAddRequest, request: Request):
    effective = _resolve_effective_role(request, req.role)
    _check_write_role(effective)

    svc = _get_service()
    data = await _load(session_id)
    meds: List[Dict[str, Any]] = data.setdefault("medications", [])

    if len(meds) >= SUPPLY_LEDGER_CAP:
        # 409 is the right shape: valid request, conflict with state.
        raise HTTPException(
            status_code=409,
            detail={
                "code":    "LIMIT_REACHED",
                "message": f"Supply ledger is at the {SUPPLY_LEDGER_CAP}-entry cap. "
                           f"Delete an existing entry before adding a new one.",
                "cap":     SUPPLY_LEDGER_CAP,
                "count":   len(meds),
            },
        )

    final_name = _dedupe_name(meds, req.medication_name)
    new_med: Dict[str, Any] = {
        "name":              final_name,
        "dosage":            req.dosage or "",
        "frequency":         req.frequency or "",
        "tablets_remaining": int(req.tablets_remaining or 0),
        "tablets_per_day":   int(req.tablets_per_day or 1),
        "cost_per_pack":     req.cost_per_pack or "",
        "refill_location":   req.refill_location or "",
        "in_stock":          bool(req.in_stock) if req.in_stock is not None else True,
        "last_refill":       _now_iso(),
    }
    _derive_stock_flags(new_med)
    meds.append(new_med)

    data["updated_at"] = _now_iso()
    data["updated_by"] = effective
    _persist_direct(svc, session_id, data)
    logger.info(f"supply_ledger: +1 row ({final_name}) total={len(meds)} "
                f"by={effective} sid={session_id}")

    env = _ledger_envelope(data)
    env["added_index"] = len(meds) - 1
    env["added_name"]  = final_name
    return env


@router.patch("/{session_id}/medications/{index}")
async def patch_ledger_entry(
    session_id: str,
    index: int,
    req: LedgerPatchRequest,
    request: Request,
):
    effective = _resolve_effective_role(request, req.role)
    _check_write_role(effective)

    svc = _get_service()
    data = await _load(session_id)
    meds: List[Dict[str, Any]] = data.setdefault("medications", [])

    if index < 0 or index >= len(meds):
        raise HTTPException(
            status_code=404,
            detail={"code": "INDEX_OUT_OF_RANGE",
                    "message": f"No medication at index {index} (count={len(meds)})."},
        )

    med = meds[index]

    # Rename path: if the caller passed a new name, dedupe against the
    # OTHER rows so we don't collide with a sibling entry.
    if req.medication_name is not None and req.medication_name.strip() != "":
        siblings = [m for i, m in enumerate(meds) if i != index]
        med["name"] = _dedupe_name(siblings, req.medication_name)

    # tablets_remaining change is an implicit "refill event" — stamp
    # last_refill so ordering-by-recent-refill keeps working for any
    # downstream consumer (care summaries, exports).
    if req.tablets_remaining is not None:
        med["tablets_remaining"] = int(req.tablets_remaining)
        med["last_refill"] = _now_iso()
    if req.tablets_per_day is not None:
        med["tablets_per_day"] = max(1, int(req.tablets_per_day))
    if req.cost_per_pack    is not None: med["cost_per_pack"]    = req.cost_per_pack
    if req.refill_location  is not None: med["refill_location"]  = req.refill_location
    if req.dosage           is not None: med["dosage"]           = req.dosage
    if req.frequency        is not None: med["frequency"]        = req.frequency
    if req.in_stock         is not None: med["in_stock"]         = bool(req.in_stock)

    _derive_stock_flags(med)

    data["updated_at"] = _now_iso()
    data["updated_by"] = effective
    _persist_direct(svc, session_id, data)
    logger.info(f"supply_ledger: patch idx={index} by={effective} sid={session_id}")

    env = _ledger_envelope(data)
    env["updated_index"] = index
    return env


@router.delete("/{session_id}/medications/{index}")
async def delete_ledger_entry(
    session_id: str,
    index: int,
    request: Request,
    role: Optional[str] = None,
):
    # DELETE carries role in the querystring (no body) — mirror the
    # other care routes that accept it via body so the resolver has
    # something to chew on.
    effective = _resolve_effective_role(request, role or "clinician")
    _check_write_role(effective)

    svc = _get_service()
    data = await _load(session_id)
    meds: List[Dict[str, Any]] = data.setdefault("medications", [])

    if index < 0 or index >= len(meds):
        raise HTTPException(
            status_code=404,
            detail={"code": "INDEX_OUT_OF_RANGE",
                    "message": f"No medication at index {index} (count={len(meds)})."},
        )

    removed = meds.pop(index)
    data["updated_at"] = _now_iso()
    data["updated_by"] = effective
    _persist_direct(svc, session_id, data)
    logger.info(f"supply_ledger: -1 row ({removed.get('name')}) "
                f"remaining={len(meds)} by={effective} sid={session_id}")

    env = _ledger_envelope(data)
    env["removed_name"]  = removed.get("name")
    env["removed_index"] = index
    return env
