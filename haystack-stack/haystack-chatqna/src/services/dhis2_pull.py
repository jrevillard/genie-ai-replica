"""
AMINA Care — DHIS2 Bi-directional Pull
========================================
Phase 2.6 — pull CHW referrals and follow-up events from DHIS2 back into
AMINA so they show up in the caregiver portal.

Flow:
  1. Every 15 min, query DHIS2 /api/events for new events in the AMINA
     Tracker program created since the last successful pull.
  2. For each event, extract the linked patient (via TEI attribute lookup)
     and the referral details (data values).
  3. Store as DHIS2ReferralVertex in ArcadeDB.
  4. Patient opens AMINA → caregiver portal shows "new referral from DHIS2".

The pull is idempotent — events are keyed by DHIS2 event UID, so a re-run
overwrites instead of duplicating.

Scope:
  - Phase 2.6 delivers: scheduler + pull worker + ArcadeDB vertex + API
  - NOT delivered in 2.6: real DHIS2 tracker attribute lookup chain (needs
    the Phase 2.3 config env vars to be set with real UIDs)

Feature flag: DHIS2_PULL_ENABLED (default false).
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

import requests

from src.config import settings
from src.utils.arcade_client import command_sql
from src.services import dhis2_tracker  # for auth helpers

logger = logging.getLogger(__name__)


# ── Schema ───────────────────────────────────────────────────────────────────

def ensure_referral_schema() -> None:
    """Create DHIS2ReferralVertex if missing."""
    stmts = [
        "CREATE VERTEX TYPE DHIS2ReferralVertex IF NOT EXISTS",
        "CREATE PROPERTY DHIS2ReferralVertex.referral_id IF NOT EXISTS STRING",
        "CREATE PROPERTY DHIS2ReferralVertex.dhis2_event_uid IF NOT EXISTS STRING",
        "CREATE PROPERTY DHIS2ReferralVertex.dhis2_tei_uid IF NOT EXISTS STRING",
        "CREATE PROPERTY DHIS2ReferralVertex.patient_id IF NOT EXISTS STRING",
        "CREATE PROPERTY DHIS2ReferralVertex.pulled_at IF NOT EXISTS STRING",
        "CREATE PROPERTY DHIS2ReferralVertex.event_date IF NOT EXISTS STRING",
        "CREATE PROPERTY DHIS2ReferralVertex.orgunit_uid IF NOT EXISTS STRING",
        "CREATE PROPERTY DHIS2ReferralVertex.status IF NOT EXISTS STRING",
        "CREATE PROPERTY DHIS2ReferralVertex.referral_type IF NOT EXISTS STRING",
        "CREATE PROPERTY DHIS2ReferralVertex.summary IF NOT EXISTS STRING",
        "CREATE PROPERTY DHIS2ReferralVertex.raw_data_values IF NOT EXISTS STRING",
        "CREATE PROPERTY DHIS2ReferralVertex.acknowledged IF NOT EXISTS BOOLEAN",
        "CREATE INDEX IF NOT EXISTS ON DHIS2ReferralVertex (dhis2_event_uid) UNIQUE",
    ]
    for stmt in stmts:
        try:
            command_sql(stmt)
        except Exception as e:
            logger.debug(f"referral schema step: {stmt[:60]}... -> {e}")


# ── Config ───────────────────────────────────────────────────────────────────

def _pull_enabled() -> bool:
    return bool(getattr(settings, "DHIS2_PULL_ENABLED", False))


def _last_pull_key() -> str:
    return "dhis2:last_pull_at"


def _get_last_pull_at() -> Optional[str]:
    try:
        import redis as _redis
        r = _redis.Redis(host=settings.REDIS_HOST, port=settings.REDIS_PORT, decode_responses=True)
        return r.get(_last_pull_key())
    except Exception:
        return None


def _set_last_pull_at(ts: str) -> None:
    try:
        import redis as _redis
        r = _redis.Redis(host=settings.REDIS_HOST, port=settings.REDIS_PORT, decode_responses=True)
        r.set(_last_pull_key(), ts, ex=7 * 24 * 3600)
    except Exception:
        pass


# ── DHIS2 API helpers ───────────────────────────────────────────────────────

def _fetch_events_since(since_iso: str) -> Tuple[bool, List[Dict]]:
    """Fetch DHIS2 events updated since a given timestamp for the AMINA program."""
    program = getattr(settings, "DHIS2_TRACKER_PROGRAM_ID", "") or ""
    if not program:
        return False, []

    base = (getattr(settings, "DHIS2_BASE_URL", "") or "").rstrip("/")
    url = f"{base}/api/events"
    params = {
        "program":         program,
        "lastUpdatedStartDate": since_iso.split("T")[0],  # DHIS2 wants YYYY-MM-DD
        "paging":          "false",
        "fields":          "event,trackedEntityInstance,orgUnit,status,eventDate,dataValues[dataElement,value]",
    }

    headers, auth = dhis2_tracker._auth_headers()
    if not headers.get("Authorization") and not auth:
        return False, []

    try:
        resp = requests.get(url, headers=headers, auth=auth, params=params, timeout=30)
    except requests.RequestException as e:
        logger.error(f"dhis2_pull: fetch failed: {e}")
        return False, []
    if not (200 <= resp.status_code < 300):
        logger.error(f"dhis2_pull: fetch returned {resp.status_code}: {resp.text[:300]}")
        return False, []
    try:
        body = resp.json()
    except Exception:
        return False, []
    return True, body.get("events", [])


def _lookup_patient_by_tei(tei_uid: str) -> Optional[str]:
    """
    Map a DHIS2 TEI UID back to an AMINA patient ID.

    Phase 2.6: reads from the TrackerPushAuditVertex log — AMINA wrote the
    TEI UID there when it first pushed the patient. If the mapping isn't
    found (e.g. the patient was created directly in DHIS2, not via AMINA),
    the referral is stored with patient_id=None and surfaced to admins
    for manual reconciliation.
    """
    if not tei_uid:
        return None
    try:
        resp = command_sql(
            "SELECT patient_id FROM TrackerPushAuditVertex WHERE tei_uid = :uid LIMIT 1",
            {"uid": tei_uid},
        )
        rows = (resp or {}).get("result", [])
        if rows:
            return rows[0].get("patient_id") or None
    except Exception as e:
        logger.debug(f"dhis2_pull: TEI lookup failed: {e}")
    return None


# ── Referral extraction ─────────────────────────────────────────────────────

def _parse_event_to_referral(event: Dict) -> Dict:
    """Transform a DHIS2 event into a DHIS2ReferralVertex dict."""
    import uuid as _uuid
    data_values = event.get("dataValues", []) or []
    # Simple summary: first few data values concatenated
    summary_parts = []
    for dv in data_values[:5]:
        val = str(dv.get("value", ""))[:80]
        if val:
            summary_parts.append(val)
    summary = " | ".join(summary_parts)[:500]

    tei_uid = event.get("trackedEntityInstance", "") or ""
    patient_id = _lookup_patient_by_tei(tei_uid) or ""

    return {
        "referral_id":     _uuid.uuid4().hex,
        "dhis2_event_uid": event.get("event", ""),
        "dhis2_tei_uid":   tei_uid,
        "patient_id":      patient_id,
        "pulled_at":       datetime.utcnow().isoformat() + "Z",
        "event_date":      event.get("eventDate", ""),
        "orgunit_uid":     event.get("orgUnit", ""),
        "status":          (event.get("status") or "").upper(),
        "referral_type":   "dhis2_tracker_event",
        "summary":         summary,
        "raw_data_values": json.dumps(data_values)[:4000],
        "acknowledged":    False,
    }


def _upsert_referral(record: Dict) -> bool:
    """Insert or replace a referral by DHIS2 event UID (idempotent)."""
    event_uid = record.get("dhis2_event_uid")
    if not event_uid:
        return False
    try:
        # Check if exists
        existing = command_sql(
            "SELECT referral_id FROM DHIS2ReferralVertex WHERE dhis2_event_uid = :uid LIMIT 1",
            {"uid": event_uid},
        )
        if (existing or {}).get("result"):
            # Update in place — keep referral_id stable
            command_sql(
                "UPDATE DHIS2ReferralVertex SET pulled_at = :pulled_at, status = :status, "
                "summary = :summary, raw_data_values = :raw WHERE dhis2_event_uid = :uid",
                {
                    "pulled_at": record["pulled_at"],
                    "status":    record["status"],
                    "summary":   record["summary"],
                    "raw":       record["raw_data_values"],
                    "uid":       event_uid,
                },
            )
        else:
            command_sql(
                "INSERT INTO DHIS2ReferralVertex CONTENT " + json.dumps(record)
            )
        return True
    except Exception as e:
        logger.error(f"dhis2_pull: upsert failed for event {event_uid}: {e}")
        return False


# ── Orchestration ───────────────────────────────────────────────────────────

def run_pull(since: Optional[str] = None, dry_run: bool = False) -> Dict:
    """
    One-shot DHIS2 pull. Called from the scheduler or manually via API.

    Args:
        since:   ISO timestamp — events updated after this are fetched.
                 Defaults to the last successful pull (or 24 h ago).
        dry_run: Fetch and parse but don't write to ArcadeDB.

    Returns a result dict with counts + warnings.
    """
    result = {
        "ok":            True,
        "pulled":        0,
        "new":           0,
        "updated":       0,
        "unlinked":      0,  # referrals with no AMINA patient_id
        "warnings":      [],
        "dry_run":       dry_run,
    }

    if not _pull_enabled():
        result["ok"] = False
        result["error"] = "DHIS2_PULL_ENABLED is false"
        return result

    if since is None:
        since = _get_last_pull_at() or (datetime.utcnow() - timedelta(days=1)).isoformat() + "Z"
    result["since"] = since

    ok, events = _fetch_events_since(since)
    if not ok:
        result["ok"] = False
        result["error"] = "fetch failed"
        return result

    result["pulled"] = len(events)

    for event in events:
        referral = _parse_event_to_referral(event)
        if not referral.get("dhis2_event_uid"):
            result["warnings"].append("event missing UID, skipping")
            continue
        if not referral.get("patient_id"):
            result["unlinked"] += 1
        if dry_run:
            continue
        if _upsert_referral(referral):
            result["new"] += 1

    if not dry_run:
        _set_last_pull_at(datetime.utcnow().isoformat() + "Z")

    return result


# ── Query API (for caregiver portal) ────────────────────────────────────────

def get_referrals_for_patient(patient_id: str, unacknowledged_only: bool = False) -> List[Dict]:
    """Return referrals for a patient, newest first."""
    try:
        if unacknowledged_only:
            resp = command_sql(
                "SELECT * FROM DHIS2ReferralVertex WHERE patient_id = :pid AND acknowledged = false "
                "ORDER BY event_date DESC LIMIT 50",
                {"pid": patient_id},
            )
        else:
            resp = command_sql(
                "SELECT * FROM DHIS2ReferralVertex WHERE patient_id = :pid "
                "ORDER BY event_date DESC LIMIT 50",
                {"pid": patient_id},
            )
        return (resp or {}).get("result", [])
    except Exception as e:
        logger.error(f"dhis2_pull: referral query failed for {patient_id}: {e}")
        return []


def get_unlinked_referrals(limit: int = 50) -> List[Dict]:
    """Return referrals with no AMINA patient_id mapping (admin reconciliation queue)."""
    try:
        resp = command_sql(
            "SELECT * FROM DHIS2ReferralVertex WHERE patient_id = '' OR patient_id IS NULL "
            "ORDER BY pulled_at DESC LIMIT :lim",
            {"lim": limit},
        )
        return (resp or {}).get("result", [])
    except Exception as e:
        logger.error(f"dhis2_pull: unlinked query failed: {e}")
        return []


def acknowledge_referral(referral_id: str) -> bool:
    """Mark a referral as acknowledged by a caregiver (so it disappears from the inbox)."""
    try:
        command_sql(
            "UPDATE DHIS2ReferralVertex SET acknowledged = true WHERE referral_id = :rid",
            {"rid": referral_id},
        )
        return True
    except Exception as e:
        logger.error(f"dhis2_pull: acknowledge failed: {e}")
        return False


# ── Scheduler (runs every 15 min) ───────────────────────────────────────────

_pull_scheduler = None


def start_pull_scheduler() -> None:
    """Start the background scheduler for DHIS2 referral pulls.
    Idempotent — safe to call on every startup."""
    global _pull_scheduler
    if _pull_scheduler is not None:
        return
    if not _pull_enabled():
        logger.info("dhis2_pull: pull disabled (DHIS2_PULL_ENABLED=false)")
        return

    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.interval import IntervalTrigger
    except ImportError:
        logger.warning("dhis2_pull: APScheduler not installed")
        return

    sched = BackgroundScheduler(timezone="UTC")
    sched.add_job(
        lambda: run_pull(dry_run=False),
        trigger=IntervalTrigger(minutes=15),
        id="dhis2_pull_referrals",
        replace_existing=True,
    )
    try:
        sched.start()
        _pull_scheduler = sched
        logger.info("dhis2_pull: scheduler started (every 15 min)")
    except Exception as e:
        logger.error(f"dhis2_pull: failed to start: {e}")
