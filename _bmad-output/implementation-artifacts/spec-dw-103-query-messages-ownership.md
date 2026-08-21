---
title: 'Add userId ownership validation to GET /query/:queryId/messages'
type: 'bugfix'
created: '2026-08-13'
status: 'done'
baseline_revision: '941be5e3aa912b5c911d3302e3535e56c6c474aa'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: []
deferred:
  - summary: >-
      Query document without userId field returns 403 instead 404
    evidence: |-
      Legacy/orphan queries missing userId field cause ownerIds[0] to be undefined,
      triggering forbidden response instead of not-found. Pre-existing data quality issue.
    location: >-
      components/gov-chat-backend/services/chat-history-service.js:findMessagesForQuery
    severity: medium
  - summary: >-
      Route logs userId in plain text (PII concern)
    evidence: |-
      logger.info includes userId which may contain sensitive identifier data.
      Pre-existing logging pattern across all routes.
    location: >-
      components/gov-chat-backend/routes/chat-history-routes.js:635
    severity: medium
  - summary: >-
      No rate limiting on endpoint (enumeration attack surface)
    evidence: |-
      Attacker can brute-force query IDs to enumerate valid queries (403 vs 404).
      Pre-existing security concern affecting all endpoints.
    location: >-
      components/gov-chat-backend/routes/chat-history-routes.js:625-637
    severity: medium
  - summary: >-
      Error-message string matching for 403 detection is fragile
    evidence: |-
      query-routes.js catches all errors then checks error.message === 'Access denied'.
      Any future throw new Error('Access denied') from unrelated source gets misclassified as 403.
      Should use typed error or consistent result-object pattern.
    location: >-
      components/gov-chat-backend/routes/query-routes.js:939
    severity: medium
  - summary: >-
      Ownership lookup adds extra DB round-trip (TOCTOU gap)
    evidence: |-
      chat-history-service.js runs TWO queries per request: first for ownership check,
      then for messages. Can combine into single AQL using LET. Cuts latency and eliminates
      TOCTOU window between check and fetch.
    location: >-
      components/gov-chat-backend/services/chat-history-service.js:956-993
    severity: low
  - summary: >-
      Mixed return-type pattern forces repetitive unpacking
    evidence: |-
      findMessagesForQuery returns array | {forbidden: true} | null. Both route handler
      and query-service.js must each check for null, then forbidden, then treat as array.
      A Result type would make contract explicit.
    location: >-
      components/gov-chat-backend/services/chat-history-service.js:findMessagesForQuery
    severity: low
  - summary: >-
      query-service converts forbidden sentinel to thrown error (impedance mismatch)
    evidence: |-
      getConversationsForQuery receives {forbidden: true} then throws Error('Access denied'),
      which query-routes.js catches by string matching. This round-trip is fragile.
      Service could return sentinel directly.
    location: >-
      components/gov-chat-backend/services/query-service.js:1460-1470
    severity: low
  - summary: >-
      Ownership check creates information leakage via timing
    evidence: |-
      Two-phase approach (check ownership first, then fetch data) creates timing side-channel.
      Attacker can probe whether queryId exists (null → 404) vs belongs to someone else
      ({forbidden} → 403) with different response times.
    location: >-
      components/gov-chat-backend/services/chat-history-service.js:956-993
    severity: low
---

<intent-contract>

## Intent

**Problem:** `GET /query/:queryId/messages` at `chat-history-routes.js:625-637` extracts `queryId` but never validates the caller owns the query. Any authenticated user can access any query's messages — pre-existing security gap.

**Approach:** Extract `userId` from `req` via `extractUserId(req)`, pass to `findMessagesForQuery`, verify ownership via AQL filter (`query.userId == userId`), return 403 if mismatch.

## Boundaries & Constraints

**Always:** Use existing `extractUserId(req)` helper (line 7-13 of `chat-history-routes.js`). Return 403 (not 404) for ownership mismatch to avoid leaking query existence. Follow existing route patterns (see `GET /conversations` at line 64-103).

**Block If:** None — intent fully specified.

**Never:** Do not modify `queries` collection schema. Do not change route signature (keep `queryId` as path param). Do not add new dependencies.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Owner access | Authenticated user A owns query Q | 200 with messages array | No error |
| Non-owner access | Authenticated user B does NOT own query Q | 403 `{ success: false, message: 'Access denied' }` | Ownership mismatch |
| Query not found | Query Q does not exist | 404 `{ success: false, message: 'Query not found' }` | Not found |
| Missing userId | `req.user.iss_sub` is null/undefined | 400 `{ success: false, message: 'User ID is required' }` | No user context |

</intent-contract>

## Code Map

- `components/gov-chat-backend/routes/chat-history-routes.js:625-637` -- vulnerable route (no userId check)
- `components/gov-chat-backend/routes/chat-history-routes.js:7-13` -- `extractUserId(req)` helper
- `components/gov-chat-backend/routes/chat-history-routes.js:64-103` -- ownership check pattern (extract userId, validate, pass to service)
- `components/gov-chat-backend/services/chat-history-service.js:956-993` -- `findMessagesForQuery(queryId)` — needs userId param + ownership check
- `components/gov-chat-backend/routes/query-routes.js:155` -- queries have `userId` field at creation (`queryData = { ...req.body, userId }`)

## Tasks & Acceptance

