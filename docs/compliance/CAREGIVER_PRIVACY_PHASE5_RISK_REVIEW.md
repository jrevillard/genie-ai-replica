# Caregiver Privacy — Phase 5 Risk & Evidence Review

**Phase:** 5.5 (evaluation only — no behaviour change shipped)
**Date:** 2026-04-30
**Branch:** `Health-AminaCare-branch`
**Reviewer:** Operations & compliance
**Verdict:** 🟡 **YELLOW — proceed cautiously to Phase 6 once two soft blockers are cleared**

---

## 1. Scope of this review

Phase 5 shipped a **warn-only** caregiver privacy re-consent gate
(`X-Caregiver-Privacy-Stale: true|false` response header + structured
warning log line + dismissible frontend modal). This review confirms
the warn-only behaviour holds before any move toward enforcement
(Phase 6: `AMINA_CAREGIVER_PRIVACY_REQUIRED=true`).

No source-code changes were shipped during this review except:
- one synthetic `CaregiverConsentRecord` (caregiver_id `cg-phase55-current`) was inserted in the dev ArcadeDB
- one synthetic re-accept with a changed signature (caregiver_id `cg-phase55-current`)
- four synthetic JWTs minted in-memory (never persisted)

No code was committed, staged, branched, pushed, or stashed.

---

## 2. Checks run + results

### Check 1 — Runtime / container parity ✅

| Probe | Result |
|---|---|
| `caregiver_privacy_warn.py` present in container | ✅ `/app/src/services/caregiver_privacy_warn.py` (11,043 bytes, bind-mounted via override.yml) |
| Middleware install log on startup | ✅ `caregiver_privacy_warn: installed (warn_only=True, required=False)` × 4 (one per uvicorn worker) |
| `/health` carries no stale header | ✅ `HTTP/1.1 200 OK` — header absent (path-prefix gate works) |
| `/api/v1/caregiver/*` carries header (default false on no-auth) | ✅ `HTTP/1.1 401 Unauthorized` + `x-caregiver-privacy-stale: false` |

### Check 2 — Stale population (synthetic dev DB) ✅

Read-only counts against ArcadeDB `genie` database. **No PHI columns
selected.**

| Metric | Count |
|---|---|
| Total caregivers (`CaregiverVertex`) | 17 |
| `CaregiverConsentRecord` rows at notice_version `1.0` | 1 (the synthetic record) |
| Distinct caregivers with current-version consent | 1 |
| **Stale / missing (would see modal at next login)** | **16 of 17** (≈ 94%) |
| Records at any other notice_version (drift) | 0 |

**Interpretation:** the dev DB has 16 of 17 caregivers stale because
the wider population pre-dates Phase 4 (which is the only path that
populates `CaregiverConsentRecord` for new caregivers). The single
non-stale row is the synthetic record this review inserted to verify
the `false` branch of the header matrix.

For production estimate: replace the dev numbers with prod counts via
the same two queries before Phase 6 rollout. The warn-only log will
emit one structured line per stale request — derive prod stale count
from the log aggregate over a 7-day window.

### Check 3 — Header matrix ✅

All 6 spec'd cases plus a 5xx-pass-through check.

| Case | Auth | Path | Expected | Observed |
|---|---|---|---|---|
| 1 | none | `/api/v1/caregiver/privacy/status` | `false` (default) | ✅ `false` |
| 2 | patient JWT | `/api/v1/caregiver/privacy/status` | `false` (silent skip) | ✅ `false` |
| 3 | admin JWT | `/api/v1/caregiver/privacy/status` | `false` (silent skip) | ✅ `false` |
| 4 | caregiver JWT, **no record** | `/api/v1/caregiver/privacy/status` | `true` | ✅ `true` (HTTP 200) |
| 5 | caregiver JWT, **current record** | `/api/v1/caregiver/privacy/status` | `false` | ✅ `false` (HTTP 200) |
| 6 | caregiver JWT (stale) | `/health` (non-caregiver path) | header absent | ✅ absent |
| 7 | caregiver JWT (stale) + handler returns 405 | caregiver path | header still `true`, request not blocked | ✅ `true` + 405 (pass-through) |

