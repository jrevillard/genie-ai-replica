"""
Evidence Layer — runtime state manager.

State is persisted to Redis when reachable, with a process-local
fallback so single-worker dev still works. Writes are best-effort
and never raise into the chat path.

State machine:

    off  --enable-->  loading  --warmup OK-->  on
    on   --disable-->  reverting  --flush OK-->  off
    *    --error-->  error  (admin clears via disable)
"""
from __future__ import annotations

import json
import logging
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from src.evidence_layer.config import (
    AMINA_EVIDENCE_LAYER_DEFAULT,
    AMINA_EVIDENCE_STORE,
    EvidenceState,
    REDIS_EVAL_CANCEL_KEY,
    REDIS_EVAL_PROGRESS_KEY,
    REDIS_LAST_CHANGED_AT_KEY,
    REDIS_LAST_CHANGED_BY_KEY,
    REDIS_LAST_ENABLED_BY_KEY,
    REDIS_LAST_EVAL_SCORE_KEY,
    REDIS_LAST_REPORT_PATH_KEY,
    REDIS_RECENT_TRACES_KEY,
    REDIS_RECENT_TRACES_MAX,
    REDIS_STATE_KEY,
)
from src.evidence_layer.models import EvalProgress, EvidenceLayerStatus

logger = logging.getLogger("evidence_layer.state")


# ── Redis client (lazy, fail-safe) ─────────────────────────────────
_redis_client = None
_redis_tried = False
_lock = threading.RLock()


def _get_redis():
    global _redis_client, _redis_tried
    if AMINA_EVIDENCE_STORE != "redis":
        return None
    if _redis_client is not None:
        return _redis_client
    if _redis_tried:
        return None
    _redis_tried = True
    try:
        import redis as _redis  # type: ignore
        try:
            from src.config import settings  # type: ignore
            host = settings.REDIS_HOST
            port = settings.REDIS_PORT
        except Exception:
            import os
            host = os.getenv("REDIS_HOST", "redis")
            port = int(os.getenv("REDIS_PORT", "6379"))
        client = _redis.Redis(host=host, port=port, decode_responses=True,
                              socket_connect_timeout=2, socket_timeout=2)
        client.ping()
        _redis_client = client
        logger.info("[evidence] Redis state backend ready (%s:%s)", host, port)
        return _redis_client
    except Exception as e:
        logger.warning("[evidence] Redis unavailable, using in-process state: %s", e)
        _redis_client = None
        return None


# ── In-process fallback ────────────────────────────────────────────
_mem: Dict[str, Any] = {
    REDIS_STATE_KEY:            AMINA_EVIDENCE_LAYER_DEFAULT,
    REDIS_LAST_CHANGED_AT_KEY:  None,
    REDIS_LAST_CHANGED_BY_KEY:  None,
    REDIS_LAST_ENABLED_BY_KEY:  None,
    REDIS_LAST_EVAL_SCORE_KEY:  None,
    REDIS_LAST_REPORT_PATH_KEY: None,
}
_recent_traces: list = []
_last_error: Optional[str] = None


# ── Helpers ────────────────────────────────────────────────────────
def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _set(key: str, value: Optional[str]) -> None:
    with _lock:
        _mem[key] = value
        r = _get_redis()
        if r is None or value is None:
            if r is not None and value is None:
                try:
                    r.delete(key)
                except Exception as e:
                    logger.debug("[evidence] redis delete failed: %s", e)
            return
        try:
            r.set(key, value)
        except Exception as e:
            logger.debug("[evidence] redis set failed (%s): %s", key, e)


def _get(key: str) -> Optional[str]:
    with _lock:
        r = _get_redis()
        if r is not None:
            try:
                v = r.get(key)
                if v is not None:
                    _mem[key] = v
                    return v
            except Exception as e:
                logger.debug("[evidence] redis get failed (%s): %s", key, e)
        return _mem.get(key)


