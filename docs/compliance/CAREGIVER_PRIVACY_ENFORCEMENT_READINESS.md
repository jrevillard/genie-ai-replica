# Caregiver Privacy — Enforcement Readiness

**Status:** 🟡 **YELLOW — dev/staging enforcement validated end-to-end, production flip still gated on stale-population measurement.**
**Branch:** `Health-AminaCare-branch`
**Last update:** 2026-04-30 (Phase 7 dev/staging validation)
**Enforcement flag state:** `AMINA_CAREGIVER_PRIVACY_REQUIRED=false` in production (Phase 7 only flipped the flag in dev for ~5 min during validation; rolled back).

> **Phase 7 (this revision) validates enforcement end-to-end in
> dev/staging.** The gate-matrix harness, rollback proof, and runbook
> below all pass on the dev container with synthetic JWTs. Production
> remains untouched. The remaining gate is the **production
> stale-population measurement** (§5).

---

## 1. What Phase 6.5 fixed

Two of the three Phase 5.5 yellow blockers and one Phase 6 follow-up
were resolved in this phase. Enforcement readiness is now improved on
those three points; the fourth (population stale rate) remains the
critical gate before Phase 7 ships.

### Fix A — `caregiver_role` JWT claim (Phase 5.5 Blocker B)

| | Before Phase 6.5 | After Phase 6.5 |
|---|---|---|
| `caregiver_routes.py:_caregiver_jwt(...)` payload | `{ sub, phone, name, role: "caregiver", patient_id, permissions, iat, exp }` | + `caregiver_role: <relationship-or-empty>` claim |
| Both call sites updated | n/a | `register_caregiver` passes `body.relationship.value`; `login_caregiver` passes `cg.get("relationship")` |
| `caregiver_privacy_routes.py:140` reads `caregiver.get("caregiver_role")` | always empty → `role="unknown"` denormalised onto every CaregiverConsentRecord | reads the real claim → record's `role` field stores `"spouse"`, `"vhw"`, `"chw"`, etc. |
| Existing `role: "caregiver"` auth-class claim | unchanged | unchanged — auth still passes |

End-to-end verified: minted JWT with `caregiver_role="vhw"` → POSTed
to `/api/v1/caregiver/privacy/consent` → new record stored
`role: "vhw"` (not `"unknown"`) → `/privacy/status` returned `role: "vhw"`.

### Fix B — `/api/v1/caregiver/privacy/status` extended response

The `CaregiverConsentStatus` Pydantic model went from 6 fields to **12
safe fields**. New fields surface the wizard-emitted telemetry that
Phase 2 already persisted on every CaregiverConsentRecord:

| Field | Source | Safe to surface? |
|---|---|---|
| `notice_version` | constant | ✅ existing |
| `accepted_at` | row | ✅ existing |
| `role` | row | ✅ existing (now correct after Fix A) |
| `has_current_consent` | derived | ✅ existing |
| `record_id` | row | ✅ existing — opaque audit key |
| `required_flag` | flag | ✅ existing |
| **`checkbox_count`** | row | ✅ Phase 6.5 — integer count of acknowledgements |
| **`checkboxes_accepted`** | row | ✅ Phase 6.5 — boolean, true iff all 5 ticked |
| **`guardian_consent`** | row | ✅ Phase 6.5 — only true for under-18 scout flow |
| **`mandinka_viewed`** | row | ✅ Phase 6.5 — wizard telemetry |
| **`scroll_completed`** | row | ✅ Phase 6.5 — wizard telemetry |
| **`method`** | row | ✅ Phase 6.5 — `"app"` / `"sms"` / `"voice"` / `"operator"` |

**Explicitly NOT surfaced** (verified by test 16 in
`_caregiver_privacy_consent_test.py`):
- `digital_signature_hash` — even hashed, treated as PHI-adjacent
- `guardian_signature_hash` — same
- raw signatures (never persisted; hashed at submit)
- phone, IP, user-agent, JWT contents
- checkbox prose (only ids/counts)

When no consent exists, the response returns safe defaults
(`0`/`false`/`null`) so the shape is stable for the frontend.

### Fix C — Frontend JSON download is now a complete consent receipt

`components/frontend/src/CaregiverPortal.jsx → downloadConsentRecord()`
now consumes all 12 fields from `/privacy/status` and writes them to
`amina-caregiver-consent-record.json`. File-format version bumped to
`1.1`. Sample of the new shape:

```json
{
  "notice_version":      "1.0",
  "accepted_at":         "2026-04-30T13:50:35.263332Z",
  "role":                "vhw",
  "has_current_consent": true,
  "record_id":           "CGCONSENT-b4dca962ca0797c8",
  "required_flag":       false,
  "checkbox_count":      5,
  "checkboxes_accepted": true,
  "guardian_consent":    false,
  "mandinka_viewed":     true,
  "scroll_completed":    true,
  "method":              "app",
  "_generated_at":       "2026-04-30T13:51:00.123Z",
  "_format_version":     "1.1"
}
```

Still safe-fields-only. No PDF dependency added.

---

## 1B. What Phase 6.7 fixed

