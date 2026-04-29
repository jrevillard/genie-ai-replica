#!/usr/bin/env python3
"""
Reset caregiver PINs to known values.
=====================================
PINs are hashed (sha256-with-salt) in CaregiverVertex.pin_hash, so we
can't recover them — but we CAN overwrite them by computing a fresh
hash with the same helper the login path uses (`_hash_pin` in
`caregiver_repo.py`).

This script runs *inside the container* (so it can import the repo
helpers directly) and:
  1. Looks up every caregiver by phone
  2. Generates a fresh salt + hash for each
  3. Writes pin_hash + pin_salt back via SQL
  4. Verifies login works with the new PIN

Usage:
    docker exec haystack-chatqna python /app/scripts/reset_caregiver_pins.py

or via the host helper wrapper (which bind-mounts this script):
    python scripts/reset_caregiver_pins.py

The output is a login table you can paste into docs.
"""
from __future__ import annotations
import sys
import uuid
import hashlib
import hmac


def _hash_pin(pin: str, salt: str) -> str:
    return hmac.new(salt.encode(), pin.encode(), hashlib.sha256).hexdigest()


# Fixed phone → PIN mapping. Simple numeric PINs so they're easy to
# remember + type. All Gambia numbers on the +220 country code.
RESETS = [
    ("+2203110001", "1111", "Fatou Jallow"),
    ("+2203110002", "2222", "Ousman Ceesay"),
    ("+2203110003", "3333", "Aminata Drammeh"),
    ("+2203110004", "4444", "Lamin Sanyang"),
    ("+2203110005", "5555", "Mariama Bah"),
    ("+2203110006", "6666", "Ebrima Bojang"),
    ("+2203110007", "7777", "Adama Touray"),
    ("+2203110008", "8888", "Binta Jobarteh"),
]


def main():
    # Use the real repo helpers so we stay in sync with whatever
    # hash/salt scheme the running build uses.
    sys.path.insert(0, "/app")
    from src.repositories.caregiver_repo import CaregiverRepository, _hash_pin as repo_hash
    from src.db.arcade_client import execute_sql as _sql

    repo = CaregiverRepository()

    print("=" * 80)
    print("  Reset caregiver PINs to known values")
    print("=" * 80)

    results = []
    for phone, pin, expected_name in RESETS:
        cg = repo.get_by_phone(phone)
        if not cg:
            results.append((phone, pin, expected_name, "NOT_FOUND", "", []))
            print(f"  [SKIP] {phone}  not found")
            continue

        salt = uuid.uuid4().hex[:16]
        pin_hash = repo_hash(pin, salt)

        _sql(
            "UPDATE CaregiverVertex SET pin_hash = :ph, pin_salt = :ps "
            "WHERE caregiver_id = :cid",
            {"ph": pin_hash, "ps": salt, "cid": cg["caregiver_id"]},
        )

        # Verify
        v = repo.verify_pin(phone, pin)
        ok = bool(v)

        linked = repo.get_patients_for_caregiver(cg["caregiver_id"]) or []
        linked_ids = [p.get("id") for p in linked]

        results.append((phone, pin, cg["name"], "OK" if ok else "VERIFY_FAILED",
                        cg["caregiver_id"], linked_ids))
        print(f"  [{'OK' if ok else 'FAIL'}]  {phone}  pin={pin}  "
              f"{cg['name']}  linked={len(linked_ids)} patient(s)")

    print()
    print("=" * 80)
    print("  CAREGIVER LOGIN CREDENTIALS (after reset)")
    print("=" * 80)
    print("  AuthScreen → Caregiver Login tab → select 🇬🇲 Gambia (+220) →")
    print("  type the 7-digit LOCAL number (no country code), then the PIN.")
    print()
    print(f"  {'Name':<20}{'Country':<12}{'Phone input':<16}{'PIN':<6}linked patient(s)")
    print("  " + "-" * 72)
    for phone, pin, name, status, cid, pts in results:
        if status != "OK":
            continue
        # Strip +220 so we show what the user should TYPE in the box.
        local = phone.replace("+220", "").replace(" ", "")
        print(f"  {name:<20}{'+220 (GM)':<12}{local:<16}{pin:<6}"
              f"{', '.join(pts) or '—'}")

    print()
    print("  NOTE: the PHONE input field on the login page is LOCAL digits only.")
    print("        The app prepends '+220' automatically when you pick Gambia.")
    print("        Typing '2203110004' would be wrong — use '3110004'.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
