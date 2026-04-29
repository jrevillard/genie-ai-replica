#!/usr/bin/env python3
"""
AMINA Care — Literacy Demo Account Seeder
===========================================
Creates four demo accounts, one for every supported mode, so the team
can jump between experiences without running the onboarding gate:

  1. beginner   — Ousman Dem       (illiterate, big-tile BeginnerShell)
  2. basic      — Fatou Ceesay     (upper-basic, simplified chrome)
  3. advanced   — Lamin Jallow     (senior-sec, full UI)
  4. caregiver  — Sarah Care       (CHW linked to the beginner patient)

Each patient is created through the public signup API and then has a
LiteracyProfileVertex written directly to ArcadeDB with a pre-approved
level, which skips both the onboarding gate and admin review. The
caregiver is provisioned through the normal invite/register flow.

Usage:
    # From host (ArcadeDB port 2480 exposed by docker-compose):
    python scripts/seed_literacy_demo_accounts.py

    # From inside the haystack-chatqna container:
    python scripts/seed_literacy_demo_accounts.py \
        --api http://localhost:8000 --arcade http://arcadedb:2480

    # Against a remote stack:
    python scripts/seed_literacy_demo_accounts.py \
        --api http://your-server:8000 --arcade http://your-server:2480
"""

import argparse
import json
import sys
from datetime import datetime

import requests

# Windows consoles default to cp1252 and choke on em-dashes / box chars used
# in our banners. Force UTF-8 so the script is safe to run from PowerShell,
# git-bash, and Linux containers alike.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


# ── Config defaults ──────────────────────────────────────────────────────────

DEFAULT_API     = "http://localhost:8000"
DEFAULT_ARCADE  = "http://localhost:2480"
DEFAULT_DB      = "genie"
DEFAULT_ARC_USR = "root"
DEFAULT_ARC_PWD = "genieRoot123"


# ── Demo catalogue ───────────────────────────────────────────────────────────
#
# The `declared_level` column feeds LiteracyProfileVertex.declared_level.
# The `mode` column is the current_mode the frontend will read. Both are
# written with status = "approved" so no admin review is needed.

DEMO_PATIENTS = [
    {
        "email":          "beginner@demo.aminacare",
        "password":       "Demo2026",
        "name":           "Ousman Dem",
        "age":            65,
        "gender":         "male",
        "region":         "Kanifing",
        "conditions":     ["hypertension"],
        "language":       "english",
        "declared_level": "none",
        "mode":           "beginner",
        "tagline":        "No formal education — big-tile BeginnerShell",
    },
    {
        "email":          "basic@demo.aminacare",
        "password":       "Demo2026",
        "name":           "Fatou Ceesay",
        "age":            48,
        "gender":         "female",
        "region":         "Banjul",
        "conditions":     ["diabetes", "hypertension"],
        "language":       "english",
        "declared_level": "upper_basic",
        "mode":           "basic",
        "tagline":        "Upper-basic school — simplified chrome",
    },
    {
        "email":          "advanced@demo.aminacare",
        "password":       "Demo2026",
        "name":           "Lamin Jallow",
        "age":            52,
        "gender":         "male",
        "region":         "Kanifing",
        "conditions":     ["heart_disease"],
        "language":       "english",
        "declared_level": "senior_sec",
        "mode":           "advanced",
        "tagline":        "Senior secondary — full clinician UI",
    },
]

# Caregiver is linked to the beginner patient so the caregiver demo has
# a realistic "assisting someone who cannot read" storyline.
DEMO_CAREGIVER = {
    "name":            "Sarah Care",
    "phone":           "+220 9000042",    # distinct from seed_caregiver_account.py
    "pin":             "4242",
    "relationship":    "chw",
    "patient_email":   "beginner@demo.aminacare",
    "patient_password": "Demo2026",
    "permissions":     ["vitals", "medications", "alerts", "consultations"],
    "note":            "Demo caregiver for literacy showcase",
    "tagline":         "CHW linked to the beginner-mode patient",
}


# ── Pretty output ────────────────────────────────────────────────────────────

OK   = "\033[92m[OK]\033[0m"
WARN = "\033[93m[..]\033[0m"
FAIL = "\033[91m[!!]\033[0m"


def banner(text: str) -> None:
    bar = "=" * 60
    print(f"\n{bar}\n  {text}\n{bar}")


def line(text: str = "") -> None:
    print(f"  {text}")


# ── HTTP / SQL helpers ───────────────────────────────────────────────────────

def signup_patient(api: str, patient: dict) -> dict:
    """POST /auth/signup/email. Returns the backend JSON body."""
    payload = {k: patient[k] for k in (
        "email", "password", "name", "age", "gender",
        "region", "conditions", "language",
    )}
    r = requests.post(f"{api}/api/v1/auth/signup/email", json=payload, timeout=15)
    return r.json()


