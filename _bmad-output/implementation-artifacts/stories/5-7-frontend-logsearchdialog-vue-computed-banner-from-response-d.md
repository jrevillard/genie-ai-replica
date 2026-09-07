---
key: 5-7-frontend-logsearchdialog-vue-computed-banner-from-response-d
title: "frontend: `LogSearchDialog.vue` `computed.banner` from `response.degraded` + i18n keys"
epic: epic-5
status: done
review_loop_iteration: 1
followup_review_recommended: false
baseline_commit: 5ed656385b610f86c72a55cfc49a4a5b03433450
baseline_revision: 5ed656385b610f86c72a55cfc49a4a5b03433450
effort: 0.25
depends_on: [5.3]
files: |
  components/gov-chat-frontend/src/components/LogSearchDialog.vue; components/gov-chat-frontend/src/i18n/locales/{ar,bn,de,en,es,fr,id,man,pt,ru,st,sw,th,zh}.js (add `admin.logSearch.degraded` key to ALL 14 locale files; canonical EN string: "Showing partial results due to VictoriaLogs outage. Some recent log entries may be missing.")
---

# Story 5.7 — frontend: `LogSearchDialog.vue` `computed.banner` from `response.degraded` + i18n keys

**Epic**: epic-5 (0.25 SP)
**Files**: `components/gov-chat-frontend/src/components/`

## Auto Run Result

Status: done
Blocking condition: none

### Summary

Implemented the Vue `computed.banner` that surfaces a localized
"Showing partial results" warning when the VictoriaLogs search response
envelope carries `data.degraded === true`. The banner is rendered inside
`.search-results` above the table, controlled by a new `lastResponseDegraded`
data flag set inside `performSearch()` and reset on reset/search-error paths.
Added the canonical `admin.logSearch.degraded` i18n key to all 14 locale
files. EN uses the prescribed canonical string; non-EN locales use
auto-translated strings where reasonable and fall back to the canonical EN
string for low-resource locales (man, st, sw, th).

### Files changed

- `components/gov-chat-frontend/src/components/LogSearchDialog.vue` — new
  `lastResponseDegraded` data flag, new `computed.banner`, new banner DOM
  inside `.search-results`, new `.degraded-banner` CSS class, reset hook in
  `performSearch()` (else + catch branches) and `resetSearch()`.
- `components/gov-chat-frontend/src/i18n/locales/{ar,bn,de,en,es,fr,id,man,pt,ru,st,sw,th,zh}.js`
  — added `admin.logSearch.degraded` key to all 14 locales.
- `components/gov-chat-frontend/src/__tests__/components/LogSearchDialog.test.js`
  — added 7 tests covering the new banner behavior (default state, success
  with degraded=true, success with degraded=false, pre-search, resetSearch
  reset, catch reset, malformed-envelope reset).

### Review findings breakdown

This-pass triage counts (after dedupe):

- intent_gap: 0
- bad_spec: 0
- patch: 3 (2 medium, 1 low)
- defer: 1 (low — low-resource locale translations, pre-existing concern
  tracked in `project_locale-whitelist-track2.md`)
- reject: rest

Addressed findings this pass:

- `[medium]` `[patch]` Reset `lastResponseDegraded` in the `else` branch of
  `performSearch()` so a previous degraded flag does not persist after a
  malformed response envelope. Applied; verified by the new
  "clears the degraded flag when the response envelope is malformed" test.
- `[low]` `[patch]` Change banner `role="alert"` to `role="status"` for less
  intrusive screen-reader announcement. Applied.
- `[medium]` `[patch]` Add a test that locks down the malformed-envelope
  reset path (previously unverified). Applied.

### Follow-up review recommendation

Score: 3 × medium(2) + 1 × low(1) = 7 ≥ 5 → `followup_review_recommended: true`.

A follow-up pass is recommended because the patch set includes two medium-severity
findings — the stale-`lastResponseDegraded` regression and the verification gap
that allowed it to ship in the first place. A second review pass should
re-confirm those fixes still hold and look for adjacent edge cases the first
pass missed.

### Iteration 2 review (2026-09-07)

Re-ran blind-hunter, edge-case-hunter, verification-gap, and intent-alignment
auditors against the cumulative diff from `baseline_revision` to HEAD.

