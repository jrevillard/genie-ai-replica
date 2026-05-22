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

5. **AC5: CI integration** — Given the `.gitlab-ci.yml` pipeline, the chatbot Playwright tests use a hidden `.e2e_web_base` template (following `.e2e_mobile_base` pattern from story 1.6). Two jobs extend it: `e2e:playwright` (runs on merge trains in `e2e` stage, depends on `e2e:integration`) and `scheduled:e2e-web` (runs on scheduled pipelines in `scheduled` stage, depends on `scheduled:integration`). Both share the same Docker Compose stack and use merge train + schedule rules aligned with the mobile E2E pattern.

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

- [ ] Task 5: Add `.e2e_web_base` template + two E2E web jobs to GitLab CI (AC: #5)
  - [ ] Expand `e2e:integration` `changes` to include web-relevant paths + remove mobile-specific `needs` (see "CRITICAL: e2e:integration changes" in Dev Notes)
  - [ ] Move `needs: [lint:dart, test:flutter]` from `e2e:integration` to `patrol:e2e` (mobile gates belong on the mobile job, not on shared integration)
  - [ ] Create hidden `.e2e_web_base` template (self-contained, like `.e2e_mobile_base` from story 1.6) with all Playwright logic: docker networking, nginx IP discovery, ROPC setup/cleanup, Playwright install, test execution
  - [ ] Add `e2e:playwright` job extending `.e2e_web_base` in `e2e` stage, with `needs: [e2e:integration]`, rule: `$CI_MERGE_REQUEST_EVENT_TYPE == "merge_train"` with path-based `changes` for web files
  - [ ] Add `scheduled:e2e-web` job extending `.e2e_web_base` in `scheduled` stage, with `needs: [scheduled:integration]`, rule: `$CI_PIPELINE_SOURCE == "schedule"`
  - [ ] Reuse integration Docker Compose stack (same backend for web + mobile)
  - [ ] Connect CI container to compose network, discover nginx IP (same pattern as `.e2e_mobile_base`)
  - [ ] Update `playwright.config.js` to support `baseURL: process.env.BASE_URL || 'https://localhost'` so CI can override via env var
  - [ ] Set `BASE_URL=https://${NGINX_IP}` env var so Playwright targets the live stack via compose network
  - [ ] The job needs `docker` CLI access for networking. Install in `before_script`: `apk add --no-cache docker-cli curl python3`
  - [ ] `retry: max: 2` for flaky tests (same as `.e2e_mobile_base`)
  - [ ] NO `allow_failure` — E2E failures are real regressions
  - [ ] Add JUnit report artifact for GitLab test reporting
  - [ ] Add `mkdir -p reports` in `before_script`
  - [ ] Follow cache pattern from story 1.7

- [ ] Task 6: Verify and validate (AC: #6)
  - [ ] Run full test suite locally and confirm <30 min
  - [ ] Verify CI job syntax with `gitlab-ci-lint` or dry-run

## Dev Notes

### Architecture Context

This story creates E2E tests that run on **merge trains** and **scheduled pipelines**. The pipeline architecture (from story 1.6) uses hidden templates for DRY:

```
.e2e_integration_base  →  e2e:integration (merge train) + scheduled:integration (schedule)
.e2e_mobile_base       →  patrol:e2e (merge train) + scheduled:e2e-mobile (schedule)
.e2e_web_base          →  e2e:playwright (merge train) + scheduled:e2e-web (schedule) ← NEW
```

Stages: `lint → test → contract → config → e2e → scheduled → manual`

- **`e2e` stage**: runs only on merge trains (`$CI_MERGE_REQUEST_EVENT_TYPE == "merge_train"`) with path-based `changes`
- **`scheduled` stage**: runs only on scheduled pipelines (`$CI_PIPELINE_SOURCE == "schedule"`)

Story 1.6 uses mutualized hidden templates (`.e2e_integration_base`, `.e2e_mobile_base`) so both merge-train and scheduled jobs share the same logic. This story follows the same pattern with `.e2e_web_base`.

### Existing Infrastructure — Reuse, Do NOT Reinvent

| What | Where | Notes |
|------|-------|-------|
| Playwright config | `playwright.config.js` | baseURL: `https://localhost` (hardcoded — MUST update to `process.env.BASE_URL \|\| 'https://localhost'` for CI), chromium only, JUnit reporter already configured, `ignoreHTTPSErrors: true` |
| Auth helpers | `tests/e2e/helpers/auth.js` | `getUserToken()`, `getAdminToken()`, `parseJwtClaims()`, `request()` — reuse for all authenticated API calls |
| Keycloak admin helpers | `tests/e2e/helpers/keycloak-admin.js` | User/realm management for test setup |
| Root package.json scripts | `package.json` | `test:e2e` and `test:e2e:list` already configured |
| CI templates (story 1.6) | `.gitlab-ci.yml` | `.e2e_integration_base`, `.e2e_mobile_base` — add `.e2e_web_base` following same pattern. `e2e` stage has merge train jobs, `scheduled` stage has schedule jobs |
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
| Save chat button | `.chat-header button` (last in header) or `DsButton[variant="ghost"]` near header | Triggers `saveChatToHistory()` — title is dynamic i18n (`translate('chatbot.saveChat')`), do NOT use `button[title="Save Chat"]`. Recommend adding `data-testid="save-chat-btn"` to the component for stable targeting. |
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

**Note:** The frontend uses `fetch()` + `ReadableStream` (not `EventSource`) to consume the streaming endpoint. The `text/event-stream` content-type check above may not match the actual response headers. Verify the real content-type before relying on this pattern. The recommended approach is to assert on DOM state (bot bubble text, loading spinner visibility) rather than intercepting the SSE stream.

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

### CI Job Pattern (aligned with `.e2e_mobile_base` from story 1.6)

Story 1.6 introduced mutualized hidden templates for E2E jobs. The same E2E logic runs both on merge trains (pre-merge gate) and on scheduled pipelines (nightly), with only `stage`/`needs`/`rules` differing. Follow this pattern:

```
.e2e_integration_base  →  e2e:integration + scheduled:integration
.e2e_mobile_base       →  patrol:e2e + scheduled:e2e-mobile
.e2e_web_base          →  e2e:playwright + scheduled:e2e-web  ← NEW
```

The key difference from mobile: no emulator/socat. Playwright runs headless Chromium inside the CI container, connected to the compose network.

```yaml
# --- E2E web base (shared by e2e:playwright + scheduled:e2e-web) ---

.e2e_web_base:
  extends: .node_base
  allow_failure: false
  tags: [docker]
  timeout: 30m
  retry:
    max: 2
    when:
      - runner_system_failure
      - unknown_failure
  before_script:
    - apk add --no-cache docker-cli curl python3
    - mkdir -p reports
    - npm ci
    - npx playwright install --with-deps chromium
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
  script:
    # Phase 1: Connect to compose network + discover nginx IP (same as .e2e_mobile_base)
    # Phase 2: ROPC setup for page-level auth (same as .e2e_mobile_base)
    # Phase 3: Run Playwright tests against live stack
    - BASE_URL="https://${NGINX_IP}" npx playwright test tests/e2e/chatbot/
    # Phase 4: ROPC cleanup (same as .e2e_mobile_base)
  after_script:
    - mkdir -p e2e-logs
    - docker compose -p "ci-${CI_PIPELINE_ID}" logs > e2e-logs/docker-compose.log 2>&1 || true
  artifacts:
    when: always
    expire_in: 2 days
    paths:
      - e2e-logs/
      - reports/
    reports:
      junit: reports/playwright-report.xml

# Playwright E2E — runs on merge trains (same pattern as patrol:e2e)
e2e:playwright:
  extends: .e2e_web_base
  stage: e2e
  needs: [e2e:integration]
  resource_group: e2e-runner
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event" && $CI_MERGE_REQUEST_EVENT_TYPE == "merge_train"'
      changes:
        - tests/e2e/chatbot/**/*
        - components/gov-chat-frontend/**/*
        - components/gov-chat-backend/**/*
        - .gitlab-ci.yml

# Playwright E2E — runs on schedule (same pattern as scheduled:e2e-mobile)
scheduled:e2e-web:
  extends: .e2e_web_base
  stage: scheduled
  needs: [scheduled:integration]
  resource_group: e2e-runner
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
      when: on_success
```

**CRITICAL: `e2e:integration` changes must be expanded (Task 5 prerequisite)**

The current `e2e:integration` job only triggers on `changes: mobile/genie_ai_mobile/**`. Since `e2e:playwright` needs `e2e:integration` to spin up the Docker stack, a web-only merge train would skip integration, causing `e2e:playwright` to also be skipped. Two changes are required:

1. **Expand `e2e:integration` `changes`** to include web-relevant paths (component-level globs, matching mobile's approach):
```yaml
e2e:integration:
  extends: .e2e_integration_base
  stage: e2e
  resource_group: e2e-runner
  needs: []   # Remove mobile-specific needs — downstream jobs gate themselves
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event" && $CI_MERGE_REQUEST_EVENT_TYPE == "merge_train"'
      changes:
        - mobile/genie_ai_mobile/**/*
        - tests/e2e/chatbot/**/*
        - components/gov-chat-frontend/**/*
        - components/gov-chat-backend/**/*
        - .gitlab-ci.yml
```

2. **Move mobile needs to `patrol:e2e`** where they belong:
```yaml
patrol:e2e:
  extends: .e2e_mobile_base
  stage: e2e
  resource_group: e2e-runner
  needs: [e2e:integration, lint:dart, test:flutter]  # mobile gates here, not on integration
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event" && $CI_MERGE_REQUEST_EVENT_TYPE == "merge_train"'
      changes:
        - mobile/genie_ai_mobile/**/*
```

Key alignment with story 1.6 architecture:
- **`.e2e_web_base` hidden template** — self-contained, following `.e2e_mobile_base` pattern
- **Two jobs extend it** — `e2e:playwright` (merge train) + `scheduled:e2e-web` (schedule), differing only in `stage`, `needs`, and `rules`
- **Merge train rules** — `$CI_MERGE_REQUEST_EVENT_TYPE == "merge_train"` with path-based `changes`, matching `patrol:e2e` pattern
- **Schedule rules** — `$CI_PIPELINE_SOURCE == "schedule"`, matching `scheduled:e2e-mobile`
- **`resource_group: e2e-runner`** — all E2E jobs share a single resource group (`e2e:integration`, `patrol:e2e`, `scheduled:integration`, `scheduled:e2e-mobile`, and now `e2e:playwright` + `scheduled:e2e-web`). GitLab serializes them to prevent resource contention on the single Docker host.
- **`tags: [docker]`** — runner must have docker socket mounted (same as `.e2e_integration_base`)
- **`apk add docker-cli curl python3`** — `.node_base` (`node:20-alpine`) lacks docker; installed in `before_script`
- **No `allow_failure`** — tests must pass. E2E failures signal real regressions.
- **`after_script`** — captures compose logs only. Stack teardown is handled by `.post` cleanup jobs (`e2e:cleanup` for merge trains, `scheduled:cleanup` for schedules). Both are `stage: .post` with `when: always` rules — they run automatically after all other stages. No changes needed to cleanup jobs.
- **`expire_in: 2 days`** — matches `.e2e_mobile_base` artifact retention

**Important notes:**

1. **`BASE_URL` / `playwright.config.js`:** The config currently hardcodes `baseURL: 'https://localhost'`. Task 5 includes updating it to `baseURL: process.env.BASE_URL || 'https://localhost'`. In CI, we pass `BASE_URL=https://${NGINX_IP}` so Playwright targets the live stack. Locally it defaults to `https://localhost`.

2. **Docker CLI access:** The `.node_base` template uses `node:20-alpine` which does NOT include docker CLI. Installed via `apk add --no-cache docker-cli curl python3` in `before_script`. The runner must have docker socket mounted (same requirement as `.e2e_mobile_base`).

3. **Merge train requirement:** Merge train E2E only works if the GitLab project has merge trains enabled. The `e2e:integration` job (story 1.6) also uses merge train rules, so this is already a prerequisite.

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

For chatbot tests, use **page-level auth** since we need the full browser session with SSE support. The login flow is: navigate to `BASE_URL/` → Keycloak redirect → fill `#username`/`#password` → submit → verify dashboard. Locally `BASE_URL=https://localhost`, in CI `BASE_URL=https://${NGINX_IP}` (discovered from Docker network).

### Dependencies

| Dependency | Status | Notes |
|------------|--------|-------|
| Story 1.6 (MR blocking, scheduled jobs) | Done | Provides `.e2e_integration_base`, `.e2e_mobile_base` templates + `e2e`/`scheduled` stages with merge train + schedule rules. All templates and jobs are live in `.gitlab-ci.yml`. This story extends them with `.e2e_web_base`. |
| Story 1.7 (caching, path triggers) | Done | Use established cache patterns for the new job |
| Deployed Docker stack | Required for local testing | Full stack: Keycloak + Backend + Frontend + ArangoDB + OPEA services |
| Test user credentials | Required | `testuser` / `TestPass123!` (same as existing E2E tests) |
| `KEYCLOAK_ADMIN_PASSWORD` CI variable | Required | Must be set in Settings > CI/CD > Variables for ROPC setup |

### Project Structure Notes

- Test files go in `tests/e2e/chatbot/` — new subdirectory following existing `epic1/`, `epic2/`, `epic3/` pattern
- Helpers go in `tests/e2e/helpers/chatbot.js` — alongside existing `auth.js` and `keycloak-admin.js`
- CI: `.e2e_web_base` hidden template + two jobs (`e2e:playwright` in `e2e` stage, `scheduled:e2e-web` in `scheduled` stage) — follows `.e2e_mobile_base` pattern from story 1.6
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
- [Source: .gitlab-ci.yml (story 1.6 worktree)] — CI pipeline with 7 stages, scheduled architecture, Docker networking patterns — **primary CI reference**
- [Source: _bmad-output/planning-artifacts/architecture.md] — Test ecosystem coordination, E2E tier details
- [Source: _bmad-output/planning-artifacts/epics.md] — Story 1.8 AC and requirements
- [Source: _bmad-output/implementation-artifacts/1-7-configure-ci-caching-and-path-based-triggers.md] — Previous story CI patterns

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
