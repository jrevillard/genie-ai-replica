---
title: 'Backend Test Coverage Gaps'
type: 'chore'
created: '2026-08-13'
status: 'done'
baseline_revision: '07775b44eaecbdb738c9535718cf1d166bb502c9'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [multiple-goals]
deferred:
  - summary: >-
      Missing test for undefined/missing locale parameter in analytics satisfaction endpoints
    evidence: |-
      Controller destructures locale from req.query but no test verifies behavior when locale not provided. Service defaults to 'en' but untested.
    location: >-
      components/gov-chat-backend/__tests__/controllers/analyticsController.test.js:236-244
    severity: low
  - summary: >-
      Missing test for invalid locale format (special characters, excessively long strings)
    evidence: |-
      No validation exists or is tested for locale parameter format. Invalid values pass through to service.
    location: >-
      components/gov-chat-backend/controllers/analyticsController.js:202,231
    severity: low
  - summary: >-
      Auth guard coverage incomplete beyond 5 representative endpoints
    evidence: |-
      DW-119 rationale states "representative sampling sufficient" but 21 additional endpoints lack explicit 401 tests. Middleware applied at router level via router.use() makes exhaustive testing redundant.
    location: >-
      components/gov-chat-backend/__tests__/routes/chat-history-routes.test.js:148-183
    severity: low
  - summary: >-
      Missing ForbiddenError specificity check in reorderFolders non-existent folderId test
    evidence: |-
      Test uses generic .rejects.toThrow() instead of verifying ForbiddenError specifically. Source code throws ForbiddenError at line 2312.
    location: >-
      components/gov-chat-backend/__tests__/services/chat-history-service.test.js:784
    severity: low
  - summary: >-
      Missing test for parent folder mismatch in reorderFolders
    evidence: |-
      Source code validates folder's parentFolderId matches target parent (lines 2329-2332) and throws error, but no test covers this path.
    location: >-
      components/gov-chat-backend/services/chat-history-service.js:2329-2332
    severity: low
  - summary: >-
      Missing test for transaction abort during reorderFolders update phase
    evidence: |-
      Only permission-check error path tested. Errors during trx.step() update phase not tested for transaction abort behavior.
    location: >-
      components/gov-chat-backend/services/chat-history-service.js:2336-2350
    severity: low
  - summary: >-
      Missing test for duplicate order values in reorderFolders
    evidence: |-
      No test verifies behavior when two folders assigned same order number. No uniqueness check exists in source.
    location: >-
      components/gov-chat-backend/services/chat-history-service.js:2343
    severity: low
  - summary: >-
      Missing test for recursive child folder deletion in deleteFolder with deleteContents=true
    evidence: |-
      Source code shows recursive deletion at lines 1846-1852, but DW-215 test only covers folders without children.
    location: >-
      components/gov-chat-backend/services/chat-history-service.js:1846-1852
    severity: low
  - summary: >-
      Missing test for conversation ownership validation in cascade delete
    evidence: |-
      deleteConversation called at line 1817 but test doesn't verify conversations belong to requesting user before deletion.
    location: >-
      components/gov-chat-backend/services/chat-history-service.js:1817
    severity: low
  - summary: >-
      Missing test for limit=0 causing division by zero in searchQueries pagination
    evidence: |-
      Math.ceil(totalCount / limit) at line 1046 would produce Infinity when limit=0. No test covers this edge case.
    location: >-
      components/gov-chat-backend/services/query-service.js:1046
    severity: low
  - summary: >-
      Missing test for negative offset values in searchQueries
    evidence: |-
      Pagination tests only cover positive offsets. Negative offset behavior untested.
    location: >-
      components/gov-chat-backend/__tests__/services/query-service.test.js:291-328
    severity: low
  - summary: >-
      Missing test documenting getTimeSeriesData doesn't propagate locale parameter
    evidence: |-
      Inconsistency: gauge/heatmap propagate locale but getTimeSeriesData doesn't. Not captured in tests.
    location: >-
      components/gov-chat-backend/controllers/analyticsController.js
    severity: low
  - summary: >-
      Missing test for empty string locale vs undefined locale behavior difference
    evidence: |-
      locale="" and locale=undefined may behave differently but no test verifies.
    location: >-
      components/gov-chat-backend/controllers/analyticsController.js:202,231
    severity: low
  - summary: >-
      Missing verification of mockFolderConversations.remove called with correct _key values
    evidence: |-
      DW-215 test checks call count but not actual link keys being deleted.
    location: >-
      components/gov-chat-backend/__tests__/services/chat-history-service.test.js:846-850
    severity: low
  - summary: >-
      Missing test for non-numeric or negative order values in reorderFolders
    evidence: |-
      Input validation gap: no test for order values that are non-numeric or negative.
    location: >-
      components/gov-chat-backend/services/chat-history-service.js:2343
    severity: low
  - summary: >-
      Missing test for expired/malformed/unauthorized token scenarios in auth guard
    evidence: |-
      Auth guard tests only verify missing token → 401. Expired JWT, invalid signature, valid token without permissions not tested.
    location: >-
      components/gov-chat-backend/__tests__/routes/chat-history-routes.test.js:148-183
    severity: low
  - summary: >-
      Missing test for PUT/PATCH HTTP methods without authentication
    evidence: |-
      Auth guard coverage incomplete for all HTTP methods. PUT and PATCH endpoints not tested for 401 response.
    location: >-
      components/gov-chat-backend/__tests__/routes/chat-history-routes.test.js:148-183
    severity: low
  - summary: >-
      Missing test for empty/null folderIds array in reorderFolders
    evidence: |-
      No test verifies behavior with empty array or null/undefined folderIds parameter.
    location: >-
      components/gov-chat-backend/services/chat-history-service.js:2295-2300
    severity: low
  - summary: >-
      Missing test for folder ownership check (folder owned by different user)
    evidence: |-
      No test verifies folder owned by user-2 accessed by user-1 throws ForbiddenError.
    location: >-
      components/gov-chat-backend/services/chat-history-service.js:2300-2313
    severity: low
  - summary: >-
      Missing test for deleteContents=false path with folder containing conversations
    evidence: |-
      deleteContents=false not tested for folder with conversations. May leave orphaned conversation links.
    location: >-
      components/gov-chat-backend/services/chat-history-service.js:1811
    severity: low
  - summary: >-
      Missing test for decimal offset/limit values (type coercion)
    evidence: |-
      No test verifies integer coercion or rejection for decimal pagination parameters.
    location: >-
      components/gov-chat-backend/services/query-service.js:1019-1047
    severity: low
  - summary: >-
      Analytics records/events routes lack route-level verification for parsePositiveInt max cap
    evidence: |-
      GET /api/analytics/records and /events use parsePositiveInt with max:100 but no test sends limit=500 to verify cap. Unit tested in validation-utils.test.js but not at route integration level.
    location: >-
      components/gov-chat-backend/routes/analytics-routes.js:465-466,521-522
    severity: low
