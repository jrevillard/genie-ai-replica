"""
AMINA Care — DHIS2 History + Live Discovery
==============================================
Everything the admin UI needs *beyond* today's numbers.

Surfaces
--------
  * aggregate push history — rows from DHIS2AuditVertex, filterable by date
    range + success flag
  * patient-level tracker push history — rows from TrackerPushAuditVertex
    (already exposed via /dhis2/tracker/audit; re-exported here for a
    unified history view)
  * live DHIS2 schema discovery — queries the configured DHIS2 instance
    directly (not ArcadeDB) for datasets, data elements, and org units.
    Returns enough structure for the admin to pick the right UIDs when
    our env map drifts out of sync.

Why a separate module
---------------------
dhis2_sync.py owns aggregate push; dhis2_tracker.py owns patient-level.
Neither currently exposes a "query the audit vertex" function — they
write to it but never read it back. This module reads both + adds a
thin DHIS2-live-discovery helper. Pure additive, no edits to the
existing two services.

ArcadeDB read strategy
----------------------
We use the same `command_sql` helper all other services use. Filters are
parameterised so callers can safely pass `since` / `until` ISO timestamps
without opening a SQL-injection hole. ArcadeDB lexicographic ordering on
ISO-8601 strings == chronological ordering, so `ORDER BY logged_at DESC`
works.

Live discovery
--------------
DHIS2 auth comes from the same settings (base_url + basic auth or token)
that dhis2_sync.py uses. We timeout at 20s so a slow DHIS2 instance can't
wedge the admin UI. Responses are trimmed to the fields the UI needs.
"""

from __future__ import annotations

import base64
import logging
import os
from typing import Any, Dict, List, Optional

import requests

from src.config import settings
from src.utils.arcade_client import command_sql

logger = logging.getLogger(__name__)

DHIS2_HTTP_TIMEOUT = float(os.getenv("DHIS2_HTTP_TIMEOUT", "20"))


# ── DHIS2 auth helper (mirrors dhis2_sync.push_to_dhis2) ────────────────────

def _dhis2_http_session() -> requests.Session:
    """Return a requests.Session configured with the project's DHIS2 auth."""
    s = requests.Session()
    token = getattr(settings, "DHIS2_API_TOKEN", "") or ""
    if token:
        s.headers["Authorization"] = f"ApiToken {token}"
        return s
    user = getattr(settings, "DHIS2_USERNAME", "") or ""
    pw   = getattr(settings, "DHIS2_PASSWORD", "") or ""
    if user:
        s.auth = (user, pw)
    return s


def _dhis2_base() -> str:
    return (getattr(settings, "DHIS2_BASE_URL", "") or "").rstrip("/")


# ── Aggregate push history ─────────────────────────────────────────────────

