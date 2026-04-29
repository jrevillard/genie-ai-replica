"""
Gambian Government Authentication Data Models & Validation
==========================================================

Authentication models for the Ministry of Health Observatory dashboard.
All ID formats match real Gambian government identification systems:

  - NIN: 11-digit GAMBIS (Gambia Biometric Identification System) number
  - Staff ID: MINISTRY-YYYY-NNNN (civil service format)
  - Professional Reg: COUNCIL-YYYY-NNN (health regulatory body)
  - Phone: +220 XXXXXXX (7 digits after country code)
"""
from __future__ import annotations

import re
from enum import Enum
from datetime import datetime, date
from typing import Optional


class GambianMinistry(Enum):
    MOH = "MOH"
    MOFEA = "MOFEA"
    PMO = "PMO"
    MOI = "MOI"
    MOHERST = "MOHERST"
    MOBS = "MOBS"
    MOJCI = "MOJCI"
    MOLRG = "MOLRG"
    MOA = "MOA"
    MOTIE = "MOTIE"
    MOD = "MOD"
    MOIC = "MOIC"
    MOWSIR = "MOWSIR"
    MOFWR = "MOFWR"
    MOYS = "MOYS"


class HealthRegion(Enum):
    REGION_1 = "Greater Banjul"
    REGION_2 = "Kanifing"
    REGION_3 = "West Coast"
    REGION_4 = "North Bank"
    REGION_5 = "Lower River"
    REGION_6 = "Central River"
    REGION_7 = "Upper River"


class ProfessionalCouncil(Enum):
    GNMC = "GNMC"
    GMDC = "GMDC"
    GPC = "GPC"
    AHPC = "AHPC"


class StaffRole(Enum):
    PERMANENT_SECRETARY = "permanent_secretary"
    DIRECTOR = "director"
    DEPUTY_DIRECTOR = "deputy_director"
    REGIONAL_HEALTH_DIRECTOR = "regional_health_director"
    PRINCIPAL_PUBLIC_HEALTH_OFFICER = "ppho"
    MEDICAL_OFFICER = "medical_officer"
    SENIOR_NURSING_OFFICER = "senior_nursing_officer"
    NURSING_OFFICER = "nursing_officer"
    COMMUNITY_HEALTH_NURSE = "chn"
    MIDWIFE = "midwife"
    PHARMACIST = "pharmacist"
    LAB_TECHNICIAN = "lab_technician"
    ADMIN_OFFICER = "admin_officer"
    DATA_OFFICER = "data_officer"
    ICT_OFFICER = "ict_officer"
    MONITORING_EVALUATION = "m_and_e_officer"
    PHC_COORDINATOR = "phc_coordinator"
    HEALTH_EDUCATOR = "health_educator"
    ENVIRONMENTAL_HEALTH = "environmental_health_officer"


class NINValidator:
    """
    Validates Gambian National Identification Number (NIN).

    The NIN is an 11-digit number issued by GAMBIS
    (Gambia Biometric Identification System).
    - First 6 digits = date of birth (DDMMYY)
    - Last 5 digits = unique identifier
    """

    @staticmethod
    def validate(nin: str) -> dict:
        result = {
            "valid": False,
            "nin": nin,
            "date_of_birth": None,
            "error": None,
        }

        cleaned = nin.strip().replace(" ", "").replace("-", "")
        if not re.match(r"^\d{11}$", cleaned):
            result["error"] = "NIN must be exactly 11 digits"
            return result

        dob_str = cleaned[:6]
        try:
            day = int(dob_str[0:2])
            month = int(dob_str[2:4])
            year_short = int(dob_str[4:6])

            if year_short <= 30:
                year = 2000 + year_short
            else:
                year = 1900 + year_short

            dob = date(year, month, day)
            result["date_of_birth"] = dob.isoformat()

            age = (date.today() - dob).days // 365
            if age < 18:
                result["error"] = "NIN indicates age under 18 — government employees must be 18+"
                return result
            if age > 100:
                result["error"] = "NIN indicates age over 100 — please verify"
                return result

        except (ValueError, OverflowError):
            result["error"] = "First 6 digits of NIN must be a valid date (DDMMYY)"
            return result

        result["valid"] = True
        return result

    @staticmethod
    def extract_dob(nin: str) -> Optional[date]:
        cleaned = nin.strip().replace(" ", "").replace("-", "")
        if len(cleaned) != 11 or not cleaned.isdigit():
            return None
        try:
            day = int(cleaned[0:2])
            month = int(cleaned[2:4])
            year_short = int(cleaned[4:6])
            year = 2000 + year_short if year_short <= 30 else 1900 + year_short
            return date(year, month, day)
        except (ValueError, OverflowError):
            return None

    @staticmethod
    def cross_validate_dob(nin: str, staff_dob: date) -> bool:
        extracted = NINValidator.extract_dob(nin)
        if not extracted:
            return False
        return extracted == staff_dob


