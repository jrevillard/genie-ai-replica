---
key: 5-10-admin-source-test-toggle-env-mid-suite-assert-no-restart-pat
title: "admin-source test: toggle env mid-suite assert no-restart path switch"
epic: epic-5
status: in-progress
baseline_revision: 5944a35f7c800eb0e2c7ec7dd2fa925af3f0add3
effort: 0.1
depends_on: [5.3]
followup_review_recommended: false
files: components/gov-chat-backend/__tests__/services/logs-service-admin-source.test.js` (new)
---

# Story 5.10 — admin-source test: toggle env mid-suite assert no-restart path switch

**Epic**: epic-5 (0.1 SP)
**Files**: `components/gov-chat-backend/__tests__/services/logs-service-admin-source.test.js` (new)`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#5` for the epic-level acceptance criteria; this story is one contributing step.

## Verification

```bash
cd components/gov-chat-backend
NODE_ENV=test npx jest __tests__/services/logs-service-admin-source.test.js --no-coverage --reporters=default
```

13 tests must pass — covers the per-call `_sourceMode()` re-read (AD-6), the no-restart `getLogsInRange` dispatch between VictoriaLogs and file paths, the same toggle from the `AdminDashboardService.getLogs` admin-source perspective, and the envelope shape preservation across both backends.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`

## Review Triage Log

### 2026-09-08 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 0
- addressed_findings:
  - none

## Auto Run Result

Status: done
Patches applied: 0
Items deferred: 0
Items rejected: 0
Followup review recommended: false (score = 3*0 + 1*0 = 0)

### Summary

Added a focused Jest suite (`logs-service-admin-source.test.js`) that pins
the AD-6 guarantee that `ADMIN_LOGS_SOURCE` is re-read on every
`LogsService.getLogsInRange` call — the operator-facing escape hatch from
D2 must work without a backend restart. The suite proves the same
singleton routes successive calls to different backends (VictoriaLogs vs
on-disk NDJSON) as the env var flips between them, with no
`jest.resetModules()` or `jest.isolateModules()` between calls. The
test is also exercised through the `AdminDashboardService.getLogs` admin
route to assert the toggle is visible at the public surface, not just
the service seam.

### Files changed

- `components/gov-chat-backend/__tests__/services/logs-service-admin-source.test.js` (new, 343 lines)
  - 13 tests across 4 describe blocks: `_sourceMode` per-call re-read,
    `getLogsInRange` mid-suite toggle (4 toggle scenarios including a
    5-step alternating walk that proves the dispatch honours every flip
    on the same singleton), `AdminDashboardService.getLogs`
    admin-source perspective, and a final observability block asserting
    the env is never frozen at module-load.

### Review findings breakdown

- patches applied: 0
- items deferred: 0
- items rejected: 0 (no findings survived classification)
- patched counts by severity: high=0, medium=0, low=0
- score = 3*medium + 1*low = 0 → followup_review_recommended = false

### Verification performed

```bash
cd components/gov-chat-backend
NODE_ENV=test npx jest __tests__/services/logs-service-admin-source.test.js --no-coverage --reporters=default
# Test Suites: 1 passed, 1 total
# Tests:       13 passed, 13 total
# Time:        0.255 s
```

All 13 tests pass on the first run after one self-review correction
(file path's `_getLogsInRangeFromFile` may surface an additional
`degraded` envelope key when the on-disk read hits a non-fatal error
under AD-10 — adjusted the shape-preservation assertion to check
the canonical 4 keys are present in both backends rather than asserting
exact equality of the key set).

### Residual risks

- Suite only exercises the dispatch in the `getLogsInRange` path; the
  same per-call env read also covers `searchLogs` / `getLogsSummary` /
  `debugYesterdayLogs` but those entry points are already covered in
  the existing `logs-service-vl.test.js` (Story 5.3 review-triage) and
  re-stating them here would be duplication.
- The test relies on `setVictoriaLogsClient(...)` to inject the mock
  client; production code lazily constructs the MELT adapter on first
  use (AD-16). If a future refactor switches to constructor-time
  construction, the `beforeEach` injection pattern must move accordingly.
