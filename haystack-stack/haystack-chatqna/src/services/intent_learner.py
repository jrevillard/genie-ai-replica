"""
Intent Learner — captures classifications, detects misclassifications,
and provides a weighted correction layer for the intent router.

Phase 1: Capture + Store + Reviewer-only corrections.
Implicit signals are logged and flagged but do NOT auto-override.

Architecture
────────────
Hot path (sync, Redis only — called from route_intent):
  lookup_correction()    → check for known corrections before classification
  record_classification() → save this turn for miss detection + queue for persistence

Background (async, ArcadeDB — called from agent after response):
  flush_classification_log()  → drain Redis queue → ArcadeDB
  flush_miss_queue()          → drain Redis miss queue → ArcadeDB
  check_and_flag_miss()       → combined-signal misclassification detection

Admin API (async, ArcadeDB + Redis):
  submit_correction()   → reviewer labels a correction → ArcadeDB + Redis
  kill_correction()     → disable a specific correction → ArcadeDB + Redis DEL
  retire_stale()        → 90-day TTL enforcement
  get_suspected_misses() / get_override_audit() / get_corrections() / get_stats()

Safety invariant
────────────────
Emergency intent is NEVER overridden by the correction layer. This is
hard-coded and unreachable by any correction, regardless of weight.

Gate: USE_INTENT_LEARNER env var (default false).
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_ENABLED = os.getenv("USE_INTENT_LEARNER", "false").lower() == "true"

# ── Constants ────────────────────────────────────────────────────────

REVIEWER_WEIGHT = 5.0
IMPLICIT_WEIGHT = 1.0
OVERRIDE_THRESHOLD = 5.0

CORRECTION_TTL_DAYS = 90

SAFETY_EXCLUDED_INTENTS = frozenset({"emergency"})

_REDIS_TTL = 86400  # 24 hours for per-session keys
_QUEUE_MAX = 10_000
_MISS_QUEUE_MAX = 1_000


# ── Redis helpers ────────────────────────────────────────────────────

def _get_redis():
    import redis as _redis
    from src.config import settings
    return _redis.Redis(
        host=settings.REDIS_HOST,
        port=settings.REDIS_PORT,
        db=0,
        decode_responses=True,
    )


def _pattern_hash(stripped_msg: str) -> str:
    return hashlib.sha256(stripped_msg.lower().strip().encode()).hexdigest()[:16]


# ── ArcadeDB helpers ────────────────────────────────────────────────

def _arcade_url():
    from src.config import settings
    return f"{settings.ARCADEDB_URL.rstrip('/')}/api/v1/command/{settings.ARCADEDB_DB}"


def _arcade_auth():
    from src.config import settings
    return (settings.ARCADEDB_USER, settings.ARCADEDB_PASSWORD)


async def _async_sql(sql: str, params: Optional[Dict] = None) -> Dict[str, Any]:
    from src.utils.arcade_client import async_command_sql
    return await async_command_sql(sql, params)


def _sync_sql(sql: str, params: Optional[Dict] = None) -> Dict[str, Any]:
    from src.utils.arcade_client import command_sql
    return command_sql(sql, params)


def _extract_rows(resp: Dict) -> List[Dict]:
    return resp.get("result", resp.get("results", []))


def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _expires_iso() -> str:
    return (datetime.utcnow() + timedelta(days=CORRECTION_TTL_DAYS)).isoformat() + "Z"


# ── Schema setup (idempotent, sync) ─────────────────────────────────

_SCHEMA_ENSURED = False

_SCHEMA_STATEMENTS = [
    # Classification log — every classification recorded
    "CREATE VERTEX TYPE IntentClassificationLog IF NOT EXISTS",
    "CREATE PROPERTY IntentClassificationLog.log_id IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentClassificationLog.message IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentClassificationLog.stripped_message IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentClassificationLog.classified_intent IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentClassificationLog.turn_type IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentClassificationLog.session_id IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentClassificationLog.patient_id IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentClassificationLog.was_overridden IF NOT EXISTS BOOLEAN",
    "CREATE PROPERTY IntentClassificationLog.override_correction_id IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentClassificationLog.suspected_miss IF NOT EXISTS BOOLEAN",
    "CREATE PROPERTY IntentClassificationLog.miss_signals IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentClassificationLog.created_at IF NOT EXISTS STRING",

    # Corrections — reviewer-labeled and implicit
    "CREATE VERTEX TYPE IntentCorrection IF NOT EXISTS",
    "CREATE PROPERTY IntentCorrection.correction_id IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentCorrection.pattern IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentCorrection.pattern_hash IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentCorrection.source IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentCorrection.classified_intent IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentCorrection.corrected_intent IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentCorrection.count IF NOT EXISTS INTEGER",
    "CREATE PROPERTY IntentCorrection.weight IF NOT EXISTS DOUBLE",
    "CREATE PROPERTY IntentCorrection.status IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentCorrection.reviewer_id IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentCorrection.kill_reason IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentCorrection.created_at IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentCorrection.updated_at IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentCorrection.expires_at IF NOT EXISTS STRING",

    # Override audit — every time the correction layer fires
    "CREATE VERTEX TYPE IntentOverrideAudit IF NOT EXISTS",
    "CREATE PROPERTY IntentOverrideAudit.audit_id IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentOverrideAudit.message IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentOverrideAudit.session_id IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentOverrideAudit.original_intent IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentOverrideAudit.overridden_to IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentOverrideAudit.correction_id IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentOverrideAudit.correction_source IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentOverrideAudit.correction_weight IF NOT EXISTS DOUBLE",
    "CREATE PROPERTY IntentOverrideAudit.created_at IF NOT EXISTS STRING",

    # Suspected misses — flagged by combined-signal detection
    "CREATE VERTEX TYPE IntentSuspectedMiss IF NOT EXISTS",
    "CREATE PROPERTY IntentSuspectedMiss.miss_id IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentSuspectedMiss.session_id IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentSuspectedMiss.patient_id IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentSuspectedMiss.original_message IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentSuspectedMiss.original_intent IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentSuspectedMiss.correction_message IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentSuspectedMiss.correction_intent IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentSuspectedMiss.signals IF NOT EXISTS STRING",
    "CREATE PROPERTY IntentSuspectedMiss.reviewed IF NOT EXISTS BOOLEAN",
    "CREATE PROPERTY IntentSuspectedMiss.created_at IF NOT EXISTS STRING",
]

_INDEX_STATEMENTS = [
    "CREATE INDEX IF NOT EXISTS ON IntentClassificationLog (log_id) UNIQUE",
    "CREATE INDEX IF NOT EXISTS ON IntentClassificationLog (session_id) NOTUNIQUE",
    "CREATE INDEX IF NOT EXISTS ON IntentClassificationLog (suspected_miss) NOTUNIQUE",
    "CREATE INDEX IF NOT EXISTS ON IntentCorrection (correction_id) UNIQUE",
    "CREATE INDEX IF NOT EXISTS ON IntentCorrection (pattern_hash) NOTUNIQUE",
    "CREATE INDEX IF NOT EXISTS ON IntentCorrection (status) NOTUNIQUE",
    "CREATE INDEX IF NOT EXISTS ON IntentOverrideAudit (audit_id) UNIQUE",
    "CREATE INDEX IF NOT EXISTS ON IntentOverrideAudit (correction_id) NOTUNIQUE",
    "CREATE INDEX IF NOT EXISTS ON IntentSuspectedMiss (miss_id) UNIQUE",
    "CREATE INDEX IF NOT EXISTS ON IntentSuspectedMiss (reviewed) NOTUNIQUE",
]


def ensure_schema() -> None:
    global _SCHEMA_ENSURED
    if _SCHEMA_ENSURED or not _ENABLED:
        return
    try:
        for stmt in _SCHEMA_STATEMENTS:
            _sync_sql(stmt)
        for stmt in _INDEX_STATEMENTS:
            try:
                _sync_sql(stmt)
            except Exception:
                pass
        _SCHEMA_ENSURED = True
        logger.info("intent_learner: ArcadeDB schema ensured")
    except Exception as e:
        logger.warning(f"intent_learner: schema setup failed (non-fatal): {e}")


# ═══════════════════════════════════════════════════════════════════
# HOT PATH — SYNC, REDIS ONLY
# Called from route_intent() on every classification.
# ═══════════════════════════════════════════════════════════════════

def lookup_correction(stripped_message: str, classified_intent: str) -> Optional[Dict[str, Any]]:
    """Check Redis for a known correction BEFORE the classifier runs.

    Phase 1: only reviewer corrections are applied.
    Safety: emergency intent is NEVER overridden.

    Returns dict with {corrected_intent, correction_id, source, weight}
    or None if no correction applies.
    """
    if not _ENABLED:
        return None

    if classified_intent in SAFETY_EXCLUDED_INTENTS:
        return None

    ph = _pattern_hash(stripped_message)

    try:
        r = _get_redis()

        # Reviewer corrections (weight = 5.0 per label)
        reviewer_raw = r.get(f"intent_corr:reviewer:{ph}")
        if reviewer_raw:
            data = json.loads(reviewer_raw)
            if data.get("corrected_intent") in SAFETY_EXCLUDED_INTENTS:
                return None
            if data.get("weight", 0) >= OVERRIDE_THRESHOLD:
                return data

        # Phase 2 (disabled): implicit corrections
        # implicit_raw = r.get(f"intent_corr:implicit:{ph}")
        # if implicit_raw:
        #     data = json.loads(implicit_raw)
        #     if data.get("weight", 0) >= OVERRIDE_THRESHOLD:
        #         return data

    except Exception as e:
        logger.debug(f"intent_learner: correction lookup failed: {e}")

    return None


def record_classification(
    message: str,
    stripped_message: str,
    classified_intent: str,
    turn_type: str,
    session_id: str,
    patient_id: str = "",
    was_overridden: bool = False,
    override_correction_id: str = "",
) -> None:
    """Record this turn's classification in Redis.

    Two purposes:
    1. Shift current→previous for same-topic rephrase detection
    2. Push to persistence queue for async ArcadeDB flush
    """
    if not _ENABLED:
        return

    try:
        r = _get_redis()
        now = _now_iso()

        current_raw = r.get(f"intent_cls:{session_id}:last")
        if current_raw:
            r.set(f"intent_cls:{session_id}:prev", current_raw, ex=_REDIS_TTL)

        entry = {
            "log_id": f"icl_{uuid.uuid4().hex[:12]}",
            "message": message[:500],
            "stripped_message": stripped_message[:500],
            "classified_intent": classified_intent,
            "turn_type": turn_type,
            "session_id": session_id,
            "patient_id": patient_id,
            "was_overridden": was_overridden,
            "override_correction_id": override_correction_id,
            "suspected_miss": False,
            "miss_signals": "[]",
            "created_at": now,
        }
        r.set(f"intent_cls:{session_id}:last", json.dumps(entry), ex=_REDIS_TTL)
        r.lpush("intent_cls_queue", json.dumps(entry))
        r.ltrim("intent_cls_queue", 0, _QUEUE_MAX - 1)
    except Exception as e:
        logger.debug(f"intent_learner: record failed: {e}")


# ═══════════════════════════════════════════════════════════════════
# COMBINED-SIGNAL MISS DETECTION
# Called after classification to flag suspected misclassifications.
# Requires ≥2 signals to fire — single signal = noise.
# ═══════════════════════════════════════════════════════════════════

_CORRECTION_PHRASES = [
    "no ", "that's not", "thats not", "i meant", "i was asking",
    "not what i asked", "not what i meant", "i said",
    "no i want", "no i need", "no i'm asking", "no im asking",
    "that wasn't", "that wasnt", "wrong answer",
]


def detect_suspected_miss(
    session_id: str,
    current_message: str,
    current_intent: str,
    patient_id: str = "",
) -> Optional[Dict[str, Any]]:
    """Detect misclassification via combined signals.

    Flags when ≥2 of these fire:
      1. Same-topic rephrase (keyword overlap ≥ 50% with previous turn)
      2. Different classification than previous turn on the same topic
      3. Explicit correction phrase ("no", "that's not what I asked")

    Returns signal dict if flagged, None otherwise.
    Flagged misses are queued for ArcadeDB persistence but do NOT
    auto-override (Phase 1 = reviewer-only corrections).
    """
    if not _ENABLED:
        return None

    try:
        r = _get_redis()
        prev_raw = r.get(f"intent_cls:{session_id}:prev")
        if not prev_raw:
            return None

        prev = json.loads(prev_raw)
        signals: List[str] = []

        # Signal 1: Same-topic rephrase (keyword overlap ≥ 50%)
        _stop = {"a", "an", "the", "is", "am", "are", "was", "were",
                 "i", "me", "my", "to", "for", "of", "and", "or", "in",
                 "on", "it", "do", "can", "should", "will", "what", "how"}
        prev_words = set(prev["stripped_message"].lower().split()) - _stop
        curr_words = set(current_message.lower().split()) - _stop
        if prev_words and curr_words:
            overlap = len(prev_words & curr_words) / max(len(prev_words), len(curr_words))
            if overlap >= 0.5:
                signals.append("same_topic_rephrase")

        # Signal 2: Different classification on rephrase
        if prev["classified_intent"] != current_intent:
            signals.append("different_classification")

        # Signal 3: Explicit correction phrase
        ml = current_message.lower().strip()
        if any(ml.startswith(p) or f" {p}" in f" {ml}" for p in _CORRECTION_PHRASES):
            signals.append("explicit_correction")

        if len(signals) >= 2:
            miss_entry = {
                "miss_id": f"ism_{uuid.uuid4().hex[:12]}",
                "session_id": session_id,
                "patient_id": patient_id,
                "original_message": prev["message"][:500],
                "original_intent": prev["classified_intent"],
                "correction_message": current_message[:500],
                "correction_intent": current_intent,
                "signals": json.dumps(signals),
                "reviewed": False,
                "created_at": _now_iso(),
            }
            r.lpush("intent_miss_queue", json.dumps(miss_entry))
            r.ltrim("intent_miss_queue", 0, _MISS_QUEUE_MAX - 1)

            # Mark the previous classification as suspected miss
            prev["suspected_miss"] = True
            prev["miss_signals"] = json.dumps(signals)
            r.set(f"intent_cls:{session_id}:prev", json.dumps(prev), ex=_REDIS_TTL)

            logger.info(
                f"intent_learner: SUSPECTED MISS signals={signals} "
                f"orig_intent={prev['classified_intent']} "
                f"msg={prev['message'][:60]}"
            )
            return miss_entry

    except Exception as e:
        logger.debug(f"intent_learner: miss detection failed: {e}")

    return None


# ═══════════════════════════════════════════════════════════════════
# ASYNC PERSISTENCE — drain Redis queues to ArcadeDB
# Called from the agent after response generation.
# ═══════════════════════════════════════════════════════════════════

async def flush_classification_log(batch_size: int = 50) -> int:
    """Drain the classification log queue from Redis to ArcadeDB.
    Returns number of records persisted.
    """
    if not _ENABLED:
        return 0

    ensure_schema()
    count = 0

    try:
        r = _get_redis()
        for _ in range(batch_size):
            raw = r.rpop("intent_cls_queue")
            if not raw:
                break
            entry = json.loads(raw)
            await _async_sql(
                f"INSERT INTO IntentClassificationLog CONTENT {json.dumps(entry)}"
            )
            count += 1

            if entry.get("was_overridden") and entry.get("override_correction_id"):
                audit = {
                    "audit_id": f"ioa_{uuid.uuid4().hex[:12]}",
                    "message": entry.get("message", "")[:500],
                    "session_id": entry.get("session_id", ""),
                    "original_intent": "unknown",
                    "overridden_to": entry.get("classified_intent", ""),
                    "correction_id": entry["override_correction_id"],
                    "correction_source": "reviewer",
                    "correction_weight": OVERRIDE_THRESHOLD,
                    "created_at": entry.get("created_at", _now_iso()),
                }
                try:
                    await _async_sql(
                        f"INSERT INTO IntentOverrideAudit CONTENT {json.dumps(audit)}"
                    )
                except Exception:
                    pass
    except Exception as e:
        logger.warning(f"intent_learner: flush_classification_log failed: {e}")

    return count


async def flush_miss_queue(batch_size: int = 20) -> int:
    """Drain the suspected-miss queue from Redis to ArcadeDB."""
    if not _ENABLED:
        return 0

    ensure_schema()
    count = 0

    try:
        r = _get_redis()
        for _ in range(batch_size):
            raw = r.rpop("intent_miss_queue")
            if not raw:
                break
            entry = json.loads(raw)
            await _async_sql(
                f"INSERT INTO IntentSuspectedMiss CONTENT {json.dumps(entry)}"
            )
            count += 1
    except Exception as e:
        logger.warning(f"intent_learner: flush_miss_queue failed: {e}")

    return count


# ═══════════════════════════════════════════════════════════════════
# CORRECTION MANAGEMENT — reviewer-facing write path
# ═══════════════════════════════════════════════════════════════════

async def submit_correction(
    pattern: str,
    classified_intent: str,
    corrected_intent: str,
    source: str = "reviewer",
    reviewer_id: str = "admin",
) -> Dict[str, Any]:
    """Submit a correction: pattern X should be intent Y, not Z.

    If a correction for this pattern+source already exists, increment
    its count and weight. Otherwise create a new one.

    Syncs to Redis hot cache immediately.
    """
    if not _ENABLED:
        return {"error": "intent learner disabled"}

    if corrected_intent in SAFETY_EXCLUDED_INTENTS and source != "reviewer":
        return {"error": "cannot auto-correct to safety-excluded intent"}

    ensure_schema()

    ph = _pattern_hash(pattern)
    weight_per = REVIEWER_WEIGHT if source == "reviewer" else IMPLICIT_WEIGHT
    now = _now_iso()
    expires = _expires_iso()

    try:
        existing = await _async_sql(
            "SELECT correction_id, count, weight FROM IntentCorrection "
            "WHERE pattern_hash = :ph AND source = :src AND corrected_intent = :ci AND status = 'active'",
            {"ph": ph, "src": source, "ci": corrected_intent},
        )
        rows = _extract_rows(existing)

        if rows:
            row = rows[0]
            new_count = (row.get("count") or 0) + 1
            new_weight = (row.get("weight") or 0) + weight_per
            cid = row["correction_id"]

            await _async_sql(
                "UPDATE IntentCorrection SET count = :cnt, weight = :w, "
                "updated_at = :now, expires_at = :exp "
                "WHERE correction_id = :cid",
                {"cnt": new_count, "w": new_weight, "now": now, "exp": expires, "cid": cid},
            )
        else:
            cid = f"ic_{uuid.uuid4().hex[:12]}"
            record = {
                "correction_id": cid,
                "pattern": pattern.lower().strip()[:500],
                "pattern_hash": ph,
                "source": source,
                "classified_intent": classified_intent,
                "corrected_intent": corrected_intent,
                "count": 1,
                "weight": weight_per,
                "status": "active",
                "reviewer_id": reviewer_id if source == "reviewer" else "",
                "kill_reason": "",
                "created_at": now,
                "updated_at": now,
                "expires_at": expires,
            }
            await _async_sql(
                f"INSERT INTO IntentCorrection CONTENT {json.dumps(record)}"
            )
            new_weight = weight_per
            new_count = 1

        # Sync to Redis hot cache
        _sync_correction_to_redis(ph, source, {
            "correction_id": cid,
            "corrected_intent": corrected_intent,
            "weight": new_weight,
            "count": new_count,
        })

        logger.info(
            f"intent_learner: correction submitted "
            f"src={source} pattern='{pattern[:40]}' "
            f"{classified_intent}→{corrected_intent} weight={new_weight}"
        )
        return {
            "correction_id": cid,
            "pattern_hash": ph,
            "weight": new_weight,
            "count": new_count,
            "status": "active",
        }

    except Exception as e:
        logger.warning(f"intent_learner: submit_correction failed: {e}")
        return {"error": str(e)}


def _sync_correction_to_redis(
    pattern_hash: str,
    source: str,
    data: Dict[str, Any],
) -> None:
    """Push a correction to the Redis hot cache."""
    try:
        r = _get_redis()
        key = f"intent_corr:{source}:{pattern_hash}"
        r.set(key, json.dumps(data), ex=CORRECTION_TTL_DAYS * 86400)
    except Exception as e:
        logger.debug(f"intent_learner: redis sync failed: {e}")


async def kill_correction(
    correction_id: str,
    reason: str = "",
) -> bool:
    """Disable a specific correction. Removes from Redis immediately.

    The correction is not deleted — its status changes to 'killed'
    with a reason, preserving the audit trail.
    """
    if not _ENABLED:
        return False

    try:
        resp = await _async_sql(
            "SELECT pattern_hash, source FROM IntentCorrection "
            "WHERE correction_id = :cid",
            {"cid": correction_id},
        )
        rows = _extract_rows(resp)
        if not rows:
            return False

        row = rows[0]
        ph = row["pattern_hash"]
        source = row["source"]

        await _async_sql(
            "UPDATE IntentCorrection SET status = 'killed', "
            "kill_reason = :reason, updated_at = :now "
            "WHERE correction_id = :cid",
            {"reason": reason[:300], "now": _now_iso(), "cid": correction_id},
        )

        # Remove from Redis
        try:
            r = _get_redis()
            r.delete(f"intent_corr:{source}:{ph}")
        except Exception:
            pass

        logger.info(f"intent_learner: correction {correction_id} killed: {reason}")
        return True

    except Exception as e:
        logger.warning(f"intent_learner: kill_correction failed: {e}")
        return False


async def kill_all_for_intent(intent: str, reason: str = "") -> int:
    """Kill switch: disable ALL corrections that override TO a given intent."""
    if not _ENABLED:
        return 0

    try:
        resp = await _async_sql(
            "SELECT correction_id, pattern_hash, source FROM IntentCorrection "
            "WHERE corrected_intent = :intent AND status = 'active'",
            {"intent": intent},
        )
        rows = _extract_rows(resp)
        killed = 0
        for row in rows:
            ok = await kill_correction(row["correction_id"], reason)
            if ok:
                killed += 1
        return killed
    except Exception as e:
        logger.warning(f"intent_learner: kill_all_for_intent failed: {e}")
        return 0


# ═══════════════════════════════════════════════════════════════════
# TTL + RE-EVALUATION
# ═══════════════════════════════════════════════════════════════════

async def retire_stale_corrections() -> int:
    """Retire corrections past their 90-day freshness window.

    Moved to status='retired', not deleted. Still queryable for audit.
    """
    if not _ENABLED:
        return 0

    now = _now_iso()
    try:
        resp = await _async_sql(
            "SELECT correction_id, pattern_hash, source FROM IntentCorrection "
            "WHERE status = 'active' AND expires_at < :now",
            {"now": now},
        )
        rows = _extract_rows(resp)
        retired = 0
        for row in rows:
            await _async_sql(
                "UPDATE IntentCorrection SET status = 'retired', updated_at = :now "
                "WHERE correction_id = :cid",
                {"now": now, "cid": row["correction_id"]},
            )
            try:
                r = _get_redis()
                r.delete(f"intent_corr:{row['source']}:{row['pattern_hash']}")
            except Exception:
                pass
            retired += 1

        if retired:
            logger.info(f"intent_learner: retired {retired} stale corrections")
        return retired
    except Exception as e:
        logger.warning(f"intent_learner: retire_stale failed: {e}")
        return 0


async def re_evaluate_correction(correction_id: str) -> Dict[str, Any]:
    """Re-run a corrected pattern through the current classifier.

    If the classifier now produces the corrected intent (i.e., the
    deterministic rules were updated), the correction is retired as
    'no longer needed'.
    """
    if not _ENABLED:
        return {"status": "disabled"}

    try:
        resp = await _async_sql(
            "SELECT pattern, corrected_intent, classified_intent "
            "FROM IntentCorrection WHERE correction_id = :cid AND status = 'active'",
            {"cid": correction_id},
        )
        rows = _extract_rows(resp)
        if not rows:
            return {"status": "not_found"}

        row = rows[0]
        from src.services.intent_router import _classify_content, _strip_ack_prefix
        _stripped, _ = _strip_ack_prefix(row["pattern"].lower().strip())
        current_intent = _classify_content(_stripped, is_first_turn=False)

        if current_intent == row["corrected_intent"]:
            await _async_sql(
                "UPDATE IntentCorrection SET status = 'retired', "
                "updated_at = :now, kill_reason = 'classifier now correct' "
                "WHERE correction_id = :cid",
                {"now": _now_iso(), "cid": correction_id},
            )
            return {"status": "retired", "reason": "classifier now produces correct intent"}

        return {
            "status": "still_needed",
            "classifier_says": current_intent,
            "correction_says": row["corrected_intent"],
        }
    except Exception as e:
        return {"status": "error", "detail": str(e)}


# ═══════════════════════════════════════════════════════════════════
# OVERRIDE AUDIT LOGGING
# ═══════════════════════════════════════════════════════════════════

async def log_override(
    message: str,
    session_id: str,
    original_intent: str,
    overridden_to: str,
    correction_id: str,
    correction_source: str,
    correction_weight: float,
) -> None:
    """Log every time the correction layer overrides the classifier."""
    if not _ENABLED:
        return

    ensure_schema()
    record = {
        "audit_id": f"ioa_{uuid.uuid4().hex[:12]}",
        "message": message[:500],
        "session_id": session_id,
        "original_intent": original_intent,
        "overridden_to": overridden_to,
        "correction_id": correction_id,
        "correction_source": correction_source,
        "correction_weight": correction_weight,
        "created_at": _now_iso(),
    }
    try:
        await _async_sql(
            f"INSERT INTO IntentOverrideAudit CONTENT {json.dumps(record)}"
        )
    except Exception as e:
        logger.debug(f"intent_learner: override audit write failed: {e}")


# ═══════════════════════════════════════════════════════════════════
# QUERY HELPERS — used by admin API
# ═══════════════════════════════════════════════════════════════════

async def get_suspected_misses(
    reviewed: Optional[bool] = None,
    limit: int = 50,
    offset: int = 0,
) -> List[Dict[str, Any]]:
    """Paginated list of suspected misclassifications."""
    if not _ENABLED:
        return []

    where = ""
    if reviewed is not None:
        where = f"WHERE reviewed = {'true' if reviewed else 'false'}"

    try:
        resp = await _async_sql(
            f"SELECT * FROM IntentSuspectedMiss {where} "
            f"ORDER BY created_at DESC LIMIT {limit} SKIP {offset}",
        )
        return _extract_rows(resp)
    except Exception as e:
        logger.warning(f"intent_learner: get_suspected_misses failed: {e}")
        return []


async def get_corrections(
    status: str = "active",
    source: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> List[Dict[str, Any]]:
    """Paginated list of corrections."""
    if not _ENABLED:
        return []

    _safe_status = status.replace("'", "")
    where = f"status = '{_safe_status}'"
    if source:
        _safe_source = source.replace("'", "")
        where += f" AND source = '{_safe_source}'"

    try:
        resp = await _async_sql(
            f"SELECT * FROM IntentCorrection WHERE {where} "
            f"ORDER BY weight DESC LIMIT {limit} SKIP {offset}",
        )
        return _extract_rows(resp)
    except Exception as e:
        logger.warning(f"intent_learner: get_corrections failed: {e}")
        return []


async def get_override_audit(
    limit: int = 50,
    offset: int = 0,
) -> List[Dict[str, Any]]:
    """Paginated override audit trail."""
    if not _ENABLED:
        return []

    try:
        resp = await _async_sql(
            f"SELECT * FROM IntentOverrideAudit "
            f"ORDER BY created_at DESC LIMIT {limit} SKIP {offset}",
        )
        return _extract_rows(resp)
    except Exception as e:
        logger.warning(f"intent_learner: get_override_audit failed: {e}")
        return []


async def mark_miss_reviewed(miss_id: str) -> bool:
    """Mark a suspected miss as reviewed (after reviewer takes action)."""
    if not _ENABLED:
        return False
    try:
        await _async_sql(
            "UPDATE IntentSuspectedMiss SET reviewed = true WHERE miss_id = :mid",
            {"mid": miss_id},
        )
        return True
    except Exception:
        return False


async def get_stats() -> Dict[str, Any]:
    """Gap report: classification distribution, top misses, correction stats."""
    if not _ENABLED:
        return {"enabled": False}

    stats: Dict[str, Any] = {"enabled": True}

    try:
        # Total classifications
        resp = await _async_sql(
            "SELECT count(*) AS n FROM IntentClassificationLog"
        )
        stats["total_classifications"] = _extract_rows(resp)[0].get("n", 0) if _extract_rows(resp) else 0

        # Classification distribution by intent
        resp = await _async_sql(
            "SELECT classified_intent, count(*) AS n "
            "FROM IntentClassificationLog "
            "GROUP BY classified_intent ORDER BY n DESC"
        )
        stats["intent_distribution"] = _extract_rows(resp)

        # Suspected misses (unreviewed)
        resp = await _async_sql(
            "SELECT count(*) AS n FROM IntentSuspectedMiss WHERE reviewed = false"
        )
        stats["unreviewed_misses"] = _extract_rows(resp)[0].get("n", 0) if _extract_rows(resp) else 0

        # Top missed patterns (most frequently flagged original intents)
        resp = await _async_sql(
            "SELECT original_intent, count(*) AS n "
            "FROM IntentSuspectedMiss WHERE reviewed = false "
            "GROUP BY original_intent ORDER BY n DESC LIMIT 10"
        )
        stats["top_missed_intents"] = _extract_rows(resp)

        # Active corrections
        resp = await _async_sql(
            "SELECT count(*) AS n FROM IntentCorrection WHERE status = 'active'"
        )
        stats["active_corrections"] = _extract_rows(resp)[0].get("n", 0) if _extract_rows(resp) else 0

        # Override count
        resp = await _async_sql(
            "SELECT count(*) AS n FROM IntentOverrideAudit"
        )
        stats["total_overrides"] = _extract_rows(resp)[0].get("n", 0) if _extract_rows(resp) else 0

        # Overrides in last 7 days
        week_ago = (datetime.utcnow() - timedelta(days=7)).isoformat() + "Z"
        resp = await _async_sql(
            "SELECT count(*) AS n FROM IntentOverrideAudit WHERE created_at > :since",
            {"since": week_ago},
        )
        stats["overrides_last_7d"] = _extract_rows(resp)[0].get("n", 0) if _extract_rows(resp) else 0

    except Exception as e:
        stats["error"] = str(e)

    return stats


async def get_weekly_gap_report() -> Dict[str, Any]:
    """Weekly gap report for human review.

    Shows the top misclassified patterns from the past 7 days so a
    developer or clinician can update the TOOL_ROUTES deterministic
    rules — the learning happens in the humans reading the report.
    """
    if not _ENABLED:
        return {"enabled": False}

    week_ago = (datetime.utcnow() - timedelta(days=7)).isoformat() + "Z"
    report: Dict[str, Any] = {"period": f"{week_ago} to {_now_iso()}"}

    try:
        # Top unreviewed misses this week
        resp = await _async_sql(
            "SELECT original_message, original_intent, correction_intent, signals, created_at "
            "FROM IntentSuspectedMiss "
            "WHERE reviewed = false AND created_at > :since "
            "ORDER BY created_at DESC LIMIT 30",
            {"since": week_ago},
        )
        report["suspected_misses"] = _extract_rows(resp)

        # Classification volume by intent this week
        resp = await _async_sql(
            "SELECT classified_intent, count(*) AS n "
            "FROM IntentClassificationLog "
            "WHERE created_at > :since "
            "GROUP BY classified_intent ORDER BY n DESC",
            {"since": week_ago},
        )
        report["intent_volume"] = _extract_rows(resp)

        # Overrides this week
        resp = await _async_sql(
            "SELECT original_intent, overridden_to, count(*) AS n "
            "FROM IntentOverrideAudit "
            "WHERE created_at > :since "
            "GROUP BY original_intent, overridden_to ORDER BY n DESC",
            {"since": week_ago},
        )
        report["overrides"] = _extract_rows(resp)

    except Exception as e:
        report["error"] = str(e)

    return report
