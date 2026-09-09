---
key: 6-4-verify-security_scan_backend-file-fallback-works-no-vl-no-sc
title: verify `SECURITY_SCAN_BACKEND=file` fallback works (no VL, no scan window check)
epic: epic-6
status: done
followup_review_recommended: false
effort: 0.1
depends_on: [6.2]
files: manual smoke
baseline_revision: 31caabf114ad1c749cb77b828c5db6020c3b4e3a
---

# Story 6.4 — verify `SECURITY_SCAN_BACKEND=file` fallback works (no VL, no scan window check)

**Epic**: epic-6 (0.1 SP)
**Files**: `manual smoke`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#6` for the epic-level acceptance criteria; this story is one contributing step.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`

## Review Triage Log

### 2026-09-09 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1 (medium 1, low 0)
- defer: 0
- reject: ~25 (blind-hunter items derived from the diff-summary placeholder sent to the reviewers rather than the real file contents — the 159-line test file with 3 real `describe`/`it` blocks was misreported as a comment-only stub; strict-equality env checks for `file|victorialogs` per AD-14 are intentional and out of scope; observability-span / env-template-doc additions are pre-existing or out of scope; "branch name mismatch" is the orchestrator's name and out of scope; cached.degraded strict-equality is a robustness nit not a defect; speculative uppercase `FILE`/mutated-env scenarios are non-firing; `processLogsInParallel` line-ordering concern misread because the actual branch sits BEFORE `startTime`/`scanEnd`/`retention`)
- addressed_findings:
  - `[medium]` `[patch]` `__tests__/services/security-scan-backend-file-fallback.test.js` — added wrapper-level test that calls `runSecurityScan({})` under `SECURITY_SCAN_BACKEND=file` and asserts the resulting `scanResult.status === 'skipped'`, `scanResult.reason === 'file_backend_no_cache'`, `scanResult.failedLoginDetails` / `suspiciousDetails` are `[]`, `scanResult.degraded === false`, and that `saveScanResults` writes the JSON to `/app/data/security/last-scan-results.json` matching the skipped shape. Closes the verification-gap finding that the existing 3 tests only inspect the inner `processLogsInParallel` result and miss the wrapper's translation + persistence step that the admin route / `getSecurityMetrics` actually consume.

## Auto Run Result

Summary: Implemented the per-call `SECURITY_SCAN_BACKEND=file` escape hatch inside
`SecurityScanService.processLogsInParallel` (the function that touches VictoriaLogs
in the VL path). When the env var is set to `"file"`, the function never queries
VL, never computes the scan window / retention cap, and never enters the cache
miss path. It reads `/app/data/security/last-scan-results.json` via the existing
`checkCachedResults` + AJV path; a valid schema-conformant cache returns the
prior scan's `vulnerabilityDetails` / `failedLoginDetails` / `suspiciousDetails`
with `skipped: false, reason: 'file_backend_cache_hit'`; a cache miss returns
the empty skip contract `{ vulnerabilities:{critical:[],medium:[],low:[]}, failedLogins:[], suspiciousActivities:[], skipped:true, reason:'file_backend_no_cache', degraded:false, error:null }`. The env
read happens inside the function (per AD-6 / ARCHITECTURE-SPINE line 87), not
at module load. The default path (`SECURITY_SCAN_BACKEND=victorialogs` or
unset) is unchanged.

Why this is a code change despite the story's `files: manual smoke` tag: the
rollback escape hatch named in the title did not yet exist in code
(`processLogsInParallel` had no read of `process.env.SECURITY_SCAN_BACKEND`),
the architecture spine mandates `SECURITY_SCAN_BACKEND` as a permanent
per-call escape hatch (AD-6 line 87, AD-14 line 135, CAP-6, rollback-matrix
P3 row), and story 6.2's residual-risks note ("Security-scan
`SECURITY_SCAN_BACKEND=file` rollback behavior remains owned by story 6.4")
is the explicit hand-off. The minimal change is the env-gate branch plus
three tests; nothing else in the file is touched.

Files changed:
- `components/gov-chat-backend/services/security-scan-service.js` — added
  the `SECURITY_SCAN_BACKEND=file` branch at the top of
  `processLogsInParallel` (lines 610-638). 29 lines including comment.
- `components/gov-chat-backend/__tests__/services/security-scan-backend-file-fallback.test.js` — new
  test file, 4 test cases (3 in-process `processLogsInParallel` + 1 wrapper
  `runSecurityScan` test added in the review pass to close the
  verification-gap finding).

Verification:
- `npx jest __tests__/services/security-scan-backend-file-fallback.test.js --runInBand` — 4/4 passed.
- `npx jest __tests__/services/security-scan --runInBand` — 97/97 passed (93 pre-existing + 4 new).
- `npx eslint services/security-scan-service.js __tests__/services/security-scan-backend-file-fallback.test.js` — no issues.
- `npx prettier --check services/security-scan-service.js __tests__/services/security-scan-backend-file-fallback.test.js` — formatted correctly.
- `npx eslint services/security-scan-service.js __tests__/services/security-scan-backend-file-fallback.test.js` — no issues.
- `npx prettier --check services/security-scan-service.js __tests__/services/security-scan-backend-file-fallback.test.js` — formatted correctly.
- Manual review: the `SECURITY_SCAN_BACKEND=file` branch is reached BEFORE the
  `startTime` / `scanEnd` / retention / `vlClient.query` lines, so the VL
  path is fully bypassed; the `_isVlUnavailable` and `VL_FAIL_OPEN` logic
  is not reached because the VL query is never made; the scan-window
  cap (retention < window) is never evaluated.

Residual risks:
- The 1-hour cache freshness window from `checkCachedResults` is preserved
  on purpose. Operators running the rollback for the first time after a
  cold deploy with an empty cache will see the `file_backend_no_cache`
  skipped result; the AD-12 AJV schema is unchanged, so older
  pre-refactor caches are still treated as cache misses (preserves the
  AD-12 invariant).
- The broader backend test run can still report the four pre-existing
  logger-suite failures flagged in story 6.2's residual-risks note when
  `winston-transport` is absent from the isolated `node_modules`. Out of
  scope for this story.
- The implementation does not read `process.env.SECURITY_SCAN_BACKEND`
  through the shared `booleanEnv(name)` helper because the env var is
  a value (`file|victorialogs`), not a boolean — strict equality is the
  correct check. `booleanEnv` is reserved for `LOG_TO_VICTORIALOGS`,
  `LOG_TO_FILE`, `VL_FAIL_OPEN` per AD-14.

Manual smoke (for the operator on a deployed release branch, per
`rollback-matrix.md` P3 row + `feedback_release_validate_before_promote`):

1. Baseline: confirm VL path works. `unset SECURITY_SCAN_BACKEND` (or set
   to `victorialogs`). `curl -sk -X POST "$PUBLIC/api/admin/security-scan"
   -H "Authorization: Bearer $GENIE_TOKEN"` returns a 200 with the full
   `vulnerabilities` shape, no `skipped` field, scan latency < 2 s on a
   7-day window.
2. Flip the escape hatch: `docker service update --env-add
   SECURITY_SCAN_BACKEND=file genieai_gov-chat-backend` (no image
   restart needed; the per-call env read picks it up on the next
   request). Repeat the same `curl`; expect 200 with the same shape
   (served from the AJV-validated cache), `skipped: false`,
   `reason: "file_backend_cache_hit"`, zero VL queries
   (`docker logs genieai_gov-chat-backend | grep -c
   "VL bulk security scan"` should stay flat).
3. Cold-cache case: `docker exec genieai_gov-chat-backend rm
   /app/data/security/last-scan-results.json`. Repeat the curl; expect
   200 with `{vulnerabilities:{critical:[],medium:[],low:[]},
   failedLogins:[], suspiciousActivities:[], skipped:true,
   reason:"file_backend_no_cache"}`. The response surfaces the skip in
   `status: "skipped"` and the warning line in the backend log.
4. Revert: `docker service update --env-rm SECURITY_SCAN_BACKEND
   genieai_gov-chat-backend`. The next request re-enters the VL path
   without a restart (per AD-6 / line 87).
