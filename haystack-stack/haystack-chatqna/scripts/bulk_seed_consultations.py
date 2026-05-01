#!/usr/bin/env python3
"""
AMINA Care — Bulk Consultation Seeder
=======================================
Generates realistic consultation history for ALL existing PatientVertex
records (or a limited sample). Designed to run after `ingest_patients.py`
has restored the 1000 synthetic patients.

Each patient gets 2-6 consultations spread over the last 90 days, with
condition-relevant symptoms, appropriate triage levels, and realistic
summary text based on the patient's stored conditions.

Usage (inside container):
    python scripts/bulk_seed_consultations.py                 # all patients
    python scripts/bulk_seed_consultations.py --limit 300     # first 300 only
    python scripts/bulk_seed_consultations.py --skip-existing # don't re-seed patients who already have consultations
"""

import argparse
import json
import random
import uuid
from datetime import datetime, timedelta

import requests

ARCADEDB = "http://arcadedb:2480"
DB       = "genie"
AUTH     = ("root", "genieRoot123")


def sql(query, params=None):
    # ARCADEDB is the internal docker bridge address. Dev/seed script.
    payload = {"language": "sql", "command": query}
    if params:
        payload["params"] = params
    r = requests.post(f"{ARCADEDB}/api/v1/command/{DB}", json=payload, auth=AUTH, timeout=30)  # nosemgrep: python.requests.security.no-auth-over-http.no-auth-over-http
    if r.status_code != 200:
        raise Exception(f"ArcadeDB {r.status_code}: {r.text[:300]}")
    return r.json().get("result", [])


def cid():
    return "C" + uuid.uuid4().hex[:8].upper()


# ── Symptom + summary templates keyed by condition ──────────────────────────

_TEMPLATES = {
    "hypertension": [
        {"symptoms": ["headache", "dizziness"],            "triage": "URGENT",  "summary": "Patient reported throbbing headache and dizziness. BP reading 158/96 — above target. Counselled on medication adherence and salt reduction. Follow-up in 2 weeks."},
        {"symptoms": ["blurred vision", "fatigue"],        "triage": "URGENT",  "summary": "Blurred vision and fatigue for 3 days. BP 165/102. Advised to continue amlodipine and add lifestyle counselling. Escalated for facility visit."},
        {"symptoms": ["chest tightness"],                  "triage": "URGENT",  "summary": "Mild chest tightness on exertion. BP 152/94. No radiating pain. Advised rest, medication review, CVD risk assessment scheduled."},
        {"symptoms": ["no symptoms", "routine check"],     "triage": "ROUTINE", "summary": "Routine BP check during home visit. Reading 138/86 — improving. Patient adhering to amlodipine. Encouraged to continue walking daily."},
        {"symptoms": ["swollen ankles"],                   "triage": "ROUTINE", "summary": "Mild ankle swelling. BP 142/88. Likely medication side effect. Discussed with CHW supervisor; no change to regimen recommended."},
    ],
    "diabetes": [
        {"symptoms": ["excessive thirst", "frequent urination"],       "triage": "URGENT",  "summary": "Polydipsia and polyuria for 1 week. Random glucose 14.8 mmol/L. Advised to check fasting glucose next morning. Medication adherence reinforced."},
        {"symptoms": ["blurred vision", "tingling feet"],              "triage": "URGENT",  "summary": "Blurred vision and foot tingling. Glucose 11.9 mmol/L. Suspected early complications. Referred to health post for eye and foot check."},
        {"symptoms": ["hunger", "fatigue"],                            "triage": "ROUTINE", "summary": "Constant hunger and fatigue despite eating. Glucose 10.2 mmol/L. Counselled on carbohydrate portions and metformin timing."},
        {"symptoms": ["wound not healing"],                            "triage": "URGENT",  "summary": "Small foot wound not healing after 2 weeks. Glucose 12.5 mmol/L. Referred urgently to EFSTH for wound care."},
        {"symptoms": ["no symptoms"],                                  "triage": "ROUTINE", "summary": "Routine glucose check. Reading 7.8 mmol/L — well controlled on metformin. Encouraged continued adherence during Ramadan."},
    ],
    "respiratory": [
        {"symptoms": ["cough", "wheezing"],                            "triage": "URGENT",  "summary": "Persistent cough with audible wheeze for 4 days. Advised to use inhaler as needed and avoid dust. Follow-up if worsens."},
        {"symptoms": ["shortness of breath"],                          "triage": "URGENT",  "summary": "Dyspnoea climbing stairs. Inhaler technique reviewed. Counselled on trigger avoidance (smoke, dust). Monitor daily peak flow."},
        {"symptoms": ["chest tightness", "night cough"],               "triage": "URGENT",  "summary": "Chest tightness worse at night. Likely asthma flare. Reviewed inhaler steps. Referred to health post if no improvement in 48h."},
        {"symptoms": ["no symptoms"],                                  "triage": "ROUTINE", "summary": "Routine asthma check. No recent flares. Inhaler use 2×/week. Continue maintenance therapy."},
    ],
    "kidney_disease": [
        {"symptoms": ["leg swelling", "fatigue"],                      "triage": "URGENT",  "summary": "Bilateral leg swelling and persistent fatigue. CKD suspected. Advised low-salt diet, referred for creatinine check at facility."},
        {"symptoms": ["reduced urine output"],                         "triage": "URGENT",  "summary": "Reported reduced urine output for 2 days. BP 160/100. Urgent referral to EFSTH for kidney function panel."},
    ],
    "heart_disease": [
        {"symptoms": ["chest pain on exertion"],                       "triage": "URGENT",  "summary": "Chest pain walking uphill. BP 154/92. Possible angina. Urgent referral to facility for ECG and cardiac assessment."},
        {"symptoms": ["palpitations"],                                 "triage": "URGENT",  "summary": "Intermittent palpitations. BP 148/88. No chest pain. Advised caffeine reduction, referred for cardiac review."},
    ],
    "generic": [
        {"symptoms": ["fever", "body aches"],                          "triage": "ROUTINE", "summary": "Low-grade fever and generalized body aches for 2 days. Likely viral. Advised paracetamol, rest, fluids. Follow up if persists >3 days."},
        {"symptoms": ["stomach pain"],                                 "triage": "ROUTINE", "summary": "Mild epigastric pain after meals. No red flags. Counselled on diet and advised simple antacid if needed."},
        {"symptoms": ["headache"],                                     "triage": "ROUTINE", "summary": "Intermittent headache for 3 days. BP normal. Likely tension-type. Advised hydration, rest, paracetamol."},
        {"symptoms": ["cough", "sore throat"],                         "triage": "ROUTINE", "summary": "URI symptoms. Throat erythematous but no pus. Likely viral. Symptomatic management advised."},
    ],
}