# ── Public API ─────────────────────────────────────────────────────
def get_state() -> str:
    s = _get(REDIS_STATE_KEY)
    if s in {x.value for x in EvidenceState}:
        return s
    return EvidenceState.OFF.value


def is_enabled() -> bool:
    """Single hot-path predicate. Must never raise."""
    try:
        return get_state() == EvidenceState.ON.value
    except Exception:
        return False


def set_loading(by: str) -> None:
    _set(REDIS_STATE_KEY, EvidenceState.LOADING.value)
    _set(REDIS_LAST_CHANGED_BY_KEY, by or "admin")
    _set(REDIS_LAST_CHANGED_AT_KEY, _now_iso())


def set_on(by: str) -> None:
    _set(REDIS_STATE_KEY, EvidenceState.ON.value)
    _set(REDIS_LAST_CHANGED_BY_KEY, by or "admin")
    _set(REDIS_LAST_ENABLED_BY_KEY, by or "admin")
    _set(REDIS_LAST_CHANGED_AT_KEY, _now_iso())
    _clear_error()


def set_reverting(by: str) -> None:
    _set(REDIS_STATE_KEY, EvidenceState.REVERTING.value)
    _set(REDIS_LAST_CHANGED_BY_KEY, by or "admin")
    _set(REDIS_LAST_CHANGED_AT_KEY, _now_iso())


def set_off(by: str) -> None:
    _set(REDIS_STATE_KEY, EvidenceState.OFF.value)
    _set(REDIS_LAST_CHANGED_BY_KEY, by or "admin")
    _set(REDIS_LAST_CHANGED_AT_KEY, _now_iso())
    _clear_error()


def set_error(message: str, by: Optional[str] = None) -> None:
    global _last_error
    with _lock:
        _last_error = (message or "unknown")[:512]
        _set(REDIS_STATE_KEY, EvidenceState.ERROR.value)
        if by:
            _set(REDIS_LAST_CHANGED_BY_KEY, by)
        _set(REDIS_LAST_CHANGED_AT_KEY, _now_iso())


def _clear_error() -> None:
    global _last_error
    with _lock:
        _last_error = None


def set_last_eval(score: float, report_path: Optional[str]) -> None:
    try:
        _set(REDIS_LAST_EVAL_SCORE_KEY, f"{float(score):.4f}")
    except Exception:
        _set(REDIS_LAST_EVAL_SCORE_KEY, None)
    _set(REDIS_LAST_REPORT_PATH_KEY, report_path or None)


def push_recent_trace(trace: Dict[str, Any]) -> None:
    """Cap-bounded ring of safe trace summaries for the admin UI."""
    payload = json.dumps(trace, default=str)[:4096]
    with _lock:
        r = _get_redis()
        if r is not None:
            try:
                pipe = r.pipeline()
                pipe.lpush(REDIS_RECENT_TRACES_KEY, payload)
                pipe.ltrim(REDIS_RECENT_TRACES_KEY, 0, REDIS_RECENT_TRACES_MAX - 1)
                pipe.execute()
                return
            except Exception as e:
                logger.debug("[evidence] redis push failed: %s", e)
        _recent_traces.insert(0, payload)
        del _recent_traces[REDIS_RECENT_TRACES_MAX:]


def get_recent_traces(limit: int = 50) -> list:
    limit = max(1, min(int(limit or 50), REDIS_RECENT_TRACES_MAX))
    with _lock:
        r = _get_redis()
        out: list = []
        if r is not None:
            try:
                raw = r.lrange(REDIS_RECENT_TRACES_KEY, 0, limit - 1) or []
            except Exception as e:
                logger.debug("[evidence] redis lrange failed: %s", e)
                raw = _recent_traces[:limit]
        else:
            raw = _recent_traces[:limit]
        for item in raw:
            try:
                out.append(json.loads(item))
            except Exception:
                continue
        return out


