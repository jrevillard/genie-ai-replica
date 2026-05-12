#!/usr/bin/env python3
"""
AMINA Care - DHIS2 Element Remap Helper
==========================================
A repeatable tool that maps AMINA's internal metrics
(AMINA_CONS_TOTAL, AMINA_NCD_HTN, etc.) to data-element IDs in a
specific DHIS2 dataset by name-similarity scoring.

Use it whenever:
  * The upstream DHIS2 server is reconfigured (datasets renamed,
    elements re-issued) — the live health probe at /api/v1/dhis2/health
    surfaces this drift loudly; the helper proposes a fix.
  * You're switching to a new DHIS2 instance for a new customer.
  * You want to verify the current map is still semantically reasonable.

Modes
-----
  --suggest    (default)  Score elements in the CURRENTLY-CONFIGURED dataset
                          and print a proposed DHIS2_DATA_ELEMENT_MAP. No writes.
  --scan-all              Walk ALL datasets the service account can see,
                          rank by AMINA-fit score, pick the winner, propose
                          its map. No writes.
  --apply                 Run --scan-all (or use --dataset to skip scanning),
                          write the result to /root/amina/haystack-stack/.env,
                          recreate haystack-chatqna, re-run the health probe,
                          and exit non-zero if the probe still reports fail.

Optional
--------
  --dataset <id>          Pin a specific dataset for scoring (skips --scan-all).
  --api-base <url>        Default: http://localhost:8000  (when run inside
                          haystack-chatqna). Set to https://api.amina-design.com
                          to run from a workstation.
  --admin-user <name>     Default: admin
  --admin-pass <pw>       Default: amina2026 (overridable for non-demo)
  --env-file <path>       Default: /root/amina/haystack-stack/.env
                          Where --apply writes DHIS2_DATASET_ID and
                          DHIS2_DATA_ELEMENT_MAP.
  --no-recreate           --apply skips the docker compose up.
  --no-confirm            --apply doesn't prompt before writing.

Run from inside haystack-chatqna (where the API is on localhost):
    docker exec haystack-chatqna python3 /app/scripts/dhis2_remap_helper.py --scan-all

Run from the host (talks to the public API):
    python3 /root/amina/haystack-stack/haystack-chatqna/scripts/dhis2_remap_helper.py \
        --api-base https://api.amina-design.com --apply

Exit codes
----------
  0  proposal printed (suggest/scan-all) or --apply succeeded with health=ok
  1  --apply succeeded but health probe still WARN
  2  --apply succeeded but health probe still FAIL
  3  could not reach DHIS2 / no datasets visible
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from typing import Any, Dict, List, Optional, Tuple

import requests


# ── Metric -> keyword catalog ───────────────────────────────────────
#
# Edit this when AMINA's internal metric set changes. Keywords are
# lower-cased substring matches against DHIS2 element names; the higher
# the keyword count, the better the match.

AMINA_METRICS: Dict[str, List[str]] = {
    "AMINA_CONS_TOTAL":     ["total", "all consult", "attendance", "visits", "opd"],
    "AMINA_CONS_EMERGENCY": ["emergency", "urgent", "critical", "a&e", "a and e"],
    "AMINA_CONS_URGENT":    ["urgent", "priority", "emergency"],
    "AMINA_CONS_ROUTINE":   ["routine", "follow", "review", "scheduled", "attendance"],
    "AMINA_NCD_HTN":        ["hypertens", "blood pressure", "bp ", "htn"],
    "AMINA_NCD_DM":         ["diabet", "glucose", "dm "],
    "AMINA_NCD_ASTHMA":     ["asthma", "respiratory", "wheez"],
    "AMINA_MCH":            ["maternal", "antenatal", "anc ", "pnc", "pregnan",
                             "mch ", "mother", "newborn"],
    "AMINA_MENTAL_HEALTH":  ["mental", "depress", "anxiety", "psychos", "mh "],
    "AMINA_CG_ALERTS":      ["alert", "caregiver", "referral"],
    "AMINA_SAFETY_BLOCKS":  ["safety", "block", "incident", "adverse"],
}


# ── Helpers ─────────────────────────────────────────────────────────

def _admin_token(api_base: str, user: str, pw: str) -> str:
    r = requests.post(f"{api_base}/api/v1/admin/login",
                      json={"username": user, "password": pw}, timeout=10)
    r.raise_for_status()
    body = r.json()
    tok = body.get("token") or body.get("access_token")
    if not tok:
        raise RuntimeError(f"admin login returned no token: {body!r}")
    return tok


def _hdrs(tok: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {tok}"}


def _name_score(name: str, keywords: List[str]) -> int:
    n = (name or "").lower()
    return sum(1 for kw in keywords if kw in n)


def _best_for(metric: str, elements: List[Dict[str, Any]]) -> Tuple[Optional[Dict[str, Any]], int]:
    keywords = AMINA_METRICS[metric]
    best, best_score = None, 0
    for e in elements:
        s = _name_score(e.get("name") or e.get("displayName") or "", keywords)
        if s > best_score:
            best, best_score = e, s
    return best, best_score


def _list_datasets(api_base: str, hdrs: Dict[str, str]) -> List[Dict[str, Any]]:
    r = requests.get(f"{api_base}/api/v1/dhis2/discover", headers=hdrs, timeout=20)
    r.raise_for_status()
    return r.json().get("datasets") or r.json().get("data_sets") or []


def _describe_dataset(api_base: str, hdrs: Dict[str, str], dataset_id: str) -> Dict[str, Any]:
    r = requests.get(f"{api_base}/api/v1/dhis2/discover/dataset/{dataset_id}",
                     headers=hdrs, timeout=20)
    r.raise_for_status()
    return r.json()


def _current_dataset_id(api_base: str, hdrs: Dict[str, str]) -> str:
    r = requests.get(f"{api_base}/api/v1/dhis2/mapping/current", headers=hdrs, timeout=10)
    r.raise_for_status()
    return (r.json().get("dataset_id") or "").strip()


# ── Scoring + proposal ──────────────────────────────────────────────

def score_dataset(api_base: str, hdrs: Dict[str, str], ds_id: str
                  ) -> Tuple[int, Dict[str, Tuple[str, str, int]], List[Tuple[str, str]]]:
    """Returns (total_score, matches, all_elems).

    matches: { metric: (element_id, element_name, score) }  for every metric
             that scored > 0 in this dataset.
    all_elems: list of (element_id, element_name) for the dataset.
    """
    detail = _describe_dataset(api_base, hdrs, ds_id)
    if detail.get("error"):
        return 0, {}, []
    elements = detail.get("data_elements") or []
    matches: Dict[str, Tuple[str, str, int]] = {}
    total = 0
    for metric in AMINA_METRICS:
        e, s = _best_for(metric, elements)
        if e and s > 0:
            matches[metric] = (e.get("id"), e.get("name") or e.get("displayName") or "", s)
            total += s
    all_elems = [(e.get("id"), e.get("name") or e.get("displayName") or "") for e in elements]
    return total, matches, all_elems


def build_map(matches: Dict[str, Tuple[str, str, int]],
              all_elems: List[Tuple[str, str]]
              ) -> Tuple[Dict[str, str], List[str]]:
    """Build the DHIS2_DATA_ELEMENT_MAP. For metrics that didn't match,
    fall back to a spare element ID so the map RESOLVES (placeholder).
    Returns (map, list_of_metrics_that_are_placeholders)."""
    used = {m[0] for m in matches.values()}
    spare = [eid for (eid, _) in all_elems if eid and eid not in used]
    out: Dict[str, str] = {}
    placeholders: List[str] = []
    for metric in AMINA_METRICS:
        if metric in matches:
            out[metric] = matches[metric][0]
        elif spare:
            out[metric] = spare.pop(0)
            placeholders.append(metric)
        else:
            placeholders.append(metric)
    return out, placeholders


def print_proposal(dataset_id: str, dataset_name: str,
                   matches: Dict[str, Tuple[str, str, int]],
                   new_map: Dict[str, str],
                   placeholders: List[str],
                   all_elems: List[Tuple[str, str]]) -> None:
    name_by_id = dict(all_elems)
    print()
    print(f"Proposed mapping against dataset: {dataset_id}  ({dataset_name})")
    print("=" * 78)
    print(f"  {'AMINA metric':<22} {'element_id':<13} {'kind':<13} element_name")
    print(f"  {'-' * 22} {'-' * 13} {'-' * 13} {'-' * 50}")
    for metric, eid in new_map.items():
        kind = "MATCH" if metric in matches else "placeholder"
        ename = name_by_id.get(eid, "?")
        print(f"  {metric:<22} {eid:<13} {kind:<13} {ename[:50]}")
    print()
    if placeholders:
        print(f"  ! {len(placeholders)} metric(s) had NO semantic match in this dataset:")
        for p in placeholders:
            print(f"      - {p}")
        print("    These will resolve correctly (no-op safe) but the data they push")
        print("    is semantically arbitrary. Replace via DHIS2 admin UI for prod.")
    print()


# ── Mode: scan-all ──────────────────────────────────────────────────

def scan_all(api_base: str, hdrs: Dict[str, str]) -> Optional[str]:
    datasets = _list_datasets(api_base, hdrs)
    if not datasets:
        print("[fail] no datasets visible to the AMINA service account on this DHIS2")
        return None

    print(f"\nScanning {len(datasets)} datasets for best AMINA fit...")
    results = []
    for ds in datasets:
        did = ds.get("id")
        if not did:
            continue
        score, matches, all_elems = score_dataset(api_base, hdrs, did)
        results.append((did, ds.get("name") or "", score, matches, all_elems))
    results.sort(key=lambda r: -r[2])

    print()
    print("Top 5 candidate datasets (by AMINA-metric match score):")
    print(f"  {'#':<3} {'id':<13} {'score':<6} {'matched':<8} {'#elems':<7} name")
    for i, (did, dname, score, matches, all_elems) in enumerate(results[:5], 1):
        print(f"  {i:<3} {did:<13} {score:<6} {len(matches):<8} "
              f"{len(all_elems):<7} {dname[:50]}")

    winner = results[0]
    if winner[2] == 0 and not winner[3]:
        print("[warn] no dataset has any AMINA-keyword matches; placeholders only")
    return winner[0]


# ── Mode: apply ─────────────────────────────────────────────────────

def write_env(env_path: str, dataset_id: str, element_map: Dict[str, str], confirm: bool) -> None:
    if confirm:
        ans = input(f"\nWrite to {env_path}? [y/N] ").strip().lower()
        if ans not in ("y", "yes"):
            print("[aborted by user]")
            sys.exit(0)
    bak = f"{env_path}.bak.remap.{int(time.time())}"
    shutil.copyfile(env_path, bak)
    print(f"  backup -> {bak}")
    with open(env_path) as f:
        lines = f.readlines()
    new_id_line  = f"DHIS2_DATASET_ID={dataset_id}\n"
    new_map_line = f"DHIS2_DATA_ELEMENT_MAP={json.dumps(element_map, separators=(',', ':'))}\n"
    saw_id = saw_map = False
    out = []
    for line in lines:
        if line.startswith("DHIS2_DATASET_ID="):
            out.append(new_id_line); saw_id = True
        elif line.startswith("DHIS2_DATA_ELEMENT_MAP="):
            out.append(new_map_line); saw_map = True
        else:
            out.append(line)
    if not saw_id:  out.append(new_id_line)
    if not saw_map: out.append(new_map_line)
    with open(env_path, "w") as f:
        f.writelines(out)
    print(f"  wrote   -> {env_path}")


def recreate_haystack() -> None:
    print("\n[*] recreating haystack-chatqna (env-file changes need a fresh container)")
    cmd = [
        "docker", "compose",
        "-f", "/root/amina/haystack-stack/docker-compose.yml",
        "-f", "/root/amina/haystack-stack/docker-compose.override.yml",
        "-f", "/root/amina/haystack-stack/docker-compose.meta-channels.yml",
        "-f", "/root/amina/haystack-stack/docker-compose.nllb.yml",
        "-f", "/root/amina/haystack-stack/docker-compose.gateway.yml",
        "--project-directory", "/root/amina/haystack-stack",
        "up", "-d", "--no-deps", "--force-recreate", "haystack-chatqna",
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    print(r.stdout[-500:])
    if r.returncode != 0:
        print(r.stderr[-500:])
        raise RuntimeError("docker compose up failed")
    # Wait healthy
    for i in range(40):
        time.sleep(3)
        h = subprocess.run(
            ["docker", "inspect", "haystack-chatqna",
             "--format", "{{.State.Health.Status}}"],
            capture_output=True, text=True)
        s = h.stdout.strip()
        print(f"  [{(i + 1) * 3}s] status={s}")
        if s == "healthy":
            return
    raise RuntimeError("haystack-chatqna did not become healthy within 120s")


def verify_health(api_base: str, hdrs: Dict[str, str]) -> Dict[str, Any]:
    """Hit /api/v1/dhis2/health and print + return the report."""
    r = requests.get(f"{api_base}/api/v1/dhis2/health?force=true",
                     headers=hdrs, timeout=20)
    r.raise_for_status()
    rep = r.json()
    print()
    print(f"DHIS2 health probe -> {rep['overall'].upper()}")
    for p in rep.get("probes", []):
        marker = {"ok": "  OK ", "warn": "WARN ", "fail": "FAIL ", "skipped": "SKIP "}.get(p["status"], "  ?  ")
        print(f"  [{marker}] {p['name']:<24} {p['detail'][:100]}")
    return rep


# ── Main ────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--suggest",  action="store_true",
                      help="(default) suggest map for currently-configured dataset")
    mode.add_argument("--scan-all", action="store_true",
                      help="scan ALL datasets, rank, propose for the winner")
    mode.add_argument("--apply",    action="store_true",
                      help="suggest + write to .env + recreate haystack + verify")
    ap.add_argument("--dataset",   default=None,
                    help="pin a dataset id (skips --scan-all)")
    ap.add_argument("--api-base",  default="http://localhost:8000")
    ap.add_argument("--admin-user", default="admin")
    ap.add_argument("--admin-pass", default="amina2026")
    ap.add_argument("--env-file",  default="/root/amina/haystack-stack/.env")
    ap.add_argument("--no-recreate", action="store_true",
                    help="--apply: skip the docker compose up step")
    ap.add_argument("--no-confirm",  action="store_true",
                    help="--apply: don't prompt before writing")
    args = ap.parse_args()

    if not (args.suggest or args.scan_all or args.apply):
        args.suggest = True

    api_base = args.api_base.rstrip("/")
    print(f"DHIS2 remap helper")
    print(f"  api      : {api_base}")
    print(f"  env-file : {args.env_file}")
    print(f"  mode     : "
          f"{'apply' if args.apply else ('scan-all' if args.scan_all else 'suggest')}")

    try:
        tok = _admin_token(api_base, args.admin_user, args.admin_pass)
    except Exception as e:
        print(f"[fail] admin login: {e}")
        return 3
    hdrs = _hdrs(tok)

    # Pick the dataset to score against.
    if args.dataset:
        ds_id = args.dataset
        ds_name = ""
    elif args.scan_all or args.apply:
        ds_id = scan_all(api_base, hdrs)
        if not ds_id:
            return 3
        ds_name = ""
    else:  # --suggest default
        ds_id = _current_dataset_id(api_base, hdrs)
        if not ds_id:
            print("[fail] /mapping/current returned empty dataset_id; "
                  "set DHIS2_DATASET_ID first or use --scan-all.")
            return 3
        ds_name = "(currently configured)"

    score, matches, all_elems = score_dataset(api_base, hdrs, ds_id)
    if not all_elems:
        print(f"[fail] dataset {ds_id} has no elements (deleted? no permission?)")
        return 3

    new_map, placeholders = build_map(matches, all_elems)
    print_proposal(ds_id, ds_name, matches, new_map, placeholders, all_elems)

    if args.apply:
        write_env(args.env_file, ds_id, new_map, confirm=not args.no_confirm)
        if not args.no_recreate:
            recreate_haystack()
            # Re-mint a token (recreate may have rotated state)
            tok = _admin_token(api_base, args.admin_user, args.admin_pass)
            hdrs = _hdrs(tok)
        rep = verify_health(api_base, hdrs)
        if rep["overall"] == "ok":     return 0
        if rep["overall"] == "warn":   return 1
        if rep["overall"] == "fail":   return 2
        if rep["overall"] == "skipped":return 0
    else:
        print("Run with --apply to write this map and recreate haystack.")
        print("(--apply prompts for confirmation unless --no-confirm is passed.)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