**Execution:**
- `components/gov-chat-backend/routes/chat-history-routes.js` -- add `const userId = extractUserId(req)` at line 626, validate userId (return 400 if null), pass userId to `chatHistoryService.findMessagesForQuery(queryId, userId)` -- enforce ownership at route level
- `components/gov-chat-backend/services/chat-history-service.js` -- update `findMessagesForQuery(queryId, userId)` signature, add AQL filter `FILTER q.userId == ${userId}` after `FOR q IN queries` (line 962), return null if no match -- verify ownership in query
- `components/gov-chat-backend/routes/chat-history-routes.js` -- after service call, check if result is null, return 404 if query not found, return 403 if userId mismatch (service returns `{ forbidden: true }`) -- handle ownership errors
- `components/gov-chat-backend/__tests__/routes/chat-history-routes.test.js` -- add test: owner gets 200, non-owner gets 403, missing userId gets 400, query not found gets 404 -- verify security fix

**Acceptance Criteria:**
- Given authenticated user A owns query Q, when user A calls `GET /api/chat/query/Q/messages`, then response is 200 with messages array
- Given authenticated user B does NOT own query Q, when user B calls `GET /api/chat/query/Q/messages`, then response is 403 with `{ success: false, message: 'Access denied' }`
- Given query Q does not exist, when any authenticated user calls `GET /api/chat/query/Q/messages`, then response is 404 with `{ success: false, message: 'Query not found' }`
- Given request has no `req.user.iss_sub`, when calling `GET /api/chat/query/Q/messages`, then response is 400 with `{ success: false, message: 'User ID is required' }`

## Spec Change Log

## Review Triage Log

### 2026-08-13 — Review pass (repair session)
- intent_gap: 0
- bad_spec: 0
- patch: 2 (query-routes.js null guard + test)
- defer: 5 (error string matching, DB round-trip, mixed return type, throws-then-catches, timing side-channel)
- reject: 4 (redundant test, no 500 test, literal string, no queryId validation)
- addressed_findings:
  - `[high]` `[patch]` query-routes.js missing userId null guard → added `if (!userId) return 400`
  - `[medium]` `[patch]` No test for undefined userId in query-routes → added test case

### 2026-08-13 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 3 (medium: query without userId field, PII logging, rate limiting)
- reject: 9
- addressed_findings:
  - none

### 2026-08-13 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1 (high: query-service.js missing userId param → fixed)
- defer: 3 (medium: 404 vs 403 for non-owner, TOCTOU gap, service return polymorphism)
- reject: 9 (low: test style, edge cases, cosmetic)
- addressed_findings:
  - `[high]` `[patch]` query-service.js:1460 calls findMessagesForQuery without userId → added userId param, handle null/forbidden returns, added tests

## Verification

**Commands:**
- `cd components/gov-chat-backend && npm test -- chat-history-routes.test.js` -- expected: all tests pass including new ownership tests
- `cd components/gov-chat-backend && npm run lint` -- expected: no lint errors

**Manual checks (if no CLI):**
- Inspect `chat-history-routes.js:625-637` — confirm `extractUserId(req)` called, userId validated, passed to service
- Inspect `chat-history-service.js:956-993` — confirm `findMessagesForQuery` accepts userId param, AQL includes `FILTER q.userId == ${userId}`
- Inspect test file — confirm 4 test cases: owner access, non-owner access, query not found, missing userId

## Auto Run Result

**Summary:** Added userId ownership validation to `GET /query/:queryId/messages` and `GET /queries/:queryId/conversations` endpoints. Service layer checks query ownership via AQL filter, returns 403 for mismatch, 404 for not found, 400 for missing userId.

**Files changed:**
- `components/gov-chat-backend/routes/chat-history-routes.js` — extract userId, validate, pass to service, handle null/forbidden returns
- `components/gov-chat-backend/routes/query-routes.js` — extract userId, validate, pass to service, handle Access denied error
- `components/gov-chat-backend/services/chat-history-service.js` — add userId param to findMessagesForQuery, ownership lookup query, return null/forbidden/array
- `components/gov-chat-backend/services/query-service.js` — add userId param to getConversationsForQuery, handle null/forbidden returns
- `components/gov-chat-backend/__tests__/routes/chat-history-routes.test.js` — add 4 test cases (200/403/404/400)
- `components/gov-chat-backend/__tests__/routes/query-routes.test.js` — add 403 + 400 test cases
- `components/gov-chat-backend/__tests__/services/chat-history-service.test.js` — update tests for new signature + ownership checks
- `components/gov-chat-backend/__tests__/services/query-service.test.js` — update tests for new signature + error handling
- `components/gov-chat-backend/__tests__/routes/chat.test.js` — update assertion for new signature

**Review findings breakdown:**
- Patches applied: 2 (query-routes null guard + test)
- Items deferred: 5 (error string matching, DB round-trip, mixed return type, throws-then-catches, timing side-channel) — added to frontmatter deferred list (total now 8)
- Items rejected: 4 (redundant test, no 500 test, literal string, no queryId validation)

**Follow-up review recommended:** true — 1 high-severity patch applied (query-routes null guard). Score: 1 high + 1 medium.

**Verification performed:**
- `npm test` — 1657 tests passed (63 suites)
- `npm run lint` — no issues
- `npm run format:check` — all files formatted
- CI pipeline 6089 — success

**Residual risks:**
- Legacy queries missing userId field return 403 instead of 404 (deferred, pre-existing data quality issue)
- Ownership check adds extra DB round-trip (deferred, optimization opportunity)
- Timing side-channel for query existence enumeration (deferred, security concern)