def get_status() -> EvidenceLayerStatus:
    score_raw = _get(REDIS_LAST_EVAL_SCORE_KEY)
    try:
        score = float(score_raw) if score_raw is not None else None
    except Exception:
        score = None

    persistence = "redis" if _get_redis() is not None else "in_process"
    traces = get_recent_traces(limit=50)
    return EvidenceLayerStatus(
        state                = get_state(),
        last_changed_at      = _get(REDIS_LAST_CHANGED_AT_KEY),
        last_changed_by      = _get(REDIS_LAST_CHANGED_BY_KEY),
        last_enabled_by      = _get(REDIS_LAST_ENABLED_BY_KEY),
        last_eval_score      = score,
        last_eval_at         = (traces[0].get("timestamp") if traces else None),
        last_report_path     = _get(REDIS_LAST_REPORT_PATH_KEY),
        error                = _last_error,
        trace_count_recent   = len(traces),
        persistence_backend  = persistence,
    )


# ── Eval progress tracking ─────────────────────────────────────────
def _progress_get_dict() -> Dict[str, Any]:
    raw = _get(REDIS_EVAL_PROGRESS_KEY)
    if not raw:
        return {}
    try:
        d = json.loads(raw)
        if isinstance(d, dict):
            return d
    except Exception:
        pass
    return {}


def _progress_set_dict(d: Dict[str, Any]) -> None:
    try:
        _set(REDIS_EVAL_PROGRESS_KEY, json.dumps(d, default=str))
    except Exception as e:
        logger.debug("[evidence] progress set failed: %s", e)


def start_eval_progress(eval_id: str, total: int) -> None:
    """Mark an eval run as in-flight. Resets any prior cancel flag."""
    _set(REDIS_EVAL_CANCEL_KEY, "0")
    _progress_set_dict({
        "running":          True,
        "eval_id":          eval_id,
        "total":            int(total or 0),
        "done":             0,
        "started_at":       _now_iso(),
        "finished_at":      None,
        "duration_s":       None,
        "current_case_id":  None,
        "cancel_requested": False,
        "cancelled":        False,
        "error":            None,
        "passed":           0,
        "failed":           0,
        "critical_failures": 0,
        "final_summary":    None,
        "final_report_path": None,
    })


def update_eval_progress(
    *,
    done: int,
    current_case_id: Optional[str] = None,
    passed_inc: int = 0,
    failed_inc: int = 0,
    critical_inc: int = 0,
) -> None:
    d = _progress_get_dict()
    if not d:
        return
    d["done"]              = int(done)
    if current_case_id is not None:
        d["current_case_id"] = str(current_case_id)[:64]
    d["passed"]            = int(d.get("passed", 0))            + int(passed_inc)
    d["failed"]            = int(d.get("failed", 0))            + int(failed_inc)
    d["critical_failures"] = int(d.get("critical_failures", 0)) + int(critical_inc)
    d["cancel_requested"]  = is_eval_cancel_requested()
    _progress_set_dict(d)


def end_eval_progress(
    *,
    summary_dict: Optional[Dict[str, Any]] = None,
    report_path: Optional[str] = None,
    error: Optional[str] = None,
    cancelled: bool = False,
) -> None:
    d = _progress_get_dict() or {}
    d["running"]            = False
    d["finished_at"]        = _now_iso()
    d["cancelled"]          = bool(cancelled)
    d["error"]              = (str(error)[:240] if error else None)
    d["final_summary"]      = summary_dict
    d["final_report_path"]  = report_path
    if d.get("started_at"):
        try:
            from datetime import datetime as _dt
            t0 = _dt.strptime(d["started_at"], "%Y-%m-%dT%H:%M:%SZ")
            t1 = _dt.strptime(d["finished_at"], "%Y-%m-%dT%H:%M:%SZ")
            d["duration_s"] = (t1 - t0).total_seconds()
        except Exception:
            pass
    _progress_set_dict(d)


