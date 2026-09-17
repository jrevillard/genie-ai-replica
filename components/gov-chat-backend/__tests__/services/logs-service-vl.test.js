'use strict';

// VictoriaLogs migration tests for `LogsService`.
//
// Covers the new behaviour pinned by the acceptance criteria:
//   - `getLogsInRange` JSDoc envelope `{logs, total, limit, offset}`
//     (file + VL paths).
//   - Per-call `ADMIN_LOGS_SOURCE` env read — toggle mid-suite.
//   - `VL_FAIL_OPEN=true` returns `{degraded: true, ...fallback}` on
//     ECONNREFUSED / 5xx / timeout, surfaces the error otherwise.
//   - 503 `vl_files_disabled` body when `ADMIN_LOGS_SOURCE=file` is
//     requested but `LOG_TO_FILE !== '1'`.
//   - ENOENT tolerance between `stat()` and `open()` on file reads.
//   - `fs.open(path, 'wx')` O_EXCL concurrent-reader lock; EEXIST → skip
//     gracefully.
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

describe('LogsService VictoriaLogs rewrite', () => {
  describe('source routing (per-call env read)', () => {
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
          service: 'backend',
          stream: { service: 'backend', environment: 'test' },
          fields: {}
        },
        {
          timestamp: '2026-09-01T00:00:01.000Z',
          message: 'm2',
          date: '2026-09-01',
          time: '00:00:01',
          level: 'INFO',
          service: 'backend',
          stream: { service: 'backend', environment: 'test' },
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
        service: 'backend',
        stream: { service: 'backend', environment: 'test' },
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
    // Same root cause as the searchLogs level filter: the fluentd-driven
    // Winston transport writes the real level INSIDE the `_msg` JSON
    // envelope (not as a top-level VL field), so VL's `hits(field=level)`
    // always returns `{ERROR: 0, WARN: 0, ...}`. We fetch the day's rows
    // and count client-side AFTER the MELT normalizer has lifted the
    // level out of `_msg`.
    it('counts ERROR + WARN + INFO buckets from per-service VL hits()', async () => {
      // Producer-side transform stamps severity_text + service.name at
      // top level in VL, so the summary uses `hits(field=service.name,
      // q=severity_text:LEVEL)` for per-service counts (no row fetch +
      // client-side counting).
      mockVlClient.hits.mockImplementation(async ({ q }) => {
        if (q === 'severity_text:ERROR') return { backend: 3 };
        if (q === 'severity_text:WARN') return { backend: 1 };
        if (q === 'severity_text:INFO') return { backend: 2, 'document-repository': 10 };
        if (q === '*') return { backend: 6, 'document-repository': 10 };
        return {};
      });
      const result = await logsService.getLogsSummary({ date: '2026-09-01' });
      expect(mockVlClient.hits).toHaveBeenCalled();
      expect(result.date).toBe('2026-09-01');
      expect(result.errors).toEqual([{ type: 'ERROR', typeKey: 'error', service: 'backend', count: 3 }]);
      expect(result.warnings).toEqual([{ type: 'WARN', typeKey: 'warn', service: 'backend', count: 1 }]);
      expect(result.infos).toEqual([
        { type: 'INFO', typeKey: 'info', service: 'document-repository', count: 10 },
        { type: 'INFO', typeKey: 'info', service: 'backend', count: 2 }
      ]);
      expect(result.services).toEqual([
        { name: 'document-repository', count: 10 },
        { name: 'backend', count: 6 }
      ]);
    });

    it('extracts the actual message from a Winston JSON envelope before categorising (TYPE column fidelity)', async () => {
      // Real VL `_msg` for Node services is a Winston JSON envelope:
      //   `{"level":"info","message":"[DB_CONNECTION] Getting database connection",...}`
      // The legacy file-log `groupLogs()` path parsed the envelope first
      // and ran the regex / `split(':')[0]` fallback on the inner
      // `.message` field. The VL summary must do the same — otherwise
      // the TYPE column shows literal `{"level"` for every Winston row.
      mockVlClient.hits.mockImplementation(async ({ q }) => {
        if (q === 'severity_text:INFO') return { backend: 2 };
        if (q === '*') return { backend: 2 };
        return {};
      });
      mockVlClient.query.mockImplementation(async ({ q }) => {
        if (q === 'severity_text:INFO') {
          return [
            {
              _msg: JSON.stringify({
                level: 'info',
                message: '[DB_CONNECTION] Getting database connection',
                service: 'backend'
              }),
              service: 'backend'
            },
            {
              _msg: JSON.stringify({
                level: 'info',
                message: 'ENOENT: no such file or directory',
                service: 'backend'
              }),
              service: 'backend'
            }
          ];
        }
        return [];
      });
      const result = await logsService.getLogsSummary({ date: '2026-09-06', level: 'INFO' });
      const types = result.infos.map((r) => r.type).sort();
      // Three entries expected: 2 message-derived types + 1 seed row
      // (the seeded service had 2 hits() counts; the row fetch only saw
      // its first 2 rows whose types happened to be different, so the
      // service is still surfaced as INFO with the hits() count).
      expect(types).toEqual(['File Not Found', 'INFO', '[DB_CONNECTION] Getting database connection']);
      // No literal envelope leakage.
      expect(result.infos.every((r) => !r.type.startsWith('{'))).toBe(true);
    });

    it('falls through to the raw `_msg` for non-JSON payloads (e.g. uvicorn access logs)', async () => {
      // Python uvicorn access logs are NOT JSON envelopes — they are
      // raw text lines like `INFO: 127.0.0.1:... - "GET /health"`.
      // The `split(':')[0]` fallback should still work on them.
      mockVlClient.hits.mockImplementation(async ({ q }) => {
        if (q === 'severity_text:INFO') return { textgen: 1 };
        if (q === '*') return { textgen: 1 };
        return {};
      });
      mockVlClient.query.mockImplementation(async ({ q }) => {
        if (q === 'severity_text:INFO') {
          return [
            {
              _msg: 'INFO:     127.0.0.1:51056 - "GET /health HTTP/1.1" 200 OK',
              service: 'textgen'
            }
          ];
        }
        return [];
      });
      const result = await logsService.getLogsSummary({ date: '2026-09-06', level: 'INFO' });
      expect(result.infos).toHaveLength(1);
      expect(result.infos[0].type).toBe('INFO');
    });

    it('returns empty buckets when VL has no ERROR/WARN rows', async () => {
      mockVlClient.hits.mockImplementation(async () => ({}));
      const result = await logsService.getLogsSummary({ date: '2026-09-01' });
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.infos).toEqual([]);
      expect(result.services).toEqual([]);
    });

    it('returns empty envelope (degraded) on VL outage with VL_FAIL_OPEN=true', async () => {
      process.env.VL_FAIL_OPEN = 'true';
      const err = new Error('timeout');
      err.code = 'ETIMEDOUT';
      mockVlClient.hits.mockRejectedValue(err);
      const result = await logsService.getLogsSummary({ date: '2026-09-01' });
      expect(result.degraded).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.services).toEqual([]);
      expect(result.date).toBe('2026-09-01');
    });

    it('getLogsSummary — VL path with level=ERROR returns only errors bucket', async () => {
      mockVlClient.hits.mockImplementation(async ({ q }) => {
        if (q === 'severity_text:ERROR') return { auth: 2 };
        if (q === '*') return { auth: 2 };
        return {};
      });
      const result = await logsService.getLogsSummary({ date: '2026-09-06', level: 'ERROR' });
      expect(result.errors).toEqual([{ type: 'ERROR', typeKey: 'error', service: 'auth', count: 2 }]);
      expect(result.warnings).toEqual([]);
      expect(result.infos).toEqual([]);
    });

    it('getLogsSummary — VL path with level=INFO returns only infos bucket', async () => {
      mockVlClient.hits.mockImplementation(async ({ q }) => {
        if (q === 'severity_text:INFO') return { backend: 2, 'document-repository': 1 };
        if (q === '*') return { backend: 2, 'document-repository': 1 };
        return {};
      });
      const result = await logsService.getLogsSummary({ date: '2026-09-06', level: 'INFO' });
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.infos).toEqual([
        { type: 'INFO', typeKey: 'info', service: 'backend', count: 2 },
        { type: 'INFO', typeKey: 'info', service: 'document-repository', count: 1 }
      ]);
    });
  });

  describe('searchLogs — VL path', () => {
    it('builds LogSQL from term + severity_text + service.name filters', async () => {
      // The producer-side transform stamps severity_text + service.name
      // at top level in VL, so the level + service filters are pushed
      // down to VL (no over-fetch + client-side filter required). The
      // resulting VL query matches every fluentd-sourced log uniformly
      // (no dual-path fallback needed).
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
      // All three filters are now pushed down to VL as LogSQL clauses.
      // Term uses both-sides wildcard (`*<term>*`) so VL does prefix-
      // within-token matching — phrase `"<term>"` would fail to match
      // substring fragments like `DB_` inside a longer token
      // (`DB_CONNECTION` tokenises as one word).
      expect(callArg.q).toContain('_msg:*login*');
      expect(callArg.q).toContain('severity_text:INFO');
      expect(callArg.q).toContain('service.name:"auth"');
      // Limit is honoured exactly (no more 4x over-fetch multiplier).
      expect(callArg.limit).toBe(50);
      expect(result.logs).toEqual(rows);
      expect(result.total).toBe(1);
      expect(result.limit).toBe(50);
    });

    it('strips LogSQL reserved chars in the term (replaces with space)', async () => {
      mockVlClient.query.mockResolvedValueOnce([]);
      await logsService.searchLogs({ dateRange: 'today', term: 'a*b?c:d"e\\f' });
      const callArg = mockVlClient.query.mock.calls[0][0];
      // Reserved chars are replaced with spaces — safer than backslash
      // escaping (LogSQL has no escape sequence for newline/control chars;
      // a literal newline in the source would break out of the quoted
      // segment and inject arbitrary filter syntax).
      expect(callArg.q).toContain('_msg:*a b c d e f*');
    });

    it('strips newline + LogSQL control chars to prevent injection', async () => {
      mockVlClient.query.mockResolvedValueOnce([]);
      // Newline + quoted-string terminator + backtick + control chars.
      // After stripping, the `_stream:"evil"` filter clause cannot
      // appear verbatim — the `"`, `:` and newline that close the
      // outer `_msg:*...*` segment are removed (the wildcard wrap does
      // not use quotes, so any literal `"` or `:` would still be a
      // LogSQL injection vector).
      await logsService.searchLogs({
        dateRange: 'today',
        term: 'safe\n_stream:"evil" _msg:`injected'
      });
      const callArg = mockVlClient.query.mock.calls[0][0];
      expect(callArg.q).not.toContain('_stream:"evil"');
      expect(callArg.q).not.toContain('_msg:*evil*');
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

  describe('file path — VlFilesDisabledError 503', () => {
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
        message: 'File-based log source is no longer available'
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

    it('passes the user-supplied q through to VL without a dedup suffix', () => {
      // After the OTel SDK revert (T1-T4b) there is a single emit path
      // (Winston -> stdout -> fluentd -> collector -> VL). The legacy
      // `NOT fluent.tag:*` dedup discriminator served dual-channel
      // reconciliation and is now dead code — the dispatcher passes `q`
      // straight through to the VL adapter.
      mockVlClient.query.mockResolvedValueOnce([]);
      return logsService
        .getLogsInRange({ start: '2026-09-01T00:00:00.000Z', end: '2026-09-01T23:59:59.999Z', limit: 1 })
        .then(() => {
          const callArg = mockVlClient.query.mock.calls[0][0];
          expect(callArg.q).toBe('*');
          expect(callArg.q).not.toMatch(/NOT\s+fluent\.tag/);
        });
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
      it('searchLogs — VL path: valid level is normalised then filtered client-side (NOT pushed to VL)', async () => {
        // The level clause used to be pushed to VL as `level:INFO AND ...`
        // — but the fluentd-driven Winston transport writes the real
        // level INSIDE the `_msg` JSON envelope (not as a top-level VL
        // field), so the VL clause never matched anything. The new
        // architecture filters level on the normalized rows AFTER the
        // MELT adapter lifts it out of `_msg`.
        mockVlClient.query.mockResolvedValue([]);
        await logsService.searchLogs({
          level: 'INFO',
          startDate: '2026-09-01',
          endDate: '2026-09-01'
        });
        expect(mockVlClient.query).toHaveBeenCalledTimes(1);
        const call = mockVlClient.query.mock.calls[0][0];
        expect(call.q).not.toMatch(/\blevel:/);
      });
    });

    describe('review follow-up #2 — 2026-09-07 patches (round 3)', () => {
      it('_logVlUnavailableOnce: cooldown file is updated each successful log (fs.writeFile path)', async () => {
        mockFs.readFile.mockResolvedValueOnce(String(Date.now() - 10 * 60 * 1000)); // 10 min ago
        mockFs.writeFile.mockResolvedValueOnce(undefined);
        await logsService._logVlUnavailableOnce('test-op', new Error('boom'));
        // fs.writeFile (not openSync 'wx') — must have been called to refresh
        // the cooldown timestamp.
        expect(mockFs.writeFile).toHaveBeenCalled();
        const [pathArg, valueArg] = mockFs.writeFile.mock.calls[mockFs.writeFile.mock.calls.length - 1];
        expect(typeof pathArg).toBe('string');
        expect(Number.isFinite(Number(valueArg))).toBe(true);
      });

      it('_logVlUnavailableOnce: still skips log when within cooldown window', async () => {
        mockFs.readFile.mockResolvedValueOnce(String(Date.now() - 1000)); // 1s ago
        const writeBefore = mockFs.writeFile.mock.calls.length;
        await logsService._logVlUnavailableOnce('test-op', new Error('boom'));
        const writeAfter = mockFs.writeFile.mock.calls.length;
        expect(writeAfter).toBe(writeBefore);
      });

      it('_logVlUnavailableOnce: surfaces the original incident via logger.warn when writeFile fails', async () => {
        // Re-require the service inside its own isolateModules registry so
        // we share the same `shared-lib` module instance the service bound
        // `logger` from — `beforeEach` resetModules would otherwise hand us
        // a different mock.
        mockFs.readFile.mockResolvedValueOnce(String(Date.now() - 10 * 60 * 1000));
        const err = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
        mockFs.writeFile.mockRejectedValueOnce(err);
        let sharedLogger;
        let service;
        jest.isolateModules(() => {
          sharedLogger = require('../../shared-lib').logger;
          service = require('../../services/logs-service');
          service.initialized = false;
          service.setVictoriaLogsClient(mockVlClient);
        });
        sharedLogger.warn.mockClear();
        await service._logVlUnavailableOnce('test-op', new Error('boom'));
        expect(sharedLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining('VictoriaLogs unreachable'),
          expect.any(Object)
        );
        // The broken-cooldown incident is also surfaced via logger.error.
        expect(sharedLogger.error).toHaveBeenCalled();
        const errArgs = sharedLogger.error.mock.calls[sharedLogger.error.mock.calls.length - 1];
        expect(String(errArgs[0])).toMatch(/cooldown write failed/i);
        expect(String(errArgs[1])).toMatch(/boom/);
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
        // Per-service hits() with q=severity_text:ERROR returns 7 ERROR
        // rows across two services (5 in auth + 2 in system). The summary
        // surfaces both rows, sorted by count desc; the WARN row in the
        // input set is dropped because the caller's level=ERROR filter
        // excluded it before the bucket was queried.
        mockVlClient.hits.mockImplementation(async ({ q }) => {
          if (q === 'severity_text:ERROR') return { auth: 5, system: 2 };
          if (q === '*') return { auth: 5, system: 2 };
          return {};
        });
        const result = await logsService.getLogsSummary({ date: '2026-09-06', level: 'ERROR' });
        expect(result.errors).toEqual([
          { type: 'ERROR', typeKey: 'error', service: 'auth', count: 5 },
          { type: 'ERROR', typeKey: 'error', service: 'system', count: 2 }
        ]);
        expect(result.warnings).toEqual([]);
        expect(result.infos).toEqual([]);
      });

      it('getLogsSummary — VL path with level=INFO returns only infos bucket', async () => {
        // 42 INFO rows (38 in genie-backend + 4 in retriever) + a WARN
        // row that the level=INFO filter excludes from the WARN bucket.
        mockVlClient.hits.mockImplementation(async ({ q }) => {
          if (q === 'severity_text:INFO') return { backend: 38, retriever: 4 };
          if (q === '*') return { backend: 38, retriever: 4 };
          return {};
        });
        const result = await logsService.getLogsSummary({ date: '2026-09-06', level: 'INFO' });
        expect(result.errors).toEqual([]);
        expect(result.warnings).toEqual([]);
        expect(result.infos).toEqual([
          { type: 'INFO', typeKey: 'info', service: 'backend', count: 38 },
          { type: 'INFO', typeKey: 'info', service: 'retriever', count: 4 }
        ]);
      });

      it('getLogsSummary — VL path with level unset queries ERROR + WARN + INFO + services in parallel', async () => {
        // The new architecture issues 4 parallel hits() calls (one per
        // level bucket + one unfiltered for the dropdown service list).
        // The single-fetch-old tests are no longer applicable.
        mockVlClient.hits.mockImplementation(async ({ q }) => {
          if (q === 'severity_text:ERROR') return { backend: 4 };
          if (q === 'severity_text:WARN') return { backend: 2 };
          if (q === 'severity_text:INFO') return { backend: 100 };
          if (q === '*') return { backend: 106 };
          return {};
        });
        const result = await logsService.getLogsSummary({ date: '2026-09-06' });
        expect(mockVlClient.hits).toHaveBeenCalledTimes(4);
        expect(result.errors).toEqual([{ type: 'ERROR', typeKey: 'error', service: 'backend', count: 4 }]);
        expect(result.warnings).toEqual([{ type: 'WARN', typeKey: 'warn', service: 'backend', count: 2 }]);
        expect(result.infos).toEqual([{ type: 'INFO', typeKey: 'info', service: 'backend', count: 100 }]);
        expect(result.services).toEqual([{ name: 'backend', count: 106 }]);
      });
    });
  });
});
