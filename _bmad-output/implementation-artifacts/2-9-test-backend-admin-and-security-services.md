# Story 2.9: Test Backend Admin and Security Services

Status: ready-for-dev

## Story

As a developer,
I want comprehensive test coverage for the admin dashboard, security scan, and logs services,
So that these critical system services are reliable and maintainable.

## Acceptance Criteria

1. **AC1**: AdminDashboardService — all 24 methods tested: init, getSystemHealth, storeAnalyticsData, getDatabaseStats, getUserStats, searchUsers, refreshResourceUsage, getSecurityMetrics, runDiagnostics, runSecurityScan, checkDatabaseHealth, backupDatabase, optimizeDatabase, getLogs, rolloverLogs, getLogsSummary, debugYesterdayLogs, searchLogs, formatTimeAgo, setLogsService, setSecurityScanService, plus ResourceUsageMonitor (getCpuUsage, getMemoryUsage, getStorageUsage, getNetworkUsage, getResourceUsage with caching)
2. **AC2**: SecurityScanService (object literal, not a class) — all 23 exported functions tested: isGzipValid, getDescriptorCount, closeWinstonTransports, reopenWinstonTransports, checkCachedResults, runSecurityScan, processLogsInParallel (mock worker_threads), checkLogsForIssues, checkFailedLogins, checkSuspiciousActivities, deduplicateVulnerabilities, parseLogLine (3 formats + invalid), getLastScanDetails, scanForVulnerabilities, checkSecurityHeaders, checkServerLeakage, checkTimestampDisclosure, checkCorsConfiguration, checkHiddenFiles, removeDuplicateLogEntries, loginIssues, generateRecommendations, saveScanResults. NOTE: No ClamAV integration — this service does log-based security analysis and HTTP header vulnerability scanning.
3. **AC3**: LogsService — all 14 methods tested: init, getLogsSummary, searchLogs, fileExists, readLogFile, getLogFilesInRange, extractDateFromFilename, extractLogs, groupLogs, parseLogs, detectLogLevel, detectService, getDateRange, debugYesterdayLogs, plus singleton getInstance()
4. **AC4**: Mock conventions follow story 2-7/2-8 pattern (shared-lib virtual, arangojs mock, jest.isolateModules)
5. **AC5**: All existing tests pass, zero lint errors
6. **AC6**: Backend coverage increases from ~38% to ~50% (statements)

## Tasks / Subtasks

- [ ] Task 1: Create `__tests__/services/logs-service.test.js` (AC3)
  - [ ] 1.1 Mock setup: shared-lib (virtual), fs.promises, zlib, path-sanitizer
  - [ ] 1.2 Test singleton getInstance() and init()
  - [ ] 1.3 Test pure functions: parseLogs, detectLogLevel, detectService, extractLogs, groupLogs, getDateRange, extractDateFromFilename
  - [ ] 1.4 Test file operations: fileExists, readLogFile (plain + .gz), getLogFilesInRange
  - [ ] 1.5 Test high-level methods: searchLogs, getLogsSummary, debugYesterdayLogs
  - [ ] 1.6 Test error paths for each method
- [ ] Task 2: Create `__tests__/services/security-scan-service.test.js` (AC2)
  - [ ] 2.1 Mock setup: shared-lib (virtual), fs.promises, child_process, axios, luxon, config
  - [ ] 2.2 Test pure functions: parseLogLine (3 formats + invalid), deduplicateVulnerabilities, removeDuplicateLogEntries, generateRecommendations
  - [ ] 2.3 Test file operations: isGzipValid, getDescriptorCount, checkCachedResults, getLastScanDetails, saveScanResults
  - [ ] 2.4 Test HTTP security checks: scanForVulnerabilities, checkSecurityHeaders, checkServerLeakage, checkTimestampDisclosure, checkCorsConfiguration, checkHiddenFiles
  - [ ] 2.5 Test orchestrator methods: runSecurityScan, processLogsInParallel, checkLogsForIssues, checkFailedLogins, checkSuspiciousActivities, loginIssues
  - [ ] 2.6 Test winston transport methods: closeWinstonTransports, reopenWinstonTransports
