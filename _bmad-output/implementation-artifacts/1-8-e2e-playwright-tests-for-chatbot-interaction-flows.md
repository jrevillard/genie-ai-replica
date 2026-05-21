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

5. **AC5: CI integration** — Given the `.gitlab-ci.yml` pipeline, the chatbot Playwright tests run as a `scheduled:e2e-web` job in the `scheduled` stage, with `needs: [scheduled:integration]` to reuse the Docker Compose stack spun up by `scheduled:integration` (same backend for web + mobile). The job connects the CI container to the compose network, discovers the nginx IP, and runs Playwright against the live stack. Only runs on scheduled pipelines.

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

- [ ] Task 5: Add `scheduled:e2e-web` job to GitLab CI (AC: #5)
  - [ ] Add `scheduled:e2e-web` job to `.gitlab-ci.yml` in the `scheduled` stage, with `needs: [scheduled:integration]`
  - [ ] Reuse `scheduled:integration` Docker Compose stack (story 1.6 provides this job — same backend for web + mobile)
  - [ ] Connect CI container to compose network, discover nginx IP (follow `scheduled:e2e-mobile` pattern from story 1.6)
  - [ ] Set `BASE_URL=https://${NGINX_IP}` env var so Playwright targets the live stack via compose network
  - [ ] `rules: if: $CI_PIPELINE_SOURCE == "schedule"` only — no per-MR trigger for scheduled tier
  - [ ] `retry: max: 2` for flaky tests (same as `scheduled:e2e-mobile`)
  - [ ] NO `allow_failure` — E2E failures are real regressions
  - [ ] Add JUnit report artifact for GitLab test reporting
  - [ ] Add `mkdir -p reports` in `before_script`
  - [ ] Follow cache pattern from story 1.7
  - [ ] Clean up: disconnect from compose network, let `scheduled:integration` teardown handle stack removal

- [ ] Task 6: Verify and validate (AC: #6)
  - [ ] Run full test suite locally and confirm <30 min
  - [ ] Verify CI job syntax with `gitlab-ci-lint` or dry-run

## Dev Notes

### Architecture Context

This story creates **scheduled-tier** E2E tests (not mandatory). The pipeline architecture (from story 1.6) is:

```
lint → test → contract → config → e2e → scheduled → manual
```

Where the `scheduled` stage contains:
- `scheduled:integration` — Brings up Docker Compose stack (shared for web + mobile)
- `scheduled:build-apk` — Builds Flutter APK in parallel with integration
- `scheduled:e2e-mobile` — Depends on integration + build-apk, runs mobile Patrol tests
- `scheduled:e2e-web` — **NEW** (this story). Depends on integration, runs Playwright web tests

E2E tests only run on scheduled pipelines and do NOT block MRs. The `workflow:rules` in `.gitlab-ci.yml` already includes `$CI_PIPELINE_SOURCE == "schedule"`.

### Existing Infrastructure — Reuse, Do NOT Reinvent

| What | Where | Notes |
|------|-------|-------|
| Playwright config | `playwright.config.js` | baseURL: `https://localhost`, chromium only, JUnit reporter already configured, `ignoreHTTPSErrors: true` |
| Auth helpers | `tests/e2e/helpers/auth.js` | `getUserToken()`, `getAdminToken()`, `parseJwtClaims()`, `request()` — reuse for all authenticated API calls |
| Keycloak admin helpers | `tests/e2e/helpers/keycloak-admin.js` | User/realm management for test setup |
| Root package.json scripts | `package.json` | `test:e2e` and `test:e2e:list` already configured |
| CI scheduled stage | `.gitlab-ci.yml` (story 1.6) | `scheduled` stage with `scheduled:integration` + `scheduled:e2e-mobile` — add `scheduled:e2e-web` alongside |
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

### CI Job Pattern (aligned with `scheduled:e2e-mobile` from story 1.6)

The Playwright web tests follow the same scheduled pipeline architecture as mobile E2E tests. The key difference: no emulator/socat complexity — Playwright runs headless Chromium inside the CI container, connected to the compose network.

**Networking pattern (from `scheduled:e2e-mobile`):**
1. Discover compose network: `docker network ls --filter "label=com.docker.compose.project=ci-${CI_PIPELINE_ID}"`
2. Connect CI container to it: `docker network connect "$COMPOSE_NET" "$CI_CONTAINER_ID"`
3. Discover nginx IP: `docker inspect "$NGINX_CONTAINER" --format "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}"`
4. Run Playwright against `https://${NGINX_IP}` (not `https://localhost` — we're inside Docker)

```yaml
# Web E2E tests (Playwright) — runs on schedule after integration stack is up
# Depends on scheduled:integration (running Docker stack with backend/frontend/nginx)
# Shares the same compose stack as scheduled:e2e-mobile — both test the same backend
scheduled:e2e-web:
  extends: .node_base
  stage: scheduled
  needs: [scheduled:integration]
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
      when: on_success
  allow_failure: false
  timeout: 30m
  retry:
    max: 2
    when:
      - runner_system_failure
      - unknown_failure
  before_script:
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
    # --- Phase 1: Connect to compose network + discover nginx IP ---
    - |
      COMPOSE_NET=$(docker network ls --filter "label=com.docker.compose.project=ci-${CI_PIPELINE_ID}" --format '{{.Name}}' | head -1)
      if [ -z "$COMPOSE_NET" ]; then
        COMPOSE_NET="ci-${CI_PIPELINE_ID}_default"
      fi
      echo "Compose network: $COMPOSE_NET"
      CI_CONTAINER_ID=$(docker ps --filter "label=com.gitlab.gitlab-runner.job.id=$CI_JOB_ID" --format '{{.ID}}' | head -1)
      if [ -z "$CI_CONTAINER_ID" ]; then
        CI_CONTAINER_ID=$(docker ps --filter "name=runner" --format '{{.Names}}' | grep "concurrent" | head -1 | sed 's/-predefined$//')
      fi
      echo "CI container: $CI_CONTAINER_ID"
      docker network connect "$COMPOSE_NET" "$CI_CONTAINER_ID" 2>/dev/null || true
      echo "CI container connected to compose network: $COMPOSE_NET"
      NGINX_CONTAINER=$(docker ps --filter "name=nginx" --format "{{.Names}}" | grep "ci-" | head -1)
      if [ -n "$NGINX_CONTAINER" ]; then
        NGINX_IP=$(docker inspect "$NGINX_CONTAINER" --format "{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}" | awk '{print $1}')
        echo "Nginx container: $NGINX_CONTAINER at $NGINX_IP"
      else
        echo "ERROR: No nginx container found in compose stack"
        exit 1
      fi
    # --- Phase 2: ROPC setup for test user (same pattern as e2e-mobile) ---
    - |
      KEYCLOAK_BASE="https://${NGINX_IP}:443"
      KC_PWD="${KEYCLOAK_ADMIN_PASSWORD}"
      ADMIN_TOKEN=$(curl -sk -X POST "${KEYCLOAK_BASE}/auth/realms/master/protocol/openid-connect/token" \
        -d "client_id=admin-cli" -d "username=admin" -d "password=${KC_PWD}" -d "grant_type=password" \
        2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null || true)
      CLIENT_UUID=""
      if [ -n "$ADMIN_TOKEN" ]; then
        CLIENT_UUID=$(curl -sk "${KEYCLOAK_BASE}/auth/admin/realms/genie/clients?clientId=genie-app" \
          -H "Authorization: Bearer $ADMIN_TOKEN" 2>/dev/null \
          | python3 -c "import sys,json; clients=json.load(sys.stdin); print(clients[0]['id'] if clients else '')" 2>/dev/null || true)
        if [ -n "$CLIENT_UUID" ]; then
          curl -sk -X PUT "${KEYCLOAK_BASE}/auth/admin/realms/genie/clients/${CLIENT_UUID}" \
            -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
            -d '{"directAccessGrantsEnabled": true}' 2>/dev/null || true
          echo "ROPC enabled on genie-app"
        fi
      fi
    # --- Phase 3: Run Playwright tests against live stack ---
    - BASE_URL="https://${NGINX_IP}" npx playwright test tests/e2e/chatbot/
    # --- Phase 4: ROPC cleanup ---
    - |
      if [ -n "$CLIENT_UUID" ] && [ -n "$ADMIN_TOKEN" ]; then
        curl -sk -X PUT "${KEYCLOAK_BASE}/auth/admin/realms/genie/clients/${CLIENT_UUID}" \
          -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
          -d '{"directAccessGrantsEnabled": false}' 2>/dev/null || true
        echo "ROPC disabled on genie-app"
      fi
  after_script:
    - docker network disconnect "ci-${CI_PIPELINE_ID}_default" $(docker ps --filter "label=com.gitlab.gitlab-runner.job.id=$CI_JOB_ID" --format '{{.ID}}' | head -1) 2>/dev/null || true
  artifacts:
    when: always
    expire_in: 7 days
    reports:
      junit: reports/playwright-report.xml
    paths:
      - reports/
```

Key alignment with `scheduled:e2e-mobile` (story 1.6):
- **`needs: [scheduled:integration]`** — shares the Docker Compose stack, no separate deployment
- **`stage: scheduled`** — runs in the scheduled stage, not `e2e` (per-MR mobile tests are `patrol:e2e` in `e2e` stage, but chatbot web tests are scheduled-only)
- **Docker networking** — same pattern: discover compose network, connect CI container, discover nginx IP via `docker inspect`
- **ROPC setup/cleanup** — same Keycloak ROPC pattern for page-level auth in Playwright
- **No `allow_failure`** — tests must pass. E2E failures signal real regressions.
- **`retry: max: 2`** — same flaky-test tolerance as mobile E2E.
- **Schedule-only `rules`** — `if: $CI_PIPELINE_SOURCE == "schedule"` only. No per-MR path-based triggers for this scheduled tier.
- **`after_script`** — disconnects CI container from compose network (stack teardown is handled by `scheduled:integration`'s cleanup or GitLab's pipeline cleanup)

**Important note on `BASE_URL`:** The `playwright.config.js` currently hardcodes `baseURL: 'https://localhost'`. In CI, we override via `BASE_URL=https://${NGINX_IP}` environment variable. Playwright's config reads `process.env.BASE_URL` if set, or you update the config to support `baseURL: process.env.BASE_URL || 'https://localhost'`. This change is part of Task 5.

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
| Story 1.6 (MR blocking, scheduled jobs) | NOT done | Provides `scheduled:integration` job + `scheduled` stage. The `scheduled:e2e-web` job needs `scheduled:integration` to spin up the Docker stack first. If 1.6 is not merged yet, the job can be developed independently but won't pass CI until the `scheduled` stage and `scheduled:integration` job exist. |
| Story 1.7 (caching, path triggers) | Done | Use established cache patterns for the new job |
| Deployed Docker stack | Required for local testing | Full stack: Keycloak + Backend + Frontend + ArangoDB + OPEA services |
| Test user credentials | Required | `testuser` / `TestPass123!` (same as existing E2E tests) |
| `KEYCLOAK_ADMIN_PASSWORD` CI variable | Required | Must be set in Settings > CI/CD > Variables for ROPC setup |

### Project Structure Notes

- Test files go in `tests/e2e/chatbot/` — new subdirectory following existing `epic1/`, `epic2/`, `epic3/` pattern
- Helpers go in `tests/e2e/helpers/chatbot.js` — alongside existing `auth.js` and `keycloak-admin.js`
- CI job added to `.gitlab-ci.yml` in the `scheduled` stage alongside existing `scheduled:e2e-mobile` (requires `scheduled` stage from story 1.6)
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
