#!/usr/bin/env python3
"""AMINA — clear-warnings helper for the showcase.

One-command admin tool for the abuse-defense subsystem. Wraps the
existing /api/v1/admin/abuse/* endpoints (Phase E) so you don't have
to copy-paste curl commands during a live demo.

Common uses:

    # Most common — full clean slate for a user (reset everything,
    # including the sticky had_session_terminate flag).
    python clear_abuse_warnings.py P_7E454858

    # Soft clear — only ends the current cool-down. Keeps history so
    # next abuse-past-WARNING-3 still triggers cool-down (not session-
    # terminate). Useful when you want to release a user mid-cool-down
    # without giving them a fresh ladder.
    python clear_abuse_warnings.py P_7E454858 --soft

    # Show user state without changing anything.
    python clear_abuse_warnings.py P_7E454858 --snapshot

    # List all admin-flagged users (last 30 days).
    python clear_abuse_warnings.py --list-flagged

    # Show the last 20 abuse classifications across all users.
    python clear_abuse_warnings.py --recent

    # Quick stats over the last 7 days.
    python clear_abuse_warnings.py --stats

Environment overrides (defaults to localhost dev):
    AMINA_API           default http://localhost:8000
    AMINA_ADMIN_USER    default admin
    AMINA_ADMIN_PASS    default amina2026

Exit code 0 on success, 1 on error. Always prints a human-readable
summary plus the audit-row excerpt for the release path.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict, Optional

try:
    import urllib.request as _urlreq
    import urllib.error  as _urlerr
except ImportError:
    print("urllib not available — this script needs Python 3.x stdlib only.")
    sys.exit(1)


API_BASE  = os.environ.get("AMINA_API",        "http://localhost:8000").rstrip("/")
ADMIN_U   = os.environ.get("AMINA_ADMIN_USER", "admin")
ADMIN_P   = os.environ.get("AMINA_ADMIN_PASS", "amina2026")


# ── HTTP helpers ────────────────────────────────────────────────────

def _post_json(url: str, payload: Dict[str, Any], *, headers: Optional[Dict[str, str]] = None,
               timeout: int = 10) -> Dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    req = _urlreq.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)
    try:
        with _urlreq.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8") or "{}")
    except _urlerr.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace") if hasattr(e, "read") else ""
        raise SystemExit(
            f"HTTP {e.code} from POST {url}\n  body: {raw[:500]}"
        )
    except _urlerr.URLError as e:
        raise SystemExit(
            f"Could not reach {url}: {e.reason}\n"
            f"  Is the haystack-chatqna container running on port 8000?\n"
            f"  Set AMINA_API if you're using a non-default port."
        )


def _get_json(url: str, *, headers: Optional[Dict[str, str]] = None,
              timeout: int = 10) -> Dict[str, Any]:
    req = _urlreq.Request(url, method="GET")
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)
    try:
        with _urlreq.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8") or "{}")
    except _urlerr.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace") if hasattr(e, "read") else ""
        raise SystemExit(
            f"HTTP {e.code} from GET {url}\n  body: {raw[:500]}"
        )
    except _urlerr.URLError as e:
        raise SystemExit(
            f"Could not reach {url}: {e.reason}\n"
            f"  Is the haystack-chatqna container running on port 8000?\n"
            f"  Set AMINA_API if you're using a non-default port."
        )


# ── Auth ────────────────────────────────────────────────────────────

def _admin_jwt() -> str:
    res = _post_json(
        f"{API_BASE}/api/v1/admin/login",
        {"username": ADMIN_U, "password": ADMIN_P},
    )
    if not res.get("success"):
        raise SystemExit(
            f"Admin login failed: {res.get('error', 'unknown')}\n"
            f"  Try: AMINA_ADMIN_USER=... AMINA_ADMIN_PASS=... {sys.argv[0]} ..."
        )
    return res["token"]


def _bearer(jwt: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {jwt}"}


# ── Pretty printers ─────────────────────────────────────────────────

def _print_user_state(state: Dict[str, Any], label: str = "") -> None:
    if label:
        print(f"  {label}")
    is_locked = state.get("is_locked", False)
    rem       = state.get("cooldown_remaining_s", 0)
    had_st    = state.get("had_session_terminate", False)
    lt        = state.get("lifetime_terminations", 0)
    ladder    = state.get("warning_ladder", {}) or {}
    level     = ladder.get("level", 0)
    viol      = ladder.get("violations", 0)
    actions   = state.get("recent_admin_actions", []) or []
    flags     = state.get("recent_admin_flags", []) or []
    print(f"    is_locked:                 {is_locked}")
    if is_locked:
        mins = max(1, rem // 60)
        if mins < 60:
            when = f"{mins} min"
        elif mins < 24 * 60:
            when = f"{mins // 60} h"
        else:
            when = f"{mins // (24 * 60)} d"
        print(f"    cooldown_remaining_s:      {rem} ({when})")
    print(f"    had_session_terminate:     {had_st}")
    print(f"    lifetime_terminations:     {lt}")
    print(f"    warning_ladder.level:      {level}")
    print(f"    warning_ladder.violations: {viol}")
    print(f"    recent_admin_actions:      {len(actions)} row(s)")
    print(f"    recent_admin_flags:        {len(flags)} row(s)")


# ── Commands ────────────────────────────────────────────────────────

def cmd_release(key: str, *, soft: bool, reason: str) -> int:
    print(f"AMINA admin release — key={key}")
    jwt = _admin_jwt()

    print("\n  Before:")
    before = _get_json(f"{API_BASE}/api/v1/admin/abuse/user/{key}", headers=_bearer(jwt))
    _print_user_state(before)

    print("\n  Releasing...")
    res = _post_json(
        f"{API_BASE}/api/v1/admin/abuse/user/{key}/release",
        {
            "reason": reason,
            "also_clear_session_terminate": (not soft),
        },
        headers={**_bearer(jwt), "Content-Type": "application/json"},
    )
    print(f"    released:                    {res.get('released')}")
    print(f"    was_locked_before_release:   {res.get('had_cooldown')}")
    print(f"    cleared_session_terminate:   {res.get('cleared_session_terminate')}")

    print("\n  After:")
    after = _get_json(f"{API_BASE}/api/v1/admin/abuse/user/{key}", headers=_bearer(jwt))
    _print_user_state(after)

    print(f"\n  Audit row written to var/abuse_defense/admin_audit_<date>.jsonl")
    return 0


def cmd_snapshot(key: str) -> int:
    print(f"AMINA admin snapshot — key={key}")
    jwt = _admin_jwt()
    state = _get_json(f"{API_BASE}/api/v1/admin/abuse/user/{key}", headers=_bearer(jwt))
    _print_user_state(state)
    return 0


def cmd_list_flagged(days_back: int) -> int:
    print(f"AMINA admin — flagged users (last {days_back} days)")
    jwt = _admin_jwt()
    res = _get_json(
        f"{API_BASE}/api/v1/admin/abuse/flagged?days_back={days_back}",
        headers=_bearer(jwt),
    )
    rows = res.get("rows", [])
    if not rows:
        print("  No flagged users.")
        return 0
    print(f"  {len(rows)} user(s):")
    for r in rows:
        print(f"    {r.get('ts','')[:19]}Z  {r.get('key','?'):<14}  "
              f"reason={r.get('reason','?')}  "
              f"lifetime_terminations={r.get('extra',{}).get('lifetime_terminations','?')}")
    return 0


def cmd_recent(limit: int, abuse_only: bool) -> int:
    print(f"AMINA admin — recent classifications "
          f"(limit={limit}, abuse_only={abuse_only})")
    jwt = _admin_jwt()
    qs = f"limit={limit}&abuse_only={'true' if abuse_only else 'false'}"
    res = _get_json(
        f"{API_BASE}/api/v1/admin/abuse/recent?{qs}",
        headers=_bearer(jwt),
    )
    rows = res.get("rows", [])
    if not rows:
        print("  No classifications in window.")
        return 0
    print(f"  {len(rows)} row(s):")
    for r in rows:
        ts = r.get("ts", "")[-13:-1]
        cat = r.get("category", "?")
        sev = r.get("severity", "?")
        uid = r.get("user_id") or "(none)"
        sid = (r.get("session_id") or "?")[-15:]
        matched = ",".join(r.get("matched", [])[:3])
        print(f"    {ts}  uid={uid:<14}  sid=...{sid:<16}  {cat:<19} {sev:<7} matched=[{matched}]")
    return 0


def cmd_stats(days_back: int) -> int:
    print(f"AMINA admin — stats (last {days_back} days)")
    jwt = _admin_jwt()
    res = _get_json(
        f"{API_BASE}/api/v1/admin/abuse/stats?days_back={days_back}",
        headers=_bearer(jwt),
    )
    print(f"  total_messages:        {res.get('total_messages',0)}")
    print(f"  is_abuse_count:        {res.get('is_abuse_count',0)}")
    print(f"  is_distress_count:     {res.get('is_distress_count',0)}")
    print(f"  is_frustration_count:  {res.get('is_frustration_count',0)}")
    by_cat = res.get("by_category", {}) or {}
    if by_cat:
        print("  by_category:")
        for k, v in sorted(by_cat.items(), key=lambda kv: -kv[1])[:8]:
            print(f"    {k:<22} {v}")
    by_route = res.get("by_route", {}) or {}
    if by_route:
        print("  by_route:")
        for k, v in sorted(by_route.items(), key=lambda kv: -kv[1])[:8]:
            print(f"    {k:<35} {v}")
    return 0


def cmd_status() -> int:
    print("AMINA admin — module status")
    jwt = _admin_jwt()
    snap = _get_json(f"{API_BASE}/api/v1/admin/abuse/status", headers=_bearer(jwt))
    print(f"  enabled:                  {snap.get('enabled')}")
    print(f"  mode:                     {snap.get('mode')}")
    print(f"  cooldown_first_s:         {snap.get('cooldown_first_s')} (1st cool-down)")
    print(f"  cooldown_second_s:        {snap.get('cooldown_second_s')} (2nd)")
    print(f"  cooldown_third_s:         {snap.get('cooldown_third_s')} (3rd+)")
    print(f"  cooldown_decay_s:         {snap.get('cooldown_decay_s')} (warning ladder decay)")
    print(f"  coercive_fast_track:      {snap.get('coercive_fast_track')}")
    print(f"  admin_flag_threshold:     {snap.get('admin_flag_threshold')}")
    return 0


# ── argparse + main ─────────────────────────────────────────────────

def _parse() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Clear / inspect AMINA abuse-defense state for a user.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Showcase shortcut:  python clear_abuse_warnings.py <patient_id>\n"
            "                    -- full reset incl. session-terminate flag\n\n"
            "Inspect first:      python clear_abuse_warnings.py <patient_id> --snapshot\n"
            "Soft release:       python clear_abuse_warnings.py <patient_id> --soft\n"
            "Module status:      python clear_abuse_warnings.py --status\n"
            "Recent activity:    python clear_abuse_warnings.py --recent\n"
            "Flagged users:      python clear_abuse_warnings.py --list-flagged\n"
            "7-day stats:        python clear_abuse_warnings.py --stats\n"
        ),
    )
    p.add_argument(
        "key", nargs="?",
        help="User identifier (patient_id like P_7E454858, or session_id "
             "for guests). Required for release / snapshot.",
    )
    p.add_argument(
        "--soft", action="store_true",
        help="Soft release — clear cool-down clock only, preserve "
             "had_session_terminate + lifetime_terminations + ladder index. "
             "Default is full clean-slate.",
    )
    p.add_argument(
        "--reason", default="manual reset via clear_abuse_warnings.py",
        help="Audit reason (required by admin endpoint, recorded in JSONL).",
    )
    p.add_argument(
        "--snapshot", action="store_true",
        help="View user state without changing anything.",
    )
    p.add_argument(
        "--list-flagged", action="store_true",
        help="List all admin-flagged users (lifetime cool-downs >= threshold).",
    )
    p.add_argument(
        "--recent", action="store_true",
        help="Show recent abuse classifications (use --abuse-only to filter).",
    )
    p.add_argument(
        "--abuse-only", action="store_true",
        help="With --recent, show only is_abuse=true rows.",
    )
    p.add_argument(
        "--limit", type=int, default=20,
        help="--recent row limit (default 20).",
    )
    p.add_argument(
        "--stats", action="store_true",
        help="Show 7-day aggregate counts (category, severity, route).",
    )
    p.add_argument(
        "--days-back", type=int, default=30,
        help="Window for --list-flagged / --stats / --recent (default 30 / 7 / 7).",
    )
    p.add_argument(
        "--status", action="store_true",
        help="Show module config (mode, ladder, threshold).",
    )
    return p.parse_args()


def main() -> int:
    args = _parse()

    # Mode-only commands first (no key required).
    if args.status:
        return cmd_status()
    if args.list_flagged:
        return cmd_list_flagged(args.days_back)
    if args.recent:
        # Default 7 days for recent if user didn't override.
        return cmd_recent(args.limit, args.abuse_only)
    if args.stats:
        return cmd_stats(7 if args.days_back == 30 else args.days_back)

    # Everything else needs a key.
    if not args.key:
        print("ERROR: missing user key (patient_id or session_id).\n")
        print("Usage:")
        print("  python clear_abuse_warnings.py <patient_id>             # full reset")
        print("  python clear_abuse_warnings.py <patient_id> --snapshot  # inspect only")
        print("  python clear_abuse_warnings.py --status                 # module health")
        print("  python clear_abuse_warnings.py --list-flagged           # who's flagged")
        return 2

    if args.snapshot:
        return cmd_snapshot(args.key)

    return cmd_release(args.key, soft=args.soft, reason=args.reason)


if __name__ == "__main__":
    sys.exit(main())
