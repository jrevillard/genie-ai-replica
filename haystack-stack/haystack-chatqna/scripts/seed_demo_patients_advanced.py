#!/usr/bin/env python3
"""
Advanced demo patients — 5 richer Gambia-context profiles.
===========================================================
Each profile exercises a DIFFERENT clinical scenario so the demo
dashboard shows variety in one run:

  1. Complex elder       — multi-morbidity, near-cap ledgers, low BP-control
  2. Cardiac rehab       — post-MI, interaction-heavy dual-path
  3. Antenatal           — pregnancy care, scout-age, good adherence
  4. HIV chronic care    — ART on plan, consistent check-ins
  5. Youth asthma scout  — under-25 so the scout-apply flow actually
                           lands in the Alkalo inbox

On top of the basic seed the earlier script writes, this one also:
  - seeds 2-3 members into each Bantaba circle (so the circle is
    ALREADY populated when the patient logs in)
  - fills supply ledger to 8/10 for the elder (so 'cap warning' UX
    is visible)
  - queues THREE add-member requests per patient with different
    relations so the Alkalo's inbox has a realistic triage queue
  - submits a SCOUT APPLICATION from patient #5 with full locality +
    availability + reason so the Alkalo can approve and see the
    full redesigned flow with a real applicant_id

Idempotent — safe to re-run; existing accounts are reused.

Usage:
    python scripts/seed_demo_patients_advanced.py
"""
from __future__ import annotations
import argparse
import base64
import json
import sys
import time
import requests

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


DEFAULT_API = "http://localhost:8000"


# ─── 5 advanced Gambia-context profiles ─────────────────────────────

PATIENTS = [
    {
        "email":      "mariama.sanneh@demo.aminacare",
        "password":   "MariamaSanneh2026",
        "name":       "Mariama Sanneh",
        "age":        72,
        "gender":     "female",
        "region":     "Kanifing",
        "conditions": ["hypertension", "diabetes", "early CKD"],
        "language":   "english",
        "profile":    "complex_elder",
    },
    {
        "email":      "alhaji.bah@demo.aminacare",
        "password":   "AlhajiBah2026",
        "name":       "Alhaji Bah",
        "age":        58,
        "gender":     "male",
        "region":     "Banjul",
        "conditions": ["post-MI cardiac rehab", "hypertension"],
        "language":   "english",
        "profile":    "cardiac_rehab",
    },
    {
        "email":      "adama.jatta@demo.aminacare",
        "password":   "AdamaJatta2026",
        "name":       "Adama Jatta",
        "age":        24,
        "gender":     "female",
        "region":     "Brikama",
        "conditions": ["pregnancy — antenatal care", "mild anaemia"],
        "language":   "english",
        "profile":    "antenatal",
    },
    {
        "email":      "modou.ndong@demo.aminacare",
        "password":   "ModouNdong2026",
        "name":       "Modou Ndong",
        "age":        41,
        "gender":     "male",
        "region":     "Serrekunda",
        "conditions": ["HIV — on ART"],
        "language":   "english",
        "profile":    "hiv_care",
    },
    {
        "email":      "sulayman.fofana@demo.aminacare",
        "password":   "SulaymanFofana2026",
        "name":       "Sulayman Fofana",
        "age":        19,
        "gender":     "male",
        "region":     "Bakau",
        "conditions": ["asthma"],
        "language":   "english",
        "profile":    "youth_scout_candidate",
    },
]


