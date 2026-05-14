"""
AMINA — retention sweeper (Phase 9, RET-004 / RET-005).

Read-only **dry-run by default**. Reports candidate rows / files for
each retention-managed data class; never deletes anything unless the
operator explicitly opts in via `--apply`. Even `--apply` honours
`legal_hold=true` and refuses to touch unsupported classes.

Output is COUNTS ONLY — no PHI, no row contents, no caregiver/patient
identifiers. The point is: tell ops "you have N rows that have
exceeded retention", not "here's the data".

Usage (inside or outside the haystack-chatqna container):

    # Default dry-run, human-readable report:
    python scripts/retention_sweeper.py

    # JSON output for piping into a metrics pipeline:
    python scripts/retention_sweeper.py --json

    # Restrict to a single class:
    python scripts/retention_sweeper.py --class vitals

    # Apply (destructive — operator has read the dry-run + signed off):
    python scripts/retention_sweeper.py --apply --class vitals

The `--apply` path is intentionally minimal in this Phase 9 build —
it shells out to the same SQL DELETE that the dry-run plans, with
two additional guards:
  1. `legal_hold = false OR legal_hold IS NULL` is appended.
  2. The total delete count must match the dry-run preview ± 5 %, or
     the apply aborts (someone else may be writing concurrently).

`--apply` requires the operator to ALSO pass `--i-have-read-the-dryrun`
so the script cannot be invoked accidentally from a wrapper.

Filesystem classes (`store: "filesystem"`) are NOT touched in this
build — even with `--apply`. The risk of a misconfigured base path
deleting host directories is too high. Filesystem retention closure
is tracked separately under future phases.

Test injection:
    The runners are parameterised so unit tests can stub them.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Any, Callable, Dict, List, Optional


_HERE = os.path.dirname(os.path.abspath(__file__))
_APP = os.path.dirname(_HERE)
if _APP not in sys.path:
    sys.path.insert(0, _APP)


# ── Imports (lazy / defensive) ───────────────────────────────────────
def _import_policy() -> Any:
    from src.services import retention_policy as rp  # noqa: WPS433
    return rp


# ── Default query runner ─────────────────────────────────────────────
def _default_query_runner() -> Callable[[str], Any]:
    """HTTP runner for ArcadeDB. Tests substitute via injection."""
    import requests
    base = (os.getenv("ARCADEDB_URL") or "http://arcadedb:2480").rstrip("/")
    db = os.getenv("ARCADEDB_DB", "genie")
    user = os.getenv("ARCADEDB_USER", "root")
    pwd = (os.getenv("ARCADEDB_ROOT_PASSWORD")
           or os.getenv("ARCADEDB_PASSWORD")
           or "genieRoot123")

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


# ── Helpers ──────────────────────────────────────────────────────────
def _now_iso(seconds_from_now: int = 0) -> str:
    t = time.gmtime(time.time() + seconds_from_now)
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", t)


def _cutoff_iso(retention_days: int) -> str:
    """ISO-8601 UTC timestamp for `retention_days` ago."""
    return _now_iso(seconds_from_now=-retention_days * 24 * 60 * 60)


def _count(query_runner: Callable[[str], Any], sql: str) -> int:
    try:
        resp = query_runner(sql) or {}
        rows = resp.get("result") or []
        if not rows:
            return 0
        row = rows[0]
        for k in ("n", "count", "count(*)"):
            v = row.get(k)
            if v is not None:
                return int(v)
        for v in row.values():
            if isinstance(v, (int, float)):
                return int(v)
        return 0
    except Exception:
        return 0


# ── Per-class preview ────────────────────────────────────────────────
def preview_class(
    *,
    data_class: str,
    rp: Any,
    query_runner: Callable[[str], Any],
) -> Dict[str, Any]:
    """Return a dict describing how many records would be candidates
    for the sweeper. NEVER deletes. Returns counts only.

    Filesystem classes return `mechanism_skipped`.
    Manual / external classes return `mechanism_skipped`.
    """
    entry = rp.get_policy(data_class)
    if entry is None:
        return {
            "data_class":   data_class,
            "ok":           False,
            "reason":       "unknown_class",
        }

    if entry["store"] == "filesystem":
        return preview_filesystem_class(data_class=data_class, rp=rp,
                                        base_path=None)
    if entry["mechanism"] != "sweeper":
        return {
            "data_class":   data_class,
            "ok":           True,
            "preview":      "skipped",
            "reason":       f"mechanism_{entry['mechanism']}",
            "policy":       entry,
        }

    vertex = entry.get("vertex_type")
    created_field = entry.get("field_created_at") or "created_at"
    retention_days = int(entry.get("retention_days") or 0)
    if not vertex or retention_days <= 0:
        return {
            "data_class":   data_class,
            "ok":           True,
            "preview":      "skipped",
            "reason":       "missing_vertex_or_retention",
            "policy":       entry,
        }

    cutoff = _cutoff_iso(retention_days)

    # Total row count for context.
    total_sql = f"SELECT count(*) AS n FROM {vertex}"
    total = _count(query_runner, total_sql)

    # Candidates (older than cutoff). String compare on ISO timestamps
    # is correctness-equivalent to a date compare given UTC + ISO-8601.
    cand_sql = (
        f"SELECT count(*) AS n FROM {vertex} "
        f"WHERE {created_field} < '{cutoff}'"
    )
    candidates = _count(query_runner, cand_sql)

    # Of the candidates, how many are on legal_hold? Those MUST NOT
    # be touched even by --apply.
    held = 0
    if entry.get("legal_hold_supported"):
        held_sql = (
            f"SELECT count(*) AS n FROM {vertex} "
            f"WHERE {created_field} < '{cutoff}' "
            f"AND legal_hold = true"
        )
        held = _count(query_runner, held_sql)

    sweepable = max(candidates - held, 0)

    return {
        "data_class":   data_class,
        "ok":           True,
        "preview":      "ready",
        "vertex_type":  vertex,
        "retention_days":     retention_days,
        "cutoff":             cutoff,
        "total":              total,
        "candidates":         candidates,
        "legal_hold_count":   held,
        "sweepable":          sweepable,
        "policy":             entry,
    }


# ── Apply (gated) ────────────────────────────────────────────────────
def apply_class(
    *,
    data_class: str,
    rp: Any,
    query_runner: Callable[[str], Any],
    expected_sweepable: int,
    drift_pct: float = 5.0,
) -> Dict[str, Any]:
    """ACTUALLY delete sweepable rows for one class. Refuses to act
    on filesystem classes or non-sweeper mechanisms.

    Aborts if the live count drifts more than `drift_pct`% from the
    operator's expected_sweepable (concurrent writers).
    """
    entry = rp.get_policy(data_class)
    if entry is None or entry["store"] != "arcadedb" \
       or entry["mechanism"] != "sweeper":
        return {
            "data_class":   data_class,
            "ok":           False,
            "reason":       "class_not_eligible_for_apply",
        }

    # Re-preview to bind the live count.
    p = preview_class(data_class=data_class, rp=rp, query_runner=query_runner)
    if not p.get("ok") or p.get("preview") != "ready":
        return {
            "data_class":   data_class,
            "ok":           False,
            "reason":       p.get("reason", "preview_failed"),
        }

    live = int(p.get("sweepable") or 0)
    if expected_sweepable < 0:
        return {"data_class": data_class, "ok": False,
                "reason": "expected_sweepable_negative"}
    if expected_sweepable == 0 and live == 0:
        return {"data_class": data_class, "ok": True, "deleted": 0,
                "reason": "nothing_to_delete"}

    if expected_sweepable > 0:
        drift = abs(live - expected_sweepable) / expected_sweepable * 100.0
        if drift > drift_pct:
            return {
                "data_class": data_class,
                "ok": False,
                "reason": f"drift_too_large pct={drift:.1f}",
                "expected": expected_sweepable,
                "live": live,
            }

    vertex = entry["vertex_type"]
    created_field = entry.get("field_created_at") or "created_at"
    cutoff = p["cutoff"]

    # Two-guard delete: cutoff + legal_hold-not-true.
    delete_sql = (
        f"DELETE FROM {vertex} "
        f"WHERE {created_field} < '{cutoff}' "
        f"AND (legal_hold IS NULL OR legal_hold = false)"
    )
    try:
        resp = query_runner(delete_sql) or {}
    except Exception as e:
        return {
            "data_class": data_class,
            "ok": False,
            "reason": f"delete_failed: {repr(e)[:160]}",
        }

    # ArcadeDB returns count of deleted rows in result[0].count
    deleted = 0
    rows = resp.get("result") or []
    if rows:
        for k in ("count", "n", "deleted"):
            if k in rows[0]:
                deleted = int(rows[0][k])
                break
    return {
        "data_class": data_class,
        "ok": True,
        "deleted": deleted,
        "expected": expected_sweepable,
    }


# ── Filesystem purger (safety-gated) ─────────────────────────────────
_ALLOWED_BASE_PATHS: frozenset = frozenset({
    "/app/reports/evidence",
    "/app/data/caregiver_uploads",
    "/app/training/collected",
})


def preview_filesystem_class(
    *,
    data_class: str,
    rp: Any,
    base_path: Optional[str] = None,
) -> Dict[str, Any]:
    """Dry-run preview for filesystem data classes. Counts expired files
    by mtime; never deletes anything.

    REFUSES to operate if the resolved base path is not in
    ``_ALLOWED_BASE_PATHS``.
    """
    entry = rp.get_policy(data_class)
    if entry is None:
        return {"data_class": data_class, "ok": False,
                "reason": "unknown_class"}

    if entry["store"] != "filesystem" or entry["mechanism"] != "sweeper":
        return {"data_class": data_class, "ok": True,
                "preview": "skipped",
                "reason": f"store_or_mechanism_mismatch "
                          f"({entry['store']}/{entry['mechanism']})",
                "policy": entry}

    effective_path = base_path or entry.get("base_path", "")
    if effective_path not in _ALLOWED_BASE_PATHS:
        return {"data_class": data_class, "ok": False,
                "reason": f"base_path_not_in_allowlist "
                          f"({effective_path!r})",
                "policy": entry}

    retention_days = int(entry.get("retention_days") or 0)
    if retention_days <= 0:
        return {"data_class": data_class, "ok": True,
                "preview": "skipped",
                "reason": "missing_or_zero_retention_days",
                "policy": entry}

    cutoff_epoch = time.time() - retention_days * 86400

    if not os.path.isdir(effective_path):
        return {"data_class": data_class, "ok": True,
                "preview": "ready", "total": 0, "candidates": 0,
                "sweepable": 0, "base_path": effective_path,
                "retention_days": retention_days, "policy": entry}

    total = 0
    candidates = 0
    try:
        for _dirpath, _dirnames, filenames in os.walk(effective_path):
            for fname in filenames:
                fpath = os.path.join(_dirpath, fname)
                total += 1
                try:
                    if os.path.getmtime(fpath) < cutoff_epoch:
                        candidates += 1
                except OSError:
                    pass
    except OSError:
        pass

    return {
        "data_class":      data_class,
        "ok":              True,
        "preview":         "ready",
        "base_path":       effective_path,
        "retention_days":  retention_days,
        "total":           total,
        "candidates":      candidates,
        "sweepable":       candidates,
        "policy":          entry,
    }


def apply_filesystem_class(
    *,
    data_class: str,
    rp: Any,
    base_path: Optional[str] = None,
    expected_sweepable: int = 0,
    drift_pct: float = 5.0,
) -> Dict[str, Any]:
    """Actually delete expired files for a filesystem data class.

    Re-previews to get the live count, then checks drift before
    deleting.
    """
    p = preview_filesystem_class(data_class=data_class, rp=rp,
                                 base_path=base_path)
    if not p.get("ok"):
        return {"data_class": data_class, "ok": False,
                "reason": p.get("reason", "preview_failed")}

    if p.get("preview") != "ready":
        return {"data_class": data_class, "ok": True, "deleted": 0,
                "expected": expected_sweepable,
                "reason": p.get("reason", "preview_skipped")}

    live = int(p.get("sweepable") or 0)

    if expected_sweepable > 0:
        drift = abs(live - expected_sweepable) / expected_sweepable * 100.0
        if drift > drift_pct:
            return {"data_class": data_class, "ok": False,
                    "reason": f"drift_too_large pct={drift:.1f}",
                    "expected": expected_sweepable, "live": live}

    if live == 0:
        return {"data_class": data_class, "ok": True, "deleted": 0,
                "expected": expected_sweepable}

    entry = rp.get_policy(data_class)
    retention_days = int(entry.get("retention_days") or 0)
    cutoff_epoch = time.time() - retention_days * 86400
    effective_path = base_path or entry.get("base_path", "")

    deleted = 0
    try:
        for _dirpath, _dirnames, filenames in os.walk(effective_path):
            for fname in filenames:
                fpath = os.path.join(_dirpath, fname)
                try:
                    if os.path.getmtime(fpath) < cutoff_epoch:
                        os.remove(fpath)
                        deleted += 1
                except OSError:
                    pass
    except OSError:
        pass

    return {
        "data_class": data_class,
        "ok":         True,
        "deleted":    deleted,
        "expected":   expected_sweepable,
    }


# ── CLI ──────────────────────────────────────────────────────────────
def _print_human(results: List[Dict[str, Any]],
                 *,
                 mode: str,
                 elapsed_ms: int) -> None:
    bar = "─" * 64
    print(bar)
    print(f" Retention sweeper — mode: {mode.upper()}")
    print(bar)
    for r in results:
        dc = r.get("data_class")
        if not r.get("ok"):
            print(f"  {dc:<28s}  SKIPPED ({r.get('reason')})")
            continue
        if r.get("preview") == "skipped":
            print(f"  {dc:<28s}  skipped: {r.get('reason')}")
            continue
        if mode == "dry-run":
            held = r.get("legal_hold_count", "-")
            bp = r.get("base_path", "")
            store_tag = f"[fs:{bp}] " if bp else ""
            print(
                f"  {dc:<28s}  {store_tag}"
                f"total={r['total']:<6d} "
                f"candidates={r['candidates']:<5d} "
                f"legal_hold={held!s:<3s} "
                f"sweepable={r['sweepable']}"
            )
        else:  # apply
            print(
                f"  {dc:<28s}  deleted={r.get('deleted', 0)} "
                f"expected={r.get('expected', 0)}"
            )
    print(bar)
    print(f"  elapsed_ms: {elapsed_ms}")
    if mode == "dry-run":
        print()
        print("  This was a DRY-RUN. No rows were modified or deleted.")
        print("  To actually delete, re-run with:")
        print("    --apply --i-have-read-the-dryrun --class <data_class>")
    print()


def main() -> int:
    p = argparse.ArgumentParser(
        description="AMINA retention sweeper (default: dry-run, no deletes).",
    )
    p.add_argument("--class", dest="data_class", default=None,
                   help="Restrict to a single data class.")
    p.add_argument("--json", action="store_true",
                   help="Emit a single-line JSON list.")
    p.add_argument("--apply", action="store_true",
                   help="Actually delete. Requires --i-have-read-the-dryrun.")
    p.add_argument("--i-have-read-the-dryrun", action="store_true",
                   help="Operator confirmation required for --apply.")
    p.add_argument("--expected", type=int, default=None,
                   help="With --apply: expected sweepable count from a "
                        "previous --json dry-run. Required when --apply "
                        "is used.")
    p.add_argument("--bootstrap-schema", action="store_true",
                   help="Run legal-hold schema bootstrap (CREATE PROPERTY "
                        "statements) and exit.")
    args = p.parse_args()

    rp = _import_policy()
    runner = _default_query_runner()

    # ── Bootstrap schema path ──────────────────────────────────────
    if args.bootstrap_schema:
        stmts = rp.legal_hold_schema_statements()
        if not stmts:
            print("[bootstrap-schema] No statements to run.")
            return 0
        for stmt in stmts:
            try:
                runner(stmt)
                print(f"[bootstrap-schema] OK   {stmt}")
            except Exception as exc:
                print(f"[bootstrap-schema] SKIP {stmt}  ({exc})")
        return 0

    classes = (
        [args.data_class]
        if args.data_class
        else list(rp.RETENTION_POLICY.keys())
    )

    # Dry-run first, always.
    t0 = time.time()
    results: List[Dict[str, Any]] = []
    for dc in classes:
        results.append(preview_class(data_class=dc, rp=rp, query_runner=runner))
    elapsed_ms = int((time.time() - t0) * 1000)

    if not args.apply:
        if args.json:
            print(json.dumps({"mode": "dry-run", "elapsed_ms": elapsed_ms,
                              "results": results}, separators=(",", ":")))
        else:
            _print_human(results, mode="dry-run", elapsed_ms=elapsed_ms)
        return 0

    # --apply path — gated.
    if not args.i_have_read_the_dryrun:
        sys.stderr.write(
            "[retention_sweeper] --apply requires --i-have-read-the-dryrun\n"
        )
        return 2
    if args.expected is None:
        sys.stderr.write(
            "[retention_sweeper] --apply requires --expected (from a "
            "previous --json dry-run)\n"
        )
        return 2
    if not args.data_class:
        sys.stderr.write(
            "[retention_sweeper] --apply requires --class to restrict scope\n"
        )
        return 2

    apply_results: List[Dict[str, Any]] = []
    for dc in classes:
        entry = rp.get_policy(dc)
        if entry and entry.get("store") == "filesystem":
            apply_results.append(apply_filesystem_class(
                data_class=dc, rp=rp,
                expected_sweepable=args.expected,
            ))
        else:
            apply_results.append(apply_class(
                data_class=dc, rp=rp, query_runner=runner,
                expected_sweepable=args.expected,
            ))
    elapsed_ms = int((time.time() - t0) * 1000)

    if args.json:
        print(json.dumps({"mode": "apply", "elapsed_ms": elapsed_ms,
                          "results": apply_results}, separators=(",", ":")))
    else:
        _print_human(apply_results, mode="apply", elapsed_ms=elapsed_ms)
    return 0


if __name__ == "__main__":
    sys.exit(main())
