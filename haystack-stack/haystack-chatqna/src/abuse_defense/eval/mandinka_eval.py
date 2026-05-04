"""Phase F — Mandinka response-copy eval.

Ten checks. The translator service is NEVER actually called -- we use
``responses_mn.set_translation_for_test()`` to inject deterministic
fixture translations, then verify dispatch + fail-open semantics.

  F1   responses.warning_text(level, lang="en") returns English (default).
  F2   responses.warning_text(level, lang="ma") returns Mandinka when
       the cache is populated.
  F3   responses.warning_text(level, lang="ma") returns English (fallback)
       when the cache is empty.
  F4   responses.crisis_text(lang="ma") returns Mandinka.
  F5   responses.session_termination_text(lang="ma") returns Mandinka.
  F6   responses.termination_text(idx, lang="ma") returns Mandinka for
       all three ladder rungs.
  F7   responses.cooldown_text(remaining, lang="ma") returns ENGLISH
       (Phase F deliberately defers the parameterised Mandinka template
       to F.1; the safety contract is that the universal 199 line is
       always present, regardless of language).
  F8   defender.evaluate(language="ma") threads through and the warn
       Decision contains Mandinka text when cache populated.
  F9   defender.evaluate(language="ma") falls back to English when the
       cache is empty (no exception; safe degradation).
  F10  bootstrap_async is idempotent (second call is a no-op).

Run from haystack-chatqna/:

    python -m src.abuse_defense.eval.mandinka_eval
"""
from __future__ import annotations

import asyncio
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

# Sandbox JSONL writes.
_TMP_DIR = tempfile.mkdtemp(prefix="amina_mandinka_eval_")
os.environ["AMINA_ABUSE_SHADOW_DIR"] = _TMP_DIR
os.environ["AMINA_ABUSE_ADMIN_FLAG_DIR"] = _TMP_DIR

from src.abuse_defense import config as ad_config         # noqa: E402
from src.abuse_defense import defender                     # noqa: E402
from src.abuse_defense import responses                    # noqa: E402
from src.abuse_defense import responses_mn                 # noqa: E402
from src.abuse_defense import state                        # noqa: E402
from src.abuse_defense import cooldown                     # noqa: E402


# ── helpers ──────────────────────────────────────────────────────────

# Fake Mandinka strings used as fixtures. These are NOT real Mandinka --
# they're sentinel strings the eval can pattern-match against to verify
# dispatch worked. Real Mandinka comes from translator_v4 at startup.
MN_W1   = "[MA-W1]"
MN_W2   = "[MA-W2]"
MN_W3   = "[MA-W3]"
MN_CRIS = "[MA-CRIS]"
MN_ST   = "[MA-ST]"
MN_T0   = "[MA-T0]"
MN_T1   = "[MA-T1]"
MN_T2   = "[MA-T2]"


def _populate_cache() -> None:
    """Inject fixture Mandinka translations for every static string."""
    responses_mn.reset_for_test()
    responses_mn.set_translation_for_test(responses.WARNING_1, MN_W1)
    responses_mn.set_translation_for_test(responses.WARNING_2, MN_W2)
    responses_mn.set_translation_for_test(responses.WARNING_3, MN_W3)
    responses_mn.set_translation_for_test(responses.CRISIS_RESPONSE, MN_CRIS)
    responses_mn.set_translation_for_test(responses.SESSION_TERMINATION_RESPONSE, MN_ST)
    responses_mn.set_translation_for_test(responses.TERMINATION_FIRST,  MN_T0)
    responses_mn.set_translation_for_test(responses.TERMINATION_SECOND, MN_T1)
    responses_mn.set_translation_for_test(responses.TERMINATION_THIRD,  MN_T2)


def _fresh(*, sid: str, uid: str = "") -> None:
    state.reset_all()
    cooldown.reset_all_inmem()
    if uid:
        cooldown.reset(uid)


# ── individual checks ───────────────────────────────────────────────

def f1_default_returns_english() -> Tuple[str, bool, str]:
    responses_mn.reset_for_test()
    txt = responses.warning_text(1)
    ok = (txt == responses.WARNING_1)
    return ("F1 warning_text default returns English", ok,
            f"matches_WARNING_1={ok}")


def f2_ma_returns_mandinka_when_cached() -> Tuple[str, bool, str]:
    _populate_cache()
    txt = responses.warning_text(1, lang="ma")
    ok = (txt == MN_W1)
    return ("F2 warning_text lang=ma returns Mandinka when cached", ok,
            f"matches_MN_W1={ok}")


def f3_ma_falls_back_when_cache_empty() -> Tuple[str, bool, str]:
    responses_mn.reset_for_test()  # cache empty
    txt = responses.warning_text(1, lang="ma")
    ok = (txt == responses.WARNING_1)
    return ("F3 warning_text lang=ma falls back to English when cache empty", ok,
            f"matches_WARNING_1={ok}")


def f4_crisis_text_mandinka() -> Tuple[str, bool, str]:
    _populate_cache()
    txt = responses.crisis_text(lang="ma")
    ok = (txt == MN_CRIS)
    return ("F4 crisis_text lang=ma returns Mandinka", ok,
            f"matches_MN_CRIS={ok}")


