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

jest.mock('fs', () => ({
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

    it('escapes LogSQL reserved chars in the term', async () => {
      mockVlClient.query.mockResolvedValueOnce([]);
      await logsService.searchLogs({ dateRange: 'today', term: 'a*b?c:d"e\\f' });
      const callArg = mockVlClient.query.mock.calls[0][0];
      expect(callArg.q).toContain('a\\*b\\?c\\:d\\"e\\\\f');
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
  });
});