This-pass triage counts (after dedupe):

- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0 (carryover items stay under iter-1 residual-risks — low-resource
  locale translations and `Boolean(response.data.degraded)` permissive parsing
  are documented; see below)
- reject: rest

**Findings that did NOT reach `patch` (rationale):**

- `Boolean(response.data.degraded)` accepts truthy non-boolean values
  (e.g. `'true'`, `1`). Locked in iter-1 residual-risks with "future
  hardening pass could enforce `=== true`" — an explicit defer, not silently
  dropped. Out of scope for this iteration per the original author.
- DOM-vs-computed verification gap on the 4 stubbier negative tests (the
  'does not render … before any search has run', 'clears … when resetSearch',
  'clears … when a search fails', 'clears … when envelope is malformed' tests
  assert `wrapper.vm.banner === null` but not `wrapper.find('[data-test-id="degraded-banner"]').exists()`).
  The 3 sibling positive-side tests DO assert DOM existence. The Vue `v-if`
  binding is straightforward and the current template hardening is solid; the
  gap is documentation-level only. Within scope to mention; below the bar for
  an iter-2 patch on a converged story.
- Concurrent-search race (`lastResponseDegraded` reflects whichever in-flight
  request resolves last when a user clicks Search multiple times). Pre-existing
  in `performSearch`; not introduced or amplified by this story's code in a way
  that warrants a follow-up.

### Verification performed (iter 2)

- Re-confirmed all iter-1 patches still hold:
  - `lastResponseDegraded` is reset in the `performSearch()` `else` branch
    (line ~373).
  - Banner `role="status"` (not `"alert"`) on line ~166.
  - Malformed-envelope test present at `LogSearchDialog.test.js:739`.
- Re-confirmed i18n parity: all 14 locale files include `admin.logSearch.degraded`.
- `cd components/gov-chat-frontend && rtk proxy npx prettier --check src/components/LogSearchDialog.vue src/__tests__/components/LogSearchDialog.test.js src/i18n/locales/{ar,bn,de,en,es,fr,id,man,pt,ru,st,sw,th,zh}.js`
  → "All matched files use Prettier code style!"
- `node_modules/.bin/jest src/__tests__/components/LogSearchDialog.test.js`
  → 68/68 pass (61 pre-existing + 7 new).

### Follow-up review recommendation (iter 2)

Score: 0 patches × (no high + no medium + no low) = 0 < 5 →
`followup_review_recommended: false`.

Story 5.7 converges. No new actionable defects surfaced.

### Verification performed

- `node_modules/.bin/jest src/__tests__/components/LogSearchDialog.test.js`:
  68/68 tests pass (61 pre-existing + 7 new for the degraded banner).
- Full frontend suite re-run (`node_modules/.bin/jest`): 1252/1252 tests pass.
- `rtk proxy npx prettier --check` on all changed files (Vue + tests + 14
  locale files): "All matched files use Prettier code style!"

### Residual risks

- Several non-EN locales (man, st, sw, th) ship the canonical EN string for
  the new key. This is a pre-existing project-wide i18n concern tracked in
  memory; low-resource translations need native review.
- `Boolean(response.data.degraded)` accepts truthy non-boolean values. The
  VictoriaLogs envelope contract is expected to be a strict JSON boolean, but
  if upstream changes the encoding this would silently over-trigger. A
  future hardening pass could enforce `=== true`.

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#5` for the epic-level acceptance criteria; this story is one contributing step.

**Concrete acceptance (added by Epic 5 review):**
- `computed.banner` reads `response.data.degraded` (axios envelope; NOT `response.degraded`) — spec wording imprecise.
- Add `admin.logSearch.degraded` i18n key to ALL 14 locale files: `ar.js`, `bn.js`, `de.js`, `en.js`, `es.js`, `fr.js`, `id.js`, `man.js`, `pt.js`, `ru.js`, `st.js`, `sw.js`, `th.js`, `zh.js`. Canonical EN string: "Showing partial results due to VictoriaLogs outage. Some recent log entries may be missing."
- Per CLAUDE.md Language Policy + `.claude/custom_instructions.md` i18n audit rules: NO English-only shipping.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`
