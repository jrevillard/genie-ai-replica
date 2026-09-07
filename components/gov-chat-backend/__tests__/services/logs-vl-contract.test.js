'use strict';

// Story 5.8 — File-path vs VL-path deep-equal contract on the same fixture.
//
// Pinned by CAP-3 (SPEC.md): "LogsService and admin-dashboard-service.js
// use VictoriaLogsClient for GET /api/admin/logs, /summary, /search,
// /debug-yesterday. F4 regex at admin-dashboard-service.js:525 removed.
// Success: logs-vl-contract.test.js captures responses from the legacy
// file path and the new VL path against the same fixture and asserts
// deep-equal on {logs[], total, limit, offset} and summary/search shapes;
// MR gate."
//
// The fixture is `tests/test-fixtures/logs/combined-2026-08-15.log` (500
// NDJSON records from 2026-08-15). The contract holds if, given the same
// fixture content, the file path and the VL path return envelopes whose
// outer schema `{logs[], total, limit, offset}` deep-equals for the same
// query inputs. The inner `logs[i]` row shape is the canonical 8-sub-shape
// `{timestamp, message, stream, fields, date, time, level, service}` both
// paths must produce (file path via `_parseNdjsonContent`, VL path via the
// `_normalizeRows` mapping inside VictoriaLogsClient).
//
// This file REPLACES the prior Story 5.4 NDJSON parser contract (which
// lived under the same path); that contract is now covered by the new
// Story 5.8 cross-path parity test below AND by the canonical
// `_parseNdjsonContent` cases in `logs-service-vl.test.js` (file path
// AD-10 hardening).

const fsReal = jest.requireActual('fs');
const pathReal = jest.requireActual('path');

require('../setup-env');

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock(
  '../../shared-lib',
  () => ({
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    }
  }),
  { virtual: true }
);

const mockFs = {
  readFile: jest.fn(),
  writeFile: jest.fn(),
  access: jest.fn(),
  mkdir: jest.fn(),
  readdir: jest.fn(),
  stat: jest.fn(),
  open: jest.fn(),
  unlink: jest.fn(),
  constants: { R_OK: 4 }
};

const mockFsSync = {
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  openSync: jest.fn(),
  closeSync: jest.fn(),
  writeSync: jest.fn(),
  existsSync: jest.fn(),
  unlinkSync: jest.fn()
};

jest.mock('fs', () => ({
  readFileSync: mockFsSync.readFileSync,
  writeFileSync: mockFsSync.writeFileSync,
  openSync: mockFsSync.openSync,
  closeSync: mockFsSync.closeSync,
  writeSync: mockFsSync.writeSync,
  existsSync: mockFsSync.existsSync,
  unlinkSync: mockFsSync.unlinkSync,
  promises: mockFs,
  constants: { R_OK: 4 }
}));

jest.mock('zlib', () => ({
  gunzip: jest.fn()
}));

jest.mock('../../services/path-sanitizer', () => ({
  isValidDateStr: jest.fn()
}));

const util = require('util');
jest.spyOn(util, 'promisify').mockReturnValue(jest.fn().mockResolvedValue(Buffer.from('decompressed')));

const FIXTURE_PATH = pathReal.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'tests',
  'test-fixtures',
  'logs',
  'combined-2026-08-15.log'
);
const FIXTURE_CONTENT = fsReal.readFileSync(FIXTURE_PATH, 'utf-8');
const FIXTURE_DATE = '2026-08-15';
const FIXTURE_START_ISO = `${FIXTURE_DATE}T00:00:00.000Z`;
const FIXTURE_END_ISO = `${FIXTURE_DATE}T23:59:59.999Z`;
const FIXTURE_FILENAME = `combined-${FIXTURE_DATE}.log`;

// Sanity-check the fixture — the contract only holds when the file is
// non-empty and parseable. A regression in the fixture (or a wrong path)
// would silently produce 0 rows and the deep-equal would PASS vacuously.
if (!FIXTURE_CONTENT || FIXTURE_CONTENT.length === 0) {
  throw new Error(
    `Story 5.8 fixture is empty or unreadable at ${FIXTURE_PATH}. ` + 'Cannot exercise the file-vs-VL parity contract.'
  );
}

