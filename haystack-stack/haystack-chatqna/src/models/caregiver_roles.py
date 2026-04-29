"""
AMINA Care — Gambian Caregiver Role Definitions
=================================================
Community health roles specific to The Gambia's health system.
Caregivers are community-selected volunteers approved by the
village head (Alkalo), not Western-style healthcare workers.
"""
from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class CaregiverRole(str, Enum):
    VHW = "vhw"
    CBC = "cbc"
    CHN = "chn"
    TBA = "tba"
    FAMILY = "family"
    SCOUT = "scout"
    ALKALO = "alkalo"


ROLE_LABELS = {
    "vhw":    "Village Health Worker",
    "cbc":    "Community Birth Companion",
    "chn":    "Community Health Nurse",
    "tba":    "Traditional Birth Attendant",
    "family": "Family Caregiver",
    "scout":  "Youth Health Scout",
    "alkalo": "Village Head (Alkalo)",
}


class CaregiverApprovalStatus(str, Enum):
    PENDING = "pending"
    ADMIN_REVIEWED = "admin_reviewed"
    ALKALO_APPROVED = "alkalo_approved"
    TRAINING_VERIFIED = "training_verified"
    ACTIVE = "active"
    SUSPENDED = "suspended"
    REVOKED = "revoked"
    REJECTED = "rejected"
    MORE_INFO_NEEDED = "more_info_needed"


GAMBIAN_HEALTH_REGIONS = [
    "Greater Banjul",
    "West Coast",
    "North Bank",
    "Lower River",
    "Central River",
    "Upper River",
    "Kanifing",
]

GAMBIAN_LANGUAGES = [
    "Mandinka", "Wolof", "Fula", "Jola",
    "Serahuli", "Manjago", "English",
]

VHW_SPECIALIZATIONS = [
    "Malaria", "NCD", "Nutrition", "MNCH",
    "TB", "HIV", "Water & Sanitation", "Mental Health",
]


REGISTRATION_REQUIREMENTS: Dict[str, Dict[str, Any]] = {
    "vhw": {
        "required_fields": [
            "full_name", "phone", "village", "health_region",
            "alkalo_name", "years_as_vhw",
            "training_completed", "training_year",
        ],
        "upload_fields": ["photo_id", "training_certificate"],
        "optional_fields": [
            "education_level", "languages_spoken",
            "specializations", "supervising_chn",
        ],
        "approval_chain": ["admin_review", "alkalo_confirmation", "chn_endorsement"],
        "approval_timeout_days": 14,
    },
    "cbc": {
        "required_fields": [
            "full_name", "phone", "village", "health_region",
            "alkalo_name", "years_as_cbc",
            "training_completed", "training_year",
        ],
        "upload_fields": ["photo_id", "training_certificate"],
        "optional_fields": [
            "education_level", "languages_spoken", "births_attended",
        ],
        "approval_chain": ["admin_review", "alkalo_confirmation"],
        "approval_timeout_days": 14,
    },
    "chn": {
        "required_fields": [
            "full_name", "phone", "health_region",
            "facility_name", "employee_id",
        ],
        "upload_fields": ["photo_id", "nursing_qualification"],
        "optional_fields": [
            "villages_supervised", "years_of_service",
        ],
        "approval_chain": ["admin_review", "facility_verification"],
        "approval_timeout_days": 7,
    },
    "tba": {
        "required_fields": [
            "full_name", "phone", "village", "health_region",
            "alkalo_name", "years_as_tba",
        ],
        "upload_fields": ["photo_id"],
        "optional_fields": [
            "education_level", "languages_spoken",
            "births_attended", "supervising_chn",
        ],
        "approval_chain": ["admin_review", "alkalo_confirmation"],
        "approval_timeout_days": 14,
    },
    "family": {
        "required_fields": [
            "full_name", "phone",
            "patient_invite_code", "relationship",
        ],
        "upload_fields": [],
        "optional_fields": ["can_read_english"],
        "approval_chain": ["patient_confirmation"],
        "approval_timeout_days": 3,
    },
    "scout": {
        "required_fields": [
            "full_name", "phone", "village", "age",
        ],
        "upload_fields": [],
        "optional_fields": [
            "guardian_name", "guardian_phone",
            "school_name", "languages_spoken",
        ],
        "approval_chain": ["admin_review"],
        "approval_timeout_days": 7,
    },
    "alkalo": {
        "required_fields": [
            "full_name", "phone", "village",
            "years_as_alkalo", "district",
        ],
        "upload_fields": ["photo_id"],
        "optional_fields": ["vdc_chairman_name"],
        "approval_chain": ["admin_review", "regional_health_verification"],
        "approval_timeout_days": 14,
    },
}


class CaregiverRegistrationRequest(BaseModel):
    role: CaregiverRole
    full_name: str
    phone: str
    pin: str = Field(..., min_length=4, max_length=4)
    village: Optional[str] = None
    health_region: Optional[str] = None
    alkalo_name: Optional[str] = None
    years_experience: Optional[int] = None
    training_completed: Optional[bool] = None
    training_year: Optional[int] = None
    education_level: Optional[str] = None
    languages_spoken: Optional[List[str]] = None
    specializations: Optional[List[str]] = None
    supervising_chn: Optional[str] = None
    facility_name: Optional[str] = None
    employee_id: Optional[str] = None
    villages_supervised: Optional[List[str]] = None
    patient_invite_code: Optional[str] = None
    relationship: Optional[str] = None
    can_read_english: Optional[bool] = None
    age: Optional[int] = None
    guardian_name: Optional[str] = None
    guardian_phone: Optional[str] = None
    school_name: Optional[str] = None
    district: Optional[str] = None
    vdc_chairman_name: Optional[str] = None
    births_attended: Optional[int] = None


