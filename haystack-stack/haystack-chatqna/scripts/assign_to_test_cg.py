"""
Assign all 15 seeded mixed patients to Test Cg (CG_DFAF5F89).
- Revokes any existing caregiver links first.
- Renames patients whose surname/first-name clashes with a seeded caregiver.
- Prints full login credentials table at the end.
"""
import json, requests
from datetime import datetime

ARCADEDB = "http://arcadedb:2480"
DB       = "genie"
AUTH     = ("root", "genieRoot123")
TEST_CG  = "CG_DFAF5F89"

def sql(q, p=None):
    payload = {"language": "sql", "command": q}
    if p: payload["params"] = p
    r = requests.post(f"{ARCADEDB}/api/v1/command/{DB}", json=payload, auth=AUTH, timeout=10)
    if r.status_code != 200:
        raise Exception(f"ArcadeDB {r.status_code}: {r.text[:200]}")
    return r.json().get("result", [])

now = datetime.now().isoformat()

# ── Name clash fixes ──────────────────────────────────────────────────────────
# Caregiver names: Fatou Jallow, Ousman Ceesay, Aminata Drammeh, Lamin Sanyang,
#                  Mariama Bah, Ebrima Bojang, Adama Touray, Binta Jobarteh
# Patients with conflicting first OR last names get renamed.

RENAMES = {
    # patient_id : (old_name, new_name)
    "P_14FECB88": ("Dawda Ceesay",    "Dawda Baldeh"),     # surname clash: Ousman Ceesay
    "P_EECBE051": ("Sira Drammeh",    "Sira Kanteh"),      # surname clash: Aminata Drammeh
    "P_37B4E216": ("Yusupha Jobarteh","Yusupha Hydara"),   # surname clash: Binta Jobarteh
    "P_8999C8E4": ("Aminata Bah",     "Aminata Colley"),   # first+surname clash: Aminata Drammeh / Mariama Bah
    "P_B2D12EDF": ("Momodou Ceesay (father — child proxy)",
                   "Momodou Dibba (father — child proxy)"), # surname clash: Ousman Ceesay
}

# ── Patients list ─────────────────────────────────────────────────────────────
PATIENT_IDS = [
    "P_BF9A20B3", "P_F87C7902", "P_643EF254", "P_DE262E3C", "P_14FECB88",
    "P_EECBE051", "P_D99D86E0", "P_37B4E216", "P_3942C449", "P_8999C8E4",
    "P_B2D12EDF", "P_DBF484FC", "P_AA551A8D", "P_4317DA99", "P_013D6DB4",
]

print("=" * 60)
print("  Assign 15 patients to Test Cg (CG_DFAF5F89)")
print("=" * 60)

# Step 1 — Apply renames
print("\n── Name clash fixes ──")
for pid, (old, new) in RENAMES.items():
    try:
        sql("UPDATE PatientVertex SET name = :n WHERE id = :pid", {"n": new, "pid": pid})
        print(f"  ✔  {old}  →  {new}")
    except Exception as e:
        print(f"  ✘  {old}: {e}")

# Step 2 — Revoke all existing caregiver edges + link to Test Cg
print("\n── Linking to Test Cg ──")
linked = 0
for pid in PATIENT_IDS:
    # Revoke all existing edges for this patient
    try:
        sql(
            "UPDATE CaregiverPatientEdge SET is_revoked = true, revoked_at = :t "
            "WHERE patient_id = :pid AND caregiver_id != :cg AND is_revoked = false",
            {"t": now, "pid": pid, "cg": TEST_CG},
        )
    except Exception:
        pass  # may have no edges

    # Check if already linked to Test Cg
    existing = sql(
        "SELECT count(*) as cnt FROM CaregiverPatientEdge "
        "WHERE patient_id = :pid AND caregiver_id = :cg AND is_revoked = false",
        {"pid": pid, "cg": TEST_CG},
    )
    if existing and int(existing[0].get("cnt", 0)) > 0:
        print(f"  —  {pid}: already under Test Cg")
        linked += 1
        continue

    try:
        sql(
            "CREATE EDGE CaregiverPatientEdge "
            "FROM (SELECT FROM CaregiverVertex WHERE caregiver_id = :cg) "
            "TO   (SELECT FROM PatientVertex   WHERE id = :pid) "
            "SET patient_id = :pid, caregiver_id = :cg, "
            "permissions = :perms, consent_date = :now, "
            "granted_by = 'admin', is_revoked = false, "
            "note = 'Assigned to Test Cg via assign_to_test_cg.py'",
            {
                "cg":    TEST_CG,
                "pid":   pid,
                "perms": json.dumps(["vitals", "medications", "consultations", "alerts"]),
                "now":   now,
            },
        )
        print(f"  ✔  {pid}: linked to Test Cg")
        linked += 1
    except Exception as e:
        print(f"  ✘  {pid}: {e}")

print(f"\n  {linked}/15 patients now under Test Cg")

# Step 3 — Print credentials table
print("\n" + "=" * 60)
print("  LOGIN CREDENTIALS  (all password: Amina2026)")
print("=" * 60)

rows = sql(
    "SELECT id, name, age, gender, region, email, triage_status FROM PatientVertex "
    "WHERE id IN :ids LIMIT 20",
    {"ids": PATIENT_IDS},
)

# Build lookup
info = {r["id"]: r for r in rows}

EMAILS = {
    "P_BF9A20B3": "ousman.konateh@aminacare.dev",
    "P_F87C7902":  "ndey.fatty@aminacare.dev",
    "P_643EF254":  "karamo.sanneh@aminacare.dev",
    "P_DE262E3C":  "binta.touray@aminacare.dev",
    "P_14FECB88":  "dawda.ceesay@aminacare.dev",
    "P_EECBE051":  "sira.drammeh@aminacare.dev",
    "P_D99D86E0":  "isatou.njie@aminacare.dev",
    "P_37B4E216":  "yusupha.jobarteh@aminacare.dev",
    "P_3942C449":  "haddijatou.camara@aminacare.dev",
    "P_8999C8E4":  "aminata.bah@aminacare.dev",
    "P_B2D12EDF":  "momodou.ceesay.father@aminacare.dev",
    "P_DBF484FC":  "bakary.sanyang@aminacare.dev",
    "P_AA551A8D":  "sainabou.fofana@aminacare.dev",
    "P_4317DA99":  "adama.manneh@aminacare.dev",
    "P_013D6DB4":  "fatoumatta.darboe@aminacare.dev",
}

TRIAGE_LABEL = {
    "EMERGENCY": "🔴 EMERGENCY",
    "FACILITY":  "🟠 FACILITY",
    "CHW_VISIT": "🟡 CHW_VISIT",
    "SELF_CARE": "🟢 SELF_CARE",
    None: "—",
}

print(f"\n  {'#':<3} {'Name':<38} {'Age':<5} {'Status':<16} {'Email'}")
print(f"  {'-'*3} {'-'*38} {'-'*5} {'-'*16} {'-'*40}")

for i, pid in enumerate(PATIENT_IDS, 1):
    p     = info.get(pid, {})
    name  = p.get("name") or RENAMES.get(pid, (None, None))[1] or pid
    age   = p.get("age", "?")
    ts    = TRIAGE_LABEL.get(p.get("triage_status"), p.get("triage_status", "—"))
    email = EMAILS.get(pid, "—")
    print(f"  {i:<3} {name:<38} {str(age):<5} {ts:<16} {email}")

print(f"\n  Password: Amina2026  (all accounts)")
print("=" * 60)
