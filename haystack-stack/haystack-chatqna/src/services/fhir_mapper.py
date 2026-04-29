"""
AMINA Care — FHIR R4 Resource Mapper
======================================
Transforms AMINA PatientVertex + ConsultationRecord data into HL7 FHIR R4
resources ready for Bundle export or DHIS2 Tracker push.

Phase 2.1 scope — core resources:
  - Patient       (from PatientVertex)
  - Encounter     (from ConsultationRecord)
  - Observation   (from bp_readings, glucose_readings)
  - Condition     (ICD-10 coded from symptoms_reported / summary)
  - CarePlan      (from care_plan key_facts)

Output: FHIR R4 Bundle of type "collection" — ready to POST to any FHIR
server or bundle into a DHIS2 Tracker payload.

Design notes:
  - AMINA patient IDs are prefixed "urn:aminacare:patient:{id}"
  - Encounter IDs are "urn:aminacare:encounter:{consultation_id}"
  - All resources use provisional verification since AMINA is not a licensed
    diagnostic tool — clinical staff must confirm.
  - PHI is NOT stripped here; de-identification is a separate pipeline
    (Phase 2.4) that runs before any external push.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Dict, List, Optional

from src.services.icd10_coder import code_text, code_to_fhir_condition, ICD10_SYSTEM

logger = logging.getLogger(__name__)


AMINA_NS = "urn:aminacare"


def _patient_ref(patient_id: str) -> str:
    return f"{AMINA_NS}:patient:{patient_id}"


def _encounter_ref(consultation_id: str) -> str:
    return f"{AMINA_NS}:encounter:{consultation_id}"


def _parse_json_list(raw) -> List:
    if raw is None:
        return []
    if isinstance(raw, list):
        return raw
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


# ── Patient resource ─────────────────────────────────────────────────────────

def build_patient(patient: Dict) -> Dict:
    """Build a FHIR R4 Patient resource from a PatientVertex dict."""
    pid = patient.get("id", "")
    name_parts = (patient.get("name") or "").strip().split()
    given, family = [], ""
    if len(name_parts) >= 2:
        given = name_parts[:-1]
        family = name_parts[-1]
    elif name_parts:
        given = name_parts

    gender_map = {"male": "male", "female": "female", "other": "other"}
    gender = gender_map.get((patient.get("gender") or "").lower(), "unknown")

    resource = {
        "resourceType": "Patient",
        "id":           pid,
        "identifier": [{
            "system": f"{AMINA_NS}:patient-id",
            "value":  pid,
        }],
        "active":  True,
        "name": [{
            "use":    "official",
            "family": family,
            "given":  given,
            "text":   patient.get("name") or "",
        }],
        "gender":  gender,
    }

    # Phone
    phone = patient.get("phone")
    if phone:
        resource["telecom"] = [{
            "system": "phone",
            "value":  phone,
            "use":    "mobile",
        }]

    # Age-based birth date estimate (AMINA stores age, not DOB)
    age = patient.get("age")
    if age:
        try:
            year = datetime.utcnow().year - int(age)
            resource["birthDate"] = f"{year}-01-01"
        except Exception:
            pass

    # Region → address
    region = patient.get("region")
    if region:
        resource["address"] = [{
            "use":     "home",
            "country": "GM",
            "state":   region,
        }]

    # Preferred language
    lang = patient.get("preferred_language")
    if lang:
        resource["communication"] = [{
            "language": {"text": lang},
            "preferred": True,
        }]

    return resource


# ── Encounter resource ──────────────────────────────────────────────────────

def build_encounter(consultation: Dict, patient_id: str) -> Dict:
    """Build a FHIR R4 Encounter resource from a ConsultationRecord dict."""
    cid = consultation.get("id", "")
    triage = (consultation.get("triage_level") or "").upper()

    # Map AMINA triage levels to FHIR Encounter priority
    priority_map = {
        "EMERGENCY": ("E", "Emergency"),
        "URGENT":    ("UR", "Urgent"),
        "ROUTINE":   ("R",  "Routine"),
    }
    p_code, p_display = priority_map.get(triage, ("R", "Routine"))

    resource = {
        "resourceType": "Encounter",
        "id":           cid,
        "identifier": [{
            "system": f"{AMINA_NS}:encounter-id",
            "value":  cid,
        }],
        "status": "finished" if consultation.get("ended_at") else "in-progress",
        "class": {
            "system":  "http://terminology.hl7.org/CodeSystem/v3-ActCode",
            "code":    "VR",
            "display": "Virtual",  # AMINA is a virtual CHW consultation
        },
        "priority": {
            "coding": [{
                "system":  "http://terminology.hl7.org/CodeSystem/v3-ActPriority",
                "code":    p_code,
                "display": p_display,
            }],
        },
        "subject": {"reference": _patient_ref(patient_id)},
        "serviceProvider": {
            "display": "AMINA Care — Community Health Programme",
        },
    }

    started = consultation.get("started_at")
    ended   = consultation.get("ended_at")
    if started:
        resource["period"] = {"start": started}
        if ended:
            resource["period"]["end"] = ended

    # Reason for encounter = chief complaint / symptoms
    symptoms = consultation.get("symptoms_reported")
    if symptoms:
        if isinstance(symptoms, str):
            try:
                symptoms = json.loads(symptoms)
            except Exception:
                symptoms = [symptoms]
        if isinstance(symptoms, list) and symptoms:
            resource["reasonCode"] = [{"text": str(s)} for s in symptoms[:5]]

    return resource


# ── Observation resources (vitals) ──────────────────────────────────────────

def build_bp_observations(patient: Dict, patient_id: str) -> List[Dict]:
    """Build FHIR Observation resources from stored bp_readings."""
    readings = _parse_json_list(patient.get("bp_readings"))
    obs: List[Dict] = []
    for i, r in enumerate(readings):
        if not isinstance(r, dict):
            continue
        systolic  = r.get("systolic")
        diastolic = r.get("diastolic")
        when      = r.get("date") or r.get("timestamp") or datetime.utcnow().isoformat() + "Z"
        if systolic is None or diastolic is None:
            continue
        obs.append({
            "resourceType": "Observation",
            "id":           f"bp-{patient_id}-{i}",
            "status":       "final",
            "category": [{
                "coding": [{
                    "system":  "http://terminology.hl7.org/CodeSystem/observation-category",
                    "code":    "vital-signs",
                }],
            }],
            "code": {
                "coding": [{
                    "system":  "http://loinc.org",
                    "code":    "85354-9",
                    "display": "Blood pressure panel",
                }],
            },
            "subject":         {"reference": _patient_ref(patient_id)},
            "effectiveDateTime": when,
            "component": [
                {
                    "code": {
                        "coding": [{
                            "system":  "http://loinc.org",
                            "code":    "8480-6",
                            "display": "Systolic blood pressure",
                        }],
                    },
                    "valueQuantity": {
                        "value":  float(systolic),
                        "unit":   "mmHg",
                        "system": "http://unitsofmeasure.org",
                        "code":   "mm[Hg]",
                    },
                },
                {
                    "code": {
                        "coding": [{
                            "system":  "http://loinc.org",
                            "code":    "8462-4",
                            "display": "Diastolic blood pressure",
                        }],
                    },
                    "valueQuantity": {
                        "value":  float(diastolic),
                        "unit":   "mmHg",
                        "system": "http://unitsofmeasure.org",
                        "code":   "mm[Hg]",
                    },
                },
            ],
        })
    return obs


def build_glucose_observations(patient: Dict, patient_id: str) -> List[Dict]:
    """Build FHIR Observation resources from stored glucose_readings."""
    readings = _parse_json_list(patient.get("glucose_readings"))
    obs: List[Dict] = []
    for i, r in enumerate(readings):
        if not isinstance(r, dict):
            continue
        value = r.get("value") or r.get("mmol")
        when  = r.get("date") or r.get("timestamp") or datetime.utcnow().isoformat() + "Z"
        if value is None:
            continue
        obs.append({
            "resourceType": "Observation",
            "id":           f"glu-{patient_id}-{i}",
            "status":       "final",
            "category": [{
                "coding": [{
                    "system":  "http://terminology.hl7.org/CodeSystem/observation-category",
                    "code":    "laboratory",
                }],
            }],
            "code": {
                "coding": [{
                    "system":  "http://loinc.org",
                    "code":    "15074-8",
                    "display": "Glucose [Moles/volume] in Blood",
                }],
            },
            "subject":           {"reference": _patient_ref(patient_id)},
            "effectiveDateTime": when,
            "valueQuantity": {
                "value":  float(value),
                "unit":   "mmol/L",
                "system": "http://unitsofmeasure.org",
                "code":   "mmol/L",
            },
        })
    return obs


# ── Condition resources (ICD-10 coded) ──────────────────────────────────────

def build_conditions_from_text(
    text: str,
    patient_id: str,
    encounter_id: Optional[str] = None,
) -> List[Dict]:
    """
    Run ICD-10 coding on free text and return FHIR Condition resources.
    Used for each consultation's symptoms + summary blob.
    """
    codes = code_text(text)
    patient_ref   = _patient_ref(patient_id)
    encounter_ref = _encounter_ref(encounter_id) if encounter_id else None
    return [
        code_to_fhir_condition(c, patient_ref, encounter_ref)
        for c in codes
    ]


# ── CarePlan resource ───────────────────────────────────────────────────────

def build_care_plan(patient: Dict, patient_id: str) -> Optional[Dict]:
    """Build a FHIR CarePlan from the patient's key_facts / conditions."""
    conditions = _parse_json_list(patient.get("conditions"))
    key_facts  = _parse_json_list(patient.get("key_facts"))
    if not conditions and not key_facts:
        return None

    activities = []
    for fact in key_facts[:8]:
        activities.append({
            "detail": {
                "status": "in-progress",
                "description": str(fact)[:300],
            },
        })

    resource = {
        "resourceType": "CarePlan",
        "id":           f"careplan-{patient_id}",
        "status":       "active",
        "intent":       "plan",
        "title":        "AMINA Care — Active Care Plan",
        "subject":      {"reference": _patient_ref(patient_id)},
        "created":      datetime.utcnow().isoformat() + "Z",
        "author":       {"display": "AMINA Care Programme"},
    }

    if conditions:
        # Re-code stored conditions using ICD-10 coder
        all_codes = []
        for cond in conditions:
            name = cond.get("name") if isinstance(cond, dict) else str(cond)
            if name:
                all_codes.extend(code_text(name))
        if all_codes:
            resource["addresses"] = [
                {"display": c.display} for c in all_codes[:8]
            ]

    if activities:
        resource["activity"] = activities

    return resource