Phase 6.7 is the **enforcement-readiness pass**: it closes the three
non-population blockers from §6 of the previous revision so that the
only remaining Phase 7 gate is the production stale-population number.
Enforcement is **still off** — Phase 6.7 wires the dependency *and*
the frontend hard-403 receiver, but neither activates until the flag
is flipped.

### Fix D — caregiver-v2 wizard JWTs now carry `caregiver_role`

The Phase 6.5 fix only touched the legacy `/caregiver/login` mint.
The v2 wizard flow (`/caregiver-v2/register` → admin approves →
`/caregiver-v2/login`) was investigated and confirmed to **already**
go through the legacy `/caregiver/login` mint after activation: the
admin approval calls `_activate_caregiver` which writes a
`CaregiverVertex` carrying `relationship = registration_data.relationship
or app["role"]`, and the v2 wizard's subsequent login uses the same
`_caregiver_jwt(...)` path the legacy login uses. So **the Phase 6.5
fix already covered the v2 flow** — Phase 6.7 added two regression
tests proving every wizard taxonomy value (`vhw`, `cbc`, `scout`,
`tba`, `alkalo`) round-trips through the JWT `caregiver_role` claim
without leaking phone, signature hash, or PHI.

### Fix E — `Depends(require_caregiver_privacy_consent)` wired on 8 caregiver routes

Phase 5.5 Blocker D was: *"flipping the flag would be a silent no-op
because no route uses the gate."* Phase 6.7 wires the dependency
into every patient-data caregiver endpoint:

| Route | Method | Phase 6.7 status |
|---|---|---|
| `/api/v1/caregiver/patients` | GET | already wired in Phase 5.5 |
| `/api/v1/caregiver/dashboard` | GET | **wired** |
| `/api/v1/caregiver/insights` | GET | **wired** |
| `/api/v1/caregiver/alerts` | GET | **wired** |
| `/api/v1/caregiver/chat` | POST | **wired** |
| `/api/v1/caregiver/voice-chat` | POST | **wired** |
| `/api/v1/caregiver/predictions/{patient_id}` | GET | **wired** |
| `/api/v1/caregiver/panel` | GET | **wired** |

Routes deliberately **NOT gated** (consent / login / status routes
themselves must remain reachable, otherwise the user cannot recover):

- `/api/v1/caregiver/login`
- `/api/v1/caregiver/register`
- `/api/v1/caregiver-v2/*` (entire registration flow)
- `/api/v1/caregiver/privacy/status`
- `/api/v1/caregiver/privacy/consent`
- `/api/v1/caregiver/privacy/notice` (the notice text)

While `AMINA_CAREGIVER_PRIVACY_REQUIRED=false`, the dependency runs
on every gated request and returns the caregiver transparently — no
403, no log line, zero behavioural change. Verified live on
all 8 routes (200 OK on each). The dependency only switches to
"raise 403" mode when the flag is true.

### Fix F — Frontend hard-403 receiver

Phase 5.5 Risk #4 was: *"a user mid-flight when enforcement flips
will see an opaque error, not the re-consent modal."* Phase 6.7
ships a self-installing fetch interceptor that detects the canonical
backend 403 shape and forces the existing soft-modal open:

| Layer | File | Behaviour |
|---|---|---|
| Interceptor | `components/frontend/src/auth/caregiverConsent403Interceptor.js` (new) | Wraps `window.fetch` once. On 403 to a `/api/v1/caregiver/*` path with `detail.code === "caregiver_privacy_consent_required"`, dispatches `amina:caregiver-consent-required` on `window`. Pass-through, idempotent, never blocks, never logs PHI, never reads non-403 bodies |
| Bootstrap | `components/frontend/src/CaregiverPrivacyReconsentBootstrap.jsx` | Side-effect imports the interceptor, listens for the new event, clears the session-dismiss flag, and forces a `/privacy/status` re-fetch which surfaces the existing Phase 5 modal |

The dispatched event carries no payload — the bootstrap re-reads
`/privacy/status` for the canonical truth. Only fires when a
`cg_token` is present in localStorage, so patient/admin sessions are
unaffected.

### Fix H (Phase 7) — `message` field on the canonical 403 detail

`caregiver_privacy_routes.py:require_caregiver_privacy_consent` now
also includes `"message": "Privacy notice consent required"` in the
HTTPException detail body (alongside the existing `code`). The
frontend interceptor still pivots on `code`, but the human-readable
`message` is what surfaces in any debug-console / API-client tool a
caregiver-tier engineer might attach during an incident.

### Fix I (Phase 7) — Compose env passthrough for the enforcement flag

`docker-compose.override.yml` now exposes `AMINA_CAREGIVER_PRIVACY_REQUIRED`
and `AMINA_CAREGIVER_PRIVACY_WARN_ONLY` as `${VAR:-default}`-form
passthroughs on the `haystack-chatqna` service. This means the
canonical promote and rollback commands in §7 work without ever
permanently editing `haystack-stack/.env`. Both default to the
production-safe values (`false` / `true` respectively).

### Fix G — Stale-population audit script (read-only)

Replaces the three hand-typed SQL queries from §5 of the previous
revision with a single command that emits the same answer plus a
green/yellow/red verdict:

