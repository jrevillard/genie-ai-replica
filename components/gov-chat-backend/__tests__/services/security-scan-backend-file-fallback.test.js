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

describe('SecurityScanService SECURITY_SCAN_BACKEND=file fallback (Story 6.4)', () => {
  const prevBackend = process.env.SECURITY_SCAN_BACKEND;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (prevBackend === undefined) delete process.env.SECURITY_SCAN_BACKEND;
    else process.env.SECURITY_SCAN_BACKEND = prevBackend;
  });

  describe('SECURITY_SCAN_BACKEND=file with no valid cache', () => {
    it('returns a skipped result and never queries VictoriaLogs', async () => {
      process.env.SECURITY_SCAN_BACKEND = 'file';
      // Cache miss: stat throws so checkCachedResults returns null.
      mockFs.stat.mockRejectedValueOnce(new Error('ENOENT'));

      const queryMock = jest.fn();
      securityScanService.setVictoriaLogsClient({ query: queryMock });

      const result = await securityScanService.processLogsInParallel({});

      expect(result).toEqual({
        vulnerabilities: { critical: [], medium: [], low: [] },
        failedLogins: [],
        suspiciousActivities: [],
        skipped: true,
        reason: 'file_backend_no_cache',
        degraded: false,
        error: null
      });
      expect(queryMock).not.toHaveBeenCalled();
    });
  });

  describe('SECURITY_SCAN_BACKEND=file with valid cache', () => {
    it('returns the cached scan result and never queries VictoriaLogs', async () => {
      process.env.SECURITY_SCAN_BACKEND = 'file';

      const cachedVuln = {
        type: 'attack_attempt',
        severity: 'critical',
        description: 'cached hit',
        recommendation: 'noop',
        matchedTerm: 'SQL injection',
        timestamp: '2026-05-26T09:00:00.000Z',
        service: 'http',
        url: null,
        firstSeen: '2026-05-26T09:00:00.000Z',
        lastSeen: '2026-05-26T09:00:00.000Z',
        instanceCount: 1
      };
      const cachedPayload = {
        scanTime: '2026-05-26T09:30:00.000Z',
        vulnerabilities: { critical: 1, medium: 0, low: 0, details: [cachedVuln] },
        vulnerabilityDetails: { critical: [cachedVuln], medium: [], low: [] },
        failedLoginDetails: [{ timestamp: '2026-05-26T09:00:00.000Z', message: 'failed login' }],
        suspiciousDetails: [],
        status: 'completed',
        message: 'ok',
        skipped: false,
        reason: null
      };
      mockFs.stat.mockResolvedValueOnce({ mtime: new Date() });
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(cachedPayload));

      const queryMock = jest.fn();
      securityScanService.setVictoriaLogsClient({ query: queryMock });

      const result = await securityScanService.processLogsInParallel({});

      expect(result.skipped).toBe(false);
      expect(result.reason).toBe('file_backend_cache_hit');
      expect(result.vulnerabilities).toEqual({ critical: [cachedVuln], medium: [], low: [] });
      expect(result.failedLogins).toEqual(cachedPayload.failedLoginDetails);
      expect(result.suspiciousActivities).toEqual([]);
      expect(result.degraded).toBe(false);
      expect(result.error).toBeNull();
      expect(queryMock).not.toHaveBeenCalled();
    });
  });

  describe('SECURITY_SCAN_BACKEND=victorialogs (default)', () => {
    it('runs the existing VictoriaLogs bulk query path', async () => {
      delete process.env.SECURITY_SCAN_BACKEND;
      const queryMock = jest.fn().mockResolvedValue([]);
      securityScanService.setVictoriaLogsClient({ query: queryMock });

      const result = await securityScanService.processLogsInParallel({});

      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(queryMock.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          q: expect.any(String),
          start: expect.any(String),
          end: expect.any(String),
          limit: expect.any(Number)
        })
      );
      expect(result.skipped).toBeUndefined();
      expect(result.reason).toBeUndefined();
      expect(result.vulnerabilities).toEqual({ critical: [], medium: [], low: [] });
    });
  });

  describe('runSecurityScan wrapper under SECURITY_SCAN_BACKEND=file', () => {
    it('maps the file-backend no-cache result to a skipped scanResult and persists it', async () => {
      process.env.SECURITY_SCAN_BACKEND = 'file';
      // Cache miss: stat throws so checkCachedResults returns null.
      mockFs.stat.mockRejectedValueOnce(new Error('ENOENT'));
      // saveScanResults calls mkdir then writeFile; both must resolve.
      mockFs.mkdir.mockResolvedValueOnce();
      mockFs.writeFile.mockResolvedValueOnce();

      const queryMock = jest.fn();
      securityScanService.setVictoriaLogsClient({ query: queryMock });

      const scanResult = await securityScanService.runSecurityScan({});

      expect(queryMock).not.toHaveBeenCalled();
      expect(scanResult.status).toBe('skipped');
      expect(scanResult.skipped).toBe(true);
      expect(scanResult.reason).toBe('file_backend_no_cache');
      expect(scanResult.message).toBe('Security scan skipped: file_backend_no_cache');
      expect(scanResult.failedLoginDetails).toEqual([]);
      expect(scanResult.suspiciousDetails).toEqual([]);
      expect(scanResult.degraded).toBe(false);
      expect(scanResult.error).toBeNull();
      // Persistence: scanResult was written to /app/data/security/last-scan-results.json
      expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
      expect(mockFs.writeFile.mock.calls[0][0]).toBe('/app/data/security/last-scan-results.json');
      const written = JSON.parse(mockFs.writeFile.mock.calls[0][1]);
      expect(written.status).toBe('skipped');
      expect(written.reason).toBe('file_backend_no_cache');
    });

    it('maps the file-backend cache-hit result to a completed scanResult and persists the cached payload', async () => {
      process.env.SECURITY_SCAN_BACKEND = 'file';

      const cachedVuln = {
        type: 'attack_attempt',
        severity: 'critical',
        description: 'cached hit',
        recommendation: 'noop',
        matchedTerm: 'SQL injection',
        timestamp: '2026-05-26T09:00:00.000Z',
        service: 'http',
        url: null,
        firstSeen: '2026-05-26T09:00:00.000Z',
        lastSeen: '2026-05-26T09:00:00.000Z',
        instanceCount: 1
      };
      const cachedPayload = {
        scanTime: '2026-05-26T09:30:00.000Z',
        vulnerabilities: { critical: 1, medium: 0, low: 0, details: [cachedVuln] },
        vulnerabilityDetails: { critical: [cachedVuln], medium: [], low: [] },
        failedLoginDetails: [{ timestamp: '2026-05-26T09:00:00.000Z', message: 'failed login' }],
        suspiciousDetails: [{ timestamp: '2026-05-26T09:01:00.000Z', message: 'suspicious' }],
        status: 'completed',
        message: 'ok',
        skipped: false,
        reason: null
      };
      mockFs.stat.mockResolvedValueOnce({ mtime: new Date() });
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(cachedPayload));
      mockFs.mkdir.mockResolvedValueOnce();
      mockFs.writeFile.mockResolvedValueOnce();

      const queryMock = jest.fn();
      securityScanService.setVictoriaLogsClient({ query: queryMock });

      const scanResult = await securityScanService.runSecurityScan({});

      expect(queryMock).not.toHaveBeenCalled();
      expect(scanResult.status).toBe('completed');
      expect(scanResult.skipped).toBe(false);
      expect(scanResult.reason).toBe('file_backend_cache_hit');
      expect(scanResult.message).toBe('Security scan completed successfully');
      expect(scanResult.vulnerabilityDetails).toEqual({
        critical: [cachedVuln],
        medium: [],
        low: []
      });
      expect(scanResult.failedLoginDetails).toEqual(cachedPayload.failedLoginDetails);
      expect(scanResult.suspiciousDetails).toEqual(cachedPayload.suspiciousDetails);
      expect(scanResult.degraded).toBe(false);
      expect(scanResult.error).toBeNull();
      // Persistence: scanResult was written and matches the cache-hit shape.
      expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
      expect(mockFs.writeFile.mock.calls[0][0]).toBe('/app/data/security/last-scan-results.json');
      const written = JSON.parse(mockFs.writeFile.mock.calls[0][1]);
      expect(written.status).toBe('completed');
      expect(written.reason).toBe('file_backend_cache_hit');
    });
  });
});
