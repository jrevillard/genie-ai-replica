"""
Evidence Layer — admin-only HTTP routes.

Auth: Bearer JWT with role=='admin'. The same pattern used by
src/api/admin_routes.py::_verify_admin. We intentionally inline the
helper (rather than importing the private one) so this package
remains self-contained and additive.

Routes:
  GET  /api/v1/admin/evidence/status                 — current state + metadata
  POST /api/v1/admin/evidence/enable                 — off -> loading -> on
  POST /api/v1/admin/evidence/disable                — on  -> reverting -> off
  GET  /api/v1/admin/evidence/summary                — recent traces + last eval
  POST /api/v1/admin/evidence/eval/run-synthetic     — kicks deterministic eval
  GET  /api/v1/admin/evidence/eval/latest-report     — markdown body of newest report
"""
from __future__ import annotations

import asyncio
import logging
import os
import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import JSONResponse, PlainTextResponse

from src.evidence_layer import state as _state
from src.evidence_layer.config import (
    AMINA_EVIDENCE_REPORTS_DIR,
    EvidenceState,
)
from src.evidence_layer.report_writer import (
    find_latest_report,
    list_reports,
    read_report_bundle,
)

logger = logging.getLogger("evidence_layer.routes")

router = APIRouter(prefix="/admin/evidence", tags=["evidence-layer"])

# Module-level handle on the in-flight eval task. Used to detect "an
# eval is already running" without leaking it across workers (Redis
# state is the cross-worker source of truth — this is just a local
# convenience).
_running_task: Optional[asyncio.Task] = None

# Boot-time hygiene: a previous container instance may have died with
# an eval marked `running` in Redis. Clear it once on import. Safe
# across workers (the operation is idempotent).
try:
    _state._reset_eval_state(reason="route_module_boot")
except Exception as _boot_e:
    logger.debug("[evidence] boot eval-state reset failed: %s", _boot_e)