# Per-profile supply packs (designed around the conditions).
SUPPLY_BY_PROFILE = {
    "complex_elder": [
        {"medication_name": "Lisinopril 10mg",       "tablets_remaining": 21,
         "cost_per_pack": "35 dalasi / 30",
         "refill_location": "Kanifing pharmacy", "in_stock": True},
        {"medication_name": "Hydrochlorothiazide",   "tablets_remaining": 6,
         "cost_per_pack": "18 dalasi / 30",
         "refill_location": "Kanifing pharmacy", "in_stock": True},
        {"medication_name": "Metformin 1000mg",      "tablets_remaining": 58,
         "cost_per_pack": "55 dalasi / 60",
         "refill_location": "MRC Fajara", "in_stock": True},
        {"medication_name": "Calcium carbonate",     "tablets_remaining": 14,
         "cost_per_pack": "22 dalasi / 30",
         "refill_location": "Village kiosk", "in_stock": True},
        {"medication_name": "Vitamin D3",            "tablets_remaining": 4,
         "cost_per_pack": "30 dalasi / 30",
         "refill_location": "Banjul Hospital pharmacy", "in_stock": False},
        {"medication_name": "Amlodipine 10mg",       "tablets_remaining": 27,
         "cost_per_pack": "25 dalasi / 30",
         "refill_location": "Kanifing pharmacy", "in_stock": True},
        {"medication_name": "Paracetamol PRN",       "tablets_remaining": 10,
         "cost_per_pack": "10 dalasi / 20",
         "refill_location": "Village kiosk", "in_stock": True},
    ],
    "cardiac_rehab": [
        {"medication_name": "Aspirin 75mg",          "tablets_remaining": 28,
         "cost_per_pack": "12 dalasi / 30",
         "refill_location": "Banjul Hospital pharmacy", "in_stock": True},
        {"medication_name": "Atorvastatin 40mg",     "tablets_remaining": 30,
         "cost_per_pack": "95 dalasi / 30",
         "refill_location": "Banjul Hospital pharmacy", "in_stock": True},
        {"medication_name": "Bisoprolol 5mg",        "tablets_remaining": 21,
         "cost_per_pack": "40 dalasi / 30",
         "refill_location": "Banjul Hospital pharmacy", "in_stock": True},
        {"medication_name": "Clopidogrel 75mg",      "tablets_remaining": 15,
         "cost_per_pack": "110 dalasi / 30",
         "refill_location": "Banjul Hospital pharmacy", "in_stock": True},
    ],
    "antenatal": [
        {"medication_name": "Folic acid 5mg",        "tablets_remaining": 42,
         "cost_per_pack": "15 dalasi / 60",
         "refill_location": "Brikama antenatal clinic", "in_stock": True},
        {"medication_name": "Ferrous sulphate",      "tablets_remaining": 30,
         "cost_per_pack": "18 dalasi / 60",
         "refill_location": "Brikama antenatal clinic", "in_stock": True},
        {"medication_name": "Calcium supplement",    "tablets_remaining": 25,
         "cost_per_pack": "22 dalasi / 30",
         "refill_location": "Brikama antenatal clinic", "in_stock": True},
    ],
    "hiv_care": [
        {"medication_name": "Dolutegravir + TDF/3TC","tablets_remaining": 30,
         "cost_per_pack": "free — MRC program",
         "refill_location": "MRC clinic Fajara", "in_stock": True},
        {"medication_name": "Cotrimoxazole",         "tablets_remaining": 28,
         "cost_per_pack": "free — MRC program",
         "refill_location": "MRC clinic Fajara", "in_stock": True},
        {"medication_name": "Vitamin B-complex",     "tablets_remaining": 20,
         "cost_per_pack": "25 dalasi / 30",
         "refill_location": "Serrekunda pharmacy", "in_stock": True},
    ],
    "youth_scout_candidate": [
        {"medication_name": "Salbutamol inhaler",    "tablets_remaining": 180,
         "cost_per_pack": "45 dalasi / inhaler",
         "refill_location": "Bakau health post", "in_stock": True},
        {"medication_name": "Beclomethasone inhaler","tablets_remaining": 200,
         "cost_per_pack": "120 dalasi / inhaler",
         "refill_location": "Bakau health post", "in_stock": True},
    ],
}


