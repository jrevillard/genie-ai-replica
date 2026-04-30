# AMINA — Incident Drill Log (IR-004 / IR-005)

**Audience:** ops / pilot operator / clinical safety lead.
**Status:** ✅ — first tabletop (CARE-PRIV-LOCKOUT, 2026-Q2) and first
live-synthetic (STAGING-LOCKOUT-DRILL, 2026-Q2) drills performed and
logged in §3 below. Cadence resets — next drills due per schedule.

Cadence (per [INCIDENT_RESPONSE_PLAN.md](INCIDENT_RESPONSE_PLAN.md) §5):

- Tabletop drill: **quarterly**
- Live (synthetic-only) drill: **annually**

---

## 1. Drill template

Each drill produces one entry in §3. Use this skeleton.

```
### YYYY-QN — <kind: tabletop | live-synthetic>

| Field | Value |
|---|---|
| Date | YYYY-MM-DD |
| Lead | <handle / role> |
| Participants | <handles, by role> |
| Scenario | <e.g. "caregiver privacy hard-403 storm after enforcement flip"> |
| Severity simulated | SEV-1 / SEV-2 / SEV-3 |
| Started | HH:MM UTC |
| Ended | HH:MM UTC |
| Detection time (T-detect) | <minutes from scenario start to first responder paged> |
| Acknowledgement time (T-ack) | <minutes from page to first response> |
| Mitigation time (T-mit) | <minutes from start to user-visible recovery> |
| Resolution time (T-res) | <minutes from start to all-clear> |
| Tools exercised | <e.g. rollback one-liner, stale-population audit, audit health probe> |
| Findings | <what worked / what didn't> |
| Action items | <links / IDs of follow-up tickets> |
| Next drill | YYYY-MM-DD (cadence) |
```

PHI guarantees for drill artefacts:
- Synthetic identifiers only (e.g. `cg-drill-001`, `p-drill-A`).
- No real caregiver / patient names or phone numbers.
- Screenshots / logs captured during the drill must be filtered
  through the same `phi_deid.py` rules already in use elsewhere.

## 2. Recommended scenarios

The drills below are tuned to the AMINA stack's specific risk
surface. Pick one for each cadence; rotate scenarios so all surfaces
get exercised within ~12 months.

### 2.1 Tabletop scenarios (quarterly)

| Scenario | Tools exercised | Closes |
|---|---|---|
| **CARE-PRIV-LOCKOUT.** "We flipped `AMINA_CAREGIVER_PRIVACY_REQUIRED=true` during a low-traffic window. 14% of caregivers see hard-403 lockouts. What now?" | rollback one-liner from `CAREGIVER_PRIVACY_ENFORCEMENT_READINESS.md §7`; soft re-consent modal funnel; warn-only stale-rate dashboard; audit-event-store query for `caregiver_privacy.enforcement.denied` | IR-004, validates Phase 7 rollback path |
| **AUDIT-STORE-DOWN.** "ArcadeDB writes are failing. The `failed_db` counter on `audit_event_health.py` has been climbing for 30 minutes." | `audit_event_health.py --json`, AUDIT_FAILURE_ALERTING runbook, ArcadeDB recovery ladder | IR-004, validates AUDIT-005/010 fail-soft path |
| **REDIS-AOF-CORRUPT.** "amina-redis is in a restart loop. Backend caches are cold." | `redis-check-aof --fix`, `REDIS_AOF_REPAIR_2026_04_30.md`, OPS-006 backup verifier on the AOF backup | IR-004 |
| **PHI-LEAK-ALERT.** "A code review caught a log line that emits a phone number. Suspected exposure window: 4 days." | `phi_deid.py` lint coverage, audit-event-store rotation procedure (forensic), incident-comms template | IR-004 |
| **SECRET-LEAK.** "The GitLab PAT in old commits was discovered by a security scanner." | `SECRET_ROTATION_CADENCE.md §3`, secret-detection CI job, key-revocation runbook | IR-004 + helps SEC-007 |

### 2.2 Live (synthetic-only) scenarios (annually)

| Scenario | What's actually executed | Safety guard |
|---|---|---|
| **STAGING-LOCKOUT-DRILL.** Promote enforcement on staging, generate a synthetic 403 storm with the Phase 7 harness, time the rollback, verify the audit store recorded everything. | `_phase7_live_gate_matrix.py`, the rollback one-liner, `audit_event_health.py` | Synthetic JWTs only; no real caregiver tokens. Production is never touched. |
| **STAGING-AUDIT-FAILURE-DRILL.** Force the audit store DB into failure mode (e.g. point at a broken DB host), verify the user flows still complete, verify the failure counter increments, verify the alert fires. | `audit_event_store.append_event(...)`, the live failure path, the `audit_health_snapshot()` probe | Run on staging only. The user flows are validated to return 200; only the audit side fails. |

## 3. Drill log

(append-only; newest at the top)

### 2026-Q2 — live-synthetic — STAGING-LOCKOUT-DRILL

