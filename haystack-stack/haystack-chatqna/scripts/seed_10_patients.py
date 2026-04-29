#!/usr/bin/env python3
"""
Seed 10 real patients into ArcadeDB with AMINA IDs + literacy profiles.
Run from host: python scripts/seed_10_patients.py
"""
import hashlib
import json
import requests
from datetime import datetime

ARCADE_URL = "http://localhost:2480"
ARCADE_DB  = "genie"
ARCADE_AUTH = ("root", "genieRoot123")

NOW = datetime.utcnow().isoformat() + "Z"

PATIENTS = [
    {
        "name": "Jainaba Dem",
        "phone": "+220-7728038",
        "age": 52,
        "gender": "female",
        "region": "West Coast",
        "conditions": ["diabetes", "hypertension"],
        "medications": [
            {"name": "Metformin", "dosage": "500mg", "frequency": "twice daily"},
            {"name": "Amlodipine", "dosage": "5mg", "frequency": "once daily"},
        ],
        "last_bp": "153/80",
        "last_glucose": "8.2",
        "literacy": "upper_basic",
    },
    {
        "name": "Kebba Fatty",
        "phone": "+220-3387636",
        "age": 61,
        "gender": "male",
        "region": "Kanifing",
        "conditions": ["hypertension", "diabetes"],
        "medications": [
            {"name": "Lisinopril", "dosage": "10mg", "frequency": "once daily"},
            {"name": "Metformin", "dosage": "500mg", "frequency": "twice daily"},
        ],
        "last_bp": "152/78",
        "last_glucose": "7.8",
        "literacy": "none",
    },
    {
        "name": "Malick Darboe",
        "phone": "+220-2559023",
        "age": 58,
        "gender": "male",
        "region": "North Bank",
        "conditions": ["hypertension", "diabetes"],
        "medications": [
            {"name": "Amlodipine", "dosage": "5mg", "frequency": "once daily"},
            {"name": "Metformin", "dosage": "850mg", "frequency": "twice daily"},
        ],
        "last_bp": "155/78",
        "last_glucose": "9.1",
        "literacy": "none",
    },
    {
        "name": "Maimuna Sonko",
        "phone": "+220-7153045",
        "age": 65,
        "gender": "female",
        "region": "Banjul",
        "conditions": ["heart_disease", "hypertension"],
        "medications": [
            {"name": "Atorvastatin", "dosage": "20mg", "frequency": "once daily"},
            {"name": "Lisinopril", "dosage": "10mg", "frequency": "once daily"},
        ],
        "last_bp": "140/84",
        "last_glucose": None,
        "literacy": "upper_basic",
    },
    {
        "name": "Seedy Bah",
        "phone": "+220-2125990",
        "age": 47,
        "gender": "male",
        "region": "Central River",
        "conditions": ["hypertension"],
        "medications": [
            {"name": "Hydrochlorothiazide", "dosage": "25mg", "frequency": "once daily"},
        ],
        "last_bp": "150/85",
        "last_glucose": None,
        "literacy": "senior_sec",
    },
    {
        "name": "Sarjo Sanyang",
        "phone": "+220-2642717",
        "age": 44,
        "gender": "female",
        "region": "Lower River",
        "conditions": ["kidney_disease"],
        "medications": [
            {"name": "Lisinopril", "dosage": "5mg", "frequency": "once daily"},
        ],
        "last_bp": "100/62",
        "last_glucose": None,
        "literacy": "none",
    },
    {
        "name": "Sally Jobe",
        "phone": "+220-3790855",
        "age": 55,
        "gender": "female",
        "region": "West Coast",
        "conditions": ["hypertension"],
        "medications": [
            {"name": "Amlodipine", "dosage": "10mg", "frequency": "once daily"},
        ],
        "last_bp": "146/87",
        "last_glucose": None,
        "literacy": "upper_basic",
    },
    {
        "name": "Baboucarr Ceesay",
        "phone": "+220-2801978",
        "age": 50,
        "gender": "male",
        "region": "Kanifing",
        "conditions": ["hypertension"],
        "medications": [
            {"name": "Hydrochlorothiazide", "dosage": "25mg", "frequency": "once daily"},
        ],
        "last_bp": "144/81",
        "last_glucose": None,
        "literacy": "senior_sec",
    },
    {
        "name": "Sally Njie",
        "phone": "+220-9559398",
        "age": 39,
        "gender": "female",
        "region": "Banjul",
        "conditions": ["kidney_disease"],
        "medications": [
            {"name": "Lisinopril", "dosage": "5mg", "frequency": "once daily"},
        ],
        "last_bp": "110/69",
        "last_glucose": None,
        "literacy": "upper_basic",
    },
    {
        "name": "Binta Dibba",
        "phone": "+220-9128941",
        "age": 48,
        "gender": "female",
        "region": "North Bank",
        "conditions": ["hypertension"],
        "medications": [
            {"name": "Amlodipine", "dosage": "5mg", "frequency": "once daily"},
        ],
        "last_bp": "144/91",
        "last_glucose": None,
        "literacy": "none",
    },
]

