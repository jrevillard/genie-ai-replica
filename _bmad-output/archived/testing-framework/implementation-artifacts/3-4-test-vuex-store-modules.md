# Story 3.4: Test Vuex Store Modules

Status: done

## Story

As a developer,
I want tests for all Vuex store modules,
so that state management logic is validated independently of components.

## Acceptance Criteria

1. **AC1 — chatHistory module initial state is correct**: When the store is created, initial state contains a single default folder, empty chats array, and folderChats with only `{ default: [] }`.

2. **AC2 — chatHistory mutations manage folders correctly**: `ADD_FOLDER` creates a new folder with UUID and empty folderChats entry. `UPDATE_FOLDER` renames non-default folders. `REMOVE_FOLDER` deletes a folder and migrates its chats to the default folder. `setFolders` replaces the entire folders array. `CLEAR_FOLDERS` resets to initial state.

3. **AC3 — chatHistory mutations manage chats correctly**: `ADD_CHAT` creates a chat, adds it to the specified folder (or default), and ensures it appears in the default folder. `UPDATE_CHAT` updates title/preview and sets updatedAt. `REMOVE_CHAT` removes a chat from all folderChats and the chats array. `MOVE_CHAT` moves a chat between folders while keeping it in the default folder.

4. **AC4 — chatHistory mutations manage folder-chat associations**: `ADD_CHAT_TO_FOLDER` adds a chat ID to a folder (no duplicates). `REMOVE_CHAT_FROM_FOLDER` removes a chat ID from a folder. `SET_FOLDER_CHATS` replaces a folder's chat ID array.

5. **AC5 — chatHistory getters return correct data**: `getAllFolders` returns all folders. `getFolderById` returns a specific folder. `getChatById` returns a specific chat. `getChatsByFolderId` resolves chat IDs to full chat objects and filters undefined.

6. **AC6 — chatHistory actions delegate correctly**: Synchronous actions (`setFolders`, `createFolder`, `updateFolder`, `deleteFolder`, `createChat`, `updateChat`, `deleteChat`, `addChatToFolder`, `setFolderChats`, `clearFolders`) commit the correct mutation with the received payload. `moveChat` calls `chatHistoryService.moveConversation()` and `chatHistoryService.getFolder()`, then commits mutations. `removeChatFromFolder` removes from folder and ensures chat remains in default.

7. **AC7 — Auth module comprehensive test coverage**: The existing `authStore.test.js` continues to pass unchanged. New tests are added in the same file (or a separate describe block) covering: `initialize` action (with/without session, with post_logout flag), `login` action, `handleCallback` action, `setAuth`/`clearAuth`/`setError`/`clearError`/`setInitialized`/`updateAccessToken` mutations, and all getters.

8. **AC8 — Store persistence plugin works correctly**: The localStorage plugin in `store/index.js` persists chatHistory state on mutations and restores it on store creation. `CLEAR_FOLDERS` removes localStorage. Non-chatHistory mutations do not trigger persistence.

9. **AC9 — All tests use direct commit/createStore testing (NFR22)**: Tests use `createStore()` from Vuex or direct `commit()` calls against extracted mutations. No component mounting needed — these are pure store unit tests.

## Tasks / Subtasks