---

<intent-contract>

## Intent

**Problem:** Backend test suite has 5 coverage gaps identified in deferred-work ledger: folder reorder edge cases (DW-84), locale propagation on satisfaction endpoints (DW-113), auth guard tests only cover 2/15 endpoints (DW-119), pagination boundary scenarios (DW-134), deleteFolder cascade removal verification (DW-215). All gaps are nice-to-have hardening, not blocking.

**Approach:** Add targeted test assertions to existing test files. No new features, no production code changes. Each DW item adds 2-5 test cases covering missing edge cases, parameter propagation, or side-effect verification.

## Boundaries & Constraints

**Always:**
- Add tests to existing test files, no new files unless justified
- Follow existing test patterns (describe/it/expect, jest.mock, supertest)
- Use Given/When/Then format for acceptance criteria
- Mock external dependencies (ArangoDB, Redis) at module level
- Verify both happy path and error cases

**Block If:**
- Production code needs changes to make tests pass (indicates bug, not just missing test)
- Test requires breaking existing test patterns or introducing new mocking strategy

**Never:**
- Modify production code
- Add integration tests requiring real database
- Duplicate existing test coverage
- Skip error handling verification

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| DW-84: duplicate folder IDs | folderOrders=[{id:A,order:1},{id:A,order:2}] | Service processes both (no dedup) | No error, both updates attempted |
| DW-84: non-existent folderId | folderOrders=[{id:MISSING,order:1}] | Permission check throws | NotFoundError or permission error |
| DW-113: locale propagation | GET /satisfaction/gauge?locale=fr | Service called with locale='fr' | Default 'en' if no locale |
| DW-119: auth guard | Request without Bearer token | 401 Unauthorized | Auth middleware rejects |
| DW-134: zero results | searchQueries with totalCount=0 | pages=0, currentPage=1, empty results | No error |
| DW-134: exact boundary | totalCount=10, limit=10 | pages=1 | No error |
| DW-215: cascade removal | deleteFolder with 3 conversations | Each conversation link removed individually | Transaction rollback on failure |

</intent-contract>

## Code Map

**DW-84: Folder reorder edge cases**
- `components/gov-chat-backend/__tests__/services/chat-history-service.test.js` -- existing reorderFolders tests at line 674-743
- `components/gov-chat-backend/services/chat-history-service.js` -- reorderFolders method at line 2291-2350
- `components/gov-chat-backend/__tests__/routes/chat-history-routes.test.js` -- route tests at line 462-505

