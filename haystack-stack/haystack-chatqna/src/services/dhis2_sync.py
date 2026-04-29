"""
DHIS2 Aggregate Sync Service
============================
Pushes daily aggregate health metrics from AMINA Care to a DHIS2 instance
via the DHIS2 Web API (/api/dataValueSets).

Scope — Phase 1 (aggregate only):
  - No patient-level data leaves AMINA
  - Only counts / totals by region + period
  - Manual trigger by admin, or scheduled daily push

Metrics pushed (per region, per day):
  AMINA_CONS_TOTAL      — total AMINA consultations
  AMINA_CONS_EMERGENCY  — consultations flagged EMERGENCY triage
  AMINA_CONS_URGENT     — consultations flagged URGENT triage
  AMINA_CONS_ROUTINE    — consultations flagged ROUTINE triage
  AMINA_NCD_HTN         — hypertension-related consultations
  AMINA_NCD_DM          — diabetes-related consultations
  AMINA_NCD_ASTHMA      — asthma / COPD consultations
  AMINA_MCH             — maternal & child health consultations
  AMINA_MENTAL_HEALTH   — mental health consultations
  AMINA_CG_ALERTS       — caregiver alerts triggered
  AMINA_SAFETY_BLOCKS   — pre-LLM safety-gate refusals

Each metric maps to a DHIS2 dataElement ID configured in env / config.
Each AMINA region maps to a DHIS2 orgUnit ID.

Reference:
  https://docs.dhis2.org/en/develop/using-the-api/dhis-core-version-240/data.html#webapi_sending_aggregate_data_values
"""

from __future__ import annotations

import json
import logging
import re
import time
from datetime import datetime, timedelta, date
from typing import Dict, List, Optional, Tuple

import requests

from src.config import settings
from src.utils.arcade_client import command_sql

logger = logging.getLogger(__name__)


# ── Prometheus metrics (no-op if prometheus_client missing) ──────────────────

try:
    from prometheus_client import Counter, Gauge, Histogram
    _METRIC_PUSH_TOTAL = Counter(
        "amina_dhis2_push_total",
        "Total DHIS2 push attempts",
        ["status"],  # ok | failed
    )
    _METRIC_VALUES_PUSHED = Counter(
        "amina_dhis2_values_pushed_total",
        "Total individual data values pushed to DHIS2",
    )
    _METRIC_LAST_SYNC_AGE = Gauge(
        "amina_dhis2_last_sync_age_seconds",
        "Seconds since last successful DHIS2 sync",
    )
    _METRIC_PUSH_DURATION = Histogram(
        "amina_dhis2_push_duration_seconds",
        "DHIS2 push request duration",
    )
    _PROM_OK = True
except Exception:
    _PROM_OK = False
    _METRIC_PUSH_TOTAL = _METRIC_VALUES_PUSHED = None
    _METRIC_LAST_SYNC_AGE = _METRIC_PUSH_DURATION = None


# ── Metric keys ──────────────────────────────────────────────────────────────

METRIC_KEYS = [
    "AMINA_CONS_TOTAL",
    "AMINA_CONS_EMERGENCY",
    "AMINA_CONS_URGENT",
    "AMINA_CONS_ROUTINE",
    "AMINA_NCD_HTN",
    "AMINA_NCD_DM",
    "AMINA_NCD_ASTHMA",
    "AMINA_MCH",
    "AMINA_MENTAL_HEALTH",
    "AMINA_CG_ALERTS",
    "AMINA_SAFETY_BLOCKS",
]


# ── Diagnosis / symptom pattern matchers ─────────────────────────────────────