def list_aggregate_history(
    *,
    limit: int = 50,
    since: Optional[str] = None,
    until: Optional[str] = None,
    success: Optional[bool] = None,
    period: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Return up to `limit` rows from DHIS2AuditVertex, newest first. Every
    parameter is optional. All filters are AND-ed.

    Output: {total: int (of filtered matches), filter: {...}, entries: [...]}.
    """
    limit = max(1, min(int(limit or 50), 500))
    clauses = []
    params: Dict[str, Any] = {}
    if since:
        clauses.append("logged_at >= :since")
        params["since"] = since
    if until:
        clauses.append("logged_at <= :until")
        params["until"] = until
    if success is not None:
        clauses.append("success = :s")
        params["s"] = bool(success)
    if period:
        clauses.append("period = :p")
        params["p"] = period

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

    total = 0
    try:
        # Count (cheap even without an index for MVP-sized audit tables)
        resp = command_sql(
            f"SELECT count(*) AS n FROM DHIS2AuditVertex {where}",
            params or None,
        )
        total = int(((resp or {}).get("result") or [{}])[0].get("n", 0) or 0)
    except Exception as e:
        logger.warning(f"dhis2_history: count failed ({e})")

    rows: List[Dict[str, Any]] = []
    try:
        resp = command_sql(
            "SELECT audit_id, logged_at, period, push_action, success, "
            "value_count, totals, dhis2_response, warnings, triggered_by "
            f"FROM DHIS2AuditVertex {where} "
            f"ORDER BY logged_at DESC LIMIT {limit}",
            params or None,
        )
        rows = (resp or {}).get("result", []) or []
    except Exception as e:
        logger.error(f"dhis2_history: list failed: {e}")

    return {
        "total":   total,
        "filter":  {"since": since, "until": until,
                    "success": success, "period": period},
        "entries": [_clean_audit_row(r) for r in rows],
    }


def _clean_audit_row(r: Dict[str, Any]) -> Dict[str, Any]:
    # ArcadeDB returns nested JSON as strings sometimes; try to decode.
    import json as _json
    def _maybe_json(v: Any) -> Any:
        if isinstance(v, (dict, list)):
            return v
        if isinstance(v, str) and v.strip().startswith(("{", "[")):
            try:
                return _json.loads(v)
            except Exception:
                return v
        return v

    return {
        "audit_id":       r.get("audit_id", ""),
        "logged_at":      r.get("logged_at", ""),
        "period":         r.get("period", ""),
        "push_action":    r.get("push_action", ""),
        "success":        bool(r.get("success")),
        "value_count":    int(r.get("value_count") or 0),
        "totals":         _maybe_json(r.get("totals") or {}),
        "dhis2_response": _maybe_json(r.get("dhis2_response") or {}),
        "warnings":       _maybe_json(r.get("warnings") or []),
        "triggered_by":   r.get("triggered_by", ""),
    }


# ── Tracker push history (thin wrapper over TrackerPushAuditVertex) ────────

def list_tracker_history(
    *,
    limit: int = 50,
    since: Optional[str] = None,
    until: Optional[str] = None,
    success: Optional[bool] = None,
    patient_id: Optional[str] = None,
) -> Dict[str, Any]:
    limit = max(1, min(int(limit or 50), 500))
    clauses = []
    params: Dict[str, Any] = {}
    if since:
        clauses.append("logged_at >= :since"); params["since"] = since
    if until:
        clauses.append("logged_at <= :until"); params["until"] = until
    if success is not None:
        clauses.append("success = :s");       params["s"] = bool(success)
    if patient_id:
        clauses.append("patient_id = :pid");  params["pid"] = patient_id
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

    total = 0
    try:
        resp = command_sql(
            f"SELECT count(*) AS n FROM TrackerPushAuditVertex {where}",
            params or None,
        )
        total = int(((resp or {}).get("result") or [{}])[0].get("n", 0) or 0)
    except Exception:
        pass

    rows: List[Dict[str, Any]] = []
    try:
        resp = command_sql(
            "SELECT audit_id, logged_at, patient_id, tei_uid, enrollment_uid, "
            "events_count, success, dry_run, forced, triggered_by, "
            "error_message, consent_version "
            f"FROM TrackerPushAuditVertex {where} "
            f"ORDER BY logged_at DESC LIMIT {limit}",
            params or None,
        )
        rows = (resp or {}).get("result", []) or []
    except Exception as e:
        logger.error(f"dhis2_history: tracker list failed: {e}")

    return {
        "total":   total,
        "filter":  {"since": since, "until": until,
                    "success": success, "patient_id": patient_id},
        "entries": rows,
    }


# ── Live DHIS2 discovery ───────────────────────────────────────────────────

def discover_datasets(page_size: int = 50) -> Dict[str, Any]:
    """List datasets visible to the configured DHIS2 account."""
    base = _dhis2_base()
    if not base:
        return {"error": "DHIS2_BASE_URL not set", "datasets": []}

    try:
        r = _dhis2_http_session().get(
            f"{base}/api/dataSets.json"
            f"?fields=id,name,code,periodType&pageSize={int(page_size)}",
            timeout=DHIS2_HTTP_TIMEOUT,
        )
    except requests.RequestException as e:
        return {"error": f"{type(e).__name__}: {e}", "datasets": []}

    if r.status_code != 200:
        return {"error": f"HTTP {r.status_code}: {r.text[:200]}",
                "datasets": []}

    body = r.json() or {}
    return {
        "dataset_count":    (body.get("pager") or {}).get("total", 0),
        "datasets":         [
            {"id":          d.get("id"),
             "name":        d.get("name"),
             "code":        d.get("code"),
             "period_type": d.get("periodType")}
            for d in (body.get("dataSets") or [])
        ],
        "current_dataset_id": getattr(settings, "DHIS2_DATASET_ID", "") or "",
        "base_url":          base,
    }


def describe_dataset(dataset_id: str) -> Dict[str, Any]:
    """Full dataset detail: data elements + assigned org units."""
    base = _dhis2_base()
    if not base:
        return {"error": "DHIS2_BASE_URL not set"}
    if not dataset_id:
        return {"error": "dataset_id required"}

    try:
        r = _dhis2_http_session().get(
            f"{base}/api/dataSets/{dataset_id}.json"
            "?fields=id,name,code,periodType,"
            "dataSetElements[dataElement[id,name,code,valueType]],"
            "organisationUnits[id,name,code,path]",
            timeout=DHIS2_HTTP_TIMEOUT,
        )
    except requests.RequestException as e:
        return {"error": f"{type(e).__name__}: {e}"}

    if r.status_code != 200:
        return {"error": f"HTTP {r.status_code}: {r.text[:200]}"}
    d = r.json() or {}

    elements = [
        {"id":         e.get("id"),
         "name":       e.get("name"),
         "code":       e.get("code"),
         "value_type": e.get("valueType")}
        for de in (d.get("dataSetElements") or [])
        for e  in [de.get("dataElement") or {}]
    ]
    ous = [
        {"id":   ou.get("id"),
         "name": ou.get("name"),
         "code": ou.get("code"),
         "path": ou.get("path")}
        for ou in (d.get("organisationUnits") or [])
    ]
    return {
        "id":           d.get("id"),
        "name":         d.get("name"),
        "code":         d.get("code"),
        "period_type":  d.get("periodType"),
        "data_elements": elements,
        "org_units":    ous,
        "base_url":     base,
    }


def discover_orgunit_children(parent_id: str, page_size: int = 50) -> Dict[str, Any]:
    """List immediate children of an org unit. Useful when a dataset is
    assigned to a parent and we want to push at the facility level."""
    base = _dhis2_base()
    if not base or not parent_id:
        return {"error": "missing params", "org_units": []}
    try:
        r = _dhis2_http_session().get(
            f"{base}/api/organisationUnits.json"
            f"?filter=parent.id:eq:{parent_id}"
            f"&fields=id,name,code,path&pageSize={int(page_size)}",
            timeout=DHIS2_HTTP_TIMEOUT,
        )
    except requests.RequestException as e:
        return {"error": f"{type(e).__name__}: {e}", "org_units": []}
    if r.status_code != 200:
        return {"error": f"HTTP {r.status_code}", "org_units": []}

    body = r.json() or {}
    return {
        "parent":    parent_id,
        "org_units": [
            {"id": x.get("id"), "name": x.get("name"),
             "code": x.get("code"), "path": x.get("path")}
            for x in (body.get("organisationUnits") or [])
        ],
    }


def current_mapping() -> Dict[str, Any]:
    """The mapping currently in force (env-derived). Useful for the UI
    to show the admin what's wired right now so they can compare against
    the live discovery."""
    import json as _json
    def _decode(s: str) -> Any:
        s = (s or "").strip()
        if not s:
            return {}
        try:
            return _json.loads(s)
        except Exception:
            return {"_raw": s}

    return {
        "base_url":         _dhis2_base(),
        "dataset_id":       getattr(settings, "DHIS2_DATASET_ID", "") or "",
        "data_element_map": _decode(getattr(settings, "DHIS2_DATA_ELEMENT_MAP", "") or ""),
        "orgunit_map":      _decode(getattr(settings, "DHIS2_ORG_UNIT_MAP", "") or ""),
        "tracker_enabled":  (getattr(settings, "DHIS2_TRACKER_ENABLED", "") or "").lower() == "true",
        "tracker_program_id":       getattr(settings, "DHIS2_TRACKER_PROGRAM_ID", "") or "",
        "tracker_program_stage_id": getattr(settings, "DHIS2_TRACKER_PROGRAM_STAGE_ID", "") or "",
        "tracker_tei_type_id":      getattr(settings, "DHIS2_TRACKER_TEI_TYPE_ID", "") or "",
    }