DUALPATH_BY_PROFILE = {
    "complex_elder": {
        "traditional": [
            {"practitioner": "Alhaji Sillah (marabout)",
             "practices": "Prayers, black seed oil",
             "last_visit_days_ago": 5,
             "notes": "Used for sleep quality; review monthly."},
            {"practitioner": "Aja Bojang (herbalist)",
             "practices": "Moringa infusion, bitter leaf tea",
             "last_visit_days_ago": 18, "notes": "Blood sugar support."},
        ],
        "modern": [
            {"facility": "Kanifing Health Centre", "chw_name": "VHW Mariama",
             "medications": "Amlodipine 10mg + HCTZ 25mg",
             "last_visit_days_ago": 4, "notes": "BP slow to come down."},
            {"facility": "MRC Gambia Unit Fajara", "chw_name": "Dr Faye",
             "medications": "Metformin + Glargine insulin",
             "last_visit_days_ago": 14, "notes": "HbA1c improving."},
        ],
        "interaction": [
            {"safe": False,
             "notes": "Licorice root would raise BP — patient advised to avoid."},
            {"safe": True,
             "notes": "Moringa moderate hypoglycaemia — safe with metformin + close fasting-sugar watch."},
        ],
        "progress": [
            {"bp_current": "168/102", "months_on_plan": 0,
             "notes": "Baseline on referral."},
            {"bp_current": "154/96",  "months_on_plan": 2,
             "notes": "Added HCTZ."},
            {"bp_current": "146/92",  "months_on_plan": 4,
             "notes": "Amlodipine up-titrated to 10mg."},
            {"bp_current": "141/88",  "months_on_plan": 6,
             "notes": "Trend favorable; keep plan."},
        ],
    },
    "cardiac_rehab": {
        "traditional": [
            {"practitioner": "Local marabout",
             "practices": "Post-recovery prayer circle",
             "last_visit_days_ago": 7, "notes": "Emotional support only."},
        ],
        "modern": [
            {"facility": "Banjul Hospital cardiology", "chw_name": "Dr Sanneh",
             "medications": "Aspirin, Atorvastatin, Bisoprolol, Clopidogrel",
             "last_visit_days_ago": 10,
             "notes": "6-week post-MI review; clinically stable."},
        ],
        "interaction": [
            {"safe": True,
             "notes": "No overlap between prescribed regimen and local teas."},
        ],
        "progress": [
            {"bp_current": "155/92", "months_on_plan": 0, "notes": "Discharge reading."},
            {"bp_current": "138/82", "months_on_plan": 1, "notes": "4-week follow-up."},
            {"bp_current": "128/78", "months_on_plan": 2, "notes": "Cardiac rehab going well."},
        ],
    },
    "antenatal": {
        "traditional": [
            {"practitioner": "Kaddy Jallow (TBA)",
             "practices": "Herbal steam bath, prenatal massage",
             "last_visit_days_ago": 12, "notes": "Safe regimen; reviewed."},
        ],
        "modern": [
            {"facility": "Brikama antenatal clinic", "chw_name": "CHW Fatou",
             "medications": "Folic acid + Iron",
             "last_visit_days_ago": 6,
             "notes": "24 weeks; mild anaemia; Hb 10.1."},
        ],
        "interaction": [
            {"safe": True,
             "notes": "Herbal steam bath poses no interaction with supplements."},
        ],
        "progress": [
            {"bp_current": "118/76", "months_on_plan": 2, "notes": "Booking BP."},
            {"bp_current": "122/78", "months_on_plan": 4, "notes": "Normal trend."},
            {"bp_current": "120/74", "months_on_plan": 6, "notes": "Stable antenatal."},
        ],
    },
    "hiv_care": {
        "traditional": [
            {"practitioner": "Village herbalist",
             "practices": "Moringa infusion",
             "last_visit_days_ago": 20, "notes": "Patient reports energy boost."},
        ],
        "modern": [
            {"facility": "MRC HIV clinic Fajara", "chw_name": "Nurse Ramatoulie",
             "medications": "Dolutegravir + TDF/3TC + Cotrimoxazole",
             "last_visit_days_ago": 15,
             "notes": "VL undetectable; CD4 climbing."},
        ],
        "interaction": [
            {"safe": True,
             "notes": "Moringa — no known interaction with DTG-based ART."},
        ],
        "progress": [
            {"bp_current": "124/80", "months_on_plan": 3, "notes": "BP normal; adherence 95%."},
            {"bp_current": "120/78", "months_on_plan": 6, "notes": "Continuing ART; monitor kidney."},
        ],
    },
    "youth_scout_candidate": {
        "traditional": [],
        "modern": [
            {"facility": "Bakau health post", "chw_name": "VHW Nyima",
             "medications": "Salbutamol inhaler PRN",
             "last_visit_days_ago": 22, "notes": "Peak flow stable."},
        ],
        "interaction": [],
        "progress": [
            {"bp_current": "112/72", "months_on_plan": 1, "notes": "Peak flow 420; trigger tracking."},
        ],
    },
}


