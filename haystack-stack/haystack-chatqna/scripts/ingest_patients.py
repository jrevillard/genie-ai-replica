"""
Ingest synthetic patient data into ArcadeDB (PatientVertex).

Usage:
  python scripts/ingest_patients.py                          # Uses default URL
  python scripts/ingest_patients.py --url http://localhost:2480 --db genie
"""

import json
import sys
import argparse
import requests
from pathlib import Path


def command_sql(url: str, db: str, user: str, password: str, sql: str, params=None):
    endpoint = f"{url.rstrip('/')}/api/v1/command/{db}"
    payload = {"language": "sql", "command": sql}
    if params:
        payload["params"] = params
    r = requests.post(endpoint, json=payload, auth=(user, password), timeout=30)
    r.raise_for_status()
    return r.json()


def main():
    parser = argparse.ArgumentParser(description="Ingest synthetic patients into ArcadeDB")
    parser.add_argument("--url", default="http://localhost:2480", help="ArcadeDB URL")
    parser.add_argument("--db", default="genie", help="Database name")
    parser.add_argument("--user", default="root", help="ArcadeDB user")
    parser.add_argument("--password", default="genieRoot123", help="ArcadeDB password")
    parser.add_argument("--file", default=None, help="Patient JSON file path")
    args = parser.parse_args()

    data_file = args.file or str(Path(__file__).parent.parent / "data" / "synthetic_patients.json")

    with open(data_file, "r") as f:
        patients = json.load(f)

    print(f"Loaded {len(patients)} patients from {data_file}")

    # Ensure schema exists
    schema_cmds = [
        "CREATE VERTEX TYPE PatientVertex IF NOT EXISTS",
        "CREATE PROPERTY PatientVertex.id IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.phone IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.name IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.age IF NOT EXISTS INTEGER",
        "CREATE PROPERTY PatientVertex.gender IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.region IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.conditions IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.medications IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.allergies IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.bp_readings IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.glucose_readings IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.emergency_contact IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.preferred_language IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.key_facts IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.consultation_count IF NOT EXISTS INTEGER",
        "CREATE PROPERTY PatientVertex.last_consultation IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.last_bp IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.last_glucose IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.created_at IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.updated_at IF NOT EXISTS STRING",
    ]
    for sql in schema_cmds:
        try:
            command_sql(args.url, args.db, args.user, args.password, sql)
        except Exception as e:
            pass  # May already exist

    # Also create the old Patient doc type for backward compat
    try:
        command_sql(args.url, args.db, args.user, args.password,
                    "CREATE DOCUMENT TYPE Patient IF NOT EXISTS")
    except Exception:
        pass

    # Ingest patients (ArcadeDB requires params as dict, not list)
    success = 0
    errors = 0
    for i, p in enumerate(patients):
        try:
            command_sql(
                args.url, args.db, args.user, args.password,
                "INSERT INTO PatientVertex SET "
                "id = :id, phone = :phone, name = :name, age = :age, "
                "gender = :gender, region = :region, "
                "conditions = :conditions, medications = :medications, "
                "allergies = :allergies, key_facts = :facts, "
                "bp_readings = :bp, glucose_readings = :glucose, "
                "emergency_contact = :ec, preferred_language = :lang, "
                "consultation_count = :cc, last_consultation = :lc, "
                "last_bp = :lbp, last_glucose = :lg, "
                "created_at = :created, updated_at = :updated",
                {
                    "id": p["id"], "phone": p["phone"], "name": p["name"], "age": p["age"],
                    "gender": p["gender"], "region": p["region"],
                    "conditions": json.dumps(p["conditions"]),
                    "medications": json.dumps(p["medications"]),
                    "allergies": json.dumps(p["allergies"]),
                    "facts": json.dumps(p["key_facts"]),
                    "bp": json.dumps(p.get("bp_readings", [])),
                    "glucose": json.dumps(p.get("glucose_readings", [])),
                    "ec": p.get("emergency_contact", ""),
                    "lang": p.get("preferred_language", "english"),
                    "cc": p.get("consultation_count", 0),
                    "lc": p.get("last_consultation", ""),
                    "lbp": p.get("last_bp", ""),
                    "lg": p.get("last_glucose", ""),
                    "created": p.get("created_at", ""),
                    "updated": p.get("updated_at", ""),
                },
            )
            success += 1
        except Exception as e:
            errors += 1
            if errors <= 3:
                print(f"  Error on patient {i} ({p['id']}): {e}")

        if (i + 1) % 100 == 0:
            print(f"  Ingested {i + 1}/{len(patients)}...")

    print(f"\nDone: {success} ingested, {errors} errors")

    # Verify count
    try:
        result = command_sql(args.url, args.db, args.user, args.password,
                             "SELECT count(*) as cnt FROM PatientVertex")
        cnt = result.get("result", [{}])[0].get("cnt", "?")
        print(f"Total PatientVertex records in DB: {cnt}")
    except Exception as e:
        print(f"Count check failed: {e}")


if __name__ == "__main__":
    main()