def get_eval_progress() -> EvalProgress:
    d = _progress_get_dict()
    if not d:
        return EvalProgress(running=False)
    return EvalProgress(
        running           = bool(d.get("running")),
        eval_id           = d.get("eval_id"),
        total             = int(d.get("total") or 0),
        done              = int(d.get("done") or 0),
        started_at        = d.get("started_at"),
        finished_at       = d.get("finished_at"),
        duration_s        = d.get("duration_s"),
        current_case_id   = d.get("current_case_id"),
        cancel_requested  = bool(d.get("cancel_requested")),
        cancelled         = bool(d.get("cancelled")),
        error             = d.get("error"),
        passed            = int(d.get("passed") or 0),
        failed            = int(d.get("failed") or 0),
        critical_failures = int(d.get("critical_failures") or 0),
        final_summary     = d.get("final_summary"),
        final_report_path = d.get("final_report_path"),
    )


def request_eval_cancel() -> None:
    """Best-effort cancel signal. The runner checks this between cases."""
    _set(REDIS_EVAL_CANCEL_KEY, "1")
    d = _progress_get_dict()
    if d:
        d["cancel_requested"] = True
        _progress_set_dict(d)


def is_eval_cancel_requested() -> bool:
    v = _get(REDIS_EVAL_CANCEL_KEY)
    return v == "1"


def _reset_eval_state(reason: str = "") -> None:
    """Clear any stale running flag (used on boot/warmup)."""
    d = _progress_get_dict()
    if d and d.get("running"):
        d["running"]    = False
        d["finished_at"] = _now_iso()
        d["error"]      = f"reset_on_{reason or 'restart'}"
        _progress_set_dict(d)
    _set(REDIS_EVAL_CANCEL_KEY, "0")


# ── Test/admin helpers (NEVER expose via patient routes) ───────────
def _reset_for_tests() -> None:
    global _last_error
    with _lock:
        _mem[REDIS_STATE_KEY]            = "off"
        _mem[REDIS_LAST_CHANGED_AT_KEY]  = None
        _mem[REDIS_LAST_CHANGED_BY_KEY]  = None
        _mem[REDIS_LAST_ENABLED_BY_KEY]  = None
        _mem[REDIS_LAST_EVAL_SCORE_KEY]  = None
        _mem[REDIS_LAST_REPORT_PATH_KEY] = None
        _mem[REDIS_EVAL_PROGRESS_KEY]    = None
        _mem[REDIS_EVAL_CANCEL_KEY]      = None
        _recent_traces.clear()
        _last_error = None


def _warmup() -> bool:
    """Lightweight warmup invoked when admin enables the layer.

    Touches the persistence backend, resolves report dir, loads cases,
    and clears any stale eval progress left over from a killed worker.
    Returns True iff everything looks healthy. NEVER raises.
    """
    try:
        from src.evidence_layer.config import AMINA_EVIDENCE_REPORTS_DIR
        import os
        os.makedirs(AMINA_EVIDENCE_REPORTS_DIR, exist_ok=True)
    except Exception as e:
        logger.warning("[evidence] warmup: reports dir failed: %s", e)
        # fall through — JSONL traces can still go to /tmp later
    try:
        from src.evidence_layer.eval_cases import load_cases
        cases = load_cases()
        if not cases:
            logger.warning("[evidence] warmup: no synthetic cases loaded")
    except Exception as e:
        logger.warning("[evidence] warmup: cases load failed: %s", e)
    # Boot-time hygiene: clear any stale "running" flag from a killed
    # eval. Without this, a recreated container would show a phantom
    # in-flight eval forever.
    try:
        _reset_eval_state(reason="warmup")
    except Exception as e:
        logger.debug("[evidence] warmup: eval state reset failed: %s", e)
    # Touch persistence
    try:
        _set("amina:evidence:warmup_at", _now_iso())
    except Exception:
        pass
    return True


def _flush() -> None:
    """Best-effort flush invoked on disable. Non-destructive — does NOT
    delete past reports or traces, only stops new capture. Trace ring
    is left intact so the admin can still view recent activity."""
    try:
        _set("amina:evidence:flushed_at", _now_iso())
    except Exception:
        pass
