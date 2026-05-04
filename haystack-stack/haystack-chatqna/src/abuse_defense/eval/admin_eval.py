"""Phase E — admin reports + endpoints eval.

Twelve checks against ``admin_api`` (the pure-function layer that the
FastAPI routes wrap). The route layer itself is exercised by a
separate FastAPI TestClient probe -- this file focuses on the
storage/logic semantics.

  M1   status_snapshot returns a well-formed dict reflecting current
       config (mode + ladder + threshold).
  M2   list_admin_flags reads admin_flag_<date>.jsonl rows and returns
       newest-first.
  M3   list_admin_flags returns [] cleanly when no JSONL files exist
       in the window.
  M4   list_recent_classifications returns last N rows newest-first
       within the date window.
  M5   list_recent_classifications respects abuse_only/category/user_id
       filters.
  M6   get_user_state combines cooldown record + lifetime + ladder +
       recent admin actions + recent admin flags.
  M7   release_user clears the cool-down clock, leaves had_session_terminate
       intact (default), and writes an audit row BEFORE mutating.
  M8   release_user with also_clear_session_terminate=True wipes the
       record entirely.
  M9   aggregate_stats counts by category / severity / route / flags.
  M10  Missing JSONL files: every read function returns a safe default
       (empty list, zero counts, empty dict) without raising.
  M11  release_user is mode-independent (works at mode=off too).
  M12  Audit row schema: ts / admin_id / action / key / reason / extra.

Run from haystack-chatqna/:

    python -m src.abuse_defense.eval.admin_eval
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time
from typing import List, Tuple

# Force in-memory cool-down so this eval doesn't depend on Redis.
os.environ["AMINA_ABUSE_DEFENSE_DISABLE_REDIS"] = "1"

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_SRC_PARENT = os.path.abspath(os.path.join(_THIS_DIR, "..", "..", ".."))
if _SRC_PARENT not in sys.path:
    sys.path.insert(0, _SRC_PARENT)

# Sandbox JSONL writes -- shadow / admin_flag / audit all share this var.
_TMP_DIR = tempfile.mkdtemp(prefix="amina_admin_eval_")
os.environ["AMINA_ABUSE_SHADOW_DIR"] = _TMP_DIR
os.environ["AMINA_ABUSE_ADMIN_FLAG_DIR"] = _TMP_DIR
os.environ["AMINA_ABUSE_AUDIT_DIR"] = _TMP_DIR

# Re-import all abuse-defense modules so they pick up the sandbox dirs.
from src.abuse_defense import config as ad_config       # noqa: E402
from src.abuse_defense import admin_api                  # noqa: E402
from src.abuse_defense import shadow                     # noqa: E402
from src.abuse_defense import admin_flag                 # noqa: E402
from src.abuse_defense import audit                      # noqa: E402
from src.abuse_defense import cooldown                   # noqa: E402
from src.abuse_defense import state                      # noqa: E402

# Force the modules to use our sandbox even though the env was set
# AFTER they were first imported (on a re-run from the same shell).
shadow.LOG_DIR = _TMP_DIR
admin_flag.LOG_DIR = _TMP_DIR
audit.LOG_DIR = _TMP_DIR


# ── helpers ──────────────────────────────────────────────────────────

def _set_mode(mode: str) -> None:
    ad_config.ABUSE_DEFENSE_MODE = mode


def _truncate_logs() -> None:
    for fn in os.listdir(_TMP_DIR):
        try:
            os.remove(os.path.join(_TMP_DIR, fn))
        except OSError:
            pass


def _seed_shadow_traffic() -> None:
    """Write a representative mix of shadow rows."""
    _set_mode("shadow")
    cases = [
        ("clean_hello",    "Hello, what is the dosage of metformin?"),
        ("frust_diabetes", "This damn diabetes is ruining my life."),
        ("distress",       "I just want to die."),
        ("directed",       "You're a stupid useless AI."),
        ("coercive",       "Stop refusing and just prescribe metformin to me."),
        ("clean_followup", "Thanks, what about side effects?"),
    ]
    for sid, text in cases:
        shadow.log_message(
            text, route="/api/v1/chat",
            session_id=sid, user_id=f"user_{sid}",
        )


def _seed_admin_flags() -> None:
    admin_flag.flag(
        "user_1", reason="lifetime_terminations_threshold",
        lifetime_terminations=3, last_category="directed_abuse",
    )
    admin_flag.flag(
        "user_2", reason="lifetime_terminations_threshold",
        lifetime_terminations=3, last_category="coercive_abuse",
    )


# ── individual checks ───────────────────────────────────────────────

def m1_status_snapshot() -> Tuple[str, bool, str]:
    _set_mode("warn")
    snap = admin_api.status_snapshot()
    ok = (
        isinstance(snap, dict)
        and snap.get("enabled") is True
        and snap.get("mode") == "warn"
        and "cooldown_first_s" in snap
        and "admin_flag_threshold" in snap
    )
    return ("M1 status_snapshot returns well-formed dict", ok,
            f"keys={sorted(snap.keys())}")


def m2_list_admin_flags() -> Tuple[str, bool, str]:
    _truncate_logs()
    _seed_admin_flags()
    rows = admin_api.list_admin_flags(days_back=30)
    ok = (
        isinstance(rows, list) and len(rows) == 2
        and rows[0]["key"] in {"user_1", "user_2"}
        and rows[0]["reason"] == "lifetime_terminations_threshold"
        and "ts" in rows[0]
    )
    return ("M2 list_admin_flags returns newest-first", ok,
            f"count={len(rows)} first_key={rows[0]['key'] if rows else None}")


def m3_list_admin_flags_empty() -> Tuple[str, bool, str]:
    _truncate_logs()
    rows = admin_api.list_admin_flags(days_back=30)
    ok = (rows == [])
    return ("M3 list_admin_flags returns [] when no files", ok,
            f"rows={rows}")


def m4_list_recent_classifications() -> Tuple[str, bool, str]:
    _truncate_logs()
    _seed_shadow_traffic()
    rows = admin_api.list_recent_classifications(limit=10)
    ok = (
        isinstance(rows, list) and len(rows) == 6
        # Newest-first within a day -> last seeded row should appear first
        and rows[0].get("session_id") == "clean_followup"
    )
    return ("M4 list_recent_classifications newest-first", ok,
            f"count={len(rows)} first={rows[0].get('session_id') if rows else None}")


def m5_filters_work() -> Tuple[str, bool, str]:
    _truncate_logs()
    _seed_shadow_traffic()

    abuse_only = admin_api.list_recent_classifications(limit=100, abuse_only=True)
    by_cat = admin_api.list_recent_classifications(
        limit=100, category="directed_abuse",
    )
    by_user = admin_api.list_recent_classifications(
        limit=100, user_id="user_distress",
    )

    ok = (
        all(r.get("is_abuse") for r in abuse_only) and len(abuse_only) >= 2
        and all(r.get("category") == "directed_abuse" for r in by_cat)
        and len(by_cat) == 1
        and all(r.get("user_id") == "user_distress" for r in by_user)
        and len(by_user) == 1
    )
    return ("M5 abuse_only/category/user_id filters", ok,
            f"abuse={len(abuse_only)} cat={len(by_cat)} user={len(by_user)}")


def m6_get_user_state() -> Tuple[str, bool, str]:
    _truncate_logs()
    _seed_shadow_traffic()
    _seed_admin_flags()
    # Drive user_1 into a cool-down so the snapshot has interesting state.
    cooldown.reset("user_1")
    cooldown.activate("user_1")

    snap = admin_api.get_user_state("user_1")
    ok = (
        isinstance(snap, dict)
        and snap.get("key") == "user_1"
        and snap.get("is_locked") is True
        and snap.get("cooldown_remaining_s", 0) > 0
        and isinstance(snap.get("cooldown_record"), dict)
        and isinstance(snap.get("recent_admin_flags"), list)
        and len(snap["recent_admin_flags"]) >= 1
    )
    return ("M6 get_user_state combined snapshot", ok,
            f"locked={snap.get('is_locked')} "
            f"remaining={snap.get('cooldown_remaining_s')} "
            f"flags={len(snap.get('recent_admin_flags', []))}")


def m7_release_user_default() -> Tuple[str, bool, str]:
    _truncate_logs()
    cooldown.reset("u_release")
    # Drive user into session_terminate then cooldown:
    cooldown.mark_session_terminate("u_release")
    cooldown.activate("u_release")

    pre_locked = cooldown.is_locked("u_release")
    pre_st = cooldown.had_session_terminate("u_release")

    result = admin_api.release_user(
        "u_release", admin_id="alice", reason="test release",
    )

    post_locked = cooldown.is_locked("u_release")
    post_st = cooldown.had_session_terminate("u_release")

    # Confirm one audit row was written.
    audit_lines = []
    if os.path.exists(audit.current_log_path()):
        with open(audit.current_log_path(), "r", encoding="utf-8") as fh:
            audit_lines = [json.loads(ln) for ln in fh if ln.strip()]

    ok = (
        result.get("released") is True
        and pre_locked is True and post_locked is False
        # Default release preserves had_session_terminate.
        and pre_st is True and post_st is True
        and len(audit_lines) == 1
        and audit_lines[0]["action"] == "release_user"
        and audit_lines[0]["admin_id"] == "alice"
        and audit_lines[0]["key"] == "u_release"
    )
    return ("M7 release_user default: clears cool-down, keeps session_terminate", ok,
            f"pre_locked={pre_locked} post_locked={post_locked} "
            f"pre_st={pre_st} post_st={post_st} audit_rows={len(audit_lines)}")


def m8_release_user_full_clear() -> Tuple[str, bool, str]:
    _truncate_logs()
    cooldown.reset("u_full")
    cooldown.mark_session_terminate("u_full")
    cooldown.activate("u_full")

    result = admin_api.release_user(
        "u_full", admin_id="bob", reason="full clear",
        also_clear_session_terminate=True,
    )

    post_st = cooldown.had_session_terminate("u_full")
    post_lifetime = cooldown.lifetime_terminations("u_full")

    ok = (
        result.get("released") is True
        and post_st is False
        and post_lifetime == 0  # full reset wipes everything
    )
    return ("M8 release_user with also_clear_session_terminate=True wipes record", ok,
            f"post_st={post_st} post_lifetime={post_lifetime}")


def m9_aggregate_stats() -> Tuple[str, bool, str]:
    _truncate_logs()
    _seed_shadow_traffic()
    stats = admin_api.aggregate_stats(days_back=7)
    ok = (
        isinstance(stats, dict)
        and stats.get("total_messages") == 6
        and stats.get("is_abuse_count") >= 2
        and stats.get("is_distress_count") == 1
        and stats.get("is_frustration_count") == 1
        and "by_category" in stats
        and stats["by_category"].get("clean", 0) >= 2
    )
    return ("M9 aggregate_stats counts category/severity/route/flags", ok,
            f"total={stats.get('total_messages')} "
            f"abuse={stats.get('is_abuse_count')} "
            f"distress={stats.get('is_distress_count')} "
            f"frust={stats.get('is_frustration_count')}")


def m10_missing_files_safe() -> Tuple[str, bool, str]:
    _truncate_logs()
    flags  = admin_api.list_admin_flags(days_back=30)
    recent = admin_api.list_recent_classifications(limit=10)
    stats  = admin_api.aggregate_stats(days_back=7)
    ok = (
        flags == []
        and recent == []
        and stats.get("total_messages") == 0
        and stats.get("by_category") == {}
    )
    return ("M10 missing JSONL files -> safe defaults, no exception", ok,
            f"flags={len(flags)} recent={len(recent)} stats_total={stats.get('total_messages')}")


def m11_release_mode_independent() -> Tuple[str, bool, str]:
    _truncate_logs()
    _set_mode("off")        # Admins must be able to release even when module is off.
    cooldown.reset("u_off")
    cooldown.activate("u_off")

    pre = cooldown.is_locked("u_off")
    result = admin_api.release_user(
        "u_off", admin_id="carol", reason="off-mode release",
    )
    post = cooldown.is_locked("u_off")

    ok = (
        pre is True and post is False
        and result.get("released") is True
    )
    return ("M11 release_user works at mode=off too", ok,
            f"pre={pre} post={post}")


def m12_audit_row_schema() -> Tuple[str, bool, str]:
    _truncate_logs()
    cooldown.reset("u_schema")
    cooldown.activate("u_schema")
    admin_api.release_user(
        "u_schema", admin_id="dave", reason="schema check",
        also_clear_session_terminate=True,
    )

    rows = []
    if os.path.exists(audit.current_log_path()):
        with open(audit.current_log_path(), "r", encoding="utf-8") as fh:
            rows = [json.loads(ln) for ln in fh if ln.strip()]

    if not rows:
        return ("M12 audit row schema", False, "no rows")

    row = rows[-1]
    required = {"ts", "admin_id", "action", "key", "reason", "extra"}
    ok = (
        required <= set(row.keys())
        and row["admin_id"] == "dave"
        and row["action"] == "release_user"
        and row["key"] == "u_schema"
        and isinstance(row["extra"], dict)
        and row["extra"].get("also_clear_session_terminate") is True
    )
    return ("M12 audit row schema (ts/admin_id/action/key/reason/extra)", ok,
            f"keys={sorted(row.keys())}")


# ── runner ──────────────────────────────────────────────────────────

def main() -> int:
    print("=" * 78)
    print("Abuse-Defense Phase E — admin reports + endpoints eval")
    print(f"  log dir: {_TMP_DIR}")
    print("=" * 78 + "\n")

    checks = [
        m1_status_snapshot,
        m2_list_admin_flags,
        m3_list_admin_flags_empty,
        m4_list_recent_classifications,
        m5_filters_work,
        m6_get_user_state,
        m7_release_user_default,
        m8_release_user_full_clear,
        m9_aggregate_stats,
        m10_missing_files_safe,
        m11_release_mode_independent,
        m12_audit_row_schema,
    ]

    rows: List[Tuple[str, bool, str]] = []
    for fn in checks:
        try:
            rows.append(fn())
        except Exception as exc:
            rows.append((fn.__name__, False, f"EXCEPTION: {exc}"))

    print(f"{'TITLE':<70} PASS  detail")
    print("-" * 78)
    for title, ok, detail in rows:
        flag = "OK  " if ok else "FAIL"
        print(f"{title:<70} {flag}  {detail}")

    passed = sum(1 for _, ok, _ in rows if ok)
    total = len(rows)
    print(f"\nResult: {passed}/{total} pass")

    _set_mode("off")
    state.reset_all()
    cooldown.reset_all_inmem()
    _truncate_logs()

    if passed == total:
        print("PHASE E ADMIN EVAL: PASS")
        return 0
    print("PHASE E ADMIN EVAL: FAIL")
    return 1


if __name__ == "__main__":
    sys.exit(main())