_HTN_PAT   = re.compile(r"\b(hypertension|high\s*blood\s*pressure|htn|bp\b|blood\s*pressure)", re.I)
_DM_PAT    = re.compile(r"\b(diabetes|diabetic|t2dm|t1dm|sugar\s*level|glucose|hyperglycem)", re.I)
_RESP_PAT  = re.compile(r"\b(asthma|copd|wheez|shortness\s*of\s*breath|inhaler|bronch)", re.I)
_MCH_PAT   = re.compile(r"\b(pregnan|antenatal|postnatal|maternal|newborn|infant|child\s*vaccin|immuniz|breastfeed)", re.I)
_MH_PAT    = re.compile(r"\b(depress|anxiety|stress|panic|suicid|mental\s*health|insomnia|grief)", re.I)


def _match_any(text: str, patterns: List[re.Pattern]) -> bool:
    if not text:
        return False
    return any(p.search(text) for p in patterns)


# ── Region → orgUnit mapping ─────────────────────────────────────────────────

def _load_orgunit_map() -> Dict[str, str]:
    """Load AMINA region → DHIS2 orgUnit ID mapping from env JSON."""
    raw = getattr(settings, "DHIS2_ORG_UNIT_MAP", "") or ""
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception as e:
        logger.warning(f"DHIS2_ORG_UNIT_MAP is not valid JSON: {e}")
        return {}


def _load_dataelement_map() -> Dict[str, str]:
    """Load AMINA metric key → DHIS2 dataElement ID mapping from env JSON."""
    raw = getattr(settings, "DHIS2_DATA_ELEMENT_MAP", "") or ""
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception as e:
        logger.warning(f"DHIS2_DATA_ELEMENT_MAP is not valid JSON: {e}")
        return {}


# ── Date helpers ─────────────────────────────────────────────────────────────

def _day_bounds(day: date) -> Tuple[str, str]:
    """Return (start_iso, end_iso) for a given UTC day."""
    start = datetime(day.year, day.month, day.day)
    end   = start + timedelta(days=1)
    return start.isoformat(), end.isoformat()


def _dhis2_period(day: date) -> str:
    """DHIS2 daily period format: YYYYMMDD"""
    return day.strftime("%Y%m%d")


# ── Metric collection from ArcadeDB ──────────────────────────────────────────

def collect_daily_metrics(day: date) -> Dict[str, Dict[str, int]]:
    """
    Collect a dict of { region: { metric_key: count } } for a given UTC day.

    Queries ArcadeDB ConsultationRecord joined with PatientVertex to get region.
    """
    start_iso, end_iso = _day_bounds(day)

    # ArcadeDB SQL doesn't support multi-table FROM joins — use two queries + dict merge
    # NOTE: `end` is a reserved word in ArcadeDB SQL; use :end_at instead
    try:
        resp = command_sql(
            "SELECT id, patient_id, triage_level, symptoms_reported, summary "
            "FROM ConsultationRecord WHERE started_at >= :start_at AND started_at < :end_at",
            {"start_at": start_iso, "end_at": end_iso},
        )
        rows = resp.get("result", []) if isinstance(resp, dict) else []
    except Exception as e:
        logger.error(f"dhis2_sync: consultation query failed: {e}")
        rows = []

    # Resolve region for each distinct patient_id
    pids = list({r.get("patient_id") for r in rows if r.get("patient_id")})
    region_cache: Dict[str, str] = {}
    for pid in pids:
        try:
            presp = command_sql(
                "SELECT region FROM PatientVertex WHERE id = :pid LIMIT 1",
                {"pid": pid},
            )
            prows = (presp or {}).get("result", [])
            if prows and prows[0].get("region"):
                region_cache[pid] = str(prows[0]["region"]).lower()
        except Exception as e:
            logger.debug(f"dhis2_sync: region lookup failed for {pid}: {e}")
    for r in rows:
        r["region"] = region_cache.get(r.get("patient_id", ""), "unknown")

    # Aggregate by region
    by_region: Dict[str, Dict[str, int]] = {}

    def _bump(region: str, key: str) -> None:
        if not region:
            region = "UNKNOWN"
        bucket = by_region.setdefault(region.lower(), {k: 0 for k in METRIC_KEYS})
        bucket[key] += 1

    for r in rows:
        region = (r.get("region") or "").strip().lower() or "unknown"
        triage = (r.get("triage_level") or "").strip().upper()
        symptoms = r.get("symptoms_reported") or r.get("symptoms") or ""
        summary  = r.get("summary") or ""
        haystack = f"{symptoms} {summary}"

        _bump(region, "AMINA_CONS_TOTAL")

        if triage == "EMERGENCY":
            _bump(region, "AMINA_CONS_EMERGENCY")
        elif triage == "URGENT":
            _bump(region, "AMINA_CONS_URGENT")
        elif triage == "ROUTINE":
            _bump(region, "AMINA_CONS_ROUTINE")

        if _HTN_PAT.search(haystack):
            _bump(region, "AMINA_NCD_HTN")
        if _DM_PAT.search(haystack):
            _bump(region, "AMINA_NCD_DM")
        if _RESP_PAT.search(haystack):
            _bump(region, "AMINA_NCD_ASTHMA")
        if _MCH_PAT.search(haystack):
            _bump(region, "AMINA_MCH")
        if _MH_PAT.search(haystack):
            _bump(region, "AMINA_MENTAL_HEALTH")

    # Caregiver alerts + safety blocks come from Redis counters (daily bucket)
    _merge_redis_counters(by_region, day)

    return by_region


