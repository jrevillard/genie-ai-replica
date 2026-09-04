---
key: 5-9-degradation-test-5xx-econnrefused-enotfound-handling-rate-li
title: "degradation test: 5xx / ECONNREFUSED / ENOTFOUND handling + rate-limit persistence"
epic: epic-5
status: ready-for-dev
effort: 0.25
depends_on: [5.3]
files: components/gov-chat-backend/__tests__/services/logs-vl-degradation.test.js` (new)
---

# Story 5.9 — degradation test: 5xx / ECONNREFUSED / ENOTFOUND handling + rate-limit persistence

**Epic**: epic-5 (0.25 SP)
**Files**: `components/gov-chat-backend/__tests__/services/logs-vl-degradation.test.js` (new)`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#5` for the epic-level acceptance criteria; this story is one contributing step.

**Concrete acceptance (added by Epic 5 review):**
Enumerate all 4 CAP-5 properties required by `phases.md:73` and AD-11:

1. **Rate-limit 1/min**: error log fires AT MOST once per minute when VL is unreachable. Test uses clock-mocked `Date.now()` to advance time and assert second error log is suppressed.
2. **Rate-limit state persists across restart**: `/tmp/vl-fail-open-ts` written as Unix milliseconds; restored in child-process test that re-reads the file and asserts the suppression window is respected.
3. **5 s latency**: with `VL_FAIL_OPEN=true`, `GET /api/admin/logs` returns `{logs:[], total:0, degraded:true}` within 5 s. Test uses `jest.useFakeTimers()` + axios mock that delays.
4. **`VL_FAIL_OPEN=false` (default) surfaces 500 to admin**: test asserts the error path returns 500 (NOT degraded envelope) when flag off.

All 4 properties MUST have at least one `it()` block each.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`
