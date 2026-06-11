# Investigation: Frontend Codebase Structure for Epic 3 Test Planning

## Hand-off Brief

1. **What happened.** Frontend codebase is 84% pure Options API (43/51 .vue files), 16% mixed with composables (7 chart components), with 2 Vuex modules, 13 HTTP service files (~85 API endpoints), and an existing Jest 29 setup with 240 tests covering services/auth/router but zero component tests.
2. **Where the case stands.** Concluded — all four evidence areas fully mapped. The testing foundation is solid (Jest + @vue/test-utils installed, good service-level mock patterns established), but component testing is the critical gap for Epic 3.
3. **What's needed next.** Epic 3 should focus on Vue component testing using @vue/test-utils with mount/shallowMount, leveraging the existing mock patterns for services and Vuex. Priority targets: pure Options API components (DS components, then feature components), avoiding the 7 mixed chart components initially.

## Case Info

| Field            | Value                                                                      |
| ---------------- | -------------------------------------------------------------------------- |
| Ticket           | N/A (Epic 3 planning context)                                              |
| Date opened      | 2026-05-19                                                                 |
| Status           | Concluded                                                                  |
| System           | Vue 3.2+, Vuex 4, Vue CLI 5, Jest 29.7, jsdom, @vue/test-utils 2.4.6     |
| Evidence sources | 51 .vue files, 2 Vuex modules, 13 service files, 8 test files (240 tests), jest.config.js, package.json |

## Problem Statement

Epic 3 of the testing-framework initiative requires implementing a frontend testing strategy. Before writing tests, we need to understand: (1) which Vue API patterns are in use (Options vs Composition API), (2) how Vuex modules are organized and what they contain, (3) the HTTP service layer patterns for mocking, and (4) what test infrastructure already exists.

## Evidence Inventory

| Source                  | Status    | Notes                                        |
| ----------------------- | --------- | -------------------------------------------- |
| Vue components/views    | Available | 51 .vue files fully classified by API type   |
| Vuex store modules      | Available | 2 modules fully documented                   |
| HTTP services (axios)   | Available | 13 services, ~85 endpoints, interceptor chain documented |
| Test config & existing  | Available | 8 test files, 240 tests, jest.config.js fully read |
| project-context.md      | Available | Confirms Options API, Jest, Vue CLI 5        |

## Investigation Backlog

| # | Path to Explore                                       | Priority | Status   | Notes                                      |
| - | ----------------------------------------------------- | -------- | -------- | ------------------------------------------ |
| 1 | Vue component API patterns (Options vs Composition)   | High     | Done     | 43 Options API, 7 mixed, 0 script setup    |
| 2 | Vuex store module organization                        | High     | Done     | 2 modules: auth + chatHistory              |
| 3 | HTTP service layer and axios patterns                 | High     | Done     | 13 services, httpService.js base layer     |
| 4 | Existing test infrastructure                          | High     | Done     | Jest 29.7, 8 files, 240 tests, 0 component |
| 5 | Synthesize findings into testability assessment       | Medium   | Done     | See Conclusion                             |

## Timeline of Events

| Time        | Event                                         | Source         | Confidence |
| ----------- | --------------------------------------------- | -------------- | ---------- |
| 2026-05-19  | Investigation opened, 4 parallel agents       | Investigation  | Confirmed  |
| 2026-05-19  | project-context.md confirms Options API only   | project-context.md | Confirmed |
| 2026-05-19  | All 4 agents completed — evidence fully mapped | Agent results  | Confirmed  |

## Confirmed Findings

### Finding 1: 51 Vue files — overwhelmingly Options API

**Evidence:** Full scan of all .vue files in `src/components/`, `src/views/`, `src/App.vue`

**Detail:**
- **43 pure Options API** (84%): All DS components (11), most feature components (28), both views (2), App.vue (1), SplashComponent.vue (1)
- **7 mixed Options API + setup()** (14%): All chart components — `AnalyticsComponent.vue`, `UsageTrendChart.vue`, `charts/CategoryDistributionChart.vue`, `charts/SatisfactionGauge.vue`, `charts/SatisfactionHeatmap.vue`, `charts/TopQueriesChart.vue`, `charts/UsageTrendChart.vue`
- **0 `<script setup>`** — rule is respected
- **1 composable**: `useChartTheme.js` — theme detection (light/dark/system) with MutationObserver, consumed by the 7 chart components via `setup()` bridge

### Finding 2: 2 Vuex modules, minimal cross-module coupling

**Evidence:** `src/store/index.js`, `src/store/modules/auth.js`, `src/store/chatHistoryStore.js`

**Detail:**
- **auth module** (not namespaced): state `{isAuthenticated, user, accessToken, error, isInitialized}`, 6 getters, 6 mutations, 6 actions (all async, all call `keycloakAuthService`). Handles OIDC lifecycle (init, login, callback, logout, token refresh, error parsing).
- **chatHistory module** (namespaced): state `{folders, chats, folderChats}`, 4 getters, 12 mutations, 12 actions (mostly synchronous commits, only `moveChat` calls API). Manages folder-based chat organization with localStorage persistence plugin.
- **Cross-module dependency**: chatHistory → auth via `rootGetters['auth/currentUser']` in `moveChat` action only.
- **Store index**: Registers both modules + localStorage persistence plugin for chatHistory.

