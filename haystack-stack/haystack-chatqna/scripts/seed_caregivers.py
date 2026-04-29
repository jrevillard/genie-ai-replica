#!/usr/bin/env python3
"""
Seed 8 Gambian community health workers into the CaregiverVertex table.

Run from inside the haystack-chatqna container:
  python scripts/seed_caregivers.py

Or locally with the right env vars:
  ARCADEDB_URL=http://localhost:2480 ARCADEDB_DB=amina \
  ARCADEDB_USER=root ARCADEDB_PASSWORD=arcadedb \
  python scripts/seed_caregivers.py
"""

import hashlib
import hmac
import os
import sys
import uuid
from datetime import datetime

import requests

# ── Config ─────────────────────────────────────────────────────────────────────
URL  = os.getenv("ARCADEDB_URL",      "http://arcadedb:2480")
DB   = os.getenv("ARCADEDB_DB",       "amina")
USER = os.getenv("ARCADEDB_USER",     "root")
PASS = os.getenv("ARCADEDB_PASSWORD", "arcadedb")

AUTH = (USER, PASS)
API  = f"{URL}/api/v1/command/{DB}"

DEFAULT_PIN = "1234"   # caregivers will be asked to change this on first login


def _sql(stmt: str, params: dict = None):
    body = {"language": "sql", "command": stmt}
    if params:
        body["params"] = params
    r = requests.post(API, json=body, auth=AUTH, timeout=15)
    r.raise_for_status()
    return r.json().get("result", [])


def _caregiver_id(phone: str) -> str:
    return "cg_" + hashlib.sha256(phone.encode()).hexdigest()[:16]


def _hash_pin(pin: str, salt: str) -> str:
    return hmac.new(salt.encode(), pin.encode(), "sha256").hexdigest()


# ── Ensure schema has the new fields ──────────────────────────────────────────

def ensure_schema():
    new_props = [
        "CREATE PROPERTY CaregiverVertex.accepting_patients IF NOT EXISTS BOOLEAN",
        "CREATE PROPERTY CaregiverVertex.specialty_tags IF NOT EXISTS STRING",   # JSON list
        "CREATE PROPERTY CaregiverVertex.region IF NOT EXISTS STRING",
        "CREATE PROPERTY CaregiverVertex.years_experience IF NOT EXISTS INTEGER",
        "CREATE PROPERTY CaregiverVertex.languages IF NOT EXISTS STRING",        # JSON list
        "CREATE PROPERTY CaregiverVertex.max_patients IF NOT EXISTS INTEGER",
        "CREATE PROPERTY CaregiverVertex.is_directory_visible IF NOT EXISTS BOOLEAN",
    ]
    for stmt in new_props:
        try:
            _sql(stmt)
            print(f"  schema: {stmt[:60]}…")
        except Exception as e:
            print(f"  schema (skip): {e}")


# ── Caregiver profiles ─────────────────────────────────────────────────────────

