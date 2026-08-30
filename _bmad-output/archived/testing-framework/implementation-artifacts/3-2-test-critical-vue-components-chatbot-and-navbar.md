# Story 3.2: Test Critical Vue Components — ChatBot and NavBar

Status: done

## Story

As a developer,
I want component tests for ChatBotComponent and NavBarComponent,
so that the most critical UI interactions are validated.

## Acceptance Criteria

1. **AC1 — ChatBotComponent renders with empty message list**: When mounted with no messages, the component renders the chat window and input area without errors.

2. **AC2 — User message displayed after submission**: When a user types a message and submits, the message appears in the chat message list.

3. **AC3 — Chat input cleared after submission**: After submitting a message, the input field (`newMessage`) is reset to empty.

4. **AC4 — Loading state shown while awaiting response**: While `chatbotService.submitQueryStream()` is pending, a loading indicator is visible.

5. **AC5 — Error state shown when API call fails**: When the streaming API call fails, an error message is displayed in the chat.

6. **AC6 — NavBar navigation links render correctly**: All navigation buttons (Analytics, Administration, Settings, Profile, Logout) render based on auth state.

7. **AC7 — Login/Logout button reflects auth status**: When authenticated, the logout button is visible; the logout button is always rendered but admin buttons (Analytics, Administration) are **disabled** (not hidden) for non-admin users via `:disabled="!isAdmin"`.

8. **AC8 — User dropdown appears when authenticated**: When the user is authenticated, the user profile/logout dropdown is visible.

9. **AC9 — All component tests use Options API mount patterns (NFR22)**: Tests use `mount()` or `shallowMount()` from `@vue/test-utils` with proper Options API setup.

## Tasks / Subtasks