# ── Full patient bundle ─────────────────────────────────────────────────────

def build_patient_bundle(
    patient: Dict,
    consultations: Optional[List[Dict]] = None,
) -> Dict:
    """
    Build a FHIR R4 Bundle (type=collection) containing:
      - 1 Patient resource
      - N Encounter resources (one per consultation)
      - N Condition resources (ICD-10 coded from consultation text)
      - N Observation resources (bp + glucose readings)
      - 1 CarePlan resource (if key_facts present)

    This is the primary output format for AMINA → any FHIR-compatible system.
    """
    pid = patient.get("id", "")
    entries: List[Dict] = []

    # Patient
    p_res = build_patient(patient)
    entries.append({
        "fullUrl":  _patient_ref(pid),
        "resource": p_res,
    })

    # Observations
    for obs in build_bp_observations(patient, pid):
        entries.append({
            "fullUrl":  f"{AMINA_NS}:observation:{obs['id']}",
            "resource": obs,
        })
    for obs in build_glucose_observations(patient, pid):
        entries.append({
            "fullUrl":  f"{AMINA_NS}:observation:{obs['id']}",
            "resource": obs,
        })

    # Encounters + Conditions
    for c in (consultations or []):
        cid = c.get("id") or c.get("session_id") or ""
        enc = build_encounter(c, pid)
        entries.append({
            "fullUrl":  _encounter_ref(cid),
            "resource": enc,
        })

        # Aggregate clinical text for ICD-10 coding
        text_chunks = []
        symptoms = _parse_json_list(c.get("symptoms_reported"))
        text_chunks.extend(str(s) for s in symptoms)
        if c.get("summary"):
            text_chunks.append(str(c["summary"]))
        combined = " | ".join(text_chunks)

        if combined:
            for cond in build_conditions_from_text(combined, pid, cid):
                entries.append({
                    "fullUrl":  f"{AMINA_NS}:condition:{cid}:{cond['code']['coding'][0]['code']}",
                    "resource": cond,
                })

    # CarePlan
    cp = build_care_plan(patient, pid)
    if cp:
        entries.append({
            "fullUrl":  f"{AMINA_NS}:careplan:{pid}",
            "resource": cp,
        })

    return {
        "resourceType": "Bundle",
        "type":         "collection",
        "timestamp":    datetime.utcnow().isoformat() + "Z",
        "entry":        entries,
    }