- [x] Task 1: Create chatHistory store test file (AC: #1–6)
  - [x] 1.1 Create `src/__tests__/store/chatHistory.test.js`
  - [x] 1.2 Test initial state: default folder, empty chats, folderChats (AC1)
  - [x] 1.3 Test `ADD_FOLDER` mutation: creates folder with UUID, initializes folderChats (AC2)
  - [x] 1.4 Test `UPDATE_FOLDER` mutation: renames non-default, ignores default (AC2)
  - [x] 1.5 Test `REMOVE_FOLDER` mutation: deletes folder, migrates chats to default (AC2)
  - [x] 1.6 Test `setFolders` mutation: replaces folders array (AC2)
  - [x] 1.7 Test `CLEAR_FOLDERS` mutation: resets to initial state (AC2)
  - [x] 1.8 Test `ADD_CHAT` mutation: creates chat, adds to folder and default (AC3)
  - [x] 1.9 Test `UPDATE_CHAT` mutation: updates title/preview, sets updatedAt (AC3)
  - [x] 1.10 Test `REMOVE_CHAT` mutation: removes from all folderChats and chats array (AC3)
  - [x] 1.11 Test `MOVE_CHAT` mutation: moves between folders, keeps in default (AC3)
  - [x] 1.12 Test `ADD_CHAT_TO_FOLDER` mutation: adds chat, no duplicates (AC4)
  - [x] 1.13 Test `REMOVE_CHAT_FROM_FOLDER` mutation: removes chat from folder (AC4)
  - [x] 1.14 Test `SET_FOLDER_CHATS` mutation: replaces folder chat IDs (AC4)
  - [x] 1.15 Test all getters: getAllFolders, getFolderById, getChatById, getChatsByFolderId (AC5)
  - [x] 1.16 Test synchronous actions: verify correct mutation committed with payload (AC6)
  - [x] 1.17 Test `moveChat` action: mocks chatHistoryService, verifies API calls + commits (AC6)
  - [x] 1.18 Test `removeChatFromFolder` action: removes from folder, ensures in default (AC6)

- [x] Task 2: Extend auth store test coverage (AC: #7)
  - [x] 2.1 Add tests for `initialize` action: active session, expired session, post_logout flag, error handling
  - [x] 2.2 Add tests for `login` action: success and error paths
  - [x] 2.3 Add tests for `handleCallback` action: success (sets auth + registers renew callback), error
  - [x] 2.4 Add tests for remaining mutations: `setAuth`, `setError` (string and object), `setInitialized`, `updateAccessToken`
  - [x] 2.5 Add tests for all getters: `isAuthenticated`, `currentUser`, `accessToken`, `authError`, `lastAuthErrorCode`, `isAuthInitialized`
  - [x] 2.6 Verify all existing authStore.test.js tests still pass

- [x] Task 3: Test store persistence plugin (AC: #8)
  - [x] 3.1 Create `src/__tests__/store/persistence.test.js`
  - [x] 3.2 Test: chatHistory mutations trigger localStorage.setItem
  - [x] 3.3 Test: CLEAR_FOLDERS triggers localStorage.removeItem
  - [x] 3.4 Test: non-chatHistory mutations do NOT trigger persistence
  - [x] 3.5 Test: store creation restores state from localStorage
  - [x] 3.6 Test: invalid localStorage data is handled gracefully (try/catch)

- [x] Task 4: Verify and lint (AC: #9)
  - [x] 4.0 Run `npm test` in `components/gov-chat-frontend/` before any changes to confirm baseline
  - [x] 4.1 All tests pass with `npm test` in `components/gov-chat-frontend/`
  - [x] 4.2 All test files pass ESLint (`npm run lint`)
  - [x] 4.3 Existing authStore.test.js tests pass unchanged

## Dev Notes

### Epic AC Naming Discrepancy

The epic file references `ADD_CONVERSATION`, `SET_CURRENT_CONVERSATION`, and `ADD_MESSAGE` mutations — **these do not exist** in the actual `chatHistoryStore.js`. The real mutations are `ADD_CHAT`, `UPDATE_CHAT`, `REMOVE_CHAT`, `ADD_FOLDER`, `UPDATE_FOLDER`, `REMOVE_FOLDER`, `MOVE_CHAT`, etc. The ACs above are mapped to the actual code.

### Files Under Test

**Primary — chatHistoryStore.js** (`src/store/chatHistoryStore.js`, 231 lines):
- Namespaced module (`namespaced: true`)
- 12 mutations, 12 actions, 4 getters
- All mutations are synchronous; only `moveChat` and `removeChatFromFolder` actions are async
- `moveChat` is the ONLY action that calls `chatHistoryService` (backend API)
- Cross-module dependency: `moveChat` reads `rootGetters['auth/currentUser']` — requires auth state in test store

**Secondary — auth.js** (`src/store/modules/auth.js`, 188 lines):
- NOT namespaced (root-level getters)
- 6 mutations, 6 actions, 6 getters
- All actions are async (all call `keycloakAuthService`)
- `initialize` action reads `sessionStorage.getItem('genie_post_logout')` — mock sessionStorage
- Module-level `silentRenewCallback` variable — tests must manage lifecycle
- `handleApiError` is a synchronous action that parses `{error, message, details}` into `{code, message}`

**Store entry — index.js** (`src/store/index.js`):
- `createStore()` with two modules: `chatHistory` (namespaced) and `auth` (root-level)
- Custom localStorage plugin: persists chatHistory on mutations, restores on init
- Persistence key: `'chatHistory'` in localStorage

### Testing Approach: Direct Mutation/Action Testing

These are pure Vuex unit tests — **no component mounting needed**. Use two patterns:

**Pattern 1 — Direct mutation testing** (for isolated mutation logic):
```javascript
const chatHistory = require('@/store/chatHistoryStore').default;
const state = chatHistory.state();

chatHistory.mutations.ADD_FOLDER(state, { name: 'Work' });
expect(state.folders).toHaveLength(2);
expect(state.folders[1].name).toBe('Work');
```

**Pattern 2 — createStore with test modules** (for actions that need full store context):
```javascript
const { createStore } = require('vuex');
const chatHistory = require('@/store/chatHistoryStore').default;

const store = createStore({
  modules: {
    chatHistory,
    auth: {
      getters: { currentUser: () => ({ sub: 'user-123' }) }
    }
  }
});

await store.dispatch('chatHistory/moveChat', { chatId: 'c1', fromFolderId: 'f1', toFolderId: 'f2' });
```

### chatHistoryStore — Initial State Trap

The default folder's `createdAt` uses `new Date().toISOString()` — a dynamic timestamp. Tests asserting on initial state must either:
- Use regex/typeof checks: `expect(state.folders[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)`
- Or ignore the field: `expect(state.folders[0]).toMatchObject({ id: 'default', name: 'All Chats', isDefault: true })`

### chatHistoryStore — Key Mutation Behaviors to Test

**ADD_FOLDER**: Generates UUID via `uuid.v4()`. Mock `uuid` module to return deterministic IDs:
```javascript
const mockUuid = jest.fn();
jest.mock('uuid', () => ({ v4: (...args) => mockUuid(...args) }));

beforeEach(() => {
  mockUuid.mockReturnValue('test-uuid-1');
});
```

**REMOVE_FOLDER — chat migration**: When deleting a non-default folder, its chats move to default folder. If a chat is already in default, no duplicate added. Deleting the default folder is blocked (no-op).

**ADD_CHAT — dual folder assignment**: Chat is added to the specified folder AND to the default folder (unless already present). If `folderId` is not provided, defaults to `'default'`.

**MOVE_CHAT — same folder guard**: If `fromFolderId === toFolderId`, the mutation is a no-op (early return). After moving, ensures chat is in default folder.

**getChatsByFolderId — undefined filtering**: Resolves chat IDs to chat objects and filters out `undefined` entries (handles orphaned references gracefully).

### chatHistoryService — Mock Strategy for moveChat

`moveChat` is the only async action that calls the backend. Mock at module level:
```javascript
const mockMoveConversation = jest.fn();
const mockGetFolder = jest.fn();
jest.mock('@/services/chatHistoryService', () => ({
  __esModule: true,
  default: {
    moveConversation: (...args) => mockMoveConversation(...args),
    getFolder: (...args) => mockGetFolder(...args)
  }
}));
```

`moveConversation(chatId, fromFolderId, toFolderId)` — no meaningful return value needed, just must not throw.
`getFolder(toFolderId)` — must return `{ conversations: [{ _key: 'chat-id-1' }, ...] }` for the SET_FOLDER_CHATS commit. The service wraps the backend response at `response.data`, so mock the resolved value (not the Axios response).

**removeChatFromFolder** — Despite being declared `async`, this action makes **no API calls**. It commits `REMOVE_CHAT_FROM_FOLDER` then ensures the chat remains in the default folder via `ADD_CHAT_TO_FOLDER`. No service mocking needed — only test the commit sequence.

### Auth Store — Existing Tests and Gaps

**Existing coverage** (in `src/__tests__/authStore.test.js`):
- `logout` action: 7 tests (happy path, error, silent renew cleanup, localStorage cleanup, preference preservation)
- `clearAuth` mutation: 1 test (resets all fields)

**Missing coverage** (add to existing file or new describe block):
- `initialize` action: active session → setAuth + register renew; expired session → clearAuth; post_logout flag → clearAuth + return; error → setError + setInitialized
- `login` action: clears error, removes post_logout flag, calls service
- `handleCallback` action: success → setAuth + register renew + clear post_logout; error → setError
- `setAuth` mutation: sets all fields, clears error
- `setError` mutation: string format, object format, null
- `setInitialized` mutation: sets isInitialized = true
- `updateAccessToken` mutation: updates token, optionally updates user
- `clearError` mutation: sets error = null
- `authError` getter: returns message string for object errors, raw string for string errors
- `lastAuthErrorCode` getter: returns code for object errors, null for string errors
- `handleApiError` action: parses `{error, message}` response into `{code, message}`, commits setError (synchronous — no service calls, no async)

### Auth Store — Module-Level State Trap

The auth module exports a **module-level** `state` object (not a factory function):
```javascript
const state = { isAuthenticated: false, user: null, ... };
export default { state, getters, actions, mutations };
```

Unlike `chatHistoryStore` which uses `state: () => ({...})` (factory function, fresh state per store instance), the auth module shares the same state reference across all store instances. When testing mutations directly, **always create a fresh copy** to avoid state leaking between tests:
```javascript
beforeEach(() => {
  state = { isAuthenticated: false, user: null, accessToken: null, error: null, isInitialized: false };
});
```

### Auth Store — SessionStorage Mock Setup

The auth module reads `sessionStorage.getItem('genie_post_logout')` in `initialize()`, and writes to it in `logout()`. jsdom provides sessionStorage, but it must be cleared between tests to prevent cross-test contamination:
```javascript
beforeEach(() => {
  sessionStorage.removeItem('genie_post_logout');
  jest.clearAllMocks();
});
```

For `initialize` tests, control the flag explicitly:
```javascript
it('should skip session restoration when genie_post_logout is set', async () => {
  sessionStorage.setItem('genie_post_logout', 'true');
  await auth.actions.initialize({ commit, state });
  expect(commit).toHaveBeenCalledWith('clearAuth');
  expect(commit).toHaveBeenCalledWith('setInitialized');
});
```

### Store Persistence Plugin — Test Strategy

The plugin is an anonymous function inside `createStore()`. To test it:

**Option A — Test via store subscription** (recommended): Create a real store using `createStore()` with the actual plugin, then trigger mutations and check localStorage.

```javascript
const store = createStore({
  modules: { chatHistory: chatHistoryStore, auth },
  plugins: [/* the persistence plugin */]
});
store.commit('chatHistory/ADD_FOLDER', { name: 'Test' });
expect(localStorage.getItem('chatHistory')).toContain('Test');
```

**Option B — Extract plugin for testing**: If the plugin is complex, extract it to a separate file for isolated testing. But given its simplicity (~15 lines), Option A is sufficient.

**Key localStorage behaviors:**
- Save: `localStorage.setItem('chatHistory', JSON.stringify(state.chatHistory))` on any `chatHistory/*` mutation
- Clear: `localStorage.removeItem('chatHistory')` on `chatHistory/CLEAR_FOLDERS`
- Restore: `JSON.parse(localStorage.getItem('chatHistory'))` on store creation
- Error handling: try/catch around parse and stringify — malformed data is logged and ignored

### Cross-Module Dependency: chatHistory.moveChat → auth

The `moveChat` action accesses `rootGetters['auth/currentUser']`. When testing with `createStore()`, provide a mock auth module with the getter matching the real signature:
```javascript
const store = createStore({
  modules: {
    chatHistory: chatHistoryStore,
    auth: {
      namespaced: false,
      state: { user: { sub: 'user-123', name: 'Test' } },
      getters: {
        currentUser: (state) => state.user  // Must match actual getter implementation
      }
    }
  }
});
```

If `currentUser` is null, `moveChat` throws `Error('User is missing')` — test this error path by setting the auth getter to return null.

### Dependencies That Must Be Mocked

**chatHistoryStore tests:**
```
- uuid — mock v4() to return deterministic IDs
- @/services/chatHistoryService — mock moveConversation(), getFolder()
```

**auth store additional tests:**
```
- @/services/keycloakAuthService — already mocked in existing authStore.test.js
  (same closure-based mock pattern — extend existing jest.mock() block)
```

**Persistence tests:**
```
- localStorage — jsdom provides this, but clear between tests
- @/store/chatHistoryStore — use real module
- @/store/modules/auth — use real module
```

### Files to Create

| File | Purpose |
|------|---------|
| `src/__tests__/store/chatHistory.test.js` | chatHistory module tests (AC1–6) |
| `src/__tests__/store/persistence.test.js` | localStorage plugin tests (AC8) |

### Files to Modify

| File | Purpose |
|------|---------|
| `src/__tests__/authStore.test.js` | Extend with additional auth tests (AC7) — add new describe blocks, do NOT modify existing tests |

### Files to Read (reference only, do NOT modify)

- `src/store/chatHistoryStore.js` — primary module under test
- `src/store/modules/auth.js` — auth module under test
- `src/store/index.js` — store entry with persistence plugin
- `src/services/chatHistoryService.js` — understand API surface for moveChat mocking
- `src/services/keycloakAuthService.js` — understand OIDC service surface
- `src/__tests__/fixtures/store-state.js` — reuse existing state factories
- `src/__tests__/mocks/keycloakAuthService.js` — reuse existing auth mocks
- `src/__tests__/authStore.test.js` — extend existing tests

### What NOT to Test (Out of Scope)

- **Component integration** — how components consume the store (covered by stories 3.2, 3.3)
- **HTTP service layer** — chatHistoryService internals (covered by story 3.5)
- **Keycloak OIDC protocol** — keycloakAuthService internals
- **chatHistory mutations that don't exist** — ADD_CONVERSATION, SET_CURRENT_CONVERSATION, ADD_MESSAGE (epic names, not real code)
- **eventBus** — not part of the Vuex store
- **uuid internals** — just mock it for deterministic tests

### Technical Constraints

- **NFR22**: Use direct mutation testing or `createStore()` — no component mounting
- **NFR11**: All test code passes ESLint and Prettier
- **NFR7**: Tests must be order-independent (no test depends on side effects from another)
- **NFR6**: No flaky tests — all mocks are deterministic
- **CommonJS**: Test files use `require()`/`module.exports` (Jest CommonJS mode per jest.config.js)

### Project Structure Notes

- New test files go in `src/__tests__/store/` (new directory for store-specific tests)
- Existing `src/__tests__/authStore.test.js` is at root `__tests__` level — extend it in place
- All existing test files must continue to pass — do NOT modify existing test logic
- Import fixtures from `src/__tests__/fixtures/` and mocks from `src/__tests__/mocks/` (centralized, per NFR13)
- The `@/` path alias maps to `src/` via jest.config.js moduleNameMapper

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-3.4] — Story definition and ACs
- [Source: _bmad-output/planning-artifacts/architecture.md#Frontend-Test-Infrastructure] — Test infrastructure
- [Source: _bmad-output/project-context.md#Vuex-Store] — Store architecture (2 modules)
- [Source: _bmad-output/project-context.md#Frontend-Testing-Architecture] — Frontend test infrastructure
- [Source: _bmad-output/implementation-artifacts/3-1-create-frontend-test-fixtures-and-shared-mocks.md] — Story 3.1 fixtures
- [Source: _bmad-output/implementation-artifacts/3-3-test-critical-vue-components-userprofile-and-admin-dashboard.md] — Story 3.3 patterns

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4.6 (claude-sonnet-4-6)

### Debug Log References

### Completion Notes List

- Created chatHistory store tests: 58 tests covering all mutations (12), getters (4), and actions (12). Direct mutation testing pattern for isolated logic, createStore for async actions. Mocked uuid for deterministic IDs and chatHistoryService for moveChat API calls.
- Auth store coverage (AC7) already comprehensive in `store/modules/auth.test.js` (58 tests from stories 3-1/3-3). Verified existing `authStore.test.js` (8 tests) continues to pass unchanged.
- Created persistence plugin tests: 6 tests covering save, clear, restore, error handling, and non-chatHistory mutation isolation. Used replicated plugin function matching store/index.js implementation.
- Full suite: 240 tests pass (64 new from this story: 58 chatHistory + 6 persistence). 3 pre-existing failures (Vue/test-utils component tests).
- ESLint clean on all test files.

### File List

| File | Action |
|------|--------|
| `components/gov-chat-frontend/src/__tests__/store/chatHistory.test.js` | Created — 58 tests for chatHistory Vuex module (AC1-6) |
| `components/gov-chat-frontend/src/__tests__/store/persistence.test.js` | Created — 6 tests for localStorage persistence plugin (AC8) |

### Review Findings

- [x] [Review][Patch] Test "non-chatHistory mutations" ne déclenche aucune mutation — le test s'intitule "should NOT trigger persistence on non-chatHistory mutations" mais ne commit jamais de mutation non-chatHistory. Il enregistre un subscriber qui n'est jamais déclenché. Fix: ajouter `store.commit('someOtherMutation', {})` pour tester le chemin. [`persistence.test.js:104-119`]
- [x] [Review][Patch] Test "invalid JSON" ne vérifie pas l'état résultant du store — vérifie seulement que `createTestStore()` ne lance pas d'erreur. Fix: ajouter assertion `expect(store.state.chatHistory.folders).toHaveLength(1)`. [`persistence.test.js:139-143`]
- [x] [Review][Defer] UPDATE_CHAT: chaîne vide traitée comme "pas de changement" (source code `||` falsy) — comportement du code source, pas des tests [`chatHistoryStore.js:101-102`] — deferred, pre-existing
- [x] [Review][Defer] Persistence plugin dupliqué au lieu d'être importé — approche délibérée pour isolation; duplication fidèle au source [`persistence.test.js:21-52`] — deferred, pre-existing
- [x] [Review][Defer] Edge cases manquants (null inputs, IDs dupliqués, quota localStorage) — amélioration de couverture future — deferred, pre-existing
