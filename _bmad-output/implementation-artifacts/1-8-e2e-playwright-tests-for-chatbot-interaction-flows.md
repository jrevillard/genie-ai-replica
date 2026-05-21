# Story 1.8: E2E Playwright Tests for Chatbot Interaction Flows

Status: ready-for-dev

## Story

As a developer,
I want automated Playwright E2E tests for the chatbot interaction flows,
so that critical user journeys through the RAG pipeline are validated in CI.

## Acceptance Criteria

1. **AC1: Full chatbot interaction flow** — Given a deployed stack with the chatbot accessible, when a user sends a message via the chatbot, then the test validates: message appears as user bubble → backend processes via SSE → RAG pipeline retrieves → LLM generates response → frontend displays the streamed bot answer in a bot bubble.

2. **AC2: SSE streaming response rendering** — Given a streaming query is submitted, when SSE `chunk` events arrive, then the test verifies partial text renders progressively in the bot message bubble, and the `done` event finalizes the message with a `queryId`.

3. **AC3: Conversation history persistence** — Given a conversation with messages, when the user saves the chat and later reloads it, then all messages (user + bot) are restored in the correct order with their original content.

4. **AC4: Error handling for RAG unavailability** — Given the RAG pipeline is unavailable (backend returns error), when the user sends a message, then an error message is displayed in the chat and the user can retry.

5. **AC5: CI scheduled job** — Given the `.gitlab-ci.yml` pipeline, when a scheduled pipeline runs, then the Playwright E2E chatbot tests execute as a non-blocking job in the `e2e` stage.

6. **AC6: Performance** — The full E2E chatbot test suite completes within 30 minutes (NFR3).

## Tasks / Subtasks

