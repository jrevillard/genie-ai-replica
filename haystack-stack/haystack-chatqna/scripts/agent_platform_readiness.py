#!/usr/bin/env python3
"""
AMINA Agent Platform Phase 3 — readiness CLI.

Prints the current Agent Platform readiness snapshot as JSON, plus a
human-readable warnings summary. Exit code is 0 unless an `error`-
severity warning is present (then 1).

Run from anywhere:
    python scripts/agent_platform_readiness.py            # full JSON + warnings
    python scripts/agent_platform_readiness.py --json     # JSON only
    python scripts/agent_platform_readiness.py --warnings # warnings only

No PHI, no provider calls, no secrets. Safe to invoke at boot or in
health checks.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

# Make `src.*` importable regardless of CWD.
_HERE = os.path.dirname(os.path.abspath(__file__))
_PARENT = os.path.dirname(_HERE)
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)

from src.agent_platform.readiness import snapshot   # noqa: E402


def _print_warnings(warnings):
    if not warnings:
        print("[readiness] no warnings.")
        return
    print(f"[readiness] {len(warnings)} warning(s):")
    for w in warnings:
        sev = w.get("severity", "info").upper()
        code = w.get("code", "")
        msg = w.get("message", "")
        print(f"  [{sev:5}] {code}: {msg}")


def main() -> int:
    p = argparse.ArgumentParser(
        description="AMINA Agent Platform readiness snapshot",
    )
    p.add_argument("--json",     action="store_true",
                   help="Output the full JSON snapshot only (no warnings header).")
    p.add_argument("--warnings", action="store_true",
                   help="Print warnings only (no JSON snapshot).")
    args = p.parse_args()

    snap = snapshot()

    if args.json:
        json.dump(snap, sys.stdout, indent=2, sort_keys=True)
        sys.stdout.write("\n")
    elif args.warnings:
        _print_warnings(snap.get("warnings", []))
    else:
        print("=" * 64)
        print("AMINA Agent Platform — readiness snapshot")
        print("=" * 64)
        json.dump(snap, sys.stdout, indent=2, sort_keys=True)
        sys.stdout.write("\n\n")
        _print_warnings(snap.get("warnings", []))

    return 0 if snap.get("ok", True) else 1


if __name__ == "__main__":
    sys.exit(main())