# Bantaba pre-seeded members (added by admin on behalf of the patient).
BANTABA_MEMBERS_BY_PROFILE = {
    "complex_elder": [
        {"name": "Awa Ceesay",    "age": 48, "conditions": ["hypertension"]},
        {"name": "Modou Sanneh",  "age": 50, "conditions": ["diabetes"]},
        {"name": "Aminata Bah",   "age": 62, "conditions": []},
    ],
    "cardiac_rehab": [
        {"name": "Aja Bah",       "age": 54, "conditions": ["hypertension"]},
        {"name": "Lamin Bah Jr.", "age": 29, "conditions": []},
    ],
    "antenatal": [
        {"name": "Awa Jatta",     "age": 45, "conditions": []},
        {"name": "Isatou Jatta",  "age": 20, "conditions": []},
    ],
    "hiv_care": [
        {"name": "Fatou Ndong",   "age": 39, "conditions": []},
    ],
    "youth_scout_candidate": [
        {"name": "Grandmother Nyima", "age": 70, "conditions": ["hypertension"]},
        {"name": "Aunt Bintou",       "age": 48, "conditions": ["diabetes"]},
    ],
}


# Extra "add-member" requests that should sit in the Alkalo inbox.
BANTABA_REQUESTS_BY_PROFILE = {
    "complex_elder": [
        {"candidate_name": "Grandmother Fatoumata", "candidate_age": 68,
         "candidate_conditions": ["hypertension"],
         "relation": "sister-in-law",
         "reason": "We live in the same compound and share meals — she needs support with salt."},
    ],
    "cardiac_rehab": [
        {"candidate_name": "Alhaji Ebrima",  "candidate_age": 62,
         "candidate_conditions": [],
         "relation": "compound_elder",
         "reason": "He leads Friday prayers with me and walks every evening — I want us to support each other."},
    ],
    "antenatal": [
        {"candidate_name": "Aunt Nyima",     "candidate_age": 52,
         "candidate_conditions": [],
         "relation": "aunt",
         "reason": "She watches my older son while I go to antenatal clinic."},
    ],
    "hiv_care": [
        {"candidate_name": "Brother Ousman", "candidate_age": 39,
         "candidate_conditions": [],
         "relation": "brother",
         "reason": "We are on ART together and remind each other of doses."},
    ],
    "youth_scout_candidate": [
        {"candidate_name": "Mama Fatou",     "candidate_age": 44,
         "candidate_conditions": [],
         "relation": "mother",
         "reason": "She manages my asthma triggers at home — she knows what sets me off."},
    ],
}


# ─── helpers ─────────────────────────────────────────────────────────

def _signup(api, p):
    return requests.post(
        f"{api}/api/v1/auth/signup/email",
        json={
            "email":    p["email"],   "password":   p["password"],
            "name":     p["name"],    "age":        p["age"],
            "gender":   p["gender"],  "region":     p["region"],
            "conditions": p["conditions"], "language": p["language"],
        }, timeout=15,
    )


def _login(api, email, password):
    r = requests.post(
        f"{api}/api/v1/auth/login/email",
        json={"email": email, "password": password}, timeout=15,
    )
    return (r.json() or {}).get("token", "")