- [ ] Task 1: Create chatbot E2E test helpers (AC: #1, #2, #3, #4)
  - [ ] Create `tests/e2e/helpers/chatbot.js` — shared helpers for chatbot page interactions (send message, wait for response, get messages, save conversation)
  - [ ] Helpers MUST use existing `tests/e2e/helpers/auth.js` for authentication (reuse `getUserToken`, do NOT reinvent)

- [ ] Task 2: Create chatbot message sending and SSE streaming tests (AC: #1, #2)
  - [ ] Create `tests/e2e/chatbot/send-message-and-stream.spec.js`
  - [ ] Test: send a message → verify user bubble appears → verify SSE stream renders bot response progressively → verify `done` event finalizes with queryId

- [ ] Task 3: Create conversation history persistence tests (AC: #3)
  - [ ] Create `tests/e2e/chatbot/conversation-history.spec.js`
  - [ ] Test: save conversation → reload page → verify messages restored in order
  - [ ] Test: list conversations endpoint returns saved conversation

- [ ] Task 4: Create RAG error handling tests (AC: #4)
  - [ ] Create `tests/e2e/chatbot/error-handling.spec.js`
  - [ ] Test: RAG unavailable → verify error displayed → verify retry possible
  - [ ] Use network interception (`page.route()`) to simulate backend errors

- [ ] Task 5: Add Playwright E2E job to GitLab CI (AC: #5)
  - [ ] Add `e2e:playwright` job to `.gitlab-ci.yml` in the `e2e` stage
  - [ ] Configure as scheduled-only (non-blocking, `allow_failure: true`)
  - [ ] Add JUnit report artifact for GitLab test reporting
  - [ ] Follow cache pattern from story 1.7

- [ ] Task 6: Verify and validate (AC: #6)
  - [ ] Run full test suite locally and confirm <30 min
  - [ ] Verify CI job syntax with `gitlab-ci-lint` or dry-run

## Dev Notes

### Architecture Context

This story creates **scheduled-tier** E2E tests (not mandatory). The pipeline architecture is:

```
lint → test → contract → config → (scheduled: integration → e2e) → (manual: rag-quality)
```

E2E tests only run on scheduled pipelines and do NOT block MRs. The `workflow:rules` in `.gitlab-ci.yml` already includes `$CI_PIPELINE_SOURCE == "schedule"`.

### Existing Infrastructure — Reuse, Do NOT Reinvent

| What | Where | Notes |
|------|-------|-------|
| Playwright config | `playwright.config.js` | baseURL: `https://localhost`, chromium only, JUnit reporter already configured, `ignoreHTTPSErrors: true` |
| Auth helpers | `tests/e2e/helpers/auth.js` | `getUserToken()`, `getAdminToken()`, `parseJwtClaims()`, `request()` — reuse for all authenticated API calls |
| Keycloak admin helpers | `tests/e2e/helpers/keycloak-admin.js` | User/realm management for test setup |
| Root package.json scripts | `package.json` | `test:e2e` and `test:e2e:list` already configured |
| CI e2e stage | `.gitlab-ci.yml` | `e2e` stage exists with `patrol:e2e` mobile job — add alongside it |
| Playwright dependency | `package.json` | `@playwright/test: ^1.51.0` installed at project root |

### Chatbot Selectors (from ChatBotComponent.vue)

| Element | Selector | Purpose |
|---------|----------|---------|
| Input textarea | `.prompt-textarea` | User message input |
| Chat window | `.chat-window` | Scrollable message container |
| User message | `.chat-message.user` | User bubble |
| Bot message | `.chat-message.bot` | Bot bubble |
| Message bubble | `.message-bubble` | Text content within message |
| Loading spinner | `.loading-spinner` | Shown during query processing |
| Save chat button | `button[title="Save Chat"]` | Triggers save dialog |
| Quick help items | `.quick-help-item` | Suggested prompts overlay |
| Context panel | `.context-panel` | Selected service pills |

### API Endpoints (Backend)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/queries/stream` | SSE streaming query (main chat endpoint) |
| POST | `/api/queries` | Non-streaming query (fallback) |
| GET | `/api/chat/conversations` | List user conversations |
| GET | `/api/chat/conversations/{id}` | Get conversation with messages |
| POST | `/api/chat/conversations` | Create new conversation |
| POST | `/api/chat/conversations/{id}/messages` | Add message to conversation |

### SSE Event Types

The streaming endpoint (`/api/queries/stream`) sends newline-delimited JSON events:

| Event | Shape | Purpose |
|-------|-------|---------|
| chunk | `{ type: "chunk", content: "partial text" }` | Progressive response text |
| metadata | `{ type: "metadata", source_documents: [...], confidence_score: 0.87 }` | Retrieval metadata after completion |
| translation | `{ type: "translation", content: "translated" }` | Non-English translation |
| done | `{ type: "done", queryId: "query-id" }` | Stream complete |
| error | `{ type: "error", message: "...", code: "..." }` | Error occurred |
| keepalive | `: keepalive` (SSE comment) | Heartbeat every 15s |

### SSE Testing Strategy in Playwright

Playwright has no native SSE API. Use network interception:

```javascript
// Monitor SSE responses via page event listeners
page.on('response', async (response) => {
  if (response.headers()['content-type']?.includes('text/event-stream')) {
    // SSE connection detected
  }
});

// For error simulation, intercept the streaming endpoint
await page.route('**/api/queries/stream', (route) => {
  route.abort(); // simulate network failure
});
```

For testing actual SSE rendering, do NOT mock — instead verify the frontend behavior (text appears in bot bubble, loading spinner disappears).

### Request Payload for Streaming Query

```javascript
{
  sessionId: "new-session",
  contextOption: "single-message",
  text: "user question",
  context: { language: "EN" },
  timestamp: new Date().toISOString()
}
```

### CI Job Pattern (from Story 1.7)

Follow the established Node.js job pattern. The `e2e:playwright` job should:

```yaml
e2e:playwright:
  extends: .node_base
  stage: e2e
  before_script:
    - npm ci
    - npx playwright install --with-deps chromium
  script:
    - npm run test:e2e -- --filter chatbot/
  cache:
    - key:
        files:
          - package-lock.json
        prefix: e2e-playwright
      paths:
        - node_modules/
      fallback_keys:
        - "e2e-playwright-$CI_DEFAULT_BRANCH"
        - "e2e-playwright-"
  artifacts:
    when: always
    expire_in: 7 days
    reports:
      junit: reports/playwright-report.xml
  rules:
    - if: '$CI_PIPELINE_SOURCE == "schedule"'
      when: on_success
    - if: '$CI_PIPELINE_SOURCE == "web"'
      when: manual
  allow_failure: true
```

Key: `rules` restricts to scheduled and manual web triggers only. `allow_failure: true` makes it non-blocking. Uses `$CI_PIPELINE_SOURCE == "schedule"` which is already whitelisted in `workflow:rules`.

### Test File Naming Convention

Follow existing E2E test structure. Current tests are in subdirectories by topic:

```
tests/e2e/
├── epic1/        # Keycloak foundation (a1, a2, a3, d7a, d7b)
├── epic2/        # Secure API access (g1, h1, i1, j1, k1)
├── epic3/        # Session lifecycle (l1, l2, l3)
├── chatbot/      # ← NEW: Chatbot interaction flows
├── helpers/      # Shared utilities
```

Use descriptive file names: `send-message-and-stream.spec.js`, `conversation-history.spec.js`, `error-handling.spec.js`.

### Module System

All Playwright test files use **CommonJS**: `const { test, expect } = require('@playwright/test')` and `module.exports`. This matches existing test files.

### Authentication in Tests

Existing tests use two patterns:
1. **Page-level auth** — navigate to app, get redirected to Keycloak, fill credentials (see `a2-full-login-flow.spec.js`)
2. **API-level auth** — use `getUserToken()` from helpers for direct API calls (see `j1-opea-continuity.spec.js`)

For chatbot tests, use **page-level auth** since we need the full browser session with SSE support. The login flow is: navigate to `https://localhost/` → Keycloak redirect → fill `#username`/`#password` → submit → verify dashboard.

### Dependencies

| Dependency | Status | Notes |
|------------|--------|-------|
| Story 1.6 (MR blocking, scheduled jobs) | NOT done | CI job `rules` can be configured independently; scheduled triggers already work via `workflow:rules` |
| Story 1.7 (caching, path triggers) | Done | Use established cache patterns for the new job |
| Deployed Docker stack | Required for local testing | Full stack: Keycloak + Backend + Frontend + ArangoDB + OPEA services |
| Test user credentials | Required | `testuser` / `TestPass123!` (same as existing E2E tests) |

### Project Structure Notes

- Test files go in `tests/e2e/chatbot/` — new subdirectory following existing `epic1/`, `epic2/`, `epic3/` pattern
- Helpers go in `tests/e2e/helpers/chatbot.js` — alongside existing `auth.js` and `keycloak-admin.js`
- CI job added to `.gitlab-ci.yml` in the `e2e` stage alongside existing `patrol:e2e`
- `reports/` directory for JUnit XML already configured in `playwright.config.js`

### What This Story Does NOT Cover

- Document upload/search E2E flows (Story 1.9)
- Admin dashboard E2E flows
- Context/service selection flows (tree node interaction)
- Feedback submission flows
- Export functionality
- These are intentionally out of scope for this story

### References

- [Source: docs/e2e-tests/README.md] — Manual E2E test procedures (basis for automation)
- [Source: playwright.config.js] — Playwright configuration
- [Source: tests/e2e/helpers/auth.js] — Auth helper utilities
- [Source: tests/e2e/epic1/a2-full-login-flow.spec.js] — Example page-level auth pattern
- [Source: tests/e2e/epic2/j1-opea-continuity.spec.js] — Example API-level test with auth
- [Source: .gitlab-ci.yml] — CI pipeline with 5 stages, cache patterns, workflow rules
- [Source: _bmad-output/planning-artifacts/architecture.md] — Test ecosystem coordination, E2E tier details
- [Source: _bmad-output/planning-artifacts/epics.md] — Story 1.8 AC and requirements
- [Source: _bmad-output/implementation-artifacts/1-7-configure-ci-caching-and-path-based-triggers.md] — Previous story CI patterns

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