CAREGIVERS = [
    {
        "name":         "Fatou Jallow",
        "phone":        "+2203110001",
        "relationship": "professional_chw",
        "specialization": "Maternal & Child Health",
        "specialty_tags": ["antenatal care", "postnatal support", "child nutrition", "breastfeeding", "immunisation"],
        "bio":          "Certified Community Health Nurse with 9 years supporting mothers and children in the West Coast Region. Fluent in Mandinka and Wolof. Specialises in safe motherhood, EPI, and newborn care.",
        "region":       "wcr",
        "years_experience": 9,
        "languages":    ["English", "Mandinka", "Wolof"],
        "max_patients": 25,
        "accepting_patients": True,
        "is_directory_visible": True,
    },
    {
        "name":         "Ousman Ceesay",
        "phone":        "+2203110002",
        "relationship": "professional_chw",
        "specialization": "Chronic Disease Management",
        "specialty_tags": ["hypertension", "type 2 diabetes", "medication adherence", "cardiovascular risk", "lifestyle counselling"],
        "bio":          "Registered Nurse based in Banjul with 12 years managing non-communicable diseases. Trained in HEARTS protocol and WHO NCD management guidelines. Also conducts community BP and glucose screening.",
        "region":       "banjul",
        "years_experience": 12,
        "languages":    ["English", "Wolof", "Fula"],
        "max_patients": 30,
        "accepting_patients": True,
        "is_directory_visible": True,
    },
    {
        "name":         "Aminata Drammeh",
        "phone":        "+2203110003",
        "relationship": "professional_chw",
        "specialization": "HIV/AIDS & Infectious Disease",
        "specialty_tags": ["HIV/AIDS care", "antiretroviral support", "TB follow-up", "stigma reduction", "PMTCT"],
        "bio":          "Senior HIV Counsellor and Community Health Officer with 15 years at North Bank Region health facilities. ART adherence support, disclosure counselling, and PMTCT programme coordination.",
        "region":       "nbr",
        "years_experience": 15,
        "languages":    ["English", "Mandinka", "Serer"],
        "max_patients": 20,
        "accepting_patients": True,
        "is_directory_visible": True,
    },
    {
        "name":         "Lamin Sanyang",
        "phone":        "+2203110004",
        "relationship": "professional_chw",
        "specialization": "Elderly Care & Palliative Support",
        "specialty_tags": ["elderly care", "dementia support", "pain management", "palliative care", "fall prevention"],
        "bio":          "Gerontology-trained Community Health Worker serving Lower River Region. Certified in palliative care by ECOWAS Health Institute. Provides home visits, caregiver coaching, and end-of-life support.",
        "region":       "lrr",
        "years_experience": 7,
        "languages":    ["English", "Mandinka"],
        "max_patients": 15,
        "accepting_patients": True,
        "is_directory_visible": True,
    },
    {
        "name":         "Mariama Bah",
        "phone":        "+2203110005",
        "relationship": "professional_chw",
        "specialization": "Nutrition, WASH & Malnutrition",
        "specialty_tags": ["SAM/MAM management", "MUAC screening", "therapeutic feeding", "WASH", "food security"],
        "bio":          "Nutrition Officer and WASH specialist covering Upper River Region. Trained in CMAM and therapeutic feeding programmes. Works closely with World Food Programme and UNICEF nutrition teams.",
        "region":       "urr",
        "years_experience": 10,
        "languages":    ["English", "Fula", "Mandinka"],
        "max_patients": 20,
        "accepting_patients": True,
        "is_directory_visible": True,
    },
    {
        "name":         "Ebrima Bojang",
        "phone":        "+2203110006",
        "relationship": "professional_chw",
        "specialization": "Community Mental Health",
        "specialty_tags": ["depression", "anxiety", "substance use", "trauma support", "mhGAP", "psychosocial first aid"],
        "bio":          "mhGAP-certified Mental Health Support Worker, Central River Region. Trained in Problem Management Plus (PM+) by WHO. Provides structured psychological support and community-based mental health awareness.",
        "region":       "crr",
        "years_experience": 6,
        "languages":    ["English", "Mandinka", "Wolof", "Jola"],
        "max_patients": 15,
        "accepting_patients": True,
        "is_directory_visible": True,
    },
    {
        "name":         "Adama Touray",
        "phone":        "+2203110007",
        "relationship": "professional_chw",
        "specialization": "Reproductive & Sexual Health",
        "specialty_tags": ["family planning", "contraception counselling", "STI screening", "safe abortion care", "GBV support"],
        "bio":          "Reproductive Health Nurse and Family Planning Counsellor, West Coast Region. Eight years providing comprehensive SRH services. Trained by UNFPA and Marie Stopes in long-acting contraceptive methods.",
        "region":       "wcr",
        "years_experience": 8,
        "languages":    ["English", "Wolof", "Mandinka"],
        "max_patients": 25,
        "accepting_patients": True,
        "is_directory_visible": True,
    },
    {
        "name":         "Binta Jobarteh",
        "phone":        "+2203110008",
        "relationship": "professional_chw",
        "specialization": "Paediatric & School Health",
        "specialty_tags": ["child health", "school health", "deworming", "malaria in children", "growth monitoring", "ECD"],
        "bio":          "Paediatric Health Officer and School Health Coordinator based in Banjul. IMCI-certified with experience managing childhood illnesses including malaria, pneumonia, and diarrhoea. Also trained in early childhood development screening.",
        "region":       "banjul",
        "years_experience": 11,
        "languages":    ["English", "Wolof", "Mandinka"],
        "max_patients": 30,
        "accepting_patients": True,
        "is_directory_visible": True,
    },
]


def seed():
    print("\n── AMINA Caregiver Seed Script ──────────────────────────────")
    print(f"Target: {URL}/api/v1/command/{DB}\n")

    ensure_schema()

    now = datetime.now().isoformat()
    created = skipped = 0

    for cg in CAREGIVERS:
        phone = cg["phone"]
        cg_id = _caregiver_id(phone)

        # Check if already exists
        existing = _sql(
            "SELECT caregiver_id FROM CaregiverVertex WHERE phone = :p LIMIT 1",
            {"p": phone},
        )
        if existing:
            print(f"  SKIP  {cg['name']} ({phone}) — already exists")
            skipped += 1
            continue

        salt     = uuid.uuid4().hex[:16]
        pin_hash = _hash_pin(DEFAULT_PIN, salt)
        tags_json   = str(cg["specialty_tags"]).replace("'", '"')
        langs_json  = str(cg["languages"]).replace("'", '"')

        try:
            _sql(
                "INSERT INTO CaregiverVertex SET "
                "caregiver_id = :cid, name = :name, phone = :phone, "
                "pin_hash = :ph, pin_salt = :ps, relationship = :rel, "
                "patient_limit = :lim, max_patients = :max, "
                "bio = :bio, specialization = :spec, "
                "specialty_tags = :tags, region = :region, "
                "years_experience = :yrs, languages = :langs, "
                "accepting_patients = :acc, is_directory_visible = :vis, "
                "created_at = :now, last_login = :now",
                {
                    "cid":    cg_id,
                    "name":   cg["name"],
                    "phone":  phone,
                    "ph":     pin_hash,
                    "ps":     salt,
                    "rel":    cg["relationship"],
                    "lim":    cg["max_patients"],
                    "max":    cg["max_patients"],
                    "bio":    cg["bio"],
                    "spec":   cg["specialization"],
                    "tags":   tags_json,
                    "region": cg["region"],
                    "yrs":    cg["years_experience"],
                    "langs":  langs_json,
                    "acc":    cg["accepting_patients"],
                    "vis":    cg["is_directory_visible"],
                    "now":    now,
                },
            )
            print(f"  OK    {cg['name']} — {cg['specialization']} ({cg['region'].upper()}) id={cg_id}")
            created += 1
        except Exception as e:
            print(f"  ERROR {cg['name']}: {e}")

    print(f"\nDone — {created} created, {skipped} skipped.")
    print(f"Default PIN for all seeded caregivers: {DEFAULT_PIN!r}\n")


if __name__ == "__main__":
    seed()
