'use strict';

// Story 5.10 — admin-source test: toggle env mid-suite assert no-restart path switch.
//
// AD-6 (per-call `ADMIN_LOGS_SOURCE` env read) is the production guarantee
// that operators can flip the source between `file` (escape hatch, D2) and
// `victorialogs` (default) without a backend restart. These tests assert
// that guarantee from the admin-source perspective: the same `LogsService`
// singleton + `AdminDashboardService` instance must route successive calls
// to different backends as the env var flips between them, with no
// `jest.resetModules()` / `jest.isolateModules()` between calls.

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
    },
    dbService: { getConnection: jest.fn() }
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
  writeFile: jest.fn(),
  unlink: jest.fn(),
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
let adminDashboardService;
let mockVlClient;

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();

  // The whole point of Story 5.10 is that the env var is re-read per call;
  // tests reset to a known baseline before each case so the per-call read
  // is observable.
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

    adminDashboardService = require('../../services/admin-dashboard-service');
    adminDashboardService.initialized = false;
    adminDashboardService.setLogsService(logsService);
  });
});

describe('Story 5.10 — admin-source no-restart path switch', () => {
  describe('_sourceMode — per-call env re-read (AD-6)', () => {
    it('defaults to victorialogs when ADMIN_LOGS_SOURCE is unset', () => {
      delete process.env.ADMIN_LOGS_SOURCE;
      expect(logsService._sourceMode()).toBe('victorialogs');
    });

    it('returns file when ADMIN_LOGS_SOURCE=file', () => {
      process.env.ADMIN_LOGS_SOURCE = 'file';
      expect(logsService._sourceMode()).toBe('file');
    });

    it('flips back to victorialogs when env is cleared without reload', () => {
      process.env.ADMIN_LOGS_SOURCE = 'file';
      expect(logsService._sourceMode()).toBe('file');
      delete process.env.ADMIN_LOGS_SOURCE;
      expect(logsService._sourceMode()).toBe('victorialogs');
    });

    it('treats uppercase / whitespace variants of "file" as file', () => {
      process.env.ADMIN_LOGS_SOURCE = '  FILE  ';
      expect(logsService._sourceMode()).toBe('file');
    });

    it('treats any non-"file" value as victorialogs (default branch)', () => {
      process.env.ADMIN_LOGS_SOURCE = 'something-else';
      expect(logsService._sourceMode()).toBe('victorialogs');
    });
  });

  describe('getLogsInRange — mid-suite source toggle, no restart', () => {
    const queryOpts = {
      start: '2026-09-01T00:00:00.000Z',
      end: '2026-09-01T23:59:59.999Z',
      limit: 100,
      offset: 0
    };

    const vlRows = [
      {
        timestamp: '2026-09-01T00:00:00.000Z',
        message: 'vl-row',
        date: '2026-09-01',
        time: '00:00:00',
        level: 'INFO',
        service: 'genie-backend',
        stream: { service: 'genie-backend', environment: 'test' },
        fields: {}
      }
    ];

    it('serves VL when ADMIN_LOGS_SOURCE is unset on the first call', async () => {
      delete process.env.ADMIN_LOGS_SOURCE;
      mockVlClient.query.mockResolvedValueOnce(vlRows);
      const result = await logsService.getLogsInRange(queryOpts);
      expect(mockVlClient.query).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ logs: vlRows, total: 1, limit: 100, offset: 0 });
    });

    it('flips to file on the next call when ADMIN_LOGS_SOURCE=file is set, with NO module reload', async () => {
      // First call: VL (default).
      delete process.env.ADMIN_LOGS_SOURCE;
      mockVlClient.query.mockResolvedValueOnce(vlRows);
      await logsService.getLogsInRange(queryOpts);
      expect(mockVlClient.query).toHaveBeenCalledTimes(1);

      // Toggle — no jest.resetModules / jest.isolateModules between calls.
      process.env.ADMIN_LOGS_SOURCE = 'file';
      // File path also requires LOG_TO_FILE for the AD-10 / Story 5.5
      // gate; the dispatch must still pick the file path BEFORE that
      // gate is exercised (it throws VlFilesDisabledError if LOG_TO_FILE
      // is unset, which itself is the "we routed to file" proof).
      let captured;
      try {
        await logsService.getLogsInRange(queryOpts);
      } catch (err) {
        captured = err;
      }
      expect(captured).toBeDefined();
      expect(captured.name).toBe('VlFilesDisabledError');
      // The VL client must NOT have been hit again — the dispatch saw the
      // new env and routed to the file path.
      expect(mockVlClient.query).toHaveBeenCalledTimes(1);
    });

    it('flips back to VL when env is cleared, again with NO module reload', async () => {
      // Start in file mode so the dispatch flips twice within the test.
      process.env.ADMIN_LOGS_SOURCE = 'file';
      process.env.LOG_TO_FILE = '1';
      // File path needs at least one file discoverable; return an empty
      // directory so the file path returns the empty envelope rather
      // than throwing. The "we routed to file" signal is the absence
      // of any VL client call.
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([]);
      await logsService.getLogsInRange(queryOpts);
      expect(mockVlClient.query).not.toHaveBeenCalled();

      // Toggle back to VL.
      delete process.env.ADMIN_LOGS_SOURCE;
      mockVlClient.query.mockResolvedValueOnce(vlRows);
      const result = await logsService.getLogsInRange(queryOpts);
      expect(mockVlClient.query).toHaveBeenCalledTimes(1);
      expect(result.logs).toEqual(vlRows);
    });

    it('dispatches per call — same singleton, no restart across N toggles', async () => {
      // Walk through several VL → file → VL → file transitions and
      // verify each one is honoured without any module reload or
      // singleton swap. This is the "no-restart" guarantee.
      const sequence = ['vl', 'file', 'vl', 'file', 'vl'];
      const callSignatures = [];

      for (const mode of sequence) {
        if (mode === 'vl') {
          delete process.env.ADMIN_LOGS_SOURCE;
          mockVlClient.query.mockResolvedValueOnce(vlRows);
          const result = await logsService.getLogsInRange(queryOpts);
          callSignatures.push(['vl', result.logs.length]);
        } else {
          process.env.ADMIN_LOGS_SOURCE = 'file';
          process.env.LOG_TO_FILE = '1';
          mockFs.access.mockResolvedValue(undefined);
          mockFs.readdir.mockResolvedValue([]);
          const result = await logsService.getLogsInRange(queryOpts);
          callSignatures.push(['file', result.logs.length]);
        }
      }

      expect(callSignatures).toEqual([
        ['vl', 1],
        ['file', 0],
        ['vl', 1],
        ['file', 0],
        ['vl', 1]
      ]);
      expect(mockVlClient.query).toHaveBeenCalledTimes(3);
    });
  });

  describe('AdminDashboardService.getLogs — admin-source perspective', () => {
    const queryOpts = {
      dateRange: 'today',
      startDate: '2026-09-01',
      endDate: '2026-09-01',
      limit: 100
    };

    const vlRows = [
      {
        timestamp: '2026-09-01T00:00:00.000Z',
        message: 'admin-vl-row',
        date: '2026-09-01',
        time: '00:00:00',
        level: 'INFO',
        service: 'genie-backend',
        stream: { service: 'genie-backend', environment: 'test' },
        fields: {}
      }
    ];

    it('first call (default env) routes the admin request to VictoriaLogs', async () => {
      delete process.env.ADMIN_LOGS_SOURCE;
      mockVlClient.query.mockResolvedValueOnce(vlRows);
      const result = await adminDashboardService.getLogs(queryOpts);
      expect(mockVlClient.query).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ logs: vlRows, total: 1, limit: 100, offset: 0 });
    });

    it('subsequent call after flipping to file routes the admin request to the file path', async () => {
      // Default VL call.
      delete process.env.ADMIN_LOGS_SOURCE;
      mockVlClient.query.mockResolvedValueOnce(vlRows);
      await adminDashboardService.getLogs(queryOpts);
      expect(mockVlClient.query).toHaveBeenCalledTimes(1);

      // Toggle without restarting the singleton or reloading modules.
      process.env.ADMIN_LOGS_SOURCE = 'file';
      process.env.LOG_TO_FILE = '1';
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([]);

      const result = await adminDashboardService.getLogs(queryOpts);
      // VL was NOT consulted for the second call.
      expect(mockVlClient.query).toHaveBeenCalledTimes(1);
      // File path produced an envelope (empty here, since no log files
      // matched the mocked date range).
      expect(result.logs).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('preserves the admin envelope shape across the source toggle', async () => {
      // The contract is `{logs, total, limit, offset}` regardless of
      // source. The file path may additionally surface a `degraded`
      // flag when the on-disk read hit a non-fatal error (AD-10);
      // what matters here is that the canonical envelope keys are
      // always present so the route layer does not need a branch on
      // source.
      const CANONICAL_KEYS = ['limit', 'logs', 'offset', 'total'];

      delete process.env.ADMIN_LOGS_SOURCE;
      mockVlClient.query.mockResolvedValueOnce(vlRows);
      const vlResult = await adminDashboardService.getLogs(queryOpts);
      for (const key of CANONICAL_KEYS) {
        expect(vlResult).toHaveProperty(key);
      }

      process.env.ADMIN_LOGS_SOURCE = 'file';
      process.env.LOG_TO_FILE = '1';
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([]);
      const fileResult = await adminDashboardService.getLogs(queryOpts);
      for (const key of CANONICAL_KEYS) {
        expect(fileResult).toHaveProperty(key);
      }
    });
  });

  describe('Observability — env re-read survives jest.resetModules only between tests', () => {
    it('does NOT cache the source mode at module-load (read on every call)', () => {
      // The first three `_sourceMode()` reads must each reflect the
      // current `process.env.ADMIN_LOGS_SOURCE`, NOT a frozen value
      // captured at module-load. If they all returned the same value,
      // that would be the bug Story 5.10 exists to prevent.
      expect(logsService._sourceMode()).toBe('victorialogs');

      process.env.ADMIN_LOGS_SOURCE = 'file';
      expect(logsService._sourceMode()).toBe('file');

      process.env.ADMIN_LOGS_SOURCE = 'victorialogs';
      expect(logsService._sourceMode()).toBe('victorialogs');

      delete process.env.ADMIN_LOGS_SOURCE;
      expect(logsService._sourceMode()).toBe('victorialogs');
    });
  });
});