### Finding 3: 13 HTTP services with centralized auth/interceptor pattern

**Evidence:** All files in `src/services/`

**Detail:**
- **httpService.js** (base): Axios instance with request interceptor (Bearer token injection via `keycloakAuthService.getAccessToken()`), response error interceptor (401 → silent token refresh → single retry → Keycloak redirect), structured error parsing (`parseAuthError()`), `putNoCache()` for cache-busting.
- **12 domain services**: serviceTreeService (13 endpoints), chatHistoryService (25 endpoints), adminDashboardService (11), analyticsService (8), documentFileService (16), fileService (7), chatbotService (5), labelService (4), userProfileService (4), userService (2), databaseOperationsService (3), weatherService (1).
- **Non-HTTP services**: `keycloakAuthService` (OIDC via oidc-client-ts UserManager), `notificationService` (eventBus-based, no HTTP).
- **SSE streaming**: `chatbotService.submitQueryStream` uses native Fetch API with AbortController, bypasses axios.
- **Error pattern**: All services use try/catch with console.error and re-throw; auth errors handled centrally by httpService interceptor.
- **File upload pattern**: `fileService`, `documentFileService`, `userProfileService` use `multipart/form-data` via FormData.

### Finding 4: Jest 29.7 with 240 existing tests — strong service layer, zero component tests

**Evidence:** `jest.config.js`, `package.json`, all files in `src/__tests__/`

**Detail:**
- **Framework**: Jest 29.7.0, jsdom environment, babel-jest + @vue/vue3-jest transforms, `@/` path alias mapped.
- **Dependencies**: jest, jest-environment-jsdom, babel-jest, @vue/test-utils@2.4.6, @vue/vue3-jest, @babel/preset-env — all installed.
- **Setup**: `src/__tests__/setup.js` (global test setup).
- **8 existing test files, 240 tests total**:

| File | Tests | Coverage Area |
|------|-------|---------------|
| `store/modules/auth.test.js` | 120 | Vuex auth module: getters, mutations, actions, user mapping, role extraction, session flags |
| `keycloakAuthService.test.js` | 32 | OIDC lifecycle: UserManager, token storage, events, silent renew |
| `httpService-401-retry.test.js` | 30 | HTTP 401 retry logic, token refresh, error parsing, notification |
| `httpService.test.js` | 21 | Axios interceptors, URL building, HTTP method wrappers |
| `router.test.js` | 13 | Navigation guards, auth integration, route protection |
| `userUtils.test.js` | 8 | getUserId extraction, user availability guards |
| `oidcConfig.test.js` | 8 | Config loading, env var precedence, fallback chains |
| `authStore.test.js` | 8 | Vuex auth module logout, state management, legacy cleanup |

- **Established mock patterns**: `jest.mock()` for hoisted module mocking, manual mock factories (createMockUser, createState), service layer mocking, axios interceptor mocking, OIDC UserManager mocking, localStorage/sessionStorage mocking, window.APP_CONFIG mocking.
- **Gaps**: Zero component tests, no coverage reporting, no integration/E2E tests, no tests for DS components, notifications, file upload, analytics, i18n.

## Deduced Conclusions

### Deduction 1: @vue/test-utils is ready for component testing — no setup gap

**Based on:** Finding 4 (dependencies installed, jest.config.js has vue3-jest transform)

**Reasoning:** @vue/test-utils@2.4.6 and @vue/vue3-jest are installed and configured. The jsdom environment is set. The `@/` alias is mapped. The only missing piece is writing the tests themselves.

**Conclusion:** Epic 3 does not need to invest in test infrastructure setup — it can immediately start writing component tests.

### Deduction 2: Service mocking patterns are well-established and reusable

**Based on:** Finding 4 (240 existing tests mock services consistently)

**Reasoning:** The existing tests demonstrate mature patterns for mocking keycloakAuthService, httpService, notificationService, localStorage, and Vuex store. These patterns can be directly reused for component tests via `global.mocks` or `global.plugins` in mount/shallowMount options.

**Conclusion:** Component test scaffolding will be straightforward — the mock infrastructure already exists.

### Deduction 3: The 7 mixed chart components need special test handling

**Based on:** Finding 1 (chart components use setup() + useChartTheme composable)

**Reasoning:** The `useChartTheme` composable uses MutationObserver and matchMedia listeners. Mounting these components in jsdom will require mocking `window.matchMedia` and potentially MutationObserver. The chart libraries (ECharts, ApexCharts) also need to be mocked or stubbed.

**Conclusion:** Chart components should be deferred in Epic 3 scope — focus on the 43 pure Options API components first, where no composable mocking is needed.

## Hypothesized Paths

### Hypothesis 1: Composables directory contains reusable utility functions, not Composition API components

