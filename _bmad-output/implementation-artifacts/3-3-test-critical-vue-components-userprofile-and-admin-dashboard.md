# Story 3.3: Test Critical Vue Components — UserProfile and Admin Dashboard

Status: review

## Story

As a developer,
I want component tests for UserProfileComponent and AdminDashboard,
so that profile management and admin functionality are validated.

## Acceptance Criteria

1. **AC1 — UserProfileComponent displays user profile data correctly**: When mounted with mocked profile data, the component renders name, email, and other profile fields from the loaded data.

2. **AC2 — UserProfileComponent edit mode allows profile modification**: Form fields are bound to `formData` and can be modified by the user (simulated via `wrapper.vm` or direct input interaction).

3. **AC3 — UserProfileComponent save triggers correct API call**: Clicking save triggers `userProfileService.updateProfile()` with the current form data after confirmation.

4. **AC4 — AdminDashboard renders without errors**: The component mounts successfully and renders the main dashboard structure (sidebar, tabs, content area) without throwing.

5. **AC5 — AdminDashboard admin-only access control**: The component reads auth state from Vuex store. Tests verify it accesses `currentUser` and `isAuthenticated` getters. Non-admin state does not crash the component.

6. **AC6 — AdminDashboard key admin sections render**: Tab navigation switches between tabs. The overview tab renders system health content. The users tab renders user management UI.

7. **AC7 — All component tests use Options API mount patterns (NFR22)**: Tests use `mount()` or `shallowMount()` from `@vue/test-utils` with proper Options API setup.

## Tasks / Subtasks