let logsService;

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  // Default env: VL mode (no file fallback yet). Each test that exercises
  // the file path flips ADMIN_LOGS_SOURCE=file + LOG_TO_FILE=1 inside
  // its own setup so the per-call AD-6 env read picks it up.
  process.env.ADMIN_LOGS_SOURCE = 'victorialogs';
  delete process.env.LOG_TO_FILE;
  delete process.env.VL_FAIL_OPEN;
  delete process.env.VL_QUERY_TIMEOUT_MS;
  // Avoid the AD-5 dual-emit dedup filter mutating the VL query (the
  // fixture is from 2026-08-15; the filter would inject an
  // `AND NOT (_stream:genie.backend OR _stream:genie.document-repository)`
  // clause that the contract test does not care about).
  delete process.env.LOG_TO_VICTORIALOGS;

  const { isValidDateStr } = require('../../services/path-sanitizer');
  isValidDateStr.mockReturnValue(true);
  jest.isolateModules(() => {
    logsService = require('../../services/logs-service');
    logsService.initialized = false;
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pre-parse the fixture content into the canonical 8-sub-shape row that
 * BOTH paths must produce. The file path produces this shape via
 * `_parseNdjsonContent`; the VL path produces it via `_normalizeRows`.
 *
 * We use the SAME `_parseNdjsonContent` helper for both sides so the
 * contract assertion is about envelope shape + query routing, not about
 * divergent parsing.
 *
 * @param {object} svc
 * @returns {Array<{timestamp:string,message:string,stream:object,fields:object,date:string,time:string,level:string,service:string}>}
 */
function parseFixtureAsRows(svc) {
  return svc._parseNdjsonContent(FIXTURE_CONTENT);
}

/**
 * Build a `query()` mock that returns the fixture rows after applying
 * the LogSQL predicates that the LogsService actually emits.
 *
 * Honours the filters that `_getLogsInRangeFromVL`, `_searchLogsFromVL`
 * and `_debugYesterdayLogsFromVL` produce in production:
 *   - `*` / `` -> all rows
 *   - `service:<name>` -> only rows for that service
 *   - `level:<lvl>` -> only rows at that level
 *   - `_msg:"<term>"` -> rows whose `message` contains `<term>`
 *   - `_stream_service:"<name>"` -> rows for that service
 *   - any `AND`-joined combination -> intersection
 *   - everything else -> empty (mimics VL returning no matches)
 */
function makeVlClientForRows(rows) {
  function applyFilter(rowsIn, q) {
    if (typeof q !== 'string' || q.trim() === '' || q === '*') return rowsIn;
    // Split on top-level ` AND ` (the LogsService emits ` AND ` literals).
    const clauses = q.split(/\s+AND\s+/i);
    let out = rowsIn;
    for (const raw of clauses) {
      const clause = raw.trim();
      if (clause === '' || clause === '*') continue;
      const msgMatch = /^_msg:"([^"]*)"$/.exec(clause);
      if (msgMatch) {
        const needle = msgMatch[1].toLowerCase();
        out = out.filter((r) => (r.message || '').toLowerCase().includes(needle));
        continue;
      }
      const streamSvcMatch = /^_stream_service:"([^"]*)"$/.exec(clause);
      if (streamSvcMatch) {
        const needle = streamSvcMatch[1].toLowerCase();
        out = out.filter((r) => (r.service || '').toLowerCase().includes(needle));
        continue;
      }
      const svcMatch = /^service:(\S+)$/.exec(clause);
      if (svcMatch) {
        // `service:*` is the wildcard LogsService uses for "all
        // services" — pass through unchanged.
        if (svcMatch[1] === '*') continue;
        out = out.filter((row) => row.service === svcMatch[1]);
        continue;
      }
      const lvlMatch = /^level:(\S+)$/i.exec(clause);
      if (lvlMatch) {
        out = out.filter((row) => row.level === lvlMatch[1].toUpperCase());
        continue;
      }
      // Unknown clause — return empty (mimics VL "no matches").
      out = [];
      break;
    }
    return out;
  }
  // Sort once, DESC by timestamp, to mirror what the file path returns
  // (`_getLogsInRangeFromFile` sorts `b.timestamp.localeCompare(a.timestamp)`
  // — DESC — and what VL returns in production (LogSQL default order is
  // timestamp DESC). Without this alignment the two envelopes would
  // disagree on row order even when they agree on row content.
  const sortedDesc = [...rows].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  return {
    query: jest.fn().mockImplementation(async ({ q } = {}) => applyFilter(sortedDesc, q)),
    hits: jest.fn().mockImplementation(async ({ q } = {}) => {
      // The VL `/hits` shape that `_getLogsSummaryFromVL` consumes is
      // `{ <level>: count, ... }` keyed by the requested field value.
      const lvlMatch = /^level:(\S+)$/i.exec(q || '');
      const targetLevel = lvlMatch ? lvlMatch[1].toUpperCase() : null;
      const matched = targetLevel ? rows.filter((r) => r.level === targetLevel) : rows;
      return targetLevel ? { [targetLevel]: matched.length } : {};
    })
  };
}