def login_patient(api: str, email: str, password: str) -> dict | None:
    r = requests.post(
        f"{api}/api/v1/auth/login/email",
        json={"email": email, "password": password},
        timeout=15,
    )
    if r.status_code != 200:
        return None
    return r.json()


def arcade_sql(arcade: str, db: str, auth: tuple, sql: str, params: dict | None = None) -> list:
    payload = {"language": "sql", "command": sql}
    if params:
        payload["params"] = params
    r = requests.post(
        f"{arcade}/api/v1/command/{db}",
        json=payload,
        auth=auth,
        timeout=15,
    )
    if r.status_code != 200:
        raise RuntimeError(f"ArcadeDB {r.status_code}: {r.text[:400]}")
    return (r.json() or {}).get("result", []) or []


def literacy_profile_exists(arcade, db, auth, patient_id) -> bool:
    rows = arcade_sql(
        arcade, db, auth,
        "SELECT patient_id FROM LiteracyProfileVertex WHERE patient_id = :pid LIMIT 1",
        {"pid": patient_id},
    )
    return bool(rows)


def upsert_literacy_profile(arcade, db, auth, patient_id, declared_level, mode) -> None:
    """
    Write an approved LiteracyProfileVertex so the frontend skips both the
    onboarding gate (needs_onboarding = not declared_level) and admin
    review (status = approved). Idempotent.
    """
    now = datetime.utcnow().isoformat() + "Z"
    note = f"seeded demo account — {mode} mode"

    if literacy_profile_exists(arcade, db, auth, patient_id):
        arcade_sql(
            arcade, db, auth,
            "UPDATE LiteracyProfileVertex SET "
            "declared_level = :lvl, verified_level = :lvl, current_mode = :mode, "
            "status = 'approved', verified_by = 'seed-script', verified_at = :t, "
            "updated_at = :t, reviewer_note = :note "
            "WHERE patient_id = :pid",
            {
                "lvl": declared_level, "mode": mode, "t": now,
                "note": note, "pid": patient_id,
            },
        )
        return

    record = {
        "patient_id":     patient_id,
        "declared_level": declared_level,
        "verified_level": declared_level,
        "current_mode":   mode,
        "status":         "approved",
        "verified_by":    "seed-script",
        "verified_at":    now,
        "created_at":     now,
        "updated_at":     now,
        "reviewer_note":  note,
    }
    # CONTENT-form INSERT mirrors how literacy_service.declare_level writes
    # new rows — ArcadeDB accepts a JSON literal after CONTENT.
    arcade_sql(
        arcade, db, auth,
        "INSERT INTO LiteracyProfileVertex CONTENT " + json.dumps(record),
    )


# ── Step runners ─────────────────────────────────────────────────────────────

def seed_patient(api, arcade, db, arc_auth, patient) -> tuple[bool, str | None]:
    line(f"Patient: {patient['name']} <{patient['email']}>  ->  {patient['mode']}")

    # 1. Create via signup API (idempotent: duplicate e-mail is handled).
    resp = signup_patient(api, patient)
    patient_id: str | None = None

    if resp.get("success"):
        patient_id = resp.get("patient", {}).get("id")
        line(f"  {OK} signup   id={patient_id}")
    else:
        err = resp.get("error") or ""
        if "already registered" in err:
            line(f"  {WARN} signup   already exists, logging in to recover id")
            login = login_patient(api, patient["email"], patient["password"])
            if not login:
                line(f"  {FAIL} could not log in to recover patient_id")
                return False, None
            patient_id = login.get("patient", {}).get("id") or login.get("sub")
            line(f"  {OK} login    id={patient_id}")
        else:
            line(f"  {FAIL} signup failed: {err or resp}")
            return False, None

    if not patient_id:
        line(f"  {FAIL} no patient_id returned from backend")
        return False, None

    # 2. Write LiteracyProfileVertex directly so mode is ready on first login.
    try:
        upsert_literacy_profile(
            arcade, db, arc_auth,
            patient_id=patient_id,
            declared_level=patient["declared_level"],
            mode=patient["mode"],
        )
        line(f"  {OK} literacy {patient['mode']} ({patient['declared_level']}) approved")
    except Exception as e:
        line(f"  {FAIL} literacy write failed: {e}")
        return False, patient_id

    return True, patient_id


