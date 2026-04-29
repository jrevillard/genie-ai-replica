"""
AMINA Care — Seed recent ConsultationRecord rows for demo visibility
========================================================================
The demo DB has 3667 ConsultationRecord rows scattered across Jan–Apr 2026
but none on the last 3 days (the container's "today" is 2026-04-18). That
makes the DHIS2 Integration panel show 0s for "Today's Metrics (live)"
even though the roll-up pipeline works end-to-end.

This script adds a small number of realistic consultations PER DAY for
the 7 days up to the container's today so:

  * /dhis2/metrics/today shows meaningful numbers
  * Push Now (no date param) rolls up actual data
  * The 7-day history in the admin panel has material to render

Safety properties
-----------------
  * Pure inserts — no updates, no deletes, respects the no-data-deletion rule.
  * Idempotent — skips a day if it already has >= MIN_PER_DAY rows.
  * Uses existing patient_ids (no orphan consultations).
  * Random-but-reasonable triage distribution matching WHO PEN expectations
    (~70% routine, ~20% CHW_VISIT, ~8% FACILITY, ~2% EMERGENCY).

Usage
-----
  python scripts/seed_recent_consultations.py
  python scripts/seed_recent_consultations.py --days 14 --per-day 25
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List

import requests

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


ARCADE_URL = os.getenv("ARCADE_URL", "http://localhost:2480")
DB         = os.getenv("ARCADE_DB",  "genie")
AUTH       = (os.getenv("ARCADE_USER", "root"),
              os.getenv("ARCADE_PASS", "genieRoot123"))


# ── Distributions ────────────────────────────────────────────────────────────

# WHO PEN-ish weighted triage: most consultations are routine/CHW, very few
# are genuine emergencies. These weights give a demo pattern close to what
# a CHW network would see in the field.
TRIAGE_WEIGHTS = [
    ("EMERGENCY", 0.02),
    ("FACILITY",  0.08),
    ("CHW_VISIT", 0.20),
    ("SELF_CARE", 0.45),
    ("ROUTINE",   0.25),
]
TRIAGE_LEVELS = [t[0] for t in TRIAGE_WEIGHTS]
TRIAGE_PROBS  = [t[1] for t in TRIAGE_WEIGHTS]

# Realistic symptom patterns for each triage level.
SYMPTOMS_BY_TRIAGE = {
    "EMERGENCY": ["chest pain", "severe breathing difficulty", "stroke signs",
                  "blood sugar 42", "BP 210/120"],
    "FACILITY":  ["fever 39.5", "persistent vomiting", "BP 170/100",
                  "blood sugar 280", "dizziness + weakness"],
    "CHW_VISIT": ["missed meds this week", "BP 150/95", "blood sugar 170",
                  "dizzy + nauseated", "chest tightness 2 days"],
    "SELF_CARE": ["mild headache", "tired", "cough 2 days",
                  "slight ankle swelling", "trouble sleeping"],
    "ROUTINE":   ["monthly BP check", "medication refill", "diet review",
                  "glucose logbook review", "follow-up on last visit"],
}


# ── ArcadeDB helper ──────────────────────────────────────────────────────────

def sql(stmt: str, params: Dict[str, Any] = None) -> List[Dict[str, Any]]:
    body = {"language": "sql", "command": stmt}
    if params:
        body["params"] = params
    r = requests.post(f"{ARCADE_URL}/api/v1/command/{DB}",
                      json=body, auth=AUTH, timeout=20)
    if r.status_code != 200:
        raise RuntimeError(f"ArcadeDB {r.status_code}: {r.text[:300]}")
    return (r.json() or {}).get("result", []) or []


# ── Core ─────────────────────────────────────────────────────────────────────

def container_today() -> datetime:
    """The CONTAINER's wall-clock today. Returned as a date-only datetime."""
    return datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)


def pick_patient_pool(limit: int = 120) -> List[Dict[str, Any]]:
    """Grab a mix of patients with a region set (aggregator groups by region)."""
    rows = sql(
        "SELECT id, name, region, conditions FROM PatientVertex "
        "WHERE region IS NOT NULL AND region <> '' "
        f"LIMIT {int(limit)}"
    )
    return [r for r in rows if r.get("id")]