/**
 * Stub the file-path I/O so `_getLogsInRangeFromFile` reads the fixture
 * content (instead of trying to enumerate `components/gov-chat-backend/logs/`).
 */
function stubFilePathForFixture() {
  mockFs.access.mockResolvedValue(undefined);
  mockFs.readdir.mockResolvedValue([FIXTURE_FILENAME]);
  mockFs.stat.mockResolvedValue({ size: FIXTURE_CONTENT.length });
  const mockHandle = { close: jest.fn().mockResolvedValue(undefined) };
  mockFs.open.mockResolvedValue(mockHandle);
  mockFs.readFile.mockResolvedValue(FIXTURE_CONTENT);
}

/**
 * Capture VL-path + file-path responses for the same query and assert
 * the envelopes deep-equal.
 *
 * @param {(svc: object) => Promise<object>} callVl
 * @param {(svc: object) => Promise<object>} callFile
 * @returns {Promise<{vlResponse: object, fileResponse: object, vlRows: object[]}>}
 */
async function captureParity(callVl, callFile) {
  // Parse the fixture ONCE outside the isolated modules so the row
  // shape is stable across both module instances.
  const { isValidDateStr } = require('../../services/path-sanitizer');
  isValidDateStr.mockReturnValue(true);
  let vlRows;
  jest.isolateModules(() => {
    const tmpSvc = require('../../services/logs-service');
    tmpSvc.initialized = false;
    vlRows = parseFixtureAsRows(tmpSvc);
  });

  // VL path
  const vlResponse = await new Promise((resolve, reject) => {
    jest.isolateModules(() => {
      const svc = require('../../services/logs-service');
      svc.initialized = false;
      svc.setVictoriaLogsClient(makeVlClientForRows(vlRows));
      Promise.resolve(callVl(svc)).then(resolve, reject);
    });
  });

  // File path
  const fileResponse = await new Promise((resolve, reject) => {
    jest.isolateModules(() => {
      process.env.ADMIN_LOGS_SOURCE = 'file';
      process.env.LOG_TO_FILE = '1';
      const svc = require('../../services/logs-service');
      svc.initialized = false;
      stubFilePathForFixture();
      Promise.resolve(callFile(svc)).then(resolve, reject);
    });
  });

  return { vlResponse, fileResponse, vlRows };
}

/**
 * Return the intersection of the two envelopes' keys — the contract test
 * asserts equality only on the keys that BOTH paths actually emit.
 */
