# Story 2-11: Test Backend Chat History Completion and Database Operations

Status: backlog

## Story

As a developer,
I want to complete test coverage for chat history services and add tests for database operations, service categories, weather, and key handler utilities,
So that backend coverage reaches the professional 70%+ target.

## Acceptance Criteria

1. **AC1**: Chat history service coverage extends from 65% to 85% by completing remaining folder operations, search, move, and batch operations tests
2. **AC2**: Chat history routes coverage extends from 42% to 70% by testing the remaining 21 untested endpoints (folders CRUD, conversation-folder operations, search, stats, move)
3. **AC3**: Database operations service has complete test coverage for backup, restore, and optimize with mocked ArangoDB
4. **AC4**: Service category service has complete test coverage for category CRUD, translations, and initialization with mocked ArangoDB
5. **AC5**: Weather service has complete test coverage for weather data fetching with mocked HTTP client
6. **AC6**: Key handler has complete test coverage for ArangoDB key sanitization (pure function, no mocks needed)
7. **AC7**: All existing tests pass, zero lint errors
8. **AC8**: Backend coverage reaches ~72% (statements), exceeding 70% professional target

## Tasks / Subtasks

- [ ] Task 1: Extend `__tests__/services/chat-history-service.test.js` with remaining tests (224 lines uncovered → target 85%)
- [ ] Task 2: Extend `__tests__/routes/chat-history-routes.test.js` with remaining 21 endpoints (223 lines uncovered → target 70%)
- [ ] Task 3: Create test file `__tests__/services/database-operations-service.test.js` (180 lines target)
- [ ] Task 4: Create test file `__tests__/services/service-category-service.test.js` (309 lines target)
- [ ] Task 5: Create test file `__tests__/services/weather-service.test.js` (85 lines target)
- [ ] Task 6: Create test file `__tests__/services/key-handler.test.js` (24 lines target)
- [ ] Task 7: Run coverage report to verify ~72% backend coverage target
- [ ] Task 8: Run full test suite to ensure no regressions
- [ ] Task 9: Run lint and fix any errors

## Dev Notes

- For chat-history-service and chat-history-routes: EXTEND existing test files, do not recreate
- For database-operations-service: mock ArangoDB export/import APIs and file system operations
- For service-category-service: follow story 2-7 pattern with collection mock factories and translation mocks
- For weather-service: mock external HTTP client (axios or fetch depending on implementation)
- For key-handler: pure function test, no mocking needed - test all edge cases (special chars, length limits, encoding)
- Test both success and error paths for all services
- Use descriptive test names following `serviceName -> method -> condition` pattern

## Change Log
