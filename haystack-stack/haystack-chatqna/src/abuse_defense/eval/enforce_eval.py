"""Phase D + D.5 — enforce-mode eval (with session-terminate intermediate).

Fourteen checks. Every one must pass.

The ladder (in enforce mode, non-minor):

    clean → WARN1 → WARN2 → WARN3 → session_terminate → cooldown(30 m)
                                                              → cooldown(24 h)
                                                              → cooldown(7 d)

  E1   Three abuses on a fresh session -> level=3, NO escalation yet.
  E2   Fourth abuse (level 3 + abuse) on FRESH user -> session_terminate
       (NOT cooldown). lifetime_terminations stays 0; the user is NOT
       locked out.
  E3   Session-terminate then 4 more abuses in a new session ->
       cooldown(idx=0, 30 min, lifetime=1). The session_terminate flag
       is sticky -- one-shot per user.
  E4   Active cool-down -> any clean message returns action=cooldown.
  E5   EMERGENCY KEYWORD during active cool-down -> continue (passthrough).
  E6   DISTRESS during active cool-down -> crisis text (NEVER hidden).
  E7   Second cool-down -> idx=1 (24 h), lifetime=2.
  E8   Third cool-down -> idx=2 (7 d), lifetime=3, admin-flag JSONL row.
  E9   MINOR at level 3 + repeated abuse -> warn ONLY (never reaches
       session_terminate, never reaches cooldown).
  E10  mode="warn" -- 4th abuse stays at WARNING_3 (no session_terminate,
       no cooldown).
  E11  mode="off"   -- evaluate returns None.
  E12  mode="shadow" -- evaluate returns None.
  E13  Redis-down: full ladder (session_terminate -> cool-down) still
       works in-memory, no exception escapes.
  E14  Re-checking flag persistence: cool-down activate() must preserve
       had_session_terminate so a subsequent cool-down on the same user
       doesn't reset them back to "fresh".

Run from haystack-chatqna/:

    python -m src.abuse_defense.eval.enforce_eval
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from typing import List, Tuple

# Force in-memory cool-down so this eval doesn't depend on Redis.
os.environ["AMINA_ABUSE_DEFENSE_DISABLE_REDIS"] = "1"

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_SRC_PARENT = os.path.abspath(os.path.join(_THIS_DIR, "..", "..", ".."))
if _SRC_PARENT not in sys.path:
    sys.path.insert(0, _SRC_PARENT)

# Sandbox JSONL writes (shadow + admin-flag share this var).
_TMP_DIR = tempfile.mkdtemp(prefix="amina_enforce_eval_")
os.environ["AMINA_ABUSE_SHADOW_DIR"] = _TMP_DIR
os.environ["AMINA_ABUSE_ADMIN_FLAG_DIR"] = _TMP_DIR

from src.abuse_defense import config as ad_config       # noqa: E402
from src.abuse_defense import defender                   # noqa: E402
from src.abuse_defense import responses                  # noqa: E402
from src.abuse_defense import state                      # noqa: E402
from src.abuse_defense import cooldown                   # noqa: E402
from src.abuse_defense import admin_flag                 # noqa: E402


# ── helpers ──────────────────────────────────────────────────────────

def _set_mode(mode: str) -> None:
    ad_config.ABUSE_DEFENSE_MODE = mode


def _fresh(*, sid: str, uid: str = "") -> None:
    """Reset all state for a fresh test."""
    state.reset_all()
    cooldown.reset_all_inmem()
    if uid:
        cooldown.reset(uid)


def _drive_to_level_2(sid: str, uid: str = "", *, is_minor: bool = False) -> None:
    """Run TWO abuse hits to reach WARN2 (level=2). Stops short of
    the terminal 3rd abuse so we can assert state in between."""
    for msg in (
        "You're a stupid AI.",
        "Shut up you idiot bot.",
    ):
        defender.evaluate(
            msg, session_id=sid, user_id=uid or None,
            route="/test/lvl", is_minor=is_minor,
        )


def _third_abuse(sid: str, uid: str = "", *, is_minor: bool = False):
    """The 3rd abuse — the one that steps to level=3, which is the
    terminal point in enforce mode (revised 2026-05-05). For minors
    it just caps at WARN3."""
    return defender.evaluate(
        "I'll hack you, you piece of trash.",
        session_id=sid, user_id=uid or None,
        route="/test/escalate", is_minor=is_minor,
    )


def _drive_to_level_3(sid: str, uid: str = "", *, is_minor: bool = False) -> None:
    """LEGACY helper kept for tests that need to walk the ladder
    completely. Sends 3 abuses in sequence; for minors this caps
    at WARN3, for adults this triggers the terminal action on the
    3rd hit."""
    _drive_to_level_2(sid, uid, is_minor=is_minor)
    _third_abuse(sid, uid, is_minor=is_minor)


def _bypass_cooldown_clock(uid: str) -> None:
    """Clear cooldown_until_ts but keep next_cooldown_index, lifetime,
    had_session_terminate -- so the next termination escalates the
    cool-down ladder rather than restarting from scratch."""
    snap = cooldown.snapshot(uid)
    next_idx = int(snap.get("next_cooldown_index", 0) or 0)
    lifetime = int(snap.get("lifetime_terminations", 0) or 0)
    was_flagged = bool(snap.get("was_admin_flagged", False))
    had_st = bool(snap.get("had_session_terminate", False))
    cooldown._INMEM[cooldown._key(uid)] = {
        "cooldown_until_ts":     0.0,
        "next_cooldown_index":   next_idx,
        "lifetime_terminations": lifetime,
        "last_terminated_ts":    0.0,
        "was_admin_flagged":     was_flagged,
        "had_session_terminate": had_st,
    }


def _read_admin_flag_lines() -> list:
    path = admin_flag.current_log_path()
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as fh:
        return [json.loads(ln) for ln in fh if ln.strip()]


def _truncate_admin_flag() -> None:
    path = admin_flag.current_log_path()
    if os.path.exists(path):
        os.remove(path)


# ── individual checks ───────────────────────────────────────────────

def e1_two_abuses_no_escalation() -> Tuple[str, bool, str]:
    """After 2 abuses (WARN1, WARN2), state is at level=2 and no
    escalation has fired. The 3rd abuse is the terminal point."""
    sid, uid = "e1_sid", "e1_user"
    _fresh(sid=sid, uid=uid)
    _set_mode("enforce")
    _drive_to_level_2(sid, uid)
    lt = cooldown.lifetime_terminations(uid)
    had_st = cooldown.had_session_terminate(uid)
    lvl = state.current_level(sid)
    ok = (lt == 0) and (had_st is False) and (lvl == 2)
    return ("E1 two abuses -> level=2, no escalation yet", ok,
            f"level={lvl} lifetime={lt} had_session_terminate={had_st}")


def e2_third_abuse_session_terminate() -> Tuple[str, bool, str]:
    """3rd abuse on a fresh user IS the terminal point — fires
    session_terminate (the soft escalation, no cooldown). Phase D.5
    revised 2026-05-05: was 4th abuse, now 3rd."""
    sid, uid = "e2_sid", "e2_user"
    _fresh(sid=sid, uid=uid)
    _set_mode("enforce")
    _drive_to_level_2(sid, uid)
    d = _third_abuse(sid, uid)
    ok = (
        d is not None and d.action == "session_terminate"
        and d.response_text == responses.SESSION_TERMINATION_RESPONSE
        and d.is_session_terminate is True
        and d.lifetime_terminations == 0           # NOT a cool-down
        and d.cooldown_remaining_s == 0
        and cooldown.had_session_terminate(uid)    # flag is set
        and cooldown.lifetime_terminations(uid) == 0
    )
    return ("E2 third abuse on fresh user -> session_terminate (NOT cooldown)", ok,
            f"action={getattr(d,'action',None)} "
            f"is_st={getattr(d,'is_session_terminate',None)} "
            f"lifetime={getattr(d,'lifetime_terminations',None)}")


def e3_after_session_terminate_next_is_cooldown() -> Tuple[str, bool, str]:
    """After session_terminate, in a NEW session, the 3rd abuse
    triggers cooldown(idx=0, 30 min) — because had_session_terminate
    is sticky-True from the previous cycle."""
    sid, uid = "e3_sid", "e3_user"
    _fresh(sid=sid, uid=uid)
    _set_mode("enforce")
    # First cycle: 3 abuses → session_terminate
    _drive_to_level_3(sid, uid)
    # Now had_session_terminate=True. New session, walk again:
    sid2 = "e3_sid_2"
    state.reset(sid2)
    _drive_to_level_2(sid2, uid)
    d = _third_abuse(sid2, uid)
    ok = (
        d is not None and d.action == "terminate"
        and d.cooldown_index_used == 0
        and d.lifetime_terminations == 1
        and d.response_text == responses.TERMINATION_FIRST
        and d.cooldown_remaining_s > 0
    )
    return ("E3 after session_terminate -> next cycle is cooldown idx=0", ok,
            f"action={getattr(d,'action',None)} "
            f"idx={getattr(d,'cooldown_index_used',None)} "
            f"lifetime={getattr(d,'lifetime_terminations',None)}")


def _drive_through_to_first_cooldown(sid_base: str, uid: str) -> None:
    """Helper: walk through cycle 1 (session_terminate) + cycle 2
    (first cooldown). Used by E4/E5/E6/etc. setups."""
    _drive_to_level_3(f"{sid_base}_a", uid)   # cycle 1: 3 abuses → session_terminate
    sid2 = f"{sid_base}_b"
    state.reset(sid2)
    _drive_to_level_3(sid2, uid)              # cycle 2: 3 abuses → cooldown idx=0


def e4_clean_during_cooldown() -> Tuple[str, bool, str]:
    sid, uid = "e4_sid", "e4_user"
    _fresh(sid=sid, uid=uid)
    _set_mode("enforce")
    _drive_through_to_first_cooldown(sid, uid)
    # Now in cool-down. Send a clean message on the most recent session.
    d = defender.evaluate(
        "What is the dosage of metformin for type 2 diabetes?",
        session_id=f"{sid}_b", user_id=uid, route="/test/e4",
    )
    ok = (
        d is not None and d.action == "cooldown"
        and d.response_text and d.response_text.startswith("I'm taking a break")
        and d.cooldown_remaining_s > 0
    )
    return ("E4 clean during cool-down -> action=cooldown", ok,
            f"action={getattr(d,'action',None)} "
            f"remaining={getattr(d,'cooldown_remaining_s',None)}")


def e5_emergency_during_cooldown() -> Tuple[str, bool, str]:
    sid, uid = "e5_sid", "e5_user"
    _fresh(sid=sid, uid=uid)
    _set_mode("enforce")
    _drive_through_to_first_cooldown(sid, uid)
    d = defender.evaluate(
        "199 my mother is having a heart attack",
        session_id=f"{sid}_b", user_id=uid, route="/test/e5",
    )
    ok = (
        d is not None and d.action == "continue"
        and d.is_emergency_passthrough is True
    )
    return ("E5 emergency during cool-down -> continue (passthrough)", ok,
            f"action={getattr(d,'action',None)} pt={getattr(d,'is_emergency_passthrough',None)}")


def e6_distress_during_cooldown() -> Tuple[str, bool, str]:
    sid, uid = "e6_sid", "e6_user"
    _fresh(sid=sid, uid=uid)
    _set_mode("enforce")
    _drive_through_to_first_cooldown(sid, uid)
    d = defender.evaluate(
        "I just want to die.",
        session_id=f"{sid}_b", user_id=uid, route="/test/e6",
    )
    ok = (
        d is not None and d.action == "crisis"
        and d.response_text == responses.CRISIS_RESPONSE
    )
    return ("E6 distress during cool-down -> crisis text (NOT cooldown)", ok,
            f"action={getattr(d,'action',None)}")


def e7_second_termination_24h() -> Tuple[str, bool, str]:
    sid, uid = "e7_sid", "e7_user"
    _fresh(sid=sid, uid=uid)
    _set_mode("enforce")

    # Cycle 1 — 3 abuses on session_a → session_terminate
    _drive_to_level_3(f"{sid}_a", uid)
    # Cycle 2 — 3 abuses on session_b → first cool-down (idx=0)
    state.reset(f"{sid}_b")
    _drive_to_level_2(f"{sid}_b", uid)
    d1 = _third_abuse(f"{sid}_b", uid)

    # Fast-forward through the wall-clock wait without losing flags.
    _bypass_cooldown_clock(uid)

    # Cycle 3 — 3 abuses on session_c → second cool-down (idx=1, 24 h)
    state.reset(f"{sid}_c")
    _drive_to_level_2(f"{sid}_c", uid)
    d2 = _third_abuse(f"{sid}_c", uid)

    ok = (
        d1 is not None and d1.action == "terminate" and d1.cooldown_index_used == 0
        and d1.lifetime_terminations == 1
        and d2 is not None and d2.action == "terminate" and d2.cooldown_index_used == 1
        and d2.lifetime_terminations == 2
        and d2.response_text == responses.TERMINATION_SECOND
    )
    return ("E7 second cool-down -> idx=1 (24 h), lifetime=2, TERMINATION_SECOND", ok,
            f"d1.idx={getattr(d1,'cooldown_index_used',None)} "
            f"d2.idx={getattr(d2,'cooldown_index_used',None)} "
            f"d2.lifetime={getattr(d2,'lifetime_terminations',None)}")


def e8_third_termination_admin_flag() -> Tuple[str, bool, str]:
    _truncate_admin_flag()
    sid, uid = "e8_sid", "e8_user"
    _fresh(sid=sid, uid=uid)
    _set_mode("enforce")
    ad_config.ABUSE_ADMIN_FLAG_THRESHOLD = 3

    # Cycle 1 — session_terminate (one-shot)
    _drive_to_level_3(f"{sid}_cycle1", uid)
    # Cycles 2/3/4 — three cool-downs, bypassing the wait between each
    decisions = []
    for round_n in range(3):
        sid_n = f"{sid}_cycle{round_n + 2}"
        state.reset(sid_n)
        _drive_to_level_2(sid_n, uid)
        d = _third_abuse(sid_n, uid)
        decisions.append(d)
        _bypass_cooldown_clock(uid)

    d3 = decisions[2]
    flag_lines = _read_admin_flag_lines()
    ok = (
        d3 is not None and d3.action == "terminate"
        and d3.cooldown_index_used == 2
        and d3.lifetime_terminations == 3
        and d3.just_admin_flagged is True
        and d3.response_text == responses.TERMINATION_THIRD
        and len(flag_lines) == 1
        and flag_lines[0]["key"] == uid
        and flag_lines[0]["reason"] == "lifetime_terminations_threshold"
    )
    return ("E8 third cool-down -> 7 d + admin-flag JSONL written", ok,
            f"idx={getattr(d3,'cooldown_index_used',None)} "
            f"lifetime={getattr(d3,'lifetime_terminations',None)} "
            f"flagged={getattr(d3,'just_admin_flagged',None)} "
            f"flag_lines={len(flag_lines)}")


def e9_minor_never_escalates() -> Tuple[str, bool, str]:
    sid, uid = "e9_sid", "e9_user_minor"
    _fresh(sid=sid, uid=uid)
    _set_mode("enforce")

    # Walk minor through 3 abuses (which would terminate an adult).
    _drive_to_level_3(sid, uid, is_minor=True)
    pre_lvl = state.current_level(sid)
    pre_lt = cooldown.lifetime_terminations(uid)
    pre_st = cooldown.had_session_terminate(uid)

    # Continue abusing past WARN3 — minor must stay at warn forever.
    decisions = []
    for _ in range(3):
        decisions.append(_third_abuse(sid, uid, is_minor=True))

    post_lt = cooldown.lifetime_terminations(uid)
    post_st = cooldown.had_session_terminate(uid)
    last = decisions[-1]
    ok = (
        all(d is not None and d.action == "warn" and d.level == 3 for d in decisions)
        and pre_lt == 0 and post_lt == 0
        and pre_st is False and post_st is False
        and last.is_minor is True
    )
    return ("E9 MINOR -> warn forever, never session_terminate, never cool-down", ok,
            f"actions={[d.action for d in decisions]} pre_lvl={pre_lvl} "
            f"post_lt={post_lt} post_st={post_st}")


def e10_warn_mode_never_escalates() -> Tuple[str, bool, str]:
    sid, uid = "e10_sid", "e10_user"
    _fresh(sid=sid, uid=uid)
    _set_mode("warn")
    _drive_to_level_3(sid, uid)
    # In warn mode, even the 3rd abuse doesn't trigger termination —
    # it just returns WARN3 (level=3 is the cap, no escalation).
    d = _third_abuse(sid, uid)
    ok = (
        d is not None and d.action == "warn" and d.level == 3
        and cooldown.lifetime_terminations(uid) == 0
        and cooldown.had_session_terminate(uid) is False
    )
    return ("E10 mode=warn -> WARNING_3 cap forever, no escalation", ok,
            f"action={getattr(d,'action',None)} level={getattr(d,'level',None)} "
            f"lifetime={cooldown.lifetime_terminations(uid)} "
            f"had_st={cooldown.had_session_terminate(uid)}")


def e11_mode_off_returns_none() -> Tuple[str, bool, str]:
    _fresh(sid="e11_sid", uid="e11_user")
    _set_mode("off")
    d = defender.evaluate("You're a stupid useless AI.",
                          session_id="e11_sid", user_id="e11_user",
                          route="/test/e11")
    ok = d is None
    return ("E11 mode=off returns None", ok, f"d={d}")


def e12_mode_shadow_returns_none() -> Tuple[str, bool, str]:
    _fresh(sid="e12_sid", uid="e12_user")
    _set_mode("shadow")
    d = defender.evaluate("You're a stupid useless AI.",
                          session_id="e12_sid", user_id="e12_user",
                          route="/test/e12")
    ok = d is None
    return ("E12 mode=shadow returns None", ok, f"d={d}")


def e13_redis_down_full_ladder() -> Tuple[str, bool, str]:
    """Forces redis client to None and runs the full ladder."""
    cooldown._redis_client = None
    cooldown._redis_failed = True
    sid, uid = "e13_sid", "e13_user"
    _fresh(sid=sid, uid=uid)
    _set_mode("enforce")

    # Cycle 1 — 3 abuses → session_terminate
    _drive_to_level_2(sid, uid)
    d_st = _third_abuse(sid, uid)

    # Cycle 2 — 3 abuses on a new session → cooldown idx=0
    sid2 = "e13_sid_2"; state.reset(sid2)
    _drive_to_level_2(sid2, uid)
    d_term = _third_abuse(sid2, uid)

    ok = (
        d_st is not None and d_st.action == "session_terminate"
        and d_term is not None and d_term.action == "terminate"
        and d_term.cooldown_index_used == 0
        and d_term.lifetime_terminations == 1
    )
    return ("E13 Redis-down: full session_terminate -> cool-down still works", ok,
            f"st.action={getattr(d_st,'action',None)} "
            f"term.action={getattr(d_term,'action',None)} "
            f"term.idx={getattr(d_term,'cooldown_index_used',None)} "
            f"lifetime={getattr(d_term,'lifetime_terminations',None)}")


def e14_session_terminate_flag_persists_through_cooldown() -> Tuple[str, bool, str]:
    """Make sure cooldown.activate() preserves had_session_terminate so
    the user doesn't accidentally get a *second* session_terminate
    later when they earn a second cool-down."""
    sid, uid = "e14_sid", "e14_user"
    _fresh(sid=sid, uid=uid)
    _set_mode("enforce")

    # Cycle 1 — 3 abuses → session_terminate, sets had_session_terminate
    _drive_to_level_3(f"{sid}_a", uid)
    assert cooldown.had_session_terminate(uid) is True

    # Cycle 2 — 3 abuses on a new session → cooldown idx=0
    state.reset(f"{sid}_b")
    _drive_to_level_2(f"{sid}_b", uid)
    _third_abuse(f"{sid}_b", uid)
    after_first_cd = cooldown.had_session_terminate(uid)

    _bypass_cooldown_clock(uid)

    # Cycle 3 — 3 abuses → MUST be cooldown idx=1, NOT a second session_terminate
    state.reset(f"{sid}_c")
    _drive_to_level_2(f"{sid}_c", uid)
    d = _third_abuse(f"{sid}_c", uid)
    after_second_cd = cooldown.had_session_terminate(uid)

    ok = (
        after_first_cd is True
        and after_second_cd is True
        and d is not None and d.action == "terminate"
        and d.cooldown_index_used == 1
    )
    return ("E14 had_session_terminate persists through cooldowns (no replay)", ok,
            f"after_1st_cd={after_first_cd} after_2nd_cd={after_second_cd} "
            f"action={getattr(d,'action',None)} idx={getattr(d,'cooldown_index_used',None)}")


# ── runner ──────────────────────────────────────────────────────────

def main() -> int:
    print("=" * 78)
    print("Abuse-Defense Phase D + D.5 — enforce-mode eval")
    print(f"  log dir: {_TMP_DIR}")
    print("=" * 78 + "\n")

    checks = [
        e1_two_abuses_no_escalation,
        e2_third_abuse_session_terminate,
        e3_after_session_terminate_next_is_cooldown,
        e4_clean_during_cooldown,
        e5_emergency_during_cooldown,
        e6_distress_during_cooldown,
        e7_second_termination_24h,
        e8_third_termination_admin_flag,
        e9_minor_never_escalates,
        e10_warn_mode_never_escalates,
        e11_mode_off_returns_none,
        e12_mode_shadow_returns_none,
        e13_redis_down_full_ladder,
        e14_session_terminate_flag_persists_through_cooldown,
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

    # Cleanup
    _set_mode("off")
    state.reset_all()
    cooldown.reset_all_inmem()
    _truncate_admin_flag()

    if passed == total:
        print("PHASE D ENFORCE EVAL: PASS")
        return 0
    print("PHASE D ENFORCE EVAL: FAIL")
    return 1


if __name__ == "__main__":
    sys.exit(main())