class ApprovalStep(BaseModel):
    step_name: str
    completed: bool = False
    completed_at: Optional[str] = None
    completed_by: Optional[str] = None
    note: Optional[str] = None


class CaregiverApplication(BaseModel):
    registration_id: str
    caregiver_id: Optional[str] = None
    role: str
    status: str = "pending"
    full_name: str
    phone: str
    village: Optional[str] = None
    health_region: Optional[str] = None
    registration_data: Dict[str, Any] = {}
    uploaded_documents: Dict[str, str] = {}
    approval_chain: List[ApprovalStep] = []
    submitted_at: str = ""
    reviewed_at: Optional[str] = None
    reviewed_by: Optional[str] = None
    activated_at: Optional[str] = None
    rejection_reason: Optional[str] = None
    audit_log: List[Dict[str, Any]] = []


ROLE_PERMISSIONS = {
    "vhw": {
        "can_view_patients": True,
        "can_view_vitals": True,
        "can_view_medications": True,
        "can_view_consultations": True,
        "can_add_vitals": True,
        "can_create_referral": True,
        "can_view_care_plan": True,
        "can_modify_care_plan": False,
        "can_escalate_emergency": True,
        "can_view_community_data": True,
        "can_use_decision_support": True,
        "can_view_other_villages": False,
        "can_approve_caregivers": False,
        "max_patients": 200,
        "data_retention_visible": "6_months",
    },
    "cbc": {
        "can_view_patients": True,
        "can_view_vitals": True,
        "can_view_medications": True,
        "can_view_consultations": True,
        "can_add_vitals": True,
        "can_create_referral": True,
        "can_view_care_plan": True,
        "can_modify_care_plan": False,
        "can_escalate_emergency": True,
        "can_view_community_data": True,
        "can_use_decision_support": True,
        "can_view_other_villages": False,
        "can_approve_caregivers": False,
        "max_patients": 100,
        "data_retention_visible": "6_months",
    },
    "chn": {
        "can_view_patients": True,
        "can_view_vitals": True,
        "can_view_medications": True,
        "can_view_consultations": True,
        "can_add_vitals": True,
        "can_create_referral": True,
        "can_view_care_plan": True,
        "can_modify_care_plan": True,
        "can_escalate_emergency": True,
        "can_view_community_data": True,
        "can_use_decision_support": True,
        "can_view_other_villages": True,
        "can_approve_caregivers": False,
        "can_supervise_vhws": True,
        "max_patients": 2000,
        "data_retention_visible": "12_months",
    },
    "tba": {
        "can_view_patients": True,
        "can_view_vitals": True,
        "can_view_medications": True,
        "can_view_consultations": False,
        "can_add_vitals": True,
        "can_create_referral": True,
        "can_view_care_plan": True,
        "can_modify_care_plan": False,
        "can_escalate_emergency": True,
        "can_view_community_data": False,
        "can_use_decision_support": True,
        "can_view_other_villages": False,
        "can_approve_caregivers": False,
        "max_patients": 50,
        "data_retention_visible": "3_months",
    },
    "family": {
        "can_view_patients": True,
        "can_view_vitals": True,
        "can_view_medications": True,
        "can_view_consultations": False,
        "can_add_vitals": True,
        "can_create_referral": False,
        "can_view_care_plan": True,
        "can_modify_care_plan": False,
        "can_escalate_emergency": True,
        "can_view_community_data": False,
        "can_use_decision_support": False,
        "can_view_other_villages": False,
        "can_approve_caregivers": False,
        "max_patients": 5,
        "data_retention_visible": "3_months",
    },
    "scout": {
        "can_view_patients": False,
        "can_view_vitals": False,
        "can_view_medications": False,
        "can_view_consultations": False,
        "can_add_vitals": True,
        "can_create_referral": False,
        "can_view_care_plan": False,
        "can_modify_care_plan": False,
        "can_escalate_emergency": True,
        "can_view_community_data": False,
        "can_use_decision_support": False,
        "can_view_scout_missions": True,
        "can_view_scout_badges": True,
        "can_view_other_villages": False,
        "can_approve_caregivers": False,
        "max_patients": 10,
        "data_retention_visible": "1_month",
    },
    "alkalo": {
        "can_view_patients": False,
        "can_view_vitals": False,
        "can_view_medications": False,
        "can_view_consultations": False,
        "can_add_vitals": False,
        "can_create_referral": False,
        "can_view_care_plan": False,
        "can_modify_care_plan": False,
        "can_escalate_emergency": True,
        "can_view_community_data": True,
        "can_use_decision_support": False,
        "can_view_other_villages": False,
        "can_approve_caregivers": True,
        "can_view_village_report": True,
        "max_patients": 0,
        "data_retention_visible": "12_months",
    },
}
