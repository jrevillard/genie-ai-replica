"""
Intent Review Routes — CHW/admin-facing API for reviewing
suspected misclassifications and submitting corrections.

Mounted under /api/v1/intent-review.

Endpoints:
  GET  /suspected-misses       — paginated list of flagged misclassifications
  POST /correct                — reviewer submits a correction
  POST /correct-from-miss      — reviewer corrects a specific suspected miss
  POST /kill                   — kill switch for a specific correction
  POST /kill-intent            — kill all corrections targeting a given intent
  GET  /corrections            — list active corrections
  GET  /audit                  — override audit trail
  GET  /stats                  — classification distribution + gap counts
  GET  /weekly-report          — weekly gap report for human review
  POST /re-evaluate            — re-run a corrected pattern through the classifier
  POST /retire-stale           — manually trigger 90-day TTL enforcement
"""

from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

router = APIRouter(prefix="/intent-review", tags=["intent-review"])

_ENABLED = os.getenv("USE_INTENT_LEARNER", "false").lower() == "true"


def _guard():
    if not _ENABLED:
        raise HTTPException(status_code=503, detail="Intent learner is disabled")


# ── Request models ───────────────────────────────────────────────

class CorrectionRequest(BaseModel):
    pattern: str
    classified_intent: str
    corrected_intent: str
    reviewer_id: str = "admin"


class CorrectionFromMissRequest(BaseModel):
    miss_id: str
    corrected_intent: str
    reviewer_id: str = "admin"


class KillRequest(BaseModel):
    correction_id: str
    reason: str = ""


class KillIntentRequest(BaseModel):
    intent: str
    reason: str = ""


class ReEvaluateRequest(BaseModel):
    correction_id: str


# ── Endpoints ────────────────────────────────────────────────────

@router.get("/suspected-misses")
async def list_suspected_misses(
    reviewed: Optional[bool] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    _guard()
    from src.services.intent_learner import get_suspected_misses
    rows = await get_suspected_misses(reviewed=reviewed, limit=limit, offset=offset)
    return {"count": len(rows), "results": rows}


@router.post("/correct")
async def submit_correction(req: CorrectionRequest):
    """Reviewer labels a correction: pattern X should be intent Y, not Z.

    One reviewer correction has weight 5.0 (equals OVERRIDE_THRESHOLD),
    so a single reviewer label is enough to override the classifier for
    that exact pattern on the next request.
    """
    _guard()
    from src.services.intent_learner import submit_correction as _submit
    result = await _submit(
        pattern=req.pattern,
        classified_intent=req.classified_intent,
        corrected_intent=req.corrected_intent,
        source="reviewer",
        reviewer_id=req.reviewer_id,
    )
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.post("/correct-from-miss")
async def correct_from_miss(req: CorrectionFromMissRequest):
    """Shortcut: correct a suspected miss directly.

    Looks up the miss record, submits a correction from the original
    message → reviewer's corrected intent, and marks the miss as reviewed.
    """
    _guard()
    from src.services.intent_learner import (
        get_suspected_misses,
        submit_correction as _submit,
        mark_miss_reviewed,
    )
    from src.utils.arcade_client import async_command_sql

    resp = await async_command_sql(
        "SELECT original_message, original_intent FROM IntentSuspectedMiss "
        "WHERE miss_id = :mid",
        {"mid": req.miss_id},
    )
    rows = resp.get("result", resp.get("results", []))
    if not rows:
        raise HTTPException(status_code=404, detail="Miss not found")

    miss = rows[0]
    result = await _submit(
        pattern=miss["original_message"],
        classified_intent=miss["original_intent"],
        corrected_intent=req.corrected_intent,
        source="reviewer",
        reviewer_id=req.reviewer_id,
    )
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    await mark_miss_reviewed(req.miss_id)
    result["miss_id"] = req.miss_id
    result["miss_reviewed"] = True
    return result


@router.post("/kill")
async def kill_correction_endpoint(req: KillRequest):
    """Disable a specific correction by ID. Preserves audit trail."""
    _guard()
    from src.services.intent_learner import kill_correction
    ok = await kill_correction(req.correction_id, req.reason)
    if not ok:
        raise HTTPException(status_code=404, detail="Correction not found or already killed")
    return {"killed": True, "correction_id": req.correction_id}


@router.post("/kill-intent")
async def kill_all_for_intent_endpoint(req: KillIntentRequest):
    """Kill ALL active corrections that override TO a given intent."""
    _guard()
    from src.services.intent_learner import kill_all_for_intent
    count = await kill_all_for_intent(req.intent, req.reason)
    return {"killed": count, "intent": req.intent}


@router.get("/corrections")
async def list_corrections(
    status: str = Query("active"),
    source: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    _guard()
    from src.services.intent_learner import get_corrections
    rows = await get_corrections(status=status, source=source, limit=limit, offset=offset)
    return {"count": len(rows), "results": rows}


@router.get("/audit")
async def list_override_audit(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    _guard()
    from src.services.intent_learner import get_override_audit
    rows = await get_override_audit(limit=limit, offset=offset)
    return {"count": len(rows), "results": rows}


@router.get("/stats")
async def get_stats():
    _guard()
    from src.services.intent_learner import get_stats
    return await get_stats()


@router.get("/weekly-report")
async def weekly_report():
    """Weekly gap report showing top misclassified patterns.

    Designed for a CHW, clinician, or developer to review and
    decide whether to update the deterministic classifier rules
    or submit corrections via /correct.
    """
    _guard()
    from src.services.intent_learner import get_weekly_gap_report
    return await get_weekly_gap_report()


@router.post("/re-evaluate")
async def re_evaluate(req: ReEvaluateRequest):
    """Re-run a corrected pattern through the current classifier.

    If the classifier now produces the corrected intent, the correction
    is retired as 'no longer needed' (deterministic rules were updated).
    """
    _guard()
    from src.services.intent_learner import re_evaluate_correction
    return await re_evaluate_correction(req.correction_id)


@router.post("/retire-stale")
async def retire_stale():
    """Manually trigger 90-day TTL enforcement on corrections."""
    _guard()
    from src.services.intent_learner import retire_stale_corrections
    count = await retire_stale_corrections()
    return {"retired": count}
