'use strict';

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

jest.mock('../../services/path-sanitizer', () => ({
  isValidDateStr: jest.fn()
}));

let logsService;

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  // T8: file-source branches gone — dispatchers throw VlFilesDisabledError
  // when ADMIN_LOGS_SOURCE=file. LOG_TO_FILE is no longer consulted by
  // logs-service; the file mode is unreachable end-to-end.
  delete process.env.ADMIN_LOGS_SOURCE;
  delete process.env.LOG_TO_FILE;
  jest.isolateModules(() => {
    logsService = require('../../services/logs-service');
    logsService.initialized = false;
  });
});

describe('LogsService (file-source dropped in T8)', () => {
  describe('init', () => {
    it('is a no-op (file-source branches removed)', async () => {
      await logsService.init();
      expect(logsService.initialized).toBe(true);
    });

    it('skips initialization when already initialized', async () => {
      logsService.initialized = true;
      await logsService.init();
      // No fs.mkdir / fs.access — no-op when already initialized
    });
  });

  describe('file-mode dispatch (VlFilesDisabledError 503)', () => {
    beforeEach(() => {
      process.env.ADMIN_LOGS_SOURCE = 'file';
    });

    it('getLogsInRange throws VlFilesDisabledError', async () => {
      await expect(logsService.getLogsInRange({ dateRange: 'today' })).rejects.toBeInstanceOf(
        logsService.VlFilesDisabledError
      );
    });

    it('getLogsSummary throws VlFilesDisabledError', async () => {
      await expect(logsService.getLogsSummary({ date: '2026-05-26' })).rejects.toBeInstanceOf(
        logsService.VlFilesDisabledError
      );
    });

    it('searchLogs throws VlFilesDisabledError', async () => {
      await expect(logsService.searchLogs({ dateRange: 'today' })).rejects.toBeInstanceOf(
        logsService.VlFilesDisabledError
      );
    });

    it('debugYesterdayLogs throws VlFilesDisabledError', async () => {
      await expect(logsService.debugYesterdayLogs()).rejects.toBeInstanceOf(logsService.VlFilesDisabledError);
    });

    it('getLogFilesInRange throws VlFilesDisabledError', async () => {
      await expect(logsService.getLogFilesInRange('2026-05-25', '2026-05-26')).rejects.toBeInstanceOf(
        logsService.VlFilesDisabledError
      );
    });
  });

  describe('vl-mode dispatch (default)', () => {
    it('default source mode is vl', () => {
      expect(logsService._sourceMode()).toBe('victorialogs');
    });
  });
});