- [x] Task 1: Create ChatBotComponent test file (AC: #1–5)
  - [x] 1.1 Create `src/__tests__/components/ChatBotComponent.test.js`
  - [x] 1.2 Implement mount helper with all required mock providers (Vuex, i18n, services, eventBus)
  - [x] 1.3 Test: renders chat window with empty message list (AC1)
  - [x] 1.4 Test: displays user message after submission (AC2)
  - [x] 1.5 Test: clears input after submission (AC3)
  - [x] 1.6 Test: shows loading state during response (AC4)
  - [x] 1.7 Test: shows error state on API failure (AC5)
- [x] Task 2: Create NavBarComponent test file (AC: #6–8)
  - [x] 2.1 Create `src/__tests__/components/NavBarComponent.test.js`
  - [x] 2.2 Implement mount helper with auth store and i18n mocks
  - [x] 2.3 Test: navigation links render correctly (AC6)
  - [x] 2.4 Test: logout button visible when authenticated (AC7)
  - [x] 2.5 Test: user dropdown appears when authenticated (AC8)
  - [x] 2.6 Test: admin-only buttons disabled (not hidden) for non-admin users — assert `disabled` attribute, not absence (AC6)
- [x] Task 3: Verify and lint (AC: #9)
  - [x] 3.0 Run `npm test` in `components/gov-chat-frontend/` before any changes to confirm existing 240 tests pass as baseline
  - [x] 3.1 All tests pass with `npm test` in `components/gov-chat-frontend/`
  - [x] 3.2 All test files pass ESLint (`npm run lint`)

## Dev Notes

### Component Analysis

**ChatBotComponent.vue** (`src/components/ChatBotComponent.vue`, 2,441 lines):
- Options API component with 40+ methods, 35+ data properties
- Key data: `messages`, `chatMessages`, `newMessage`, `isLoading`, `isStreaming`, `streamController`
- Key methods for AC coverage: `sendMessage()`, `scrollToBottom()`
- Uses `chatbotService.submitQueryStream()` for SSE (native Fetch, NOT axios)
- Subscribes to eventBus events in `created()`: `chat-deleted`, `load-conversation`, `treeNodeSelected`, `open-chat`
- Dependencies: `chatbotService`, `chatHistoryService`, `serviceTreeService`, `notificationService`, `eventBus`, `marked`, `dompurify`

**NavBarComponent.vue** (`src/components/NavBarComponent.vue`, 812 lines):
- Options API component with 3 props, 2 methods, 1 computed
- Props: `isSidebarOpen` (Boolean, default: true), `sidebarWidth` (Number, default: 250), `config` (Object, optional — has safe defaults with `app.title`, `app.icon`, `theme.navbar`)
- Emits: `toggleSidebar`, `logout`
- Computed `isAdmin()` checks `this.$store.getters.currentUser` (root-level getter — auth module is NOT namespaced)
- Uses sub-components: `DsButton`, `LanguageSelector`
- Methods: `handleLogout()` (emits logout + dispatches Vuex `logout`), `toggleSidebar()` (emits toggle)

### Dependencies That Must Be Mocked

**Services (mock with `jest.mock()` using closure-based refs):**
- `@/services/chatbotService` — mock `submitQueryStream()` to return a controllable stream object
- `@/services/chatHistoryService` — mock `getConversation()`, `createConversation()`, `addMessage()`
- `@/services/serviceTreeService` — mock `getAllCategories()`
- `@/services/notificationService` — mock `success()`, `error()`, `info()`, `warning()`

**SSE Streaming Mock Strategy:**
- `submitQueryStream(queryData, callbacks)` — TWO parameters (query data object + callbacks object), NOT one merged object
- Returns an `AbortController` (not a plain object)
- Callbacks object has 5 keys: `{ onChunk, onMetadata, onTranslation, onDone, onError }`
- Uses native `fetch()` (NOT axios) internally — mock at service boundary, not global.fetch
- `sendMessage()` sets `this.isStreaming = true` and pushes a bot message placeholder to `chatMessages` BEFORE calling `submitQueryStream` — the bot message already exists when callbacks fire

**Vuex Store Mock:**
- Use `createAuthenticatedState()` and `createUnauthenticatedState()` from `src/__tests__/fixtures/store-state.js` (created in Story 3.1)
- auth module is NOT namespaced (state at root level)
- chatHistory module IS namespaced (state under `chatHistory` key)
- NavBarComponent only needs auth module (currentUser getter)
- ChatBotComponent needs both auth and chatHistory modules

**Event Bus Mock (ChatBotComponent only):**
- Mock `@/eventBus` — return a mock emitter with `$on`, `$emit`, `$off`
- ChatBotComponent subscribes in `created()` lifecycle hook — verify subscriptions are registered

**i18n Mock:**
- Components use `this.$t()` internally (wrapper around `translate()`)
- Mock in global mount options: `mocks: { $t: (key) => key }`
- Also mock `$root.$i18n: { locale: 'en' }`

**Stub Child Components:**
- `shallowMount` automatically stubs child components
- For `mount`, stub: `DsButton`, `DsModal`, `LanguageSelector`, `lucide-vue-next` icons
- Use `global.stubs` config

### Mount Helper Pattern

Create a reusable `createChatBotWrapper()` and `createNavBarWrapper()` in each test file following the established pattern:

```javascript
// Example for ChatBotComponent
function createChatBotWrapper(storeOverrides = {}) {
  const store = createStoreMock(storeOverrides);
  return mount(ChatBotComponent, {
    global: {
      plugins: [store],
      mocks: { $t: (key) => key, $root: { $i18n: { locale: 'en' } } },
      stubs: { DsButton: true, DsModal: true, /* etc */ },
    },
  });
}
```

### Established Test Infrastructure (from Story 3.1)

**Available fixtures and mocks — USE THESE, do NOT recreate:**
- `src/__tests__/mocks/axios.js` — `setSuccessResponse()`, `setErrorResponse()`, `resetAxiosMock()`
- `src/__tests__/mocks/keycloakAuthService.js` — `createMockKeycloakUser()`, `createMockToken()`, `resetKeycloakMock()`
- `src/__tests__/fixtures/store-state.js` — `createAuthenticatedState(overrides)`, `createUnauthenticatedState()`
- `src/__tests__/fixtures/api-responses.js` — response fixtures for chat, categories, user, analytics, documents

**Jest config** (`jest.config.js`):
- Environment: jsdom
- Transform: `@vue/vue3-jest` for .vue, `babel-jest` for .js
- Path alias: `@/` → `src/`
- Setup: `src/__tests__/setup.js` (mocks console.warn/debug, sets window.APP_CONFIG)

### SSE Streaming Mock Detail

The `sendMessage()` method calls `chatbotService.submitQueryStream(queryData, callbacks)` which returns an `AbortController`. The pattern is:

```javascript
// Actual call signature — TWO separate parameters
this.streamController = chatbotService.submitQueryStream(
  { query, context, contextOption, sessionId, ... },  // queryData
  {                                                    // callbacks
    onChunk: (content) => { /* append to bot message */ },
    onMetadata: (meta) => { /* store confidence, sources */ },
    onTranslation: (translated) => { /* replace content */ },
    onDone: (data) => { /* finalize, set isStreaming=false */ },
    onError: (err) => { /* show error in chat */ },
  }
);
```

**Mock strategy:** Mock the entire `chatbotService` module. Make `submitQueryStream()` capture the callbacks and return a fake AbortController. Then in tests, invoke the callbacks manually:

```javascript
let capturedCallbacks = {};
const mockSubmitQueryStream = jest.fn((_queryData, callbacks) => {
  capturedCallbacks = callbacks; // { onChunk, onMetadata, onTranslation, onDone, onError }
  return { abort: jest.fn() };   // AbortController-like
});
```

This gives full control over the streaming lifecycle in tests.

### Technical Constraints

- **NFR22**: Use Options API mount patterns exclusively — no Composition API test patterns
- **NFR11**: All test code passes ESLint and Prettier
- **NFR21**: Test files use `require()`/`module.exports` for Jest CommonJS interop (frontend uses ES modules in source, Jest handles the transform)
- **NFR7**: Tests must be order-independent (no test depends on side effects from another)
- **NFR6**: No flaky tests — all mocks are deterministic

### ChatBotComponent AC Mapping

| AC | What to Test | Key Method | Mock Needed |
|---|---|---|---|
| AC1 | Renders with empty messages | initial mount | services mocked, store with empty chatHistory |
| AC2 | User message appears after submit | `sendMessage()` | `submitQueryStream` mock calling onDone immediately. Note: `sendMessage()` pushes user msg to `chatMessages` first, then a bot placeholder — assert both exist |
| AC3 | Input cleared after submit | `sendMessage()` | same as AC2 |
| AC4 | Loading state during response | `sendMessage()` | `submitQueryStream` mock that doesn't call onDone immediately. Note: `isStreaming` is set to `true` BEFORE the call — assert while callbacks are pending |
| AC5 | Error state on API failure | `sendMessage()` | `submitQueryStream` mock that calls onError |

### NavBarComponent AC Mapping

| AC | What to Test | Key Element | Mock Needed |
|---|---|---|---|
| AC6 | Nav links render | template buttons (admin buttons use `:disabled`, not `v-if`) | store with admin user (enabled), store with non-admin user (disabled) |
| AC7 | Logout button reflects auth | `handleLogout()` | store auth/unauth states |
| AC8 | User dropdown when authed | profile section | store with authenticated user |

### Files to Create

| File | Purpose |
|---|---|
| `src/__tests__/components/ChatBotComponent.test.js` | ChatBotComponent tests (AC1–5) |
| `src/__tests__/components/NavBarComponent.test.js` | NavBarComponent tests (AC6–8) |

### Files to Read (reference only, do NOT modify)

- `src/components/ChatBotComponent.vue` — component under test
- `src/components/NavBarComponent.vue` — component under test
- `src/services/chatbotService.js` — streaming service interface
- `src/services/chatHistoryService.js` — chat history CRUD
- `src/services/notificationService.js` — toast notification interface
- `src/store/modules/auth.js` — auth module structure
- `src/store/chatHistoryStore.js` — chatHistory module structure
- `src/__tests__/fixtures/store-state.js` — store state factories (from Story 3.1)
- `src/__tests__/fixtures/api-responses.js` — API response fixtures (from Story 3.1)
- `src/__tests__/mocks/axios.js` — axios mock (from Story 3.1)
- `src/eventBus.js` — event bus interface

### What NOT to Test (Out of Scope)

- SSE streaming internals (native Fetch behavior) — mock at service boundary
- PDF export (complex jsPDF integration) — defer to later stories
- Markdown rendering (marked/dompurify) — defer to later stories
- Quick help overlay interaction — defer to later stories
- Chat history sidebar interaction — defer to later stories
- Responsive layout / CSS — not testable with jsdom
- Streaming abort controller — defer to later stories

### Project Structure Notes

- Test files go in `src/__tests__/components/` following the established convention (NFR12)
- All existing test files in `src/__tests__/` must continue to pass — do NOT modify them
- Import fixtures from `src/__tests__/fixtures/` and mocks from `src/__tests__/mocks/` (centralized, per NFR13)
- The `@/` path alias maps to `src/` via jest.config.js moduleNameMapper

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-3.2] — Story definition and ACs
- [Source: _bmad-output/planning-artifacts/architecture.md#Mock-&-Fixture-Patterns] — Mock patterns
- [Source: _bmad-output/planning-artifacts/architecture.md#Test-Naming-Patterns] — Naming conventions
- [Source: _bmad-output/project-context.md#Frontend-Testing-Architecture] — Frontend test infrastructure
- [Source: _bmad-output/implementation-artifacts/3-1-create-frontend-test-fixtures-and-shared-mocks.md] — Previous story fixtures

## Dev Agent Record

### Agent Model Used

Claude GLM-5-Turbo (via Claude Code)

### Debug Log References

- Initial `$root` mock caused `TypeError: 'set' on proxy` — resolved by mocking `$i18n` directly instead of `$root.$i18n` (component is its own root in test)
- `marked` import requires named export `{ marked }` with `.parse()` method — initial mock used wrong export structure

### Completion Notes List

- ChatBotComponent: 12 tests covering AC1–AC5 + event bus lifecycle. SSE streaming mocked at service boundary using callback capture pattern. All services (chatbotService, chatHistoryService, serviceTreeService, notificationService) and eventBus mocked at module level.
- NavBarComponent: 14 tests covering AC6–AC8 + admin disabled state + sidebar toggle. Three store factories (admin, non-admin, unauthenticated) test role-based button states. DsButton and router-link stubbed.
- Full suite: 12 suites, 209 tests pass (183 baseline + 26 new). Zero regressions. ESLint clean.

### File List

**New files:**
- `components/gov-chat-frontend/src/__tests__/components/ChatBotComponent.test.js`
- `components/gov-chat-frontend/src/__tests__/components/NavBarComponent.test.js`

**Modified files:**
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (3-2 status: ready-for-dev → in-progress → review)
- `_bmad-output/implementation-artifacts/3-2-test-critical-vue-components-chatbot-and-navbar.md` (task checkboxes, Dev Agent Record, Status)

### Review Findings

- [x] [Review][Patch] Event bus: only 2 of 4 specified events verified in subscription test (chat-deleted, load-conversation missing) — unsubscription also didn't verify specific events. Fixed: both tests now assert all 4 events. [ChatBotComponent.test.js:340-362]
- [x] [Review][Patch] AC5 assertions too weak: notificationService.error() only checked toHaveBeenCalledWithout message content; streamingMsg.content only checked with toBeTruthy. Fixed: notification assertion now checks i18n key content; error content now uses regex match. [ChatBotComponent.test.js:318,332]
- [x] [Review][Patch] NavBar: no test for user with null/undefined roles (isAdmin computed could crash). Fixed: added `createNoRolesStore()` factory + 2 tests for null roles edge case. [NavBarComponent.test.js:256-284]
- [x] [Review][Patch] AC6: no unauthenticated state rendering test for navigation buttons. Fixed: added test verifying buttons render with admin buttons disabled when unauthenticated. [NavBarComponent.test.js:152-160]
- [x] [Review][Defer] Error recovery: no test verifying user can send new message after streaming error — deferred, improvement beyond AC scope