def _merge_redis_counters(by_region: Dict[str, Dict[str, int]], day: date) -> None:
    """Fold Redis-backed daily counters into the aggregation.

    Expected key layout (set by caregiver_alerts + safety_gate):
      dhis2:daily:{YYYYMMDD}:{region}:AMINA_CG_ALERTS
      dhis2:daily:{YYYYMMDD}:{region}:AMINA_SAFETY_BLOCKS
    """
    try:
        import redis as _redis
        r = _redis.Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            decode_responses=True,
        )
    except Exception as e:
        logger.warning(f"dhis2_sync: Redis unavailable, skipping counter merge: {e}")
        return

    period = _dhis2_period(day)
    pattern = f"dhis2:daily:{period}:*"
    try:
        keys = list(r.scan_iter(pattern, count=500))
    except Exception as e:
        logger.warning(f"dhis2_sync: Redis scan failed: {e}")
        return

    for k in keys:
        # dhis2:daily:{period}:{region}:{metric}
        parts = k.split(":")
        if len(parts) != 5:
            continue
        region = parts[3].lower()
        metric = parts[4]
        if metric not in METRIC_KEYS:
            continue
        try:
            val = int(r.get(k) or 0)
        except Exception:
            continue
        if val <= 0:
            continue
        bucket = by_region.setdefault(region, {k2: 0 for k2 in METRIC_KEYS})
        bucket[metric] += val


# ── DHIS2 push ───────────────────────────────────────────────────────────────

def build_payload(
    day: date,
    metrics: Dict[str, Dict[str, int]],
    orgunit_map: Dict[str, str],
    dataelement_map: Dict[str, str],
) -> Tuple[Dict, List[str]]:
    """
    Build a DHIS2 dataValueSet payload from aggregated metrics.

    Returns (payload, warnings) where warnings is a list of skipped entries.
    """
    period = _dhis2_period(day)
    values: List[Dict] = []
    warnings: List[str] = []

    for region, bucket in metrics.items():
        ou_id = orgunit_map.get(region)
        if not ou_id:
            warnings.append(f"no DHIS2 orgUnit for region '{region}'")
            continue
        for metric_key, count in bucket.items():
            if count <= 0:
                continue
            de_id = dataelement_map.get(metric_key)
            if not de_id:
                warnings.append(f"no DHIS2 dataElement for metric '{metric_key}'")
                continue
            values.append({
                "dataElement": de_id,
                "period":      period,
                "orgUnit":     ou_id,
                "value":       str(count),
            })

    payload = {
        "dataSet":   getattr(settings, "DHIS2_DATASET_ID", "") or None,
        "period":    period,
        "dataValues": values,
    }
    # Remove dataSet if not set (DHIS2 accepts payloads without it)
    if not payload["dataSet"]:
        payload.pop("dataSet", None)

    return payload, warnings


