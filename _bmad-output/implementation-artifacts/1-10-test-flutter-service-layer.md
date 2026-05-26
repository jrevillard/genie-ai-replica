# Story 1-10: Test Flutter Service Layer (Non-Auth)

Status: backlog

## Story

As a developer,
I want comprehensive unit test coverage for all Flutter services (beyond auth),
So that business logic is validated and regressions are caught early.

## Acceptance Criteria

1. **AC1**: `connectivity_service.dart` (188 lines) — test connectivity state changes, stream behavior, and listener notifications
2. **AC2**: `i18n_service.dart` (151 lines) — test locale switching, translation loading, fallback to default locale, and missing key handling
3. **AC3**: `user_service.dart` (60 lines) — test user CRUD operations (get, update, delete) with mocked API calls
4. **AC4**: `genie_ai_config.dart` (47 lines) — test config loading from environment, default values, and validation rules
5. **AC5**: `notification_service.dart` (29 lines) — test notification dispatch, subscription management, and event propagation
6. **AC6**: Auth helpers — test `connectivity_checker.dart` (network reachability checks) and `insecure_http_client.dart` (dev mode HTTP client)
7. **AC7**: `app_auth.dart` (24 lines) — test auth facade methods (login, logout, token refresh) with mocked underlying services
8. **AC8**: All existing tests pass (no regressions in `test/services/auth/`)
9. **AC9**: Coverage increases from ~67% to ~75% (target: +8 percentage points)
10. **AC10**: All tests run successfully in CI pipeline

## Tasks / Subtasks

- [ ] Task 1: Create test file for `connectivity_service.dart`
  - [ ] Test initial connectivity state
  - [ ] Test connectivity state changes (online → offline, offline → online)
  - [ ] Test stream emissions and subscription behavior
  - [ ] Test listener registration/unregistration
- [ ] Task 2: Create test file for `i18n_service.dart`
  - [ ] Test default locale initialization
  - [ ] Test locale switching and translation reloading
  - [ ] Test missing translation key fallback
  - [ ] Test loading of locale files from assets
- [ ] Task 3: Create test file for `user_service.dart`
  - [ ] Test user profile retrieval
  - [ ] Test user profile update with API call
  - [ ] Test user profile deletion
  - [ ] Test error handling (network failures, 404, etc.)
- [ ] Task 4: Create test file for `genie_ai_config.dart`
  - [ ] Test config loading from environment variables
  - [ ] Test default values when env vars are missing
  - [ ] Test validation rules (API endpoints, timeouts, etc.)
  - [ ] Test flavor-specific config overrides
- [ ] Task 5: Create test file for `notification_service.dart`
  - [ ] Test notification dispatch to listeners
  - [ ] Test subscription/unsubscription behavior
  - [ ] Test event payload propagation
  - [ ] Test notification filtering by type
- [ ] Task 6: Create test file for `connectivity_checker.dart`
  - [ ] Test network reachability detection
  - [ ] Test cached connectivity state
  - [ ] Test periodic connectivity checks
- [ ] Task 7: Create test file for `insecure_http_client.dart`
  - [ ] Test HTTP client creation in dev mode
  - [ ] Test SSL certificate bypass behavior
  - [ ] Test request/response handling
- [ ] Task 8: Create test file for `app_auth.dart`
  - [ ] Test login with valid credentials
  - [ ] Test logout and token clearing
  - [ ] Test token refresh with valid refresh token
  - [ ] Test authentication state stream emissions
- [ ] Task 9: Verify all existing tests still pass
  - [ ] Run tests locally: `flutter test`
  - [ ] Check coverage report: `flutter test --coverage`
  - [ ] Fix any regressions introduced by new tests
- [ ] Task 10: Update CI pipeline expectations
  - [ ] Verify coverage threshold increased to 75%
  - [ ] Ensure test execution time remains acceptable
  - [ ] Document any new mock dependencies

## Dev Notes

**Test Patterns:**
- Use `test()` for unit tests (service layer is pure Dart, no widgets)
- Use `mockito` package for mocking dependencies (API clients, auth services, etc.)
- Follow existing test patterns in `test/services/auth/` for consistency
- Group related tests using `group()` for better organization

**Mock Strategy:**
- Mock HTTP clients (`MockClient`) for services that make API calls
- Mock `KeycloakService` for `app_auth.dart` tests
- Mock `SharedPreferences` for config/storage tests
- Use `StreamController` for testing stream-based services (connectivity, auth state)

**Coverage Tracking:**
- Run `flutter test --coverage` to generate coverage reports
- Use `lcov` or `genhtml` to view detailed coverage
- Focus on testing business logic, not trivial getters/setters
- Exclude generated files (e.g., `*.g.dart`, `*.freezed.dart`) from coverage

**Common Pitfalls:**
- Always reset mocks between tests using `reset()` or `resetMockitoState()`
- Use `expectLater()` for stream-based assertions
- Test both success and error paths for all async operations
- For `i18n_service`, mock asset bundle loading to avoid file I/O dependencies

**CI Integration:**
- Tests must run in GitHub Actions workflow (existing Flutter job)
- Coverage threshold will be updated in workflow YAML after completion
- All tests should complete within 10 minutes (CI timeout constraint)

## Change Log