class StaffIDValidator:
    """
    Validates Gambian Ministry Staff ID.
    Format: MINISTRY-YYYY-NNNN
    """

    PATTERN = re.compile(r"^([A-Z]{2,6})-(\d{4})-(\d{4})$")
    VALID_MINISTRIES = {m.value for m in GambianMinistry}

    @classmethod
    def validate(cls, staff_id: str) -> dict:
        result = {
            "valid": False,
            "staff_id": staff_id,
            "ministry": None,
            "year": None,
            "sequence": None,
            "error": None,
        }

        cleaned = staff_id.strip().upper()
        match = cls.PATTERN.match(cleaned)

        if not match:
            result["error"] = "Staff ID must be in format: MOH-YYYY-NNNN"
            return result

        ministry_code = match.group(1)
        year = int(match.group(2))
        sequence = int(match.group(3))

        if ministry_code not in cls.VALID_MINISTRIES:
            result["error"] = (
                f"Unknown ministry code: {ministry_code}. "
                f"Valid codes: {', '.join(sorted(cls.VALID_MINISTRIES))}"
            )
            return result

        current_year = datetime.now().year
        if year < 1965 or year > current_year:
            result["error"] = f"Year must be between 1965 and {current_year}"
            return result

        if sequence < 1 or sequence > 9999:
            result["error"] = "Sequence number must be 0001-9999"
            return result

        result["valid"] = True
        result["ministry"] = ministry_code
        result["year"] = year
        result["sequence"] = sequence
        return result


class ProfessionalRegValidator:
    """
    Validates health professional registration numbers.
    Format: COUNCIL-YYYY-NNN
    """

    PATTERN = re.compile(r"^([A-Z]{2,4})-(\d{4})-(\d{3,4})$")
    VALID_COUNCILS = {c.value for c in ProfessionalCouncil}

    @classmethod
    def validate(cls, reg_number: str) -> dict:
        result = {
            "valid": False,
            "registration": reg_number,
            "council": None,
            "error": None,
        }

        cleaned = reg_number.strip().upper()
        match = cls.PATTERN.match(cleaned)

        if not match:
            result["error"] = "Format: GNMC-YYYY-NNN (Nursing) or GMDC-YYYY-NNN (Medical)"
            return result

        council = match.group(1)
        if council not in cls.VALID_COUNCILS:
            result["error"] = (
                f"Unknown council: {council}. "
                f"Valid: {', '.join(sorted(cls.VALID_COUNCILS))}"
            )
            return result

        result["valid"] = True
        result["council"] = council
        return result


class PhoneValidator:
    """
    Validates Gambian phone numbers.
    Format: +220 XXXXXXX (7 digits after country code)
    """

    PATTERN = re.compile(r"^(?:\+220|00220|220)?(\d{7})$")

    @classmethod
    def validate(cls, phone: str) -> dict:
        cleaned = phone.strip().replace(" ", "").replace("-", "")
        match = cls.PATTERN.match(cleaned)

        if not match:
            return {"valid": False, "error": "Gambian phone: +220 followed by 7 digits"}

        number = match.group(1)
        first_digit = number[0]

        operator = None
        if first_digit in ("2", "3", "7"):
            operator = "Africell"
        elif first_digit == "5":
            operator = "QCell"
        elif first_digit in ("6", "9"):
            operator = "Gamtel/Gamcel"

        return {
            "valid": True,
            "normalized": f"+220{number}",
            "operator": operator,
        }


# Re-export StaffRole values by access level for RBAC
NATIONAL_ROLES = frozenset({
    StaffRole.PERMANENT_SECRETARY.value,
    StaffRole.DIRECTOR.value,
    StaffRole.DEPUTY_DIRECTOR.value,
})

REGIONAL_ROLES = frozenset({
    StaffRole.REGIONAL_HEALTH_DIRECTOR.value,
    StaffRole.PRINCIPAL_PUBLIC_HEALTH_OFFICER.value,
    StaffRole.PHC_COORDINATOR.value,
    StaffRole.MONITORING_EVALUATION.value,
})

FACILITY_ROLES = frozenset({
    StaffRole.MEDICAL_OFFICER.value,
    StaffRole.SENIOR_NURSING_OFFICER.value,
    StaffRole.NURSING_OFFICER.value,
    StaffRole.PHARMACIST.value,
})

DATA_ENTRY_ROLES = frozenset({
    StaffRole.DATA_OFFICER.value,
    StaffRole.HEALTH_EDUCATOR.value,
    StaffRole.COMMUNITY_HEALTH_NURSE.value,
    StaffRole.ENVIRONMENTAL_HEALTH.value,
})


def access_level_for_role(role: str) -> str:
    if role in NATIONAL_ROLES:
        return "national"
    if role in REGIONAL_ROLES:
        return "regional"
    if role in FACILITY_ROLES:
        return "facility"
    if role in DATA_ENTRY_ROLES:
        return "data_entry"
    return "data_entry"