LITERACY_MODE = {
    "none": "beginner",
    "upper_basic": "basic",
    "senior_sec": "advanced",
}


def arcade_sql(sql, params=None):
    payload = {"language": "sql", "command": sql}
    if params:
        payload["params"] = params
    r = requests.post(
        f"{ARCADE_URL}/api/v1/command/{ARCADE_DB}",
        json=payload,
        auth=ARCADE_AUTH,
        timeout=15,
    )
    r.raise_for_status()
    return r.json()


def gen_patient_id(phone):
    return "P" + hashlib.md5(phone.encode()).hexdigest()[:8].upper()


def main():
    print("=" * 70)
    print("  AMINA Care — Seeding 10 Patients + Literacy Profiles")
    print("=" * 70)

    try:
        arcade_sql("CREATE DOCUMENT TYPE Patient IF NOT EXISTS")
    except Exception:
        pass
    try:
        arcade_sql("CREATE VERTEX TYPE LiteracyProfileVertex IF NOT EXISTS")
    except Exception:
        pass

    results = []

    for p in PATIENTS:
        pid = gen_patient_id(p["phone"])
        amina_id = f"AMINA-{pid}"
        mode = LITERACY_MODE[p["literacy"]]

        existing = arcade_sql(f"SELECT FROM Patient WHERE patient_id = '{pid}'")
        rows = existing.get("result", [])
        if rows:
            print(f"  [skip] {p['name']} already exists as {amina_id}")
        else:
            arcade_sql(
                "INSERT INTO Patient SET "
                "patient_id = :pid, name = :name, age = :age, gender = :gender, "
                "region = :region, phone = :phone, conditions = :cond, "
                "medications = :meds, allergies = :allerg, "
                "emergency_contact = :ec, last_bp = :bp, last_glucose = :gluc",
                {
                    "pid": pid,
                    "name": p["name"],
                    "age": p["age"],
                    "gender": p["gender"],
                    "region": p["region"],
                    "phone": p["phone"],
                    "cond": json.dumps(p["conditions"]),
                    "meds": json.dumps(p["medications"]),
                    "allerg": json.dumps([]),
                    "ec": "",
                    "bp": p["last_bp"],
                    "gluc": p.get("last_glucose") or "",
                },
            )
            print(f"  [new]  {p['name']} -> {amina_id}")

        lit_existing = arcade_sql(
            f"SELECT FROM LiteracyProfileVertex WHERE patient_id = '{pid}'"
        )
        lit_rows = lit_existing.get("result", [])
        if lit_rows:
            print(f"         literacy profile exists -> {p['literacy']} / {mode}")
        else:
            record = {
                "patient_id": pid,
                "declared_level": p["literacy"],
                "verified_level": p["literacy"],
                "current_mode": mode,
                "status": "approved",
                "verified_by": "seed-script",
                "verified_at": NOW,
                "created_at": NOW,
                "updated_at": NOW,
                "reviewer_note": f"seeded — {p['name']} ({mode} mode)",
            }
            arcade_sql(
                "INSERT INTO LiteracyProfileVertex CONTENT " + json.dumps(record)
            )
            print(f"         literacy profile created -> {p['literacy']} / {mode}")

        results.append({
            "name": p["name"],
            "amina_id": amina_id,
            "patient_id": pid,
            "conditions": p["conditions"],
            "literacy_declared": p["literacy"],
            "literacy_mode": mode,
            "last_bp": p["last_bp"],
        })

    print()
    print("=" * 70)
    print(f"  {'Name':<22} {'AMINA ID':<16} {'Conditions':<30} {'Literacy Tier':<16} {'Mode'}")
    print("-" * 70)
    for r in results:
        conds = ", ".join(r["conditions"])
        print(f"  {r['name']:<22} {r['amina_id']:<16} {conds:<30} {r['literacy_declared']:<16} {r['literacy_mode']}")
    print("=" * 70)
    print(f"\n  Total: {len(results)} patients seeded with AMINA IDs + literacy tiers\n")


if __name__ == "__main__":
    main()
