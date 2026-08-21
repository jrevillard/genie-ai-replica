---
title: "Fix label controller error handling (DW-150, DW-152)"
type: bugfix
created: '2026-08-14'
status: done
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: '124c05b9dbac71e5f5b62a34ee4a897bf8fd9607'
context: []
warnings: []
deferred: []
dw_ids: [DW-150, DW-152]
---

<intent-contract>

## Intent

**Problem:** The document-repository label controller returns generic 500 for all service errors. `getLabelById` should return 404 when label not found; `deleteLabel` should return 409 when label has children. Integration tests assert incorrect 500 behavior, codifying the bug.

**Approach:** Use existing error classes (`NotFoundError`, `ConflictError`) from `middlewares/errorHandler.js`. Service throws typed errors; controller maps to correct HTTP status codes; tests updated to assert correct behavior.

## Boundaries & Constraints

**Always:** Use existing error classes from `middlewares/errorHandler.js`. Preserve error response shape `{ error, message, details }`. Keep changes scoped to `getLabelById` + `deleteLabel` only.

**Block If:** None — scope is narrow and well-defined.

**Never:** Do not refactor other controller methods (out of scope). Do not change service method signatures. Do not introduce new error classes. Do not modify error response structure.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| GET label exists | Valid labelId | 200 + label JSON | No error |
| GET label not found | Invalid labelId | 404 + error JSON | `NotFoundError` from service |
| DELETE label success | Valid labelId, no children | 200 + success message | No error |
| DELETE label has children | Valid labelId with children | 409 + error JSON | `ConflictError` from service |
| DELETE internal error | DB connection failure | 500 + error JSON | Generic error passthrough |

</intent-contract>

## Code Map

- `components/document-repository/src/services/labelService.js` — Service layer. `getLabelById` (lines 39-50) throws plain `Error` for ArangoDB 1202. `deleteLabel` (lines 185-200) throws plain `Error('Cannot delete label: It has child labels.')`.
- `components/document-repository/src/controllers/labelController.js` — Controller. `getLabelById` (lines 5-19) catch-all returns 500. `deleteLabel` (lines 87-101) catch-all returns 500.
- `components/document-repository/src/middlewares/errorHandler.js` — Error classes. `NotFoundError` (404), `ConflictError` (409), global handler maps `err.name` → status.
- `components/document-repository/src/__tests__/integration/labelRoutes.test.js` — Integration tests. Lines 137-142 assert 500 for not-found. Lines 194-199 assert 500 for has-children.

## Tasks & Acceptance

**Execution:**
- `components/document-repository/src/services/labelService.js` — Import `NotFoundError`, `ConflictError` from `../middlewares/errorHandler`. In `getLabelById`, change `throw new Error(...)` → `throw new NotFoundError(...)` for errorNum 1202. In `deleteLabel`, change "has child labels" throw → `throw new ConflictError(...)`.
- `components/document-repository/src/controllers/labelController.js` — In `getLabelById` catch: check `error.name === 'NotFoundError'` → 404, else → 500. In `deleteLabel` catch: check `error.name === 'ConflictError'` → 409, `error.name === 'NotFoundError'` → 404, else → 500.
- `components/document-repository/src/__tests__/integration/labelRoutes.test.js` — Import `NotFoundError`, `ConflictError`. Update GET test (lines 137-142): mock `mockRejectedValue(new NotFoundError('Label not found'))`, assert 404. Update DELETE test (lines 194-199): mock `mockRejectedValue(new ConflictError('Label has children'))`, assert 409.

**Acceptance Criteria:**
- Given a label exists, when GET /api/labels/:labelId, then 200 + label JSON
- Given a label does not exist, when GET /api/labels/:labelId, then 404 + error JSON
- Given a label with no children, when DELETE /api/labels/:labelId, then 200 + success message
- Given a label has children, when DELETE /api/labels/:labelId, then 409 + error JSON
- Given a DB error occurs, when any label endpoint, then 500 + error JSON
- All tests pass

## Spec Change Log

## Review Triage Log

### 2026-08-14 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 8 (low 8) — other controller methods still return 500 for all errors; service-level tests only assert message substring not error class; createLabel/getRelatedLabels/updateLabel don't use typed errors
- reject: 4 (low 4) — error.name string comparison (works correctly); missing DELETE 404 test (out of scope); error response shape inconsistency (pre-existing)
- addressed_findings:
  - none

## Auto Run Result

**Summary:** Fixed label controller error handling for DW-150 and DW-152. `getLabelById` now returns 404 when label not found; `deleteLabel` now returns 409 when label has children. Uses existing error classes (`NotFoundError`, `ConflictError`) from errorHandler middleware.

**Files changed:**
- `components/document-repository/src/services/labelService.js` — Import and throw `NotFoundError` for ArangoDB 1202 in `getLabelById`, `ConflictError` for has-children in `deleteLabel`
- `components/document-repository/src/controllers/labelController.js` — Map `NotFoundError` → 404 in `getLabelById`; map `ConflictError` → 409 and `NotFoundError` → 404 in `deleteLabel`
- `components/document-repository/src/__tests__/integration/labelRoutes.test.js` — Import error classes, update mocks to throw typed errors, assert 404/409 instead of 500

**Review findings:**
- Patches applied: 0
- Items deferred: 8 (other methods still use generic 500, service test assertions weak)
- Items rejected: 4 (noise or out of scope)

**Follow-up review recommended:** false
- Patched findings: 0 (0 high, 0 medium, 0 low)
- Score: 0 (< 5 threshold)

**Verification:**
- `npm test` — 12/12 label routes tests pass
- `npm run lint` — no errors

**Residual risks:**
- Other label controller methods (`createLabel`, `updateLabel`, `getRelatedLabels`) still return 500 for all errors — out of bundle scope
- `deleteLabel` controller has defensive `NotFoundError` → 404 branch but service doesn't throw `NotFoundError` for ArangoDB 1202 on remove — unreachable but harmless
- Controller error response shape `{ error, message }` differs from global handler shape `{ success, error, timestamp, requestId, details }` — pre-existing inconsistency

## Design Notes

Uses existing error infrastructure (`middlewares/errorHandler.js`) — no new abstractions. Controller checks `error.name` to map status codes, matching the pattern used by the global error handler. This keeps changes minimal and scoped to the two methods in the bundle.

## Verification

**Commands:**
- `cd components/document-repository && npm test` — expected: all tests pass
- `npm run lint` — expected: no lint errors