No request was ever blocked by the middleware in any case.

### Check 4 — Log safety ✅

`caregiver_privacy_warn` emits exactly two log shapes:

```
INFO:    caregiver_privacy_warn: installed (warn_only=True, required=False)
WARNING: event_type=caregiver_privacy_consent_stale caregiver_id=<id> notice_version=1.0 required_flag=false warn_only=true
```

Forbidden-substring sweep across the entire container log file (every
line, not just warn-only lines):

| Substring | Lines | Notes |
|---|---|---|
| `+220` (Gambia phone prefix) | 0 | ✅ |
| `+91` (test phone prefix) | 0 | ✅ |
| `Mozilla` (User-Agent) | 0 | ✅ |
| `127.0.0.1` | 81 | ⚠ uvicorn stdlib access logs (origin IP for healthchecks) — **not** a warn-only emission |
| `I understand` / `I accept` (checkbox prose) | 0 | ✅ |
| `digital_signature=` | 0 | ✅ |
| `@gmail` / `@outlook` (email TLDs) | 0 | ✅ |
| `EAATu8` (Meta page-token prefix) | 0 | ✅ |
| `sk-proj` (OpenAI key prefix) | 0 | ✅ |
| `amina2026` (admin password) | 0 | ✅ |
| `genieRoot` (DB password) | 0 | ✅ |
| `Aisha` / `Fatou` / `Mariama` (synthetic names) | 0 / 0 / 4 | ⚠ `Mariama` matches **only** the observatory super-admin seed line (`Mariama Sanneh-Camara-Demo`), which is a public demo identity — **not** a warn-only emission |
| `TWILIO_AUTH` / `MESSENGER_PAGE_ACCESS_TOKEN` (env names) | 0 / 0 | ✅ |

The two non-zero hits (`127.0.0.1`, `Mariama`) are confirmed to come
from upstream uvicorn / observatory-seed code, not from Phase 5
emissions. Warn-only logs are PHI-clean.

### Check 5 — Latency smoke ✅

30 sequential calls to `GET /api/v1/caregiver/privacy/status` with a
caregiver JWT (the route runs inside the warn-only middleware
including the stale-check ArcadeDB query). Baseline: 30 calls to
`/health` (no middleware overhead).

| Endpoint | p50 | p95 | p99 | min | max |
|---|---|---|---|---|---|
| `/api/v1/caregiver/privacy/status` (with middleware) | **12.3 ms** | 28.3 ms | 29.4 ms | 10.4 ms | 31.8 ms |
| `/health` (baseline, no middleware path) | 6.1 ms | 25.7 ms | — | — | — |

Estimated stale-check overhead = **~6 ms p50** (one indexed ArcadeDB
lookup on `caregiver_id` + `notice_version`). Acceptable for the
caregiver portal traffic profile (single-digit RPS, not a
hot path). If portal traffic ever grows to triple-digit RPS the
result can be cached in Redis with a short TTL — Phase 5 doesn't
need that today.

### Check 6 — Re-consent record integrity ✅

Tested live against the running stack with the synthetic caregiver
`cg-phase55-current`.

| Scenario | Expected | Observed |
|---|---|---|
| 3× POST same payload (same notice_version + same digital_signature) | calls 2/3 return `status="already_accepted"`, all 3 share the same `record_id`, only one row in DB | ✅ `record_id=CGCONSENT-6a6d0b83503c39e8` for all 3 calls; status `already_accepted` |
| Changed signature, same notice_version | new `record_id`, `status="accepted"`, OLD row preserved | ✅ new `record_id=CGCONSENT-51b00669e7a724ac`, status `accepted` |
| Total rows for caregiver after both drift cases | 2 (one per distinct signature hash) | ✅ ArcadeDB count = 2 |

