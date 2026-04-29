"""
Observatory Role-Based Access Control (RBAC)
=============================================

Different MoH staff levels get different data access in the Observatory.
This is aggregate health data only — never individual patient records.

Access levels:
  national  → PS, Directors, Deputy Directors
  regional  → RHDs, PPHOs, PHC Coordinators, M&E Officers
  facility  → Medical Officers, Nurses, Pharmacists
  data_entry→ Data Officers, CHNs, Health Educators
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


OBSERVATORY_ACCESS_LEVELS: Dict[str, Dict[str, Any]] = {
    "national": {
        "description": "National-level aggregate health data",
        "roles": [
            "permanent_secretary",
            "director",
            "deputy_director",
        ],
        "can_view": {
            "national_dashboard": True,
            "all_regions": True,
            "all_facilities": True,
            "trend_analysis": True,
            "export_data": True,
            "comparative_reports": True,
            "outbreak_alerts": True,
            "workforce_stats": True,
        },
        "cannot_view": {
            "individual_patient_records": True,
            "patient_names": True,
            "patient_phone_numbers": True,
            "consultation_transcripts": True,
        },
    },
    "regional": {
        "description": "Regional aggregate data for assigned region(s)",
        "roles": [
            "regional_health_director",
            "ppho",
            "phc_coordinator",
            "m_and_e_officer",
        ],
        "can_view": {
            "regional_dashboard": True,
            "own_region_facilities": True,
            "own_region_trends": True,
            "export_own_region": True,
            "facility_performance": True,
            "chw_activity_summary": True,
            "outbreak_alerts_own_region": True,
        },
        "cannot_view": {
            "other_regions": True,
            "national_totals": False,
            "individual_patient_records": True,
        },
    },
    "facility": {
        "description": "Facility-level aggregate data",
        "roles": [
            "medical_officer",
            "senior_nursing_officer",
            "nursing_officer",
            "pharmacist",
        ],
        "can_view": {
            "facility_dashboard": True,
            "own_facility_stats": True,
            "patient_count_aggregate": True,
            "medication_stock_levels": True,
            "referral_statistics": True,
        },
        "cannot_view": {
            "other_facilities": True,
            "regional_data": True,
            "national_data": True,
            "individual_records": True,
        },
    },
    "data_entry": {
        "description": "Can submit data but limited viewing",
        "roles": [
            "data_officer",
            "health_educator",
            "chn",
            "environmental_health_officer",
        ],
        "can_view": {
            "own_submissions": True,
            "own_facility_summary": True,
        },
        "can_submit": {
            "monthly_facility_report": True,
            "disease_notification": True,
            "stock_report": True,
        },
        "cannot_view": {
            "aggregate_dashboards": True,
            "other_facilities": True,
            "export": True,
        },
    },
}


DATA_CLASSIFICATION = {
    "aggregate_safe": [
        "total_consultations_per_region",
        "hypertension_prevalence_percentage",
        "diabetes_screening_rate",
        "average_bp_readings_per_facility",
        "medication_stock_levels",
        "chw_visit_counts",
        "referral_counts_per_month",
        "age_group_distribution",
        "gender_distribution",
        "condition_prevalence_by_region",
        "seasonal_trend_data",
        "outbreak_alert_counts",
    ],
    "pii_restricted": [
        "patient_name",
        "patient_phone",
        "patient_address",
        "patient_nin",
        "individual_consultation_text",
        "individual_vital_readings",
        "medication_history_per_patient",
        "caregiver_identity",
    ],
    "minimum_aggregation": {
        "description": (
            "Never show data where the group size is less than "
            "5 individuals — risk of re-identification in small villages"
        ),
        "threshold": 5,
        "action": "show as '< 5' instead of exact number",
    },
}


# ── Hierarchy rank for comparison ──

_LEVEL_RANK = {"national": 4, "regional": 3, "facility": 2, "data_entry": 1}


def resolve_access(
    role: str,
    region: Optional[str] = None,
    facility: Optional[str] = None,
) -> Dict[str, Any]:
    """Build the full access descriptor for a given role."""
    from src.models.gov_auth import access_level_for_role, HealthRegion

    level = access_level_for_role(role)
    spec = OBSERVATORY_ACCESS_LEVELS.get(level, OBSERVATORY_ACCESS_LEVELS["data_entry"])

    all_regions = [r.value for r in HealthRegion]

    access = {
        "access_level": level,
        "can_view_national": level == "national",
        "can_view_regional": level in ("national", "regional"),
        "regions_accessible": all_regions if level == "national" else (
            [region] if region else []
        ),
        "can_export": level in ("national", "regional"),
        "can_view_facility_detail": level in ("national", "regional", "facility"),
        "pii_access": False,
        "can_submit_data": level == "data_entry",
        "permissions": spec.get("can_view", {}),
    }

    if facility and level in ("facility", "data_entry"):
        access["facility"] = facility

    return access


def check_region_access(
    officer_access: Dict[str, Any],
    requested_region: str,
) -> bool:
    if officer_access.get("can_view_national"):
        return True
    return requested_region in officer_access.get("regions_accessible", [])


def check_data_field(
    field_name: str,
    officer_access: Dict[str, Any],
) -> bool:
    if field_name in DATA_CLASSIFICATION["pii_restricted"]:
        return False
    return True


def apply_k_anonymity(value: int, threshold: int = 5) -> str:
    if value < threshold:
        return f"< {threshold}"
    return str(value)
