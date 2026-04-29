"""
Sanity test -- Observatory Auth validators + RBAC
Run:  python _observatory_auth_test.py
"""
import sys, os
sys.path.insert(0, ".")
os.environ["PYTHONUTF8"] = "1"

PASS = 0
FAIL = 0

def check(label, condition, detail=""):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  [PASS] {label}")
    else:
        FAIL += 1
        print(f"  [FAIL] {label}  -- {detail}")


# ============================================================
# 1. NIN VALIDATOR
# ============================================================
print("\n=== 1. NIN Validator ===")

from src.models.gov_auth import NINValidator

r = NINValidator.validate("25049812345")
check("Valid 11-digit NIN", r["valid"] is True)
check("DOB extracted", r["date_of_birth"] == "1998-04-25")

r2 = NINValidator.validate("12345")
check("Too short -> invalid", r2["valid"] is False)
check("Error message", "11 digits" in r2["error"])

r3 = NINValidator.validate("99999912345")
check("Invalid date in NIN", r3["valid"] is False)

r4 = NINValidator.validate("01010512345")
check("Young person (born 2005, age 21)", r4["valid"] is True)

r5 = NINValidator.validate("01011512345")
check("Born 2015 under 18 check", r5["valid"] is False)
check("Under 18 error", "under 18" in (r5["error"] or ""))

# DOB extraction
from datetime import date
dob = NINValidator.extract_dob("25049812345")
check("extract_dob works", dob == date(1998, 4, 25))

# Cross-validation
check("Cross-validate DOB match", NINValidator.cross_validate_dob("25049812345", date(1998, 4, 25)))
check("Cross-validate DOB mismatch", not NINValidator.cross_validate_dob("25049812345", date(1999, 4, 25)))


# ============================================================
# 2. STAFF ID VALIDATOR
# ============================================================
print("\n=== 2. Staff ID Validator ===")

from src.models.gov_auth import StaffIDValidator

r = StaffIDValidator.validate("MOH-2026-0001")
check("Valid MOH staff ID", r["valid"] is True)
check("Ministry is MOH", r["ministry"] == "MOH")
check("Year 2026", r["year"] == 2026)
check("Sequence 1", r["sequence"] == 1)

r2 = StaffIDValidator.validate("MOFEA-2025-0234")
check("Valid MOFEA ID", r2["valid"] is True)

r3 = StaffIDValidator.validate("XYZ-2026-0001")
check("Unknown ministry -> invalid", r3["valid"] is False)
check("Error mentions codes", "Unknown ministry" in r3["error"])

r4 = StaffIDValidator.validate("MOH-1960-0001")
check("Year before 1965 -> invalid", r4["valid"] is False)

r5 = StaffIDValidator.validate("MOH-2026-0000")
check("Sequence 0 -> invalid", r5["valid"] is False)

r6 = StaffIDValidator.validate("invalid-format")
check("Bad format -> invalid", r6["valid"] is False)


# ============================================================
# 3. PROFESSIONAL REG VALIDATOR
# ============================================================
print("\n=== 3. Professional Registration ===")

from src.models.gov_auth import ProfessionalRegValidator

r = ProfessionalRegValidator.validate("GNMC-2024-156")
check("Valid GNMC registration", r["valid"] is True)
check("Council is GNMC", r["council"] == "GNMC")

r2 = ProfessionalRegValidator.validate("GMDC-2023-089")
check("Valid GMDC", r2["valid"] is True)

r3 = ProfessionalRegValidator.validate("FAKE-2024-001")
check("Unknown council -> invalid", r3["valid"] is False)


# ============================================================
# 4. PHONE VALIDATOR
# ============================================================
print("\n=== 4. Phone Validator ===")

from src.models.gov_auth import PhoneValidator

r = PhoneValidator.validate("+2207654321")
check("Valid +220 phone", r["valid"] is True)
check("Normalized", r["normalized"] == "+2207654321")
check("Africell detected", r["operator"] == "Africell")

r2 = PhoneValidator.validate("2205123456")
check("QCell detected", r2["operator"] == "QCell")

r3 = PhoneValidator.validate("123")
check("Too short -> invalid", r3["valid"] is False)


# ============================================================
# 5. ACCESS LEVEL MAPPING
# ============================================================
print("\n=== 5. Access Level Mapping ===")

from src.models.gov_auth import access_level_for_role