def _admin_tok(api):
    return _login(api, "admin@demo.aminacare", "Amina2026")


def _pid_from_jwt(tok):
    try:
        segs = tok.split(".")
        pad = "=" * (-len(segs[1]) % 4)
        return json.loads(base64.urlsafe_b64decode(segs[1] + pad)).get("sub", "")
    except Exception:
        return ""


def _session_for(patient_id: str) -> str:
    return f"s_demo_adv_{patient_id}"


def _seed_supply(api, sid, admin_h, meds):
    n = 0
    for med in meds:
        r = requests.post(
            f"{api}/api/v1/care/supply_ledger/{sid}/add",
            headers=admin_h, json={**med, "role": "clinician"}, timeout=10,
        )
        if r.status_code == 200: n += 1
    return n


def _seed_dualpath(api, sid, admin_h, dp):
    total = 0
    for type_, entries in dp.items():
        for e in entries:
            r = requests.post(
                f"{api}/api/v1/care/dualpath_ledger/{sid}/{type_}/add",
                headers=admin_h, json={**e, "role": "vhw"}, timeout=10,
            )
            if r.status_code == 200: total += 1
    return total


def _bantaba_ensure(api, pt_tok):
    pt_h = {"Authorization": f"Bearer {pt_tok}", "Content-Type": "application/json"}
    r = requests.get(f"{api}/api/v1/community/bantaba/mine", headers=pt_h, timeout=10)
    return r.json() if r.ok else {}


def _bantaba_add_members(api, circle_id, admin_h, members):
    n = 0
    for m in members:
        r = requests.post(
            f"{api}/api/v1/community/bantaba/members?circle_id={circle_id}",
            headers=admin_h,
            json={"name": m["name"], "age": m["age"],
                  "conditions": m.get("conditions") or [], "role": "alkalo"},
            timeout=10,
        )
        if r.status_code == 200: n += 1
    return n


def _bantaba_submit_requests(api, pt_tok, requests_list):
    pt_h = {"Authorization": f"Bearer {pt_tok}", "Content-Type": "application/json"}
    n = 0
    for req in requests_list:
        r = requests.post(
            f"{api}/api/v1/community/bantaba/members/request",
            headers=pt_h, json=req, timeout=10,
        )
        if r.status_code == 200: n += 1
    return n


def _submit_scout_application(api, pt_tok, name, age):
    pt_h = {"Authorization": f"Bearer {pt_tok}", "Content-Type": "application/json"}
    syn_name = f"{name.split()[0]}_{int(time.time()*1000) % 1_000_000}"
    r = requests.post(
        f"{api}/api/v1/community/scout/apply",
        headers=pt_h,
        json={
            "name":         syn_name,
            "age":          min(age, 24),
            "village":      "Bakau",
            "phone":        "+220 300 2026",
            "locality":     "Bakau beach compound",
            "availability": "After Friday prayers, evenings Mon-Fri",
            "reason":       "My asthma is under control and I want to help elders in my compound. I know the beach area well.",
        }, timeout=10,
    )
    return r.json() if r.ok else {"error": r.text[:160]}


