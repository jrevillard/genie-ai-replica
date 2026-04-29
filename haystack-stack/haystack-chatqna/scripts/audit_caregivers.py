#!/usr/bin/env python3
"""
Audit existing caregiver accounts.
====================================
Lists every CaregiverVertex in ArcadeDB with:
  - caregiver_id + name
  - phone (exactly as stored — that's what `/caregiver/login` matches on)
  - linked patient ids (via the CaresFor edge / list-for-caregiver helper)
  - whether access is revoked
  - created_at, last_login

Prints a summary table of login-ready rows (non-revoked + at least one
linked patient) so we know what credentials actually work right now.

Usage:
    python scripts/audit_caregivers.py
"""
from __future__ import annotations
import sys
import json
import requests

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


ARC_URL  = "http://localhost:2480"
ARC_DB   = "genie"
ARC_USER = "root"
ARC_PW   = "genieRoot123"


def _sql(cmd: str, params: dict | None = None):
    resp = requests.post(
        f"{ARC_URL}/api/v1/command/{ARC_DB}",
        json={"language": "sql", "command": cmd, "params": params or {}},
        auth=(ARC_USER, ARC_PW),
        timeout=20,
    )
    try:
        return resp.json().get("result", [])
    except Exception:
        return []


def main():
    print("=" * 92)
    print("  AMINA — Caregiver audit")
    print("=" * 92)

    # Pull every caregiver vertex
    cgs = _sql("SELECT caregiver_id, name, phone, relationship, "
               "patient_limit, created_at, last_login, is_revoked "
               "FROM CaregiverVertex")
    print(f"  Found {len(cgs)} CaregiverVertex rows\n")

    rows_out = []
    for cg in cgs:
        cid = cg.get("caregiver_id")
        # Linked patients (both directions — whichever edge pattern this build uses)
        linked = _sql(
            "SELECT id, name, phone FROM "
            "(SELECT expand(in('CaresFor')) FROM CaregiverVertex "
            " WHERE caregiver_id = :cid)",
            {"cid": cid},
        )
        if not linked:
            linked = _sql(
                "SELECT id, name, phone FROM "
                "(SELECT expand(out('CaresFor')) FROM CaregiverVertex "
                " WHERE caregiver_id = :cid)",
                {"cid": cid},
            )
        if not linked:
            # Fallback: look for edges by any name
            edges = _sql(
                "SELECT out, in FROM E WHERE @class LIKE 'CaresFor%' "
                "AND (out.caregiver_id = :cid OR in.caregiver_id = :cid)",
                {"cid": cid},
            ) or []
            linked = []

        rows_out.append({
            "caregiver_id": cid,
            "name":         cg.get("name"),
            "phone":        cg.get("phone"),
            "relationship": cg.get("relationship"),
            "is_revoked":   bool(cg.get("is_revoked")),
            "created_at":   cg.get("created_at"),
            "linked":       [
                {"id": p.get("id"), "name": p.get("name")}
                for p in (linked or [])
            ],
        })

    # Print a readable table
    print(f"  {'caregiver_id':<14} {'name':<25} {'phone':<20} {'revoked':<8} {'#pts':<4} linked patients")
    print("  " + "-" * 86)
    ready_for_login = []
    for r in rows_out:
        print(f"  {r['caregiver_id']:<14} {r['name'][:23]:<25} {r['phone']:<20} "
              f"{('YES' if r['is_revoked'] else 'no'):<8} {len(r['linked']):<4} "
              f"{', '.join(p['name'] or '?' for p in r['linked']) or '— (unlinked)'}")
        if not r["is_revoked"] and r["linked"]:
            ready_for_login.append(r)

    print()
    print("=" * 92)
    print(f"  LOGIN-READY CAREGIVERS  ({len(ready_for_login)} usable)")
    print("=" * 92)
    print("  For each, use EXACTLY the phone string shown + the 4-digit PIN it")
    print("  was registered with. PIN is hashed in Arcade — we cannot recover it.")
    print()
    print(f"  {'name':<26} {'phone (login input)':<22} caregiver_id   linked to")
    print("  " + "-" * 86)
    for r in ready_for_login:
        print(f"  {r['name'][:24]:<26} {r['phone']:<22} {r['caregiver_id']:<14} "
              f"{', '.join(p['name'] or '?' for p in r['linked'])}")

    if not ready_for_login:
        print("  (none — every caregiver row is either revoked or unlinked)")

    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
