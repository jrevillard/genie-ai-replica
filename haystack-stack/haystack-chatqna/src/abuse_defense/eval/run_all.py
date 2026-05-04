"""Master eval runner - Phases A through F + scenarios.

Runs every abuse-defense eval suite in sequence, captures the result
counts, and prints a combined summary. Each suite is invoked as a
subprocess so mode + state from one suite never leaks into another.

Usage from haystack-chatqna/:

    python -m src.abuse_defense.eval.run_all

Exit code is 0 only if every suite reports 100% pass.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from typing import List, Tuple


# Eval suites in dependency order (catalog -> integration -> admin).
SUITES: List[Tuple[str, str]] = [
    ("Phase A - classifier",         "src.abuse_defense.eval.abuse_defense_eval"),
    ("Phase B - shadow logger",      "src.abuse_defense.eval.shadow_smoke"),
    ("Phase C - warn ladder",        "src.abuse_defense.eval.warn_eval"),
    ("Phase D - enforce + cooldown", "src.abuse_defense.eval.enforce_eval"),
    ("Phase E - admin reports",      "src.abuse_defense.eval.admin_eval"),
    ("Phase F - Mandinka",           "src.abuse_defense.eval.mandinka_eval"),
    ("Phase G - semantic",           "src.abuse_defense.eval.phase_g_eval"),
    ("Integration - scenarios",      "src.abuse_defense.eval.scenarios_eval"),
]


_PASS_LINE_RE = re.compile(r"^Result:\s*(\d+)/(\d+)", re.MULTILINE)


def _run(module: str) -> Tuple[int, int, int, str]:
    """Run a suite as `python -m <module>`. Returns
    (exit_code, passed, total, raw_tail). Tail kept short for the
    summary view."""
    env = dict(os.environ)
    env.setdefault("AMINA_ABUSE_DEFENSE_DISABLE_REDIS", "1")
    proc = subprocess.run(
        [sys.executable, "-m", module],
        capture_output=True, text=True, env=env,
    )
    out = (proc.stdout or "") + (proc.stderr or "")
    matches = _PASS_LINE_RE.findall(out)

    passed, total = 0, 0
    if matches:
        # scenarios_eval prints two "Result:" lines (scenarios + steps).
        # The first line tells us scenario count; we want both. Grab the
        # last as the canonical pass-summary for non-scenario suites and
        # sum across matches for scenarios.
        if module.endswith("scenarios_eval") and len(matches) >= 2:
            sc_pass, sc_total = int(matches[0][0]), int(matches[0][1])
            st_pass, st_total = int(matches[1][0]), int(matches[1][1])
            passed = sc_pass
            total  = sc_total
            tail = (
                f"scenarios={sc_pass}/{sc_total}, "
                f"step-asserts={st_pass}/{st_total}"
            )
        else:
            passed = int(matches[-1][0])
            total  = int(matches[-1][1])
            tail = f"{passed}/{total}"
    else:
        tail = "no Result: line found"

    return proc.returncode, passed, total, tail


def main() -> int:
    print("=" * 78)
    print("Abuse-Defense - Full eval run (Phases A -> F + scenarios)")
    print("=" * 78)

    rows: List[Tuple[str, int, int, int, str]] = []

    for label, module in SUITES:
        print(f"\n-> {label}  ({module})")
        rc, passed, total, tail = _run(module)
        flag = "OK" if rc == 0 and passed == total and total > 0 else "FAIL"
        print(f"   {flag}  {tail}")
        rows.append((label, rc, passed, total, tail))

    # ── Summary ────────────────────────────────────────────────────
    print("\n" + "=" * 78)
    print("Combined summary")
    print("=" * 78)
    print(f"{'Suite':<38}{'Result':<10}{'Pass':<10}{'Detail'}")
    print("-" * 78)

    grand_pass  = 0
    grand_total = 0
    grand_ok    = True
    for label, rc, passed, total, tail in rows:
        ok = (rc == 0) and (total > 0) and (passed == total)
        if not ok:
            grand_ok = False
        grand_pass  += passed
        grand_total += total
        flag = "OK  " if ok else "FAIL"
        print(f"{label:<38}{flag:<10}{passed:>3}/{total:<3}    {tail}")

    print("-" * 78)
    print(f"{'GRAND TOTAL':<38}{'OK  ' if grand_ok else 'FAIL':<10}"
          f"{grand_pass:>3}/{grand_total:<3}")

    if grand_ok:
        print("\nABUSE DEFENSE FULL EVAL: PASS")
        return 0
    print("\nABUSE DEFENSE FULL EVAL: FAIL")
    return 1


if __name__ == "__main__":
    sys.exit(main())