```bash
docker exec haystack-chatqna python /app/scripts/caregiver_privacy_stale_audit.py
docker exec haystack-chatqna python /app/scripts/caregiver_privacy_stale_audit.py --json
docker exec haystack-chatqna python /app/scripts/caregiver_privacy_stale_audit.py --notice-version 1.0
```

PHI guarantees enforced by test 24 in
`_caregiver_privacy_consent_test.py`: the script's SQL surface area
contains **only** `count(*)`, `caregiver_id`, `notice_version`, and
the table names — never `phone`, `name`, `digital_signature_hash`,
`guardian_signature_hash`, `signature`, `ip_address`, `user_agent`,
or `email`.

---

## 1C. Phase 7 — dev/staging enforcement validation results

Phase 7 promoted `AMINA_CAREGIVER_PRIVACY_REQUIRED=true` on the local
dev container, exercised the full gate-matrix end-to-end, then rolled
the flag back. **Production enforcement is still off and was never
touched.**

### Validation summary

| Block | Test | Result |
|---|---|---|
| Promotion | `AMINA_CAREGIVER_PRIVACY_REQUIRED=true docker compose up -d --force-recreate --no-deps haystack-chatqna` | ✅ container healthy in <60 s |
| Flag visibility | `GET /api/v1/caregiver/privacy/version` | `required_flag: true` |
| 8 gated routes — no consent → canonical 403 | live HTTP via `_phase7_live_gate_matrix.py` | ✅ all 8 raise 403 with `code/message/submit_url/status_url` and zero PHI |
| Consent submission | `POST /api/v1/caregiver/privacy/consent` (synthetic JWT) | ✅ 200, `_status: accepted` |
| 8 gated routes — with consent → non-403 | live HTTP | ✅ all 8 return 200 (or non-consent error if input is incomplete) |
| Recovery routes — no consent → reachable | `/privacy/version`, `/privacy/status`, `/profile` | ✅ none blocked by the gate |
| `/privacy/status` reports | for a consented caregiver | `required_flag: true` |
| Rollback | `AMINA_CAREGIVER_PRIVACY_REQUIRED=false docker compose ...` | ✅ container healthy in <60 s |
| Rollback proof — 8 routes pass for no-consent caregiver | `_phase7_rollback_proof.py` | ✅ all 8 return non-403; `/privacy/status: required_flag=false` |

**Total live HTTP checks under flag-on**: 64 PASS / 0 FAIL
**Total live HTTP checks under flag-off (rollback proof)**: 20 PASS / 0 FAIL

### Synthetic-data guarantee

All Phase 7 validation used JWTs minted in-process with synthetic
identities (`cg-p7-noconsent`, `cg-p7-hasconsent`, `cg-rb-noconsent`)
and the synthetic patient id `p7-synthetic-patient`. **No real PHI,
no real caregiver tokens, and no production secrets were used.**
The validation harnesses (`_phase7_live_gate_matrix.py`,
`_phase7_rollback_proof.py`) are kept at the repo root for replay
and never deploy into a production image.

### Frontend hard-403 validation — manual smoke

Playwright is not configured in this repo. The hard-403 receiver
was validated as follows:

1. `npx eslint src/auth/caregiverConsent403Interceptor.js src/CaregiverPrivacyReconsentBootstrap.jsx` → 0 problems
2. `npx vite build` → ✓ built in 6.61 s, no errors
3. Static behaviour proof: the interceptor self-installs only when
   `localStorage.getItem("cg_token")` is truthy and the URL contains
   `/api/v1/caregiver/`. The Phase 7 canonical 403 carries the
   exact `code: "caregiver_privacy_consent_required"` shape the
   interceptor matches on; the live gate matrix above confirms the
   shape on every gated route.
4. Manual smoke steps to run from the caregiver portal once a real
   stale caregiver session is available:
   - Sign in as a caregiver with no current consent.
   - Navigate to `/caregiver/dashboard` (gated route).
   - **Expect:** the soft re-consent modal opens automatically; the
     dashboard does not look broken.
   - Accept consent in the modal.
   - **Expect:** `POST /privacy/consent → 200`; the dashboard re-fetches
     and renders normally.
   - Open browser devtools console and confirm no signatures, tokens,
     names, phones, or payload bodies are logged by the interceptor.
5. Existing patient signup tab/page sanity check: no regression
   (interceptor is a no-op for paths that don't contain
   `/api/v1/caregiver/`, and only when a `cg_token` is present).

### Stale-population audit — dev DB sample

Run during Phase 7 validation against the synthetic dev ArcadeDB:

```
notice_version    : 1.0
total caregivers  : 17
current consent   : 3
stale / missing   : 14
stale percentage  : 82.35%
verdict           : RED
recommendation    : DO NOT flip. Coordinated comms + re-consent campaign required first.
```

This is **synthetic dev data** (3 of the 17 happen to be the
synthetic Phase 7 caregivers that submitted consent during
validation). It does **not** authorise a production flip — the
production audit must be run separately and pasted into §5.4.

---

## 1D. Operator runbook — caregiver privacy enforcement