def f5_session_termination_mandinka() -> Tuple[str, bool, str]:
    _populate_cache()
    txt = responses.session_termination_text(lang="ma")
    ok = (txt == MN_ST)
    return ("F5 session_termination_text lang=ma returns Mandinka", ok,
            f"matches_MN_ST={ok}")


def f6_termination_text_all_indices() -> Tuple[str, bool, str]:
    _populate_cache()
    t0 = responses.termination_text(0, lang="ma")
    t1 = responses.termination_text(1, lang="ma")
    t2 = responses.termination_text(2, lang="ma")
    t3 = responses.termination_text(99, lang="ma")  # clamps to T2
    ok = (t0 == MN_T0 and t1 == MN_T1 and t2 == MN_T2 and t3 == MN_T2)
    return ("F6 termination_text lang=ma covers all 3 rungs + clamp", ok,
            f"t0={t0} t1={t1} t2={t2} t3={t3}")


def f7_cooldown_text_stays_english() -> Tuple[str, bool, str]:
    """Phase F deliberately keeps cool-down text English so the
    universal 199 emergency line is always present in plain English.
    Mandinka cool-down template lands in F.1."""
    _populate_cache()
    en  = responses.cooldown_text(1799, lang="en")
    ma  = responses.cooldown_text(1799, lang="ma")
    ok = (en == ma) and ("199" in ma)
    return ("F7 cooldown_text lang=ma == English (Phase F.1 deferred)", ok,
            f"en==ma: {en == ma}, contains_199: {'199' in ma}")


def f8_defender_threads_language_mandinka() -> Tuple[str, bool, str]:
    _populate_cache()
    _fresh(sid="f8_sid", uid="f8_user")
    ad_config.ABUSE_DEFENSE_MODE = "warn"
    d = defender.evaluate(
        "You're a stupid useless AI.",
        session_id="f8_sid", user_id="f8_user",
        route="/test/f8", language="ma",
    )
    ok = (
        d is not None and d.action == "warn" and d.level == 1
        and d.response_text == MN_W1
    )
    return ("F8 defender(language=ma) returns Mandinka text", ok,
            f"action={getattr(d,'action',None)} text_match={d.response_text == MN_W1 if d else None}")


def f9_defender_falls_back_when_cache_empty() -> Tuple[str, bool, str]:
    responses_mn.reset_for_test()  # empty cache
    _fresh(sid="f9_sid", uid="f9_user")
    ad_config.ABUSE_DEFENSE_MODE = "warn"
    d = defender.evaluate(
        "You're a stupid useless AI.",
        session_id="f9_sid", user_id="f9_user",
        route="/test/f9", language="ma",
    )
    ok = (
        d is not None and d.action == "warn" and d.level == 1
        and d.response_text == responses.WARNING_1
    )
    return ("F9 defender(language=ma) falls back to English when cache empty", ok,
            f"action={getattr(d,'action',None)} text_is_english={d.response_text == responses.WARNING_1 if d else None}")


def f10_bootstrap_idempotent() -> Tuple[str, bool, str]:
    # We can't actually call bootstrap_async() here (no translator service),
    # but we CAN verify the idempotency guard: setting BOOTSTRAP_DONE
    # prevents redundant work.
    responses_mn.reset_for_test()
    # Mark as done with a known cache state.
    responses_mn.set_translation_for_test("dummy_en", "dummy_ma")
    snap1 = responses_mn.status_snapshot()

    async def _run():
        return await responses_mn.bootstrap_async()

    stats = asyncio.new_event_loop().run_until_complete(_run())
    snap2 = responses_mn.status_snapshot()

    ok = (
        snap1["bootstrap_done"] is True
        and snap2["cache_size"] == 1            # unchanged
        and snap2["bootstrap_done"] is True
    )
    return ("F10 bootstrap_async idempotent when already done", ok,
            f"snap1.size={snap1['cache_size']} snap2.size={snap2['cache_size']}")


# ── runner ──────────────────────────────────────────────────────────

def main() -> int:
    print("=" * 78)
    print("Abuse-Defense Phase F — Mandinka response-copy eval")
    print(f"  log dir: {_TMP_DIR}")
    print("=" * 78 + "\n")

    checks = [
        f1_default_returns_english,
        f2_ma_returns_mandinka_when_cached,
        f3_ma_falls_back_when_cache_empty,
        f4_crisis_text_mandinka,
        f5_session_termination_mandinka,
        f6_termination_text_all_indices,
        f7_cooldown_text_stays_english,
        f8_defender_threads_language_mandinka,
        f9_defender_falls_back_when_cache_empty,
        f10_bootstrap_idempotent,
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
    ad_config.ABUSE_DEFENSE_MODE = "off"
    state.reset_all()
    cooldown.reset_all_inmem()
    responses_mn.reset_for_test()

    if passed == total:
        print("PHASE F MANDINKA EVAL: PASS")
        return 0
    print("PHASE F MANDINKA EVAL: FAIL")
    return 1


if __name__ == "__main__":
    sys.exit(main())
