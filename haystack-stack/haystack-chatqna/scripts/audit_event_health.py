"""
AMINA — audit-event-store health probe (AUDIT-010 anchor).

Read-only operator tool. Prints the in-process audit-write counters
exposed by `audit_event_store.audit_health_snapshot()`. The counters
are per-process (per uvicorn worker), so a real alerting setup will
need to scrape every worker — see docs/compliance/AUDIT_FAILURE_ALERTING.md
for the operator runbook.

Usage:

    docker exec haystack-chatqna python /app/scripts/audit_event_health.py
    docker exec haystack-chatqna python /app/scripts/audit_event_health.py --json

Exit codes:
    0 — counters were successfully read.
    2 — module not importable / unexpected failure.
"""
from __future__ import annotations

import argparse
import json
import os
import sys


def main() -> int:
    p = argparse.ArgumentParser(
        description="Audit-event-store health probe",
    )
    p.add_argument(
        "--json", action="store_true",
        help="Emit a single-line JSON snapshot.",
    )
    args = p.parse_args()

    _HERE = os.path.dirname(os.path.abspath(__file__))
    _APP = os.path.dirname(_HERE)
    if _APP not in sys.path:
        sys.path.insert(0, _APP)

    try:
        from src.services.audit_event_store import audit_health_snapshot
    except Exception as e:
        sys.stderr.write(f"[audit_event_health] import failure: {e}\n")
        return 2

    snap = audit_health_snapshot()

    if args.json:
        sys.stdout.write(json.dumps(snap, separators=(",", ":")) + "\n")
        return 0

    bar = "─" * 56
    print(bar)
    print(" Audit-event-store — local health probe")
    print(bar)
    print(f"  total_attempts       : {snap['total_attempts']}")
    print(f"  failed_db            : {snap['failed_db']}")
    print(f"  failed_validation    : {snap['failed_validation']}")
    print(f"  redactions           : {snap['redactions']}")
    print(f"  last_failure_at      : {snap['last_failure_at'] or '-'}")
    print(f"  last_failure_reason  : {snap['last_failure_reason'] or '-'}")
    print(bar)
    print(f"  has_recent_db_failure        : {snap['has_recent_db_failure']}")
    print(f"  has_recent_validation_failure: {snap['has_recent_validation_failure']}")
    print(bar)
    print()
    print("  Counters are per-uvicorn-worker. A full AUDIT-010 closure")
    print("  needs an external alert sink that scrapes every worker;")
    print("  see docs/compliance/AUDIT_FAILURE_ALERTING.md.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