def push_to_dhis2(payload: Dict) -> Tuple[bool, Dict]:
    """POST a dataValueSet to the configured DHIS2 instance.
    Observed by Prometheus counters + duration histogram."""
    base_url = (getattr(settings, "DHIS2_BASE_URL", "") or "").rstrip("/")
    if not base_url:
        return False, {"error": "DHIS2_BASE_URL not configured"}

    username = getattr(settings, "DHIS2_USERNAME", "") or ""
    password = getattr(settings, "DHIS2_PASSWORD", "") or ""
    token    = getattr(settings, "DHIS2_API_TOKEN", "") or ""

    url = f"{base_url}/api/dataValueSets"
    headers = {"Content-Type": "application/json"}
    auth = None

    if token:
        headers["Authorization"] = f"ApiToken {token}"
    elif username and password:
        auth = (username, password)
    else:
        return False, {"error": "No DHIS2 credentials configured (DHIS2_USERNAME/PASSWORD or DHIS2_API_TOKEN)"}

    t0 = time.monotonic()
    try:
        resp = requests.post(url, headers=headers, auth=auth, json=payload, timeout=30)
    except requests.RequestException as e:
        logger.error(f"dhis2_sync: POST failed: {e}")
        if _PROM_OK:
            _METRIC_PUSH_TOTAL.labels(status="failed").inc()
        return False, {"error": str(e)}
    finally:
        if _PROM_OK:
            _METRIC_PUSH_DURATION.observe(time.monotonic() - t0)

    ok = 200 <= resp.status_code < 300
    try:
        body = resp.json()
    except Exception:
        body = {"status": resp.status_code, "text": resp.text[:500]}

    if _PROM_OK:
        _METRIC_PUSH_TOTAL.labels(status="ok" if ok else "failed").inc()
        if ok:
            _METRIC_VALUES_PUSHED.inc(len(payload.get("dataValues", [])))

    if not ok:
        logger.error(f"dhis2_sync: DHIS2 rejected push ({resp.status_code}): {body}")
    return ok, body


# ── Retry queue (Redis-backed, exponential backoff) ─────────────────────────

_RETRY_MAX_ATTEMPTS = 5
_RETRY_BASE_DELAY_SEC = 300  # 5min, 10min, 20min, 40min, 80min


def _retry_key(period: str) -> str:
    return f"dhis2:retry:{period}"


def _enqueue_retry(payload: Dict, period: str, attempt: int = 0) -> None:
    """Store a failed push in Redis for later retry."""
    try:
        import redis as _redis
        r = _redis.Redis(host=settings.REDIS_HOST, port=settings.REDIS_PORT, decode_responses=True)
        next_try_in = _RETRY_BASE_DELAY_SEC * (2 ** attempt)
        record = {
            "payload":  payload,
            "attempt":  attempt,
            "next_try_at": (datetime.utcnow() + timedelta(seconds=next_try_in)).isoformat() + "Z",
            "period":   period,
        }
        r.setex(_retry_key(period), 48 * 3600, json.dumps(record))
        logger.info(f"dhis2_sync: enqueued retry for {period} attempt={attempt} next_in={next_try_in}s")
    except Exception as e:
        logger.warning(f"dhis2_sync: failed to enqueue retry: {e}")