# ── Auth (fail-closed) ─────────────────────────────────────────────
def _verify_admin(request: Request) -> Dict[str, Any]:
    """Mirror of src.api.admin_routes._verify_admin. Bearer + role='admin'.

    FAIL-CLOSED: any exception during JWT verify => 401/403. Patient and
    CHW tokens MUST NOT pass.
    """
    auth = (request.headers.get("Authorization") or "").strip()
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Admin authentication required")
    token = auth[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Admin authentication required")
    try:
        from src.services.auth import verify_jwt  # type: ignore
    except Exception:
        # If auth module is missing entirely, deny.
        logger.error("[evidence] auth helper unavailable; denying admin route")
        raise HTTPException(status_code=503, detail="Admin auth unavailable")
    try:
        payload = verify_jwt(token)
    except Exception as e:
        logger.warning("[evidence] verify_jwt raised: %s", e)
        payload = None
    if not payload or payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return payload


def _admin_handle(payload: Dict[str, Any]) -> str:
    """Pick a stable, non-PII-ish handle for audit. Prefer username/sub."""
    for k in ("username", "user_name", "name", "sub", "user_id", "id"):
        v = payload.get(k)
        if isinstance(v, str) and v and v != "admin":
            # never echo emails into state
            if "@" in v:
                return v.split("@", 1)[0][:32]
            return v[:32]
    return "admin"


# ── Routes ─────────────────────────────────────────────────────────
@router.get("/status")
async def get_status(request: Request):
    _verify_admin(request)
    s = _state.get_status()
    return JSONResponse(s.to_dict())


async def _do_enable(by: str) -> None:
    """Background coroutine that performs warmup. Sets ON or ERROR."""
    try:
        await asyncio.to_thread(_state._warmup)
        _state.set_on(by)
        logger.info("[evidence] enabled by=%s", by)
    except Exception as e:
        logger.exception("[evidence] enable failed: %s", e)
        _state.set_error(f"enable_failed:{e.__class__.__name__}", by=by)


async def _do_disable(by: str) -> None:
    try:
        await asyncio.to_thread(_state._flush)
        _state.set_off(by)
        logger.info("[evidence] disabled by=%s", by)
    except Exception as e:
        logger.exception("[evidence] disable failed: %s", e)
        _state.set_error(f"disable_failed:{e.__class__.__name__}", by=by)


@router.post("/enable")
async def post_enable(request: Request):
    payload = _verify_admin(request)
    by = _admin_handle(payload)
    cur = _state.get_state()
    if cur == EvidenceState.ON.value:
        return JSONResponse({"ok": True, "state": cur, "message": "already_on"})
    if cur == EvidenceState.LOADING.value:
        return JSONResponse({"ok": True, "state": cur, "message": "loading_in_progress"})
    if cur == EvidenceState.REVERTING.value:
        raise HTTPException(status_code=409, detail="layer_is_reverting")
    _state.set_loading(by)
    asyncio.create_task(_do_enable(by))
    return JSONResponse({"ok": True, "state": _state.get_state(), "message": "loading"})


@router.post("/disable")
async def post_disable(request: Request):
    payload = _verify_admin(request)
    by = _admin_handle(payload)
    cur = _state.get_state()
    if cur == EvidenceState.OFF.value:
        return JSONResponse({"ok": True, "state": cur, "message": "already_off"})
    if cur == EvidenceState.REVERTING.value:
        return JSONResponse({"ok": True, "state": cur, "message": "reverting_in_progress"})
    if cur == EvidenceState.LOADING.value:
        # Allow cancel-style transition: loading -> reverting -> off
        pass
    _state.set_reverting(by)
    asyncio.create_task(_do_disable(by))
    return JSONResponse({"ok": True, "state": _state.get_state(), "message": "reverting"})


@router.get("/summary")
async def get_summary(request: Request):
    _verify_admin(request)
    status_obj = _state.get_status()
    traces = _state.get_recent_traces(limit=50)
    return JSONResponse({
        "status": status_obj.to_dict(),
        "recent_traces": traces,
        "reports_dir": AMINA_EVIDENCE_REPORTS_DIR,
        "latest_report": find_latest_report() or None,
    })


async def _run_eval_in_background(eval_id: str, by: str) -> None:
    """Background coroutine that runs the synthetic eval. Streams
    progress to Redis state so the admin UI can poll. NEVER raises.
    """
    try:
        from src.evidence_layer.eval_cases import load_cases
        from src.evidence_layer.eval_runner import run_synthetic_eval

        cases = load_cases()
        _state.start_eval_progress(eval_id, len(cases))

        # Per-case progress callback. Closure-captures eval_id so a
        # late-arriving callback after a new eval starts can be ignored.
        def _on_progress(done: int, case_id: str, scored) -> None:
            cur = _state.get_eval_progress()
            if cur.eval_id != eval_id:
                return  # stale callback, ignore
            _state.update_eval_progress(
                done=done,
                current_case_id=case_id,
                passed_inc=1 if scored.passed else 0,
                failed_inc=0 if scored.passed else 1,
                critical_inc=(1 if (not scored.passed) and scored.severity == "critical" else 0),
            )

        def _is_cancelled() -> bool:
            return _state.is_eval_cancel_requested()

        summary, _results = await run_synthetic_eval(
            cases=cases,
            progress_cb=_on_progress,
            cancel_cb=_is_cancelled,
            write_report=True,
            write_json_sidecar=True,
        )
        _state.end_eval_progress(
            summary_dict=summary.to_dict(),
            report_path=summary.report_path,
            cancelled=_state.is_eval_cancel_requested(),
        )
        logger.info(
            "[evidence] eval %s done by=%s passed=%s/%s crit=%s path=%s",
            eval_id, by, summary.passed, summary.total,
            summary.critical_failures, summary.report_path,
        )
    except Exception as e:
        logger.exception("[evidence] eval bg task failed: %s", e)
        _state.end_eval_progress(error=f"{e.__class__.__name__}:{str(e)[:160]}")


@router.post("/eval/run-synthetic")
async def post_run_eval(request: Request):
    """Kicks off a background eval run. Returns immediately with the
    eval_id; the UI polls /eval/progress for live status."""
    global _running_task
    payload = _verify_admin(request)
    by = _admin_handle(payload)

    if _state.get_state() != EvidenceState.ON.value:
        raise HTTPException(status_code=409,
                            detail="evidence_layer_off — enable it before running evals")

    # Cross-worker check via Redis: another worker may already be running.
    cur = _state.get_eval_progress()
    if cur.running:
        raise HTTPException(status_code=409,
                            detail=f"eval_already_running:{cur.eval_id}")

    # Local guard for this worker.
    if _running_task and not _running_task.done():
        raise HTTPException(status_code=409, detail="eval_already_running_local")

    eval_id = uuid.uuid4().hex[:12]
    _running_task = asyncio.create_task(_run_eval_in_background(eval_id, by))
    # Give the task a moment to populate progress state before the
    # client polls — keeps the UI from briefly seeing "not running".
    await asyncio.sleep(0.05)

    return JSONResponse({
        "ok": True,
        "by": by,
        "eval_id": eval_id,
        "progress": _state.get_eval_progress().to_dict(),
    })


@router.get("/eval/progress")
async def get_eval_progress(request: Request):
    """Lightweight poll endpoint — returns current EvalProgress."""
    _verify_admin(request)
    return JSONResponse(_state.get_eval_progress().to_dict())


@router.post("/eval/cancel")
async def post_eval_cancel(request: Request):
    """Request cancellation of the in-flight eval. Already-dispatched
    cases run to completion; remaining ones are skipped."""
    _verify_admin(request)
    cur = _state.get_eval_progress()
    if not cur.running:
        return JSONResponse({"ok": True, "message": "no_eval_running"})
    _state.request_eval_cancel()
    return JSONResponse({
        "ok": True,
        "message": "cancellation_requested",
        "eval_id": cur.eval_id,
    })


@router.get("/eval/reports")
async def get_eval_reports(request: Request, limit: int = 20):
    """List the most-recent eval reports with structured metadata."""
    _verify_admin(request)
    return JSONResponse({
        "reports": list_reports(limit=limit),
        "reports_dir": AMINA_EVIDENCE_REPORTS_DIR,
    })


@router.get("/eval/report/{filename}")
async def get_eval_report(request: Request, filename: str, raw: bool = False):
    """Fetch a specific report by filename (admin-only, path-traversal safe)."""
    _verify_admin(request)
    bundle = read_report_bundle(filename)
    if not bundle:
        raise HTTPException(status_code=404, detail="report_not_found")
    if raw and bundle.get("markdown"):
        return PlainTextResponse(bundle["markdown"],
                                 media_type="text/markdown; charset=utf-8")
    return JSONResponse(bundle)


@router.get("/eval/latest-report")
async def get_latest_report(request: Request, raw: bool = False):
    """Backwards-compatible: newest report, markdown body or bundle."""
    _verify_admin(request)
    path = find_latest_report()
    if not path or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="no_report_found")
    filename = os.path.basename(path)
    if raw:
        try:
            with open(path, "r", encoding="utf-8") as f:
                body = f.read()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"read_failed:{e.__class__.__name__}")
        return PlainTextResponse(body, media_type="text/markdown; charset=utf-8")
    bundle = read_report_bundle(filename)
    if not bundle:
        raise HTTPException(status_code=500, detail="bundle_unreadable")
    bundle["path"] = path
    return JSONResponse(bundle)
