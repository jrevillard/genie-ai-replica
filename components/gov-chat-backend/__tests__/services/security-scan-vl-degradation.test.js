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

const mockFs = {
  readFile: jest.fn(),
  stat: jest.fn(),
  mkdir: jest.fn(),
  writeFile: jest.fn(),
  readdir: jest.fn(),
  access: jest.fn()
};

jest.mock('fs', () => ({ promises: mockFs }));

jest.mock('luxon', () => ({
  DateTime: {
    now: jest.fn().mockReturnValue({
      toISO: jest.fn().mockReturnValue('2026-05-26T10:00:00.000Z'),
      toFormat: jest.fn().mockReturnValue('2026-05-26'),
      minus: jest.fn().mockReturnValue({
        toFormat: jest.fn().mockReturnValue('2026-05-16'),
        toISO: jest.fn().mockReturnValue('2026-05-16T10:00:00.000Z')
      }),
      diff: jest.fn().mockReturnValue({ hours: 0.5 })
    }),
    fromFormat: jest
      .fn()
      .mockReturnValue({ isValid: true, toISO: jest.fn().mockReturnValue('2026-05-26T10:00:00.000Z') }),
    fromISO: jest.fn().mockReturnValue({ isValid: true, toISO: jest.fn().mockReturnValue('2026-05-26T10:00:00.000Z') }),
    fromJSDate: jest
      .fn()
      .mockReturnValue({ isValid: true, toISO: jest.fn().mockReturnValue('2026-05-26T10:00:00.000Z') })
  }
}));

const securityScanService = require('../../services/security-scan-service');

describe('SecurityScanService VL degradation (P3)', () => {
  const prevFailOpen = process.env.VL_FAIL_OPEN;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (prevFailOpen === undefined) delete process.env.VL_FAIL_OPEN;
    else process.env.VL_FAIL_OPEN = prevFailOpen;
  });

  describe('VL_FAIL_OPEN=true degradation path', () => {
    it('returns {critical:[],medium:[],low:[]} + degraded:true + error:vl_unreachable within 5 seconds', async () => {
      process.env.VL_FAIL_OPEN = '1';
      const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9428'), {
        code: 'ECONNREFUSED'
      });
      securityScanService.setVictoriaLogsClient({
        query: jest.fn().mockRejectedValue(err)
      });
      const start = Date.now();
      const result = await securityScanService.processLogsInParallel({});
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(5000);
      expect(result.vulnerabilities).toEqual({ critical: [], medium: [], low: [] });
      expect(result.failedLogins).toEqual([]);
      expect(result.suspiciousActivities).toEqual([]);
      expect(result.degraded).toBe(true);
      expect(result.error).toBe('vl_unreachable');
    });

    it('triggers fail-open on ENOTFOUND as well as ECONNREFUSED', async () => {
      process.env.VL_FAIL_OPEN = 'true';
      const err = Object.assign(new Error('DNS failure'), { code: 'ENOTFOUND' });
      securityScanService.setVictoriaLogsClient({
        query: jest.fn().mockRejectedValue(err)
      });
      const result = await securityScanService.processLogsInParallel({});
      expect(result.degraded).toBe(true);
      expect(result.error).toBe('vl_unreachable');
    });

    it('throws on generic non-network errors even when VL_FAIL_OPEN=true', async () => {
      process.env.VL_FAIL_OPEN = '1';
      const err = Object.assign(new Error('Internal VL error'), { code: 'ELOGIC' });
      securityScanService.setVictoriaLogsClient({
        query: jest.fn().mockRejectedValue(err)
      });
      await expect(securityScanService.processLogsInParallel({})).rejects.toThrow('Internal VL error');
    });

    it('throws when VL is unreachable but VL_FAIL_OPEN is unset', async () => {
      delete process.env.VL_FAIL_OPEN;
      const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      securityScanService.setVictoriaLogsClient({
        query: jest.fn().mockRejectedValue(err)
      });
      await expect(securityScanService.processLogsInParallel({})).rejects.toThrow('ECONNREFUSED');
    });
  });

  describe('retention boundary', () => {
    it('does NOT cap start or set degraded when VICTORIALOGS_RETENTION equals the 10-day window', async () => {
      const prevRetention = process.env.VICTORIALOGS_RETENTION;
      process.env.VICTORIALOGS_RETENTION = '10d';
      const queryMock = jest.fn().mockResolvedValue([]);
      securityScanService.setVictoriaLogsClient({ query: queryMock });
      try {
        const result = await securityScanService.processLogsInParallel({});
        expect(result.degraded).toBe(false);
        expect(queryMock).toHaveBeenCalledTimes(1);
        const args = queryMock.mock.calls[0][0];
        expect(args.start).toBe('2026-05-16T10:00:00.000Z');
      } finally {
        if (prevRetention === undefined) delete process.env.VICTORIALOGS_RETENTION;
        else process.env.VICTORIALOGS_RETENTION = prevRetention;
      }
    });

    it('does NOT cap start when retention is longer than the window', async () => {
      const prevRetention = process.env.VICTORIALOGS_RETENTION;
      process.env.VICTORIALOGS_RETENTION = '30d';
      const queryMock = jest.fn().mockResolvedValue([]);
      securityScanService.setVictoriaLogsClient({ query: queryMock });
      try {
        const result = await securityScanService.processLogsInParallel({});
        expect(result.degraded).toBe(false);
        expect(queryMock).toHaveBeenCalledTimes(1);
        const args = queryMock.mock.calls[0][0];
        expect(args.start).toBe('2026-05-16T10:00:00.000Z');
      } finally {
        if (prevRetention === undefined) delete process.env.VICTORIALOGS_RETENTION;
        else process.env.VICTORIALOGS_RETENTION = prevRetention;
      }
    });
  });

  describe('negative AJV cache path', () => {
    it('returns null when recent cached file is malformed JSON', async () => {
      mockFs.stat.mockResolvedValueOnce({ mtime: new Date() });
      mockFs.readFile.mockResolvedValueOnce('{ not valid json');
      const result = await securityScanService.checkCachedResults();
      expect(result).toBeNull();
    });

    it('returns null when recent cached file fails schema validation', async () => {
      mockFs.stat.mockResolvedValueOnce({ mtime: new Date() });
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify({ unexpected: 'shape', foo: 'bar' }));
      const result = await securityScanService.checkCachedResults();
      expect(result).toBeNull();
    });
  });
});