- [ ] Task 3: Create `__tests__/services/admin-dashboard-service.test.js` (AC1)
  - [ ] 3.1 Mock setup: shared-lib (virtual), arangojs, os, fs.promises, path-sanitizer
  - [ ] 3.2 Test init(), setLogsService(), setSecurityScanService()
  - [ ] 3.3 Test DB-dependent methods: getSystemHealth, storeAnalyticsData (insert vs update), getDatabaseStats, getUserStats, searchUsers (field-based filtering), checkDatabaseHealth, backupDatabase, optimizeDatabase
  - [ ] 3.4 Test delegated methods: getLogs, rolloverLogs, getLogsSummary, debugYesterdayLogs, searchLogs, getSecurityMetrics, runDiagnostics, runSecurityScan
  - [ ] 3.5 Test ResourceUsageMonitor: getCpuUsage, getMemoryUsage, getStorageUsage, getNetworkUsage, getResourceUsage (caching with 30s timeout)
  - [ ] 3.6 Test formatTimeAgo utility
  - [ ] 3.7 Test all error paths (DB not initialized, injected service missing, query failures)
- [ ] Task 4: Run coverage report to verify ~50% backend coverage target (AC6)
- [ ] Task 5: Run full test suite to ensure no regressions (AC5)
- [ ] Task 6: Run lint and fix any errors (AC5)

## Dev Notes

### Previous Story Learnings (2-8, 2-7)

- **shared-lib is virtual** — must mock with `{ virtual: true }`, path relative from test file
- **Services are class singletons** — use `jest.isolateModules()` to reset between tests, then set `service.initialized = false`
- **Two error response patterns**: thrown errors vs returned error objects — test both
- **createApp() not needed** — service tests mock DB directly, no Express needed
- **CommonJS only** — never use ES imports
- **Lint strictly** — 2-space indent, single quotes, semicolons
- **dotenv** must be mocked if any code path calls `require('dotenv').config()` (check each service)
- 43 new tests added in story 2-8, 507 pre-existing. All 550 tests must stay green.
- `rate-limit` is a dependency but never used in codebase (no need to test)

### Critical Architecture Constraints

[Source: _bmad-output/project-context.md]

- **CommonJS only**: `const x = require('x')` / `module.exports = {}` — NEVER ES imports
- **Direct AQL**: no ORM, no repository pattern for ArangoDB — mock `db.query()` with cursor results
- **Logger**: import `{ logger }` from `../shared-lib` — always mock
- **Security**: auth middleware is per-route — services don't handle auth directly
- **File uploads**: multer-based — not relevant for service tests

### Mock Architecture

All three test files follow the same mock pattern established in stories 2-1 through 2-8:

```javascript
require('../setup-env');

jest.mock('../../shared-lib', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  dbService: { getConnection: jest.fn() }
}), { virtual: true });

jest.mock('arangojs', () => ({
  aql: (strings, ...values) => ({ _aql: true, strings, values })
}));
```

**Singleton reset pattern:**
```javascript
let service;
beforeEach(() => {
  jest.clearAllMocks();
  jest.isolateModules(() => {
    service = require('../../services/target-service');
  });
  service.initialized = false;
});
```

**Mock cursor factory:**
```javascript
function createMockCursor(results) {
  return {
    next: jest.fn().mockResolvedValue(results[0] || null),
    all: jest.fn().mockResolvedValue(results)
  };
}
```

**Mock collection factory:**
```javascript
function createMockCollection() {
  return {
    save: jest.fn().mockResolvedValue({ _key: 'test-1' }),
    document: jest.fn().mockResolvedValue({ _key: 'test-1' }),
    update: jest.fn().mockResolvedValue({ _key: 'test-1' }),
    all: jest.fn().mockReturnValue({ all: jest.fn().mockResolvedValue([]) }),
    figures: jest.fn().mockResolvedValue({ alive: { count: 100, size: 4096 } }),
    ensureIndex: jest.fn()
  };
}
```

### Service-Specific Mock Details

#### AdminDashboardService (services/admin-dashboard-service.js)

