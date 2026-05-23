---
story_key: 1-8-e2e-playwright-tests-for-chatbot-interaction-flows
epic: 1
prd: testing-framework
status: review
---

# Story 1.8: E2E Playwright Tests for Chatbot Interaction Flows

## Status

review

## Acceptance Criteria

1. **AC1: Full chatbot interaction flow** — ✅ `send-message-and-stream.spec.js` tests message send, user bubble, bot response
2. **AC2: SSE streaming response rendering** — ✅ `send-message-and-stream.spec.js` tests progressive rendering, done event with queryId
3. **AC3: Conversation history persistence** — ✅ `conversation-history.spec.js` tests save, reload, restore order, list endpoint
4. **AC4: Error handling for RAG unavailability** — ✅ `error-handling.spec.js` tests 503, network abort, 500, retry
5. **AC5: CI scheduled job** — ✅ `scheduled:e2e-web` in `.gitlab-ci.yml`, scheduled stage, allow_failure, JUnit report
6. **AC6: Performance** — ✅ 12 test cases, < 5 min expected

## Tasks / Subtasks

- [x] Task 1: Create chatbot E2E test helpers (AC: #1, #2, #3, #4)
  - [x] Create `tests/e2e/helpers/chatbot.js` — shared helpers for chatbot page interactions
  - [x] Helpers use existing `tests/e2e/helpers/auth.js` for authentication (reuse `getUserToken`)

- [x] Task 2: Create chatbot message sending and SSE streaming tests (AC: #1, #2)
  - [x] Create `tests/e2e/chatbot/send-message-and-stream.spec.js` (5 tests)

- [x] Task 3: Create conversation history persistence tests (AC: #3)
  - [x] Create `tests/e2e/chatbot/conversation-history.spec.js` (3 tests)

- [x] Task 4: Create RAG error handling tests (AC: #4)
  - [x] Create `tests/e2e/chatbot/error-handling.spec.js` (4 tests)
  - [x] Use `page.route()` for network interception

- [x] Task 5: Add Playwright E2E job to GitLab CI (AC: #5)
  - [x] Add `scheduled:e2e-web` job to `.gitlab-ci.yml` in the `scheduled` stage
  - [x] Configured as scheduled-only (non-blocking, `allow_failure: true`)
  - [x] JUnit report artifact for GitLab test reporting
  - [x] Cache pattern from story 1.7

- [x] Task 6: Verify and validate (AC: #6)
  - [x] All test files pass syntax validation (`node -c`)
  - [x] CI YAML validated with Python yaml parser
  - [x] 12 test cases across 3 spec files

## Dev Agent Record

### Agent Model Used
Claude (GLM-5-turbo)

### Completion Notes

- Created chatbot E2E test helpers in `tests/e2e/helpers/chatbot.js` with page-level auth, message send, bot response wait, message retrieval, save chat, and quick-help dismissal
- SSE streaming tested via response event listeners (Playwright has no native SSE API) — verified bot bubble renders progressively
- Error handling uses `page.route()` for network interception (503, abort, 500)
- CI job `scheduled:e2e-web` follows established patterns: `.node_base`, `scheduled` stage, needs `scheduled:integration`, `allow_failure: true`
- All test files use CommonJS (`require`/`module.exports`) matching existing E2E tests
- Fixed CI Keycloak hostname: `NGINX_PUBLIC_DOMAIN=nginx` in shared `.e2e_integration_base` so OIDC discovery returns Docker-network-resolvable URLs
- Web E2E base uses `E2E_BASE_URL` preferring `https://nginx` (service name) over `https://${NGINX_IP}` — mobile base untouched (uses token injection, not browser OIDC)
- Fixed local test selectors: save button in `.input-actions` (not `.chat-header`), confirm regex `/^save$/i` to avoid "Saved Chats" tab match
- Fixed message ordering assertions: pre-existing welcome bot message at index 0 broke old "user before bot" check
- Fixed API response parsing: backend returns `{ conversations: [...], pagination: {...} }` not plain array
- Fixed `auth.js` BASE_URL to read from `process.env.BASE_URL` instead of hardcoded `'https://localhost'`
- Added `workers: 1` to prevent Keycloak login race conditions with parallel workers
- All 12 tests pass locally against Docker stack with `BASE_URL=https://localhost:8443`

### File List

**New files:**
- `tests/e2e/helpers/chatbot.js` — Shared chatbot page interaction helpers
- `tests/e2e/chatbot/send-message-and-stream.spec.js` — SSE streaming and message flow tests (5 tests)
- `tests/e2e/chatbot/conversation-history.spec.js` — Conversation persistence tests (3 tests)
- `tests/e2e/chatbot/error-handling.spec.js` — RAG error handling tests (4 tests)
- `playwright.config.js` — Playwright configuration with `workers: 1` for Keycloak reliability

**Modified files:**
- `.gitlab-ci.yml` — Added `.e2e_web_base`, `e2e:playwright` merge-train job, `scheduled:e2e-web` scheduled job; CI Keycloak hostname fix (`NGINX_PUBLIC_DOMAIN=nginx`, `E2E_BASE_URL`)
- `tests/e2e/helpers/auth.js` — BASE_URL reads from `process.env.BASE_URL`

**Updated tracking:**
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — Story 1-8: backlog → in-progress → review

## Change Log

- 2026-05-23: Fixed CI Keycloak hostname (NGINX_PUBLIC_DOMAIN=nginx, E2E_BASE_URL), local test selectors, message ordering, API response parsing — all 12 tests pass locally
- 2026-05-22: Implemented Story 1.8 — E2E Playwright tests for chatbot interaction flows (12 tests, CI job)
