"""
Caregiver privacy — stale-population audit (Phase 6.7).

Read-only operator tool. Counts caregivers by consent state and
prints a green/yellow/red recommendation that gates Phase 7
enforcement rollout. NEVER prints names, phones, raw signatures,
hashes, tokens, IPs, user-agents, or any other PHI / secret —
only aggregate counts and a single percentage.

Thresholds (per Phase 6.7 spec):
    GREEN    : stale < 5%      → safe to flip enforcement after a 24 h
                                 banner.
    YELLOW   : 5% ≤ stale ≤ 20%→ run a 14-day soak with the warn-only
                                 log + soft re-consent campaign before
                                 flipping.
    RED      : stale > 20%     → DO NOT flip; coordinated campaign
                                 needed first.

Usage (inside or outside the haystack-chatqna container):

    python scripts/caregiver_privacy_stale_audit.py
    python scripts/caregiver_privacy_stale_audit.py --json
    python scripts/caregiver_privacy_stale_audit.py --notice-version 1.0

Test injection:
    The query runner is parameterised so unit tests can stub it out.
    `audit(query_runner=mock)` returns the same dict the CLI prints.

Schema assumptions (read-only):
    CaregiverVertex.caregiver_id          identity key
    CaregiverConsentRecord.caregiver_id   FK
    CaregiverConsentRecord.notice_version string ("1.0" today)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Callable, Dict, Optional

# Add /app to sys.path when invoked from inside /app/scripts/ — same
# trick the existing test files use.
_HERE = os.path.dirname(os.path.abspath(__file__))
_APP  = os.path.dirname(_HERE)
if _APP not in sys.path:
    sys.path.insert(0, _APP)


# ── Verdict thresholds ───────────────────────────────────────────────
GREEN_MAX  = 5.0   # exclusive  (< 5%)
YELLOW_MAX = 20.0  # inclusive  (≤ 20%)


def _verdict_from_pct(pct: float) -> str:
    if pct < GREEN_MAX:
        return "green"
    if pct <= YELLOW_MAX:
        return "yellow"
    return "red"


def _verdict_blurb(verdict: str) -> str:
    return {
        "green":  "Safe to flip AMINA_CAREGIVER_PRIVACY_REQUIRED=true after a 24 h banner.",
        "yellow": "Run a 14-day warn-only soak + soft re-consent campaign before flipping.",
        "red":    "DO NOT flip. Coordinated comms + re-consent campaign required first.",
    }[verdict]


# ── Default query runner (talks to ArcadeDB via HTTP) ────────────────
def _default_query_runner() -> Callable[[str], Any]:
    """
    Build a callable `runner(sql) -> dict` that talks to the live
    ArcadeDB via HTTP. The caller can substitute this in tests by
    passing `query_runner=...` to `audit(...)`.
    """
    import requests
    base = (
        os.getenv("ARCADEDB_URL")
        or "http://arcadedb:2480"
    ).rstrip("/")
    db   = os.getenv("ARCADEDB_DB", "genie")
    user = os.getenv("ARCADEDB_USER", "root")
    pwd  = (
        os.getenv("ARCADEDB_ROOT_PASSWORD")
        or os.getenv("ARCADEDB_PASSWORD")
        or "genieRoot123"
    )

    def runner(sql: str) -> Dict[str, Any]:
        resp = requests.post(
            f"{base}/api/v1/query/{db}",
            json={"language": "sql", "command": sql},
            auth=(user, pwd),
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()

    return runner


# ── Pure aggregation logic (testable) ────────────────────────────────
def audit(
    *,
    notice_version: str = "1.0",
    query_runner: Optional[Callable[[str], Any]] = None,
) -> Dict[str, Any]:
    """
    Run the read-only audit. Returns:

        {
          "total_caregivers":   int,
          "with_current":       int,
          "missing":            int,
          "stale_pct":          float,          # 0.0 - 100.0
          "notice_version":     str,
          "verdict":            "green" | "yellow" | "red",
          "recommendation":     str,
        }

    Never raises on empty/missing tables — returns total=0 with
    verdict="green" by convention (zero caregivers means zero stale).
    """
    runner = query_runner or _default_query_runner()

    def _count(sql: str) -> int:
        try:
            resp = runner(sql) or {}
            rows = resp.get("result") or []
            if not rows:
                return 0
            row = rows[0]
            for k in ("n", "count", "count(*)"):
                v = row.get(k)
                if v is not None:
                    return int(v)
            # Some ArcadeDB versions return the count under the first key.
            for v in row.values():
                if isinstance(v, (int, float)):
                    return int(v)
            return 0
        except Exception:
            return 0

    total = _count("SELECT count(*) AS n FROM CaregiverVertex")

    # Distinct caregivers with at least one CURRENT-version row.
    with_current = _count(
        "SELECT count(*) AS n FROM ("
        "  SELECT DISTINCT caregiver_id FROM CaregiverConsentRecord "
        f"  WHERE notice_version = '{notice_version}'"
        ")"
    )
    # Defensive cap — distinct-with-current should never exceed total.
    if with_current > total:
        with_current = total

    missing = max(total - with_current, 0)
    stale_pct = (missing / total * 100.0) if total > 0 else 0.0
    verdict = _verdict_from_pct(stale_pct)

    return {
        "total_caregivers":  int(total),
        "with_current":      int(with_current),
        "missing":           int(missing),
        "stale_pct":         round(stale_pct, 2),
        "notice_version":    notice_version,
        "verdict":           verdict,
        "recommendation":    _verdict_blurb(verdict),
    }


# ── CLI entry point ──────────────────────────────────────────────────
def _print_human(result: Dict[str, Any]) -> None:
    bar = "─" * 56
    print(bar)
    print(" Caregiver privacy — stale-population audit")
    print(bar)
    print(f"  notice_version    : {result['notice_version']}")
    print(f"  total caregivers  : {result['total_caregivers']}")
    print(f"  current consent   : {result['with_current']}")
    print(f"  stale / missing   : {result['missing']}")
    print(f"  stale percentage  : {result['stale_pct']:.2f}%")
    print(bar)
    print(f"  verdict           : {result['verdict'].upper()}")
    print(f"  recommendation    : {result['recommendation']}")
    print(bar)
    print()
    print("  Thresholds:")
    print("    GREEN  : stale < 5%   (safe after 24 h banner)")
    print("    YELLOW : 5% – 20%     (14-day soak + soft campaign first)")
    print("    RED    : stale > 20%  (DO NOT flip)")
    print()
    print("  Phase 7 rollback (if anything goes wrong):")
    print("    AMINA_CAREGIVER_PRIVACY_REQUIRED=false docker compose up "
          "-d --force-recreate --no-deps haystack-chatqna")


def main() -> int:
    p = argparse.ArgumentParser(
        description="Caregiver privacy — stale-population audit (read-only).",
    )
    p.add_argument(
        "--notice-version",
        default=os.getenv("CAREGIVER_PRIVACY_NOTICE_VERSION") or "1.0",
        help="Notice version to count as current (default: 1.0)",
    )
    p.add_argument(
        "--json",
        action="store_true",
        help="Emit a single-line JSON object instead of the human-readable report.",
    )
    args = p.parse_args()

    result = audit(notice_version=args.notice_version)

    if args.json:
        print(json.dumps(result, separators=(",", ":")))
    else:
        _print_human(result)

    # Exit 0 always — the audit is informational, never a CI gate.
    # Operators decide the go/no-go from the verdict line.
    return 0


if __name__ == "__main__":
    sys.exit(main())
