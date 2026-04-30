"""
AMINA — backup verification (read-only) — Phase 9, OPS-006 anchor.

Walks a configured backup directory and reports presence / freshness
/ size / count for the operator. Never restores. Never deletes.
Never prints secrets.

Intended to be wired into a periodic cron / scheduled job by the
pilot operator. The script itself only reads; the cadence + alerting
is the operator's job (matches AUDIT-010 pattern).

Usage:

    docker exec haystack-chatqna python /app/scripts/backup_verifier.py
    docker exec haystack-chatqna python /app/scripts/backup_verifier.py --json
    docker exec haystack-chatqna python /app/scripts/backup_verifier.py --backup-dir /backups/arcade

Exit codes:
    0 — backup directory readable; report emitted (regardless of freshness).
    2 — backup directory missing or unreadable.

Configuration:
    Default backup dir: $AMINA_BACKUP_DIR or /app/backups
    Default freshness threshold: $AMINA_BACKUP_MAX_AGE_HOURS or 36 hours.

Operator notes:
    - This script does NOT verify backup integrity (no zip-test, no
      sha256 against an expected manifest). Doing so safely requires
      a known-good manifest + a low-privilege scratch directory; both
      are operator-side decisions and not implemented in this build.
    - This script does NOT verify backup encryption-at-rest (PRIV-005).
      Encryption is the operator's responsibility.
    - When both conditions land, OPS-006 can move from 🟡 partial
      → ✅ complete. Until then, the freshness/presence report ships
      and the operator runs zip-integrity tests separately.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Any, Dict, List, Optional


def _scan_dir(backup_dir: str) -> Dict[str, Any]:
    """Return aggregate stats. Never lists individual filenames if
    they could be PHI-bearing; the file basename pattern in this repo
    is `genie-backup-YYYYMMDD-HHMMSS.zip` — opaque."""
    if not os.path.isdir(backup_dir):
        return {"ok": False, "reason": "backup_dir_missing", "path": backup_dir}

    try:
        entries = os.listdir(backup_dir)
    except Exception as e:
        return {"ok": False, "reason": f"listdir_failed: {repr(e)[:120]}",
                "path": backup_dir}

    total_files = 0
    total_bytes = 0
    newest_mtime: Optional[float] = None
    newest_name: Optional[str] = None
    file_kinds: Dict[str, int] = {}
    for name in entries:
        path = os.path.join(backup_dir, name)
        try:
            st = os.stat(path)
        except Exception:
            continue
        if not (st.st_mode & 0o170000) == 0o100000:  # regular file
            # Skip dirs / symlinks; alert separately if needed.
            continue
        total_files += 1
        total_bytes += st.st_size
        if newest_mtime is None or st.st_mtime > newest_mtime:
            newest_mtime = st.st_mtime
            newest_name = name
        # Classify by extension.
        _, ext = os.path.splitext(name)
        ext = (ext or "").lower().lstrip(".") or "(none)"
        file_kinds[ext] = file_kinds.get(ext, 0) + 1

    return {
        "ok":              True,
        "path":            backup_dir,
        "file_count":      total_files,
        "total_bytes":     total_bytes,
        "newest_basename": newest_name,
        "newest_mtime_unix": int(newest_mtime) if newest_mtime else None,
        "newest_age_seconds": (
            int(time.time() - newest_mtime) if newest_mtime else None
        ),
        "file_kinds":      file_kinds,
    }


def _verdict(stats: Dict[str, Any], max_age_hours: int) -> Dict[str, Any]:
    if not stats.get("ok"):
        return {"verdict": "fail", "reason": stats.get("reason")}
    if stats.get("file_count", 0) == 0:
        return {"verdict": "stale", "reason": "no_backups_present"}
    age = stats.get("newest_age_seconds") or 0
    threshold = max_age_hours * 3600
    if age > threshold:
        return {
            "verdict": "stale",
            "reason": f"newest_backup_older_than_{max_age_hours}h",
            "newest_age_seconds": age,
        }
    return {
        "verdict": "fresh",
        "reason": "ok",
        "newest_age_seconds": age,
    }


def main() -> int:
    p = argparse.ArgumentParser(description="AMINA backup verifier (read-only)")
    p.add_argument(
        "--backup-dir",
        default=os.getenv("AMINA_BACKUP_DIR") or "/app/backups",
    )
    p.add_argument(
        "--max-age-hours", type=int,
        default=int(os.getenv("AMINA_BACKUP_MAX_AGE_HOURS", "36")),
    )
    p.add_argument("--json", action="store_true",
                   help="Emit a single-line JSON report.")
    args = p.parse_args()

    stats = _scan_dir(args.backup_dir)
    verdict = _verdict(stats, args.max_age_hours)

    report = {
        "backup_dir":       args.backup_dir,
        "max_age_hours":    args.max_age_hours,
        "stats":            stats,
        "verdict":          verdict,
    }

    if args.json:
        print(json.dumps(report, separators=(",", ":")))
    else:
        bar = "─" * 60
        print(bar)
        print(" Backup verifier — read-only")
        print(bar)
        print(f"  backup_dir       : {args.backup_dir}")
        print(f"  max_age_hours    : {args.max_age_hours}")
        if stats.get("ok"):
            print(f"  file_count       : {stats['file_count']}")
            print(f"  total_bytes      : {stats['total_bytes']}")
            print(f"  newest_basename  : {stats.get('newest_basename') or '-'}")
            age = stats.get("newest_age_seconds")
            print(f"  newest_age_secs  : {age if age is not None else '-'}")
            print(f"  file_kinds       : {stats.get('file_kinds', {})}")
        else:
            print(f"  scan failed      : {stats.get('reason')}")
        print(bar)
        print(f"  verdict          : {verdict['verdict'].upper()}")
        print(f"  reason           : {verdict.get('reason')}")
        print(bar)
        print()
        print("  Notes:")
        print("    - Read-only. Never restores. Never deletes.")
        print("    - Does NOT verify zip integrity (operator runs that).")
        print("    - Does NOT verify encryption-at-rest (PRIV-005).")
        print()

    if stats.get("ok"):
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
