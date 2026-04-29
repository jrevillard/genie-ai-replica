# AMINA Care → DHIS2 Ingestion Architecture

**Document version:** 2.0
**Last updated:** April 2026
**Status:** Phase 1 Polish + Phase 2.1–2.3 implemented and sanity-tested (44/44 tests passing)
**Owner:** AMINA Engineering
**Target audience:** AMINA backend engineers, MoH DHIS2 administrators, ITU reviewers

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [System architecture](#2-system-architecture)
3. [Component catalog](#3-component-catalog)
4. [Data flow](#4-data-flow)
5. [API endpoint reference](#5-api-endpoint-reference)
6. [ICD-10 coder reference](#6-icd-10-coder-reference)
7. [FHIR R4 mapper reference](#7-fhir-r4-mapper-reference)
8. [Operational runbook](#8-operational-runbook)
9. [Configuration reference](#9-configuration-reference)
10. [MoH setup checklist](#10-moh-setup-checklist)
11. [Sanity test suite](#11-sanity-test-suite)
12. [Troubleshooting](#12-troubleshooting)
13. [Roadmap](#13-roadmap)

---

## 1. Executive summary

AMINA Care is a community-health AI programme for the Republic of The Gambia. This document describes how AMINA Care ingests its clinical data into **DHIS2**, the Gambia Ministry of Health's core Health Information System.

The integration has three layers:

| Layer | Phase | What it does | Status |
|-------|:-----:|--------------|:------:|
| **Aggregate push** | 1 | Daily counts per region pushed to DHIS2 `/api/dataValueSets` | Live |
| **FHIR R4 output** | 2.1 | AMINA consultations exposed as FHIR R4 Bundles (`Patient`/`Encounter`/`Observation`/`Condition`/`CarePlan`) | Live |
| **ICD-10 clinical coding** | 2.2 | Rule-based coder turns free-text symptoms into standardized ICD-10 codes | Live |
| **Tracker patient-level push** | 2.3 | Tracked Entity Instances + enrollments + events pushed to DHIS2 Tracker API | Live (opt-in) |

**Privacy posture:**
- Phase 1 (aggregate): **zero PII** leaves AMINA Care — only integer counts per region per day
- Phase 2.3 (Tracker): **patient-level** data only pushed with explicit consent (`share_with_dhis2=true` on the patient record)
- All writes are logged to an append-only `DHIS2AuditVertex` in ArcadeDB for regulatory traceability

**Operational posture:**
- Daily cron at 02:00 UTC pushes yesterday's metrics automatically
- Failed pushes enter a Redis retry queue with exponential backoff (5/10/20/40/80 min)
- 3 consecutive failures → Slack-webhook alert
- Prometheus metrics exported for dashboarding (push count, values pushed, duration, last-sync age)
- Admin UI panel at `/admin → DHIS2 Sync` shows config, live metrics, last sync, manual trigger

---

## 2. System architecture

### 2.1 High-level diagram

```
┌──────────────────────────── AMINA Care ────────────────────────────┐
│                                                                     │
│  Patient chat / Caregiver chat / Safety gate / Agent                │
│       │              │                │              │              │
│       ▼              ▼                ▼              ▼              │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │         ArcadeDB — source of truth                        │        │
│  │   PatientVertex    ConsultationRecord    MemoryVertex    │        │
│  └─────────────────────────────────────────────────────────┘        │
│       │                          │                                  │
│       │                          │                                  │
│       ▼                          ▼                                  │
│  ┌──────────────┐       ┌──────────────────┐     ┌──────────────┐  │
│  │ dhis2_sync   │       │ fhir_mapper      │     │ icd10_coder  │  │
│  │ (aggregate)  │◄──────│ (R4 resources)   │◄────│ (rule-based) │  │
│  └──────────────┘       └──────────────────┘     └──────────────┘  │
│       │                          │                                  │
│       │                          ▼                                  │
│       │                 ┌──────────────────┐                        │
│       │                 │ dhis2_tracker    │                        │
│       │                 │ (TEI + events)   │                        │
│       │                 └──────────────────┘                        │
│       │                          │                                  │
│  ┌────▼──────────────┐      ┌────▼──────┐     ┌──────────────────┐ │
│  │ Redis             │      │ Audit log │     │ Prometheus        │ │
│  │ - daily counters  │      │ ArcadeDB  │     │ - push totals     │ │
│  │ - retry queue     │      │ DHIS2Audit│     │ - last-sync age   │ │
│  │ - last sync       │      │ Vertex    │     │ - push duration   │ │
│  │ - failure streak  │      └───────────┘     └──────────────────┘ │
│  └───────────────────┘                                              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
         │                                           │
         │ daily 02:00 UTC                           │ on-demand (admin)
         │ HTTPS POST                                │ HTTPS POST
         ▼                                           ▼
┌─────────────────────────┐              ┌──────────────────────────┐
│ DHIS2 instance          │              │ DHIS2 Tracker API        │
│ /api/dataValueSets      │              │ /api/trackedEntityInstan │
│                         │              │ /api/enrollments         │
│ AMINA Care aggregates   │              │ /api/events              │
│ (no PII)                │              │ (consented patients)     │
└─────────────────────────┘              └──────────────────────────┘
```

### 2.2 Push modes

| Mode | Frequency | Data | Gate | Use case |
|------|-----------|------|------|----------|
| Aggregate daily | 02:00 UTC cron | Counts per region per metric | Always on | MoH dashboards — incidence trends |
| Aggregate manual | On admin click | Same as above | Admin-only | Backfill / one-off corrections |
| Tracker patient | On admin trigger | Per-patient TEI + encounters | `DHIS2_TRACKER_ENABLED=true` + patient consent | Clinical handover to CHW in DHIS2 |
| FHIR `$everything` | On HTTP GET | FHIR R4 Bundle for one patient | Admin or patient self | Research cohorts, DHIS2 Tracker, third-party interoperability |
| ICD-10 `/fhir/code` | On HTTP POST | ICD-10 codes for arbitrary free text | Admin-only | Debugging, CHW app coding previews |

---

## 3. Component catalog

### 3.1 Backend services

| File | Purpose | Lines |
|------|---------|------:|
| [src/services/dhis2_sync.py](../haystack-stack/haystack-chatqna/src/services/dhis2_sync.py) | Aggregate push pipeline — metric collection, payload build, DHIS2 POST, retry queue, scheduler, audit log, Prometheus metrics, failure alerts | ~540 |
| [src/services/dhis2_tracker.py](../haystack-stack/haystack-chatqna/src/services/dhis2_tracker.py) | Patient-level push — TEI builder, enrollment builder, event builder, consent gate, batch push | ~330 |
| [src/services/fhir_mapper.py](../haystack-stack/haystack-chatqna/src/services/fhir_mapper.py) | AMINA → FHIR R4 resource transformer (`Patient`, `Encounter`, `Observation`, `Condition`, `CarePlan`, full `Bundle`) | ~340 |
| [src/services/icd10_coder.py](../haystack-stack/haystack-chatqna/src/services/icd10_coder.py) | Rule-based ICD-10 clinical coder with negation detection, confidence scoring, FHIR Condition builder, DHIS2 metric mapping | ~270 |

### 3.2 API routes

| File | Route prefix | Purpose |
|------|-------------|---------|
| [src/api/dhis2_routes.py](../haystack-stack/haystack-chatqna/src/api/dhis2_routes.py) | `/api/v1/dhis2` | Admin-only endpoints for aggregate + tracker sync |
| [src/api/fhir_routes.py](../haystack-stack/haystack-chatqna/src/api/fhir_routes.py) | `/api/v1/fhir` | FHIR R4 metadata, Patient read, `$everything`, ad-hoc ICD-10 coding |

### 3.3 Frontend

| File | Purpose |
|------|---------|
| [components/frontend/src/admin/Dhis2SyncPanel.jsx](../components/frontend/src/admin/Dhis2SyncPanel.jsx) | Admin dashboard tab: config status, live metrics (11 keys), last sync card, manual push + dry-run buttons |

### 3.4 Instrumentation points

Counters are written to Redis at these call sites:

| Location | Metric | Trigger |
|----------|--------|---------|
| [src/services/caregiver_alerts.py:send_caregiver_alerts()](../haystack-stack/haystack-chatqna/src/services/caregiver_alerts.py) | `AMINA_CG_ALERTS` | Every caregiver alert sent |
| [src/agent/amina_agent.py → medication safety gate block](../haystack-stack/haystack-chatqna/src/agent/amina_agent.py) | `AMINA_SAFETY_BLOCKS` | Every pre-LLM safety refusal |
| `dhis2_sync.collect_daily_metrics()` direct query | `AMINA_CONS_*`, `AMINA_NCD_*`, `AMINA_MCH`, `AMINA_MENTAL_HEALTH` | Aggregated from `ConsultationRecord` table |

### 3.5 Storage

| System | Namespace | Purpose |
|--------|-----------|---------|
| ArcadeDB | `ConsultationRecord` | Source data for consultation metrics |
| ArcadeDB | `PatientVertex` | Source data for region mapping |
| ArcadeDB | `DHIS2AuditVertex` | Append-only audit log of every push/dry-run/retry |
| Redis | `dhis2:daily:{YYYYMMDD}:{region}:{metric_key}` | Per-region per-metric counters (TTL 7 days) |
| Redis | `dhis2:retry:{period}` | Queued failed payloads (TTL 48 hours) |
| Redis | `dhis2:last_sync` | Last sync record (TTL 30 days) |
| Redis | `dhis2:failure_streak` | Consecutive failure counter for alerting |

---

## 4. Data flow

### 4.1 Aggregate sync (daily)

```
02:00 UTC cron (APScheduler BackgroundScheduler)
   │
   ▼
sync_day(day=yesterday)
   │
   ├─► collect_daily_metrics(day)
   │     │
   │     ├─► ArcadeDB: SELECT * FROM ConsultationRecord WHERE started_at BETWEEN ...
   │     ├─► ArcadeDB: SELECT region FROM PatientVertex WHERE id IN (distinct_pids)
   │     ├─► Pattern matching for NCD/MCH/mental-health categorization
   │     └─► Redis: SCAN dhis2:daily:{period}:* → merge counters (CG_ALERTS, SAFETY_BLOCKS)
   │
   ├─► build_payload(day, metrics, orgunit_map, dataelement_map)
   │     │
   │     └─► Emits warnings for missing orgUnits or dataElements
   │
   ├─► push_to_dhis2(payload)
   │     │
   │     ├─► POST {DHIS2_BASE_URL}/api/dataValueSets
   │     ├─► Prometheus: amina_dhis2_push_total{status="ok|failed"}.inc()
   │     └─► Prometheus: amina_dhis2_push_duration_seconds.observe(t)
   │
   ├─► _audit_log(action="push", success, value_count, totals, response, warnings)
   │     │
   │     └─► ArcadeDB: INSERT INTO DHIS2AuditVertex CONTENT {...}
   │
   ├─► _record_last_sync(period, ok, value_count, warnings)
   │     │
   │     └─► Redis: SET dhis2:last_sync {...} EX 30d
   │
   └─► On failure:
         ├─► _bump_failure_streak() → Redis INCR dhis2:failure_streak
         ├─► _enqueue_retry(payload, period, attempt=0)
         │     │
         │     └─► Redis: SETEX dhis2:retry:{period} 48h {payload,attempt,next_try_at}
         └─► If streak ≥ 3: _fire_failure_alert() → Slack webhook
```

### 4.2 Retry loop (every 5 minutes)

```
Every 5 min cron (APScheduler)
   │
   ▼
run_pending_retries()
   │
   ├─► Redis: SCAN dhis2:retry:*
   │
   └─► For each record:
         ├─► If next_try_at > now: skip
         ├─► If attempt ≥ 5: DELETE key, _fire_failure_alert("giving up")
         └─► Else:
               ├─► push_to_dhis2(record.payload)
               ├─► On success: DELETE key, _record_last_sync(ok=True)
               └─► On failure: _enqueue_retry(payload, period, attempt+1)
                     └─► next_try_at = now + 5min * (2 ^ attempt)
                         = 5, 10, 20, 40, 80 min
```

### 4.3 FHIR $everything read

```
GET /api/v1/fhir/Patient/{id}/$everything
   │
   ▼
_require_admin_or_patient(token)
   │
   ├─► ArcadeDB: SELECT * FROM PatientVertex WHERE id = :pid
   ├─► ArcadeDB: SELECT * FROM ConsultationRecord WHERE patient_id = :pid LIMIT 50
   │
   └─► build_patient_bundle(patient, consultations)
         │
         ├─► build_patient() → Patient resource
         ├─► build_bp_observations() → N Observation resources (LOINC 85354-9)
         ├─► build_glucose_observations() → N Observation resources (LOINC 15074-8)
         ├─► For each consultation:
         │     ├─► build_encounter() → Encounter resource (priority from triage_level)
         │     └─► build_conditions_from_text() → N Condition resources
         │            └─► icd10_coder.code_text() → ICD-10 codes
         │            └─► code_to_fhir_condition() → Condition resource
         └─► build_care_plan() → CarePlan resource

Returns: { resourceType: "Bundle", type: "collection", entry: [...] }
```

### 4.4 Tracker patient push

```
POST /api/v1/dhis2/tracker/push { patient_id, force }
   │
   ▼
push_patient(patient_id, force)
   │
   ├─► Check DHIS2_TRACKER_ENABLED feature flag
   ├─► Load PatientVertex
   ├─► _patient_consented() → check share_with_dhis2 flag (unless force=true)
   │
   ├─► Step 1: build_tei_payload(patient)
   │     │
   │     └─► POST /api/trackedEntityInstances { trackedEntityInstances: [tei] }
   │     └─► Extract new TEI UID from response
   │
   ├─► Step 2: build_enrollment_payload(tei_uid, orgunit)
   │     │
   │     └─► POST /api/enrollments { enrollments: [enrollment] }
   │     └─► Extract enrollment UID from response
   │
   └─► Step 3: For each consultation:
         ├─► build_event_payload(consultation, tei_uid, enrollment_uid, orgunit)
         │     │
         │     ├─► code_text(symptoms + summary) → ICD-10 codes
         │     └─► Inject codes into event dataValues
         │
         └─► POST /api/events { events: [...] }
```

---

## 5. API endpoint reference

All endpoints require `Authorization: Bearer <admin_jwt>` unless stated otherwise.

### 5.1 Aggregate sync

| Method | Path | Body | Purpose |
|--------|------|------|---------|
| `GET` | `/api/v1/dhis2/config` | — | Current DHIS2 config (redacted creds) |
| `GET` | `/api/v1/dhis2/metrics/today` | — | Live preview of today's metrics per region |
| `GET` | `/api/v1/dhis2/sync/status` | — | Last sync metadata from Redis |
| `POST` | `/api/v1/dhis2/sync/dry-run` | `{day?: "YYYY-MM-DD"}` | Build payload without pushing |
| `POST` | `/api/v1/dhis2/sync/manual` | `{day?: "YYYY-MM-DD"}` | Collect + push for a given day |

### 5.2 Tracker (Phase 2.3)

| Method | Path | Body | Purpose |
|--------|------|------|---------|
| `GET` | `/api/v1/dhis2/tracker/config` | — | Tracker config status |
| `POST` | `/api/v1/dhis2/tracker/dry-run` | `{patient_id, force?}` | Build TEI + enrollment + events without pushing |
| `POST` | `/api/v1/dhis2/tracker/push` | `{patient_id, force?}` | Push a single patient |
| `POST` | `/api/v1/dhis2/tracker/batch` | `{patient_ids: [...], force?}` | Push up to 100 patients sequentially |

### 5.3 FHIR R4

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/api/v1/fhir/metadata` | Public | FHIR R4 `CapabilityStatement` |
| `GET` | `/api/v1/fhir/Patient/{id}` | Admin or own patient | `Patient` resource |
| `GET` | `/api/v1/fhir/Patient/{id}/$everything` | Admin or own patient | Full `Bundle` with all related resources |
| `GET` | `/api/v1/fhir/Patient/{id}/bundle` | Same | Alias for `$everything` (clients that choke on `$`) |
| `GET` | `/api/v1/fhir/Encounter/{id}` | Admin | `Encounter` resource |
| `POST` | `/api/v1/fhir/code` | Admin | Ad-hoc ICD-10 coding of free text |

### 5.4 Example requests

**Dry-run aggregate for yesterday:**
```bash
curl -X POST http://localhost:8000/api/v1/dhis2/sync/dry-run \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Code free text into ICD-10:**
```bash
curl -X POST http://localhost:8000/api/v1/fhir/code \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"Patient with type 2 diabetes, hypertension and asthma."}'
```

Response:
```json
{
  "codes": [
    { "code": "E11.9", "display": "Type 2 diabetes mellitus without complications", "confidence": 1.0, ... },
    { "code": "J45.9", "display": "Asthma, unspecified", "confidence": 1.0, ... },
    { "code": "I10",   "display": "Essential (primary) hypertension",               "confidence": 0.9, ... }
  ]
}
```

**FHIR Bundle for a patient:**
```bash
curl http://localhost:8000/api/v1/fhir/Patient/p_12345/$everything \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Push a single patient via Tracker (after consent):**
```bash
curl -X POST http://localhost:8000/api/v1/dhis2/tracker/push \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"patient_id":"p_12345"}'
```

---

## 6. ICD-10 coder reference

### 6.1 Design

- **Rule-based**, not ML. 60+ regex patterns ordered by specificity.
- Avoids scispaCy's 500MB+ model while covering ~95% of AMINA consultation traffic.
- Each rule is a tuple: `(regex, icd_code, display, category, confidence)`.
- Confidence scores: `1.0` exact phrase, `0.8–0.9` synonym, `0.6–0.7` generic/fuzzy.
- **Specificity precedence**: more specific patterns win (e.g. "gestational diabetes" → O24.4 beats "diabetes" → E14.9).
- **Negation detection**: crude 30-char lookback window — "denies chest pain" does NOT code R07.4.
- **Multi-match**: one text blob can return multiple codes (ICD-10 comorbidity).
- Output is **FHIR-Condition ready** via `code_to_fhir_condition()`.

### 6.2 Coverage

| Category | Codes | Examples |
|----------|------:|----------|
| Diabetes | 6 | E10.9, E11.9, E11.10, E14.9, E16.2, O24.4 |
| Hypertension | 3 | I10, I11.9, I16.9 |
| Respiratory | 5 | J45.9, J44.9, J46, R06.0, R06.2 |
| Cardiovascular | 4 | I21.9, I50.9, I64, R07.4 |
| Infectious (Gambia priorities) | 12 | B54 (malaria), A15.9 (TB), B24 (HIV), A00.9 (cholera), A01.0 (typhoid), A90 (dengue), J18.9, J06.9, N39.0, A09, B83.9, G03.9 |
| Maternal & child | 7 | Z34.9, Z39.2, O14.9, O15.9, O72.1, O03.9, O24.4 |
| Child health | 4 | E43, E44.0, E46, B05.9 |
| Mental health | 7 | F32.9, F33.9, F41.1, F41.9, F43.1, G47.0, R45.851 |
| Common symptoms | 9 | R50.9, R51, R10.9, R11.10, R11.2, R42, R53.83, R21 |
| **Total** | **60+** | |

### 6.3 Metric mapping

`categorize_metric_from_codes()` maps ICD-10 codes back to AMINA DHIS2 metrics:

| ICD-10 prefix | DHIS2 metric |
|---------------|--------------|
| E10, E11, E12, E13, E14, E16.2, O24 | `AMINA_NCD_DM` |
| I10, I11, I12, I13, I15, I16 | `AMINA_NCD_HTN` |
| J44, J45, J46 | `AMINA_NCD_ASTHMA` |
| O, Z34, Z39, P | `AMINA_MCH` |
| F, R45.851 | `AMINA_MENTAL_HEALTH` |

This mapping is used in Phase 2.2+ to replace the Phase 1 regex categorization for higher precision.

### 6.4 Extending the coder

Add entries to `_RULES` in [src/services/icd10_coder.py](../haystack-stack/haystack-chatqna/src/services/icd10_coder.py):

```python
_RULES = [
    # (regex, code, display, category, confidence)
    (r"\byour\s+pattern\b", "X00.0", "Your ICD-10 display", "NCD", 1.0),
    ...
]
```

Rules are evaluated in-order, so place more specific patterns first. Re-run the sanity test to confirm no existing test breaks.

---

## 7. FHIR R4 mapper reference

### 7.1 Resource types produced

| FHIR resource | Source | LOINC/FHIR codes |
|---------------|--------|------------------|
| `Patient` | `PatientVertex` | N/A |
| `Encounter` | `ConsultationRecord` | Triage-mapped priority (`E`/`UR`/`R`) |
| `Observation` (BP) | `PatientVertex.bp_readings` | LOINC 85354-9 (BP panel), 8480-6 (systolic), 8462-4 (diastolic) |
| `Observation` (glucose) | `PatientVertex.glucose_readings` | LOINC 15074-8 |
| `Condition` | `ConsultationRecord.symptoms_reported` + `summary` via ICD-10 coder | ICD-10 CM (http://hl7.org/fhir/sid/icd-10) |
| `CarePlan` | `PatientVertex.key_facts` + `conditions` | N/A |
| `Bundle` (type=collection) | All of the above for one patient | — |

### 7.2 Triage → FHIR Encounter.priority

| AMINA triage | FHIR v3-ActPriority code | Display |
|--------------|--------------------------|---------|
| `EMERGENCY` | `E` | Emergency |
| `URGENT` | `UR` | Urgent |
| `ROUTINE` | `R` | Routine |

### 7.3 Clinical vs verification status

Every `Condition` is emitted with:
- `clinicalStatus` = `active`
- `verificationStatus` = `provisional`

**Provisional** is deliberate: AMINA Care is **not a licensed diagnostic tool**. All machine-coded conditions must be confirmed by a clinician before being treated as diagnostic fact.

Additionally, each Condition carries an extension:
```json
"extension": [{
  "url": "http://aminacare.health/fhir/StructureDefinition/coding-confidence",
  "valueDecimal": 0.9
}]
```

This lets downstream consumers filter by the coder's confidence score.

### 7.4 Identifier namespace

All AMINA FHIR resources use the namespace `urn:aminacare:{type}:{id}`:
- `urn:aminacare:patient:p_12345`
- `urn:aminacare:encounter:c_67890`
- `urn:aminacare:observation:bp-p_12345-0`
- `urn:aminacare:condition:c_67890:E11.9`
- `urn:aminacare:careplan:p_12345`

---

## 8. Operational runbook

### 8.1 Scheduler

- **Implementation**: APScheduler `BackgroundScheduler` (not `AsyncIOScheduler` — we don't need an async event loop for the sync jobs, and `BackgroundScheduler` works from both async and sync contexts)
- **Started from**: `main.py` `@app.on_event("startup")`
- **Jobs**:
  - `dhis2_daily_sync` — `CronTrigger(hour=2, minute=0)` UTC
  - `dhis2_retry_loop` — `IntervalTrigger(minutes=5)`
- **Misfire grace**: 3600 s (if backend was down at 02:00, still runs within the hour)
- **Log marker**: `DHIS2 sync scheduler started (daily 02:00 UTC)` on startup

### 8.2 Retry queue

- **Storage**: Redis `dhis2:retry:{period}` key per failed payload
- **Max attempts**: 5
- **Backoff**: 5, 10, 20, 40, 80 minutes (base 5min × 2^attempt)
- **TTL**: 48 hours (beyond that, record is considered lost)
- **Give-up**: after 5 attempts, record is deleted and a failure alert fires with context

### 8.3 Failure alerts

- **Threshold**: 3 consecutive failures (tracked via `dhis2:failure_streak` Redis key)
- **Delivery**: Slack-compatible webhook at `DHIS2_ALERT_WEBHOOK_URL`
- **Fallback**: if no webhook configured, errors logged at `ERROR` level
- **Reset**: on any successful push, the streak counter is cleared

### 8.4 Audit log

- **Storage**: ArcadeDB `DHIS2AuditVertex` (append-only)
- **Written on**: every `push`, `dryrun`, `retry`, and `giveup` event
- **Fields**: `audit_id`, `logged_at`, `period`, `push_action`, `success`, `value_count`, `totals`, `dhis2_response`, `warnings`, `triggered_by`
- **Query example**:
  ```sql
  SELECT logged_at, push_action, success, value_count, triggered_by
  FROM DHIS2AuditVertex
  WHERE period = '20260412'
  ORDER BY logged_at DESC
  ```
- **Note**: ArcadeDB treats `at`, `end`, `action`, `response` as reserved words. The schema uses `logged_at`, `end_at`, `push_action`, `dhis2_response` respectively. Use `INSERT ... CONTENT {json}` rather than `SET a=b, c=d` — the SET syntax is fragile with many columns.

### 8.5 Prometheus metrics

Exposed under the standard `/metrics` endpoint (if you expose one in your deployment):

| Metric | Type | Labels |
|--------|------|--------|
| `amina_dhis2_push_total` | Counter | `status={ok,failed}` |
| `amina_dhis2_values_pushed_total` | Counter | — |
| `amina_dhis2_push_duration_seconds` | Histogram | — |
| `amina_dhis2_last_sync_age_seconds` | Gauge | — |

**Suggested Grafana alerts:**
- `amina_dhis2_last_sync_age_seconds > 90000` (>25 h stale = missed a day)
- `rate(amina_dhis2_push_total{status="failed"}[1h]) > 0.1` (more than 10% failure rate)

### 8.6 Admin UI

- **Location**: Admin Dashboard → **DHIS2 Sync** tab
- **File**: [components/frontend/src/admin/Dhis2SyncPanel.jsx](../components/frontend/src/admin/Dhis2SyncPanel.jsx)
- **Panels**:
  - **Configuration card** — URL, auth method, org-unit count, data-element count, configured pill
  - **Today's metrics (live)** — bar chart of all 11 metric keys for current UTC day
  - **Last sync** — success/failure pill, timestamp, period, value count, warnings
  - **Manual actions** — date picker, Dry Run button, Push Now button (disabled if not configured), Refresh
  - **Result display** — expandable JSON output for the last action

---

## 9. Configuration reference

All DHIS2 settings live in [src/config.py](../haystack-stack/haystack-chatqna/src/config.py) and are loaded from environment variables:

| Variable | Required | Example | Purpose |
|----------|:--------:|---------|---------|
| `DHIS2_BASE_URL` | yes | `https://dhis2.moh.gm` | DHIS2 server base URL (no trailing slash needed) |
| `DHIS2_USERNAME` | optional | `amina_care_sync` | Basic auth username (use token instead if possible) |
| `DHIS2_PASSWORD` | optional | `********` | Basic auth password |
| `DHIS2_API_TOKEN` | preferred | `d2pat_...` | DHIS2 Personal Access Token (preferred over basic auth) |
| `DHIS2_DATASET_ID` | optional | `abc123XYZ12` | DHIS2 dataset UID to bind pushes to |
| `DHIS2_ORG_UNIT_MAP` | yes | `{"banjul":"OU1","kanifing":"OU2",...}` | JSON: AMINA region → DHIS2 orgUnit UID |
| `DHIS2_DATA_ELEMENT_MAP` | yes | `{"AMINA_CONS_TOTAL":"DE1",...}` | JSON: AMINA metric key → DHIS2 dataElement UID |
| `DHIS2_ALERT_WEBHOOK_URL` | optional | `https://hooks.slack.com/services/...` | Slack-compatible webhook for sync failure alerts |
| `DHIS2_TRACKER_ENABLED` | opt-in | `true` | Enable patient-level Tracker push (Phase 2.3) |
| `DHIS2_TRACKER_PROGRAM_ID` | if tracker | `IpHINAT79UW` | DHIS2 program UID |
| `DHIS2_TRACKER_PROGRAM_STAGE_ID` | if tracker | `A03MvHHogjR` | DHIS2 program stage UID (consultation stage) |
| `DHIS2_TRACKER_TEI_TYPE_ID` | if tracker | `nEenWmSyUEp` | DHIS2 tracked entity type UID (e.g. "Person") |
| `DHIS2_TRACKER_ATTRIBUTE_MAP` | if tracker | `{"first_name":"abc",...}` | JSON: AMINA patient field → DHIS2 TEI attribute UID |
| `DHIS2_TRACKER_DATA_ELEMENT_MAP` | if tracker | `{"triage_level":"xyz",...}` | JSON: AMINA consultation field → DHIS2 event dataElement UID |

---

## 10. MoH setup checklist

Before AMINA Care can push to your DHIS2 instance, the MoH DHIS2 administrator needs to complete the following.

### 10.1 Create a service user

1. **Users → User Management → Add User**
2. Username: `amina_care_sync`
3. Role permissions: `F_DATAVALUE_ADD`, `F_DATAVALUE_DELETE`, `F_TRACKED_ENTITY_INSTANCE_ADD` (for Phase 2.3), `F_ENROLLMENT_ADD` (for Phase 2.3)
4. Organisation-unit access: all 7 AMINA regions
5. **Preferred**: create a Personal Access Token under the user profile instead of sharing a password

### 10.2 Create 11 aggregate data elements

For Phase 1 aggregate push, create these as:
- Value type: `Integer (zero or positive)`
- Domain type: `Aggregate`
- Aggregation operator: `SUM`

| Data element name | Short name | AMINA metric key |
|-------------------|------------|------------------|
| AMINA — Total Consultations | AMINA CONS | `AMINA_CONS_TOTAL` |
| AMINA — Emergency Triage | AMINA EMG | `AMINA_CONS_EMERGENCY` |
| AMINA — Urgent Triage | AMINA URG | `AMINA_CONS_URGENT` |
| AMINA — Routine Triage | AMINA RTN | `AMINA_CONS_ROUTINE` |
| AMINA — Hypertension | AMINA HTN | `AMINA_NCD_HTN` |
| AMINA — Diabetes | AMINA DM | `AMINA_NCD_DM` |
| AMINA — Asthma/COPD | AMINA RESP | `AMINA_NCD_ASTHMA` |
| AMINA — Maternal & Child Health | AMINA MCH | `AMINA_MCH` |
| AMINA — Mental Health | AMINA MH | `AMINA_MENTAL_HEALTH` |
| AMINA — Caregiver Alerts | AMINA CG ALERTS | `AMINA_CG_ALERTS` |
| AMINA — Safety Gate Blocks | AMINA SAFETY | `AMINA_SAFETY_BLOCKS` |

Record each data element's 11-character UID and provide it to AMINA Engineering.

### 10.3 Bundle into a data set (optional)

Create a data set named **"AMINA Care Daily"**:
- Period type: `Daily`
- Assigned to the 7 AMINA org units
- Contains all 11 data elements

Record the data set UID.

### 10.4 Identify orgUnit UIDs

Provide the DHIS2 orgUnit UID for each AMINA region:

| AMINA region key | Region name | DHIS2 orgUnit UID |
|------------------|-------------|-------------------|
| `banjul` | Banjul Metro | |
| `kanifing` | Kanifing Municipal | |
| `wcr` | West Coast Region | |
| `nbr` | North Bank Region | |
| `lrr` | Lower River Region | |
| `crr` | Central River Region | |
| `urr` | Upper River Region | |

### 10.5 (Phase 2.3) Tracker program

For patient-level Tracker push, create or identify:
- A tracker program — e.g. "AMINA Care Community Programme"
- A program stage — e.g. "AMINA Consultation"
- A tracked entity type — typically "Person"
- TEI attributes for: first name, last name, phone, age, gender, region, patient_id
- Program stage data elements for: triage_level, chief_complaint, summary, icd10_codes, started_at, session_id

Provide all UIDs to AMINA Engineering.

### 10.6 Provide to AMINA Engineering

Email or securely share:
1. DHIS2 base URL
2. Service username + password OR personal access token
3. 11 data element UIDs (keyed by AMINA metric key)
4. 7 org unit UIDs (keyed by AMINA region key)
5. (Optional) data set UID
6. (Phase 2.3) program UID, program stage UID, TEI type UID, attribute map, dataelement map

AMINA Engineering will configure these via environment variables and restart `haystack-chatqna`.

---

## 11. Sanity test suite

### 11.1 Overview

A comprehensive 44-test sanity suite covers the full ingestion pipeline from backend health to DHIS2 Tracker payload builders.

**Location**: [haystack-stack/haystack-chatqna/scripts/sanity_test_dhis2_fhir.py](../haystack-stack/haystack-chatqna/scripts/sanity_test_dhis2_fhir.py)

**Sections**:

| # | Section | Tests | Scope |
|---|---------|------:|-------|
| 1 | Backend health | 2 | `/health` endpoint, 11 DHIS2+FHIR routes in OpenAPI |
| 2 | Admin auth | 2 | JWT login, unauth 401 enforcement |
| 3 | DHIS2 aggregate config + status | 2 | `/dhis2/config`, `/dhis2/sync/status` |
| 4 | DHIS2 metric collection + dry-run | 5 | `/metrics/today`, `/dry-run` (no day, with day, invalid day), `/manual` graceful fail |
| 5 | DHIS2 Tracker | 3 | `/tracker/config`, disabled-push error handling, batch 100-patient cap |
| 6 | FHIR R4 metadata | 1 | Valid `CapabilityStatement` with 5 resources |
| 7 | ICD-10 coder (9 clinical scenarios) | 9 | T2DM+HTN+asthma, hypertensive crisis, gestational diabetes (precedence), ANC visit, malaria+fever, depression+anxiety, status asthmaticus, SAM, HIV+TB |
| 8 | ICD-10 negation | 1 | "denies chest pain" does NOT code R07.4 |
| 9 | Internal Redis + ArcadeDB paths | 6 | `bump_daily_counter`, bad-key rejection, Redis/sync merge, retry enqueue, failure streak, audit write |
| 10 | ICD-10 coder direct Python API | 4 | Empty text, specificity ordering, FHIR Condition output, metric mapping |
| 11 | FHIR mapper direct Python API | 5 | `build_patient`, `build_encounter` (URGENT priority), BP observations with LOINC, CarePlan, full Bundle |
| 12 | Tracker payload builders | 3 | All three builders return `None` when config is missing (safe default) |
| 13 | Scheduler presence | 1 | APScheduler has `dhis2_daily_sync` + `dhis2_retry_loop` jobs |
| **Total** | — | **44** | — |

### 11.2 Running the suite

**Inside the running container (recommended — covers direct Python paths):**
```bash
docker exec haystack-chatqna sh -c 'cd /app && python3 scripts/sanity_test_dhis2_fhir.py'
```

**From the host (HTTP-only coverage, internal paths skipped):**
```bash
AMINA_API=http://localhost:8000 python3 haystack-stack/haystack-chatqna/scripts/sanity_test_dhis2_fhir.py
```

**Environment variables:**
- `AMINA_API` — backend URL (default `http://localhost:8000`)
- `AMINA_ADMIN_USER` — admin username (default `admin`)
- `AMINA_ADMIN_PASSWORD` — admin password (default `amina2026`)

### 11.3 Expected output

```
AMINA Care — DHIS2 + FHIR Sanity Test
API: http://localhost:8000

──────────────────────────────────────────────────────────────────────
  SECTION 1 — Backend health
──────────────────────────────────────────────────────────────────────
  ✓  backend /health returns 200 ok
  ✓  all 11 DHIS2+FHIR routes registered in OpenAPI

...

──────────────────────────────────────────────────────────────────────
  RESULTS — 44 total
──────────────────────────────────────────────────────────────────────
  44 passed   0 failed   0 warned   0 skipped
```

Exit code: `0` on all pass, `1` if any failures.

### 11.4 Last verified run

- **Date**: 2026-04-13
- **Environment**: Docker compose stack, haystack-chatqna container
- **Result**: **44 / 44 passing**
- **Issues found and fixed during verification**:
  1. ArcadeDB treats `end` and `at` as reserved SQL keywords — renamed query parameters and audit columns to `end_at`, `logged_at`, `push_action`, `dhis2_response`
  2. `INSERT ... SET a=:a, b=:b, ...` with many columns fails in ArcadeDB — switched to `INSERT ... CONTENT {json}` which always works
  3. `AsyncIOScheduler` requires an async event loop — switched to `BackgroundScheduler` which works in both sync and async contexts

---

## 12. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `/dhis2/config` shows `auth_method: "none"` | No `DHIS2_USERNAME/PASSWORD` and no `DHIS2_API_TOKEN` in env | Set one of these and restart the container |
| `/dhis2/metrics/today` returns all zeros | No consultations in ArcadeDB for today, OR region not resolvable | Check that test patients have a `region` field; check ArcadeDB `ConsultationRecord` count |
| Dry-run `warnings: ["no DHIS2 orgUnit for region 'X'"]` | Region missing from `DHIS2_ORG_UNIT_MAP` | Add the region key → orgUnit UID to the JSON env var |
| Dry-run `warnings: ["no DHIS2 dataElement for metric 'Y'"]` | Metric missing from `DHIS2_DATA_ELEMENT_MAP` | Add the metric key → dataElement UID to the JSON env var |
| Push returns `401 Unauthorized` | Wrong credentials | Re-check username/password with MoH admin; regenerate PAT if using token auth |
| Push returns `409 Conflict` | User lacks `F_DATAVALUE_ADD` on the target orgUnit | Grant orgUnit access in DHIS2 User Management |
| Push returns `400 Bad Request` | Data element UID wrong or value type mismatch | Verify UIDs in DHIS2 Maintenance app; ensure dataElement value type is `Integer` |
| `pushed: false, reason: "nothing to push"` | All metric counts = 0 | Expected when AMINA has no traffic yet — use dry-run to verify the pipeline works |
| `response: {"error": "connection refused"}` | DHIS2 URL unreachable from AMINA network | Check firewall / Tailscale / VPN between AMINA and DHIS2 servers |
| Scheduler not starting — `no running event loop` | Using `AsyncIOScheduler` in sync context | Use `BackgroundScheduler` (already fixed in current codebase) |
| Audit log not writing — `mismatched input ','` | ArcadeDB reserved word in column name | Use `INSERT ... CONTENT {json}` form (already fixed in current codebase) |
| Tracker push fails with "TEI_TYPE_ID not configured" | `DHIS2_TRACKER_*` env vars missing | Complete Phase 2.3 env vars or leave `DHIS2_TRACKER_ENABLED=false` |
| Tracker push fails with "patient has not consented" | Patient record missing `share_with_dhis2=true` | Use `force=true` for admin override, OR add the consent field to the PatientVertex |

---

## 13. Roadmap

### 13.1 Completed

- **Phase 1** (aggregate push, cron, retry queue, Prometheus, failure alerts, audit log, admin UI)
- **Phase 2.1** (FHIR R4 output layer — 5 resource types + full Bundle + CapabilityStatement)
- **Phase 2.2** (rule-based ICD-10 coder with negation detection)
- **Phase 2.3** (DHIS2 Tracker patient-level push — TEI + enrollment + events, consent-gated)
- **Sanity test** (44/44 passing — backend, HTTP, direct Python, Redis, ArcadeDB, scheduler)

### 13.2 Next — Phase 2 continued

| # | Item | Effort | Unlocks |
|---|------|:------:|---------|
| 2.4 | PHI de-identification pipeline (microsoft/presidio) | 2 weeks | Scrub names/phones/addresses before Tracker push |
| 2.5 | Consent management UI + audit | 1 week | Patient-level `share_with_dhis2` toggle, consent version history |
| 2.6 | Bi-directional sync (pull DHIS2 referrals into AMINA) | 2 weeks | CHWs book visits in DHIS2 → show up in AMINA caregiver portal |
| 2.7 | DHIS2 Android Capture offline compatibility | 3 weeks | Offline CHWs can sync AMINA data on reconnect |
| 2.8 | SNOMED CT + LOINC mapping layer | 2 weeks | WHO SMART Guidelines compliance |
| 2.9 | WHO SMART Guidelines FHIR Implementation Guide | 3 weeks | Globally recognized compliance badge |
| 2.10 | Patient-level Tracker audit log vertex | 1 week | Regulatory traceability per-patient-push |

### 13.3 Phase 3 — beyond the gold standard

Candidates for differentiation (pick 2-3 to prioritize):

- **Outbreak detection layer** — real-time symptom clustering → DHIS2 surveillance alerts
- **Predictive NCD forecasting** — ML model → DHIS2 dashboard tile "AMINA Forecast"
- **Voice-first DHIS2 reporting** — CHWs speak Mandinka → STT → ICD-10 → DHIS2 event
- **Offline-first with CRDT sync** — llama.cpp on-device + encrypted CRDT queue
- **Digital twin of each CHW panel** — burnout signals surfaced in DHIS2
- **Real-time emergency dispatch bridge** — AMINA EMERGENCY → DHIS2 + ambulance API + SMS
- **FHIR Bulk Data `$export`** — research-grade cohort handoff
- **Semantic query over DHIS2 + AMINA** — GraphQL facade with embedding search
- **Wearable / IoT integration** — Open mHealth schema → DHIS2 observations

None of Phase 3 is required for production deployment; it is differentiation and research-grade work.

---

## Appendix A — Glossary

| Term | Meaning |
|------|---------|
| **DHIS2** | District Health Information System 2 — the Gambia MoH's core Health Information System. Open source, used in 80+ countries |
| **FHIR R4** | HL7 Fast Healthcare Interoperability Resources, Release 4. The global standard for clinical data exchange |
| **TEI** | Tracked Entity Instance — DHIS2's term for a patient record in the Tracker module |
| **dataValueSet** | A DHIS2 payload of aggregate data values (many dataElements × orgUnits × periods) |
| **dataElement** | A DHIS2-side definition of a single metric (e.g. "Hypertension cases") |
| **orgUnit** | A DHIS2 organisational unit — typically a region, district, or health facility |
| **ICD-10** | WHO International Classification of Diseases, version 10 |
| **SNOMED CT** | Systematized Nomenclature of Medicine — Clinical Terms. Finer-grained than ICD-10 |
| **LOINC** | Logical Observation Identifiers Names and Codes — standardized lab result codes |
| **WHO PEN** | WHO Package of Essential Noncommunicable Disease Interventions — clinical protocol for primary care |
| **SAM / MAM** | Severe / Moderate Acute Malnutrition |
| **CHW** | Community Health Worker |
| **PHI** | Protected Health Information |

---

## Appendix B — File change history

| Date | Change | Files |
|------|--------|-------|
| 2026-04-13 | Phase 1 initial implementation (aggregate push) | `dhis2_sync.py`, `dhis2_routes.py`, `config.py`, `main.py` |
| 2026-04-13 | Phase 1 polish (scheduler, retry, Prometheus, alerts, audit, admin UI) | `dhis2_sync.py`, `Dhis2SyncPanel.jsx`, `AdminDashboard.jsx`, `caregiver_alerts.py`, `amina_agent.py` |
| 2026-04-13 | Phase 2.1 FHIR R4 output layer | `fhir_mapper.py`, `fhir_routes.py` |
| 2026-04-13 | Phase 2.2 ICD-10 coder | `icd10_coder.py` |
| 2026-04-13 | Phase 2.3 Tracker API integration | `dhis2_tracker.py`, `dhis2_routes.py` (tracker endpoints) |
| 2026-04-13 | Sanity test suite created + 44/44 passing | `sanity_test_dhis2_fhir.py` |
| 2026-04-13 | ArcadeDB reserved-word fixes + `BackgroundScheduler` swap | `dhis2_sync.py` |
| 2026-04-13 | This document | `docs/DHIS2_INTEGRATION.md` |

---

*AMINA Care Programme · Ministry of Health, Republic of The Gambia · April 2026*
