# Audit Event Store — Failure Alerting Runbook (AUDIT-010)

**Audience:** ops / SRE / pilot operator.
**Status:** 🟡 partial — local probe ships in this repo; **external
alert sink is the operator's responsibility** and is not implemented
in this codebase.

---

## 1. What this document covers

`audit_event_store.append_event` is fail-soft by design — a DB
failure does NOT crash the user's request. To make that safe in
practice, ops must be able to **detect** a sustained audit-write
failure and react before the audit trail goes silent.

This document explains:
- the local in-process counters that the audit store exposes;
- the read-only probe script ops scrapes;
- how to wire those counters into a real alert sink;
- the alert thresholds we recommend.

It does **not** install a real alert sink — that is intentionally
left to the operator because the right sink (PagerDuty, OpsGenie,
the existing application logs pipeline, Prometheus, etc.) depends on
the deployment topology. AUDIT-010 will move from 🟡 partial → ✅
complete when the chosen sink is live in production *and* a synthetic
failure has been observed firing the alert.

## 2. The local probe

Every uvicorn worker maintains an in-memory `_FailureCounter` keyed
on its own process. The counter is exposed read-only by:

```python
from src.services.audit_event_store import audit_health_snapshot
audit_health_snapshot()
```

Returns:

| Key | Type | Meaning |
|---|---|---|
| `total_attempts` | int | Every `append_event(...)` call this worker has handled |
| `failed_db` | int | Calls that failed at the DB write step |
| `failed_validation` | int | Calls that failed input validation |
| `redactions` | int | Calls where at least one metadata key/value was redacted |
| `last_failure_at` | str (ISO-8601) or `null` | When the most recent failure happened |
| `last_failure_reason` | str (≤ 256 chars) | Short, PHI-safe failure reason |
| `has_recent_db_failure` | bool | `failed_db > 0` |
| `has_recent_validation_failure` | bool | `failed_validation > 0` |

The shape is pinned by test 9 (`test_health_snapshot_shape`) in
[`_audit_event_store_test.py`](../../haystack-stack/haystack-chatqna/_audit_event_store_test.py).

## 3. The probe CLI

```bash
docker exec haystack-chatqna python /app/scripts/audit_event_health.py
docker exec haystack-chatqna python /app/scripts/audit_event_health.py --json
```

Exit code is `0` on success, `2` on import failure. The `--json`
form emits a single-line JSON object suitable for piping into a
metrics pipeline.

**Important caveat:** the counters are **per-worker**. Running the
probe inside `docker exec` lands on one Python process per uvicorn
worker. With 4 workers (the current default), the probe needs to be
run against each worker, or aggregated across workers via something
that all of them write to (e.g. log lines emitted by
`audit_event_store`).

## 4. Where the alert should fire

The single signal ops cares about is **a sustained run of `failed_db
> 0` events with no successful writes in between**. That means the
audit trail has gone silent — caregiver privacy events, consent
captures, and stale warnings are no longer reaching the central
store.

Suggested alert recipe (any one is fine; pick what fits the existing
sink):

| Sink | Signal | Threshold | Notes |
|---|---|---|---|
| Application log pipeline (current AMINA setup) | grep for `audit_event_store: DB failure` log lines | ≥ 5 lines in 5 minutes | matches the existing log convention |
| Prometheus / metrics endpoint (future) | scrape `/metrics` -> `audit_failed_db_total` counter | rate of increase > 0.1/min | requires `OPS-005` metrics endpoint to land |
| PagerDuty / OpsGenie via webhook | direct webhook from the metrics scraper | page on the same threshold | full closure of AUDIT-010 |

## 5. PHI guarantee in the probe output

The probe emits **only** the 8 keys above. The
`last_failure_reason` field is explicitly truncated to 256 chars and
never echoes the offending metadata — verified by test 6
(`test_db_failure_returns_safe_result`) and test 9
(`test_health_snapshot_shape`). It is therefore safe to pipe the
output into any sink, including external SaaS, without further
filtering.

## 6. Closing AUDIT-010

To move AUDIT-010 from 🟡 partial → ✅ complete:

1. Choose the alert sink (operator decision).
2. Wire the local probe (CLI or `audit_health_snapshot()` import) into
   the sink — either pull (cron / metrics scrape) or push (webhook
   from the scraper).
3. Demonstrate the alert firing on a synthetic DB failure. The audit
   store has a test runner mode (the unit tests use `MockDB.fail_next
   = True`) that can be re-used for a one-shot synthetic check in
   staging.
4. Document the chosen sink + threshold in this file.
5. Update [`compliance_controls.json`](compliance_controls.json) AUDIT-010 to
   `complete` with implementation evidence pointing here.

Until step 4 lands, AUDIT-010 remains partial.