def run_pending_retries() -> Dict:
    """Scan Redis for pending retry records whose next_try_at has passed, push them.

    Designed to be called periodically (every 5 min) by APScheduler.
    """
    try:
        import redis as _redis
        r = _redis.Redis(host=settings.REDIS_HOST, port=settings.REDIS_PORT, decode_responses=True)
    except Exception as e:
        return {"ok": False, "error": f"redis unavailable: {e}"}

    now = datetime.utcnow()
    processed = {"scanned": 0, "retried": 0, "dropped": 0, "succeeded": 0}

    for key in r.scan_iter("dhis2:retry:*", count=100):
        processed["scanned"] += 1
        raw = r.get(key)
        if not raw:
            continue
        try:
            record = json.loads(raw)
        except Exception:
            r.delete(key)
            continue

        try:
            next_try = datetime.fromisoformat(record["next_try_at"].replace("Z", ""))
        except Exception:
            next_try = now  # if malformed, try immediately
        if next_try > now:
            continue  # not yet

        attempt = int(record.get("attempt", 0))
        if attempt >= _RETRY_MAX_ATTEMPTS:
            logger.error(f"dhis2_sync: giving up on {key} after {attempt} attempts")
            r.delete(key)
            processed["dropped"] += 1
            _fire_failure_alert(f"DHIS2 push permanently failed after {attempt} retries", record)
            continue

        ok, body = push_to_dhis2(record["payload"])
        processed["retried"] += 1
        if ok:
            r.delete(key)
            processed["succeeded"] += 1
            _record_last_sync(record["period"], True, len(record["payload"].get("dataValues", [])), [])
        else:
            _enqueue_retry(record["payload"], record["period"], attempt + 1)

    return {"ok": True, **processed}


# ── Failure alerts (Slack webhook or SMTP) ──────────────────────────────────

_FAILURE_STREAK_KEY = "dhis2:failure_streak"
_FAILURE_STREAK_THRESHOLD = 3


def _bump_failure_streak() -> int:
    try:
        import redis as _redis
        r = _redis.Redis(host=settings.REDIS_HOST, port=settings.REDIS_PORT, decode_responses=True)
        n = r.incr(_FAILURE_STREAK_KEY)
        r.expire(_FAILURE_STREAK_KEY, 7 * 24 * 3600)
        return int(n)
    except Exception:
        return 0


def _reset_failure_streak() -> None:
    try:
        import redis as _redis
        r = _redis.Redis(host=settings.REDIS_HOST, port=settings.REDIS_PORT, decode_responses=True)
        r.delete(_FAILURE_STREAK_KEY)
    except Exception:
        pass


def _fire_failure_alert(message: str, context: Dict) -> None:
    """Send a failure alert via Slack webhook if configured, else log loudly."""
    webhook = getattr(settings, "DHIS2_ALERT_WEBHOOK_URL", "") or ""
    body = {
        "text": f":warning: *AMINA Care — DHIS2 sync failure*\n{message}",
        "attachments": [{
            "color": "danger",
            "fields": [
                {"title": "Period",  "value": context.get("period", "?"),  "short": True},
                {"title": "Attempt", "value": str(context.get("attempt", "?")), "short": True},
            ],
        }],
    }
    if webhook:
        try:
            requests.post(webhook, json=body, timeout=10)
            logger.info("dhis2_sync: failure alert sent to Slack webhook")
            return
        except Exception as e:
            logger.warning(f"dhis2_sync: failure alert webhook failed: {e}")
    # Fallback: log at ERROR so it shows in dashboards / stderr
    logger.error(f"[DHIS2 ALERT] {message} | context={context}")


# ── Audit log (ArcadeDB DHIS2AuditVertex) ────────────────────────────────────