- **Class singleton** with constructor: `this.db = null`, `this.initialized = false`, `this.resourceUsageMonitor = new ResourceUsageMonitor()`, `this.logsService = null`, `this.securityScanService = null`
- **Dependency injection**: `setLogsService()`, `setSecurityScanService()` — set mock services before testing delegated methods
- **16 AQL queries** — test each with `expect(mockDb.query).toHaveBeenCalledWith(...)` using the aql mock
- **storeAnalyticsData** has update-vs-insert branch: mock first query to return existing record (update) or empty (insert)
- **searchUsers** has field-based switch: `loginName`, `email`, `fullName`, `role`, `all` — test each branch
- **ResourceUsageMonitor** internal class uses `os` module: mock `os.cpus()`, `os.totalmem()`, `os.freemem()`, `os.networkInterfaces()`
- **Caching**: `getResourceUsage()` caches for 30s — test with mocked `Date.now()` to verify cache hit/miss
- **Database not initialized guard**: 8 methods throw `'Database not initialized. Call init() first.'` — test each

#### SecurityScanService (services/security-scan-service.js)

- **NOT a class** — object literal with functions exported directly. No singleton reset needed via isolateModules, but may still need it for module-level state.
- **child_process**: mock `exec` and `execPromise` (promisified exec) for `isGzipValid`, `getDescriptorCount`
- **axios**: mock HTTP calls to `localhost:3000` for security header checks (6 methods)
- **luxon**: mock `DateTime` for timestamp parsing in `parseLogLine`
- **worker_threads**: `processFile` uses Worker threads — mock the entire `worker_threads` module
- **File system**: `checkCachedResults`, `getLastScanDetails`, `saveScanResults` use `fs.promises`
- **Winston transports**: `closeWinstonTransports`, `reopenWinstonTransports` iterate `logger.transports` array
- **Vulnerability patterns**: 15+ regex patterns defined at module level — test via `parseLogLine` with crafted log lines
- **Config dependency**: `../config` is imported — mock `config.api.endpoints` for timestamp disclosure checks
- **parseLogLine handles 3 formats**: standard (`TIMESTAMP LEVEL [SERVICE] message`), JSON (`{...}`), datetime-only fallback
- **DAYS_TO_PROCESS** constant controls log file range — not configurable, just affects test data age

#### LogsService (services/logs-service.js)

- **Singleton class** with `getInstance()` static method — use `jest.isolateModules()` to reset
- **Lazy init**: `init()` creates logs directory on first call, skips if `initialized === true`
- **zlib**: `readLogFile` decompresses `.gz` files — mock `zlib.promises.gunzip` or `util.promisify(zlib.gunzip)`
- **File patterns**: combined/error log files matched by regex — `combined-YYYY-MM-DD.log`, `error-YYYY-MM-DD.log`
- **Large file protection**: `MAX_LOG_FILE_SIZE = 20MB`, `MAX_LINES_TO_PROCESS = 200000`
- **Date range options**: `today` (default), `yesterday`, `week`, `month`, `custom` (startDate/endDate)
- **Log grouping**: 8 predefined patterns + fallback to message prefix — test `groupLogs` with sample parsed logs
- **Log level normalization**: `WARNING` → `WARN`, detect from message content when level missing
- **path-sanitizer**: `isValidDateStr()` used for date validation — mock or provide valid strings
- **Singleton**: has `static instance` property — must reset via `jest.isolateModules()`

### Test Execution Order

Create logs-service first (it's a dependency of admin-dashboard-service), then security-scan-service, then admin-dashboard-service.

### Coverage Impact

Current: ~38% statements (with collectCoverageFrom)
After: ~50% statements

Three services totaling ~2300 lines of source code. With ~3500-4300 lines of test code covering all branches and functions.

### File Paths

| Source | Test |
|--------|------|
| `services/admin-dashboard-service.js` | `__tests__/services/admin-dashboard-service.test.js` |
| `services/security-scan-service.js` | `__tests__/services/security-scan-service.test.js` |
| `services/logs-service.js` | `__tests__/services/logs-service.test.js` |
| `__tests__/setup-env.js` | (existing — read for env vars needed) |
| `__tests__/services/query-service.test.js` | (existing — pattern reference) |

### References

- [Source: _bmad-output/implementation-artifacts/2-8-test-backend-middleware.md] — previous story learnings
- [Source: _bmad-output/implementation-artifacts/2-7-test-backend-service-layer.md] — service test pattern origin
- [Source: _bmad-output/project-context.md] — CommonJS only, direct AQL, no ORM
- [Source: _bmad-output/planning-artifacts/architecture.md] — backend service layer architecture

## Change Log

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