**DW-113: Locale propagation on satisfaction endpoints**
- `components/gov-chat-backend/__tests__/routes/analytics.test.js` -- satisfaction gauge/heatmap tests at line 468-515
- `components/gov-chat-backend/__tests__/controllers/analyticsController.test.js` -- controller tests at line 227-268
- `components/gov-chat-backend/controllers/analyticsController.js` -- locale extraction at line 202, 213, 231, 242
- `components/gov-chat-backend/services/analytics-service.js` -- locale parameter at line 598, 769

**DW-119: Auth guard tests**
- `components/gov-chat-backend/__tests__/routes/chat-history-routes.test.js` -- 0 auth guard tests, 26 endpoints
- `components/gov-chat-backend/routes/chat-history-routes.js` -- all endpoints need auth middleware
- Pattern: existing route tests use `request(app).get(...).set('Authorization', 'Bearer ...')` with missing token → 401

**DW-134: Pagination boundary scenarios**
- `components/gov-chat-backend/__tests__/services/query-service.test.js` -- pagination tests at line 258, 284, 708, 727
- `components/gov-chat-backend/services/query-service.js` -- pagination calc at line 1042-1047, 1255-1258
- `components/gov-chat-backend/__tests__/routes/chat-history-routes.test.js` -- pagination validation at line 709-745

**DW-215: deleteFolder cascade removal**
- `components/gov-chat-backend/__tests__/services/chat-history-service.test.js` -- deleteFolder tests at line 351-352, 754-780
- `components/gov-chat-backend/services/chat-history-service.js` -- deleteFolder at line 1768-1865
- Cascade steps: folderConversations.remove (line 1804-1808), deleteConversation (line 1812-1822), userFolders edge removal (line 1826-1832), folders.remove (line 1862)

## Tasks & Acceptance

**Execution:**

**DW-84: Folder reorder edge cases**
- `components/gov-chat-backend/__tests__/services/chat-history-service.test.js` -- add 3 tests to `reorderFolders` describe block: (1) duplicate folder IDs in array, (2) non-existent folderId throws permission/not-found error, (3) mixed valid/invalid IDs abort on first error -- verify edge cases in validation loop

**DW-113: Locale propagation**
- `components/gov-chat-backend/__tests__/controllers/analyticsController.test.js` -- add 2 assertions to existing satisfaction tests: (1) verify `getSatisfactionGaugeData` called with locale arg from req.query, (2) verify `getSatisfactionHeatmapData` called with locale arg -- close gap between controller extracting locale and service receiving it
- `components/gov-chat-backend/__tests__/routes/analytics.test.js` -- add 2 route-level tests: (1) GET /satisfaction/gauge?locale=fr → service called with 'fr', (2) GET /satisfaction/heatmap?locale=es → service called with 'es' -- verify end-to-end propagation

**DW-119: Auth guard coverage**
- `components/gov-chat-backend/__tests__/routes/chat-history-routes.test.js` -- add auth guard tests for 5 representative endpoints: GET /conversations, POST /conversations, GET /folders, POST /folders/reorder, DELETE /folders/:folderId -- sample across CRUD operations, not exhaustive (middleware applied at router level)

**DW-134: Pagination boundaries**
- `components/gov-chat-backend/__tests__/services/query-service.test.js` -- add 4 boundary tests to `searchQueries` describe: (1) totalCount=0 → pages=0, currentPage=1, empty results, (2) totalCount=limit → pages=1, (3) offset beyond totalCount → empty results, (4) limit=1 → pages=totalCount -- verify Math.ceil/floor edge cases

**DW-215: deleteFolder cascade verification**
- `components/gov-chat-backend/__tests__/services/chat-history-service.test.js` -- enhance existing deleteFolder test (line 754) to verify: (1) `folderConversations.remove` called for each link, (2) `folders.remove` called, (3) `deleteConversation` called per conversation when deleteContents=true -- move beyond no-throw assertion to side-effect verification

**Acceptance Criteria:**

- Given reorderFolders called with duplicate folder IDs, when processing array, then both entries processed (no dedup logic exists)
- Given reorderFolders called with non-existent folderId, when permission check runs, then NotFoundError or permission error thrown
- Given GET /satisfaction/gauge?locale=fr, when controller handles request, then getSatisfactionGaugeData called with locale='fr'
- Given GET /satisfaction/heatmap?locale=es, when controller handles request, then getSatisfactionHeatmapData called with locale='es'
- Given request to chat-history endpoint without Bearer token, when middleware runs, then 401 Unauthorized returned
- Given searchQueries with totalCount=0, when pagination calculated, then pages=0, currentPage=1, empty results array
- Given searchQueries with totalCount=10 and limit=10, when pagination calculated, then pages=1
- Given deleteFolder with 3 conversations and deleteContents=true, when cascade executes, then folderConversations.remove called 3 times, deleteConversation called 3 times, folders.remove called once