check("Director -> national", access_level_for_role("director") == "national")
check("PS -> national", access_level_for_role("permanent_secretary") == "national")
check("RHD -> regional", access_level_for_role("regional_health_director") == "regional")
check("M&E -> regional", access_level_for_role("m_and_e_officer") == "regional")
check("Medical officer -> facility", access_level_for_role("medical_officer") == "facility")
check("Data officer -> data_entry", access_level_for_role("data_officer") == "data_entry")
check("CHN -> data_entry", access_level_for_role("chn") == "data_entry")
check("Unknown -> data_entry", access_level_for_role("unknown_role") == "data_entry")


# ============================================================
# 6. RBAC RESOLVE
# ============================================================
print("\n=== 6. RBAC Resolve ===")

from src.services.observatory_rbac import resolve_access, check_region_access, apply_k_anonymity

access = resolve_access("director", "Greater Banjul")
check("Director sees national", access["can_view_national"] is True)
check("Director can export", access["can_export"] is True)
check("Director no PII", access["pii_access"] is False)
check("Director all regions", len(access["regions_accessible"]) == 7)

access2 = resolve_access("regional_health_director", "North Bank")
check("RHD sees regional", access2["can_view_regional"] is True)
check("RHD not national", access2["can_view_national"] is False)
check("RHD own region", access2["regions_accessible"] == ["North Bank"])

access3 = resolve_access("data_officer", "Kanifing")
check("Data officer limited", access3["can_export"] is False)
check("Data officer can submit", access3["can_submit_data"] is True)

# Region access check
check("National sees any region", check_region_access(access, "Upper River"))
check("Regional sees own region", check_region_access(access2, "North Bank"))
check("Regional blocked from other", not check_region_access(access2, "Upper River"))

# K-anonymity
check("K-anon: 3 -> '< 5'", apply_k_anonymity(3) == "< 5")
check("K-anon: 10 -> '10'", apply_k_anonymity(10) == "10")
check("K-anon: 5 -> '5'", apply_k_anonymity(5) == "5")


# ============================================================
# 7. PASSWORD POLICY
# ============================================================
print("\n=== 7. Password Policy ===")

from src.services.observatory_security import validate_password_policy, hash_password, verify_password

check("Too short", validate_password_policy("Ab1!") is not None)
check("No uppercase", validate_password_policy("password1!") is not None)
check("No digit", validate_password_policy("Password!") is not None)
check("No special", validate_password_policy("Password1") is not None)
check("Valid password", validate_password_policy("Password1!") is None)
check("Complex valid", validate_password_policy("GambiaGov2026!") is None)

# Password hash + verify
pw = "TestPass123!"
h = hash_password(pw)
check("Hash produced", len(h) > 10)
check("Verify correct", verify_password(pw, h) is True)
check("Verify wrong", verify_password("WrongPass!", h) is False)


# ============================================================
# 8. MINISTRY ENUM COMPLETENESS
# ============================================================
print("\n=== 8. Enums ===")

from src.models.gov_auth import GambianMinistry, HealthRegion, ProfessionalCouncil, StaffRole

check("15 ministries", len(GambianMinistry) == 15)
check("7 health regions", len(HealthRegion) == 7)
check("4 professional councils", len(ProfessionalCouncil) == 4)
check("19 staff roles", len(StaffRole) == 19)


# ============================================================
# 9. DATA CLASSIFICATION
# ============================================================
print("\n=== 9. Data Classification ===")

from src.services.observatory_rbac import DATA_CLASSIFICATION, check_data_field

check("Aggregate list exists", len(DATA_CLASSIFICATION["aggregate_safe"]) >= 10)
check("PII list exists", len(DATA_CLASSIFICATION["pii_restricted"]) >= 5)
check("Min aggregation threshold", DATA_CLASSIFICATION["minimum_aggregation"]["threshold"] == 5)

# Field check
dummy_access = {"pii_access": False}
check("Aggregate field allowed", check_data_field("total_consultations_per_region", dummy_access))
check("PII field blocked", not check_data_field("patient_name", dummy_access))
check("PII phone blocked", not check_data_field("patient_phone", dummy_access))


# ============================================================
# SUMMARY
# ============================================================
print(f"\n{'='*60}")
print(f"  RESULTS:  {PASS} passed,  {FAIL} failed")
print(f"{'='*60}")
sys.exit(1 if FAIL > 0 else 0)