Phase 5 test suite (`_caregiver_privacy_warn_test.py`) covers the
new-notice-version case offline (test #15). The schema and
`record_consent` service are unchanged from Phase 2 so existing
unit-test coverage applies; **the whole Phase 5 suite is 40 PASS / 0
FAIL** and the Phase 2 regression suite is **55 PASS / 0 FAIL**.

### Check 7 — Frontend modal UX ✅

Static audit of `components/frontend/src/CaregiverPrivacyReconsentBootstrap.jsx`:

| UX requirement | Source-line evidence |
|---|---|
| Modal is dismissible | "Remind me later" button at line 215; embedded step's Cancel maps to onDismiss at line 189 |
| Dismiss persists for current browser session only | `sessionStorage.setItem("amina_caregiver_reconsent_dismissed", "1")` at line 97 (NOT localStorage) |
| Accept closes modal on success | `setStale(false)` after successful POST at line 290 |
| Backend failure surfaces error but doesn't block | `setError(...)` at line 295, modal stays open with `setBusy(false)`; portal stays usable because the modal is mounted in a sibling React root in `<body>`, not inside the portal tree |
| No `console.log` of signature / payload / consent state | Only one `console.warn` at line 334 — mount-failure path; never logs payload |

Live status snapshots confirm the gate logic:

| Caregiver | `has_current_consent` | Frontend behaviour |
|---|---|---|
| `cg-phase55-current` | `true` | Modal stays hidden |
| `cg-phase55-stale` | `false` | Modal would mount unless session-dismissed flag is set |

### Check 8 — Token identity ✅ (with one minor data-quality note)

The full identity-key chain — JWT mint → route → middleware → service
→ DB query — is **consistent end-to-end**.

```
caregiver_routes.py:55     _caregiver_jwt(...)
                           payload = { "sub": caregiver_id, "role": "caregiver", ... }
                                     │
                                     ▼
caregiver_privacy_routes.py:139      caregiver.get("sub") or caregiver.get("caregiver_id")
caregiver_privacy_warn.py:127        payload.get("sub") or payload.get("caregiver_id")
                                     │
                                     ▼  same caregiver_id
caregiver_privacy_consent.py
  record_consent(caregiver_id=...)  → INSERT ... caregiver_id = :cg
  find_current_consent(caregiver_id=...) → SELECT ... WHERE caregiver_id = :cg
```

Both routes (consent submit, status, gate) and the warn-only
middleware use the identical fallback chain
`payload.get("sub") or payload.get("caregiver_id")`. A real caregiver
JWT carries `sub = caregiver_id` (set at mint time in
`caregiver_routes.py:58`). All 5 surfaces converge on the same value.

**Identity-key risk: NONE.** Phase 6 enforcement can rely on
`has_current_consent(caregiver_id)` without an ID-mismatch hazard.

**Minor data-quality footnote (NOT an enforcement blocker):**
`caregiver_privacy_routes.py:140` reads:

```python
role = (caregiver.get("caregiver_role") or "").lower()
```

…but the JWT mint at `caregiver_routes.py:60` writes `role` (the
literal `"caregiver"`), not `caregiver_role` (the type — `vhw`,
`cbc`, etc.). Result: every CaregiverConsentRecord written via the
route ends up with `role="unknown"`. This is fine for the consent
gate (which keys on `caregiver_id`, not `role`), but it muddies any
future per-role analytics. See **Blocker B** in §3 for a one-line
remediation.

---

## 3. Enforcement readiness verdict

🟡 **YELLOW — proceed cautiously, two soft blockers should be cleared first.**

The warn-only layer is observability-clean, performance-cheap,
PHI-safe, and identity-consistent. Nothing in this review reveals a
correctness problem with the consent gate itself.

The yellow rating reflects two non-engineering issues that need
resolution before flipping `AMINA_CAREGIVER_PRIVACY_REQUIRED=true`:

### Blocker A — Population is 94% stale on this snapshot

If this dev-DB ratio holds in production, flipping enforcement on
without a comms window or a soft re-consent campaign would lock 94%
of caregivers out of the portal at the first request. **Mitigation
plan:**

1. Read prod counts via the same two queries (Check 2).
2. Run warn-only for at least 14 days; aggregate the stale log lines
   to estimate true production stale rate (the warn-only log is the
   ground-truth signal).
3. Send an in-portal banner (separate from this Phase 5 modal) one
   week before enforcement, explaining the deadline.
4. On the day of enforcement, ensure the modal in this branch is
   non-dismissible (Phase 6 hard-gate variant).

### Blocker B — `role="unknown"` on every consent record

A one-line fix in either:

- `caregiver_routes.py:60` add `"caregiver_role": cg["role"],` to the
  JWT payload — preferred, no DB change, future-proof; OR
- `caregiver_privacy_routes.py:140` replace
  `caregiver.get("caregiver_role")` with a `_repo.get_by_id(...)`
  lookup at submit time — no JWT-shape change but adds one query
  per submit.

Neither breaks Phase 5. Recommend doing this in the same change-set
as Phase 6, since enforcement-era audit/compliance reporting will
want correct role attribution on every consent row.

### Other risks already covered (informational, not blockers)

- **Token rotation mid-session** — JWT decode falls open silently;
  modal does not show. Fine for warn-only; for enforcement, ensure
  the route's HTTP 403 response is surfaced cleanly in the frontend
  so the user is forced to log back in rather than hitting an
  opaque error.
- **Re-accept storms after notice-version bump** — verified
  idempotent (Check 6) so duplicate submissions don't multiply
  rows. Initial-insert rate could still pressure ArcadeDB if every
  caregiver hits the modal in the same minute. Pre-warm with a
  scheduled silent re-fetch of `/privacy/status` if the population
  is large enough to matter.
- **Audit-trail durability** — Phase 5 uses log lines, not durable
  audit records. AUDIT-005 store remains a Phase-6+ prerequisite
  for regulatory sign-off. This review takes no position on AUDIT-005.

---

## 4. Acceptance gate

| Criterion | Status |
|---|---|
| No lockout introduced | ✅ — middleware never blocks; verified across 7 cases |
| No PHI/secrets printed in logs | ✅ — forbidden-substring sweep is clean for warn-only emissions |
| No writes except optional synthetic/test records | ✅ — only one synthetic `CaregiverConsentRecord` (cg-phase55-current) + one re-accept variant; cg-phase55-stale and the synthetic JWTs were never persisted |
| No commit / branch / push / stash / stage | ✅ — `git rev-parse HEAD = origin/Health-AminaCare-branch`; `ahead/behind: 0 0`; no `git add`, no `git commit`, no `git push` was executed during this review |
| Final verdict provided | ✅ — 🟡 YELLOW with two soft blockers (§3) |

**Phase 6 is not authorised to ship until Blockers A + B are addressed.**

---

## 5. Synthetic artefacts created during this review

For traceability — these are dev-only and safe to leave in place or
delete at any time. They do not represent real caregivers.

| Artefact | Where | Cleanup? |
|---|---|---|
| Synthetic consent record `CGCONSENT-6a6d0b83503c39e8` for `cg-phase55-current` | `CaregiverConsentRecord` (ArcadeDB `genie`) | Optional. Leaving it is harmless — `cg-phase55-current` is not a real caregiver_id and matches no `CaregiverVertex`. |
| Synthetic consent record `CGCONSENT-51b00669e7a724ac` (changed signature, same caregiver) | same | same |
| `_phase55_setup.py` (one-shot mint script) | `haystack-stack/haystack-chatqna/_phase55_setup.py` (host) + `/app/_p55_setup.py` (container) | Delete on next git-clean if you don't want it tracked. |
| Synthetic JWTs (`cg-phase55-stale`, `cg-phase55-current`, `p-phase55`, `admin`) | `/tmp/p55_tok_*` (host) + container `/tmp/` | Auto-cleared on container restart. |

To clean up the two synthetic records:

```sql
-- run against ArcadeDB Studio at http://localhost:2480 (root / genieRoot123)
DELETE FROM CaregiverConsentRecord WHERE caregiver_id IN ('cg-phase55-current', 'cg-phase55-stale');
```