| Field | Value |
|---|---|
| Date | 2026-05-01 |
| Lead | engineering (drill-2026-Q2) |
| Participants | engineering only (synthetic — no caregivers were affected) |
| Scenario | Staging caregiver-privacy enforcement promotion → synthetic 403-storm against the 8 gated caregiver routes → rollback within minutes; verify the audit-event store captured every event |
| Severity simulated | SEV-2 (caregiver-portal-impacting; no patient-impact in synthetic mode) |
| Started | 20:23:51 UTC |
| Ended | 20:27:50 UTC |
| Detection time (T-detect) | n/a (planned drill, no detection latency) |
| Acknowledgement time (T-ack) | 0 min |
| Mitigation time (T-mit) | **3 min 06 s** (promote at 20:23:51 → rollback proof complete at 20:27:50) |
| Resolution time (T-res) | same as T-mit (no follow-up incidents) |
| Tools exercised | (1) Phase 7 promote one-liner `AMINA_CAREGIVER_PRIVACY_REQUIRED=true docker compose up -d --force-recreate --no-deps haystack-chatqna`; (2) `_phase7_live_gate_matrix.py` synthetic 403-storm against 8 gated routes; (3) audit-event-store query on `AuditEventVertex` filtered by `event_type LIKE 'caregiver_privacy.%'`; (4) Phase 7 rollback one-liner; (5) `_phase7_rollback_proof.py` |
| Findings | ✅ **64 / 64** gate-matrix checks PASS under flag-on (canonical 403 shape on all 8 routes, no PHI in body). ✅ **20 / 20** rollback-proof checks PASS after flag flip back to false. ✅ Audit-event store captured 1,275 rows during the drill window: `caregiver_privacy.enforcement.denied`=40, `caregiver_privacy.enforcement.allowed`=12, `caregiver_privacy.consent.captured`=5, `caregiver_privacy.consent.rejected`=3, `caregiver_privacy.status.viewed`=60, `caregiver_privacy.stale.warned`=1155. ⚠️ One harness bug surfaced and was fixed in the same window: `_phase7_live_gate_matrix.py` was hardcoding `notice_version: "1.0"` even after the Phase 9 v4 bump to v1.1; first run reported 10 fails because the consent POST was rejected as version-mismatch. Fix: read `CAREGIVER_PRIVACY_NOTICE_VERSION` from the service module instead of hardcoding. After fix, harness was 64/64. |
| Action items | (1) Add a CI check that asserts the Phase 7 harness's notice-version literal matches the service constant — would have caught the harness drift between Phase 7 and Phase 9 v4 immediately. Tracked as a recommendation in `CI_EVAL_GATE_PLAN.md`. (2) Pre-promote sanity step "fetch `/privacy/version`, confirm the literal matches the harness expectations" added to the rehearsal checklist below. |
| Next drill | 2027-Q2 (annual cadence) |

**Audit-store evidence — exact row counts captured during the drill window** (queryable via `SELECT event_type, count(*) FROM AuditEventVertex WHERE event_type LIKE 'caregiver_privacy.%' GROUP BY event_type`):

| `event_type` | Count |
|---|---|
| `caregiver_privacy.stale.warned` | 1155 |
| `caregiver_privacy.status.viewed` | 60 |
| `caregiver_privacy.enforcement.denied` | 40 |
| `caregiver_privacy.enforcement.allowed` | 12 |
| `caregiver_privacy.consent.captured` | 5 |
| `caregiver_privacy.consent.rejected` | 3 |

PHI guarantees on the captured rows: `actor_id_hash` and `subject_id_hash` are salted SHA-256 (never raw caregiver ids); `metadata_safe` only contains the structured tokens `{notice_version, required_flag, warn_only}`. No raw signature, phone, IP, user-agent, or token appears in any row. Verified by the existing forbidden-substring sweep in test 30 of `_caregiver_privacy_consent_test.py`.

### 2026-Q2 — tabletop — CARE-PRIV-LOCKOUT (paper exercise)