def _ensure_audit_schema() -> None:
    """Create DHIS2AuditVertex if missing. Safe to call repeatedly.
    Note: ArcadeDB reserves `at`, `end`, `response` as SQL keywords — we use
    `logged_at`, `dhis2_response` instead."""
    stmts = [
        "CREATE VERTEX TYPE DHIS2AuditVertex IF NOT EXISTS",
        "CREATE PROPERTY DHIS2AuditVertex.audit_id IF NOT EXISTS STRING",
        "CREATE PROPERTY DHIS2AuditVertex.logged_at IF NOT EXISTS STRING",
        "CREATE PROPERTY DHIS2AuditVertex.period IF NOT EXISTS STRING",
        "CREATE PROPERTY DHIS2AuditVertex.push_action IF NOT EXISTS STRING",  # push|retry|giveup|dryrun
        "CREATE PROPERTY DHIS2AuditVertex.success IF NOT EXISTS BOOLEAN",
        "CREATE PROPERTY DHIS2AuditVertex.value_count IF NOT EXISTS INTEGER",
        "CREATE PROPERTY DHIS2AuditVertex.totals IF NOT EXISTS STRING",
        "CREATE PROPERTY DHIS2AuditVertex.dhis2_response IF NOT EXISTS STRING",
        "CREATE PROPERTY DHIS2AuditVertex.warnings IF NOT EXISTS STRING",
        "CREATE PROPERTY DHIS2AuditVertex.triggered_by IF NOT EXISTS STRING",
    ]
    for stmt in stmts:
        try:
            command_sql(stmt)
        except Exception as e:
            logger.debug(f"dhis2 audit schema step warning: {stmt[:60]} -> {e}")


def _audit_log(
    action: str,
    period: str,
    success: bool,
    value_count: int,
    totals: Dict[str, int],
    response: Dict,
    warnings: List[str],
    triggered_by: str = "system",
) -> None:
    """Append-only audit record in ArcadeDB. Silent on failure (audit must never break push).

    Uses `INSERT ... CONTENT {json}` rather than `SET a=:a, b=:b, ...` because
    ArcadeDB's SET clause parser breaks on certain column-name combinations.
    """
    try:
        import uuid as _uuid
        record = {
            "audit_id":       _uuid.uuid4().hex,
            "logged_at":      datetime.utcnow().isoformat() + "Z",
            "period":         period,
            "push_action":    action,
            "success":        bool(success),
            "value_count":    int(value_count),
            "totals":         json.dumps(totals),
            "dhis2_response": json.dumps(response)[:4000],
            "warnings":       json.dumps(warnings[:20]),
            "triggered_by":   triggered_by,
        }
        command_sql(
            "INSERT INTO DHIS2AuditVertex CONTENT " + json.dumps(record)
        )
    except Exception as e:
        logger.debug(f"dhis2 audit log write failed (non-fatal): {e}")


def _record_last_sync(period: str, ok: bool, value_count: int, warnings: List[str]) -> None:
    try:
        import redis as _redis
        r = _redis.Redis(host=settings.REDIS_HOST, port=settings.REDIS_PORT, decode_responses=True)
        rec = {
            "at":       datetime.utcnow().isoformat() + "Z",
            "period":   period,
            "ok":       ok,
            "value_count": value_count,
            "warnings": warnings[:10],
        }
        r.set("dhis2:last_sync", json.dumps(rec), ex=30 * 24 * 3600)
        if ok and _PROM_OK:
            _METRIC_LAST_SYNC_AGE.set(0)
    except Exception:
        pass


# ── Orchestration ────────────────────────────────────────────────────────────