# ─── main ───────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default=DEFAULT_API)
    args = ap.parse_args()

    print("=" * 76)
    print("  AMINA — Seed 5 ADVANCED demo patients (varied clinical scenarios)")
    print("=" * 76)
    print(f"  API: {args.api}\n")

    admin_tok = _admin_tok(args.api)
    if not admin_tok:
        print("  [FAIL] admin-patient login failed.")
        return 1
    admin_h = {"Authorization": f"Bearer {admin_tok}", "Content-Type": "application/json"}

    results = []

    for p in PATIENTS:
        print(f"─── {p['name']}  ({p['profile']}) ───")
        # 1. signup (idempotent)
        sr = _signup(args.api, p)
        if sr.status_code == 200:
            print("    [OK]   signup created")
        else:
            body = sr.json() if sr.content else {}
            if "already" in str(body).lower() or sr.status_code == 409:
                print("    [SKIP] account exists — reusing")
            else:
                print(f"    [WARN] signup http={sr.status_code}  {body}")

        # 2. login
        tok = _login(args.api, p["email"], p["password"])
        if not tok:
            print("    [FAIL] could not log in; skipping.")
            continue
        pid = _pid_from_jwt(tok)
        print(f"    [OK]   login  pid={pid}")

        # 3. Bantaba + members + requests
        circle = _bantaba_ensure(args.api, tok)
        cid    = circle.get("circle_id") or pid
        name_  = circle.get("name")
        n_mem  = _bantaba_add_members(args.api, cid, admin_h,
                                       BANTABA_MEMBERS_BY_PROFILE.get(p["profile"], []))
        n_req  = _bantaba_submit_requests(args.api, tok,
                                           BANTABA_REQUESTS_BY_PROFILE.get(p["profile"], []))
        print(f"    [OK]   bantaba circle='{name_}'  +{n_mem} members  +{n_req} requests")

        # 4. supply + dualpath ledgers against demo session
        sid = _session_for(pid) if pid else f"s_demo_adv_{p['email']}"
        n_sup = _seed_supply(args.api, sid, admin_h,
                             SUPPLY_BY_PROFILE.get(p["profile"], []))
        n_dp  = _seed_dualpath(args.api, sid, admin_h,
                               DUALPATH_BY_PROFILE.get(p["profile"], {}))
        print(f"    [OK]   supply +{n_sup}  dualpath +{n_dp}  sid={sid}")

        # 5. Scout application for under-25 youth (profile #5 specifically).
        scout_app_id = None
        if p["age"] < 25 and p["profile"] == "youth_scout_candidate":
            res = _submit_scout_application(args.api, tok, p["name"], p["age"])
            scout_app_id = ((res.get("application") or {}).get("app_id"))
            print(f"    [OK]   scout application queued  app_id={scout_app_id}")

        results.append({
            "name": p["name"], "email": p["email"], "password": p["password"],
            "profile": p["profile"], "age": p["age"],
            "pid": pid, "session_id": sid,
            "circle_id": cid, "circle_name": name_,
            "members": n_mem, "requests": n_req,
            "supply": n_sup, "dualpath": n_dp,
            "scout_app_id": scout_app_id,
        })
        print()

    # ── Credentials summary ──────────────────────────────────────────
    print("=" * 76)
    print("  LOGIN CREDENTIALS  (AuthScreen → Email tab)")
    print("=" * 76)
    print(f"  {'Name':<20}{'Scenario':<24}{'Email':<34}{'Password'}")
    print("  " + "-" * 72)
    for r in results:
        print(f"  {r['name']:<20}{r['profile']:<24}{r['email']:<34}{r['password']}")
    print()
    print(f"  {'Name':<20}{'pid':<14}{'demo session':<30}{'Bantaba name'}")
    print("  " + "-" * 72)
    for r in results:
        print(f"  {r['name']:<20}{(r['pid'] or '—'):<14}{(r['session_id'] or '—'):<30}{r['circle_name'] or '—'}")

    print()
    print(f"  {'Name':<20}{'Supply':<10}{'DualPath':<12}{'Circle mem.':<14}{'Requests':<12}{'Scout app.'}")
    print("  " + "-" * 72)
    for r in results:
        print(f"  {r['name']:<20}+{r['supply']:<9}+{r['dualpath']:<11}+{r['members']:<13}+{r['requests']:<11}"
              f"{r['scout_app_id'] or '—'}")

    print()
    print("=" * 76)
    print("  DevTools snippets — paste after login to jump to the seeded session")
    print("=" * 76)
    for r in results:
        if r.get("session_id"):
            print(f"  // {r['name']} ({r['profile']})")
            print(f"  localStorage.setItem('AMINA_SID', {r['session_id']!r}); location.reload();")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
