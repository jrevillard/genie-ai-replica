import requests, json

ARCADEDB = "http://arcadedb:2480"
DB = "genie"
AUTH = ("root", "genieRoot123")

def sql(q, p=None):
    # ARCADEDB is the internal docker bridge address. Dev script.
    payload = {"language": "sql", "command": q}
    if p: payload["params"] = p
    r = requests.post(f"{ARCADEDB}/api/v1/command/{DB}", json=payload, auth=AUTH, timeout=10)  # nosemgrep: python.requests.security.no-auth-over-http.no-auth-over-http
    return r.json().get("result", [])

# Find Test Cg
rows = sql("SELECT caregiver_id, name, phone, specialization, region, patient_limit FROM CaregiverVertex LIMIT 50")
print("ALL CAREGIVERS:")
for r in rows:
    print(f"  id={r.get('caregiver_id')} | name={r.get('name')} | phone={r.get('phone')} | spec={r.get('specialization')}")

print()
# Also check by login to find the test caregiver account
rows2 = sql("SELECT caregiver_id, name, phone FROM CaregiverVertex WHERE name = 'Test Cg' OR name LIKE 'Test%' OR phone LIKE '+220%test%' LIMIT 5")
print("TEST CG SEARCH:")
for r in rows2:
    print(f"  {r}")