Single source of truth for the on-call engineer. The two flags are
independent:

| Flag | Default | Effect when `true` | Effect when `false` |
|---|---|---|---|
| `AMINA_CAREGIVER_PRIVACY_REQUIRED` | `false` | Route-level dependency raises HTTP 403 on stale caregivers | Dependency runs but transparently passes |
| `AMINA_CAREGIVER_PRIVACY_WARN_ONLY` | `true` | Phase 5 middleware logs `event_type=caregiver_privacy_consent_stale` + sets `X-Caregiver-Privacy-Stale` header — never blocks | Middleware no-ops |

### A. Enable enforcement (production)

> ⛔ **Do NOT run this until §5 production audit is GREEN (or YELLOW
> with a 14-day soak window already in flight).** The dev-side audit
> result (RED, 82.35% — see §1C) is **not** evidence for a
> production flip; it was generated against synthetic dev data and
> should not be quoted in a production go/no-go decision.
>
> The exact audit command to run **on the production ArcadeDB** is:
>
> ```bash
> docker exec haystack-chatqna python /app/scripts/caregiver_privacy_stale_audit.py --json
> ```
>
> Paste the JSON output into a new dated subsection of §5.4 of this
> document **before** executing the promote command below. The flip
> is only authorised when:
>   - the *production* JSON shows `verdict=green`, OR
>   - it shows `verdict=yellow` AND the 14-day warn-only soak has
>     already started AND the operator can show the soft re-consent
>     campaign is in flight.
>
> A `verdict=red` production result blocks the flip until a
> coordinated comms / re-consent campaign brings the population
> down to YELLOW or below.

```bash
AMINA_CAREGIVER_PRIVACY_REQUIRED=true docker compose -f haystack-stack/docker-compose.yml \
  -f haystack-stack/docker-compose.override.yml \
  -f haystack-stack/docker-compose.meta-channels.yml \
  --project-directory haystack-stack \
  up -d --force-recreate --no-deps haystack-chatqna
```

Verify within ~60 s:

```bash
docker exec haystack-chatqna python -c "import os; print(os.getenv('AMINA_CAREGIVER_PRIVACY_REQUIRED'))"
# expect: true
curl -s http://localhost:8000/api/v1/caregiver/privacy/version
# expect: {"notice_version":"1.0","required_flag":true}
```

### B. Disable enforcement (incident rollback — canonical one-liner)

```bash
AMINA_CAREGIVER_PRIVACY_REQUIRED=false docker compose up -d --force-recreate --no-deps haystack-chatqna
```

(Run from `haystack-stack/`. The override file's `${VAR:-false}`
passthrough means no `.env` edit is required. Keep this command in
a saved terminal during the flip window.)

### C. Expected 403 response shape

Any of the 8 gated routes, called by a caregiver with no current
consent, returns:

```json
HTTP/1.1 403 Forbidden
Content-Type: application/json

{
  "detail": {
    "error":          "consent_required",
    "code":           "caregiver_privacy_consent_required",
    "message":        "Privacy notice consent required",
    "notice_version": "1.0",
    "submit_url":     "/api/v1/caregiver/privacy/consent",
    "status_url":     "/api/v1/caregiver/privacy/status"
  }
}
```

The frontend `caregiverConsent403Interceptor.js` pivots on `code`.
Operators can also pivot on `code` when grepping logs.

### D. Routes gated by the flag (enforce when `REQUIRED=true`)

```
GET  /api/v1/caregiver/patients
GET  /api/v1/caregiver/dashboard
GET  /api/v1/caregiver/insights
GET  /api/v1/caregiver/alerts
POST /api/v1/caregiver/chat
POST /api/v1/caregiver/voice-chat
GET  /api/v1/caregiver/predictions/{patient_id}
GET  /api/v1/caregiver/panel
```

### E. Recovery routes — must remain reachable at all times

```
POST /api/v1/caregiver/login
POST /api/v1/caregiver/register
POST /api/v1/caregiver-v2/...               (entire registration flow)
GET  /api/v1/caregiver/profile
PUT  /api/v1/caregiver/profile
GET  /api/v1/caregiver/privacy/version      (public, no auth)
GET  /api/v1/caregiver/privacy/status
POST /api/v1/caregiver/privacy/consent
```

Phase 7 validates that none of these surface a
`caregiver_privacy_consent_required` 403 even when `REQUIRED=true`.

### F. Stale-population go/no-go thresholds

| Stale % | Verdict | Action |
|---|---|---|
| < 5% | 🟢 GREEN | Schedule the flip with a 24 h banner |
| 5–20% (inclusive) | 🟡 YELLOW | Run a 14-day warn-only soak + soft re-consent campaign first |
| > 20% | 🔴 RED | Do NOT flip — coordinated comms / re-consent campaign first |

Run the audit any time:

```bash
docker exec haystack-chatqna python /app/scripts/caregiver_privacy_stale_audit.py
docker exec haystack-chatqna python /app/scripts/caregiver_privacy_stale_audit.py --json
```

### G. Monitoring signals to watch during a flip window