## Spec Change Log

- 2026-08-13: Implemented all 5 DW items (DW-84, DW-113, DW-119, DW-134, DW-215). 225 lines added, 9 removed. 1697 tests pass, 0 failures.

## Review Triage Log

### 2026-08-13 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 21 (all low severity)
- reject: 1
- addressed_findings:
  - none

## Design Notes

All 5 DW items are test-only additions. No production code changes. Each item adds 2-5 test cases to existing test files. Auth guard tests (DW-119) sample 5 representative endpoints rather than exhaustively testing all 26 chat-history endpoints, since middleware applied at router level via `router.use()` — representative sampling sufficient per DW-119 rationale.

## Verification

**Commands:**
- `cd components/gov-chat-backend && npm test -- __tests__/services/chat-history-service.test.js` -- expected: all reorderFolders and deleteFolder tests pass
- `cd components/gov-chat-backend && npm test -- __tests__/controllers/analyticsController.test.js` -- expected: satisfaction gauge/heatmap tests pass with locale assertions
- `cd components/gov-chat-backend && npm test -- __tests__/routes/analytics.test.js` -- expected: satisfaction route tests pass with locale propagation
- `cd components/gov-chat-backend && npm test -- __tests__/routes/chat-history-routes.test.js` -- expected: auth guard tests return 401 for unauthenticated requests
- `cd components/gov-chat-backend && npm test -- __tests__/services/query-service.test.js` -- expected: pagination boundary tests pass
- `cd components/gov-chat-backend && npm test` -- expected: full backend test suite passes, no regressions

## Auto Run Result

**Summary:** Implemented all 5 deferred-work items (DW-84, DW-113, DW-119, DW-134, DW-215) as test-only additions to existing test files. No production code changes. Total: +225 lines, -9 lines across 5 test files.

**Files changed:**
- `components/gov-chat-backend/__tests__/services/chat-history-service.test.js` (+125/-9) — DW-84: 3 reorderFolders edge case tests (duplicate IDs, non-existent folderId, mixed valid/invalid); DW-215: enhanced deleteFolder test verifying cascade side effects (folderConversations.remove, deleteConversation, folders.remove)
- `components/gov-chat-backend/__tests__/controllers/analyticsController.test.js` (+14) — DW-113: added toLocale propagation assertions for getSatisfactionGaugeData and getSatisfactionHeatmapData
- `components/gov-chat-backend/__tests__/routes/analytics.test.js` (+24) — DW-113: 2 route-level locale propagation tests (gauge with locale=fr, heatmap with locale=es)
- `components/gov-chat-backend/__tests__/routes/chat-history-routes.test.js` (+34) — DW-119: 5 auth guard tests for representative endpoints (GET/POST conversations, GET folders, POST reorder, DELETE folder)
- `components/gov-chat-backend/__tests__/services/query-service.test.js` (+37) — DW-134: 4 pagination boundary tests (totalCount=0, totalCount=limit, offset beyond totalCount, limit=1)

**Review findings breakdown:**
- Patches applied: 0
- Items deferred: 21 (all low severity — pre-existing edge case gaps beyond named DW scope)
- Items rejected: 1 (intent alignment finding hallucinated scope expansion from prior run)

**Follow-up review recommendation:** false
- Patched findings: 0 (0 high, 0 medium, 0 low)
- Score: 3 × 0 + 0 = 0 < 5

**Verification performed:**
- Implementation subagent reported: 64 suites passed, 1697 tests passed, 0 failures in 4.6s
- Matrix test audit: all 7 I/O matrix rows covered by tests (DW-84 duplicate IDs line 754, non-existent folderId line 784; DW-113 locale propagation lines 490, 522; DW-119 auth guard line 148; DW-134 totalCount=0 line 292; DW-215 cascade removal lines 846, 850)
- Full verification commands not re-run (subagent already executed successfully; test environment requires npm install + symlinks not present in worktree)

**Residual risks:**
- 21 deferred low-severity edge cases remain untested (undefined locale, invalid locale format, expired tokens, limit=0 division by zero, negative offset, etc.) — all pre-existing gaps beyond named DW scope
- Intent alignment auditor confused this run with prior dw-backend-input-validation work; actual diff is clean test-only for 5 named entries
- Test environment setup (npm install, shared-lib symlink) required for local verification but not committed
