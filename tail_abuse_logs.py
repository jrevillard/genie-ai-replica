#!/usr/bin/env python3
"""AMINA — live abuse-defense log tail for the showcase.

One-command pretty-printed tail of every classification the abuse
defender is making. Use it in a side terminal during a demo so you
can show what the regex / semantic layer is detecting in real time.

Usage:

    python tail_abuse_logs.py            # pretty tail of today's shadow JSONL
    python tail_abuse_logs.py --raw      # raw JSON lines
    python tail_abuse_logs.py --abuse    # only is_abuse=true rows
    python tail_abuse_logs.py --audit    # admin audit log instead

Press Ctrl+C to stop.

Sample output:

  20:27:26.190  P_7E454858      directed_abuse     sev=high    matched=[insult_at_ai, hard_profanity_at_ai]
  20:27:35.412  P_7E454858      clean              sev=none    matched=[]
  20:28:01.873  P_7E454858      health_frustration sev=low     matched=[profanity, health_context]

Requires: docker on PATH, container 'haystack-chatqna' running.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import subprocess
import sys


CONTAINER = "haystack-chatqna"


def _date_today_utc() -> str:
    return _dt.datetime.utcnow().strftime("%Y-%m-%d")


def _format_shadow(rec: dict) -> str:
    ts = rec.get("ts", "")[-13:-1]               # HH:MM:SS.mmm
    uid = (rec.get("user_id") or "-")[:14]
    cat = rec.get("category", "?")
    sev = rec.get("severity", "?")
    matched = rec.get("matched", []) or []

    flags = []
    if rec.get("is_abuse"):       flags.append("ABUSE")
    if rec.get("is_distress"):    flags.append("DISTRESS")
    if rec.get("is_frustration"): flags.append("FRUST")
    flag_str = (" [" + " ".join(flags) + "]") if flags else ""

    matched_str = "[" + ", ".join(matched[:4]) + "]"
    return f"{ts}  {uid:<14}  {cat:<19} sev={sev:<7}{flag_str}  matched={matched_str}"


def _format_audit(rec: dict) -> str:
    ts     = rec.get("ts", "")[-13:-1]
    admin  = rec.get("admin_id", "?")[:12]
    action = rec.get("action", "?")
    key    = (rec.get("key") or "?")[:14]
    reason = (rec.get("reason") or "")[:60]
    return f"{ts}  admin={admin:<12} action={action:<14} key={key:<14} reason={reason!r}"


def _tail_jsonl(filename: str, formatter, *, only_abuse: bool, raw: bool) -> int:
    """Spawn `docker exec haystack-chatqna sh -c 'tail -F /app/...'`
    and pretty-print each line as it arrives."""
    container_path = f"/app/var/abuse_defense/{filename}"

    # Use sh -c so the wildcard / file-existence check happens inside
    # the container (the file may not exist yet at startup; -F creates
    # a follow that waits for it).
    cmd = [
        "docker", "exec", CONTAINER, "sh", "-c",
        # 2>/dev/null suppresses "tail: cannot open" noise before the
        # first JSONL row lands.
        f"tail -n 0 -F {container_path} 2>/dev/null",
    ]

    print(f"# tailing {container_path}  (Ctrl+C to stop)")
    print("-" * 78)

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
    except FileNotFoundError:
        print("ERROR: 'docker' not found on PATH. Is Docker Desktop running?",
              file=sys.stderr)
        return 1

    try:
        if proc.stdout is None:
            print("ERROR: docker exec returned no stdout pipe.", file=sys.stderr)
            return 1
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                # Probably a non-JSON line (file rotation, banner, etc.) -- skip.
                continue

            if only_abuse and not rec.get("is_abuse"):
                continue

            if raw:
                print(line, flush=True)
            else:
                print(formatter(rec), flush=True)
    except KeyboardInterrupt:
        print("\n# stopped")
    finally:
        try:
            proc.terminate()
            proc.wait(timeout=2)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass

    return 0


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Live tail of AMINA abuse-defense logs.",
    )
    ap.add_argument("--raw",    action="store_true",
                    help="Print raw JSON lines instead of pretty format.")
    ap.add_argument("--abuse",  action="store_true",
                    help="Only show is_abuse=true rows (filter out clean / "
                         "frustration / distress).")
    ap.add_argument("--audit",  action="store_true",
                    help="Tail the admin-audit JSONL instead (manual releases).")
    ap.add_argument("--flagged", action="store_true",
                    help="Tail the admin-flag JSONL instead (lifetime "
                         "threshold crossings).")
    ap.add_argument("--date",   default=None,
                    help="Override the JSONL date (YYYY-MM-DD). "
                         "Default: today's UTC date.")
    args = ap.parse_args()

    date_str = args.date or _date_today_utc()

    if args.audit:
        filename  = f"admin_audit_{date_str}.jsonl"
        formatter = _format_audit
    elif args.flagged:
        filename  = f"admin_flag_{date_str}.jsonl"
        formatter = _format_audit  # same shape (ts/admin_id/action/key/reason)
    else:
        filename  = f"shadow_{date_str}.jsonl"
        formatter = _format_shadow

    return _tail_jsonl(
        filename, formatter,
        only_abuse=args.abuse,
        raw=args.raw,
    )


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BrokenPipeError:
        # Piped to head / less, etc.; exit cleanly.
        sys.exit(0)