# Pre-clean templates — make them JSON-serializable strings for ArcadeDB
for k in _TEMPLATES:
    for t in _TEMPLATES[k]:
        t["symptoms"] = json.dumps(t["symptoms"])


def _pick_templates_for_patient(patient: dict) -> list:
    """Pick a realistic bundle of consultation templates based on the patient's conditions."""
    conditions_raw = patient.get("conditions") or []
    if isinstance(conditions_raw, str):
        try:
            conditions_raw = json.loads(conditions_raw)
        except Exception:
            conditions_raw = [conditions_raw]
    conditions = [str(c).lower() for c in conditions_raw]

    pool = []
    for c in conditions:
        for key in _TEMPLATES:
            if key in c:
                pool.extend(_TEMPLATES[key])
                break
    # Always include some generics so every patient has variety
    pool.extend(_TEMPLATES["generic"])

    n = random.randint(2, 6)
    return random.sample(pool, min(n, len(pool)))


def _insert_consultation(patient_id: str, template: dict, when: datetime):
    """Insert one consultation via ArcadeDB SQL."""
    started = when.isoformat()
    ended = (when + timedelta(minutes=random.randint(8, 25))).isoformat()
    consultation_id = cid()

    record = {
        "id":                consultation_id,
        "patient_id":        patient_id,
        "session_id":        f"s_{patient_id}_{consultation_id}",
        "started_at":        started,
        "ended_at":          ended,
        "messages":          "[]",
        "symptoms_reported": template["symptoms"],
        "triage_level":      template["triage"],
        "tools_used":        json.dumps(["clinical_assessment"]),
        "recommendations":   template["summary"][:200],
        "followup_scheduled": "",
        "summary":           template["summary"],
    }

    try:
        sql("INSERT INTO ConsultationRecord CONTENT " + json.dumps(record))
        return True
    except Exception as e:
        print(f"  ! failed for {patient_id}: {e}")
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="Max patients to process (0=all)")
    ap.add_argument("--skip-existing", action="store_true", help="Skip patients who already have consultations")
    args = ap.parse_args()

    print(f"Loading all PatientVertex records from {ARCADEDB}/{DB}...")
    offset = 0
    batch_size = 200
    all_patients = []
    while True:
        rows = sql(f"SELECT id, name, conditions FROM PatientVertex LIMIT {batch_size} SKIP {offset}")
        if not rows:
            break
        all_patients.extend(rows)
        if len(rows) < batch_size:
            break
        offset += batch_size

    if args.limit > 0:
        all_patients = all_patients[: args.limit]

    print(f"Found {len(all_patients)} patients")

    total_consults = 0
    total_patients_seeded = 0
    skipped = 0

    now = datetime.utcnow()

    for i, patient in enumerate(all_patients, start=1):
        pid = patient.get("id")
        if not pid:
            continue

        if args.skip_existing:
            existing = sql(
                "SELECT count(*) as cnt FROM ConsultationRecord WHERE patient_id = :pid",
                {"pid": pid},
            )
            if existing and existing[0].get("cnt", 0) > 0:
                skipped += 1
                continue

        templates = _pick_templates_for_patient(patient)
        for j, tpl in enumerate(templates):
            days_ago = random.randint(1, 90)
            when = now - timedelta(days=days_ago, hours=random.randint(0, 23))
            if _insert_consultation(pid, tpl, when):
                total_consults += 1

        # Update the patient's consultation_count + last_consultation
        try:
            sql(
                "UPDATE PatientVertex SET consultation_count = :cnt, last_consultation = :lc "
                "WHERE id = :pid",
                {"cnt": len(templates), "lc": now.isoformat(), "pid": pid},
            )
        except Exception:
            pass

        total_patients_seeded += 1
        if i % 50 == 0:
            print(f"  ... {i}/{len(all_patients)} patients seeded, {total_consults} consultations so far")

    print(f"\nDone.")
    print(f"  Patients seeded: {total_patients_seeded}")
    print(f"  Patients skipped (already had consultations): {skipped}")
    print(f"  Total consultations created: {total_consults}")

    # Final count
    cnt = sql("SELECT count(*) as cnt FROM ConsultationRecord")
    if cnt:
        print(f"  Total ConsultationRecord rows in DB: {cnt[0].get('cnt')}")


if __name__ == "__main__":
    main()
