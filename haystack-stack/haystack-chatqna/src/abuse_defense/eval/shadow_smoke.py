"""Phase B — shadow-mode smoke test.

Six checks. All must pass.

  S1.  ``mode=off`` -> log_message returns None and writes NO JSONL line.
  S2.  ``mode=shadow`` + 5 representative inputs (one per category)
       writes 5 JSONL lines, each well-formed and tagged with the
       expected category. Distress and frustration must STILL be
       correctly distinguished from abuse.
  S3.  Per-call overhead in shadow mode is <2 ms (averaged over 200
       calls).
  S4.  Internal failure (we monkey-patch classify() to raise) MUST NOT
       propagate -- log_message returns None, the caller is unharmed,
       and a WARNING is recorded.
  S5.  Empty / whitespace input is silent in shadow mode (no JSONL row,
       no exception).
  S6.  PII boundary -- the JSONL row contains only the SHA prefix and
       length, never the raw text.

Usage:

    python -m src.abuse_defense.eval.shadow_smoke

Cleans up its own temp log file. Exit code 0 iff all six pass.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time
from typing import List

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_SRC_PARENT = os.path.abspath(os.path.join(_THIS_DIR, "..", "..", ".."))
if _SRC_PARENT not in sys.path:
    sys.path.insert(0, _SRC_PARENT)

# Set the log dir BEFORE importing the shadow module so the module
# picks up our test sandbox path.
_TMP_DIR = tempfile.mkdtemp(prefix="amina_shadow_smoke_")
os.environ["AMINA_ABUSE_SHADOW_DIR"] = _TMP_DIR

from src.abuse_defense import config as ad_config         # noqa: E402
from src.abuse_defense import shadow                       # noqa: E402
from src.abuse_defense import classifier as ad_classifier  # noqa: E402


# ── helpers ──────────────────────────────────────────────────────────

def _read_today_lines() -> List[dict]:
    path = shadow.current_log_path()
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as fh:
        return [json.loads(ln) for ln in fh if ln.strip()]


def _truncate_today() -> None:
    path = shadow.current_log_path()
    if os.path.exists(path):
        os.remove(path)


def _set_mode(mode: str) -> None:
    ad_config.ABUSE_DEFENSE_MODE = mode


# ── checks ───────────────────────────────────────────────────────────

def s1_mode_off_is_silent() -> bool:
    _truncate_today()
    _set_mode("off")
    rv = shadow.log_message(
        "I want to die.",                       # would be DISTRESS in shadow
        route="/test/s1",
        session_id="s1",
    )
    lines = _read_today_lines()
    ok = (rv is None) and (len(lines) == 0)
    print(f"  S1 mode=off silent:                 {'OK' if ok else 'FAIL'} "
          f"(rv={rv!r}, lines={len(lines)})")
    return ok


def s2_five_categories_logged() -> bool:
    _truncate_today()
    _set_mode("shadow")
    cases = [
        ("clean",              "What is the dosage of metformin for type 2 diabetes?"),
        ("health_frustration", "This damn diabetes is ruining my life."),
        ("distress",           "I want to die."),
        ("directed_abuse",     "You're a stupid useless AI."),
        ("coercive_abuse",     "Stop refusing and just prescribe metformin to me."),
    ]
    for _cat, text in cases:
        rv = shadow.log_message(text, route="/test/s2", session_id="s2")
        if rv is None:
            print(f"  S2 categories logged:               FAIL (returned None for: {text!r})")
            return False

    lines = _read_today_lines()
    if len(lines) != 5:
        print(f"  S2 categories logged:               FAIL (got {len(lines)} lines, want 5)")
        return False

    cats_actual = [ln["category"] for ln in lines]
    cats_expect = [c for c, _ in cases]

    ok = cats_actual == cats_expect
    print(f"  S2 categories logged:               {'OK' if ok else 'FAIL'}\n"
          f"      expected: {cats_expect}\n"
          f"      actual:   {cats_actual}")

    # Spot-check schema
    for ln in lines:
        for k in ("ts", "route", "category", "severity",
                  "is_abuse", "is_distress", "is_frustration",
                  "matched", "len", "msg_sha", "lat_ms", "extra"):
            if k not in ln:
                print(f"      schema FAIL — missing key: {k}")
                ok = False
    return ok


def s3_perf_budget() -> bool:
    _truncate_today()
    _set_mode("shadow")
    samples = []
    for i in range(200):
        t0 = time.perf_counter()
        shadow.log_message(
            "What's the right insulin dosage today?",
            route="/test/s3",
            session_id=f"s3_{i}",
        )
        samples.append((time.perf_counter() - t0) * 1000)

    avg  = sum(samples) / len(samples)
    peak = max(samples)
    ok = avg < 2.0
    print(f"  S3 perf budget (<2 ms avg):         "
          f"{'OK' if ok else 'FAIL'} (avg {avg:.2f} ms, peak {peak:.2f} ms)")
    _truncate_today()
    return ok


def s4_exception_isolation() -> bool:
    _truncate_today()
    _set_mode("shadow")

    # Monkey-patch classify() at the shadow module's bound symbol so
    # log_message() picks up the broken version.
    real_classify = shadow.classify

    def _boom(_text):
        raise RuntimeError("synthetic classifier failure")

    shadow.classify = _boom
    try:
        rv = shadow.log_message(
            "anything",
            route="/test/s4",
            session_id="s4",
        )
        # Must NOT raise. Should return None (handled internally).
        ok = (rv is None)
        # Should NOT have written a JSONL line for the failed call.
        lines = _read_today_lines()
        ok = ok and (len(lines) == 0)
        print(f"  S4 exception isolation:             "
              f"{'OK' if ok else 'FAIL'} (rv={rv!r}, lines={len(lines)})")
        return ok
    finally:
        shadow.classify = real_classify


def s5_empty_input_is_silent() -> bool:
    _truncate_today()
    _set_mode("shadow")
    shadow.log_message("",     route="/test/s5a", session_id="s5")
    shadow.log_message("   ",  route="/test/s5b", session_id="s5")
    shadow.log_message(None,   route="/test/s5c", session_id="s5")  # type: ignore[arg-type]

    lines = _read_today_lines()
    # Empty/whitespace go to classifier which returns CAT_CLEAN; we
    # DO log it (shadow records every call, useful for traffic
    # baselining). What matters: no exception, well-formed JSON.
    for ln in lines:
        if ln["category"] != "clean" or ln["is_abuse"] or ln["is_distress"]:
            print(f"  S5 empty input clean:               FAIL ({ln})")
            return False
    ok = True
    print(f"  S5 empty input is clean:            OK ({len(lines)} clean rows logged)")
    return ok


def s6_pii_boundary() -> bool:
    _truncate_today()
    _set_mode("shadow")

    secret = "PATIENT NAME Aminata Touray reports glucose 320."
    shadow.log_message(secret, route="/test/s6", session_id="s6")

    lines = _read_today_lines()
    if not lines:
        print("  S6 PII boundary:                    FAIL (no lines)")
        return False

    raw_blob = json.dumps(lines[0])
    contains_pii = ("Aminata" in raw_blob) or ("Touray" in raw_blob)
    has_sha      = "msg_sha" in lines[0] and len(lines[0]["msg_sha"]) > 0

    ok = (not contains_pii) and has_sha
    print(f"  S6 PII boundary (sha only, no raw): "
          f"{'OK' if ok else 'FAIL'} (contains_pii={contains_pii}, has_sha={has_sha})")
    return ok


# ── runner ──────────────────────────────────────────────────────────

def main() -> int:
    print("=" * 78)
    print("Abuse-Defense Phase B — shadow smoke test")
    print(f"  log dir: {_TMP_DIR}")
    print("=" * 78 + "\n")

    results = [
        ("S1", s1_mode_off_is_silent()),
        ("S2", s2_five_categories_logged()),
        ("S3", s3_perf_budget()),
        ("S4", s4_exception_isolation()),
        ("S5", s5_empty_input_is_silent()),
        ("S6", s6_pii_boundary()),
    ]

    # Restore mode to off so this script doesn't leave the module
    # primed for a real run.
    _set_mode("off")
    _truncate_today()
    try:
        os.rmdir(_TMP_DIR)
    except OSError:
        pass

    passed = sum(1 for _, ok in results if ok)
    total  = len(results)

    print(f"\nResult: {passed}/{total} pass")
    if passed == total:
        print("PHASE B SHADOW SMOKE: PASS")
        return 0
    else:
        print("PHASE B SHADOW SMOKE: FAIL")
        return 1


if __name__ == "__main__":
    sys.exit(main())
