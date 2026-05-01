#!/usr/bin/env python3
"""Interactive native-speaker review CLI for the v4.2 golden pairs.

Usage:
    REVIEWER_NAME="Alkalo Bah" python scripts/review_translations.py
    python scripts/review_translations.py --category negation_critical
    python scripts/review_translations.py --resume

For each unvalidated pair the reviewer is shown the English source +
the candidate Mandinka and prompts:
    [a] Accept            -- mark as validated, keep current Mandinka
    [e] Edit and accept   -- prompt for corrected Mandinka, mark validated
    [r] Reject            -- mark explicitly rejected (validated=false, reviewed=true)
    [s] Skip              -- leave pair untouched
    [q] Quit              -- save progress and exit

Validation state is persisted back into the SAME JSON file. Each
accepted / edited / rejected pair gets:
    "validated":     bool
    "reviewed":      true
    "reviewed_at":   ISO-8601 UTC timestamp
    "reviewed_by":   $REVIEWER_NAME (env) or "anonymous"
    "review_note":   optional free-text note from the reviewer

The script never deletes data: rejected entries keep their original
``mandinka`` field for diff history; accepted-with-edit entries
preserve the original under ``original_mandinka``.

Resuming is safe -- the script picks up at the first pair that has
no ``reviewed: true`` marker.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional


# Resolve the JSON file relative to this script so it works whether
# invoked from repo root or from the scripts/ directory.
_HERE = Path(__file__).resolve().parent
_GOLDEN_FILE = (
    _HERE.parent
    / "haystack-stack"
    / "haystack-chatqna"
    / "src"
    / "translation_v4"
    / "eval"
    / "golden_translations.json"
)


def _load() -> Dict[str, Any]:
    if not _GOLDEN_FILE.exists():
        print(f"[ERROR] golden_translations.json not found at {_GOLDEN_FILE}", file=sys.stderr)
        sys.exit(1)
    with _GOLDEN_FILE.open("r", encoding="utf-8") as f:
        return json.load(f)


def _save(data: Dict[str, Any]) -> None:
    # Atomic write -- if the process is killed mid-write we don't
    # corrupt the file. The reviewer's flow may be many keystrokes;
    # we save after every decision.
    tmp = _GOLDEN_FILE.with_suffix(".json.partial")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=False)
    tmp.replace(_GOLDEN_FILE)


def _now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _summary(pairs: List[Dict[str, Any]]) -> Dict[str, int]:
    out = {
        "total":            len(pairs),
        "validated":        sum(1 for p in pairs if p.get("validated")),
        "rejected":         sum(1 for p in pairs if p.get("reviewed") and not p.get("validated")),
        "reviewed":         sum(1 for p in pairs if p.get("reviewed")),
        "remaining":        sum(1 for p in pairs if not p.get("reviewed")),
        "critical":         sum(1 for p in pairs if p.get("critical")),
        "critical_done":    sum(1 for p in pairs if p.get("critical") and p.get("reviewed")),
    }
    return out


def _print_progress(stats: Dict[str, int]) -> None:
    print(
        f"  validated: {stats['validated']}/{stats['total']}  "
        f"rejected: {stats['rejected']}  "
        f"remaining: {stats['remaining']}  "
        f"critical-done: {stats['critical_done']}/{stats['critical']}"
    )


def _ask(prompt: str) -> str:
    try:
        return input(prompt).strip()
    except (EOFError, KeyboardInterrupt):
        return "q"


def _review_one(pair: Dict[str, Any], reviewer: str, total_remaining: int) -> bool:
    """Returns True if the reviewer chose to continue, False to quit."""
    print()
    print("─" * 72)
    print(f"  ID:       {pair.get('id')}")
    print(f"  Category: {pair.get('category')}")
    if pair.get("critical"):
        print(f"  ⚠ critical safety pair")
    if pair.get("v42_purpose"):
        print(f"  Purpose:  {pair['v42_purpose']}")
    print(f"  Remaining in this run: {total_remaining}")
    print()
    print(f"  English : {pair.get('english','')}")
    print(f"  Mandinka: {pair.get('mandinka','')}")
    print()
    print("  [a]ccept  [e]dit & accept  [r]eject  [s]kip  [q]uit")
    choice = _ask("  > ").lower()
    if choice == "q":
        return False
    if choice == "s":
        return True

    note = ""
    if choice == "a":
        pair["validated"] = True
    elif choice == "e":
        new_text = _ask("  New Mandinka: ").strip()
        if not new_text:
            print("  (empty -- treating as skip)")
            return True
        pair["original_mandinka"] = pair.get("mandinka", "")
        pair["mandinka"] = new_text
        pair["validated"] = True
        note = _ask("  Optional note (Enter to skip): ").strip()
    elif choice == "r":
        pair["validated"] = False
        note = _ask("  Reason for rejection: ").strip()
    else:
        print(f"  unknown choice {choice!r}, skipping")
        return True

    pair["reviewed"]    = True
    pair["reviewed_at"] = _now_iso()
    pair["reviewed_by"] = reviewer
    if note:
        pair["review_note"] = note
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Native-speaker review of v4.2 golden pairs")
    parser.add_argument("--category", help="Only review pairs in this category")
    parser.add_argument("--id", help="Only review the pair with this id")
    parser.add_argument("--resume", action="store_true", help="Skip already-reviewed pairs (default)")
    parser.add_argument("--all", action="store_true", help="Re-review everything (overrides --resume)")
    parser.add_argument("--summary-only", action="store_true", help="Print stats and exit; no prompts")
    args = parser.parse_args()

    reviewer = (os.environ.get("REVIEWER_NAME") or "").strip() or "anonymous"
    data = _load()
    pairs: List[Dict[str, Any]] = list(data.get("pairs") or [])

    stats = _summary(pairs)
    print(f"[review] {_GOLDEN_FILE}")
    print(f"[review] reviewer = {reviewer}")
    _print_progress(stats)

    if args.summary_only:
        return 0

    # Filter target pairs.
    candidates: List[Dict[str, Any]] = []
    for p in pairs:
        if args.id and p.get("id") != args.id:
            continue
        if args.category and p.get("category") != args.category:
            continue
        if not args.all and p.get("reviewed"):
            continue
        candidates.append(p)

    if not candidates:
        print("[review] nothing to do (everything matching the filter is already reviewed).")
        return 0

    print(f"[review] {len(candidates)} pair(s) to review")
    print("[review] press q at any prompt to save progress and exit\n")

    for i, pair in enumerate(candidates):
        remaining = len(candidates) - i
        keep_going = _review_one(pair, reviewer, remaining)
        # Save after every decision so an interrupt never loses work.
        _save(data)
        if not keep_going:
            print("[review] quitting; progress saved.")
            break

    print()
    final = _summary(pairs)
    print("[review] final state:")
    _print_progress(final)
    return 0


if __name__ == "__main__":
    sys.exit(main())
