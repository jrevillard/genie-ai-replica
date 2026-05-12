"""
AMINA Care - DHIS2 Live Health Probe
=====================================
Detects "the upstream dataset disappeared" / "credentials wrong" / "element
map drift" classes of failure that previously sat silent for weeks at a time
because nothing exercised the DHIS2 path between sanity-test runs.

Four probes, all run against the LIVE DHIS2 instance configured by
`DHIS2_BASE_URL` + auth env vars. Each probe is independent; one failing
does not prevent the others from running.

  P1  base_reachable      DHIS2 base URL responds 2xx to /api/system/info
  P2  dataset_exists      Configured DHIS2_DATASET_ID is in the list of
                          datasets the service account can /discover
  P3  dataset_detail      Detail of the configured dataset returns at
                          least 1 data_element + 1 org_unit
  P4  element_map_resolves DHIS2_DATA_ELEMENT_MAP has at least 1 entry whose
                          target ID still exists in the new dataset

Result is cached for 60 seconds so that monitoring scrapes don't hammer
the DHIS2 server. The cache is in-process; restart clears it.

Use from:
  - /api/v1/admin/dhis2/health        (ad-hoc admin probe)
  - startup banner (logs CRITICAL on any P*=fail)
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any, Dict, List, Optional, Tuple

import requests

from src.config import settings
from src.services import dhis2_history

logger = logging.getLogger(__name__)


# ── Cache ────────────────────────────────────────────────────────────

_CACHE: Dict[str, Any] = {"ts": 0.0, "report": None}
_TTL_S = 60


# ── Helpers ──────────────────────────────────────────────────────────

def _dhis2_session() -> requests.Session:
    """Reuse the same session-construction logic as dhis2_history."""
    return dhis2_history._dhis2_http_session()


def _dhis2_base() -> str:
    return dhis2_history._dhis2_base()


def _is_disabled() -> bool:
    """`DHIS2_BASE_URL=disabled` (or empty) means DHIS2 is intentionally
    off for this deployment. Probes return a single skipped result."""
    base = (getattr(settings, "DHIS2_BASE_URL", "") or "").strip().lower()
    return base in ("", "disabled", "off", "none")


# ── Probes ───────────────────────────────────────────────────────────

def _probe_base_reachable() -> Dict[str, Any]:
    base = _dhis2_base()
    try:
        r = _dhis2_session().get(f"{base}/api/system/info", timeout=8)
        if r.ok:
            try:
                info = r.json()
                return {
                    "name":   "base_reachable",
                    "status": "ok",
                    "detail": f"DHIS2 {info.get('version', '?')} at {base}",
                }
            except Exception:
                return {"name": "base_reachable", "status": "ok",
                        "detail": f"DHIS2 reachable at {base}"}
        return {
            "name":   "base_reachable",
            "status": "fail",
            "detail": f"HTTP {r.status_code} from {base}/api/system/info",
        }
    except Exception as e:
        return {
            "name":   "base_reachable",
            "status": "fail",
            "detail": f"{type(e).__name__}: {e}",
        }


def _probe_dataset_exists() -> Dict[str, Any]:
    """Configured DHIS2_DATASET_ID must appear in /discover output."""
    configured = (getattr(settings, "DHIS2_DATASET_ID", "") or "").strip()
    if not configured:
        return {"name": "dataset_exists", "status": "fail",
                "detail": "DHIS2_DATASET_ID env var is empty"}
    try:
        disc = dhis2_history.discover_datasets(page_size=200)
    except Exception as e:
        return {"name": "dataset_exists", "status": "fail",
                "detail": f"discover failed: {type(e).__name__}: {e}"}

    datasets = disc.get("datasets") or disc.get("data_sets") or []
    ids = {d.get("id") or d.get("dataset_id") for d in datasets}
    if configured in ids:
        return {"name": "dataset_exists", "status": "ok",
                "detail": f"{configured} found in {len(ids)} discovered datasets"}
    return {
        "name":   "dataset_exists",
        "status": "fail",
        "detail": (
            f"{configured} NOT in {len(ids)} datasets the service account can see. "
            "Either the dataset was deleted/renamed upstream, or service-account "
            "permissions were changed. See ENCRYPTION_AND_SECURITY_HARDENING.md "
            "section 'DHIS2 recovery runbook'."
        ),
    }


def _probe_dataset_detail() -> Dict[str, Any]:
    configured = (getattr(settings, "DHIS2_DATASET_ID", "") or "").strip()
    if not configured:
        return {"name": "dataset_detail", "status": "fail",
                "detail": "DHIS2_DATASET_ID empty"}
    try:
        d = dhis2_history.describe_dataset(configured)
    except Exception as e:
        return {"name": "dataset_detail", "status": "fail",
                "detail": f"describe failed: {type(e).__name__}: {e}"}

    elems = d.get("data_elements") or []
    ous   = d.get("org_units") or []
    err   = d.get("error") or d.get("detail")

    if err:
        return {"name": "dataset_detail", "status": "fail",
                "detail": f"DHIS2 returned error: {str(err)[:160]}"}
    if not elems:
        return {"name": "dataset_detail", "status": "warn",
                "detail": f"dataset {configured} has 0 data elements"}
    if not ous:
        return {"name": "dataset_detail", "status": "warn",
                "detail": f"dataset {configured} has 0 org units"}

    return {
        "name":   "dataset_detail",
        "status": "ok",
        "detail": f"{len(elems)} elements, {len(ous)} org units",
    }


def _probe_element_map_resolves() -> Dict[str, Any]:
    """At least 1 entry in DHIS2_DATA_ELEMENT_MAP must resolve in the
    current dataset. 0/N is a strong signal the operator switched
    datasets but forgot to redo the mapping."""
    raw = (getattr(settings, "DHIS2_DATA_ELEMENT_MAP", "") or "").strip()
    if not raw:
        return {"name": "element_map_resolves", "status": "warn",
                "detail": "DHIS2_DATA_ELEMENT_MAP env var is empty"}
    try:
        emap = json.loads(raw)
    except Exception as e:
        return {"name": "element_map_resolves", "status": "fail",
                "detail": f"DHIS2_DATA_ELEMENT_MAP is not valid JSON: {e}"}

    target_ids = list(emap.values()) if isinstance(emap, dict) else []
    if not target_ids:
        return {"name": "element_map_resolves", "status": "warn",
                "detail": "element map decoded but is empty"}

    configured = (getattr(settings, "DHIS2_DATASET_ID", "") or "").strip()
    try:
        d = dhis2_history.describe_dataset(configured)
        new_ids = {e.get("id") for e in (d.get("data_elements") or []) if e.get("id")}
    except Exception as e:
        return {"name": "element_map_resolves", "status": "fail",
                "detail": f"could not list new dataset elements: {e}"}

    hit = sum(1 for x in target_ids if x in new_ids)
    if hit == 0:
        return {
            "name":   "element_map_resolves",
            "status": "fail",
            "detail": (
                f"0/{len(target_ids)} mapped element IDs resolve in dataset "
                f"{configured}. Sync will be a no-op until the map is "
                "updated. Use /admin/dhis2/health → discover endpoint to "
                "find the new IDs."
            ),
        }
    if hit < len(target_ids):
        return {
            "name":   "element_map_resolves",
            "status": "warn",
            "detail": f"{hit}/{len(target_ids)} mapped IDs resolve; "
                      f"{len(target_ids) - hit} stale entries need re-mapping",
        }
    return {
        "name":   "element_map_resolves",
        "status": "ok",
        "detail": f"all {len(target_ids)} mapped IDs resolve",
    }


# ── Composer ─────────────────────────────────────────────────────────

def get_health(*, force_refresh: bool = False) -> Dict[str, Any]:
    """Run all probes (or return cached) and aggregate."""
    now = time.time()
    if not force_refresh and _CACHE["report"] and (now - _CACHE["ts"] < _TTL_S):
        cached = dict(_CACHE["report"])
        cached["cached"] = True
        cached["age_s"]  = round(now - _CACHE["ts"], 1)
        return cached

    if _is_disabled():
        report = {
            "overall":        "skipped",
            "configured":     False,
            "base_url":       _dhis2_base(),
            "dataset_id":     getattr(settings, "DHIS2_DATASET_ID", "") or "",
            "probes":         [],
            "reason":         "DHIS2_BASE_URL is empty/disabled — sync is intentionally off",
            "cached":         False,
        }
        _CACHE["ts"]     = now
        _CACHE["report"] = report
        return report

    probes: List[Dict[str, Any]] = []
    probes.append(_probe_base_reachable())

    # If P1 fails, the others would just blow up with the same connection error.
    # Run them anyway but mark dependent ones as skipped.
    base_ok = probes[0]["status"] == "ok"
    if base_ok:
        probes.append(_probe_dataset_exists())
        probes.append(_probe_dataset_detail())
        probes.append(_probe_element_map_resolves())
    else:
        for name in ("dataset_exists", "dataset_detail", "element_map_resolves"):
            probes.append({
                "name":   name,
                "status": "skipped",
                "detail": "skipped — base_reachable failed",
            })

    statuses = {p["status"] for p in probes}
    if "fail" in statuses:
        overall = "fail"
    elif "warn" in statuses:
        overall = "warn"
    else:
        overall = "ok"

    report = {
        "overall":    overall,
        "configured": True,
        "base_url":   _dhis2_base(),
        "dataset_id": (getattr(settings, "DHIS2_DATASET_ID", "") or "").strip(),
        "probes":     probes,
        "ttl_s":      _TTL_S,
        "cached":     False,
    }
    _CACHE["ts"]     = now
    _CACHE["report"] = report

    if overall == "fail":
        logger.critical(
            "dhis2_health: OVERALL=FAIL. Probe details: %s",
            json.dumps([{"name": p["name"], "status": p["status"], "detail": p["detail"]}
                        for p in probes]),
        )
    elif overall == "warn":
        logger.warning(
            "dhis2_health: OVERALL=WARN. Probes: %s",
            ", ".join(f"{p['name']}={p['status']}" for p in probes),
        )
    else:
        logger.info("dhis2_health: OVERALL=OK")

    return report
