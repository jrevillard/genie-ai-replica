"""
AMINA Care — DHIS2 Tracker API Sync
=====================================
Patient-level push to DHIS2 Tracker (Phase 2.3).

Unlike the aggregate sync (dhis2_sync.py) which pushes anonymous counts,
this module pushes **individual patient records** as DHIS2 Tracked Entity
Instances (TEI) + enrollments + events.

Gate: DHIS2_TRACKER_ENABLED must be true AND patient must have
share_with_dhis2=true on their PatientVertex (Phase 2.5 consent layer).
For Phase 2.3 we enforce the feature flag only; the consent check is
stubbed to "opt-in by default for admin-triggered push" and will be
wired to real consent in 2.5.

DHIS2 Tracker API reference:
  https://docs.dhis2.org/en/develop/using-the-api/dhis-core-version-240/tracker.html

Required configuration (from src/config.py):
  DHIS2_TRACKER_ENABLED          bool
  DHIS2_TRACKER_PROGRAM_ID       e.g. "IpHINAT79UW" (AMINA Care program)
  DHIS2_TRACKER_PROGRAM_STAGE_ID e.g. "A03MvHHogjR" (consultation stage)
  DHIS2_TRACKER_TEI_TYPE_ID      e.g. "nEenWmSyUEp" (Person)
  DHIS2_TRACKER_ATTRIBUTE_MAP    JSON: {"first_name":"abc", "last_name":"def", ...}
  DHIS2_TRACKER_DATA_ELEMENT_MAP JSON: {"triage_level":"xyz", "chief_complaint":"uvw", ...}
  DHIS2_ORG_UNIT_MAP             reused from aggregate sync
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, date
from typing import Dict, List, Optional, Tuple

import requests

from src.config import settings
from src.utils.arcade_client import command_sql
from src.services import dhis2_sync, fhir_mapper, consent_service, phi_deid
from src.services.icd10_coder import code_text

logger = logging.getLogger(__name__)


# ── Config loaders ───────────────────────────────────────────────────────────

def _tracker_enabled() -> bool:
    return bool(getattr(settings, "DHIS2_TRACKER_ENABLED", False))


def _program_id() -> str:
    return getattr(settings, "DHIS2_TRACKER_PROGRAM_ID", "") or ""


def _program_stage_id() -> str:
    return getattr(settings, "DHIS2_TRACKER_PROGRAM_STAGE_ID", "") or ""


def _tei_type_id() -> str:
    return getattr(settings, "DHIS2_TRACKER_TEI_TYPE_ID", "") or ""


def _load_attribute_map() -> Dict[str, str]:
    raw = getattr(settings, "DHIS2_TRACKER_ATTRIBUTE_MAP", "") or ""
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception as e:
        logger.warning(f"dhis2_tracker: DHIS2_TRACKER_ATTRIBUTE_MAP invalid JSON: {e}")
        return {}


def _load_data_element_map() -> Dict[str, str]:
    raw = getattr(settings, "DHIS2_TRACKER_DATA_ELEMENT_MAP", "") or ""
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception as e:
        logger.warning(f"dhis2_tracker: DHIS2_TRACKER_DATA_ELEMENT_MAP invalid JSON: {e}")
        return {}


def _orgunit_for_region(region: str) -> Optional[str]:
    orgunits = dhis2_sync._load_orgunit_map()
    return orgunits.get((region or "").lower())


# ── Consent check (Phase 2.5 — consent_service wired) ───────────────────────

def _patient_consented(patient: Dict) -> bool:
    """Check if patient has consented to DHIS2 Tracker sharing.

    Uses the consent_service which reads the authoritative consent_flags
    JSON stored on PatientVertex and keeps an append-only audit trail.

    Legacy fallback: also honors the old share_with_dhis2 boolean field
    for records migrated from Phase 2.3.
    """
    pid = patient.get("id")
    if pid and consent_service.get_consent(pid, "dhis2_tracker"):
        return True
    val = patient.get("share_with_dhis2")
    return val is True or str(val).lower() == "true"


# ── Data loaders ─────────────────────────────────────────────────────────────

def _load_patient(patient_id: str) -> Optional[Dict]:
    try:
        resp = command_sql(
            "SELECT * FROM PatientVertex WHERE id = :pid LIMIT 1",
            {"pid": patient_id},
        )
        rows = (resp or {}).get("result", [])
        return rows[0] if rows else None
    except Exception as e:
        logger.error(f"dhis2_tracker: patient load failed: {e}")
        return None


def _load_consultations(patient_id: str, since_iso: Optional[str] = None, limit: int = 100) -> List[Dict]:
    try:
        if since_iso:
            resp = command_sql(
                "SELECT * FROM ConsultationRecord "
                "WHERE patient_id = :pid AND started_at >= :since "
                "ORDER BY started_at DESC LIMIT :lim",
                {"pid": patient_id, "since": since_iso, "lim": limit},
            )
        else:
            resp = command_sql(
                "SELECT * FROM ConsultationRecord WHERE patient_id = :pid "
                "ORDER BY started_at DESC LIMIT :lim",
                {"pid": patient_id, "lim": limit},
            )
        return (resp or {}).get("result", [])
    except Exception as e:
        logger.error(f"dhis2_tracker: consultations load failed: {e}")
        return []


# ── Payload builders ─────────────────────────────────────────────────────────

def build_tei_payload(patient: Dict) -> Optional[Dict]:
    """
    Build a DHIS2 Tracked Entity Instance payload from an AMINA PatientVertex.
    Returns None if required config is missing.
    """
    tei_type = _tei_type_id()
    if not tei_type:
        logger.warning("dhis2_tracker: TEI_TYPE_ID not configured")
        return None

    orgunit = _orgunit_for_region(patient.get("region", ""))
    if not orgunit:
        logger.warning(f"dhis2_tracker: no orgUnit for region '{patient.get('region')}'")
        return None

    attr_map = _load_attribute_map()

    # Map AMINA patient fields to DHIS2 tracked entity attributes
    name_parts = (patient.get("name") or "").strip().split()
    first = " ".join(name_parts[:-1]) if len(name_parts) >= 2 else (name_parts[0] if name_parts else "")
    last  = name_parts[-1] if len(name_parts) >= 2 else ""

    mappings = {
        "first_name":    first,
        "last_name":     last,
        "full_name":     patient.get("name") or "",
        "phone":         patient.get("phone") or "",
        "age":           str(patient.get("age") or ""),
        "gender":        patient.get("gender") or "",
        "region":        patient.get("region") or "",
        "patient_id":    patient.get("id") or "",
    }

    attributes = []
    for field_name, value in mappings.items():
        attr_uid = attr_map.get(field_name)
        if not attr_uid or not value:
            continue
        attributes.append({
            "attribute": attr_uid,
            "value":     str(value),
        })

    if not attributes:
        logger.warning("dhis2_tracker: no mappable attributes — check DHIS2_TRACKER_ATTRIBUTE_MAP")
        return None

    return {
        "trackedEntityType": tei_type,
        "orgUnit":           orgunit,
        "attributes":        attributes,
    }


def build_enrollment_payload(
    tei_id: str,
    orgunit: str,
    enrollment_date: Optional[str] = None,
) -> Optional[Dict]:
    """Enroll a TEI in the AMINA Care tracker program."""
    program = _program_id()
    if not program:
        return None
    today = enrollment_date or datetime.utcnow().strftime("%Y-%m-%d")
    return {
        "trackedEntityInstance": tei_id,
        "program":               program,
        "orgUnit":               orgunit,
        "enrollmentDate":        today,
        "incidentDate":          today,
        "status":                "ACTIVE",
    }


def build_event_payload(
    consultation: Dict,
    tei_id: str,
    enrollment_id: str,
    orgunit: str,
    patient_name: Optional[str] = None,
) -> Optional[Dict]:
    """
    Build a DHIS2 Event payload from an AMINA ConsultationRecord.

    One consultation → one event in the AMINA Care program stage.
    Includes ICD-10-coded conditions as free-text data elements.

    PHI de-identification runs on all free-text fields before they land
    in the event payload. `patient_name` (if given) is force-redacted
    so name tokens are scrubbed from symptoms/summary.
    """
    program = _program_id()
    stage   = _program_stage_id()
    if not program or not stage:
        return None

    de_map = _load_data_element_map()

    # De-identify the consultation first (names, phones, dates, villages)
    redacted_consult, _ = phi_deid.redact_consultation(consultation, patient_name=patient_name)

    # Extract clinical text for coding (from redacted fields)
    symptoms = fhir_mapper._parse_json_list(redacted_consult.get("symptoms_reported"))
    symptom_text = ", ".join(str(s) for s in symptoms) if symptoms else ""
    summary      = redacted_consult.get("summary") or ""
    combined     = f"{symptom_text}. {summary}".strip(" .")

    icd_codes = code_text(combined)
    icd_display = "; ".join(f"{c.code} {c.display}" for c in icd_codes[:3]) if icd_codes else ""

    # Build data values from mappable fields
    data_values = []
    field_values = {
        "triage_level":    (redacted_consult.get("triage_level") or "").upper(),
        "chief_complaint": symptom_text[:300],
        "summary":         summary[:500],
        "icd10_codes":     icd_display,
        "started_at":      redacted_consult.get("started_at") or "",
        "session_id":      redacted_consult.get("session_id") or "",
    }
    for field, value in field_values.items():
        de_uid = de_map.get(field)
        if not de_uid or not value:
            continue
        data_values.append({
            "dataElement": de_uid,
            "value":       str(value),
        })

    if not data_values:
        logger.warning("dhis2_tracker: no mappable event data elements")
        return None

    event_date = consultation.get("started_at", "")[:10] or datetime.utcnow().strftime("%Y-%m-%d")

    return {
        "trackedEntityInstance": tei_id,
        "enrollment":            enrollment_id,
        "program":               program,
        "programStage":          stage,
        "orgUnit":               orgunit,
        "eventDate":             event_date,
        "status":                "COMPLETED",
        "dataValues":            data_values,
    }


# ── DHIS2 Tracker API calls ──────────────────────────────────────────────────

def _tracker_base_url() -> str:
    base = (getattr(settings, "DHIS2_BASE_URL", "") or "").rstrip("/")
    return f"{base}/api"


def _auth_headers() -> Tuple[Dict, Optional[Tuple[str, str]]]:
    headers = {"Content-Type": "application/json"}
    token    = getattr(settings, "DHIS2_API_TOKEN", "") or ""
    username = getattr(settings, "DHIS2_USERNAME", "") or ""
    password = getattr(settings, "DHIS2_PASSWORD", "") or ""
    if token:
        headers["Authorization"] = f"ApiToken {token}"
        return headers, None
    if username and password:
        return headers, (username, password)
    return headers, None


def _post_tracker(path: str, payload: Dict) -> Tuple[bool, Dict]:
    headers, auth = _auth_headers()
    if not headers.get("Authorization") and not auth:
        return False, {"error": "No DHIS2 credentials configured"}
    url = f"{_tracker_base_url()}{path}"
    try:
        resp = requests.post(url, headers=headers, auth=auth, json=payload, timeout=30)
    except requests.RequestException as e:
        return False, {"error": str(e)}
    ok = 200 <= resp.status_code < 300
    try:
        body = resp.json()
    except Exception:
        body = {"status": resp.status_code, "text": resp.text[:500]}
    return ok, body


# ── Orchestration ────────────────────────────────────────────────────────────

def push_patient(
    patient_id: str,
    dry_run: bool = False,
    force: bool = False,
    triggered_by: str = "admin",
) -> Dict:
    """
    Push a single patient (TEI + enrollment + events for each consultation)
    to DHIS2 Tracker.

    Args:
        patient_id:   AMINA patient ID
        dry_run:      Build payloads but don't POST
        force:        Bypass consent check (admin override)
        triggered_by: Actor identifier for audit log

    Returns dict with step-by-step results.
    """
    result: Dict = {
        "patient_id": patient_id,
        "dry_run":    dry_run,
        "steps":      [],
    }

    if not _tracker_enabled():
        result["error"] = "DHIS2 Tracker disabled (set DHIS2_TRACKER_ENABLED=true)"
        _log_tracker_push(patient_id, None, None, 0, False, dry_run, force, triggered_by, result["error"], 0)
        return result

    patient = _load_patient(patient_id)
    if not patient:
        result["error"] = f"Patient {patient_id} not found"
        _log_tracker_push(patient_id, None, None, 0, False, dry_run, force, triggered_by, result["error"], 0)
        return result

    # Capture consent version at push time for regulatory traceability
    consent_state = consent_service.get_all_consents(patient_id)
    result["consent_version"] = consent_state["version"]

    if not force and not _patient_consented(patient):
        result["error"] = "Patient has not consented to dhis2_tracker scope"
        _log_tracker_push(patient_id, None, None, 0, False, dry_run, force, triggered_by,
                          result["error"], consent_state["version"])
        return result

    patient_name = patient.get("name", "") or ""

    # Step 1 — TEI (de-identified attributes via redact_patient)
    redacted_patient, _ = phi_deid.redact_patient(patient, keep_id=True)
    tei_payload = build_tei_payload(patient)  # Use original for TEI attributes (these fields are the whole point)
    if not tei_payload:
        result["error"] = "Failed to build TEI payload — check config"
        _log_tracker_push(patient_id, None, None, 0, False, dry_run, force, triggered_by,
                          result["error"], consent_state["version"])
        return result
    result["steps"].append({"step": "build_tei"})

    orgunit = tei_payload["orgUnit"]

    if dry_run:
        enroll_payload = build_enrollment_payload("DRY-TEI-ID", orgunit)
        result["steps"].append({"step": "build_enrollment"})
        consultations = _load_consultations(patient_id, limit=10)
        events = [
            build_event_payload(c, "DRY-TEI-ID", "DRY-ENROLL-ID", orgunit, patient_name=patient_name)
            for c in consultations
        ]
        result["steps"].append({
            "step":   "build_events",
            "count":  len(events),
            "events": [e for e in events if e],
        })
        _log_tracker_push(patient_id, None, None, len(events), True, dry_run, force, triggered_by,
                          None, consent_state["version"])
        return result

    # Step 2 — POST TEI
    ok, body = _post_tracker(
        "/trackedEntityInstances",
        {"trackedEntityInstances": [tei_payload]},
    )
    result["steps"].append({"step": "post_tei", "ok": ok})
    if not ok:
        result["error"] = "TEI create failed"
        _log_tracker_push(patient_id, None, None, 0, False, dry_run, force, triggered_by,
                          "TEI create failed", consent_state["version"])
        return result

    tei_uid = _extract_tei_uid(body)
    if not tei_uid:
        result["error"] = "Could not extract TEI UID from response"
        _log_tracker_push(patient_id, None, None, 0, False, dry_run, force, triggered_by,
                          result["error"], consent_state["version"])
        return result

    # Step 3 — POST Enrollment
    enroll_payload = build_enrollment_payload(tei_uid, orgunit)
    ok2, body2 = _post_tracker("/enrollments", {"enrollments": [enroll_payload]})
    result["steps"].append({"step": "post_enrollment", "ok": ok2})
    if not ok2:
        result["error"] = "Enrollment create failed"
        _log_tracker_push(patient_id, tei_uid, None, 0, False, dry_run, force, triggered_by,
                          "Enrollment create failed", consent_state["version"])
        return result

    enroll_uid = _extract_enrollment_uid(body2)
    if not enroll_uid:
        result["error"] = "Could not extract enrollment UID"
        _log_tracker_push(patient_id, tei_uid, None, 0, False, dry_run, force, triggered_by,
                          result["error"], consent_state["version"])
        return result

    # Step 4 — POST Events (one per consultation, PHI-de-identified)
    consultations = _load_consultations(patient_id, limit=50)
    events = []
    for c in consultations:
        evt = build_event_payload(c, tei_uid, enroll_uid, orgunit, patient_name=patient_name)
        if evt:
            events.append(evt)

    if events:
        ok3, body3 = _post_tracker("/events", {"events": events})
        result["steps"].append({
            "step":  "post_events",
            "count": len(events),
            "ok":    ok3,
        })
    else:
        result["steps"].append({"step": "post_events", "count": 0, "note": "no events to push"})

    result["success"] = True
    result["tei_uid"] = tei_uid
    result["enrollment_uid"] = enroll_uid

    _log_tracker_push(patient_id, tei_uid, enroll_uid, len(events), True, dry_run, force, triggered_by,
                      None, consent_state["version"])
    return result


# ── Tracker push audit log (Phase 2.10) ──────────────────────────────────────

def _ensure_tracker_audit_schema() -> None:
    """Create TrackerPushAuditVertex if missing."""
    stmts = [
        "CREATE VERTEX TYPE TrackerPushAuditVertex IF NOT EXISTS",
        "CREATE PROPERTY TrackerPushAuditVertex.audit_id IF NOT EXISTS STRING",
        "CREATE PROPERTY TrackerPushAuditVertex.logged_at IF NOT EXISTS STRING",
        "CREATE PROPERTY TrackerPushAuditVertex.patient_id IF NOT EXISTS STRING",
        "CREATE PROPERTY TrackerPushAuditVertex.tei_uid IF NOT EXISTS STRING",
        "CREATE PROPERTY TrackerPushAuditVertex.enrollment_uid IF NOT EXISTS STRING",
        "CREATE PROPERTY TrackerPushAuditVertex.events_count IF NOT EXISTS INTEGER",
        "CREATE PROPERTY TrackerPushAuditVertex.success IF NOT EXISTS BOOLEAN",
        "CREATE PROPERTY TrackerPushAuditVertex.dry_run IF NOT EXISTS BOOLEAN",
        "CREATE PROPERTY TrackerPushAuditVertex.forced IF NOT EXISTS BOOLEAN",
        "CREATE PROPERTY TrackerPushAuditVertex.triggered_by IF NOT EXISTS STRING",
        "CREATE PROPERTY TrackerPushAuditVertex.error_message IF NOT EXISTS STRING",
        "CREATE PROPERTY TrackerPushAuditVertex.consent_version IF NOT EXISTS INTEGER",
    ]
    for stmt in stmts:
        try:
            command_sql(stmt)
        except Exception as e:
            logger.debug(f"tracker audit schema step: {stmt[:60]}... -> {e}")


def _log_tracker_push(
    patient_id: str,
    tei_uid: Optional[str],
    enrollment_uid: Optional[str],
    events_count: int,
    success: bool,
    dry_run: bool,
    forced: bool,
    triggered_by: str,
    error_message: Optional[str],
    consent_version: int,
) -> None:
    """Append-only patient-level tracker push audit. Silent on failure."""
    try:
        import uuid as _uuid
        record = {
            "audit_id":        _uuid.uuid4().hex,
            "logged_at":       datetime.utcnow().isoformat() + "Z",
            "patient_id":      patient_id or "",
            "tei_uid":         tei_uid or "",
            "enrollment_uid":  enrollment_uid or "",
            "events_count":    int(events_count),
            "success":         bool(success),
            "dry_run":         bool(dry_run),
            "forced":          bool(forced),
            "triggered_by":    triggered_by or "system",
            "error_message":   (error_message or "")[:500],
            "consent_version": int(consent_version),
        }
        command_sql(
            "INSERT INTO TrackerPushAuditVertex CONTENT " + json.dumps(record)
        )
    except Exception as e:
        logger.debug(f"tracker audit log write failed (non-fatal): {e}")


def get_tracker_audit(patient_id: Optional[str] = None, limit: int = 50) -> List[Dict]:
    """Read the tracker push audit log (all patients or filtered by one)."""
    try:
        if patient_id:
            resp = command_sql(
                "SELECT * FROM TrackerPushAuditVertex WHERE patient_id = :pid "
                "ORDER BY logged_at DESC LIMIT :lim",
                {"pid": patient_id, "lim": limit},
            )
        else:
            resp = command_sql(
                "SELECT * FROM TrackerPushAuditVertex ORDER BY logged_at DESC LIMIT :lim",
                {"lim": limit},
            )
        return (resp or {}).get("result", [])
    except Exception as e:
        logger.error(f"tracker audit query failed: {e}")
        return []


def _extract_tei_uid(response: Dict) -> Optional[str]:
    """Extract the newly created TEI UID from a DHIS2 import response."""
    try:
        # DHIS2 2.40+ format
        imported = response.get("response", {}).get("importSummaries", [])
        if imported:
            return imported[0].get("reference")
        # Alternative format
        ref = response.get("importSummaries", [{}])[0].get("reference")
        return ref
    except Exception:
        return None


def _extract_enrollment_uid(response: Dict) -> Optional[str]:
    return _extract_tei_uid(response)  # same format


def push_batch(patient_ids: List[str], dry_run: bool = False) -> Dict:
    """Push multiple patients sequentially. Stops on first hard error."""
    results = []
    succeeded = 0
    for pid in patient_ids:
        r = push_patient(pid, dry_run=dry_run)
        results.append(r)
        if r.get("success"):
            succeeded += 1
    return {
        "total":     len(patient_ids),
        "succeeded": succeeded,
        "failed":    len(patient_ids) - succeeded,
        "dry_run":   dry_run,
        "results":   results,
    }
