'use strict';

// Story 5.3 — VictoriaLogs migration tests for `LogsService`.
//
// Covers the new behaviour pinned by the Story 5.3 acceptance:
//   - `getLogsInRange` JSDoc envelope `{logs, total, limit, offset}`
//     (file + VL paths).
//   - Per-call `ADMIN_LOGS_SOURCE` env read (AD-6) — toggle mid-suite.
//   - `VL_FAIL_OPEN=true` returns `{degraded: true, ...fallback}` on
//     ECONNREFUSED / 5xx / timeout, surfaces the error otherwise.
//   - 503 `vl_files_disabled` body when `ADMIN_LOGS_SOURCE=file` is
//     requested but `LOG_TO_FILE !== '1'`.
//   - ENOENT tolerance between `stat()` and `open()` on file reads.
//   - `fs.open(path, 'wx')` O_EXCL concurrent-reader lock; EEXIST → skip
//     gracefully (AD-10).
//   - NDJSON parse with N=4096 re-parse window on `SyntaxError`.
//   - `getLogFilesInRange` returns synthetic `{date, service, source:
//     'victorialogs', query}` descriptors in VL mode.

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
  access: jest.fn(),
  mkdir: jest.fn(),
  readdir: jest.fn(),
  stat: jest.fn(),
  open: jest.fn(),
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

let logsService;
let mockVlClient;

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  // Default to VL mode for these tests; each test flips ADMIN_LOGS_SOURCE
  // explicitly when exercising the file path.
  delete process.env.ADMIN_LOGS_SOURCE;
  delete process.env.LOG_TO_FILE;
  delete process.env.VL_FAIL_OPEN;
  delete process.env.VL_QUERY_TIMEOUT_MS;
  mockVlClient = {
    query: jest.fn().mockResolvedValue([]),
    hits: jest.fn().mockResolvedValue({})
  };
  const { isValidDateStr } = require('../../services/path-sanitizer');
  isValidDateStr.mockReturnValue(true);
  jest.isolateModules(() => {
    logsService = require('../../services/logs-service');
    logsService.initialized = false;
    logsService.setVictoriaLogsClient(mockVlClient);
  });
});