def seed_caregiver(api, cg) -> bool:
    banner("Caregiver — linked to beginner patient")
    line(f"Name   : {cg['name']}")
    line(f"Phone  : {cg['phone']}")
    line(f"Tagline: {cg['tagline']}")

    # Step 1: log in as the patient that will host the invite.
    login = login_patient(api, cg["patient_email"], cg["patient_password"])
    if not login:
        line(f"  {FAIL} could not log in as {cg['patient_email']} to mint invite")
        return False
    token = login.get("token") or login.get("access_token")
    if not token:
        line(f"  {FAIL} login response missing token: {login}")
        return False
    line(f"  {OK} patient login ok")

    # Step 2: generate an invite code.
    r = requests.post(
        f"{api}/api/v1/caregiver/invite",
        headers={"Authorization": f"Bearer {token}"},
        json={"permissions": cg["permissions"], "note": cg["note"]},
        timeout=15,
    )
    if r.status_code != 200:
        line(f"  {FAIL} invite failed: {r.status_code} {r.text[:200]}")
        return False
    invite_code = (r.json() or {}).get("invite_code")
    if not invite_code:
        line(f"  {FAIL} no invite_code in response: {r.text[:200]}")
        return False
    line(f"  {OK} invite code {invite_code}")

    # Step 3: register caregiver — if already present, fall back to login.
    r = requests.post(
        f"{api}/api/v1/caregiver/register",
        json={
            "invite_code":  invite_code,
            "phone":        cg["phone"],
            "name":         cg["name"],
            "pin":          cg["pin"],
            "relationship": cg["relationship"],
        },
        timeout=15,
    )
    if r.status_code == 200:
        line(f"  {OK} caregiver registered id={r.json().get('caregiver_id')}")
        return True
    if r.status_code == 409:
        line(f"  {WARN} caregiver phone already registered, verifying login")
        r2 = requests.post(
            f"{api}/api/v1/caregiver/login",
            json={"phone": cg["phone"], "pin": cg["pin"]},
            timeout=15,
        )
        if r2.status_code == 200:
            line(f"  {OK} caregiver login verified")
            return True
        line(f"  {FAIL} login after conflict failed: {r2.status_code} {r2.text[:200]}")
        return False
    line(f"  {FAIL} register failed: {r.status_code} {r.text[:200]}")
    return False


# ── Entry point ──────────────────────────────────────────────────────────────

def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--api",      default=DEFAULT_API,
                   help="Backend base URL (default: %(default)s)")
    p.add_argument("--arcade",   default=DEFAULT_ARCADE,
                   help="ArcadeDB base URL (default: %(default)s)")
    p.add_argument("--db",       default=DEFAULT_DB,
                   help="ArcadeDB database (default: %(default)s)")
    p.add_argument("--arc-user", default=DEFAULT_ARC_USR)
    p.add_argument("--arc-pass", default=DEFAULT_ARC_PWD)
    args = p.parse_args()

    api    = args.api.rstrip("/")
    arcade = args.arcade.rstrip("/")
    db     = args.db
    auth   = (args.arc_user, args.arc_pass)

    banner("AMINA Care — Literacy Demo Account Seeder")
    line(f"API    : {api}")
    line(f"Arcade : {arcade}  db={db}")

    # Sanity: ArcadeDB reachable before we even touch the API.
    try:
        arcade_sql(arcade, db, auth, "SELECT 1 AS ok")
        line(f"  {OK} ArcadeDB reachable")
    except Exception as e:
        line(f"  {FAIL} ArcadeDB unreachable: {e}")
        line("        Hint: pass --arcade http://arcadedb:2480 inside a container,")
        line("              or make sure port 2480 is exposed on the host.")
        return 2

    # ── Patients ─────────────────────────────────────────────────────────────
    banner("Patients — beginner / basic / advanced")
    results: list[tuple[dict, bool]] = []
    for patient in DEMO_PATIENTS:
        ok, _pid = seed_patient(api, arcade, db, auth, patient)
        results.append((patient, ok))
        print()

    # ── Caregiver ────────────────────────────────────────────────────────────
    cg_ok = seed_caregiver(api, DEMO_CAREGIVER)

    # ── Credentials summary ──────────────────────────────────────────────────
    banner("DEMO CREDENTIALS")
    line("Patients — Email / Password login:")
    line()
    line(f"  {'Mode':<10} {'Email':<32} {'Password':<12} {'Name':<20}")
    line(f"  {'-'*10} {'-'*32} {'-'*12} {'-'*20}")
    for patient, ok in results:
        mark = "" if ok else "  [FAILED]"
        line(
            f"  {patient['mode']:<10} "
            f"{patient['email']:<32} "
            f"{patient['password']:<12} "
            f"{patient['name']:<20}{mark}"
        )
        line(f"  {'':<10} {patient['tagline']}")
    line()
    line("Caregiver — Phone / PIN login (use 'Caregiver Login' screen):")
    line()
    line(f"  Name  : {DEMO_CAREGIVER['name']}")
    line(f"  Phone : {DEMO_CAREGIVER['phone']}   (country +220, number 9000042)")
    line(f"  PIN   : {DEMO_CAREGIVER['pin']}")
    line(f"  Links : {DEMO_CAREGIVER['patient_email']}")
    if not cg_ok:
        line(f"  {FAIL} caregiver was NOT seeded successfully")
    print()

    # Exit 0 only if everything succeeded.
    all_ok = all(ok for _, ok in results) and cg_ok
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