| Signal | Where | Healthy band |
|---|---|---|
| Count of `403 caregiver_privacy_consent_required` | App logs / observability dashboard | Climbs in first 24 h, then decays — should approach 0 within 7 days |
| Re-consent success rate | `POST /privacy/consent → 200 / total POSTs` | > 95% within 48 h of flip |
| Stale audit % (re-run weekly during ramp) | Audit script `--json` | Trends down each week |
| Support / data-concern emails | inbox / Linear | No spike beyond baseline |
| Caregiver portal error rate | Sentry / FE error tracker | No spike on the 8 gated routes |
| `event_type=caregiver_privacy_consent_stale` log line count | Application logs | Trends down — independent ground-truth signal |

If the 403 rate does not decay within 7 days, **roll back via §B
above**, run the audit, and treat the slope as the next campaign's
input.

---

## 2. Files changed in Phase 6.5

| File | Change |
|---|---|
| `haystack-stack/haystack-chatqna/src/api/caregiver_routes.py` | `_caregiver_jwt` adds optional `caregiver_role` param + claim; both call sites pass the value (relationship from request body / CaregiverVertex row) |
| `haystack-stack/haystack-chatqna/src/api/caregiver_privacy_routes.py` | `CaregiverConsentStatus` extended from 6 → 12 fields; status route populates from row with safe defaults |
| `components/frontend/src/CaregiverPortal.jsx` | `downloadConsentRecord` includes the 6 new fields; format-version bumped to `1.1` |
| `haystack-stack/docker-compose.override.yml` | Bind-mounts both backend route files so the fix lands on container restart without an image rebuild |
| `haystack-stack/haystack-chatqna/_caregiver_privacy_consent_test.py` | 4 new tests (15-18) covering the receipt round-trip, forbidden-field exclusion, JWT claim presence, JWT default no-leak |
| `docs/compliance/CAREGIVER_PRIVACY_ENFORCEMENT_READINESS.md` | This document |

**No commit, branch, push, stash, or stage was performed** — local edits only.

## 2B. Files changed in Phase 6.7

| File | Change |
|---|---|
| `haystack-stack/haystack-chatqna/src/api/caregiver_routes.py` | Added `dependencies=[Depends(_require_caregiver_privacy_consent)]` to 7 patient-data routes (dashboard, insights, alerts, chat, voice-chat, predictions/{patient_id}, panel). `/patients` already had it from Phase 5.5. Total: **8 routes gated** (inactive while flag is false) |
| `components/frontend/src/auth/caregiverConsent403Interceptor.js` | **New** — self-installing fetch wrapper that fires `amina:caregiver-consent-required` on canonical 403 from caregiver paths. ~120 LoC |
| `components/frontend/src/CaregiverPrivacyReconsentBootstrap.jsx` | Side-effect imports the interceptor; `ReconsentHost` listens for the new event and re-runs the status `tick` |
| `haystack-stack/haystack-chatqna/scripts/caregiver_privacy_stale_audit.py` | **New** — read-only ArcadeDB audit, emits human-readable + `--json` reports with green/yellow/red verdict. Injectable `query_runner` for tests |
| `haystack-stack/haystack-chatqna/_caregiver_privacy_consent_test.py` | 6 new tests (19-24) — v2 JWT round-trip per role, v2 JWT no-PHI, gate flag matrix (off/on × no-record/has-record), gate never blocks consent routes themselves, audit verdict thresholds (7 boundary cases), audit SQL no-PHI |
| `docs/compliance/CAREGIVER_PRIVACY_ENFORCEMENT_READINESS.md` | This document — added §1B, §2B, refreshed §3/§4/§5/§6/§7/§8 |

**No commit, branch, push, stash, or stage was performed** — local edits only.

## 2C. Files changed in Phase 7

| File | Change |
|---|---|
| `haystack-stack/haystack-chatqna/src/api/caregiver_privacy_routes.py` | 403 detail body now includes `"message": "Privacy notice consent required"` (Fix H) |
| `haystack-stack/docker-compose.override.yml` | Added env passthrough `AMINA_CAREGIVER_PRIVACY_REQUIRED: ${...:-false}` and `AMINA_CAREGIVER_PRIVACY_WARN_ONLY: ${...:-true}` to the `haystack-chatqna` service so promote/rollback work via env on the recreate command (Fix I). Defaults are production-safe |
| `haystack-stack/haystack-chatqna/_caregiver_privacy_consent_test.py` | 6 new tests (25–30): 403 detail shape, new-notice-version immutable history, register payload no-inline-consent, all 8 patient-data routes carry the gate dep, recovery routes never carry the gate dep, 403 body has zero PHI |
| `haystack-stack/haystack-chatqna/_phase7_live_gate_matrix.py` | **New** — Phase 7 live HTTP harness. Mints synthetic JWTs and exercises all 8 gated routes + recovery routes under `REQUIRED=true`; asserts canonical 403 shape and zero PHI |
| `haystack-stack/haystack-chatqna/_phase7_rollback_proof.py` | **New** — confirms after rollback that all 8 routes pass for a no-consent caregiver and `/privacy/status` reports `required_flag=false` |
| `docs/compliance/CAREGIVER_PRIVACY_ENFORCEMENT_READINESS.md` | This document — added §1C (Phase 7 validation results), §1D (operator runbook), §2C, refreshed §3 (test counts) and §4 (final flag state) |

