"""Link 15 seeded mixed patients to the matching caregivers via direct ArcadeDB edge creation."""
import json, requests
from datetime import datetime

ARCADEDB = "http://arcadedb:2480"
DB       = "genie"
AUTH     = ("root", "genieRoot123")


def sql(q, p=None):
    # ARCADEDB is the internal docker bridge address. Dev script.
    payload = {"language": "sql", "command": q}
    if p:
        payload["params"] = p
    r = requests.post(f"{ARCADEDB}/api/v1/command/{DB}", json=payload, auth=AUTH, timeout=10)  # nosemgrep: python.requests.security.no-auth-over-http.no-auth-over-http
    return r.json().get("result", [])


now = datetime.now().isoformat()
cgs = sql("SELECT caregiver_id, name, specialization FROM CaregiverVertex WHERE is_directory_visible = true LIMIT 20")
print(f"Found {len(cgs)} caregivers")

ASSIGNMENTS = [
    ("P_BF9A20B3", "Chronic"),
    ("P_F87C7902", "Chronic"),
    ("P_643EF254", "Chronic"),
    ("P_DE262E3C", "Paediatric"),
    ("P_14FECB88", "Elderly"),
    ("P_EECBE051", "Mental"),
    ("P_D99D86E0", "Maternal"),
    ("P_37B4E216", "Chronic"),
    ("P_3942C449", "Elderly"),
    ("P_8999C8E4", "HIV"),
    ("P_B2D12EDF", "Nutrition"),
    ("P_DBF484FC", "HIV"),
    ("P_AA551A8D", "Maternal"),
    ("P_4317DA99", "Paediatric"),
    ("P_013D6DB4", "Reproductive"),
]


def find_cg(spec):
    for c in cgs:
        if spec.lower() in (c.get("specialization") or "").lower():
            return c
    return cgs[0]


linked = 0
for pid, spec in ASSIGNMENTS:
    cg    = find_cg(spec)
    cg_id = cg["caregiver_id"]
    cg_nm = cg["name"]

    existing = sql(
        "SELECT count(*) as cnt FROM CaregiverPatientEdge "
        "WHERE patient_id = :p AND caregiver_id = :c AND is_revoked = false",
        {"p": pid, "c": cg_id},
    )
    if existing and int(existing[0].get("cnt", 0)) > 0:
        print(f"  skip  {pid} already linked to {cg_nm}")
        continue
    try:
        sql(
            "CREATE EDGE CaregiverPatientEdge "
            "FROM (SELECT FROM CaregiverVertex WHERE caregiver_id = :cid) "
            "TO (SELECT FROM PatientVertex WHERE id = :pid) "
            "SET patient_id = :pid, caregiver_id = :cid, "
            "permissions = :perms, consent_date = :now, "
            "granted_by = :gb, is_revoked = false, note = :note",
            {
                "cid":   cg_id,
                "pid":   pid,
                "perms": json.dumps(["vitals", "medications", "consultations", "alerts"]),
                "now":   now,
                "gb":    "seed_script",
                "note":  "Seeded via seed_mixed_patients.py",
            },
        )
        print(f"  linked {pid} -> {cg_nm}")
        linked += 1
    except Exception as exc:
        print(f"  FAIL  {pid}: {exc}")

print(f"\nDone — {linked}/{len(ASSIGNMENTS)} patients linked to caregivers")
