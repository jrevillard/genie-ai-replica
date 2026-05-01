"""
Emergency Escalation — state machine for patient SOS alerts.
=============================================================

Lifecycle
---------
  pending            — alert was just created; caregiver has NOT responded
  caregiver_seen     — caregiver opened inbox / marked item read (passive ack)
  caregiver_responding — caregiver clicked "I'm responding" (active ack)
  authorities_notified — caregiver escalated to local hospital(s)
  hotline_prompted   — T1 (default 10m) elapsed w/ no caregiver response;
                       patient UI now shows "Call 199 now"
  admin_escalated    — T2 (default 60m) elapsed; admin inbox notified AND
                       every hospital in the patient's region is logged
                       to the alert's dispatch log (SMS fanout TODO)
  resolved           — explicit resolution from caregiver/admin

Storage
-------
  Redis HASH  emergency:active        {alert_id → JSON}
  Redis LIST  emergency:history       [alert_id, ...]  (capped 500)
  Redis HASH  emergency:resolved      {alert_id → JSON}

Timers are read at service construction from env (defaults shown):
  EMERGENCY_HOTLINE_PROMPT_MIN = 10
  EMERGENCY_ADMIN_ESCALATE_MIN = 60

Every transition pushes a notification to the relevant inboxes via the
existing `caregiver_notify` + `inbox_service` helpers. That way the
UI bells / toasts we already built surface the state change immediately.
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ── timers ────────────────────────────────────────────────────────────

def _env_int(name: str, default: int) -> int:
    try:
        v = int(os.getenv(name, "") or default)
    except ValueError:
        v = default
    return max(1, v)


HOTLINE_PROMPT_MIN   = _env_int("EMERGENCY_HOTLINE_PROMPT_MIN", 10)
ADMIN_ESCALATE_MIN   = _env_int("EMERGENCY_ADMIN_ESCALATE_MIN", 60)


# ── Gambia hospital directory (by region) ────────────────────────────

GAMBIA_HOSPITALS: List[Dict[str, Any]] = [
    # Banjul / Greater Banjul
    {"id": "efhs_banjul",     "name": "Edward Francis Small Teaching Hospital",
     "region": "Banjul",      "phone": "+2204228223", "tier": "tertiary"},
    {"id": "banjul_general",  "name": "Banjul General Hospital",
     "region": "Banjul",      "phone": "+2204227525", "tier": "general"},
    {"id": "rvth_bakau",      "name": "Royal Victoria Teaching Hospital",
     "region": "Kanifing",    "phone": "+2204228223", "tier": "tertiary"},
    {"id": "serekunda",       "name": "Serrekunda General Hospital",
     "region": "Kanifing",    "phone": "+2204392050", "tier": "general"},

    # West Coast Region
    {"id": "brikama_hc",      "name": "Brikama Major Health Centre",
     "region": "Brikama",     "phone": "+2204484025", "tier": "major_hc"},
    {"id": "bwiam_gh",        "name": "Bwiam General Hospital",
     "region": "West Coast",  "phone": "+2204484025", "tier": "general"},

    # North Bank Region
    {"id": "farafenni_gh",    "name": "Farafenni General Hospital",
     "region": "North Bank",  "phone": "+2207358205", "tier": "general"},
    {"id": "kerewan_hc",      "name": "Kerewan Major Health Centre",
     "region": "Kerewan",     "phone": "+2207358205", "tier": "major_hc"},

    # Lower River
    {"id": "soma_hc",         "name": "Soma Major Health Centre",
     "region": "Lower River", "phone": "+2205312092", "tier": "major_hc"},

    # Central River
    {"id": "bansang_gh",      "name": "Bansang General Hospital",
     "region": "Central River", "phone": "+2205674272", "tier": "general"},
    {"id": "kuntaur_hc",      "name": "Kuntaur Major Health Centre",
     "region": "Central River", "phone": "+2205674272", "tier": "major_hc"},

    # Upper River
    {"id": "basse_hc",        "name": "Basse Major Health Centre",
     "region": "Upper River", "phone": "+2205668013", "tier": "major_hc"},
]

HOTLINE_NUMBER       = "199"
HOTLINE_DISPLAY_NAME = "Emergency Hotline"


def hospitals_for_region(region: Optional[str]) -> List[Dict[str, Any]]:
    """Return every hospital whose region matches (case-insensitive).
    If region is unknown / missing, fall back to Greater Banjul (the
    most likely referral target from anywhere in The Gambia)."""
    if not region:
        region = "Banjul"
    want = region.strip().lower()
    exact = [h for h in GAMBIA_HOSPITALS if h["region"].lower() == want]
    if exact:
        return exact
    # Soft fallback: major regional cities
    fallbacks = {
        "kanifing": ["Banjul", "Kanifing"],
        "bakau":    ["Banjul", "Kanifing"],
        "brikama":  ["West Coast", "Brikama"],
        "kerewan":  ["North Bank", "Kerewan"],
    }
    fb = fallbacks.get(want)
    if fb:
        return [h for h in GAMBIA_HOSPITALS if h["region"] in fb]
    return [h for h in GAMBIA_HOSPITALS if h["region"] in ("Banjul", "Kanifing")]


# ── state machine ─────────────────────────────────────────────────────

ACTIVE_KEY   = "emergency:active"
HISTORY_KEY  = "emergency:history"
RESOLVED_KEY = "emergency:resolved"

STATES = {
    "pending", "caregiver_seen", "caregiver_responding",
    "authorities_notified", "hotline_prompted",
    "admin_escalated", "resolved",
}


def _now_iso() -> str:
    return datetime.now().isoformat()


def _minutes_since(iso: str) -> float:
    try:
        t = datetime.fromisoformat(iso)
    except Exception:
        return 0.0
    return (datetime.now() - t).total_seconds() / 60.0


class EmergencyEscalationService:
    def __init__(self, redis_client):
        self.redis = redis_client

    # ── core CRUD ────────────────────────────────────────────────

    def _load(self, alert_id: str) -> Optional[Dict[str, Any]]:
        try:
            raw = self.redis.hget(ACTIVE_KEY, alert_id)
            if raw:
                return json.loads(raw)
            raw = self.redis.hget(RESOLVED_KEY, alert_id)
            if raw:
                return json.loads(raw)
        except Exception as exc:
            logger.warning(f"emergency load failed: {exc}")
        return None

    def _save(self, record: Dict[str, Any]) -> None:
        record["updated_at"] = _now_iso()
        active = record.get("state") != "resolved"
        try:
            if active:
                self.redis.hset(ACTIVE_KEY, record["alert_id"], json.dumps(record, default=str))
                # Move out of resolved if it had landed there previously
                self.redis.hdel(RESOLVED_KEY, record["alert_id"])
            else:
                self.redis.hset(RESOLVED_KEY, record["alert_id"], json.dumps(record, default=str))
                self.redis.hdel(ACTIVE_KEY, record["alert_id"])
            # History list (newest first)
            self.redis.lpush(HISTORY_KEY, record["alert_id"])
            self.redis.ltrim(HISTORY_KEY, 0, 500)
            # TTL on resolved records — keep for 30 days
            self.redis.expire(RESOLVED_KEY, 30 * 86400)
        except Exception as exc:
            logger.warning(f"emergency save failed: {exc}")

    def list_active(self) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        try:
            raw = self.redis.hgetall(ACTIVE_KEY) or {}
            for _, v in raw.items():
                try:
                    out.append(json.loads(v))
                except Exception:
                    continue
        except Exception as exc:
            logger.warning(f"emergency list_active failed: {exc}")
        out.sort(key=lambda r: r.get("created_at") or "", reverse=True)
        return out

    def get_latest_for_patient(
        self, patient_id: str, *, active_only: bool = True,
    ) -> Optional[Dict[str, Any]]:
        """Most recent alert belonging to this patient. Used by the
        patient-side watcher to know whether to surface the 199 prompt."""
        pool: List[Dict[str, Any]] = self.list_active()
        if not active_only:
            # BUG-017 fix: parse errors used to silently drop a resolved
            # alert -- which meant get_latest_for_patient could return
            # None even with an active emergency on record. Preserve the
            # raw blob in self._unparsed_alerts (in-memory ring) so the
            # operator can recover it from logs / audit if needed.
            try:
                raw = self.redis.hgetall(RESOLVED_KEY) or {}
            except Exception as e:
                logger.error(
                    "[EMERGENCY] could not read resolved alerts (%s: %s)",
                    type(e).__name__, e,
                )
                raw = {}
            for _, v in raw.items():
                try:
                    pool.append(json.loads(v))
                except json.JSONDecodeError as e:
                    logger.error(
                        "[EMERGENCY] failed to parse resolved alert JSON: %s. "
                        "Raw preserved (truncated): %r", e, v[:200] if isinstance(v, str) else str(v)[:200],
                    )
                    if not hasattr(self, "_unparsed_alerts"):
                        self._unparsed_alerts: List[Dict[str, Any]] = []
                    if len(self._unparsed_alerts) < 50:  # bounded ring
                        self._unparsed_alerts.append({
                            "raw": (v[:500] if isinstance(v, str) else str(v)[:500]),
                            "error": str(e),
                            "timestamp": datetime.utcnow().isoformat(),
                        })
                except Exception as e:
                    logger.error(
                        "[EMERGENCY] unexpected error reading alert (%s: %s)",
                        type(e).__name__, e,
                    )
        pool = [r for r in pool if r.get("patient_id") == patient_id]
        if not pool:
            return None
        pool.sort(key=lambda r: r.get("created_at") or "", reverse=True)
        return pool[0]

    # ── transitions ──────────────────────────────────────────────

    def create_alert(
        self,
        patient_id: str,
        patient_name: str,
        message: str,
        alert_type: str = "emergency_triage",
        region: str = "",
    ) -> Dict[str, Any]:
        """Fire a new emergency. Returns the stored record."""
        alert_id = "em_" + uuid.uuid4().hex[:12]
        record = {
            "alert_id":       alert_id,
            "state":          "pending",
            "patient_id":     patient_id,
            "patient_name":   patient_name,
            "message":        (message or "").strip(),
            "alert_type":     alert_type or "emergency_triage",
            "region":         (region or "").strip(),
            "created_at":     _now_iso(),
            "updated_at":     _now_iso(),
            "transitions":    [{"to": "pending", "at": _now_iso(), "by": "patient"}],
            "caregiver_responding_by": None,
            "authorities_notified_by": None,
            "hotline_prompted_at":     None,
            "admin_escalated_at":      None,
            "dispatch_log":            [],
        }
        self._save(record)
        self._notify_caregivers_new(record)
        return record

    def caregiver_acknowledge(
        self, alert_id: str, caregiver_id: str,
    ) -> Dict[str, Any]:
        record = self._load(alert_id) or {}
        if record.get("state") in ("resolved", "admin_escalated",
                                    "authorities_notified",
                                    "caregiver_responding"):
            return record
        record["state"] = "caregiver_responding"
        record["caregiver_responding_by"] = caregiver_id
        record.setdefault("transitions", []).append({
            "to": "caregiver_responding", "at": _now_iso(),
            "by": f"caregiver:{caregiver_id}",
        })
        self._save(record)
        self._notify_patient_status(
            record,
            title="Your caregiver is responding",
            body="They've acknowledged the alert and are on their way / will contact you.",
            severity="info",
        )
        return record

    def notify_authorities(
        self, alert_id: str, caregiver_id: str,
        extra_note: str = "",
    ) -> Dict[str, Any]:
        record = self._load(alert_id) or {}
        record["state"] = "authorities_notified"
        record["authorities_notified_by"] = caregiver_id
        tx = {"to": "authorities_notified", "at": _now_iso(),
              "by": f"caregiver:{caregiver_id}"}
        if extra_note: tx["note"] = extra_note
        record.setdefault("transitions", []).append(tx)
        # Dispatch log to every hospital in the region.
        hospitals = hospitals_for_region(record.get("region"))
        for h in hospitals:
            record.setdefault("dispatch_log", []).append({
                "hospital_id":   h["id"],
                "hospital_name": h["name"],
                "region":        h["region"],
                "phone":         h["phone"],
                "dispatched_at": _now_iso(),
                "dispatched_by": f"caregiver:{caregiver_id}",
                "channel":       "log_only",  # TODO: SMS when SMS creds present
            })
        self._save(record)
        self._notify_patient_status(
            record,
            title="Nearby hospital alerted",
            body=f"Your caregiver notified {len(hospitals)} hospital(s) in the "
                 f"{record.get('region') or 'local'} area. Help is being dispatched.",
            severity="emergency",
        )
        return record

    def resolve(self, alert_id: str, by_role: str,
                reason: str = "") -> Dict[str, Any]:
        record = self._load(alert_id) or {}
        record["state"] = "resolved"
        record.setdefault("transitions", []).append({
            "to": "resolved", "at": _now_iso(),
            "by": by_role, "note": reason or "",
        })
        self._save(record)
        return record

    # ── timer-driven transitions (called by background worker) ─

    def maybe_prompt_hotline(self, record: Dict[str, Any]) -> bool:
        """If caregiver hasn't acted within HOTLINE_PROMPT_MIN minutes,
        mark hotline_prompted — the patient UI is listening for this
        via the /emergency/for-me endpoint and will surface the '199'
        prompt as a toast."""
        if record.get("state") != "pending":
            return False
        if _minutes_since(record["created_at"]) < HOTLINE_PROMPT_MIN:
            return False
        record["state"] = "hotline_prompted"
        record["hotline_prompted_at"] = _now_iso()
        record.setdefault("transitions", []).append({
            "to": "hotline_prompted", "at": _now_iso(),
            "by": "system:timer",
            "note": f"No caregiver response within {HOTLINE_PROMPT_MIN} minutes",
        })
        self._save(record)
        self._notify_patient_status(
            record,
            title=f"Call {HOTLINE_NUMBER} now",
            body=f"Your caregiver hasn't responded. Please call "
                 f"{HOTLINE_DISPLAY_NAME} ({HOTLINE_NUMBER}) immediately "
                 f"and stay on the line.",
            severity="emergency",
        )
        return True

    def maybe_escalate_admin(self, record: Dict[str, Any]) -> bool:
        """After ADMIN_ESCALATE_MIN minutes, elevate to admin inbox +
        log a hospital dispatch across every hospital in the patient's
        region."""
        if record.get("state") in ("resolved", "admin_escalated"):
            return False
        if _minutes_since(record["created_at"]) < ADMIN_ESCALATE_MIN:
            return False
        record["state"] = "admin_escalated"
        record["admin_escalated_at"] = _now_iso()
        record.setdefault("transitions", []).append({
            "to": "admin_escalated", "at": _now_iso(),
            "by": "system:timer",
            "note": f"Auto-escalated after {ADMIN_ESCALATE_MIN} minutes",
        })
        # Dispatch log to region hospitals (in addition to caregiver-
        # triggered dispatches that may already be present).
        already_dispatched = {
            d["hospital_id"] for d in record.get("dispatch_log") or []
        }
        for h in hospitals_for_region(record.get("region")):
            if h["id"] in already_dispatched:
                continue
            record.setdefault("dispatch_log", []).append({
                "hospital_id":   h["id"],
                "hospital_name": h["name"],
                "region":        h["region"],
                "phone":         h["phone"],
                "dispatched_at": _now_iso(),
                "dispatched_by": "system:auto_escalate",
                "channel":       "log_only",
            })
        self._save(record)
        self._notify_admins(record)
        return True

    # ── notification fanouts (inbox + SMS) ────────────────────

    def _notify_caregivers_new(self, record: Dict[str, Any]) -> None:
        try:
            from src.services.caregiver_notify import fanout_caregiver_emergency
            fanout_caregiver_emergency(
                patient_id=record["patient_id"],
                patient_name=record.get("patient_name") or "your patient",
                message=record.get("message") or "",
                alert_type=record.get("alert_type") or "emergency_triage",
            )
        except Exception as exc:
            logger.warning(f"emergency caregiver fanout failed: {exc}")
        # SMS fanout (legacy)
        try:
            from src.repositories.caregiver_repo import CaregiverRepository
            from src.services.caregiver_alerts import send_caregiver_alerts
            repo = CaregiverRepository()
            cgs  = repo.get_caregivers_for_patient(record["patient_id"]) or []
            phones = [cg.get("phone") for cg in cgs
                      if not cg.get("is_revoked")
                      and "alerts" in (cg.get("permissions") or [])
                      and cg.get("phone")]
            if phones:
                send_caregiver_alerts(
                    patient_id=record["patient_id"],
                    patient_name=record.get("patient_name") or "your patient",
                    alert_type=record.get("alert_type") or "emergency_triage",
                    caregiver_phones=phones,
                    severity="emergency",
                    message=record.get("message") or "",
                )
        except Exception as exc:
            logger.warning(f"emergency SMS fanout failed: {exc}")

    def _notify_patient_status(
        self, record: Dict[str, Any], *,
        title: str, body: str, severity: str = "info",
    ) -> None:
        try:
            from src.services import inbox_service
            inbox_service.create_item(
                patient_id=record["patient_id"],
                kind="alert" if severity == "emergency" else "notification",
                title=title, body=body, severity=severity,
                source="system", source_id=f"emergency:{record['alert_id']}",
                action_url="/emergency",
                metadata={"alert_id": record["alert_id"],
                          "event":    f"emergency.{record.get('state')}"},
                ttl_days=30,
            )
        except Exception as exc:
            logger.warning(f"patient status notify failed: {exc}")

    def _notify_admins(self, record: Dict[str, Any]) -> None:
        """Drop an emergency inbox item into EVERY admin account's
        inbox so at least one operator picks it up. Uses the same
        inbox store; the admin UI polls /caregiver/inbox/list with its
        admin JWT (which our caregiver-inbox route already accepts)."""
        admin_ids = self._list_admin_ids()
        if not admin_ids:
            logger.info("emergency admin escalation: no admins configured")
            return
        hospitals = hospitals_for_region(record.get("region"))
        region    = record.get("region") or "local area"
        body = (
            f"Auto-escalated after {ADMIN_ESCALATE_MIN} minutes with no "
            f"resolution. Patient: {record.get('patient_name') or record['patient_id']}. "
            f"Message: {(record.get('message') or '').strip()[:240]}\n\n"
            f"Region: {region}. {len(hospitals)} hospital(s) auto-dispatched."
        )
        try:
            from src.services import inbox_service
            for aid in admin_ids:
                try:
                    inbox_service.create_item(
                        patient_id=aid,
                        kind="alert",
                        title=f"⚠ EMERGENCY escalated — {record.get('patient_name')}",
                        body=body,
                        severity="emergency",
                        source="system",
                        source_id=f"emergency:{record['alert_id']}",
                        action_url="/admin/emergencies",
                        metadata={
                            "alert_id": record["alert_id"],
                            "event":    "emergency.admin_escalated",
                            "hospitals": [h["id"] for h in hospitals],
                        },
                        ttl_days=60,
                    )
                except Exception as exc:
                    logger.warning(f"admin notify {aid} failed: {exc}")
        except Exception as exc:
            logger.warning(f"admin escalation failed: {exc}")

    @staticmethod
    def _list_admin_ids() -> List[str]:
        """Pull admin owner ids from whatever admin store the backend
        uses. We support two common shapes:
          1. ADMIN_INBOX_IDS env var, comma-separated.
          2. ADMIN_PATIENT_EMAILS env var — reuse the admin-patient
             allowlist so admin-patients get emergency-admin pings too."""
        ids: List[str] = []
        try:
            raw = os.getenv("ADMIN_INBOX_IDS", "") or ""
            ids += [x.strip() for x in raw.split(",") if x.strip()]
        except Exception:
            pass
        # Admin-patients — resolve email → patient_id
        try:
            emails_raw = os.getenv("ADMIN_PATIENT_EMAILS", "") or ""
            emails = [e.strip().lower() for e in emails_raw.split(",") if e.strip()]
            if emails:
                try:
                    from src.services.auth import _sql, extract_rows  # type: ignore
                except Exception:
                    from src.services.auth import _sql  # type: ignore
                    extract_rows = None
                for em in emails:
                    try:
                        resp = _sql(
                            "SELECT id FROM PatientVertex WHERE email = :em LIMIT 1",
                            {"em": em},
                        )
                        rows = (extract_rows(resp) if extract_rows
                                else (resp or {}).get("result", []))
                        if rows and rows[0].get("id"):
                            ids.append(rows[0]["id"])
                    except Exception:
                        continue
        except Exception:
            pass
        # De-dupe while preserving order
        return list(dict.fromkeys(ids))

    # ── background worker tick ───────────────────────────────────

    def tick(self) -> Dict[str, int]:
        """Advance escalation timers for every active alert. Returns a
        small summary dict so the caller can log volumes."""
        summary = {"checked": 0, "prompted": 0, "escalated": 0}
        for rec in self.list_active():
            summary["checked"] += 1
            try:
                if self.maybe_prompt_hotline(rec):
                    summary["prompted"] += 1
                # Reload after state change in case maybe_prompt moved it.
                rec = self._load(rec["alert_id"]) or rec
                if self.maybe_escalate_admin(rec):
                    summary["escalated"] += 1
            except Exception as exc:
                logger.warning(f"emergency tick failed for "
                               f"{rec.get('alert_id')}: {exc}")
        return summary