**No commit, branch, push, stash, or stage was performed** — local edits only.
Production was never touched.

---

## 3. Test results

```
=== Phase 2 + 6.5 + 6.7 + 7 backend test suite ===
PYTHONIOENCODING=utf-8 python _caregiver_privacy_consent_test.py
  PASSED: 155    FAILED: 0
    (14 Phase 2 + 4 Phase 6.5 + 6 Phase 6.7 + 6 Phase 7 fixtures)

=== Phase 5 warn-only suite (regression) ===
PYTHONIOENCODING=utf-8 python _caregiver_privacy_warn_test.py
  PASSED: 40    FAILED: 0   (no regressions)

=== Agent platform suites (regression — touched code is independent
                             but spec asked for these to run) ===
PYTHONIOENCODING=utf-8 python _agent_platform_v1_test.py
  PASSED: 149    FAILED: 0
PYTHONIOENCODING=utf-8 python _agent_platform_v2_native_tools_test.py
  PASSED: 200    FAILED: 0
PYTHONIOENCODING=utf-8 python _agent_platform_phase3_safety_test.py
  PASSED: 157    FAILED: 0

=== Phase 7 live HTTP harnesses (synthetic JWTs, no real PHI) ===
PYTHONIOENCODING=utf-8 python _phase7_live_gate_matrix.py    (flag=true)
  PASSED: 64     FAILED: 0
PYTHONIOENCODING=utf-8 python _phase7_rollback_proof.py      (flag=false)
  PASSED: 20     FAILED: 0

=== Backend totals ===
  Static + unit: 701 PASS / 0 FAIL
  Live HTTP   :  84 PASS / 0 FAIL
  Total       : 785 PASS / 0 FAIL

=== py_compile (inside container) ===
  ✓ caregiver_routes.py
  ✓ caregiver_privacy_routes.py
  ✓ scripts/caregiver_privacy_stale_audit.py
  ✓ _caregiver_privacy_consent_test.py
  ✓ _phase7_live_gate_matrix.py
  ✓ _phase7_rollback_proof.py

=== Frontend ===
  npx eslint src/auth/caregiverConsent403Interceptor.js \
             src/CaregiverPrivacyReconsentBootstrap.jsx
    0 problems
  npx vite build
    ✓ built in 6.61s

=== Live HTTP gate matrix snapshot (flag=true on dev) ===
  GET  /api/v1/caregiver/patients                   no-consent → 403, with-consent → 200
  GET  /api/v1/caregiver/dashboard                  no-consent → 403, with-consent → 200
  GET  /api/v1/caregiver/insights                   no-consent → 403, with-consent → 200
  GET  /api/v1/caregiver/alerts                     no-consent → 403, with-consent → 200
  POST /api/v1/caregiver/chat                       no-consent → 403, with-consent → non-403
  POST /api/v1/caregiver/voice-chat                 no-consent → 403, with-consent → non-403
  GET  /api/v1/caregiver/predictions/{patient_id}   no-consent → 403, with-consent → non-403
  GET  /api/v1/caregiver/panel                      no-consent → 403, with-consent → non-403

  Recovery routes (under flag=true):
    /privacy/version → 200 (public)
    /privacy/status  → 200 (caregiver auth, no consent gate)
    /profile         → 200 (caregiver auth, no consent gate)

  Stale audit (synthetic dev DB):
    total=17, current=3, stale=14, stale_pct=82.35%, verdict=RED
    (synthetic data only — production number TBD per §5)
```

---

## 4. Current enforcement status

**Enforcement is OFF.** Phase 6.5 did not flip any flag. Concretely:

| Flag | Value | Effect |
|---|---|---|
| `AMINA_CAREGIVER_PRIVACY_REQUIRED` | `false` (default; not set in `.env`) | Consent gate dependency `require_caregiver_privacy_consent` returns the caregiver transparently — no 403, no lockout |
| `AMINA_CAREGIVER_PRIVACY_WARN_ONLY` | `true` | Phase 5 middleware still emits `X-Caregiver-Privacy-Stale: true|false` header + structured warning log on stale; never blocks |

`/privacy/status` shows `required_flag: false` for every caller.
**As of Phase 6.7, 8 caregiver routes have the gate dependency
wired** (see §1B Fix E for the list). Because the flag is still
false the dependency body short-circuits to a transparent pass —
zero behavioural change on the wire. The first request after a
future flag-flip is what activates the 403 path.

The phasing has therefore become:

1. **(Phase 6.5 — done)** Fix the data layer + receipt shape.
2. **(Phase 6.7 — done)** Wire the dependency on every patient-data
   route + add the frontend hard-403 receiver + ship the read-only
   stale-population audit. Flag stays false.
3. **(Phase 7 — NOT yet authorised)** Run the audit on production,
   record the verdict in §5, address yellow/red with a comms /
   re-consent campaign as needed, then flip
   `AMINA_CAREGIVER_PRIVACY_REQUIRED=true`.

