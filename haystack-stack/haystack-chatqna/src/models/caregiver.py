"""
Caregiver Feature — Pydantic Models
====================================
Follows HL7 FHIR RelatedPerson + HIPAA minimum-necessary principle.
Caregiver is a proxy user who has patient-granted, revocable read access.
"""

from enum import Enum
from typing import List, Optional
from pydantic import BaseModel


class CaregiverRelationship(str, Enum):
    spouse   = "spouse"
    child    = "child"
    parent   = "parent"
    sibling  = "sibling"
    chw      = "chw"       # Community Health Worker
    friend   = "friend"
    other    = "other"


class CaregiverPermission(str, Enum):
    vitals        = "vitals"         # BP + glucose readings
    medications   = "medications"    # Active medication list
    consultations = "consultations"  # Consultation summaries (not full chat)
    alerts        = "alerts"         # Health alerts feed


class AlertType(str, Enum):
    high_bp           = "high_bp"
    high_glucose      = "high_glucose"
    low_glucose       = "low_glucose"
    emergency_triage  = "emergency_triage"
    missed_medication = "missed_medication"
    chw_visit         = "chw_visit"
    general           = "general"


# ── Request models ──────────────────────────────────────────────────────────

class CaregiverInviteRequest(BaseModel):
    """Patient calls this to generate a caregiver invite code."""
    permissions: List[CaregiverPermission] = [
        CaregiverPermission.vitals,
        CaregiverPermission.medications,
        CaregiverPermission.alerts,
    ]
    note: Optional[str] = None   # e.g. "For my wife Fatou"


class CaregiverRegisterRequest(BaseModel):
    """Caregiver uses invite code to register."""
    invite_code:  str
    phone:        str
    name:         str
    pin:          str            # 4-digit PIN
    relationship: CaregiverRelationship = CaregiverRelationship.other


class CaregiverLoginRequest(BaseModel):
    phone: str
    pin:   str


class CaregiverRevokeRequest(BaseModel):
    caregiver_id: str


class CaregiverAlertRequest(BaseModel):
    """Internal — sent by alert service to notify caregivers."""
    patient_id:  str
    alert_type:  AlertType
    message:     str
    severity:    str = "medium"   # low | medium | high | emergency


# ── Response models ─────────────────────────────────────────────────────────

class CaregiverProfile(BaseModel):
    caregiver_id: str
    name:         str
    phone:        str
    relationship: str
    permissions:  List[str]
    linked_at:    str


class PatientSummary(BaseModel):
    """What a caregiver is allowed to see — minimum necessary."""
    patient_id:      str
    name:            str
    age:             Optional[int]
    conditions:      List[str]
    latest_bp:       Optional[str]   # "138/88 mmHg"
    latest_glucose:  Optional[str]   # "7.2 mmol/L"
    triage_status:   Optional[str]   # MONITOR / STABLE / ELEVATED / EMERGENCY
    medications:     Optional[List[str]]
    last_updated:    Optional[str]


class AlertRecord(BaseModel):
    alert_id:    str
    alert_type:  str
    message:     str
    severity:    str
    created_at:  str
    read:        bool = False