- [x] Task 1: Create UserProfileComponent test file (AC: #1–3)
  - [x] 1.1 Create `src/__tests__/components/UserProfileComponent.test.js`
  - [x] 1.2 Implement mount helper with all required mock providers (i18n, services, router, notificationService)
  - [x] 1.3 Test: renders profile data after loading (AC1)
  - [x] 1.4 Test: form fields are editable (AC2)
  - [x] 1.5 Test: save triggers API call with form data (AC3)
  - [x] 1.6 Test: loading state displayed while fetching profile
  - [x] 1.7 Test: error state displayed with retry option
  - [x] 1.8 Test: cancel button navigates back
- [x] Task 2: Create AdminDashboard test file (AC: #4–6)
  - [x] 2.1 Create `src/__tests__/components/AdminDashboard.test.js`
  - [x] 2.2 Implement mount helper with Vuex store, i18n, and all service mocks
  - [x] 2.3 Test: renders main dashboard structure without errors (AC4)
  - [x] 2.4 Test: accesses auth state from Vuex store (AC5)
  - [x] 2.5 Test: tab navigation switches active tab (AC6)
  - [x] 2.6 Test: overview tab renders system health content (AC6)
  - [x] 2.7 Test: users tab renders user management UI (AC6)
  - [x] 2.8 Test: loading state displayed during data fetch
- [x] Task 3: Verify and lint (AC: #7)
  - [x] 3.0 Run `npm test` in `components/gov-chat-frontend/` before any changes to confirm existing tests pass as baseline
  - [x] 3.1 All tests pass with `npm test` in `components/gov-chat-frontend/`
  - [x] 3.2 All test files pass ESLint (`npm run lint`)

## Dev Notes

### Component Analysis

**UserProfileComponent.vue** (`src/components/UserProfileComponent.vue`):
- Options API component, no props, emits `['save']`
- **No Vuex store** — all state is local (48 data properties)
- Key data: `formData` (8 sections, 28 fields), `isLoading`, `errorMessage`, `isSubmitting`, `showConfirmDialog`, `activeTab`
- Key methods for AC coverage: `loadUserProfileData()`, `confirmSave()`, `validateForm()`, `cancel()`
- Uses `userProfileService.getProfile()` on mount, `userProfileService.updateProfile()` on save
- Uses `notificationService` for success/error toasts
- Has a custom `translate(key, fallback)` method that prefixes `userProfile.` and checks `$te()` before `$t()`
- 3 watchers: `$i18n.locale`, `activeTab`, and two country dropdown watchers
- Child components: `DsTabs`, `DsButton`, `DsInput`, `DsSelect`, `DsCombobox`, `DsSpinner`, `DsStateDisplay`, `DsFormGroup`, `ConfirmDialog`, `SearchableCountryDropdown`

**AdminDashboard.vue** (`src/components/AdminDashboard.vue`, ~4,429 lines):
- Options API component, no props, no emits
- **Uses Vuex**: reads `currentUser`, `isAuthenticated`, `isAuthInitialized` getters
- Key data: `activeTab` (7 tabs: overview/hierarchy/documents/database/logs/security/users), `isLoading`, `metrics`, `userStats`, `securityMetrics`, `knowledgeHierarchy`, `documents`
- 80+ methods, 70+ data properties — **massive monolith**
- Services: `adminDashboardService`, `serviceTreeService`, `databaseOperationsService`, `documentFileService`
- Uses `eventBus` for notifications (`showNotification` method)
- Uses `oidcConfig` for Keycloak admin URL construction
- Uses `themeManager` for theme toggling
- Uses `languageConfig` for available languages
- Lifecycle: `mounted()` calls `loadInitialData()` and `getCurrentUser()`, listens for `themeChange` window event
- Watchers: `$i18n.locale`, `activeTab`, `documentSearchTerm`, `documentFilters`

### Dependencies That Must Be Mocked

**UserProfileComponent mocks:**

```
Services (mock with jest.mock() using closure-based refs):
- @/services/userProfileService — mock getProfile(), updateProfile()
- @/services/notificationService — mock success(), error(), info()

Child components (stub):
- DsButton, DsSpinner, DsStateDisplay, DsTabs, DsInput, DsSelect, DsCombobox, DsFormGroup
- ConfirmDialog
- SearchableCountryDropdown — CRITICAL: this component uses refs internally
  The parent calls this.$refs.nationalityDropdown.manuallySetCountryName() and
  this.$refs.countryDropdown.manuallySetCountryName() on mount. Stub must expose
  these as mock methods OR use shallowMount which auto-stubs.
```

**AdminDashboard mocks:**

```
Services (mock with jest.mock() using closure-based refs):
- @/services/adminDashboardService — mock getSystemHealth(), getUserStats(), getSecurityMetrics(), getLogs(), getLogsSummary(), searchLogs(), searchUsers(), getSecurityDetails(), runDiagnostics(), runSecurityScan(), rolloverLogs()
- @/services/serviceTreeService — mock getAdminCategories(), getCategoryTranslations(), getServiceTranslations(), createCategory(), updateCategory(), createService(), updateService(), deleteCategory(), deleteService()
- @/services/databaseOperationsService — mock getDatabaseStats(), backupDatabase(), optimizeDatabase()
- @/services/documentFileService — mock getFiles(), ingestMultipleFiles()
- @/services/notificationService — mock success(), error(), info()

Event bus:
- @/eventBus — mock $on, $emit, $off

Config modules:
- @/config/oidcConfig — mock default export with { authority, clientId }
- @/config/languageConfig — mock { availableLanguages: [...] }
- @/utils/fileUtils — mock { formatFileSize: jest.fn((size) => size + ' B') }
- @/utils/ThemeManager — mock { themeManager: { getCurrentTheme: jest.fn(), setTheme: jest.fn() } }

Child components (stub):
- DsButton, DsSpinner, DsStateDisplay, DsTabs, DsSelect, DsStatusTag
- OperationResultsModal, LogSearchDialog, UploadFilesDialog
- AddFromLinkDialog, FileDetailsDialog, ConfirmDialog
- lucide-vue-next icons (Loader2, etc.)
```

### Mount Helper Patterns

Follow the established pattern from story 3.2 (ChatBotComponent/NavBarComponent tests):

**UserProfileComponent mount helper:**

```javascript
// No Vuex needed — all local state
function createUserProfileWrapper(overrides = {}) {
  return mount(UserProfileComponent, {
    global: {
      mocks: {
        $t: (key) => key,
        $te: () => true,
        $i18n: { locale: 'en' },
        $router: { push: jest.fn(), back: jest.fn() },
        $route: { path: '/profile' }
      },
      stubs: {
        DsButton: {
          template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
          props: ['disabled', 'variant', 'small']
        },
        DsTabs: true,
        DsInput: true,
        DsSelect: true,
        DsCombobox: true,
        DsSpinner: true,
        DsStateDisplay: true,
        DsFormGroup: true,
        ConfirmDialog: true,
        SearchableCountryDropdown: {
          template: '<div></div>',
          methods: {
            manuallySetCountryName: jest.fn(),
            loadCountries: jest.fn()
          }
        }
      }
    }
  });
}
```

**AdminDashboard mount helper:**

```javascript
function createAdminDashboardWrapper(storeOverrides = {}) {
  const store = createAdminStore(storeOverrides);
  return mount(AdminDashboard, {
    global: {
      plugins: [store],
      mocks: {
        $t: (key) => key,
        $te: () => true,
        $i18n: { locale: 'en' }
      },
      stubs: {
        DsButton: {
          template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
          props: ['disabled', 'variant', 'small', 'tag']
        },
        DsTabs: {
          template: '<div><slot /></div>',
          props: ['tabs', 'modelValue']
        },
        DsSpinner: true,
        DsStateDisplay: true,
        DsSelect: true,
        DsStatusTag: true,
        OperationResultsModal: true,
        LogSearchDialog: true,
        UploadFilesDialog: true,
        AddFromLinkDialog: true,
        FileDetailsDialog: true,
        ConfirmDialog: true,
        Loader2: true
      }
    }
  });
}

function createAdminStore(overrides = {}) {
  const state = createAuthenticatedState(overrides);
  return createStore({
    state() { return state; },
    getters: {
      currentUser: (s) => s.user,
      isAuthenticated: (s) => s.isAuthenticated,
      isAuthInitialized: (s) => s.isInitialized
    }
  });
}
```

### AC Mapping

**UserProfileComponent:**

| AC | What to Test | Key Method/Element | Mock Needed |
|----|-------------|-------------------|-------------|
| AC1 | Profile data displays after load | `loadUserProfileData()` → template fields | `userProfileService.getProfile()` resolves with mock data |
| AC2 | Form fields are editable | `formData` bindings, input interaction | Same as AC1, modify `wrapper.vm.formData` |
| AC3 | Save triggers API call | `saveProfile()` → `confirmSave()` → `updateProfile()` | Mock `updateProfile()` to resolve, check calledWith |
| — | Loading state | `isLoading = true` | `getProfile()` that never resolves (use pending promise) |
| — | Error state with retry | `errorMessage` set, retry button | `getProfile()` rejects |
| — | Cancel navigates back | `cancel()` → `$router.back()` | Mock `$router.back()` |

**AdminDashboard:**

| AC | What to Test | Key Method/Element | Mock Needed |
|----|-------------|-------------------|-------------|
| AC4 | Renders without errors | Full mount | All services mocked, Vuex with authenticated admin user |
| AC5 | Auth state from Vuex | `getCurrentUser()`, template access | Stores with admin user, non-admin user, unauthenticated |
| AC6 | Tab navigation | `setActiveTab()`, `activeTab` data | `getSystemHealth()` resolves for overview, `getUserStats()` for users tab |
| — | Loading state | `isLoading = true` | Service mocks that don't resolve immediately |

### Critical Mocking Details

**UserProfileComponent — SearchableCountryDropdown refs:**
The component calls `this.$refs.nationalityDropdown.manuallySetCountryName()` and `this.$refs.countryDropdown.manuallySetCountryName()` in `loadUserProfileData()`. When using `shallowMount`, refs to stubbed components won't have these methods. Either:
- Use `mount()` with functional stubs that expose the mock methods, OR
- Use `shallowMount()` and set `wrapper.vm.$refs.nationalityDropdown = { manuallySetCountryName: jest.fn(), loadCountries: jest.fn() }` before triggering load

**UserProfileComponent — translate() method:**
The component uses a custom `translate(key, fallback)` method (NOT `$t()` directly). It checks `this.$te()` first, then falls back. Mock both `$t` and `$te` in global mocks.

**UserProfileComponent — confirmSave() flow:**
1. User clicks save → `saveProfile()` sets `showConfirmDialog = true`
2. ConfirmDialog emits `confirm` → `confirmSave()` runs
3. `confirmSave()` calls `validateForm()`, then `userProfileService.updateProfile(this.formData)`
4. On success: `notificationService.success()`, `this.$emit('save')`, `this.$router.push('/dashboard')`

**AdminDashboard — loadInitialData() on mount:**
`mounted()` calls `loadInitialData()` which loads data for the default active tab (overview). This triggers `getSystemHealth()` from `adminDashboardService`. The mock must resolve for the component to render without errors.

**AdminDashboard — window event listener:**
`mounted()` adds `window.addEventListener('themeChange', this.handleThemeChange)`. `beforeUnmount()` removes it. This works fine in jsdom.

**AdminDashboard — oidcConfig:**
The component imports `oidcConfig` to build the Keycloak admin URL (`keycloakAdminUrl` computed). Mock this as `{ authority: 'http://localhost:8080/realms/genie', clientId: 'genie-app' }`.

**AdminDashboard — themeManager:**
Imports `{ themeManager }` from `@/utils/ThemeManager`. Mock with `{ getCurrentTheme: jest.fn(() => 'light'), setTheme: jest.fn() }`.

### Files to Create

| File | Purpose |
|------|---------|
| `src/__tests__/components/UserProfileComponent.test.js` | UserProfileComponent tests (AC1–3 + loading/error/cancel) |
| `src/__tests__/components/AdminDashboard.test.js` | AdminDashboard tests (AC4–6 + tab navigation) |

### Files to Read (reference only, do NOT modify)

- `src/components/UserProfileComponent.vue` — component under test
- `src/components/AdminDashboard.vue` — component under test
- `src/services/userProfileService.js` — profile service (getProfile, updateProfile)
- `src/services/adminDashboardService.js` — admin dashboard service (getSystemHealth, getUserStats, etc.)
- `src/services/serviceTreeService.js` — category/service CRUD
- `src/services/databaseOperationsService.js` — database operations
- `src/services/documentFileService.js` — document file management
- `src/services/notificationService.js` — toast notifications
- `src/store/modules/auth.js` — auth module (getters used by AdminDashboard)
- `src/eventBus.js` — event bus
- `src/config/oidcConfig.js` — OIDC configuration
- `src/config/languageConfig.js` — language configuration
- `src/utils/ThemeManager.js` — theme manager utility
- `src/__tests__/fixtures/store-state.js` — store state factories (from Story 3.1)
- `src/__tests__/fixtures/api-responses.js` — API response fixtures (from Story 3.1)
- `src/__tests__/mocks/axios.js` — axios mock (from Story 3.1)
- `src/__tests__/components/ChatBotComponent.test.js` — reference for established test patterns
- `src/__tests__/components/NavBarComponent.test.js` — reference for established test patterns

### What NOT to Test (Out of Scope)

- **AdminDashboard deep tab functionality** — each tab (hierarchy CRUD, document upload, database operations, log search, security scan) is too complex for this story. Test only that tabs render and switch correctly.
- **Knowledge hierarchy CRUD** — creating/editing/deleting categories and services with translations. Deferred.
- **Document upload/link dialogs** — file upload interactions, batch ingest. Deferred.
- **Log search dialog** — advanced log filtering. Deferred.
- **Security scan execution** — running scans and displaying results. Deferred.
- **UserProfileComponent file upload** — the profile icon upload flow (triggerFileUpload, handleFileUpload, confirmUpload, useInitials). Complex Canvas API and FileReader interactions. Deferred.
- **UserProfileComponent country dropdown** — SearchableCountryDropdown interaction, locale changes, localStorage persistence. Deferred.
- **AdminDashboard theme toggling** — theme change event handling. Deferred.
- **Responsive layout / CSS** — not testable with jsdom.

### Established Test Infrastructure (from Stories 3.1 and 3.2)

**Available fixtures and mocks — USE THESE, do NOT recreate:**
- `src/__tests__/mocks/axios.js` — `setSuccessResponse()`, `setErrorResponse()`, `resetAxiosMock()`
- `src/__tests__/mocks/keycloakAuthService.js` — `createMockKeycloakUser()`, `createMockToken()`, `resetKeycloakMock()`
- `src/__tests__/fixtures/store-state.js` — `createAuthenticatedState(overrides)`, `createUnauthenticatedState()`
- `src/__tests__/fixtures/api-responses.js` — `userProfileResponse`, `analyticsDashboardResponse`, `fileListResponse`, etc.

**Jest config** (`jest.config.js`):
- Environment: jsdom
- Transform: `@vue/vue3-jest` for .vue, `babel-jest` for .js
- Path alias: `@/` → `src/`
- Setup: `src/__tests__/setup.js` (mocks console.warn/debug, sets window.APP_CONFIG)

**Established patterns from Story 3.2:**
- Closure-based mock references for `jest.mock()` to avoid hoisting issues
- Store factory functions for different auth states
- `beforeEach(() => { jest.clearAllMocks(); })` for test isolation
- `await wrapper.vm.$nextTick()` after state changes
- Stub DsButton with functional template for `:disabled` testing
- Group tests by AC number in `describe()` blocks

### Technical Constraints

- **NFR22**: Use Options API mount patterns exclusively — no Composition API test patterns
- **NFR11**: All test code passes ESLint and Prettier
- **NFR7**: Tests must be order-independent (no test depends on side effects from another)
- **NFR6**: No flaky tests — all mocks are deterministic

### Project Structure Notes

- Test files go in `src/__tests__/components/` following the established convention
- All existing test files in `src/__tests__/` must continue to pass — do NOT modify them
- Import fixtures from `src/__tests__/fixtures/` and mocks from `src/__tests__/mocks/` (centralized, per NFR13)
- The `@/` path alias maps to `src/` via jest.config.js moduleNameMapper
- Story 3.2 established the `src/__tests__/components/` directory — add new files there

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-3.3] — Story definition and ACs
- [Source: _bmad-output/planning-artifacts/architecture.md#Mock-&-Fixture-Patterns] — Mock patterns
- [Source: _bmad-output/planning-artifacts/architecture.md#Test-Naming-Patterns] — Naming conventions
- [Source: _bmad-output/project-context.md#Frontend-Testing-Architecture] — Frontend test infrastructure
- [Source: _bmad-output/implementation-artifacts/3-1-create-frontend-test-fixtures-and-shared-mocks.md] — Story 3.1 fixtures
- [Source: _bmad-output/implementation-artifacts/3-2-test-critical-vue-components-chatbot-and-navbar.md] — Story 3.2 patterns and learnings

## Dev Agent Record

### Agent Model Used

Claude (glm-5-turbo)

### Debug Log References

- UserProfileComponent getProfile mock initially used deferred Promise pattern which caused timeout on confirmSave tests — switched updateProfile to mockResolvedValue while keeping getProfile deferred for loading/error tests

### Completion Notes List

- 22 UserProfileComponent tests: AC1 (profile data display), AC2 (form editing), AC3 (save flow with API call, success/error notifications, navigation), loading state, error+retry, cancel navigation, tab structure
- 20 AdminDashboard tests: AC4 (mount without errors, default tabs, loadInitialData), AC5 (Vuex auth state, unauthenticated resilience), AC6 (tab navigation, data loading per tab, overview health metrics, users tab), loading state, lifecycle cleanup, keycloakAdminUrl computed
- All 254 tests pass (212 existing + 42 new), zero regressions
- ESLint passes on all new files
- Used closure-based mock pattern, deferred Promise for getProfile (loading/error), immediate mockResolvedValue for updateProfile and admin service calls
- AdminDashboard searchUsers uses userSearchResults (not userStats.users) — corrected during red phase

### File List

- `components/gov-chat-frontend/src/__tests__/components/UserProfileComponent.test.js` — NEW (22 tests)
- `components/gov-chat-frontend/src/__tests__/components/AdminDashboard.test.js` — NEW (20 tests)
- `_bmad-output/implementation-artifacts/3-3-test-critical-vue-components-userprofile-and-admin-dashboard.md` — MODIFIED (tasks checked, dev record updated)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — MODIFIED (status: in-progress)
