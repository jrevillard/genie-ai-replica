# Story 2-9: Test Backend Admin and Security Services

Status: done

## Story

As a developer,
I want comprehensive test coverage for the admin dashboard, security scan, and logs services,
So that these critical system services are reliable and maintainable.

## Acceptance Criteria

1. **AC1**: Admin dashboard service has complete test coverage for system health, database stats, user stats, security metrics, diagnostics, and user search with mocked ArangoDB
2. **AC2**: Security scan service has complete test coverage for ClamAV integration, scan lifecycle, result retrieval, and error handling with mocked ClamAV
3. **AC3**: Logs service has complete test coverage for log retrieval with filters, search, rollover, summary, and debug export with mocked winston/logger
4. **AC4**: Mock conventions follow story 2-7 pattern (shared-lib virtual, arangojs mock, jest.isolateModules)
5. **AC5**: All existing tests pass, zero lint errors
6. **AC6**: Backend coverage increases from ~38% to ~50% (statements)

## Tasks / Subtasks

- [ ] Task 1: Create test file `__tests__/services/admin-dashboard-service.test.js` (500 lines target)
- [ ] Task 2: Create test file `__tests__/services/security-scan-service.test.js` (430 lines target)
- [ ] Task 3: Create test file `__tests__/services/logs-service.test.js` (423 lines target)
- [ ] Task 4: Run coverage report to verify ~50% backend coverage target
- [ ] Task 5: Run full test suite to ensure no regressions
- [ ] Task 6: Run lint and fix any errors

## Dev Notes

Follow story 2-7 service unit test pattern exactly:
- Services are class singletons - use jest.isolateModules() to reset between tests
- Mock shared-lib with `{ virtual: true }` in package.json
- Mock arangojs with custom aql helper factory
- For security-scan-service: mock ClamAV socket/HTTP client (tcp-port or http-client depending on implementation)
- For logs-service: mock winston logger instances and file system operations
- Test both success and error paths
- Use descriptive test names following `serviceName -> method -> condition` pattern

## Change Log

### Review Findings

- [x] [Review][Defer] Date calculation in test setup without Date mocking — midnight boundary flakiness risk in logs-service.test.js (new Date() calls without mocking). Deferred: extremely unlikely edge case, tests pass in CI.
- [x] [Review][Defer] ResourceUsageMonitor 30s cache behavior untested — getResourceUsage() caches for 30s but no test verifies cache hit/miss with mocked Date.now(). Deferred: AC1 satisfied, nice-to-have hardening.
- [x] [Review][Defer] SecurityScanService worker thread / async pattern edge cases — processLogsInParallel() with Worker threads, timeouts, and concurrent file processing has limited edge case coverage. Deferred: worker thread mocking is extremely complex, ACs satisfied.
- [x] [Review][Defer] LogsService file size limit edge cases — MAX_LOG_FILE_SIZE (20MB) and MAX_LINES_TO_PROCESS (200000) constants exist but edge cases around partial reads and corrupted gzip not fully tested. Deferred: happy path tested, hardening beyond AC scope.
- [x] [Review][Defer] Date/time edge case coverage — DST transitions, timezone boundaries, leap years not explicitly tested across all services. Deferred: luxon handles these, testing is nice-to-have hardening.
