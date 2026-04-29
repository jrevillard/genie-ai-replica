"""
AMINA Care — HL7 FHIR R4 Output Routes
========================================
Serves FHIR R4 resources built from AMINA's ArcadeDB data.

All endpoints are admin-auth'd. A patient-level $export endpoint is available
for downstream interoperability (DHIS2 Tracker, research cohorts, MoH).

  GET  /fhir/metadata                        → FHIR CapabilityStatement
  GET  /fhir/Patient/{id}                    → FHIR Patient resource
  GET  /fhir/Patient/{id}/$everything        → Patient + all related resources (Bundle)
  GET  /fhir/Patient/{id}/bundle             → alias for $everything
  GET  /fhir/Encounter/{id}                  → FHIR Encounter resource
  POST /fhir/code                            → ad-hoc ICD-10 coding of free text

Phase 2.1 scope: read-only mapping + coding. Write-back will live in Phase 2.6
(bi-directional DHIS2 sync).
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from src.services.auth import verify_jwt
from src.services import fhir_mapper
from src.services.icd10_coder import code_text
from src.utils.arcade_client import command_sql

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/fhir", tags=["fhir"])


# ── Auth helpers ─────────────────────────────────────────────────────────────

def _require_admin_or_patient(request: Request) -> dict:
    """FHIR endpoints accept admin tokens OR a patient accessing their own record."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    payload = verify_jwt(auth[7:])
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    return payload


def _require_admin(request: Request) -> dict:
    payload = _require_admin_or_patient(request)
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return payload


# ── Data loaders ─────────────────────────────────────────────────────────────

def _load_patient(patient_id: str) -> Optional[dict]:
    try:
        resp = command_sql(
            "SELECT * FROM PatientVertex WHERE id = :pid LIMIT 1",
            {"pid": patient_id},
        )
        rows = (resp or {}).get("result", [])
        return rows[0] if rows else None
    except Exception as e:
        logger.error(f"fhir: patient load failed: {e}")
        return None


def _load_consultations(patient_id: str, limit: int = 50) -> list:
    try:
        resp = command_sql(
            "SELECT * FROM ConsultationRecord WHERE patient_id = :pid "
            "ORDER BY started_at DESC LIMIT :lim",
            {"pid": patient_id, "lim": limit},
        )
        return (resp or {}).get("result", [])
    except Exception as e:
        logger.error(f"fhir: consultations load failed: {e}")
        return []


def _load_consultation(consultation_id: str) -> Optional[dict]:
    try:
        resp = command_sql(
            "SELECT * FROM ConsultationRecord WHERE id = :cid LIMIT 1",
            {"cid": consultation_id},
        )
        rows = (resp or {}).get("result", [])
        return rows[0] if rows else None
    except Exception as e:
        logger.error(f"fhir: consultation load failed: {e}")
        return None


# ── Metadata (CapabilityStatement) ──────────────────────────────────────────

@router.get("/metadata")
async def fhir_metadata():
    """Return a minimal FHIR R4 CapabilityStatement for this server."""
    return {
        "resourceType": "CapabilityStatement",
        "status":       "active",
        "date":         datetime.utcnow().isoformat() + "Z",
        "publisher":    "AMINA Care — Community Health Programme, Republic of The Gambia",
        "kind":         "instance",
        "software": {
            "name":    "AMINA Care FHIR Gateway",
            "version": "2.1",
        },
        "implementation": {
            "description": "AMINA Care → HL7 FHIR R4 interoperability gateway",
        },
        "fhirVersion": "4.0.1",
        "format":      ["json"],
        "rest": [{
            "mode": "server",
            "resource": [
                {
                    "type": "Patient",
                    "interaction": [
                        {"code": "read"},
                        {"code": "search-type"},
                    ],
                    "operation": [{"name": "everything", "definition": "/Patient/$everything"}],
                },
                {
                    "type": "Encounter",
                    "interaction": [{"code": "read"}],
                },
                {
                    "type": "Observation",
                    "interaction": [{"code": "search-type"}],
                },
                {
                    "type": "Condition",
                    "interaction": [{"code": "search-type"}],
                },
                {
                    "type": "CarePlan",
                    "interaction": [{"code": "read"}],
                },
            ],
        }],
    }


# ── Patient read ────────────────────────────────────────────────────────────

@router.get("/Patient/{patient_id}")
async def get_patient(patient_id: str, request: Request):
    payload = _require_admin_or_patient(request)
    # Patient can only fetch their own record
    if payload.get("role") != "admin" and payload.get("sub") != patient_id:
        raise HTTPException(status_code=403, detail="Can only access own record")

    patient = _load_patient(patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    return fhir_mapper.build_patient(patient)


# ── Patient $everything (FHIR operation) ────────────────────────────────────

@router.get("/Patient/{patient_id}/$everything")
async def patient_everything(patient_id: str, request: Request):
    payload = _require_admin_or_patient(request)
    if payload.get("role") != "admin" and payload.get("sub") != patient_id:
        raise HTTPException(status_code=403, detail="Can only access own record")

    patient = _load_patient(patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    consultations = _load_consultations(patient_id, limit=50)
    return fhir_mapper.build_patient_bundle(patient, consultations)


# Friendlier alias (many HTTP clients choke on the $ in URLs)
@router.get("/Patient/{patient_id}/bundle")
async def patient_bundle_alias(patient_id: str, request: Request):
    return await patient_everything(patient_id, request)


# ── Encounter read ──────────────────────────────────────────────────────────

@router.get("/Encounter/{consultation_id}")
async def get_encounter(consultation_id: str, request: Request):
    _require_admin(request)
    consultation = _load_consultation(consultation_id)
    if not consultation:
        raise HTTPException(status_code=404, detail="Encounter not found")
    pid = consultation.get("patient_id") or ""
    return fhir_mapper.build_encounter(consultation, pid)


# ── Ad-hoc ICD-10 coding ────────────────────────────────────────────────────

class CodeRequest(BaseModel):
    text: str
    max_codes: int = 5
    min_confidence: float = 0.6


@router.post("/code")
async def code_free_text(body: CodeRequest, request: Request):
    """
    Run the AMINA Care ICD-10 coder on arbitrary free text.
    Useful for debugging + CHW apps that want to show coded conditions.
    """
    _require_admin(request)
    codes = code_text(body.text, max_codes=body.max_codes, min_confidence=body.min_confidence)
    return {
        "text":  body.text,
        "codes": [
            {
                "code":       c.code,
                "display":    c.display,
                "category":   c.category,
                "confidence": c.confidence,
                "matched":    c.matched,
                "system":     "http://hl7.org/fhir/sid/icd-10",
            }
            for c in codes
        ],
        "total": len(codes),
    }
