"""
AMINA Care — DHIS2 Android Capture Export
============================================
Phase 2.7 — produce offline-compatible data bundles that can be imported
into the DHIS2 Android Capture app (or any Android app that speaks the
DHIS2 Tracker payload format).

Use case: CHW visits a rural village with no connectivity. Before the
visit, the CHW syncs an AMINA export bundle to their phone. The bundle
contains:
  - The patient list they're responsible for
  - Each patient's pre-built TEI + enrollment + event payloads
  - Metadata needed by the Capture app (program, stage, data elements)

On the phone, the CHW conducts the visit and the Capture app stores
updates locally. When they reconnect, Capture syncs back to DHIS2
directly (AMINA doesn't need to be in the loop for the upload path).

Scope:
  - Phase 2.7 delivers the export bundle format + endpoint
  - NOT delivered: the actual mobile sync (that lives in the DHIS2
    Android Capture app, which is the standard MoH mobile tool)

Bundle format follows DHIS2's trackerImport payload structure:
  {
    "trackedEntityInstances": [ ... ],
    "enrollments":            [ ... ],
    "events":                 [ ... ],
    "metadata":               { program, stage, attributes, dataElements }
  }
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Dict, List, Optional

from src.config import settings
from src.services import dhis2_tracker, phi_deid, consent_service
from src.utils.arcade_client import command_sql

logger = logging.getLogger(__name__)


# ── Patient list loaders ─────────────────────────────────────────────────────

def _load_patients_by_region(region: str, limit: int = 200) -> List[Dict]:
    """Load all patients in a given region, filtered by consent."""
    try:
        resp = command_sql(
            "SELECT * FROM PatientVertex WHERE region = :region LIMIT :lim",
            {"region": region.lower(), "lim": limit},
        )
        return (resp or {}).get("result", [])
    except Exception as e:
        logger.error(f"android_capture: patient load failed: {e}")
        return []


def _load_patients_by_ids(patient_ids: List[str]) -> List[Dict]:
    """Load patients by explicit ID list."""
    patients = []
    for pid in patient_ids[:500]:  # hard cap 500
        try:
            resp = command_sql(
                "SELECT * FROM PatientVertex WHERE id = :pid LIMIT 1",
                {"pid": pid},
            )
            rows = (resp or {}).get("result", [])
            if rows:
                patients.append(rows[0])
        except Exception as e:
            logger.debug(f"android_capture: load {pid} failed: {e}")
    return patients


# ── Bundle builder ───────────────────────────────────────────────────────────

def build_export_bundle(
    patients: List[Dict],
    include_unconsented: bool = False,
    redact_pii: bool = True,
) -> Dict:
    """
    Build a DHIS2 trackerImport-compatible bundle from a list of AMINA
    patient records + their consultations.

    Args:
        patients:           List of PatientVertex dicts
        include_unconsented: If False (default), skip patients without
                             dhis2_tracker consent
        redact_pii:          If True (default), run phi_deid on free text

    Returns:
        Bundle dict ready to JSON-serialize and download as .json file
    """
    teis: List[Dict] = []
    enrollments: List[Dict] = []
    events: List[Dict] = []
    skipped: List[Dict] = []
    included_count = 0

    today = datetime.utcnow().strftime("%Y-%m-%d")

    for patient in patients:
        pid = patient.get("id", "")
        if not pid:
            continue

        # Consent check
        if not include_unconsented:
            if not consent_service.get_consent(pid, "dhis2_tracker"):
                skipped.append({"patient_id": pid, "reason": "no consent"})
                continue

        tei = dhis2_tracker.build_tei_payload(patient)
        if not tei:
            skipped.append({"patient_id": pid, "reason": "TEI build failed (check config)"})
            continue

        # Use a local TEI reference since the phone will assign real UIDs on push
        local_tei_ref = f"LOCAL-TEI-{pid}"
        tei["trackedEntityInstance"] = local_tei_ref
        teis.append(tei)

        orgunit = tei["orgUnit"]

        enr = dhis2_tracker.build_enrollment_payload(local_tei_ref, orgunit, enrollment_date=today)
        if enr:
            enr["enrollment"] = f"LOCAL-ENR-{pid}"
            enrollments.append(enr)

        # Load and build events for recent consultations
        try:
            resp = command_sql(
                "SELECT * FROM ConsultationRecord WHERE patient_id = :pid "
                "ORDER BY started_at DESC LIMIT 20",
                {"pid": pid},
            )
            consultations = (resp or {}).get("result", [])
        except Exception:
            consultations = []

        patient_name = patient.get("name") if redact_pii else None

        for c in consultations:
            evt = dhis2_tracker.build_event_payload(
                c,
                tei_id=local_tei_ref,
                enrollment_id=f"LOCAL-ENR-{pid}",
                orgunit=orgunit,
                patient_name=patient_name,
            )
            if evt:
                evt["event"] = f"LOCAL-EVT-{c.get('id','') or c.get('session_id','')}"
                events.append(evt)

        included_count += 1

    return {
        "bundle_version": "1.0",
        "generated_at":   datetime.utcnow().isoformat() + "Z",
        "generator":      "AMINA Care Programme",
        "metadata": {
            "program_id":        getattr(settings, "DHIS2_TRACKER_PROGRAM_ID", "") or "",
            "program_stage_id":  getattr(settings, "DHIS2_TRACKER_PROGRAM_STAGE_ID", "") or "",
            "tei_type_id":       getattr(settings, "DHIS2_TRACKER_TEI_TYPE_ID", "") or "",
            "attribute_map":     dhis2_tracker._load_attribute_map(),
            "data_element_map":  dhis2_tracker._load_data_element_map(),
        },
        "statistics": {
            "patients_included": included_count,
            "patients_skipped":  len(skipped),
            "teis_count":        len(teis),
            "enrollments_count": len(enrollments),
            "events_count":      len(events),
        },
        "skipped":                skipped,
        "trackedEntityInstances": teis,
        "enrollments":            enrollments,
        "events":                 events,
    }


# ── Orchestration ────────────────────────────────────────────────────────────

def export_region(region: str, include_unconsented: bool = False) -> Dict:
    """Build an export bundle for all consented patients in a region."""
    patients = _load_patients_by_region(region)
    bundle = build_export_bundle(patients, include_unconsented=include_unconsented)
    bundle["filter"] = {"type": "region", "value": region}
    return bundle


def export_patient_ids(patient_ids: List[str], include_unconsented: bool = False) -> Dict:
    """Build an export bundle for an explicit list of patient IDs."""
    patients = _load_patients_by_ids(patient_ids)
    bundle = build_export_bundle(patients, include_unconsented=include_unconsented)
    bundle["filter"] = {"type": "ids", "count": len(patient_ids)}
    return bundle