---

## 5. Stale population check requirement before Phase 7

**This is the gate.** Phase 5.5 measured **94% stale** (16 / 17) on
the synthetic dev DB; that ratio cannot be relied on for production.
Phase 6.7 ships an automated read-only audit so this measurement is
a single command instead of three hand-typed SQL queries.

> **Phase 9 v4 update — notice version bumped 1.0 → 1.1.** Phase 9 v4
> added the explicit no-sale / no-unauthorised-disclosure clause +
> 6th acknowledgement (`acknowledge_no_unauthorized_disclosure`).
> Bumping the notice version means **every existing caregiver is now
> stale relative to v1.1** until they re-acknowledge — that is the
> EXPECTED behaviour of a substantive policy change. Run the audit
> with `--notice-version 1.1` (the script's default after the bump)
> to measure the v1.1 stale rate. Production rollout planning should
> assume the v1.1 audit will start near 100 % stale and decay as
> caregivers re-sign through the warn-only soak. See §10.6 of
> [CONSENT_MODEL.md](CONSENT_MODEL.md) for the clause and the
> backend / frontend contract.

### 5.1 Run the audit (read-only, no PHI emitted)

From the host:

```bash
docker exec haystack-chatqna python /app/scripts/caregiver_privacy_stale_audit.py
```

JSON form for piping into a metrics pipeline:

```bash
docker exec haystack-chatqna python /app/scripts/caregiver_privacy_stale_audit.py --json
```

Sample output (synthetic dev DB, 2026-04-30):

```
────────────────────────────────────────────────────────
 Caregiver privacy — stale-population audit
────────────────────────────────────────────────────────
  notice_version    : 1.0
  total caregivers  : 17
  current consent   : 1
  stale / missing   : 16
  stale percentage  : 94.12%
────────────────────────────────────────────────────────
  verdict           : RED
  recommendation    : DO NOT flip. Coordinated comms + re-consent
                      campaign required first.
────────────────────────────────────────────────────────
```

The script emits **only** the four counts above + verdict + the
canned recommendation string. No names, phones, signatures,
hashes, tokens, IPs, or user-agents are ever fetched. Verified by
test 24 in `_caregiver_privacy_consent_test.py`.

### 5.2 Verdict thresholds (encoded in the script)

| Stale rate | Verdict | Action |
|---|---|---|
| **< 5%** | 🟢 GREEN | Safe to flip after a 24 h banner |
| **5% – 20%** (inclusive) | 🟡 YELLOW | Run a 14-day warn-only soak + soft re-consent campaign first |
| **> 20%** | 🔴 RED | DO NOT flip. Coordinated comms + re-consent campaign required |

(Earlier draft used 25% as the red boundary. Phase 6.7 tightened to
20% to match the campaign-cost model — above 20% the soft modal alone
will not lift enough caregivers in a 14-day window.)

### 5.3 Triangulation via warn-only logs

The Phase 5 warn-only middleware already emits one log line per stale
request. Aggregate the `event_type=caregiver_privacy_consent_stale`
lines over a 7-day window and divide by total caregiver requests to
sanity-check the audit's verdict from the request side.

### 5.4 Production checklist

1. Run the audit (5.1) against the production ArcadeDB.
2. Paste the human-readable output block into a new sub-section of
   §5 of this document, dated.
3. If GREEN: schedule the 24 h banner + flag flip.
4. If YELLOW: schedule the 14-day soak + soft campaign; re-run weekly.
5. If RED: open a comms / re-consent campaign ticket; do not schedule
   a flip date.

---

## 6. Remaining risk before Phase 7

Phase 6.7 closed previous-revision risks #2, #3, and #4. Updated table:

| | Item | Severity | Owner | Mitigation |
|---|---|---|---|---|
| 1 | **Stale population unknown for production** — see §5 | 🔴 BLOCKER | Ops | Run `caregiver_privacy_stale_audit.py` on prod, paste the output into §5.4, then decide |
| 2 | ~~caregiver-v2 flow does not emit `caregiver_role`~~ | ✅ CLOSED (Phase 6.7 Fix D) | — | Verified that v2 wizard flow goes through `_caregiver_jwt` after admin activation; Phase 6.5 fix already covers it. Two regression tests added |
| 3 | ~~No active caregiver route uses the gate~~ | ✅ CLOSED (Phase 6.7 Fix E) | — | 8 patient-data routes now wired; consent / login / status routes deliberately exempt |
| 4 | ~~Token rotation mid-session shows opaque error~~ | ✅ CLOSED (Phase 6.7 Fix F) | — | `caregiverConsent403Interceptor.js` + bootstrap event listener forces the existing soft modal open on canonical 403 |
| 5 | **`HasConsent` edge creation is best-effort** — for synthetic / pre-registered caregivers the edge step warns + drops. The consent row is still complete (caregiver_id is on the row itself) so `find_current_consent` and the gate work either way. Listed for awareness only | 🟢 LOW | none | Backfill an edge-repair script if/when audit needs full graph traversal |
| 6 | **Audit-trail durability (AUDIT-005)** — Phase 5 uses log lines, not durable audit records. Out of scope for Phase 7 too — but regulatory sign-off needs it. Tracked in the compliance roadmap | 🟡 MEDIUM | Backend | Separate phase. Not on the Phase 7 critical path |
| 7 | **Synthetic dev DB shows 94% stale** — the audit itself was validated end-to-end against this (test 23 covers the threshold logic). Production number will almost certainly differ; do not extrapolate | 🟢 LOW | Ops | Run §5.1 against prod; do not pre-judge |

---

## 7. Phase 7 enforcement — exact rollback command

If Phase 7 ships and lockouts surface, **revert the enforcement flag immediately** and validate within seconds. The warn-only layer keeps running so observability remains intact.

### Rollback (canonical one-liner)

```bash
AMINA_CAREGIVER_PRIVACY_REQUIRED=false docker compose up -d --force-recreate --no-deps haystack-chatqna
```

This is the exact command to keep open in a saved terminal during
the Phase 7 flip window. The compose file picks up the env override,
the container is recreated, and the dependency body short-circuits
back to transparent pass-through.

### Rollback (full multi-file form)

If the saved terminal is not available and you have to type the
compose stack manually, set `AMINA_CAREGIVER_PRIVACY_REQUIRED=false`
in `haystack-stack/.env` and run:

```bash
docker compose \
  -f haystack-stack/docker-compose.yml \
  -f haystack-stack/docker-compose.override.yml \
  -f haystack-stack/docker-compose.meta-channels.yml \
  --project-directory haystack-stack \
  up -d --no-deps --force-recreate haystack-chatqna
```

Verify within ~45 s:

```bash
# A — flag is off in env
docker exec haystack-chatqna bash -c 'env | grep AMINA_CAREGIVER_PRIVACY_REQUIRED'
# expect: AMINA_CAREGIVER_PRIVACY_REQUIRED=false

# B — /privacy/status reports flag off
curl -s http://localhost:8000/api/v1/caregiver/privacy/status \
  -H "Authorization: Bearer <any-caregiver-jwt>" | python -m json.tool
# expect: required_flag: false

# C — gate dep no longer raises 403 on stale caregivers
curl -s -i http://localhost:8000/api/v1/caregiver/<the-route-that-was-gated> \
  -H "Authorization: Bearer <stale-caregiver-jwt>" | head -3
# expect: HTTP/1.1 200 (or whatever the handler returns; NOT 403)
```

If A returns `true`, the env var didn't reload — re-issue the
`docker compose ... --force-recreate` line. Restart alone is not
enough; the container must be recreated for env changes to take
effect.

### Faster rollback (no compose access)

If you only have `docker` (no compose), you can override the env on
the running container via image-level recreation:

```bash
docker stop haystack-chatqna && \
docker rm haystack-chatqna && \
docker run -d \
  --name haystack-chatqna \
  --network haystack-stack_chatqna_default \
  -p 8000:8000 \
  -e AMINA_CAREGIVER_PRIVACY_REQUIRED=false \
  --env-file haystack-stack/.env \
  haystack-stack-haystack-chatqna:latest
```

The `-e AMINA_CAREGIVER_PRIVACY_REQUIRED=false` overrides whatever's
in `.env`. This is heavier than the compose path (loses bind mounts
unless re-specified) and is reserved for when compose is broken.

---

## 8. Recommendation

**Do not flip `AMINA_CAREGIVER_PRIVACY_REQUIRED=true` until ALL of
the following are true:**

1. Production stale population (§5) is measured via the audit script
   and the verdict is GREEN, OR YELLOW with a 14-day soak window
   already in flight. RED requires a comms / re-consent campaign
   before the flip date is even scheduled.
2. ✅ **(Closed by Phase 6.5 Fix A.)** New consent records correctly
   record `role` from the JWT `caregiver_role` claim instead of
   `"unknown"`. Verified live on dev; spot-check on prod once the
   first production caregiver re-consents.
3. ✅ **(Closed by Phase 6.7 Fix D.)** v2 wizard caregivers go
   through the same `_caregiver_jwt` mint after admin activation
   (verified by tests 19-20). No separate v2 mint patch needed.
4. ✅ **(Closed by Phase 6.7 Fix E.)** 8 patient-data routes are
   wired with `Depends(require_caregiver_privacy_consent)` so that
   flipping the flag immediately enforces on these routes. Read /
   write split deliberately ignored: every patient-data surface is
   gated, consent / login / status surfaces are not.
5. ✅ **(Closed by Phase 6.7 Fix F.)** Frontend hard-403 path:
   `caregiverConsent403Interceptor.js` listens for the canonical 403
   shape and forces the existing soft modal open via the
   `amina:caregiver-consent-required` event.

When all five are green, plan the flip as: 24 h banner in the
caregiver portal → flip on a Monday morning at low-traffic hour →
monitor the warn-only log + 403 rate for 4 h → keep the rollback
command from §7 ready in a saved terminal.

**As of Phase 6.7, only item 1 (production stale-population
measurement) gates Phase 7.** Once that number lands and the
verdict is GREEN or YELLOW-with-soak-running, Phase 7 is authorised
to ship.