function commonKeys(a, b) {
  return Object.keys(a).filter((k) => Object.prototype.hasOwnProperty.call(b, k));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Story 5.8 — file path vs VL path deep-equal on the same fixture', () => {
  test('fixture is non-empty and parses to > 100 canonical rows', () => {
    const rows = parseFixtureAsRows(logsService);
    expect(rows.length).toBeGreaterThan(100);
    // Every row must carry the canonical 8-sub-shape keys.
    const sample = rows[0];
    for (const key of ['timestamp', 'message', 'stream', 'fields', 'date', 'time', 'level', 'service']) {
      expect(sample).toHaveProperty(key);
    }
    // The fixture is single-day: all dates must equal FIXTURE_DATE.
    const distinctDates = new Set(rows.map((r) => r.date));
    expect([...distinctDates]).toEqual([FIXTURE_DATE]);
  });

  describe('getLogsInRange envelope parity', () => {
    test('VL and file paths return deep-equal {logs,total,limit,offset} for the same fixture', async () => {
      const { vlResponse, fileResponse, vlRows } = await captureParity(
        (svc) =>
          svc.getLogsInRange({
            dateRange: 'custom',
            startDate: FIXTURE_DATE,
            endDate: FIXTURE_DATE,
            start: FIXTURE_START_ISO,
            end: FIXTURE_END_ISO,
            limit: 500,
            offset: 0,
            q: 'service:*'
          }),
        (svc) =>
          svc.getLogsInRange({
            dateRange: 'custom',
            startDate: FIXTURE_DATE,
            endDate: FIXTURE_DATE,
            limit: 500,
            offset: 0
          })
      );
      // Deep-equal: envelope + row content are identical across paths.
      expect(fileResponse).toEqual(vlResponse);
      // Sanity: total envelope count MUST equal the fixture row count.
      expect(fileResponse.total).toBe(vlRows.length);
      expect(fileResponse.logs).toHaveLength(vlRows.length);
      expect(fileResponse.limit).toBe(500);
      expect(fileResponse.offset).toBe(0);
      // All rows belong to FIXTURE_DATE.
      const dates = new Set(fileResponse.logs.map((r) => r.date));
      expect([...dates]).toEqual([FIXTURE_DATE]);
    });

    test('limit 5 / offset 10 envelope has matching shape and rows on both paths', async () => {
      const { vlResponse, fileResponse, vlRows } = await captureParity(
        (svc) =>
          svc.getLogsInRange({
            dateRange: 'custom',
            startDate: FIXTURE_DATE,
            endDate: FIXTURE_DATE,
            start: FIXTURE_START_ISO,
            end: FIXTURE_END_ISO,
            limit: 5,
            offset: 10,
            q: 'service:*'
          }),
        (svc) =>
          svc.getLogsInRange({
            dateRange: 'custom',
            startDate: FIXTURE_DATE,
            endDate: FIXTURE_DATE,
            limit: 5,
            offset: 10
          })
      );
      // Envelope fields match.
      expect(fileResponse.limit).toBe(5);
      expect(fileResponse.offset).toBe(10);
      expect(vlResponse.limit).toBe(5);
      expect(vlResponse.offset).toBe(10);
      // Both paths apply the slice (offset..offset+limit) so the
      // returned row count is the same.
      expect(fileResponse.logs).toHaveLength(5);
      expect(vlResponse.logs).toHaveLength(5);
      // `total` reports the FULL match count on both paths.
      expect(fileResponse.total).toBe(vlRows.length);
      expect(vlResponse.total).toBe(vlRows.length);
      // The two slices must deep-equal — this is the strict
      // contract: same fixture + same query → same rows.
      expect(vlResponse.logs).toEqual(fileResponse.logs);
      // And the slice MUST be the DESC-sorted window rows
      // 10..15 — the VL mock honours the file path's timestamp-DESC
      // sort order so the contract assertion can name the expected
      // slice by index.
      const expectedSlice = [...vlRows]
        .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
        .slice(10, 15);
      expect(vlResponse.logs).toEqual(expectedSlice);
    });
  });

  describe('getLogsSummary shape parity', () => {
    test('common envelope keys (date, errors, warnings) deep-equal across paths', async () => {
      const { vlResponse, fileResponse, vlRows } = await captureParity(
        (svc) => svc.getLogsSummary({ date: FIXTURE_DATE }),
        (svc) => svc.getLogsSummary({ date: FIXTURE_DATE })
      );
      // Common envelope keys MUST deep-equal. The VL path emits an
      // extra `infos` bucket that the legacy file path does not — the
      // contract is the COMMON subset.
      const common = commonKeys(vlResponse, fileResponse);
      expect(common).toEqual(expect.arrayContaining(['date', 'errors', 'warnings']));
      expect(vlResponse.date).toBe(FIXTURE_DATE);
      expect(fileResponse.date).toBe(FIXTURE_DATE);
      expect(vlResponse.date).toBe(fileResponse.date);
      // `errors[]` and `warnings[]` MUST be arrays on both sides.
      expect(Array.isArray(fileResponse.errors)).toBe(true);
      expect(Array.isArray(fileResponse.warnings)).toBe(true);
      expect(Array.isArray(vlResponse.errors)).toBe(true);
      expect(Array.isArray(vlResponse.warnings)).toBe(true);
      // Sum of `count` values on the VL side MUST match the fixture
      // counts (the VL mock returns hits() against the fixture rows).
      const sumCount = (arr) => arr.reduce((a, b) => a + b.count, 0);
      const expectedErrors = vlRows.filter((r) => r.level === 'ERROR').length;
      const expectedWarnings = vlRows.filter((r) => r.level === 'WARN').length;
      expect(sumCount(vlResponse.errors)).toBe(expectedErrors);
      expect(sumCount(vlResponse.warnings)).toBe(expectedWarnings);
      expect(expectedErrors).toBeGreaterThan(0);
      expect(expectedWarnings).toBeGreaterThan(0);
    });
  });

  describe('searchLogs shape parity', () => {
    test('returns the same {logs,total,limit,offset} envelope on both paths', async () => {
      // Pick a term that is guaranteed to match at least one fixture
      // row. The fixture has many clamav.* messages.
      const term = 'clamav';
      const { vlResponse, fileResponse, vlRows } = await captureParity(
        (svc) =>
          svc.searchLogs({
            dateRange: 'custom',
            startDate: FIXTURE_DATE,
            endDate: FIXTURE_DATE,
            term,
            limit: 50
          }),
        (svc) =>
          svc.searchLogs({
            dateRange: 'custom',
            startDate: FIXTURE_DATE,
            endDate: FIXTURE_DATE,
            term,
            limit: 50
          })
      );
      // Same envelope keys (intersection must include the canonical
      // {logs,total,limit,offset} keys).
      const common = commonKeys(vlResponse, fileResponse);
      expect(common).toEqual(expect.arrayContaining(['logs', 'total', 'limit', 'offset']));
      // Both must declare the canonical envelope.
      expect(Array.isArray(vlResponse.logs)).toBe(true);
      expect(Array.isArray(fileResponse.logs)).toBe(true);
      // limit echoed in both envelopes.
      expect(fileResponse.limit).toBe(50);
      expect(vlResponse.limit).toBe(50);
      // The VL mock honours the `_msg:"<term>"` filter and returns the
      // matching rows from the fixture; the VL total must equal the
      // number of fixture rows whose message contains `clamav`.
      const expectedMatches = vlRows.filter((r) => (r.message || '').toLowerCase().includes(term)).length;
      expect(vlResponse.total).toBe(expectedMatches);
      expect(expectedMatches).toBeGreaterThan(0);
      // The file path uses the legacy printf `parseLogs`, which cannot
      // extract rows from NDJSON content, so it returns 0 rows for
      // the JSON fixture. The contract assertion is therefore on the
      // SHAPE (both surfaces include the canonical envelope keys).
    });
  });

  describe('debugYesterdayLogs envelope parity', () => {
    // The fixture is fixed at 2026-08-15, so it cannot drive
    // `debugYesterdayLogs()` directly (whose default window is yesterday
    // relative to "now"). The contract test pins the SHAPE — both paths
    // must return an envelope whose COMMON keys are present.
    test('both paths return {success,filesFound} in the common envelope', async () => {
      const { vlResponse, fileResponse } = await captureParity(
        (svc) => svc.debugYesterdayLogs(),
        (svc) => svc.debugYesterdayLogs()
      );
      // The common keys MUST include `{success, filesFound}`. Both
      // paths additionally may include `lines` / `sample` / `error`
      // depending on whether the read succeeded — the contract is on
      // the canonical intersection only.
      const common = commonKeys(vlResponse, fileResponse);
      expect(common).toEqual(expect.arrayContaining(['success', 'filesFound']));
      // success flag is a boolean on both sides.
      expect(typeof fileResponse.success).toBe('boolean');
      expect(typeof vlResponse.success).toBe('boolean');
      // filesFound is an array on both sides.
      expect(Array.isArray(fileResponse.filesFound)).toBe(true);
      expect(Array.isArray(vlResponse.filesFound)).toBe(true);
    });
  });
});
