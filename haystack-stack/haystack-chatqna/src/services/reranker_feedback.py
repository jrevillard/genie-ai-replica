"""
AMINA Care — Re-Ranker Feedback Loop (Phase 4)
=================================================
Captures thumbs-up / thumbs-down signals on retrieved passages, stores
them in ArcadeDB (RerankerFeedback vertex), and exposes a monthly
batch fine-tune + A/B promote cycle.

Flow:
  1. User gives thumbs up/down on a chat response
  2. record_feedback() stores (query, passage, feedback_type) in ArcadeDB
  3. Monthly cron / manual trigger calls run_feedback_cycle()
     a. Pulls all feedback pairs
     b. Fine-tunes cross-encoder via training.finetune_reranker
     c. Runs A/B eval (reranker_eval) on baseline vs candidate
     d. If NDCG@3 improves → promotes candidate to amina-clinical slot
     e. Updates clinical_score in reranker_registry

Usage:
  from src.services.reranker_feedback import record_feedback, run_feedback_cycle

  # Record a single feedback signal
  await record_feedback(
      query="What is the target BP for hypertension?",
      passage="WHO PEN recommends target BP < 140/90 mmHg...",
      feedback_type="thumbs_up",
      session_id="abc123",
  )

  # Trigger monthly re-train cycle
  result = await run_feedback_cycle()
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

_log = logging.getLogger("reranker_feedback")

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIG
# ═══════════════════════════════════════════════════════════════════════════════

ARCADE_URL = os.getenv("ARCADEDB_URL", "http://localhost:2480")
ARCADE_DB = os.getenv("ARCADEDB_DB", "amina")
ARCADE_USER = os.getenv("ARCADEDB_USER", "root")
ARCADE_PASS = os.getenv("ARCADEDB_PASS", "amina_pass")

MIN_FEEDBACK_FOR_RETRAIN = int(os.getenv("RERANKER_MIN_FEEDBACK", "50"))
NDCG_IMPROVEMENT_THRESHOLD = float(os.getenv("RERANKER_NDCG_THRESHOLD", "0.01"))

FEEDBACK_VERTEX = "RerankerFeedback"
PROMOTE_LOG_VERTEX = "RerankerPromoteLog"


# ═══════════════════════════════════════════════════════════════════════════════
# ARCADEDB HELPERS
# ═══════════════════════════════════════════════════════════════════════════════


async def _arcade_command(sql: str, params: Optional[Dict] = None) -> List[Dict]:
    """Execute an ArcadeDB SQL command and return results."""
    import aiohttp

    payload: Dict[str, Any] = {"language": "sql", "command": sql}
    if params:
        payload["params"] = params

    try:
        auth = aiohttp.BasicAuth(ARCADE_USER, ARCADE_PASS)
        async with aiohttp.ClientSession(auth=auth) as session:
            async with session.post(
                f"{ARCADE_URL}/api/v1/command/{ARCADE_DB}",
                json=payload,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                resp.raise_for_status()
                data = await resp.json()
                return data.get("result", [])
    except Exception as e:
        _log.warning("ArcadeDB command failed: %s", e)
        return []


async def _ensure_schema():
    """Create RerankerFeedback vertex type if not exists."""
    await _arcade_command(
        f"CREATE VERTEX TYPE {FEEDBACK_VERTEX} IF NOT EXISTS"
    )
    await _arcade_command(
        f"CREATE VERTEX TYPE {PROMOTE_LOG_VERTEX} IF NOT EXISTS"
    )
    for prop in ["query", "passage", "feedback_type", "session_id", "created_at"]:
        await _arcade_command(
            f"CREATE PROPERTY {FEEDBACK_VERTEX}.{prop} IF NOT EXISTS STRING"
        )
    await _arcade_command(
        f"CREATE INDEX ON {FEEDBACK_VERTEX}(created_at) NOTUNIQUE"
    )


_schema_ensured = False


async def _ensure_schema_once():
    global _schema_ensured
    if not _schema_ensured:
        await _ensure_schema()
        _schema_ensured = True


# ═══════════════════════════════════════════════════════════════════════════════
# FEEDBACK RECORDING
# ═══════════════════════════════════════════════════════════════════════════════


async def record_feedback(
    query: str,
    passage: str,
    feedback_type: str,
    session_id: Optional[str] = None,
    relevance_score: Optional[float] = None,
    metadata: Optional[Dict] = None,
) -> bool:
    """Store a feedback signal in ArcadeDB.

    feedback_type: 'thumbs_up' | 'thumbs_down' | 'explicit_relevant' | 'explicit_irrelevant'
    relevance_score: optional float override (0.0–1.0)
    """
    await _ensure_schema_once()

    now = datetime.utcnow().isoformat() + "Z"
    score = relevance_score
    if score is None:
        score = 1.0 if feedback_type in ("thumbs_up", "explicit_relevant") else 0.0

    meta_json = json.dumps(metadata or {})

    sql = f"""
        INSERT INTO {FEEDBACK_VERTEX}
        SET query = :query,
            passage = :passage,
            feedback_type = :ftype,
            relevance_score = :score,
            session_id = :sid,
            metadata = :meta,
            created_at = :ts
    """
    params = {
        "query": query[:2000],
        "passage": passage[:4000],
        "ftype": feedback_type,
        "score": score,
        "sid": session_id or "",
        "meta": meta_json,
        "ts": now,
    }

    result = await _arcade_command(sql, params)
    if result:
        _log.info("Feedback recorded: %s for query '%.60s...'", feedback_type, query)
        return True
    return False


# ═══════════════════════════════════════════════════════════════════════════════
# FEEDBACK STATS
# ═══════════════════════════════════════════════════════════════════════════════


async def get_feedback_stats(since_days: int = 30) -> Dict[str, Any]:
    """Return feedback counts and breakdown."""
    await _ensure_schema_once()

    cutoff = (datetime.utcnow() - timedelta(days=since_days)).isoformat() + "Z"

    total = await _arcade_command(
        f"SELECT count(*) as cnt FROM {FEEDBACK_VERTEX} WHERE created_at >= :cutoff",
        {"cutoff": cutoff},
    )
    by_type = await _arcade_command(
        f"SELECT feedback_type, count(*) as cnt FROM {FEEDBACK_VERTEX} "
        f"WHERE created_at >= :cutoff GROUP BY feedback_type",
        {"cutoff": cutoff},
    )

    return {
        "total": total[0]["cnt"] if total else 0,
        "since_days": since_days,
        "by_type": {r["feedback_type"]: r["cnt"] for r in by_type},
        "ready_for_retrain": (total[0]["cnt"] if total else 0) >= MIN_FEEDBACK_FOR_RETRAIN,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# FEEDBACK CYCLE — RETRAIN + A/B + PROMOTE
# ═══════════════════════════════════════════════════════════════════════════════


async def run_feedback_cycle(
    force: bool = False,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """Execute the monthly feedback-driven re-train cycle.

    Steps:
      1. Check if enough feedback has accumulated (>= MIN_FEEDBACK_FOR_RETRAIN)
      2. Fine-tune cross-encoder on eval triplets + feedback pairs
      3. A/B eval: compare baseline vs candidate on reranker_eval triplets
      4. If NDCG@3 improves by >= threshold → promote candidate
      5. Log promotion event in ArcadeDB
    """
    result: Dict[str, Any] = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "action": "feedback_cycle",
    }

    stats = await get_feedback_stats()
    result["feedback_stats"] = stats

    if not force and not stats["ready_for_retrain"]:
        result["status"] = "skipped"
        result["reason"] = (
            f"Only {stats['total']} feedback pairs "
            f"(need {MIN_FEEDBACK_FOR_RETRAIN})"
        )
        _log.info("Feedback cycle skipped: %s", result["reason"])
        return result

    if dry_run:
        result["status"] = "dry_run"
        result["would_retrain"] = True
        _log.info("DRY RUN — would retrain with %d feedback pairs", stats["total"])
        return result

    _log.info("Starting feedback cycle with %d feedback pairs", stats["total"])

    try:
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
        from training.finetune_reranker import build_dataset, finetune, validate_against_baseline
    except ImportError as e:
        result["status"] = "error"
        result["error"] = f"Cannot import training pipeline: {e}"
        _log.error(result["error"])
        return result

    t0 = time.monotonic()

    pairs, sources = build_dataset(include_feedback=True)
    result["dataset"] = {"total_pairs": len(pairs), "sources": sources}

    if len(pairs) < 20:
        result["status"] = "skipped"
        result["reason"] = f"Too few training pairs ({len(pairs)})"
        return result

    _log.info("Fine-tuning on %d pairs...", len(pairs))
    report = finetune(pairs=pairs, base_model_key="bge-reranker-v2")
    result["training"] = {
        "duration_sec": report.duration_sec,
        "eval_accuracy": report.eval_accuracy,
    }

    _log.info("Running A/B validation...")
    validation = validate_against_baseline()
    result["validation"] = validation

    if validation.get("improved") and validation.get("ndcg3_delta", 0) >= NDCG_IMPROVEMENT_THRESHOLD:
        result["status"] = "promoted"
        result["ndcg3_improvement"] = validation["ndcg3_delta"]

        try:
            from src.services.reranker_registry import update_clinical_score
            update_clinical_score(
                "amina-clinical",
                validation["finetuned"]["ndcg3"],
            )
        except Exception as e:
            _log.warning("Could not update clinical score: %s", e)

        await _log_promotion(validation)
        _log.info(
            "Candidate PROMOTED — NDCG@3 improved by +%.4f",
            validation["ndcg3_delta"],
        )
    else:
        result["status"] = "not_promoted"
        result["reason"] = (
            f"NDCG@3 delta {validation.get('ndcg3_delta', 0):.4f} "
            f"below threshold {NDCG_IMPROVEMENT_THRESHOLD}"
        )
        _log.info("Candidate NOT promoted: %s", result["reason"])

    result["total_duration_sec"] = round(time.monotonic() - t0, 1)
    return result


async def _log_promotion(validation: Dict):
    """Log a promotion event in ArcadeDB."""
    sql = f"""
        INSERT INTO {PROMOTE_LOG_VERTEX}
        SET promoted_at = :ts,
            baseline_ndcg3 = :b_ndcg,
            candidate_ndcg3 = :c_ndcg,
            delta = :delta,
            validation = :val
    """
    await _arcade_command(sql, {
        "ts": datetime.utcnow().isoformat() + "Z",
        "b_ndcg": validation.get("baseline", {}).get("ndcg3", 0),
        "c_ndcg": validation.get("finetuned", {}).get("ndcg3", 0),
        "delta": validation.get("ndcg3_delta", 0),
        "val": json.dumps(validation),
    })


# ═══════════════════════════════════════════════════════════════════════════════
# FASTAPI ROUTES (registered by main_with_rag_tuning)
# ═══════════════════════════════════════════════════════════════════════════════

from pydantic import BaseModel as _RFBaseModel


class FeedbackRequest(_RFBaseModel):
    query: str
    passage: str
    feedback_type: str  # thumbs_up | thumbs_down
    session_id: Optional[str] = None
    relevance_score: Optional[float] = None


class CycleRequest(_RFBaseModel):
    force: bool = False
    dry_run: bool = False


def get_feedback_router():
    """Return a FastAPI router for feedback endpoints."""
    from fastapi import APIRouter, HTTPException

    router = APIRouter(prefix="/reranker-feedback", tags=["reranker-feedback"])

    @router.post("/record")
    async def api_record_feedback(req: FeedbackRequest):
        ok = await record_feedback(
            query=req.query,
            passage=req.passage,
            feedback_type=req.feedback_type,
            session_id=req.session_id,
            relevance_score=req.relevance_score,
        )
        if not ok:
            raise HTTPException(500, "Failed to record feedback")
        return {"status": "recorded"}

    @router.get("/stats")
    async def api_feedback_stats(since_days: int = 30):
        return await get_feedback_stats(since_days)

    @router.post("/cycle")
    async def api_feedback_cycle(req: CycleRequest):
        return await run_feedback_cycle(force=req.force, dry_run=req.dry_run)

    return router