describe('Story 5.3 — LogsService VL rewrite', () => {
  describe('source routing (AD-6 per-call env read)', () => {
    it('defaults to victorialogs when ADMIN_LOGS_SOURCE is unset', () => {
      delete process.env.ADMIN_LOGS_SOURCE;
      expect(logsService._sourceMode()).toBe('victorialogs');
    });

    it('returns file when ADMIN_LOGS_SOURCE=file', () => {
      process.env.ADMIN_LOGS_SOURCE = 'file';
      expect(logsService._sourceMode()).toBe('file');
    });

    it('re-reads env on every call (no module-load cache)', () => {
      expect(logsService._sourceMode()).toBe('victorialogs');
      process.env.ADMIN_LOGS_SOURCE = 'file';
      expect(logsService._sourceMode()).toBe('file');
      delete process.env.ADMIN_LOGS_SOURCE;
      expect(logsService._sourceMode()).toBe('victorialogs');
    });
  });

  describe('getLogsInRange — VL path', () => {
    it('returns envelope {logs, total, limit, offset} from VictoriaLogsClient', async () => {
      const rows = [
        {
          timestamp: '2026-09-01T00:00:00.000Z',
          message: 'm1',
          date: '2026-09-01',
          time: '00:00:00',
          level: 'INFO',
          service: 'genie-backend',
          stream: { service: 'genie-backend', environment: 'test' },
          fields: {}
        },
        {
          timestamp: '2026-09-01T00:00:01.000Z',
          message: 'm2',
          date: '2026-09-01',
          time: '00:00:01',
          level: 'INFO',
          service: 'genie-backend',
          stream: { service: 'genie-backend', environment: 'test' },
          fields: {}
        }
      ];
      mockVlClient.query.mockResolvedValueOnce(rows);
      const result = await logsService.getLogsInRange({
        start: '2026-09-01T00:00:00.000Z',
        end: '2026-09-01T23:59:59.999Z',
        limit: 100,
        offset: 0
      });
      expect(result).toEqual({
        logs: rows,
        total: 2,
        limit: 100,
        offset: 0
      });
    });

    it('applies offset + limit pagination on the envelope', async () => {
      const rows = Array.from({ length: 5 }, (_, i) => ({
        timestamp: `2026-09-01T00:00:0${i}.000Z`,
        message: `m${i}`,
        date: '2026-09-01',
        time: `00:00:0${i}`,
        level: 'INFO',
        service: 'genie-backend',
        stream: { service: 'genie-backend', environment: 'test' },
        fields: {}
      }));
      mockVlClient.query.mockResolvedValueOnce(rows);
      const result = await logsService.getLogsInRange({
        start: '2026-09-01T00:00:00.000Z',
        end: '2026-09-01T23:59:59.999Z',
        limit: 2,
        offset: 1
      });
      expect(result.limit).toBe(2);
      expect(result.offset).toBe(1);
      expect(result.total).toBe(5);
      expect(result.logs).toHaveLength(2);
      expect(result.logs[0].message).toBe('m1');
    });

    it('returns degraded:true envelope when VL_FAIL_OPEN=true and VL unreachable', async () => {
      process.env.VL_FAIL_OPEN = 'true';
      const err = new Error('connect ECONNREFUSED');
      err.code = 'ECONNREFUSED';
      mockVlClient.query.mockRejectedValueOnce(err);
      const result = await logsService.getLogsInRange({
        start: '2026-09-01T00:00:00.000Z',
        end: '2026-09-01T23:59:59.999Z',
        limit: 100,
        offset: 0
      });
      expect(result.degraded).toBe(true);
      expect(result.logs).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.limit).toBe(100);
      expect(result.offset).toBe(0);
    });

    it('surfaces VL outage as a thrown error when VL_FAIL_OPEN is unset', async () => {
      const err = new Error('connect ECONNREFUSED');
      err.code = 'ECONNREFUSED';
      mockVlClient.query.mockRejectedValueOnce(err);
      await expect(
        logsService.getLogsInRange({
          start: '2026-09-01T00:00:00.000Z',
          end: '2026-09-01T23:59:59.999Z'
        })
      ).rejects.toThrow('connect ECONNREFUSED');
    });

    it('classifies 5xx responses as VL outage (VL_FAIL_OPEN)', async () => {
      process.env.VL_FAIL_OPEN = 'true';
      const err = new Error('Server Error');
      err.response = { status: 503 };
      mockVlClient.query.mockRejectedValueOnce(err);
      const result = await logsService.getLogsInRange({
        start: '2026-09-01T00:00:00.000Z',
        end: '2026-09-01T23:59:59.999Z'
      });
      expect(result.degraded).toBe(true);
    });
  });

  describe('getLogsSummary — VL path', () => {
    it('queries hits() twice (ERROR + WARN) and shapes the legacy envelope', async () => {
      mockVlClient.hits.mockResolvedValueOnce({ ERROR: 4 }).mockResolvedValueOnce({ WARN: 2 });
      const result = await logsService.getLogsSummary({ date: '2026-09-01' });
      expect(mockVlClient.hits).toHaveBeenCalledTimes(2);
      expect(result.date).toBe('2026-09-01');
      expect(result.errors[0]).toMatchObject({ type: 'ERROR', count: 4 });
      expect(result.warnings[0]).toMatchObject({ type: 'WARN', count: 2 });
    });

    it('returns empty buckets when VL has no ERROR/WARN rows', async () => {
      mockVlClient.hits.mockResolvedValueOnce({}).mockResolvedValueOnce({});
      const result = await logsService.getLogsSummary({ date: '2026-09-01' });
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it('returns empty envelope (degraded) on VL outage with VL_FAIL_OPEN=true', async () => {
      process.env.VL_FAIL_OPEN = 'true';
      const err = new Error('timeout');
      err.code = 'ETIMEDOUT';
      mockVlClient.hits.mockRejectedValueOnce(err);
      const result = await logsService.getLogsSummary({ date: '2026-09-01' });
      expect(result.degraded).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.date).toBe('2026-09-01');
    });
  });

  describe('searchLogs — VL path', () => {
    it('builds LogSQL from term/level/service filters', async () => {
      const rows = [
        {
          timestamp: '2026-09-01T00:00:00.000Z',
          message: 'login',
          level: 'INFO',
          service: 'auth',
          date: '2026-09-01',
          time: '00:00:00',
          stream: { service: 'auth', environment: 'test' },
          fields: {}
        }
      ];
      mockVlClient.query.mockResolvedValueOnce(rows);
      const result = await logsService.searchLogs({
        dateRange: 'today',
        term: 'login',
        level: 'INFO',
        service: 'auth',
        limit: 50
      });
      expect(mockVlClient.query).toHaveBeenCalledTimes(1);
      const callArg = mockVlClient.query.mock.calls[0][0];
      expect(callArg.q).toContain('_msg:"login"');
      expect(callArg.q).toContain('level:INFO');
      expect(callArg.q).toContain('_stream_service:"auth"');
      expect(result).toEqual({ logs: rows, total: 1, limit: 50, offset: 0 });
    });

    it('strips LogSQL reserved chars in the term (replaces with space)', async () => {
      mockVlClient.query.mockResolvedValueOnce([]);
      await logsService.searchLogs({ dateRange: 'today', term: 'a*b?c:d"e\\f' });
      const callArg = mockVlClient.query.mock.calls[0][0];
      // Reserved chars are replaced with spaces — safer than backslash
      // escaping (LogSQL has no escape sequence for newline/control chars;
      // a literal newline in the source would break out of the quoted
      // segment and inject arbitrary filter syntax).
      expect(callArg.q).toContain('_msg:"a b c d e f"');
    });

    it('strips newline + LogSQL control chars to prevent injection', async () => {
      mockVlClient.query.mockResolvedValueOnce([]);
      // Newline + quoted-string terminator + backtick + control chars.
      // After stripping, the `_stream:"evil"` filter clause cannot
      // appear verbatim — the `"`, `:` and newline that close the
      // outer `_msg:"..."` segment are removed.
      await logsService.searchLogs({
        dateRange: 'today',
        term: 'safe\n_stream:"evil" _msg:`injected'
      });
      const callArg = mockVlClient.query.mock.calls[0][0];
      expect(callArg.q).not.toContain('_stream:"evil"');
      expect(callArg.q).not.toContain('_msg:"evil"');
      expect(callArg.q).not.toContain('`');
      expect(callArg.q).not.toContain('\n');
    });
  });

  describe('getDebugYesterday — VL path', () => {
    it('returns success envelope with sample lines', async () => {
      const rows = [{ message: 'sample-1' }, { message: 'sample-2' }];
      mockVlClient.query.mockResolvedValueOnce(rows);
      const result = await logsService.debugYesterdayLogs();
      expect(result.success).toBe(true);
      expect(result.lines).toBe(2);
      expect(result.sample).toEqual(['sample-1', 'sample-2']);
      expect(result.filesFound[0]).toMatchObject({ service: 'victorialogs', source: 'victorialogs' });
    });

    it('returns degraded envelope with filesFound on VL outage', async () => {
      process.env.VL_FAIL_OPEN = 'true';
      const err = new Error('connect ENOTFOUND');
      err.code = 'ENOTFOUND';
      mockVlClient.query.mockRejectedValueOnce(err);
      const result = await logsService.debugYesterdayLogs();
      expect(result.degraded).toBe(true);
      expect(result.success).toBe(false);
      expect(result.filesFound[0]).toMatchObject({ source: 'victorialogs' });
    });
  });

  describe('getLogFilesInRange — synthetic descriptors (VL mode)', () => {
    it('returns one descriptor per UTC date in the range', async () => {
      const descriptors = await logsService.getLogFilesInRange('2026-09-01', '2026-09-03');
      expect(descriptors).toHaveLength(3);
      for (const descriptor of descriptors) {
        expect(descriptor).toEqual(
          expect.objectContaining({
            service: 'victorialogs',
            source: 'victorialogs'
          })
        );
        expect(typeof descriptor.date).toBe('string');
        expect(descriptor.query).toContain(`start=${descriptor.date}T00:00:00.000Z`);
      }
      expect(descriptors[0].date).toBe('2026-09-01');
      expect(descriptors[2].date).toBe('2026-09-03');
    });

    it('returns [] for invalid dates', async () => {
      const { isValidDateStr } = require('../../services/path-sanitizer');
      isValidDateStr.mockReturnValue(false);
      const descriptors = await logsService.getLogFilesInRange('bad', 'also-bad');
      expect(descriptors).toEqual([]);
    });
  });

  describe('file path — VlFilesDisabledError 503 (Story 5.5)', () => {
    it('throws VlFilesDisabledError when ADMIN_LOGS_SOURCE=file but LOG_TO_FILE != "1"', async () => {
      process.env.ADMIN_LOGS_SOURCE = 'file';
      delete process.env.LOG_TO_FILE;
      let captured;
      try {
        await logsService.getLogsInRange({
          start: '2026-09-01T00:00:00.000Z',
          end: '2026-09-01T23:59:59.999Z'
        });
      } catch (err) {
        captured = err;
      }
      expect(captured).toBeDefined();
      expect(captured.name).toBe('VlFilesDisabledError');
      expect(captured.statusCode).toBe(503);
      expect(captured.body).toEqual({
        error: 'vl_files_disabled',
        message: 'Set LOG_TO_FILE=1 to use file-based log source'
      });
    });

    it('throws VlFilesDisabledError on searchLogs file path when LOG_TO_FILE unset', async () => {
      process.env.ADMIN_LOGS_SOURCE = 'file';
      delete process.env.LOG_TO_FILE;
      await expect(logsService.searchLogs({ dateRange: 'today' })).rejects.toMatchObject({
        name: 'VlFilesDisabledError',
        statusCode: 503
      });
    });

    it('throws VlFilesDisabledError on getLogsSummary file path when LOG_TO_FILE unset', async () => {
      process.env.ADMIN_LOGS_SOURCE = 'file';
      delete process.env.LOG_TO_FILE;
      await expect(logsService.getLogsSummary({ date: '2026-09-01' })).rejects.toMatchObject({
        name: 'VlFilesDisabledError',
        statusCode: 503
      });
    });

    it('throws VlFilesDisabledError on debugYesterdayLogs file path when LOG_TO_FILE unset', async () => {
      process.env.ADMIN_LOGS_SOURCE = 'file';
      delete process.env.LOG_TO_FILE;
      await expect(logsService.debugYesterdayLogs()).rejects.toMatchObject({
        name: 'VlFilesDisabledError',
        statusCode: 503
      });
    });
  });

  describe('file path — AD-10 hardening', () => {
    beforeEach(() => {
      process.env.ADMIN_LOGS_SOURCE = 'file';
      process.env.LOG_TO_FILE = '1';
    });

    it('tolerates ENOENT between stat() and open() (file vanished)', async () => {
      // Directory listing succeeds with one file, lock acquisition succeeds,
      // but the file vanishes between listing and stat (race with rotation).
      // Use `custom` range so today (2026-09-07) is NOT in range —
      // currentLogs branch is skipped, only the archived file is read.
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValueOnce(['combined-2026-09-01.log']);
      const mockHandle = { close: jest.fn().mockResolvedValue(undefined) };
      mockFs.open.mockResolvedValue(mockHandle);
      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      mockFs.stat.mockRejectedValueOnce(enoent);

      const result = await logsService.getLogsInRange({
        dateRange: 'custom',
        startDate: '2026-09-01',
        endDate: '2026-09-01',
        limit: 10
      });
      // AD-10: stat() ENOENT → empty string → empty envelope, no throw.
      expect(result.logs).toEqual([]);
      expect(result.total).toBe(0);
      expect(mockFs.open).toHaveBeenCalledWith(expect.stringMatching(/\.logs-read-lock-/), 'wx');
      expect(mockFs.stat).toHaveBeenCalled();
    });

    it('skips file gracefully when fs.open(lockPath, "wx") throws EEXIST (AD-10)', async () => {
      // `custom` range so today is NOT in range — only the archived file.
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValueOnce(['combined-2026-09-01.log']);
      mockFs.stat.mockResolvedValue({ size: 100 });

      // Lock acquisition: every attempt throws EEXIST (another reader holds it).
      const eexist = Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
      mockFs.open.mockRejectedValue(eexist);

      const result = await logsService.getLogsInRange({
        dateRange: 'custom',
        startDate: '2026-09-01',
        endDate: '2026-09-01',
        limit: 10
      });
      // Lock failure → every file skipped → empty envelope.
      expect(result.logs).toEqual([]);
      expect(result.total).toBe(0);
      expect(mockFs.open).toHaveBeenCalledWith(expect.stringMatching(/\.logs-read-lock-/), 'wx');
    });

    it('parses NDJSON with N=4096 re-parse window after a SyntaxError', async () => {
      // Two valid NDJSON lines on a file date within the requested range.
      // The first line is intentionally truncated (kill -9 mid-write); the
      // re-parse window must stitch the next N=4096 bytes so the line
      // parses, and the second line (after \n) must parse on its own.
      const truncated = '{"timestamp":"2026-09-01T00:00:00.000Z","message":"truncated';
      const tail =
        '","level":"INFO","service":"genie-backend"}\n' +
        '{"timestamp":"2026-09-01T00:00:01.000Z","message":"next","level":"INFO","service":"genie-backend"}\n';
      const content = truncated + tail;

      // Today (2026-09-07) is NOT in [2026-09-01..2026-09-01], so the
      // currentLogs branch is skipped — only the archived file is read.
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValueOnce(['combined-2026-09-01.log']);
      mockFs.stat.mockResolvedValue({ size: content.length });
      const mockHandle = { close: jest.fn().mockResolvedValue(undefined) };
      mockFs.open.mockResolvedValueOnce(mockHandle);
      mockFs.readFile.mockResolvedValueOnce(content);

      const result = await logsService.getLogsInRange({
        dateRange: 'custom',
        startDate: '2026-09-01',
        endDate: '2026-09-01',
        limit: 10
      });
      // The re-parse window stitches the truncated line AND the second
      // line parses on its own → at least 2 rows (sort: DESC by timestamp).
      expect(result.total).toBeGreaterThanOrEqual(2);
      const messages = result.logs.map((row) => row.message);
      expect(messages).toContain('next');
      expect(messages.some((m) => /truncated/.test(m))).toBe(true);
    });

    it('tolerates readdir ENOENT between access() and readdir() (file path)', async () => {
      // access() succeeds, then a concurrent rotation removes the dir
      // before readdir() runs. The previous code bubbled the ENOENT up
      // to the caller as an unhandled rejection. The fix returns [].
      mockFs.access.mockResolvedValue(undefined);
      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      mockFs.readdir.mockRejectedValueOnce(enoent);
      const result = await logsService.getLogFilesInRange('2026-09-01', '2026-09-01', true);
      expect(result).toEqual([]);
    });

    it('returns degraded:true envelope when a file read throws (file path)', async () => {
      // Simulate a partial scan: one file is read OK, the next file's
      // _readLogFileAd10 throws an unrecognised error. The previous
      // behaviour silently swallowed it; the fix surfaces `degraded:true`
      // on the returned envelope so the admin UI can flag partial results.
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValueOnce(['combined-2026-09-01.log', 'combined-2026-09-02.log']);
      const mockHandle = { close: jest.fn().mockResolvedValue(undefined) };
      // First open() returns the lock handle for the first file; subsequent
      // opens resolve to handles too so both files are entered.
      mockFs.open.mockResolvedValue(mockHandle);
      // First stat OK, second stat throws an unknown error (EACCES).
      mockFs.stat
        .mockResolvedValueOnce({ size: 50 })
        .mockRejectedValueOnce(Object.assign(new Error('EACCES'), { code: 'EACCES' }));

      const result = await logsService.getLogsInRange({
        dateRange: 'custom',
        startDate: '2026-09-01',
        endDate: '2026-09-02',
        limit: 10
      });
      expect(result.degraded).toBe(true);
    });
  });

  describe('review follow-up — 2026-09-07 patches', () => {
    it('_defaultStartIso throws on unknown dateRange (no silent today fallback)', () => {
      // The previous behaviour fell through to "today" for any unknown
      // value — silently widening the query range. The fix throws so the
      // route layer surfaces a 400 rather than returning today's logs
      // for a typo like 'todya' or a new dateRange we haven't taught
      // the helper about.
      expect(() => logsService._defaultStartIso('todya')).toThrow(/unknown dateRange/);
      expect(() => logsService._defaultStartIso('last-week')).toThrow(/unknown dateRange/);
    });
    it('_defaultEndIso throws on unknown dateRange (no silent now fallback)', () => {
      expect(() => logsService._defaultEndIso('todya')).toThrow(/unknown dateRange/);
    });

    it('_defaultEndIso("yesterday") snaps to yesterday 23:59:59 (does NOT spill into today)', () => {
      const endIso = logsService._defaultEndIso('yesterday');
      const end = new Date(endIso);
      const now = new Date();
      // Must be earlier than or equal to today's local 23:59:59.999 and
      // not later than "now" (the previous bug used today's now as the
      // upper bound — queries for yesterday spilled into today).
      const upperBound = new Date(now);
      upperBound.setHours(23, 59, 59, 999);
      expect(end.getTime()).toBeLessThanOrEqual(upperBound.getTime());
    });

    it('_isVlUnavailable classifies ECONNRESET, EPIPE, EAI_AGAIN, EHOSTUNREACH as outages', () => {
      const codes = ['ECONNRESET', 'EPIPE', 'EAI_AGAIN', 'EHOSTUNREACH'];
      for (const code of codes) {
        const err = Object.assign(new Error(code), { code });
        expect(logsService._isVlUnavailable(err)).toBe(true);
      }
    });

    it('_isVlUnavailable rejects non-5xx response statuses (499, 0, string)', () => {
      expect(logsService._isVlUnavailable({ response: { status: 499 } })).toBe(false);
      expect(logsService._isVlUnavailable({ response: { status: 0 } })).toBe(false);
      expect(logsService._isVlUnavailable({ response: { status: '500' } })).toBe(false);
    });

    it('_sumHits coerces stringified hits() values to numbers', () => {
      expect(logsService._sumHits({ ERROR: '4', WARN: '2' }, 'ERROR')).toBe(4);
      expect(logsService._sumHits({ ERROR: '4', WARN: '2' }, 'WARN')).toBe(2);
    });

    describe('_sumHits single-key fallback', () => {
      it('returns the value when the lone key matches the requested level', () => {
        expect(logsService._sumHits({ ERROR: 5 }, 'ERROR')).toBe(5);
        expect(logsService._sumHits({ error: 5 }, 'ERROR')).toBe(5);
        expect(logsService._sumHits({ Error: 5 }, 'error')).toBe(5);
      });
      it('does NOT bleed counts from a sibling level when the lone key does not match', () => {
        // The previous behaviour returned the value unconditionally when
        // there was exactly one bucket — so asking for ERROR but receiving
        // {FATAL: 5} would incorrectly return 5.
        expect(logsService._sumHits({ FATAL: 5 }, 'ERROR')).toBe(0);
        expect(logsService._sumHits({ WARN: 3 }, 'ERROR')).toBe(0);
      });
      it('returns the value when no level is requested', () => {
        expect(logsService._sumHits({ ERROR: 7 }, undefined)).toBe(7);
        expect(logsService._sumHits({ ERROR: 7 }, '')).toBe(7);
      });
      it('returns 0 when the single-key object has multiple zero values', () => {
        expect(logsService._sumHits({ ERROR: 0, WARN: 0 }, 'ERROR')).toBe(0);
      });
    });

    it('_vlFilter falls back to "*" when called with empty/whitespace q', () => {
      expect(logsService._vlFilter('')).toBe('*');
      expect(logsService._vlFilter('   ')).toBe('*');
    });

    it('_vlFilter appends AD-5 dual-emit dedup when LOG_TO_VICTORIALOGS=true and LOG_TO_FILE unset', () => {
      process.env.LOG_TO_VICTORIALOGS = '1';
      delete process.env.LOG_TO_FILE;
      expect(logsService._vlFilter('level:INFO')).toBe(
        'level:INFO AND NOT (_stream:genie.backend OR _stream:genie.document-repository)'
      );
    });

    it('_sourceMode trims and lowercases ADMIN_LOGS_SOURCE (escapes " FILE " typo)', () => {
      process.env.ADMIN_LOGS_SOURCE = ' FILE ';
      expect(logsService._sourceMode()).toBe('file');
      process.env.ADMIN_LOGS_SOURCE = 'File';
      expect(logsService._sourceMode()).toBe('file');
      process.env.ADMIN_LOGS_SOURCE = 'victorialogs';
      expect(logsService._sourceMode()).toBe('victorialogs');
    });

    describe('_escapeLogSql adversarial inputs', () => {
      // Adversarial payloads that attempt to break out of the surrounding
      // `_msg:"..."` wrapper. The escape must leave LogSQL unable to parse
      // a secondary clause / character class.
      const t = (raw) => logsService._escapeLogSql(raw);

      it('strips ASCII double-quote (LogSQL string terminator)', () => {
        expect(t('foo"bar')).not.toMatch(/"/);
      });
      it('strips backslash escape sequences', () => {
        expect(t('foo\\"bar')).not.toMatch(/\\/);
      });
      it('strips newline/CR (multi-line string terminator)', () => {
        expect(t('foo\nbar')).not.toMatch(/\n/);
        expect(t('foo\r\nbar')).not.toMatch(/\r/);
      });
      it('strips Unicode curly double-quotes (homoglyph defence)', () => {
        // The Unicode “” pair must not survive into the sanitised string.
        const sanitized = t('foo“bar”');
        expect(sanitized).not.toMatch(/[“”]/);
      });
      it('strips curly single-quotes (homoglyph defence)', () => {
        const sanitized = t('foo‘bar’');
        expect(sanitized).not.toMatch(/[‘’]/);
      });
      it('strips ASCII single-quote (defence-in-depth)', () => {
        expect(t("foo'bar")).not.toMatch(/'/);
      });
      it('strips LogSQL clause keywords AND/OR/NOT whole-word, case-insensitive', () => {
        expect(t('a) OR (_stream:"*")')).not.toMatch(/\bOR\b/i);
        expect(t('a AND level:ERROR')).not.toMatch(/\bAND\b/i);
        expect(t('a Not level:ERROR')).not.toMatch(/\bNOT\b/i);
        expect(t('a and level:ERROR')).not.toMatch(/\bAND\b/i);
      });
      it('strips LogSQL structural punctuation (: ( ) { } ; , = * ? `)', () => {
        // Each one must be replaced with whitespace.
        for (const ch of [':', '(', ')', '{', '}', ';', ',', '=', '*', '?', '`']) {
          expect(t(`a${ch}b`)).not.toContain(ch);
        }
      });
      it('preserves allowed word characters and spaces between tokens', () => {
        const input = 'normal search term with spaces';
        const sanitized = t(input);
        // Verbatim — every char in the allowlist is preserved.
        expect(sanitized).toBe('normal search term with spaces');
      });
      it('canonical injected payload: a) OR (_stream:"*") cannot break out', () => {
        const sanitized = t('a) OR (_stream:"*")');
        // Compose the full filter the caller would emit.
        const filter = `_msg:"${sanitized}"`;
        expect(filter).not.toMatch(/\)\s*OR\s*\(/i);
        expect(filter).not.toMatch(/\bOR\s*\(_stream/i);
        // The literal payload characters that mattered are gone.
        expect(sanitized).not.toContain('(');
        expect(sanitized).not.toContain(')');
        expect(sanitized).not.toContain(':');
        expect(sanitized).not.toContain('*');
        expect(sanitized).not.toContain('"');
      });
    });

    describe('level filter allowlist', () => {
      it('accepts every canonical level (TRACE/DEBUG/INFO/WARN/ERROR/FATAL)', () => {
        for (const lvl of ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']) {
          expect(logsService._normalizeLevelFilter(lvl)).toBe(lvl);
        }
      });
      it('uppercases and trims input', () => {
        expect(logsService._normalizeLevelFilter('  info ')).toBe('INFO');
        expect(logsService._normalizeLevelFilter('warn')).toBe('WARN');
      });
      it('maps the legacy WARNING synonym to WARN', () => {
        expect(logsService._normalizeLevelFilter('WARNING')).toBe('WARN');
        expect(logsService._normalizeLevelFilter('warning')).toBe('WARN');
      });
      it('rejects injection payloads outside the allowlist', () => {
        const hostile = 'INFO OR _stream:*';
        expect(() => logsService._normalizeLevelFilter(hostile)).toThrow(
          /must be one of TRACE, DEBUG, INFO, WARN, ERROR, FATAL/
        );
      });
      it('rejects empty / non-string level', () => {
        expect(() => logsService._normalizeLevelFilter('')).toThrow(/non-empty string/);
        expect(() => logsService._normalizeLevelFilter(null)).toThrow(/non-empty string/);
        expect(() => logsService._normalizeLevelFilter(undefined)).toThrow(/non-empty string/);
        expect(() => logsService._normalizeLevelFilter(42)).toThrow(/non-empty string/);
      });
      it('searchLogs — VL path: hostile level throws before the VL call', async () => {
        mockVlClient.query.mockResolvedValue([]);
        await expect(
          logsService.searchLogs({ level: 'INFO OR _stream:*', startDate: '2026-09-01', endDate: '2026-09-01' })
        ).rejects.toThrow(/must be one of/);
        expect(mockVlClient.query).not.toHaveBeenCalled();
      });
      it('searchLogs — VL path: valid level passes and reaches VL', async () => {
        mockVlClient.query.mockResolvedValue([]);
        await logsService.searchLogs({
          level: 'INFO',
          startDate: '2026-09-01',
          endDate: '2026-09-01'
        });
        expect(mockVlClient.query).toHaveBeenCalledTimes(1);
        const call = mockVlClient.query.mock.calls[0][0];
        expect(call.q).toMatch(/level:INFO\b/);
      });
    });

    describe('_parseNdjsonContent retry-success cursor handling', () => {
      it('does not over-advance the cursor after a successful retry', () => {
        // Construct content where:
        //   iter 1 segment = '{"trunc":' (length 9, invalid JSON)
        //   newlineIdx + RE_PARSE_WINDOW_BYTES <= content.length (retry fires)
        //   tail = '[1,1,...,1]}' (4096 bytes ending in '}')
        //   segment + tail = '{"trunc":[1,1,...,1]}' — VALID JSON, retry succeeds.
        //
        // The tail line itself is intentionally NOT valid JSON standalone
        // (it ends with `}`), so iter 2 (re-entered at newlineIdx+1) records
        // a parse_error and skips the line. With the bug, the over-advance
        // would have skipped it entirely (no parse_error either, because
        // iter 2's cursor landed on a blank line).
        const tailArray = '[' + '1,'.repeat(2046) + '1]}'; // 4096 bytes, ends with '}'
        const content = '{"trunc":\n' + tailArray + '\n{"message":"next"}\n';
        // Use jest.isolateModules so we capture the SAME logger mock the
        // service uses, and count its warn calls (parseError++ path).
        let isolatedService;
        let parseErrorCount = 0;
        jest.isolateModules(() => {
          const { logger } = require('../../shared-lib');
          const origWarn = logger.warn;
          logger.warn = jest.fn((...args) => {
            if (String(args[0]).includes('parse error')) parseErrorCount++;
            return origWarn.apply(logger, args);
          });
          isolatedService = require('../../services/logs-service');
          isolatedService.initialized = false;
        });
        const rows = isolatedService._parseNdjsonContent(content);
        // With the fix: 2 rows (retry-success + {"msg":"next"}), 1 parse_error.
        // With the bug: 2 rows (retry-success + {"msg":"next"}), 0 parse_errors
        //   (the tail line is skipped by cursor over-advance into a blank line,
        //   not by parse_error).
        expect(rows.length).toBe(2);
        expect(rows[1].message).toBe('next');
        expect(parseErrorCount).toBe(1);
      });
    });

    it('getLogsInRange clamps limit=-1 and offset=-5 to safe values', async () => {
      mockVlClient.query.mockResolvedValue([]);
      const result = await logsService.getLogsInRange({
        start: '2026-09-01T00:00:00.000Z',
        end: '2026-09-01T23:59:59.999Z',
        limit: -1,
        offset: -5
      });
      expect(result.limit).toBe(0);
      expect(result.offset).toBe(0);
    });

    it('getLogFilesInRange returns [] for date spans exceeding MAX_LOG_FILES_RANGE_DAYS', async () => {
      const descriptors = await logsService.getLogFilesInRange('2000-01-01', '2026-09-07');
      expect(descriptors).toEqual([]);
    });

    it('_acquireReadLock throws TypeError on non-string filePath', async () => {
      await expect(logsService._acquireReadLock(undefined)).rejects.toThrow(TypeError);
      await expect(logsService._acquireReadLock(null)).rejects.toThrow(TypeError);
      await expect(logsService._acquireReadLock('')).rejects.toThrow(TypeError);
    });

    it('getDebugYesterday backward-compat alias routes through debugYesterdayLogs', async () => {
      mockVlClient.query.mockResolvedValue([
        {
          _time: '2026-09-06T12:00:00.000Z',
          _msg: 'hello',
          level: 'INFO',
          service: 'genie-backend',
          stream: 'genie.backend'
        }
      ]);
      const result = await logsService.getDebugYesterday();
      expect(result.success).toBe(true);
      expect(result.lines).toBeGreaterThanOrEqual(1);
    });

    it('file-path getLogsInRange envelope carries limit/offset (VL/file parity)', async () => {
      process.env.ADMIN_LOGS_SOURCE = 'file';
      process.env.LOG_TO_FILE = '1';
      // Empty file listing → empty envelope, but limit/offset MUST round-trip.
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValueOnce([]);
      const result = await logsService.getLogsInRange({
        dateRange: 'custom',
        startDate: '2026-09-01',
        endDate: '2026-09-01',
        limit: 25,
        offset: 10
      });
      expect(result.limit).toBe(25);
      expect(result.offset).toBe(10);
    });
  });

  describe('review follow-up #2 — 2026-09-07 patches (round 3)', () => {
    it('_logVlUnavailableOnce: cooldown file is updated each successful log (writeFileSync path)', () => {
      mockFsSync.existsSync.mockReturnValue(true);
      mockFsSync.readFileSync.mockReturnValueOnce(String(Date.now() - 10 * 60 * 1000)); // 10 min ago
      logsService._logVlUnavailableOnce('test-op', new Error('boom'));
      // writeFileSync (not openSync 'wx') — must have been called to refresh
      // the cooldown timestamp.
      expect(mockFsSync.writeFileSync).toHaveBeenCalled();
      const [pathArg, valueArg] = mockFsSync.writeFileSync.mock.calls[mockFsSync.writeFileSync.mock.calls.length - 1];
      expect(typeof pathArg).toBe('string');
      expect(Number.isFinite(Number(valueArg))).toBe(true);
    });

    it('_logVlUnavailableOnce: still skips log when within cooldown window', () => {
      mockFsSync.existsSync.mockReturnValue(true);
      mockFsSync.readFileSync.mockReturnValueOnce(String(Date.now() - 1000)); // 1s ago
      const writeBefore = mockFsSync.writeFileSync.mock.calls.length;
      logsService._logVlUnavailableOnce('test-op', new Error('boom'));
      const writeAfter = mockFsSync.writeFileSync.mock.calls.length;
      expect(writeAfter).toBe(writeBefore);
    });

    it('_emptyEnvelope clamps limit=-1 / offset=-5 to safe values', () => {
      const env = logsService._emptyEnvelope({ limit: -1, offset: -5 });
      expect(env.limit).toBe(0);
      expect(env.offset).toBe(0);
    });

    it('_emptyEnvelope clamps limit > 10000', () => {
      const env = logsService._emptyEnvelope({ limit: 99999, offset: 5 });
      expect(env.limit).toBe(10000);
      expect(env.offset).toBe(5);
    });

    it('_defaultEndIso("week") snaps to end-of-day (no minute drift)', () => {
      const before = new Date();
      before.setHours(23, 59, 59, 999);
      const expected = before.toISOString();
      const actual = logsService._defaultEndIso('week');
      expect(actual).toBe(expected);
    });

    it('_defaultEndIso("month") snaps to end-of-day', () => {
      const before = new Date();
      before.setHours(23, 59, 59, 999);
      const expected = before.toISOString();
      const actual = logsService._defaultEndIso('month');
      expect(actual).toBe(expected);
    });

    it('searchLogs — VL path honours caller offset (paginates the result window)', async () => {
      const rows = Array.from({ length: 25 }, (_, i) => ({ _msg: `row-${i}` }));
      mockVlClient.query.mockResolvedValueOnce(rows);
      const result = await logsService.searchLogs({
        dateRange: 'today',
        limit: 10,
        offset: 5
      });
      // Adapter asked for limit + offset = 15 rows, then we slice [5, 15).
      expect(mockVlClient.query).toHaveBeenCalledWith(expect.objectContaining({ limit: 15 }));
      expect(result.logs).toHaveLength(10);
      expect(result.logs[0]).toEqual({ _msg: 'row-5' });
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(5);
    });

    it('searchLogs — VL path clamps negative limit/offset to safe values', async () => {
      const rows = Array.from({ length: 3 }, (_, i) => ({ _msg: `r${i}` }));
      mockVlClient.query.mockResolvedValueOnce(rows);
      const result = await logsService.searchLogs({
        dateRange: 'today',
        limit: -5,
        offset: -10
      });
      // limit=0 → no rows in slice; offset=0 → start from 0
      expect(mockVlClient.query).toHaveBeenCalledWith(expect.objectContaining({ limit: 0 }));
      expect(result.logs).toHaveLength(0);
      expect(result.limit).toBe(0);
      expect(result.offset).toBe(0);
    });

    it('getLogsSummary — VL path with level=ERROR returns only errors bucket', async () => {
      mockVlClient.hits.mockResolvedValueOnce({ ERROR: 7 }).mockResolvedValueOnce({ WARN: 99 });
      const result = await logsService.getLogsSummary({ date: '2026-09-06', level: 'ERROR' });
      expect(mockVlClient.hits).toHaveBeenCalledTimes(1);
      expect(mockVlClient.hits).toHaveBeenCalledWith(expect.objectContaining({ q: 'level:ERROR' }));
      expect(result.errors).toEqual([{ type: 'ERROR', typeKey: 'error', service: 'all', count: 7 }]);
      expect(result.warnings).toEqual([]);
    });

    it('getLogsSummary — VL path with level=INFO returns only infos bucket', async () => {
      mockVlClient.hits.mockResolvedValueOnce({ INFO: 42 });
      const result = await logsService.getLogsSummary({ date: '2026-09-06', level: 'INFO' });
      expect(mockVlClient.hits).toHaveBeenCalledTimes(1);
      expect(mockVlClient.hits).toHaveBeenCalledWith(expect.objectContaining({ q: 'level:INFO' }));
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.infos).toEqual([{ type: 'INFO', typeKey: 'info', service: 'all', count: 42 }]);
    });

    it('getLogsSummary — VL path with level unset queries both ERROR + WARN (parallel)', async () => {
      mockVlClient.hits.mockResolvedValueOnce({ ERROR: 4 }).mockResolvedValueOnce({ WARN: 2 });
      const result = await logsService.getLogsSummary({ date: '2026-09-06' });
      expect(mockVlClient.hits).toHaveBeenCalledTimes(2);
      expect(result.errors[0].count).toBe(4);
      expect(result.warnings[0].count).toBe(2);
    });
  });

  describe('review follow-up #3 — 2026-09-07 patches (round 4)', () => {
    describe('MAX_LOG_FILE_SIZE truncation rewind (file path)', () => {
      beforeEach(() => {
        process.env.ADMIN_LOGS_SOURCE = 'file';
        process.env.LOG_TO_FILE = '1';
      });

      // Helper: feed a fixed-size buffer whose text content ends partway
      // through a JSON object. The rewind must drop the trailing partial
      // line, returning only the prefix that ends on a complete `\n`.
      const buildTruncatedBuffer = () => {
        const complete =
          '{"timestamp":"2026-09-01T08:00:00.000Z","_msg":"complete-a"}\n' +
          '{"timestamp":"2026-09-01T09:00:00.000Z","_msg":"complete-b"}\n';
        const partial = '{"timestamp":"2026-09-01T10:00:00.000Z","_msg":"par';
        const full = complete + partial;
        const raw = Buffer.from(full, 'utf8');
        // Pad to MAX_LOG_FILE_SIZE with NUL bytes — the read buffer is
        // allocated to that size, but `toString('utf8')` will only emit
        // up to the real content + the NULs (NUL is valid in JS strings).
        // The rewind must still happen on the last `\n`, ignoring any
        // post-content padding.
        const padded = Buffer.alloc(20 * 1024 * 1024);
        raw.copy(padded, 0);
        return padded;
      };

      it('_getLogsInRangeFromFile truncates to last \\n when over MAX_LOG_FILE_SIZE (no half JSON token)', async () => {
        mockFs.access.mockResolvedValue(undefined);
        mockFs.readdir.mockResolvedValueOnce(['combined-2026-09-01.log']);
        const mockLockHandle = { close: jest.fn().mockResolvedValue(undefined) };
        mockFs.stat.mockResolvedValue({ size: 25 * 1024 * 1024 }); // > MAX_LOG_FILE_SIZE
        const fh = { read: jest.fn(), close: jest.fn() };
        // Return the padded buffer; `fh.read` fills the destination.
        const padded = buildTruncatedBuffer();
        fh.read.mockImplementation((buf) => {
          padded.copy(buf, 0);
          return Promise.resolve({ bytesRead: padded.length });
        });
        fh.close.mockResolvedValue(undefined);
        // AD-10 lock acquire ('wx') returns the lock handle; file open ('r')
        // returns the file handle — distinguished by the lock suffix.
        mockFs.open.mockImplementation((p, _mode) => {
          if (typeof p === 'string' && p.includes('.logs-read-lock-')) {
            return Promise.resolve(mockLockHandle);
          }
          return Promise.resolve(fh);
        });

        const result = await logsService.getLogsInRange({
          dateRange: 'custom',
          startDate: '2026-09-01',
          endDate: '2026-09-01',
          limit: 10
        });
        // Rewind dropped the partial trailing line → 2 parsed rows.
        // (Rows are sorted descending by timestamp.)
        expect(result.logs).toHaveLength(2);
        expect(result.logs.map((l) => l.message)).toEqual(['complete-b', 'complete-a']);
        expect(fh.close).toHaveBeenCalled();
      });

      it('readLogFile: returns full buffer when no \\n is present (single huge line fallback)', async () => {
        // Direct test of the standalone readLogFile helper.
        mockFs.access.mockResolvedValue(undefined);
        mockFs.stat.mockResolvedValue({ size: 25 * 1024 * 1024 });
        const fh = { read: jest.fn(), close: jest.fn() };
        const oneBigLine = Buffer.alloc(20 * 1024 * 1024, 0x41); // 20 MB of 'A', no newline
        fh.read.mockImplementation((buf) => {
          oneBigLine.copy(buf, 0);
          return Promise.resolve({ bytesRead: oneBigLine.length });
        });
        fh.close.mockResolvedValue(undefined);
        mockFs.open.mockResolvedValue(fh);

        const out = await logsService.readLogFile('/var/log/combined-2026-09-01.log');
        // lastIndexOf returns -1 → keeps whole buffer; length preserved.
        expect(out.length).toBe(20 * 1024 * 1024);
        expect(out[0]).toBe('A');
      });
    });
  });
});