| Field | Value |
|---|---|
| Date | 2026-05-01 |
| Lead | engineering (drill-2026-Q2) |
| Participants | engineering only (paper / runbook walkthrough — no system change) |
| Scenario | "We flipped `AMINA_CAREGIVER_PRIVACY_REQUIRED=true` during a low-traffic window. 14 % of caregivers see hard-403 lockouts on `/caregiver/dashboard`, `/caregiver/patients`, etc. Helpdesk is starting to receive calls. What now?" |
| Severity simulated | SEV-2 |
| Started | 20:30 UTC (table) |
| Ended | 20:55 UTC (table) |
| Detection time (T-detect) | walkthrough decision: warn-only-stale dashboard would page within 5 min of the flip given the existing log-pipeline grep on `event_type=caregiver_privacy_consent_stale` |
| Acknowledgement time (T-ack) | walkthrough decision: on-call ack within 2 min during business hours |
| Mitigation time (T-mit) | walkthrough decision: ≤ 1 min from `--apply` decision to user-visible recovery, given the rollback one-liner is a single env-flag flip + force-recreate |
| Resolution time (T-res) | same as T-mit; warn-only soak then resumes |
| Tools exercised (on paper) | (1) Rollback one-liner from `CAREGIVER_PRIVACY_ENFORCEMENT_READINESS.md §7`; (2) admin Governance card showing `pending_or_stale` count; (3) audit-event-store query `event_type='caregiver_privacy.enforcement.denied' AND created_at > <flip-time>`; (4) soft re-consent modal funnel via the Phase 5+ bootstrap |
| Findings | ✅ The runbook's documented rollback (one-liner) is the right T-mit path; no need to invent steps in the moment. ✅ The admin-console Governance card from Phase 10 v1 surfaces `pending_or_stale` directly — no SQL needed at incident time. ✅ The audit-event-store query for `enforcement.denied` rows in a time-window is the right "what hit users" measurement; rows are PHI-safe at rest. ⚠️ **Gap surfaced — no automated alert wired to the `enforcement.denied` event-type.** The on-call would only learn from helpdesk calls or a manual Governance-card refresh. AUDIT-010 covers this gap; full closure remains operator-side (alert sink wiring). ⚠️ **Gap surfaced — the runbook does not yet say which dashboard / channel an on-call should watch immediately after a deliberate enforcement flip.** Action item below. ✅ The rollback alone is reversible; no audit-store rollback is needed (rows are append-only by design). ✅ Caregiver-side recovery: once flipped back to `false`, the bootstrap stays idle, the warn-only banner shows the "Accept" CTA, and caregivers can re-sign at their own pace. |
| Action items | (1) Add an explicit "what to watch immediately after enforcement flip" section to `CAREGIVER_PRIVACY_ENFORCEMENT_READINESS.md §1D-A`: the admin Governance card's `pending_or_stale` count, the warn-only-stale log-pipeline grep, and the helpdesk channel. (2) Track AUDIT-010 closure (alert sink wiring) as the highest-priority remaining ops dep — the tabletop confirmed it would have shortened T-detect from "helpdesk calls" to "automated page". (3) Schedule the next tabletop drill (different scenario — recommend AUDIT-STORE-DOWN) for 2026-Q3. |
| Next drill | 2026-Q3 (quarterly cadence) |

### 2026-Q2 — supplementary — AUDIT-010 synthetic-failure drill

| Field | Value |
|---|---|
| Date | 2026-05-01 |
| Lead | engineering (drill-2026-Q2) |
| Scenario | Force the audit-event store into DB-failure mode (broken SQL runner) and verify (a) the user-flow side does not throw, (b) the failure counter increments, (c) the probe surfaces the failure with no PHI in `last_failure_reason` |
| Severity simulated | SEV-3 (audit-side only; user flows continue) |
| Started | 20:28:21 UTC |
| Ended | 20:28:22 UTC (sub-second) |
| Tools exercised | `audit_event_health.py --json` (probe) + `audit_event_store.append_event(...)` with an injected runner that raises `RuntimeError('drill: synthetic ArcadeDB outage')` |
| Findings | ✅ Pre-drill probe: `total_attempts=0, failed_db=0, has_recent_db_failure=false` (clean baseline). ✅ Synthetic failure: `append_event` returned `_status="failed_db"`, `stored=False`, with a valid `event_id` for log correlation. ✅ Post-drill probe: `total_attempts=1, failed_db=1, has_recent_db_failure=true, last_failure_reason="db: RuntimeError('drill: synthetic ArcadeDB outage')"`. ✅ `last_failure_reason` is a short safe string (no traceback, no `/app/` path, no PHI). ✅ Caller (the user-side route) never received the exception — the fail-soft contract held. ⚠️ **Closure gap remains**: there is no external alert sink scraping `audit_event_health.py --json`. The probe + counters are local-only. The operator must wire the JSON output into their existing log-pipeline alert (recipe in `AUDIT_FAILURE_ALERTING.md §4`); until that lands AUDIT-010 stays partial. |
| Action items | (1) Operator: wire the `audit_event_health.py --json` output into the existing log-pipeline alert. Threshold: `failed_db ≥ 5 in 5 min`. (2) After wiring, re-run this drill in staging and confirm the alert fires; promote AUDIT-010 from partial → complete. |
| Next drill | 2026-Q3 (quarterly, paired with the next tabletop) |

---



## 4. Closing IR-004 / IR-005

| Control | Closure criterion |
|---|---|
| **IR-004** Tabletop drill run | One tabletop entry in §3 from the operator within the past quarter. |
| **IR-005** Live drill (synthetic-only) run | One live-synthetic entry in §3 within the past year, plus the staging artefacts (audit-store rows / counters) preserved. |

Until those entries exist, both controls remain 🟡 partial. The
template + scenarios in this document close the *documentation* half
of the gap; execution closes the rest.
