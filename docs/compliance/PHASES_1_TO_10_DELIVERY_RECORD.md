# AMINA Caregiver Privacy Policy — Phases 1 → 10 Delivery Record

**Audience:** auditor, MOH liaison, ministry counsel, pilot operator, engineering lead.
**Status as of this writing:** 🟡 YELLOW — dev/staging-validated end-to-end; production enforcement still gated on the production stale-population audit at notice version `1.1`.
**Branch:** `Health-AminaCare-branch`
**Compliance package version:** `compliance-v1.2-2026-05-01`
**Overall compliance score:** **7.91 / 10** (47 complete · 24 partial · 4 gap)

This document is the single auditor-readable record of every change
shipped across the AMINA caregiver privacy work, from the first
content module through the latest admin-console UX fix. It covers:

1. [Phase-by-phase delivery](#1-phase-by-phase-delivery)
2. [Audit-event store and structured logs](#2-audit-event-store-and-structured-logs)
3. [Incident drill log + real incidents](#3-incident-drill-log--real-incidents)
4. [Compliance scorecard trajectory](#4-compliance-scorecard-trajectory)
5. [Production rollout gates still open](#5-production-rollout-gates-still-open)
6. [Files changed (cumulative)](#6-files-changed-cumulative)
7. [Forward roadmap](#7-forward-roadmap)

Every section cites actual file paths, test counts, drill timings,
and structured-audit row counts. No real PHI / secrets / production
data appears in this record.

---

## 1. Phase-by-phase delivery

### Phase 1 — Caregiver privacy notice content module
**Goal:** establish the canonical, version-controlled source of truth for the caregiver-facing privacy notice.

**Delivered:**
- [components/frontend/src/content/CAREGIVER_PRIVACY_NOTICE.js](../../components/frontend/src/content/CAREGIVER_PRIVACY_NOTICE.js)
- 8 body sections (scope, governing law, data classes, your responsibilities, prohibited actions, consequences, your-own-data, role-specific obligations).
- `CAREGIVER_PRIVACY_NOTICE_VERSION = "1.0"` constant — exported and consumed by every downstream surface (wizard, reconsent, portal, backend validation).
- Five required acknowledgements (`understand_confidential`, `accept_responsibility`, `understand_consequences`, `agree_delete_on_removal`, `acknowledge_audit`).
- `CONSENT_WITHDRAWAL_NOTICE`, `CROSS_BORDER_NOTICE`, `MINOR_HANDLING_POLICY` constants.
- Mandinka summary placeholder (flagged for native-speaker review before pilot).
- `// TODO: confirm exact Article references with MOH legal counsel` markers throughout — no Article numbers inlined.

**Legal framing:** The Gambia Personal Data Protection and Privacy Act, 2025 + Constitution Section 23 + ECOWAS Supplementary Act on Personal Data Protection. No invented legal references.

### Phase 2 — Backend caregiver consent storage + routes
**Goal:** durable, versioned, immutable record of caregiver acceptance.

**Delivered:**
- [haystack-stack/haystack-chatqna/src/services/caregiver_privacy_consent.py](../../haystack-stack/haystack-chatqna/src/services/caregiver_privacy_consent.py)
- ArcadeDB `CaregiverConsentRecord` vertex with safe-fields-only schema — never stores raw signature, raw guardian signature, phone, IP, or user-agent.
- Service surface: `validate_consent_payload`, `record_consent` (idempotent insert), `find_current_consent`, `has_current_consent`, `emit_audit_log`, `check_caregiver_consent_or_raise`, `ensure_caregiver_privacy_schema`.
- 3 routes:
  - `POST /api/v1/caregiver/privacy/consent` — submit acceptance
  - `GET /api/v1/caregiver/privacy/status` — current acceptance state
  - `GET /api/v1/caregiver/privacy/version` — public version probe
- `AMINA_CAREGIVER_PRIVACY_REQUIRED` env flag (default `false`) — enforcement gate.
- Structured audit-log line on capture (7 safe fields: `caregiver_id`, `consent_version`, `policy_version`, `role`, `accepted_at`, `method`, `required_flag`).

### Phase 3 — Standalone `CaregiverPrivacyConsentStep` component
**Goal:** reusable React component implementing the notice + acknowledgements + signature capture.

**Delivered:**
- [components/frontend/src/CaregiverPrivacyConsentStep.jsx](../../components/frontend/src/CaregiverPrivacyConsentStep.jsx)
- Scrollable notice body (sticky scroll-unlock — once you reach the bottom, the acknowledgement section unlocks).
- Mandinka summary toggle (sticky-once-seen).
- 5 acknowledgement checkboxes with the exact ids from `CAREGIVER_PRIVACY_NOTICE.js`.
- Digital-signature input — must match the registered name (case-insensitive).
- Guardian-consent + guardian-signature fields (rendered for the `scout` role only).
- `disabled={true}` mode for read-only review.
- Privacy posture: never console.logs the signature, the consent payload, or any PHI.

### Phase 4 — Wizard integration
**Goal:** wire the privacy step into the caregiver signup wizard (deferred-submit pattern).

**Delivered:**
- [components/frontend/src/components/CaregiverRegistrationWizard.jsx](../../components/frontend/src/components/CaregiverRegistrationWizard.jsx) — privacy step rendered as Step 4. `onComplete(payload)` stashes the body locally; the wizard then includes the privacy payload in its `/caregiver-v2/register` POST. This is the only signing flow that POSTs through a different endpoint than `/privacy/consent`.
- Read-only "View full notice again" modal in the wizard's review step using the same component with `disabled=true`.

### Phase 5 — Re-consent bootstrap + warn-only middleware
**Goal:** non-blocking observability for stale caregivers.

**Delivered:**
- [components/frontend/src/CaregiverPrivacyReconsentBootstrap.jsx](../../components/frontend/src/CaregiverPrivacyReconsentBootstrap.jsx) — self-mounting React root that polls `cg_token`, calls `/privacy/status`, opens a modal if stale.
- [haystack-stack/haystack-chatqna/src/services/caregiver_privacy_warn.py](../../haystack-stack/haystack-chatqna/src/services/caregiver_privacy_warn.py) — ASGI middleware that emits `event_type=caregiver_privacy_consent_stale` log lines + adds `X-Caregiver-Privacy-Stale: true|false` response header. Always pass-through, never blocks.
- Two independent flags: `AMINA_CAREGIVER_PRIVACY_REQUIRED` (default `false`) and `AMINA_CAREGIVER_PRIVACY_WARN_ONLY` (default `true`).

### Phase 5.5 — Risk review
**Goal:** independent review of Phase 5 before any enforcement work.

**Delivered:**
- [docs/compliance/CAREGIVER_PRIVACY_PHASE5_RISK_REVIEW.md](CAREGIVER_PRIVACY_PHASE5_RISK_REVIEW.md) — 🟡 YELLOW verdict.
- Identified 4 blockers (since closed): (B) JWT didn't carry `caregiver_role` (closed Phase 6.5), (C) `/privacy/status` was thin (closed Phase 6.5), (D) no route used the gate (closed Phase 6.7), and the standing population-audit blocker (still open per §5).
- Synthetic dev-DB measured **94 % stale** at v1.0 — not authoritative for production.

### Phase 6 — Caregiver portal Privacy & Data section
**Goal:** caregiver-facing view of their own consent state + access to the canonical notice.

**Delivered:**
- "Privacy & Data Responsibility" section inside the existing profile modal in [components/frontend/src/CaregiverPortal.jsx](../../components/frontend/src/CaregiverPortal.jsx).
- Status row reading from `/privacy/status` (safe fields only).
- Read-only "View Privacy Notice" modal (using `CaregiverPrivacyConsentStep disabled=true` initially; later replaced by the new stepper — see Phase 9 v3+).
- "View My Data Access Log" disabled placeholder (waiting on AUDIT-005).
- "Download My Consent Record" — JSON receipt with safe fields only, filename `amina-caregiver-consent-record.json`, format-version `1.1`.
- "Report a Data Concern" — `mailto:__PILOT_OPERATOR_EMAIL__` placeholder for operator config.

### Phase 6.5 — Enforcement-readiness fixes
**Goal:** close 3 of the 4 Phase 5.5 yellow blockers.

**Delivered:**
- `caregiver_role` JWT claim — `_caregiver_jwt(...)` mints it from the caregiver's `relationship` field. Both `/caregiver/login` and v2-flow JWTs carry it. Old records with `role=unknown` no longer get created for new acceptances.
- `/privacy/status` extended from 6 → 12 safe fields (added `checkbox_count`, `checkboxes_accepted`, `guardian_consent`, `mandinka_viewed`, `scroll_completed`, `method`).
- `downloadConsentRecord()` writes all 12 fields. Format version bumped to `1.1`.

### Phase 6.7 — Enforcement readiness
**Goal:** make the flag-flip a real lockout, with a soft-recovery UX.

**Delivered:**
- Added `dependencies=[Depends(_require_caregiver_privacy_consent)]` to **8 patient-data caregiver routes**: `/patients`, `/dashboard`, `/insights`, `/alerts`, `/chat`, `/voice-chat`, `/predictions/{patient_id}`, `/panel`. Inactive while flag is `false`.
- Frontend hard-403 receiver: [components/frontend/src/auth/caregiverConsent403Interceptor.js](../../components/frontend/src/auth/caregiverConsent403Interceptor.js) — wraps `window.fetch`, fires `amina:caregiver-consent-required` on canonical 403s.
- Stale-population audit script: [haystack-stack/haystack-chatqna/scripts/caregiver_privacy_stale_audit.py](../../haystack-stack/haystack-chatqna/scripts/caregiver_privacy_stale_audit.py) — read-only, GREEN/YELLOW/RED verdict, never selects PHI columns.

### Phase 7 — Dev/staging enforcement validation
**Goal:** prove flag-flip works end-to-end + prove rollback works.

**Delivered:**
- [haystack-stack/haystack-chatqna/_phase7_live_gate_matrix.py](../../haystack-stack/haystack-chatqna/_phase7_live_gate_matrix.py) — synthetic-JWT gate-matrix harness, **64/64 PASS** under `flag=true`.
- [haystack-stack/haystack-chatqna/_phase7_rollback_proof.py](../../haystack-stack/haystack-chatqna/_phase7_rollback_proof.py) — **20/20 PASS** confirming all 8 gated routes pass for a no-consent caregiver after rollback.
- Canonical rollback one-liner: `AMINA_CAREGIVER_PRIVACY_REQUIRED=false docker compose up -d --force-recreate --no-deps haystack-chatqna`.
- 403 detail body: `{"error", "code", "message", "notice_version", "submit_url", "status_url"}` — no PHI. Verified in test 30 of the consent suite.
- Production: **never touched**. Flag remains `false`.

### Phase 8 — Compliance docs finalization
**Goal:** make the compliance package reflect the caregiver-side completeness.

**Delivered:**
- Split `CONSENT-005` (clinical-lead reviews copy, partial) into:
  - `CONSENT-005a` — Patient/user consent model (complete)
  - `CONSENT-005b` — Caregiver consent model (complete)
- Added `CONSENT-009` — Privacy notice acknowledgment captured at caregiver signup (complete).
- Updated `PRIV-001` evidence to cover both user classes.
- New §10 "Caregiver consent" + §10.6 schema in [docs/compliance/CONSENT_MODEL.md](CONSENT_MODEL.md).
- Score: 6.72 → 6.82 ; consent domain: 8.12 → 9.00.

### Phase 9 — Compliance gap closure (operator-leverage)
**Goal:** advance every operator-side partial that wasn't blocked on external infra.

**Delivered:**
- **AUDIT-005** — append-only audit-event store: [haystack-stack/haystack-chatqna/src/services/audit_event_store.py](../../haystack-stack/haystack-chatqna/src/services/audit_event_store.py) — `append_event(...)` only, no update/delete. ArcadeDB `AuditEventVertex` with 15 safe fields. PHI guard (forbidden keys + forbidden value patterns). Fail-soft (DB failure returns structured result, never raises). Health snapshot exposes 8 in-process counters.
- **AUDIT-005 wiring** — 6 caregiver-privacy events on the caregiver-side surfaces:
  - `caregiver_privacy.consent.captured`
  - `caregiver_privacy.consent.rejected`
  - `caregiver_privacy.status.viewed`
  - `caregiver_privacy.enforcement.denied`
  - `caregiver_privacy.enforcement.allowed`
  - `caregiver_privacy.stale.warned` (from the warn-only middleware)
- **AUDIT-010** — local probe + runbook: [haystack-stack/haystack-chatqna/scripts/audit_event_health.py](../../haystack-stack/haystack-chatqna/scripts/audit_event_health.py) + [docs/compliance/AUDIT_FAILURE_ALERTING.md](AUDIT_FAILURE_ALERTING.md).
- **RET-008** central retention config (complete): [haystack-stack/haystack-chatqna/src/services/retention_policy.py](../../haystack-stack/haystack-chatqna/src/services/retention_policy.py) — 17 data classes with stable shape (10 fields each), `legal_hold_supported` first-class concept.
- **RET-004 + RET-005 + RET-007** — dry-run sweeper: [haystack-stack/haystack-chatqna/scripts/retention_sweeper.py](../../haystack-stack/haystack-chatqna/scripts/retention_sweeper.py). Never deletes by default. `--apply` requires `--i-have-read-the-dryrun` + `--expected` + drift check + legal_hold guard.
- **OPS-006** — backup verification probe: [haystack-stack/haystack-chatqna/scripts/backup_verifier.py](../../haystack-stack/haystack-chatqna/scripts/backup_verifier.py).
- **OPS-007** — secret rotation cadence: [docs/compliance/SECRET_ROTATION_CADENCE.md](SECRET_ROTATION_CADENCE.md) — 9-secret inventory, cadence, procedure, audit-event recording shape.
- **MODEL-007 / SEC-009 plan** — [docs/compliance/CI_EVAL_GATE_PLAN.md](CI_EVAL_GATE_PLAN.md) — phased ramp recipe.
- **IR-004 / IR-005 templates** — [docs/compliance/INCIDENT_DRILL_LOG.md](INCIDENT_DRILL_LOG.md) — drill template + 5 tabletop scenarios + 2 live-synthetic scenarios.
- Score: 6.82 → 7.73; +12 controls advanced (1 → complete, 11 partial → strongly evidenced).

### Phase 9 v2 — UI discoverability
**Goal:** make the caregiver privacy section easy to find from caregiver mode.

**Delivered:**
- "🔒 Privacy & Data" item in the avatar/profile dropdown.
- Auto-scroll to the Privacy section when opening from the dropdown.
- Inline "AMINA caregiver privacy notice" hyperlink in the description text.
- Scroll-affordance banner inside the read-only modal.

### Phase 9 v3 — Popup behaviour fix
**Goal:** stop the popup-spam loop. Permanent fix.

**Delivered:**
- Auto-popup now fires **only** on the canonical `amina:caregiver-consent-required` event (= enforcement-403). Plain warn-only stale stays idle — non-blocking banner instead.
- Storage key scoped: `localStorage.amina:caregiver_privacy:dismissed:<tokenHash>:<noticeVersion>` (was a single global session-only key).
- FNV-1a token hash — non-PHI disambiguator.
- Bootstrap migrated to use the new `CaregiverPrivacyStepper` (signing mode).
- Service-worker patch: scoped `gov-sw.js` cache-first to `/gov` + production-asset paths only (was capturing every JS module page-wide and serving stale code).

### Phase 9 v4 — No-sale clause + version bump
**Goal:** add the explicit no-sale / no-unauthorised-disclosure clause.

**Delivered:**
- Notice version bumped: `1.0` → `1.1` in both backend (`caregiver_privacy_consent.py`) and frontend content sources.
- New body section in [components/frontend/src/content/CAREGIVER_PRIVACY_NOTICE.js](../../components/frontend/src/content/CAREGIVER_PRIVACY_NOTICE.js) (`no_sale_no_unauthorized_disclosure`):

  > Caregivers must not sell, trade, publish, screenshot, export, copy, retain, or share patient information from AMINA except for the patient's care and only when authorised. Unauthorised use or disclosure may result in immediate removal from AMINA caregiver access, notification to the patient or their guardian, reporting to the relevant health authority or data-protection authority, and disciplinary, civil, or criminal consequences under applicable Gambian law.
- New step in [components/frontend/src/CaregiverPrivacyStepper.jsx](../../components/frontend/src/CaregiverPrivacyStepper.jsx) — guided 6-step flow (Scope · Law · Cross-border · **Confidentiality (NEW)** · Withdraw · Children) + final ack step.
- 6th acknowledgement (id `acknowledge_no_unauthorized_disclosure`):

  > I understand that I must not sell, trade, publish, screenshot, export, copy, retain, or share patient information for any unauthorised purpose, and that misuse may lead to removal of AMINA access, reporting to the relevant authority, and legal or disciplinary consequences under applicable Gambian law.
- `EXPECTED_CHECKBOX_COUNT` auto-derived 5 → 6.
- TODO markers preserved: `// TODO: confirm exact Article references with MOH legal counsel before pilot`.
- No "found guilty" wording. Enforcement language stays in "may result in" / "may be reported" / "under applicable Gambian law" form.

### Phase 10 v1 — Acceptance + admin visibility
**Goal:** turn the privacy notice into an **accepted policy** with admin oversight.

**Delivered:**
- New backend endpoint `GET /api/v1/admin/caregivers/privacy-consent-status` ([admin_routes.py](../../haystack-stack/haystack-chatqna/src/api/admin_routes.py)).
- Service function: `caregiver_privacy_consent.admin_acceptance_status(query_runner=...)`.
- Auth gate: existing `_verify_admin` (admin JWT). Live-tested: admin token → 200, caregiver token → 403, no token → 401.
- Safe-fields response: aggregate counts (total, accepted_current, pending_or_stale, acceptance_rate_pct, last_checked_at) + per-caregiver row (caregiver_id, name, role, has_current_consent, notice_version, accepted_at, record_id, method, stale_or_pending).
- **Forbidden in response (verified by test 14c):** `digital_signature`, `signature_hash`, `guardian_signature`, `phone`, `ip`, `user_agent`, `token`, `jwt`, `bearer`, checkbox prose, patient data.
- New admin console card on Governance tab: [components/frontend/src/admin/CaregiverPrivacyAcceptanceCard.jsx](../../components/frontend/src/admin/CaregiverPrivacyAcceptanceCard.jsx).
- Warn-only banner in caregiver portal now has a **primary "Accept the privacy policy"** CTA that dispatches `amina:caregiver-consent-required` → opens signing modal. Read-only review remains as secondary CTA.
- Bug found and fixed during this phase: `role_unrecognised` validation rejecting submissions when JWT carries a non-canonical specialization in the `caregiver_role` slot. Fix at the route boundary — normalise unrecognised roles to `None` (validator skips) and store `role="unknown"` rather than rejecting the submission.

### Phase 10 v1.2 — Operator-side closure pass
**Goal:** advance partials with real evidence; honest accounting on the rest.

**Delivered:**
- **IR-004** → **complete**. Tabletop drill performed 2026-05-01 against the CARE-PRIV-LOCKOUT scenario. Logged in [INCIDENT_DRILL_LOG.md §3](INCIDENT_DRILL_LOG.md). Findings (paraphrased): rollback one-liner is the right T-mit path, admin Governance card surfaces `pending_or_stale` directly, runbook has gaps (no automated alert wired to `enforcement.denied`; no "what to watch immediately after a flip" section).
- **IR-005** → **complete**. Live-synthetic drill performed 2026-05-01 (STAGING-LOCKOUT-DRILL). T-mit **3 min 06 s**. **64/64** lockout-storm + **20/20** rollback proof. **1,275 audit rows** captured during the drill. Surfaced + fixed a real bug (harness hardcoding `notice_version: "1.0"` after the v1.1 bump).
- **AUDIT-010** synthetic-failure drill — paper exercise on the health probe under simulated DB outage. Counters incremented correctly; `last_failure_reason` PHI-safe.
- **MODEL-007 / SEC-009** — `gate` stage added to `.gitlab-ci.yml` (MR-1 of the documented ramp). Runs the privacy + audit + retention + warn test suites + scorecard floor check at ≥ 7.50. Stays partial until first CI run-evidence.
- Score: 7.73 → **7.91**. incident_response domain → **10.00**.

### Phase 10 v1.3 — People → CHWs Privacy column
**Goal:** surface acceptance status inline in the caregivers table admins actually use.

**Delivered:**
- New **Privacy** column in `CaregiversTable` ([People.jsx](../../components/frontend/src/admin/sections/People.jsx)).
- `<PrivacyPill>` — green "Accepted" / amber "Pending" / muted "—" loading. `title` attribute carries safe metadata (notice version + accepted-at timestamp).
- New `useAdminApi` fetch alongside the existing 5 (60 s refresh).
- Foot summary: "Showing N caregivers · X accepted · Y pending · current notice 1.1".
- Live-verified: Fatou Jallow shows green Accepted at v1.1; the other 16 caregivers show amber Pending (matches the v1.1 bump's expected impact).

---

## 2. Audit-event store and structured logs

The Phase 9 / 10 audit work produced two parallel logging streams:

### 2.1 Per-domain plain-log lines (Phase 5+)

The warn-only middleware emits one line per stale caregiver request:
```
event_type=caregiver_privacy_consent_stale  caregiver_id=<id>  notice_version=1.1  required_flag=false  warn_only=true
```

The consent capture/withdrawal flow emits the same shape via `cpc.emit_audit_log(...)` with 7 safe keys: `caregiver_id`, `consent_version`, `policy_version`, `role`, `accepted_at`, `method`, `required_flag`. Test 10 of the consent suite pins these 7 keys and verifies no PHI leaks.

### 2.2 Append-only audit-event store (Phase 9)

[`AuditEventVertex`](../../haystack-stack/haystack-chatqna/src/services/audit_event_store.py) records the structured event types below. Captured during the IR-005 live drill on 2026-05-01:

| Event type | Count during drill window | Trigger |
|---|---:|---|
| `caregiver_privacy.stale.warned` | 1,155 | warn-only middleware on every stale caregiver request |
| `caregiver_privacy.status.viewed` | 60 | every `GET /privacy/status` call |
| `caregiver_privacy.enforcement.denied` | 40 | gated route returned canonical 403 |
| `caregiver_privacy.enforcement.allowed` | 12 | gated route passed under flag=true |
| `caregiver_privacy.consent.captured` | 5 | successful `POST /privacy/consent` |
| `caregiver_privacy.consent.rejected` | 3 | validation failure on `POST /privacy/consent` |
| **Total** | **1,275** | |

Each row stores: `event_id`, `event_type`, `actor_type`, `actor_id_hash` (salted SHA-256, never raw), `subject_type`, `subject_id_hash`, `action`, `resource`, `outcome`, `reason_code`, `request_id`, `session_hash`, `trace_id`, `created_at`, `metadata_safe` (JSON, max 4 KB). Forbidden-key + forbidden-value-pattern guard rejects/redacts any caller attempt to put a phone, signature, IP, UA, JWT, or PIN into metadata.

PHI-safety verified by tests 1–10 of [`_audit_event_store_test.py`](../../haystack-stack/haystack-chatqna/_audit_event_store_test.py) (49 PASS / 0 FAIL).

### 2.3 Local audit-failure probe (AUDIT-010)

`audit_event_health.py --json` returns the canonical 8-key shape:
```json
{
  "total_attempts":               <int>,
  "failed_db":                    <int>,
  "failed_validation":            <int>,
  "redactions":                   <int>,
  "last_failure_at":              "<ISO-8601 UTC>" | null,
  "last_failure_reason":          "<short safe string>" | null,
  "has_recent_db_failure":        <bool>,
  "has_recent_validation_failure": <bool>
}
```

`last_failure_reason` is truncated to ≤ 256 chars and verified PHI-safe (no traceback, no `/app/` path, no IP, no UA). External alert sink wiring is operator-side per [AUDIT_FAILURE_ALERTING.md](AUDIT_FAILURE_ALERTING.md).

---

## 3. Incident drill log + real incidents

### 3.1 Drills performed

All three drills logged in full in [INCIDENT_DRILL_LOG.md §3](INCIDENT_DRILL_LOG.md).

| Drill | Kind | Date | Scenario | Result |
|---|---|---|---|---|
| **STAGING-LOCKOUT-DRILL** | live-synthetic (IR-005) | 2026-05-01 | Promote enforcement on dev, simulate 403-storm against 8 gated routes, time the rollback | **64/64** lockout-storm PASS, **20/20** rollback PASS, T-mit **3 min 06 s**, 1,275 audit rows captured |
| **CARE-PRIV-LOCKOUT** | tabletop (IR-004) | 2026-05-01 | "We flipped enforcement, 14 % of caregivers see 403s, helpdesk is calling. What now?" | Runbook walkthrough surfaced 2 real gaps (no automated alert; no post-flip-watch checklist). Rollback path validated |
| **AUDIT-010 synthetic-failure** | supplementary | 2026-05-01 | Force the audit store into DB-failure mode; verify counters increment + caller doesn't raise | `failed_db=1`, `has_recent_db_failure=true`, `last_failure_reason` PHI-safe, fail-soft contract held |

### 3.2 Real incidents handled in-session

| Incident | Date | Resolution |
|---|---|---|
| **Redis AOF corruption** (`amina-redis` restart-loop, ~25 MB tail unrecoverable) | 2026-04-30 | `redis-check-aof --fix` repair on the dev volume; backup of corrupt AOF preserved. Logged in [REDIS_AOF_REPAIR_2026_04_30.md](REDIS_AOF_REPAIR_2026_04_30.md). No production impact. |
| **`gov-sw.js` cache scope leak** (service worker capturing every JS module page-wide; caregiver portal updates didn't reach browsers after deploys) | 2026-05-01 (Phase 9 v3) | Bumped SW VERSION 1 → 2 (forces stale cache delete); scoped cache-first block to `/gov/*` + precached static + production hashed bundles only. Vite dev paths skipped. |
| **`role_unrecognised` consent-submission rejection** (caregivers with non-canonical specialization strings in their JWT `caregiver_role` slot couldn't accept consent) | 2026-05-01 (Phase 10 v1) | At the route boundary, normalise non-canonical role values to `None` for the validator and store `role="unknown"` on the consent record. Submission proceeds; data-quality issue is no longer a hard failure. |
| **Phase 7 harness version-drift bug** (hardcoded `notice_version: "1.0"` after the Phase 9 v4 bump to 1.1; first IR-005 drill run produced 10 fails on consent POST) | 2026-05-01 (during IR-005 drill) | Patched the harness to read `CAREGIVER_PRIVACY_NOTICE_VERSION` from the service module instead of hardcoding. Re-ran cleanly: 64/64. |

---

## 4. Compliance scorecard trajectory

| Phase | Package version | Total | C/P/G | Overall | Δ |
|---|---|---:|---|---:|---|
| Phase 1–3 | `phase-1-3-2026-04-29` | 73 | 41 / 16 / 16 | **6.72** | baseline |
| Phase 8 | `phase-8-2026-04-30` | 75 | 44 / 15 / 16 | **6.82** | +0.10 |
| Phase 9 | `phase-9-2026-04-30` | 75 | 45 / 26 / 4 | **7.73** | +0.91 |
| **v1.2** | `compliance-v1.2-2026-05-01` | 75 | **47 / 24 / 4** | **7.91** | +0.18 |

### Per-domain at v1.2

| Domain | Score | Notes |
|---|---:|---|
| clinical_safety | **10.00** | Unchanged through the work; was already complete |
| **incident_response** | **10.00** | Phase 10 v1.2 — both drills run + logged |
| consent | **9.00** | Phase 8 split + Phase 10 v1 endpoint advanced this domain |
| audit | 7.50 | AUDIT-005 + AUDIT-010 evidence strong but partial (operator wiring) |
| model_governance | 7.50 | MODEL-007 partial — CI gate config landed, run-evidence pending |
| security | 7.22 | SEC-009 partial — CI dep-scan jobs queued |
| privacy | 6.88 | PRIV-005 (backup encryption) gap — operator-side |
| retention | 6.88 | RET-008 complete; RET-004/5/7 partial; RET-006 gap |
| operations | 6.25 | OPS-007 partial; OPS-006 partial; OPS-004 gap |

### Top 4 remaining gaps (no fake closure)

1. **OPS-004** Trace dashboard — needs OTel infra (operator-side)
2. **PRIV-005** Backups encrypted at rest — needs key management (operator-side)
3. **RET-006** Backup deletion proof — needs backup-store integration (operator-side)
4. **SEC-008** Pen test on staging — needs external vendor (operator-side)

---

## 5. Production rollout gates still open

### 5.1 The single hard gate for `AMINA_CAREGIVER_PRIVACY_REQUIRED=true`

**Run the audit on production ArcadeDB at notice version 1.1:**
```bash
docker exec haystack-chatqna python /app/scripts/caregiver_privacy_stale_audit.py \
  --notice-version 1.1 --json
```

Paste the JSON output into a new dated subsection of `CAREGIVER_PRIVACY_ENFORCEMENT_READINESS.md §5.4`.

**Verdict thresholds:**

| Stale rate | Verdict | Action |
|---|---|---|
| **< 5 %** | 🟢 GREEN | Schedule the flip with a 24 h banner |
| **5 – 20 %** (inclusive) | 🟡 YELLOW | Run a 14-day warn-only soak + soft re-consent campaign first |
| **> 20 %** | 🔴 RED | DO NOT flip. Coordinated comms / re-consent campaign required |

The Phase 9 v4 bump 1.0 → 1.1 means **every existing caregiver is currently stale relative to v1.1** until they re-acknowledge. The v1.1 audit will start near 100 % stale and decay as caregivers re-sign through the warn-only soak + the new "Accept the privacy policy" banner CTA. This is the EXPECTED behaviour of a substantive policy change.

### 5.2 Operator-side closure that would lift compliance score immediately

Two cheapest moves for ~+0.25 overall in <1 day of operator work:

1. **Push the v1.2 commit to a feature branch** + observe the first green CI gate run + observe one red run on a deliberately-regressed score → closes **MODEL-007**.
2. **Wire `audit_event_health.py --json` into the existing log-pipeline alert** (recipe in `AUDIT_FAILURE_ALERTING.md §4`) + confirm one synthetic failure fires the alert → closes **AUDIT-010** + closes the IR-004 tabletop's #1 action item.

### 5.3 Hard rules respected through every phase

- ✅ `AMINA_CAREGIVER_PRIVACY_REQUIRED` was **never flipped in production**.
- ✅ Production env files / secrets / DB / Redis: **never touched**.
- ✅ No real PHI used. All test fixtures use synthetic identities (`Fatou Example`, `Lamin Testcase`, `cg-p7-noconsent`, `cg-rb-noconsent`, etc.).
- ✅ No JWT, signature, signature-hash, phone, IP, or user-agent appears in any log line, audit row, storage key, or admin response.
- ✅ No `git commit`, `git branch`, `git push`, `git stash`, or `git add` was performed during any phase.
- ✅ No "found guilty" wording added; enforcement copy stays in "may result in" / "may be reported" / "under applicable Gambian law" form.
- ✅ No invented Article numbers. `// TODO: confirm exact Article references with MOH legal counsel before pilot` markers preserved.

---

## 6. Files changed (cumulative)

### 6.1 Backend — service modules

| File | Phases |
|---|---|
| `haystack-stack/haystack-chatqna/src/services/caregiver_privacy_consent.py` | 2 (created), 6.5 (`/status` extension + `caregiver_role` claim handling), 9 (`admin_acceptance_status`), 9 v4 (1.0 → 1.1, 6th ack id) |
| `haystack-stack/haystack-chatqna/src/services/caregiver_privacy_warn.py` | 5 (created), 9 (`audit_event_store` wiring) |
| `haystack-stack/haystack-chatqna/src/services/audit_event_store.py` | 9 (created) |
| `haystack-stack/haystack-chatqna/src/services/retention_policy.py` | 9 (created) |

### 6.2 Backend — routes

| File | Phases |
|---|---|
| `haystack-stack/haystack-chatqna/src/api/caregiver_privacy_routes.py` | 2 (created), 6.7 (`message` field on 403), 9 (audit-event wiring on consent capture/reject/status/enforcement), 10 v1 (role normalisation at route boundary) |
| `haystack-stack/haystack-chatqna/src/api/caregiver_routes.py` | 2 (created), 6.5 (JWT `caregiver_role` claim), 6.7 (`Depends(require_caregiver_privacy_consent)` on 8 routes) |
| `haystack-stack/haystack-chatqna/src/api/admin_routes.py` | 10 v1 (privacy-consent-status endpoint added) |

### 6.3 Backend — scripts + tests

| File | Phases |
|---|---|
| `haystack-stack/haystack-chatqna/scripts/caregiver_privacy_stale_audit.py` | 6.7 (created) |
| `haystack-stack/haystack-chatqna/scripts/audit_event_health.py` | 9 (created) |
| `haystack-stack/haystack-chatqna/scripts/retention_sweeper.py` | 9 (created) |
| `haystack-stack/haystack-chatqna/scripts/backup_verifier.py` | 9 (created) |
| `haystack-stack/haystack-chatqna/_caregiver_privacy_consent_test.py` | 2 (created), 6.5/6.7/7 (added tests 15–30), 9 v4 (v1.1 + 6th ack tests), 10 v1 (test 14c admin endpoint) |
| `haystack-stack/haystack-chatqna/_caregiver_privacy_warn_test.py` | 5 (created) |
| `haystack-stack/haystack-chatqna/_audit_event_store_test.py` | 9 (created) |
| `haystack-stack/haystack-chatqna/_retention_test.py` | 9 (created) |
| `haystack-stack/haystack-chatqna/_phase7_live_gate_matrix.py` | 7 (created), 10 v1.2 drill (version-drift fix) |
| `haystack-stack/haystack-chatqna/_phase7_rollback_proof.py` | 7 (created) |

### 6.4 Frontend

| File | Phases |
|---|---|
| `components/frontend/src/content/CAREGIVER_PRIVACY_NOTICE.js` | 1 (created), 9 v4 (v1.1 bump + new section + 6th ack) |
| `components/frontend/src/CaregiverPrivacyConsentStep.jsx` | 3 (created) |
| `components/frontend/src/CaregiverPrivacyStepper.jsx` | 9 v3 (created — new guided 6-step flow), 9 v4 (canonical ack ids + new step + 6th ack), 10 v1 (clickable law chips structure) |
| `components/frontend/src/CaregiverPrivacyStepper.css` | 9 v3 (created) |
| `components/frontend/src/CaregiverPrivacyReconsentBootstrap.jsx` | 5 (created), 9 v3 (refactor: only auto-pop on enforcement-403; scoped dismissal key) |
| `components/frontend/src/auth/caregiverConsent403Interceptor.js` | 6.7 (created) |
| `components/frontend/src/CaregiverPortal.jsx` | 6 (Privacy section), 9 v2 (dropdown entry + scroll), 9 v3 (warn-only banner with read-only stepper), 10 v1 (warn-only banner CTAs: signing + read-only) |
| `components/frontend/src/components/CaregiverRegistrationWizard.jsx` | 4 (privacy step wired) |
| `components/frontend/src/admin/CaregiverPrivacyAcceptanceCard.jsx` | 10 v1 (created) |
| `components/frontend/src/admin/sections/Governance.jsx` | 10 v1 (mount card) |
| `components/frontend/src/admin/sections/People.jsx` | 10 v1.3 (Privacy column on CaregiversTable) |
| `components/frontend/public/gov-sw.js` | 9 v3 (cache-scope fix) |

### 6.5 Compose / config

| File | Phases |
|---|---|
| `haystack-stack/docker-compose.override.yml` | 6.5 / 7 (bind-mounts on caregiver routes + privacy flag passthrough) |
| `.gitlab-ci.yml` | 10 v1.2 (`gate` stage MR-1) |

### 6.6 Compliance docs

| File | Phases |
|---|---|
| `docs/compliance/compliance_controls.json` | 8 (CONSENT-005 split + CONSENT-009), 9 (12 controls advanced), 10 v1.2 (IR-004/005 → complete; package version → `compliance-v1.2-2026-05-01`) |
| `docs/compliance/COMPLIANCE_CONTROL_MATRIX.md` | regenerated each phase |
| `docs/compliance/CONSENT_MODEL.md` | 8 (§10 caregiver), 9 v4 (§10.6 no-sale), 10 v1 (§10.7 acceptance + admin) |
| `docs/compliance/CAREGIVER_PRIVACY_ENFORCEMENT_READINESS.md` | 6.5 / 6.7 / 7 (created + iterated), 9 v4 (notice-version impact note) |
| `docs/compliance/CAREGIVER_PRIVACY_PHASE5_RISK_REVIEW.md` | 5.5 (created) |
| `docs/compliance/AUDIT_READINESS_CHECKLIST.md` | iterated each major phase |
| `docs/compliance/AUDIT_FAILURE_ALERTING.md` | 9 (created — AUDIT-010 runbook) |
| `docs/compliance/SECRET_ROTATION_CADENCE.md` | 9 (created) |
| `docs/compliance/CI_EVAL_GATE_PLAN.md` | 9 (created), 10 v1.2 (§5 MR-1 landed) |
| `docs/compliance/INCIDENT_DRILL_LOG.md` | 9 (template + scenarios), 10 v1.2 (3 drills logged) |
| `docs/compliance/REDIS_AOF_REPAIR_2026_04_30.md` | 2026-04-30 (created — incident note) |
| `docs/compliance/PHASE_1_3_REPORT.md` | 8 (Phase 8 addendum) |
| `docs/compliance/PHASES_1_TO_10_DELIVERY_RECORD.md` | this document |

### 6.7 Test totals (current)

| Suite | Pass / Fail (current) |
|---|---|
| `_caregiver_privacy_consent_test.py` | **169 / 0** |
| `_caregiver_privacy_warn_test.py` | 40 / 0 |
| `_audit_event_store_test.py` | 49 / 0 |
| `_retention_test.py` | 63 / 0 |
| `_agent_platform_v1_test.py` | 149 / 0 |
| `_agent_platform_v2_native_tools_test.py` | 200 / 0 |
| `_agent_platform_phase3_safety_test.py` | 157 / 0 |
| `_phase7_live_gate_matrix.py` (live HTTP) | 64 / 0 |
| `_phase7_rollback_proof.py` (live HTTP) | 20 / 0 |
| **Total** | **911 PASS / 0 FAIL** |

---

## 7. Forward roadmap

### 7.1 Operator-side, immediate (< 1 week)

| Action | Closes | Effort |
|---|---|---|
| Push v1.2 commit to feature branch + observe first green CI run | MODEL-007 | < 1 hr |
| Wire `audit_event_health.py --json` into the existing log-pipeline alert; confirm synthetic failure fires it | AUDIT-010 + IR-004 #1 action item | < 4 hr |
| Run `caregiver_privacy_stale_audit.py --notice-version 1.1 --json` against production ArcadeDB; paste verdict into readiness doc §5.4 | unblocks Phase 7 production decision | < 1 hr |

### 7.2 Operator-side, 1–4 weeks

| Action | Closes |
|---|---|
| First real `JWT_SECRET` rotation (per `SECRET_ROTATION_CADENCE.md`) + log `ops.secret.rotated` audit event | OPS-007 |
| Add `audit_event_store.py` + `retention_policy.py` to the `haystack-chatqna` Dockerfile build | AUDIT-005 (image-build half) |
| Schedule `retention_sweeper.py` on a cron (still dry-run-only initially) | RET-004 (cadence half) |
| Wire `backup_verifier.py --json` into ops cron + alert on `verdict != "fresh"` | OPS-006 |
| Land MR-2 / MR-4 / MR-5 of the CI ramp (agent-platform suites + `pip-audit` + `npm audit`) | SEC-009 |

### 7.3 Operator-side, requires external work

| Action | Closes |
|---|---|
| Backup encryption-at-rest (key management) | PRIV-005 |
| Backup-store deletion-proof writer | RET-006 |
| OTel trace dashboard | OPS-004 |
| External pen test on staging | SEC-008 |
| MOH legal counsel review of v1.1 effective date + Article references | unblocks the `// TODO` markers throughout |

### 7.4 Frontend follow-ups (engineering)

| Action |
|---|
| Migrate the Phase 4 signup wizard's privacy step from `CaregiverPrivacyConsentStep` to `<CaregiverPrivacyStepper readOnly={false} submitMode="deferred">` and retire the legacy component |
| Add `last_accepted_version` to the admin endpoint per-row response so the People-tab Privacy column can distinguish "Stale (v1.0)" from "Pending (never signed)" |
| Mandinka native-speaker review of all Mandinka strings in `CAREGIVER_PRIVACY_NOTICE.js` and `CaregiverPrivacyStepper.jsx` |
| Populate `LAW_SOURCE_URLS_DEFAULT` in `CaregiverPrivacyStepper.jsx` once legal-team-verified URLs land for the 3 governing-law chips |

---

## 8. Appendices

### 8.1 Notice version history

| Version | Effective | Major change |
|---|---|---|
| `1.0` | 2026-04-01 | Initial caregiver notice with 5 acknowledgements |
| `1.1` | 2026-05-01 | Added explicit no-sale / no-unauthorised-disclosure clause + 6th acknowledgement (`acknowledge_no_unauthorized_disclosure`); both versions retained in immutable history |

### 8.2 Read-only vs signing surfaces (current state)

| Path | Mode | Component |
|---|---|---|
| Signup wizard privacy step | signing | `CaregiverPrivacyConsentStep` (legacy; deferred-submit pattern) |
| Avatar dropdown → 🔒 Privacy & Data | read-only | `<CaregiverPrivacyStepper readOnly={true}>` |
| Inline "AMINA caregiver privacy notice" hyperlink | read-only | same |
| Warn-only banner "Review only (read-only)" | read-only | same |
| Warn-only banner "Accept the privacy policy" | signing | `<CaregiverPrivacyStepper readOnly={false}>` (via dispatched event) |
| Enforcement-403 auto-popup | signing | same |
| Initial `/privacy/status` reports `required_flag=true && has_current_consent=false` | signing | same |

### 8.3 Backend acceptance gate primitives

```python
# haystack-stack/haystack-chatqna/src/services/caregiver_privacy_consent.py
CAREGIVER_PRIVACY_NOTICE_VERSION = "1.1"
EXPECTED_CHECKBOX_IDS = (
    "understand_confidential",
    "accept_responsibility",
    "understand_consequences",
    "agree_delete_on_removal",
    "acknowledge_audit",
    "acknowledge_no_unauthorized_disclosure",
)
EXPECTED_CHECKBOX_COUNT = 6
```

### 8.4 Canonical 403 response shape

```json
HTTP/1.1 403 Forbidden
{
  "detail": {
    "error":          "consent_required",
    "code":           "caregiver_privacy_consent_required",
    "message":        "Privacy notice consent required",
    "notice_version": "1.1",
    "submit_url":     "/api/v1/caregiver/privacy/consent",
    "status_url":     "/api/v1/caregiver/privacy/status"
  }
}
```

The frontend interceptor pivots on `code` to dispatch `amina:caregiver-consent-required`; humans pivot on `message` in console output. No PHI in any field.

### 8.5 Storage keys (frontend)

| Key | Purpose | Scope |
|---|---|---|
| `localStorage.cg_token` | Caregiver auth token | per session |
| `localStorage.cg_info` | Caregiver profile (name, role) | per session |
| `localStorage.amina:caregiver_privacy:dismissed:<tokenHash>:<noticeVersion>` | Phase 9 v3 — re-consent modal dismissal flag | scoped to caregiver + version; persists across browser restarts; auto-invalidates on notice-version bump |
| `window.__aminaCaregiverReconsentMounted` | Bootstrap idempotency flag | per page-load |
| `window.__aminaCgConsent403InterceptorInstalled` | 403-interceptor idempotency flag | per page-load |
| `window.AMINA_LAW_SOURCE_URLS` (optional) | Operator override for law-source URLs | runtime config |

No raw caregiver name, phone, signature, token, or consent payload is ever written to any of these keys.

### 8.6 Audit-event types currently emitted

| Event type | Origin | Actor type |
|---|---|---|
| `caregiver_privacy.consent.captured` | `POST /privacy/consent` (success) | caregiver |
| `caregiver_privacy.consent.rejected` | `POST /privacy/consent` (validation fail) | caregiver |
| `caregiver_privacy.status.viewed` | `GET /privacy/status` | caregiver |
| `caregiver_privacy.enforcement.denied` | gate dependency raises 403 | caregiver |
| `caregiver_privacy.enforcement.allowed` | gate dependency passes (flag=true only) | caregiver |
| `caregiver_privacy.stale.warned` | warn-only middleware on stale request | system |

Future event types (queued in roadmap): `ops.secret.rotated`, `admin.route.access`, `auth.login`, `auth.failure`, `dhis2.push`, `retention.delete`, `data_rights.export`.

---

## 9. Sign-off

This document is current as of **2026-05-01**. It will be re-issued
when:

- the production stale-population audit at v1.1 returns its first
  verdict (the verdict + acceptance-rate trajectory get appended to
  §5);
- MOH legal counsel signs off on the v1.1 effective date and the
  exact Article references currently flagged with `// TODO`;
- the next phase ships (likely Phase 11 — production enforcement
  go/no-go).

The compliance package itself
([compliance_controls.json](compliance_controls.json)) remains the
machine-readable source of truth; this document is the
human-readable narrative that ties every phase together.

Engineering — 2026-05-01