def count_consultations_on(day: str) -> int:
    """Count of ConsultationRecord rows with started_at starting with `day`."""
    res = sql(
        "SELECT count(*) AS n FROM ConsultationRecord "
        "WHERE started_at LIKE :p",
        {"p": f"{day}%"},
    )
    return int((res[0] if res else {}).get("n", 0) or 0)


def insert_consultation(row: Dict[str, Any]) -> None:
    # Minimal INSERT; rely on ArcadeDB dynamic typing for everything non-core.
    sql(
        "INSERT INTO ConsultationRecord SET "
        "id = :id, patient_id = :pid, session_id = :sid, "
        "started_at = :s, ended_at = :e, "
        "symptoms_reported = :symp, triage_level = :tr, "
        "tools_used = :tools, recommendations = :rec, "
        "followup_scheduled = :fu, summary = :sum",
        row,
    )


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7,
                    help="Days back from container-today to seed (default 7)")
    ap.add_argument("--per-day", type=int, default=14,
                    help="Target consultations per day (default 14)")
    ap.add_argument("--min-per-day", type=int, default=8,
                    help="Skip a day that already has this many (default 8)")
    args = ap.parse_args()

    print("=" * 60)
    print("  AMINA — Seed recent consultations for demo visibility")
    print("=" * 60)

    today = container_today()
    print(f"  Container today:   {today.date()}")
    print(f"  Days to cover:     {args.days}")
    print(f"  Target per day:    {args.per_day}")
    print(f"  Skip if already >= {args.min_per_day}\n")

    patients = pick_patient_pool(limit=200)
    if not patients:
        print("  [fail] no patients with region set — aborting")
        return 2
    print(f"  Patient pool: {len(patients)} candidates\n")

    rng = random.Random(0xA11F4)   # reproducible seed per run
    grand_total = 0
    per_day_stats = []

    for offset in range(args.days):
        day_dt   = today - timedelta(days=offset)
        day_str  = day_dt.strftime("%Y-%m-%d")
        existing = count_consultations_on(day_str)
        if existing >= args.min_per_day:
            per_day_stats.append((day_str, existing, 0, "skipped"))
            continue

        need = args.per_day - existing
        print(f"  {day_str}  existing={existing}  adding={need}")
        created = 0
        for _ in range(need):
            p = rng.choice(patients)
            triage = rng.choices(TRIAGE_LEVELS, weights=TRIAGE_PROBS, k=1)[0]
            symptom = rng.choice(SYMPTOMS_BY_TRIAGE[triage])
            hour = rng.randint(6, 20)
            minute = rng.randint(0, 59)
            second = rng.randint(0, 59)

            row = {
                "id":    f"C_{uuid.uuid4().hex[:10].upper()}",
                "pid":   p["id"],
                "sid":   f"s_seed_{p['id']}_{day_dt.strftime('%Y%m%d')}_{rng.randint(1000,9999)}",
                "s":     day_dt.replace(hour=hour, minute=minute, second=second).isoformat(),
                "e":     day_dt.replace(hour=hour, minute=min(59, minute + rng.randint(2, 15)),
                                         second=second).isoformat(),
                "symp":  symptom,
                "tr":    triage,
                "tools": json.dumps(["search_knowledge", "assess_triage"]),
                "rec":   json.dumps([{"step": "see recommendation", "done": False}]),
                "fu":    rng.choice([True, False, False]),
                "sum":   f"Seed consultation ({triage}) — {symptom}",
            }
            try:
                insert_consultation(row)
                created += 1
            except Exception as e:
                print(f"    [warn] insert failed: {e}")
        per_day_stats.append((day_str, existing, created, "ok"))
        grand_total += created

    print()
    print("=" * 60)
    print("  SUMMARY")
    print("=" * 60)
    print(f"  {'Day':<12} {'Existing':>10} {'Added':>8}  Status")
    print(f"  {'-'*12} {'-'*10} {'-'*8}  {'-'*8}")
    for day, existing, added, status in per_day_stats:
        print(f"  {day:<12} {existing:>10} {added:>8}  {status}")
    print(f"\n  Grand total added: {grand_total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