def sync_day(day: Optional[date] = None, dry_run: bool = False, triggered_by: str = "system") -> Dict:
    """
    Collect + push metrics for a single day. If day is None, uses yesterday UTC
    (standard pattern — always push the previous complete day).

    Flow: collect → build → push → (retry on failure) → audit → record status
    """
    if day is None:
        day = (datetime.utcnow() - timedelta(days=1)).date()

    metrics   = collect_daily_metrics(day)
    orgunits  = _load_orgunit_map()
    elements  = _load_dataelement_map()
    payload, warnings = build_payload(day, metrics, orgunits, elements)
    period = _dhis2_period(day)
    totals = {k: sum(b[k] for b in metrics.values()) for k in METRIC_KEYS}

    result = {
        "day":         day.isoformat(),
        "period":      period,
        "regions":     list(metrics.keys()),
        "totals":      totals,
        "value_count": len(payload.get("dataValues", [])),
        "warnings":    warnings,
        "dry_run":     dry_run,
    }

    if dry_run:
        result["payload_preview"] = payload
        _audit_log("dryrun", period, True, result["value_count"], totals, {}, warnings, triggered_by)
        return result

    if not payload.get("dataValues"):
        result["pushed"] = False
        result["reason"] = "nothing to push (empty or unmapped metrics)"
        _audit_log("push", period, True, 0, totals, {"note": "empty"}, warnings, triggered_by)
        return result

    ok, body = push_to_dhis2(payload)
    result["pushed"]   = ok
    result["response"] = body

    _audit_log("push", period, ok, result["value_count"], totals, body, warnings, triggered_by)
    _record_last_sync(period, ok, result["value_count"], warnings)

    if ok:
        _reset_failure_streak()
    else:
        streak = _bump_failure_streak()
        _enqueue_retry(payload, period, attempt=0)
        if streak >= _FAILURE_STREAK_THRESHOLD:
            _fire_failure_alert(
                f"{streak} consecutive DHIS2 sync failures",
                {"period": period, "attempt": 0, "response": body},
            )

    return result


# ── Scheduler (APScheduler) ─────────────────────────────────────────────────

_scheduler = None


def start_scheduler() -> None:
    """Start the AMINA Care DHIS2 daily cron + retry loop.

    Called once from main.py startup. Safe to call multiple times — idempotent.
    """
    global _scheduler
    if _scheduler is not None:
        return

    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.cron import CronTrigger
        from apscheduler.triggers.interval import IntervalTrigger
    except ImportError:
        logger.warning("dhis2_sync: APScheduler not installed — scheduler disabled")
        return

    _ensure_audit_schema()

    # BackgroundScheduler runs jobs in its own thread pool — works in both
    # async (FastAPI startup) and sync (test harness) contexts
    sched = BackgroundScheduler(timezone="UTC")

    # Daily sync at 02:00 UTC (pushes yesterday's metrics)
    sched.add_job(
        lambda: sync_day(day=None, dry_run=False, triggered_by="cron"),
        trigger=CronTrigger(hour=2, minute=0),
        id="dhis2_daily_sync",
        replace_existing=True,
        misfire_grace_time=3600,
    )

    # Retry queue every 5 minutes
    sched.add_job(
        run_pending_retries,
        trigger=IntervalTrigger(minutes=5),
        id="dhis2_retry_loop",
        replace_existing=True,
    )

    try:
        sched.start()
        _scheduler = sched
        logger.info("dhis2_sync: scheduler started (daily 02:00 UTC + retry every 5min)")
    except Exception as e:
        logger.error(f"dhis2_sync: failed to start scheduler: {e}")


# ── Daily counter helpers (imported by other services) ──────────────────────

def bump_daily_counter(region: str, metric_key: str, amount: int = 1) -> None:
    """
    Increment a Redis-backed daily counter for metrics that don't live in
    ConsultationRecord (caregiver alerts, safety blocks).

    Called from caregiver_alerts.py and safety_gate.py.
    """
    if metric_key not in METRIC_KEYS:
        return
    try:
        import redis as _redis
        r = _redis.Redis(host=settings.REDIS_HOST, port=settings.REDIS_PORT, decode_responses=True)
        period = _dhis2_period(datetime.utcnow().date())
        key = f"dhis2:daily:{period}:{(region or 'unknown').lower()}:{metric_key}"
        r.incrby(key, amount)
        r.expire(key, 7 * 24 * 3600)  # keep 7 days for retries
    except Exception as e:
        logger.debug(f"dhis2 counter bump failed (non-fatal): {e}")