**Status:** Confirmed

**Theory:** The `composables/` directory likely contains shared reactive utilities or helper functions that use Composition API internally but are consumed by Options API components.

**Resolution:** Confirmed — `useChartTheme.js` is a single composable that provides reactive theme detection consumed via `setup()` bridge in 7 chart components. All other components are pure Options API.

### Hypothesis 2: Existing test infrastructure is minimal (Jest configured but few/no tests)

**Status:** Refuted

**Theory:** project-context.md notes "Jest configured but no test files exist" — the frontend may have a similar state.

**Resolution:** Refuted — the frontend has substantial test coverage at the service/utility layer (240 tests across 8 files). The gap is specifically in component testing, not overall test infrastructure.

## Missing Evidence

All evidence gaps resolved. No missing evidence.

## Source Code Trace

| Element       | Detail                                         |
| ------------- | ---------------------------------------------- |
| Error origin  | N/A (exploration, not symptom-driven)          |
| Trigger       | Epic 3 test planning requirement               |
| Condition     | Component testing is the critical gap          |
| Related files | 51 .vue files, 2 store modules, 13 services, 8 test files |

## Conclusion

**Confidence:** High

The frontend codebase is well-suited for introducing component testing:

**What is Confirmed:**
- **Options API dominance** (84%) means standard @vue/test-utils patterns apply — `mount()`/`shallowMount()` with `global.plugins` for Vuex, `global.mocks` for services, no Composition API complexity for most components.
- **Simple Vuex** (2 modules, 1 cross-dependency) means store mocking is straightforward — shallow clone of auth state or create a test store with `createStore()`.
- **Centralized HTTP layer** means mocking `httpService` at the module level is sufficient to isolate all API-dependent components.
- **Established test patterns** (240 tests, mature mocks) provide clear templates for new component tests.
- **Test infra is ready** — Jest, jsdom, @vue/test-utils, vue3-jest all installed and configured.

**What to defer:**
- Chart components (7 mixed API) — require composable mocking + chart library stubs.
- SSE streaming (`chatbotService.submitQueryStream`) — uses native Fetch, different mock pattern.
- File upload components — require FormData/multipart mocking, higher complexity.

**Priority component targets for Epic 3 (by simplicity):**
1. **DS components** (11): Pure Options API, no Vuex, no services — ideal first targets for testing patterns.
2. **Simple feature components**: ConfirmDialog, ModalDialog, ContextMenu, LanguageSelector — minimal dependencies.
3. **Vuex-connected components**: ChatBotComponent, NavBarComponent, SideBarComponent — need store mocking.
4. **Service-connected components**: FileUploadComponent, AdminDashboard — need service mocking.

## Recommended Next Steps

### Fix direction

Epic 3 should implement a phased component testing strategy:

**Phase 1 — Foundation (DS components):**
- Write tests for 3-5 DS components (Button, Input, Modal, Spinner, StatusTag)
- Establish mount helpers, Vuex factory, service mock factories
- Configure coverage reporting (add `collectCoverageFrom` to jest.config.js)

**Phase 2 — Feature components (simple):**
- Test pure Options API feature components with minimal deps
- ConfirmDialog, ModalDialog, ContextMenu, LanguageSelector

**Phase 3 — Feature components (connected):**
- Test Vuex-connected components using test store factory
- ChatBotComponent, NavBarComponent, SideBarComponent
- Test service-connected components using existing mock patterns

### Diagnostic

No additional diagnostics needed — the evidence is conclusive.

## Reproduction Plan

N/A (exploration, not symptom-driven).

## Side Findings

- The `auth` Vuex module is not namespaced, which is unusual for a multi-module store. This could cause naming collisions if more modules are added. Not blocking for Epic 3 but worth noting.
- The `chatHistory` module uses both uppercase (SET_FOLDER_CHATS) and camelCase (setFolders) mutation naming — inconsistent convention.
- `notificationService` is purely eventBus-based (no HTTP), making it trivially mockable for component tests.
- The SSE streaming in `chatbotService` bypasses axios entirely — tests involving streaming will need Fetch API mocking rather than axios mocking.

## Follow-up: 2026-05-19

### New Evidence

All four investigation areas completed:
1. Vue API patterns: 51 files classified (43 Options, 7 mixed, 0 script setup)
2. Vuex modules: 2 modules fully documented (auth + chatHistory)
3. HTTP services: 13 services, ~85 endpoints, interceptor chain mapped
4. Test infrastructure: Jest 29.7, 240 tests in 8 files, zero component tests

### Additional Findings

See Confirmed Findings #1–#4 above.

### Updated Hypotheses

- Hypothesis 1 (composables = utility functions): **Confirmed**
- Hypothesis 2 (minimal test infrastructure): **Refuted** — substantial service-layer testing exists

### Backlog Changes

All backlog items marked Done.

### Updated Conclusion

Investigation concluded with High confidence. The frontend is ready for component testing with no infrastructure gaps. Epic 3 should focus on the 43 pure Options API components, starting with DS components for pattern establishment.
