"""
Phone-based authentication models for the MoH Observatory.

Live primary flow: phone + 6-digit OTP + 4-digit PIN.

This module is purely additive -- it does not modify any existing
auth flow. It defines:
  - PINValidator: 4-digit PIN format & policy enforcement
  - FacilityRegistry: routing facilities for The Gambia (7 regions)
  - 3 super-admin test accounts that bypass all RBAC restrictions
  - Helpers for normalized phone lookup
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from src.models.gov_auth import HealthRegion, PhoneValidator


# ──────────────────────────────────────────────────────────────────
#  PIN VALIDATOR
# ──────────────────────────────────────────────────────────────────

class PINValidator:
    """4-digit numeric PIN validation. Length-only by design --
    multi-factor (phone + OTP + PIN + lockout) compensates for
    the small keyspace.
    """

    LENGTH = 4
    PATTERN = re.compile(r"^\d{4}$")

    @classmethod
    def validate(cls, pin: str) -> Dict[str, Any]:
        if pin is None:
            return {"valid": False, "error": "PIN required"}
        pin = str(pin).strip()
        if not pin:
            return {"valid": False, "error": "PIN required"}
        if not cls.PATTERN.match(pin):
            return {"valid": False, "error": f"PIN must be exactly {cls.LENGTH} digits"}
        return {"valid": True, "pin": pin}


# ──────────────────────────────────────────────────────────────────
#  FACILITY REGISTRY (7 regions, ~22 facilities)
#
#  Used for routing context at login -- audit log + officer "where
#  signed in from". RBAC is still driven by the staff's registered
#  region in their record, not the facility selected at login.
# ──────────────────────────────────────────────────────────────────

class FacilityRegistry:
    FACILITIES: List[Dict[str, str]] = [
        # Greater Banjul
        {"id": "EFSTH",       "name": "Edward Francis Small Teaching Hospital",
         "region": HealthRegion.REGION_1.value, "city": "Banjul"},
        {"id": "RVTH",        "name": "Royal Victoria Teaching Hospital",
         "region": HealthRegion.REGION_1.value, "city": "Banjul"},
        {"id": "MOH-HQ",      "name": "Ministry of Health Headquarters",
         "region": HealthRegion.REGION_1.value, "city": "Banjul"},
        {"id": "MOH-ICT",     "name": "ICT Unit, Ministry of Health",
         "region": HealthRegion.REGION_1.value, "city": "Banjul"},

        # Kanifing
        {"id": "SEREKUNDA",   "name": "Serekunda General Hospital",
         "region": HealthRegion.REGION_2.value, "city": "Serekunda"},
        {"id": "KANIFING",    "name": "Kanifing General Hospital",
         "region": HealthRegion.REGION_2.value, "city": "Kanifing"},
        {"id": "BAKAU",       "name": "Bakau Health Centre",
         "region": HealthRegion.REGION_2.value, "city": "Bakau"},

        # West Coast
        {"id": "BRIKAMA",     "name": "Brikama District Hospital",
         "region": HealthRegion.REGION_3.value, "city": "Brikama"},
        {"id": "BWIAM",       "name": "Bwiam General Hospital",
         "region": HealthRegion.REGION_3.value, "city": "Bwiam"},
        {"id": "SUKUTA",      "name": "Sukuta Health Centre",
         "region": HealthRegion.REGION_3.value, "city": "Sukuta"},

        # North Bank (Region 4 in enum)
        {"id": "FARAFENNI",   "name": "Farafenni General Hospital",
         "region": HealthRegion.REGION_4.value, "city": "Farafenni"},
        {"id": "KEREWAN",     "name": "Kerewan Health Centre",
         "region": HealthRegion.REGION_4.value, "city": "Kerewan"},
        {"id": "ESSAU",       "name": "Essau Health Centre",
         "region": HealthRegion.REGION_4.value, "city": "Essau"},

        # Lower River (Region 5 in enum)
        {"id": "SOMA",        "name": "Soma Health Centre",
         "region": HealthRegion.REGION_5.value, "city": "Soma"},
        {"id": "MANSA-KONKO", "name": "Mansa Konko Health Centre",
         "region": HealthRegion.REGION_5.value, "city": "Mansa Konko"},

        # Central River
        {"id": "BANSANG",     "name": "Bansang Hospital",
         "region": HealthRegion.REGION_6.value, "city": "Bansang"},
        {"id": "JANJANBUREH", "name": "Janjanbureh Health Centre",
         "region": HealthRegion.REGION_6.value, "city": "Janjanbureh"},
        {"id": "KUNTAUR",     "name": "Kuntaur Health Centre",
         "region": HealthRegion.REGION_6.value, "city": "Kuntaur"},

        # Upper River
        {"id": "BASSE",       "name": "Basse Health Centre",
         "region": HealthRegion.REGION_7.value, "city": "Basse"},
        {"id": "FATOTO",      "name": "Fatoto Health Centre",
         "region": HealthRegion.REGION_7.value, "city": "Fatoto"},
    ]

    @classmethod
    def get(cls, facility_id: str) -> Optional[Dict[str, str]]:
        for f in cls.FACILITIES:
            if f["id"] == facility_id:
                return f
        return None

    @classmethod
    def list(cls, region: Optional[str] = None) -> List[Dict[str, str]]:
        if region:
            return [f for f in cls.FACILITIES if f["region"] == region]
        return list(cls.FACILITIES)


# ──────────────────────────────────────────────────────────────────
#  PHONE NORMALIZATION
# ──────────────────────────────────────────────────────────────────

def normalize_phone(phone: str) -> Optional[str]:
    """Normalize a Gambian phone number to canonical +220XXXXXXX form.
    Returns None if invalid.
    """
    if not phone:
        return None
    result = PhoneValidator.validate(phone)
    if not result.get("valid"):
        return None
    return result.get("normalized")


# ──────────────────────────────────────────────────────────────────
#  SUPER-ADMIN TEST ACCOUNTS
#
#  3 explicit gov accounts that bypass all RBAC restrictions, for
#  end-to-end testing. They carry super_admin: true in their JWT
#  and have full national access to all 7 regions, PII included.
#
#  All 3 have known credentials:
#    - phone (for the Live phone-flow)
#    - PIN   (4-digit, for the phone-flow)
#    - staff_id + password + NIN (for the Future staff-id flow)
#
#  Phones are +220 777 000X -- memorable test pattern.
#  PINs are 1111 / 2222 / 3333 -- easy to type during testing.
# ──────────────────────────────────────────────────────────────────

SUPER_ADMIN_ROLE = "super_admin"

#  Naming convention: synthetic super-admins use a clearly fictional
#  "-Demo" suffix on the family name and "@moh.example.gm" emails so
#  there is no chance of accidental identification with any real
#  Gambian official.
SUPER_ADMINS: List[Dict[str, Any]] = [
    {
        "staff_id":             "MOH-2024-0001",
        "full_name":            "Dr. Lamin Touray-Demo",
        "title":                "Director General of Health Services",
        "department":           "Ministry of Health Headquarters",
        "nin":                  "15057511234",
        "date_of_birth":        "1975-05-15",
        "phone":                "+2207770001",
        "phone_normalized":     "+2207770001",
        "password":             "SuperGov2026!",
        "pin":                  "1111",
        "role":                 SUPER_ADMIN_ROLE,
        "region":               HealthRegion.REGION_1.value,
        "facility":             "MOH-HQ",
        "professional_reg":     "",
        "email":                "dg.health-demo@moh.example.gm",
        "status":               "active",
        "must_change_password": False,
        "is_synthetic":         True,
        "generated_by":         "amina_synthetic_seed",
    },
    {
        "staff_id":             "MOH-2024-0002",
        "full_name":            "Mariama Sanneh-Camara-Demo",
        "title":                "Permanent Secretary, Ministry of Health",
        "department":           "Ministry of Health Headquarters",
        "nin":                  "22086811234",
        "date_of_birth":        "1968-08-22",
        "phone":                "+2207770002",
        "phone_normalized":     "+2207770002",
        "password":             "SuperGov2026@",
        "pin":                  "2222",
        "role":                 SUPER_ADMIN_ROLE,
        "region":               HealthRegion.REGION_1.value,
        "facility":             "MOH-HQ",
        "professional_reg":     "",
        "email":                "ps.moh-demo@moh.example.gm",
        "status":               "active",
        "must_change_password": False,
        "is_synthetic":         True,
        "generated_by":         "amina_synthetic_seed",
    },
    {
        "staff_id":             "MOH-2024-0003",
        "full_name":            "Ousman Jallow-Demo",
        "title":                "Director, ICT Unit",
        "department":           "MoH ICT Unit",
        "nin":                  "10128011234",
        "date_of_birth":        "1980-12-10",
        "phone":                "+2207770003",
        "phone_normalized":     "+2207770003",
        "password":             "SuperGov2026#",
        "pin":                  "3333",
        "role":                 SUPER_ADMIN_ROLE,
        "region":               HealthRegion.REGION_1.value,
        "facility":             "MOH-ICT",
        "professional_reg":     "",
        "email":                "ict.director-demo@moh.example.gm",
        "status":               "active",
        "must_change_password": False,
        "is_synthetic":         True,
        "generated_by":         "amina_synthetic_seed",
    },
]


def find_super_admin_by_phone(phone: str) -> Optional[Dict[str, Any]]:
    norm = normalize_phone(phone)
    if not norm:
        return None
    for sa in SUPER_ADMINS:
        if sa["phone_normalized"] == norm:
            return dict(sa)
    return None


def find_super_admin_by_staff_id(staff_id: str) -> Optional[Dict[str, Any]]:
    sid = (staff_id or "").strip().upper()
    for sa in SUPER_ADMINS:
        if sa["staff_id"] == sid:
            return dict(sa)
    return None


def is_super_admin_role(role: str) -> bool:
    return (role or "").strip().lower() == SUPER_ADMIN_ROLE


# ──────────────────────────────────────────────────────────────────
#  SUPER-ADMIN ACCESS DESCRIPTOR (overrides RBAC)
# ──────────────────────────────────────────────────────────────────

def super_admin_access() -> Dict[str, Any]:
    """Returns the access descriptor for a super-admin. Bypasses all
    region/PII/export restrictions.
    """
    return {
        "access_level":       "national",
        "can_view_national":  True,
        "can_view_regional":  True,
        "can_view_facility":  True,
        "can_export":         True,
        "can_submit_data":    True,
        "pii_access":         True,
        "regions_accessible": [r.value for r in HealthRegion],
        "super_admin":        True,
    }


__all__ = [
    "PINValidator",
    "FacilityRegistry",
    "normalize_phone",
    "SUPER_ADMIN_ROLE",
    "SUPER_ADMINS",
    "find_super_admin_by_phone",
    "find_super_admin_by_staff_id",
    "is_super_admin_role",
    "super_admin_access",
]
