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

jest.mock('fs', () => ({
  promises: mockFs
}));

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
    fromFormat: jest.fn().mockReturnValue({
      isValid: true,
      toISO: jest.fn().mockReturnValue('2026-05-26T10:00:00.000Z')
    }),
    fromISO: jest.fn().mockReturnValue({
      isValid: true,
      toISO: jest.fn().mockReturnValue('2026-05-26T10:00:00.000Z')
    }),
    fromJSDate: jest.fn().mockReturnValue({
      isValid: true,
      toISO: jest.fn().mockReturnValue('2026-05-26T10:00:00.000Z')
    })
  }
}));

const mockAxios = jest.fn();
mockAxios.get = jest.fn();
jest.mock('axios', () => mockAxios);

jest.mock('../../config', () => ({
  api: {
    baseUrl: 'http://localhost:3000/api',
    healthEndpoint: '/health',
    endpoints: ['/api/users', '/api/logs']
  }
}));

jest.mock('child_process', () => ({
  exec: jest.fn()
}));

jest.mock('os', () => ({
  cpus: jest.fn().mockReturnValue([{ model: 'Test CPU' }])
}));

const securityScanService = require('../../services/security-scan-service');

describe('SecurityScanService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAxios.get.mockReset();
    mockAxios.mockReset();
  });

  describe('checkCachedResults', () => {
    it('should return null when no cached results file exists', async () => {
      mockFs.stat.mockRejectedValueOnce(new Error('ENOENT'));
      const result = await securityScanService.checkCachedResults();
      expect(result).toBeNull();
    });

    it('should return cached results when file is recent', async () => {
      const cachedData = {
        scanTime: new Date().toISOString(),
        vulnerabilities: { critical: 1, medium: 0, low: 0, details: [{ type: 'breach' }] },
        vulnerabilityDetails: {
          critical: [{ type: 'breach' }],
          medium: [],
          low: []
        },
        failedLoginDetails: [],
        suspiciousDetails: [],
        status: 'completed',
        message: 'Security scan completed',
        skipped: false,
        reason: null
      };
      mockFs.stat.mockResolvedValueOnce({ mtime: new Date() });
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(cachedData));
      const result = await securityScanService.checkCachedResults();
      expect(result.vulnerabilityDetails.critical).toHaveLength(1);
    });

    it('should return null when cached results are stale (> 1 hour)', async () => {
      const oldDate = new Date();
      oldDate.setHours(oldDate.getHours() - 2);
      mockFs.stat.mockResolvedValueOnce({ mtime: oldDate });
      const result = await securityScanService.checkCachedResults();
      expect(result).toBeNull();
    });
  });

  describe('saveScanResults', () => {
    it('should save results to file', async () => {
      const results = { status: 'completed', vulnerabilities: { critical: 0, medium: 0, low: 0 } };
      mockFs.mkdir.mockResolvedValueOnce(undefined);
      mockFs.writeFile.mockResolvedValueOnce(undefined);
      await securityScanService.saveScanResults(results);
      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    it('should throw on write error', async () => {
      mockFs.mkdir.mockResolvedValueOnce(undefined);
      mockFs.writeFile.mockRejectedValueOnce(new Error('Disk full'));
      await expect(securityScanService.saveScanResults({ status: 'completed' })).rejects.toThrow('Disk full');
    });
  });

  describe('getLastScanDetails', () => {
    it('should return saved scan details', async () => {
      const scanData = {
        lastScan: '2026-05-26T10:00:00.000Z',
        vulnerabilities: { critical: 1, medium: 2, low: 3 }
      };
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(scanData));
      const result = await securityScanService.getLastScanDetails();
      expect(result.lastScan).toBe('2026-05-26T10:00:00.000Z');
    });

    it('should return defaults when no previous scan', async () => {
      mockFs.readFile.mockRejectedValueOnce(new Error('ENOENT'));
      const result = await securityScanService.getLastScanDetails();
      expect(result.lastScan).toBe('Never');
      expect(result.vulnerabilities.critical).toBe(0);
    });
  });

  describe('checkSecurityHeaders', () => {
    it('should detect missing security headers', async () => {
      mockAxios.get.mockResolvedValueOnce({
        headers: {}
      });
      const result = await securityScanService.checkSecurityHeaders();
      expect(result.length).toBeGreaterThan(0);
      const types = result.map((r) => r.type);
      expect(types).toContain('content_security_policy_header_missing');
      expect(types).toContain('strict_transport_security_header_missing');
    });

    it('should return empty when all headers present', async () => {
      mockAxios.get.mockResolvedValueOnce({
        headers: {
          'content-security-policy': "default-src 'self'",
          'strict-transport-security': 'max-age=31536000',
          'x-content-type-options': 'nosniff',
          'x-frame-options': 'SAMEORIGIN',
          'referrer-policy': 'no-referrer'
        }
      });
      const result = await securityScanService.checkSecurityHeaders();
      expect(result).toEqual([]);
    });

    it('should return empty on request error', async () => {
      mockAxios.get.mockRejectedValueOnce(new Error('Connection refused'));
      const result = await securityScanService.checkSecurityHeaders();
      expect(result).toEqual([]);
    });
  });

  describe('checkServerLeakage', () => {
    it('should detect X-Powered-By header leakage', async () => {
      mockAxios.get.mockResolvedValueOnce({
        headers: {
          'x-powered-by': 'Express'
        }
      });
      const result = await securityScanService.checkServerLeakage();
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].type).toBe('server_leaks_x_powered_by');
    });

    it('should detect server version leakage', async () => {
      mockAxios.get.mockResolvedValueOnce({
        headers: {
          server: 'nginx/1.24.0'
        }
      });
      const result = await securityScanService.checkServerLeakage();
      expect(result.some((r) => r.type === 'server_leaks_version')).toBe(true);
    });

    it('should return empty when no leakage detected', async () => {
      mockAxios.get.mockResolvedValueOnce({
        headers: {
          server: 'nginx'
        }
      });
      const result = await securityScanService.checkServerLeakage();
      expect(result).toEqual([]);
    });

    it('should return empty on error', async () => {
      mockAxios.get.mockRejectedValueOnce(new Error('Timeout'));
      const result = await securityScanService.checkServerLeakage();
      expect(result).toEqual([]);
    });
  });

  describe('checkCorsConfiguration', () => {
    it('should detect wildcard CORS', async () => {
      mockAxios.mockResolvedValueOnce({
        headers: {
          'access-control-allow-origin': '*'
        }
      });
      const result = await securityScanService.checkCorsConfiguration();
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].type).toBe('cross_domain_misconfiguration');
    });

    it('should return empty when CORS is restrictive', async () => {
      mockAxios.mockResolvedValueOnce({
        headers: {
          'access-control-allow-origin': 'https://trusted.domain.com'
        }
      });
      const result = await securityScanService.checkCorsConfiguration();
      expect(result).toEqual([]);
    });

    it('should return empty on error', async () => {
      mockAxios.mockRejectedValueOnce(new Error('Timeout'));
      const result = await securityScanService.checkCorsConfiguration();
      expect(result).toEqual([]);
    });
  });

  describe('checkHiddenFiles', () => {
    it('should detect accessible hidden files', async () => {
      mockAxios.get
        .mockResolvedValueOnce({ status: 200 })
        .mockResolvedValueOnce({ status: 404 })
        .mockResolvedValueOnce({ status: 404 })
        .mockResolvedValueOnce({ status: 404 })
        .mockResolvedValueOnce({ status: 404 })
        .mockResolvedValueOnce({ status: 404 })
        .mockResolvedValueOnce({ status: 404 });

      const result = await securityScanService.checkHiddenFiles();
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].type).toBe('hidden_file_found');
    });

    it('should detect unusual response codes as potential findings', async () => {
      const err = new Error('Forbidden');
      err.response = { status: 403 };
      mockAxios.get
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce({ status: 404 })
        .mockResolvedValueOnce({ status: 404 })
        .mockResolvedValueOnce({ status: 404 })
        .mockResolvedValueOnce({ status: 404 })
        .mockResolvedValueOnce({ status: 404 })
        .mockResolvedValueOnce({ status: 404 });

      const result = await securityScanService.checkHiddenFiles();
      expect(result.some((r) => r.type === 'potential_hidden_file')).toBe(true);
    });

    it('should return empty when all hidden files return 404', async () => {
      const err404 = new Error('Not found');
      err404.response = { status: 404 };
      mockAxios.get
        .mockRejectedValueOnce(err404)
        .mockRejectedValueOnce(err404)
        .mockRejectedValueOnce(err404)
        .mockRejectedValueOnce(err404)
        .mockRejectedValueOnce(err404)
        .mockRejectedValueOnce(err404)
        .mockRejectedValueOnce(err404);

      const result = await securityScanService.checkHiddenFiles();
      expect(result).toEqual([]);
    });
  });

  describe('checkTimestampDisclosure', () => {
    it('should detect Unix timestamps in responses', async () => {
      mockAxios.get
        .mockResolvedValueOnce({ data: { created: 1716710400 } })
        .mockResolvedValueOnce({ data: { safe: 'value' } });

      const result = await securityScanService.checkTimestampDisclosure();
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].type).toBe('timestamp_disclosure');
    });

    it('should return empty when no timestamps found', async () => {
      mockAxios.get
        .mockResolvedValueOnce({ data: { safe: 'value' } })
        .mockResolvedValueOnce({ data: { name: 'test' } });

      const result = await securityScanService.checkTimestampDisclosure();
      expect(result).toEqual([]);
    });

    it('should skip endpoints that fail', async () => {
      mockAxios.get.mockRejectedValueOnce(new Error('Not found')).mockResolvedValueOnce({ data: { safe: 'value' } });

      const result = await securityScanService.checkTimestampDisclosure();
      expect(result).toEqual([]);
    });
  });

  describe('removeDuplicateLogEntries', () => {
    it('should remove duplicate entries by timestamp and message', () => {
      const entries = [
        { timestamp: '2026-05-26T10:00:00Z', message: 'Error A' },
        { timestamp: '2026-05-26T10:00:00Z', message: 'Error A' },
        { timestamp: '2026-05-26T10:01:00Z', message: 'Error B' }
      ];
      const result = securityScanService.removeDuplicateLogEntries(entries);
      expect(result).toHaveLength(2);
    });

    it('should sort entries by timestamp', () => {
      const entries = [
        { timestamp: '2026-05-26T10:01:00Z', message: 'B' },
        { timestamp: '2026-05-26T10:00:00Z', message: 'A' }
      ];
      const result = securityScanService.removeDuplicateLogEntries(entries);
      expect(result[0].message).toBe('A');
      expect(result[1].message).toBe('B');
    });
  });

  describe('deduplicateVulnerabilities', () => {
    it('should deduplicate by type, service, matchedTerm, and timestamp', () => {
      const vulns = {
        critical: [
          { type: 'attack', service: 'http', matchedTerm: 'SQLi', timestamp: '2026-05-26T10:00:00Z' },
          { type: 'attack', service: 'http', matchedTerm: 'SQLi', timestamp: '2026-05-26T10:00:00Z' }
        ],
        medium: [],
        low: []
      };
      const result = securityScanService.deduplicateVulnerabilities(vulns);
      expect(result.critical).toHaveLength(1);
    });
  });

  describe('generateRecommendations', () => {
    it('should generate login recommendations', () => {
      const loginIssues = {
        count: 5,
        details: [{ message: 'login attempt from disabled account' }]
      };
      const result = securityScanService.generateRecommendations(
        loginIssues,
        { count: 0, details: [] },
        { critical: [], medium: [], low: [] }
      );
      expect(result.some((r) => r.title === 'Improve Authentication Security')).toBe(true);
    });

    it('should generate disabled account recommendation', () => {
      const loginIssues = {
        count: 2,
        details: [{ message: 'Account is disabled' }]
      };
      const result = securityScanService.generateRecommendations(
        loginIssues,
        { count: 0, details: [] },
        { critical: [], medium: [], low: [] }
      );
      expect(result.some((r) => r.title === 'Review Disabled Accounts')).toBe(true);
    });

    it('should generate critical vulnerability recommendation', () => {
      const result = securityScanService.generateRecommendations(
        { count: 0, details: [] },
        { count: 0, details: [] },
        { critical: [{ type: 'breach' }], medium: [], low: [] }
      );
      expect(result.some((r) => r.title === 'Fix Critical Server Errors')).toBe(true);
    });

    it('should generate database recommendation', () => {
      const result = securityScanService.generateRecommendations(
        { count: 0, details: [] },
        { count: 0, details: [] },
        { critical: [], medium: [{ type: 'db_error' }], low: [] }
      );
      expect(result.some((r) => r.title === 'Resolve Database Issues')).toBe(true);
    });

    it('should generate CORS recommendation', () => {
      const result = securityScanService.generateRecommendations(
        { count: 0, details: [] },
        { count: 0, details: [] },
        { critical: [], medium: [{ type: 'cross_domain_misconfiguration' }], low: [] }
      );
      expect(result.some((r) => r.title === 'Fix CORS Configuration')).toBe(true);
    });

    it('should generate IP blocking recommendation', () => {
      const result = securityScanService.generateRecommendations(
        { count: 0, details: [] },
        { count: 0, details: [] },
        { critical: [], medium: [{ type: 'ip_blocked' }], low: [] }
      );
      expect(result.some((r) => r.title === 'Review IP Blocking Events')).toBe(true);
    });

    it('should generate 401 recommendation', () => {
      const result = securityScanService.generateRecommendations(
        { count: 0, details: [] },
        { count: 0, details: [] },
        { critical: [], medium: [{ type: 'auth_failure_401' }], low: [] }
      );
      expect(result.some((r) => r.title === 'Address Unauthorized Access Attempts')).toBe(true);
    });

    it('should generate JWT recommendation', () => {
      const result = securityScanService.generateRecommendations(
        { count: 0, details: [] },
        { count: 0, details: [] },
        { critical: [], medium: [{ type: 'jwt_issue' }], low: [] }
      );
      expect(result.some((r) => r.title === 'Fix Authentication Token Issues')).toBe(true);
    });

    it('should generate sensitive file access recommendation', () => {
      const result = securityScanService.generateRecommendations(
        { count: 0, details: [] },
        { count: 0, details: [] },
        { critical: [], medium: [{ type: 'sensitive_file_access' }], low: [] }
      );
      expect(result.some((r) => r.title === 'Secure Sensitive File Access')).toBe(true);
    });

    it('should generate header recommendation', () => {
      const result = securityScanService.generateRecommendations(
        { count: 0, details: [] },
        { count: 0, details: [] },
        { critical: [], medium: [{ type: 'missing_header' }], low: [] }
      );
      expect(result.some((r) => r.title === 'Implement Security Headers')).toBe(true);
    });

    it('should generate leakage recommendation', () => {
      const result = securityScanService.generateRecommendations(
        { count: 0, details: [] },
        { count: 0, details: [] },
        { critical: [], medium: [{ type: 'server_leaks_version' }], low: [] }
      );
      expect(result.some((r) => r.title === 'Prevent Information Leakage')).toBe(true);
    });

    it('should generate low severity recommendations', () => {
      const result = securityScanService.generateRecommendations(
        { count: 0, details: [] },
        { count: 0, details: [] },
        {
          critical: [],
          medium: [],
          low: [
            { type: 'non_critical_file_access' },
            { type: 'not_found_404' },
            { type: 'registration_failure' },
            { type: 'log_limit_exceeded' }
          ]
        }
      );
      expect(result.some((r) => r.title === 'Review Non-Critical File Access')).toBe(true);
      expect(result.some((r) => r.title === 'Fix Missing Resources')).toBe(true);
      expect(result.some((r) => r.title === 'Monitor Registration Attempts')).toBe(true);
      expect(result.some((r) => r.title === 'Optimize Log Processing')).toBe(true);
    });

    it('should always include regular maintenance recommendation', () => {
      const result = securityScanService.generateRecommendations(
        { count: 0, details: [] },
        { count: 0, details: [] },
        { critical: [], medium: [], low: [] }
      );
      expect(result.some((r) => r.title === 'Regular Security Maintenance')).toBe(true);
    });
  });

  describe('scanForVulnerabilities', () => {
    it('should detect missing security headers via HTTP', async () => {
      mockAxios.get.mockResolvedValueOnce({
        headers: {}
      });
      const result = await securityScanService.scanForVulnerabilities();
      expect(result.medium.length).toBeGreaterThan(0);
    });

    it('should return empty on HTTP error', async () => {
      mockAxios.get.mockRejectedValueOnce(new Error('Connection refused'));
      const result = await securityScanService.scanForVulnerabilities();
      expect(result.critical).toEqual([]);
      expect(result.medium).toEqual([]);
      expect(result.low).toEqual([]);
    });
  });

  describe('loginIssues', () => {
    it('should return empty results when logsService.searchLogs returns no logs', async () => {
      const mockLogsService = {
        searchLogs: jest.fn().mockResolvedValue({ logs: [] })
      };
      const result = await securityScanService.loginIssues(mockLogsService);
      expect(result.loginIssues.count).toBe(0);
      expect(result.suspiciousActivities.count).toBe(0);
    });

    it('should categorize login and suspicious issues', async () => {
      const mockLogsService = {
        searchLogs: jest.fn().mockResolvedValue({
          logs: [
            { message: 'Failed login attempt', level: 'ERROR', date: '2026-05-26', time: '10:00:00', service: 'auth' },
            {
              message: 'Suspicious brute force detected',
              level: 'WARN',
              date: '2026-05-26',
              time: '10:01:00',
              service: 'system'
            },
            { message: 'Normal operation', level: 'INFO', date: '2026-05-26', time: '10:02:00', service: 'system' }
          ]
        })
      };
      const result = await securityScanService.loginIssues(mockLogsService);
      expect(result.loginIssues.count).toBe(1);
      expect(result.suspiciousActivities.count).toBe(1);
    });

    it('should throw when logsService is null', async () => {
      await expect(securityScanService.loginIssues(null)).rejects.toThrow('LogsService is required');
    });

    it('should handle searchLogs error gracefully', async () => {
      const mockLogsService = {
        searchLogs: jest.fn().mockRejectedValue(new Error('Search error'))
      };
      const result = await securityScanService.loginIssues(mockLogsService);
      expect(result.loginIssues.count).toBe(0);
      expect(result.suspiciousActivities.count).toBe(0);
    });
  });

  describe('parseLogLine', () => {
    it('should parse standard log format', () => {
      const result = securityScanService.parseLogLine(
        '2026-05-26 10:00:00 [INFO] AuthService User logged in',
        'test.log',
        1,
        null
      );
      expect(result).toBeDefined();
      expect(result.level).toBe('INFO');
      expect(result.service).toContain('AuthService');
    });

    it('should parse JSON log format', () => {
      const jsonLog = JSON.stringify({
        timestamp: '2026-05-26T10:00:00.000Z',
        level: 'ERROR',
        message: 'Connection failed',
        service: 'database'
      });
      const result = securityScanService.parseLogLine(jsonLog, 'test.log', 1, null);
      expect(result).toBeDefined();
      expect(result.level).toBe('ERROR');
    });

    it('should parse fallback format', () => {
      const result = securityScanService.parseLogLine('2026-05-26 10:00:00 Something happened', 'test.log', 1, null);
      expect(result).toBeDefined();
      expect(result.level).toBe('UNKNOWN');
    });

    it('should return null for unrecognizable lines', () => {
      const result = securityScanService.parseLogLine('random text without format', 'test.log', 1, null);
      expect(result).toBeNull();
    });
  });

  describe('checkLogsForIssues', () => {
    it('should return cached results when available', async () => {
      const cachedData = {
        scanTime: new Date().toISOString(),
        vulnerabilities: { critical: 1, medium: 0, low: 0, details: [{ type: 'cached' }] },
        vulnerabilityDetails: {
          critical: [{ type: 'cached' }],
          medium: [],
          low: []
        },
        failedLoginDetails: [],
        suspiciousDetails: [],
        status: 'completed',
        message: 'cached',
        skipped: false,
        reason: null
      };
      mockFs.stat.mockResolvedValueOnce({ mtime: new Date() });
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(cachedData));

      const result = await securityScanService.checkLogsForIssues({});
      expect(result.critical).toHaveLength(1);
    });
  });

  describe('runSecurityScan', () => {
    it('should throw when logsService is null', async () => {
      await expect(securityScanService.runSecurityScan(null)).rejects.toThrow('LogsService is required');
    });

    it('should run full scan and return results', async () => {
      securityScanService.setVictoriaLogsClient({ query: jest.fn().mockResolvedValue([]) });
      mockFs.mkdir.mockResolvedValueOnce(undefined);
      mockFs.writeFile.mockResolvedValueOnce(undefined);
      const result = await securityScanService.runSecurityScan({});
      expect(result.status).toBe('completed');
      expect(result.scanTime).toBeDefined();
      expect(result.vulnerabilities).toBeDefined();
      expect(result.failedLoginDetails).toEqual([]);
      expect(result.suspiciousDetails).toEqual([]);
    });

    it('should save scan results after completion', async () => {
      securityScanService.setVictoriaLogsClient({ query: jest.fn().mockResolvedValue([]) });
      mockFs.mkdir.mockResolvedValueOnce(undefined);
      mockFs.writeFile.mockResolvedValueOnce(undefined);
      await securityScanService.runSecurityScan({});
      expect(mockFs.mkdir).toHaveBeenCalled();
      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    it('should propagate errors from processLogsInParallel', async () => {
      const err = Object.assign(new Error('Log service down'), { code: 'EUNREACHABLE' });
      securityScanService.setVictoriaLogsClient({ query: jest.fn().mockRejectedValue(err) });
      const prevFailOpen = process.env.VL_FAIL_OPEN;
      delete process.env.VL_FAIL_OPEN;
      try {
        await expect(securityScanService.runSecurityScan({})).rejects.toThrow('Log service down');
      } finally {
        if (prevFailOpen !== undefined) process.env.VL_FAIL_OPEN = prevFailOpen;
      }
    });
  });

  describe('setVictoriaLogsClient', () => {
    it('should set the VictoriaLogs client', () => {
      const mockClient = { query: jest.fn() };
      securityScanService.setVictoriaLogsClient(mockClient);
      expect(securityScanService._vlClient).toBe(mockClient);
    });

    it('should make subsequent _getVlClient return the injected client', () => {
      const mockClient = { query: jest.fn() };
      securityScanService.setVictoriaLogsClient(mockClient);
      expect(securityScanService._getVlClient()).toBe(mockClient);
    });

    it('should be idempotent (replace on subsequent calls)', () => {
      const c1 = { query: jest.fn() };
      const c2 = { query: jest.fn() };
      securityScanService.setVictoriaLogsClient(c1);
      securityScanService.setVictoriaLogsClient(c2);
      expect(securityScanService._vlClient).toBe(c2);
    });
  });

  describe('_parseRetentionToMs', () => {
    const parse = (s) => securityScanService._parseRetentionToMs(s);

    it('parses days (d) to ms', () => {
      expect(parse('30d')).toBe(30 * 86400000);
    });

    it('parses hours (h) to ms', () => {
      expect(parse('24h')).toBe(24 * 3600000);
    });

    it('parses minutes (m) to ms', () => {
      expect(parse('60m')).toBe(60 * 60000);
    });

    it('parses seconds (s) to ms', () => {
      expect(parse('90s')).toBe(90000);
    });

    it('returns null for unparseable strings', () => {
      expect(parse('30days')).toBeNull();
      expect(parse('forever')).toBeNull();
      expect(parse('')).toBeNull();
    });

    it('returns null for null/undefined', () => {
      expect(parse(null)).toBeNull();
      expect(parse(undefined)).toBeNull();
    });
  });

  describe('processLogsInParallel (VictoriaLogs bulk query)', () => {
    it('returns empty vulnerabilities when VL returns no rows', async () => {
      securityScanService.setVictoriaLogsClient({ query: jest.fn().mockResolvedValue([]) });
      const result = await securityScanService.processLogsInParallel({});
      expect(result.vulnerabilities).toEqual({ critical: [], medium: [], low: [] });
      expect(result.degraded).toBe(false);
    });

    it('classifies rows into critical via SHA1 bucketing (duplicates collapse)', async () => {
      const row = {
        _time: '2026-05-26T10:00:00Z',
        _msg: 'SQL injection attempt from 1.2.3.4',
        _stream: { service: 'http' }
      };
      securityScanService.setVictoriaLogsClient({
        query: jest.fn().mockResolvedValue([row, row, row])
      });
      const result = await securityScanService.processLogsInParallel({});
      expect(result.vulnerabilities.critical).toHaveLength(1);
      const v = result.vulnerabilities.critical[0];
      expect(v.type).toBe('attack_attempt');
      expect(v.instanceCount).toBe(3);
      expect(v.service).toBe('http');
    });

    it('classifies rows into the correct severity per pattern', async () => {
      const rows = [
        { _time: '2026-05-26T10:00:00Z', _msg: 'SQL injection', _stream: { service: 'http' } },
        { _time: '2026-05-26T10:01:00Z', _msg: 'IP Blocked 5.6.7.8', _stream: { service: 'system' } },
        { _time: '2026-05-26T10:02:00Z', _msg: 'Invalid credentials for foo', _stream: { service: 'auth' } },
        { _time: '2026-05-26T10:03:00Z', _msg: 'GZIPVALIDMARKER nocando', _stream: { service: 'http' } }
      ];
      securityScanService.setVictoriaLogsClient({
        query: jest.fn().mockResolvedValue(rows)
      });
      const result = await securityScanService.processLogsInParallel({});
      expect(result.vulnerabilities.critical).toHaveLength(1);
      expect(result.vulnerabilities.medium).toHaveLength(1);
      expect(result.vulnerabilities.low).toHaveLength(1);
    });

    it('sets degraded:true when rows.length === 100000 (truncation guard)', async () => {
      const rows = Array.from({ length: 100000 }, () => ({
        _time: '2026-05-26T10:00:00Z',
        _msg: 'SQL injection',
        _stream: { service: 'http' }
      }));
      securityScanService.setVictoriaLogsClient({
        query: jest.fn().mockResolvedValue(rows)
      });
      const result = await securityScanService.processLogsInParallel({});
      expect(result.degraded).toBe(true);
    });

    it('passes single LogSQL query with all needles and service:* filter', async () => {
      const queryMock = jest.fn().mockResolvedValue([]);
      securityScanService.setVictoriaLogsClient({ query: queryMock });
      await securityScanService.processLogsInParallel({});
      expect(queryMock).toHaveBeenCalledTimes(1);
      const args = queryMock.mock.calls[0][0];
      expect(args.limit).toBe(100000);
      expect(args.q).toContain('service:*');
      expect(args.q).toContain(' OR ');
      expect(args.q).toContain('SQL injection');
    });

    it('fails-open on VL outage when VL_FAIL_OPEN=true (returns degraded empty result)', async () => {
      const prevFailOpen = process.env.VL_FAIL_OPEN;
      process.env.VL_FAIL_OPEN = '1';
      const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      securityScanService.setVictoriaLogsClient({
        query: jest.fn().mockRejectedValue(err)
      });
      try {
        const result = await securityScanService.processLogsInParallel({});
        expect(result.degraded).toBe(true);
        expect(result.error).toBe('vl_unreachable');
        expect(result.vulnerabilities).toEqual({ critical: [], medium: [], low: [] });
      } finally {
        if (prevFailOpen === undefined) delete process.env.VL_FAIL_OPEN;
        else process.env.VL_FAIL_OPEN = prevFailOpen;
      }
    });

    it('throws when VL outage and VL_FAIL_OPEN is not set', async () => {
      const prevFailOpen = process.env.VL_FAIL_OPEN;
      delete process.env.VL_FAIL_OPEN;
      const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      securityScanService.setVictoriaLogsClient({
        query: jest.fn().mockRejectedValue(err)
      });
      try {
        await expect(securityScanService.processLogsInParallel({})).rejects.toThrow('ECONNREFUSED');
      } finally {
        if (prevFailOpen !== undefined) process.env.VL_FAIL_OPEN = prevFailOpen;
      }
    });

    it('rejects when logsService is missing', async () => {
      await expect(securityScanService.processLogsInParallel(null)).rejects.toThrow('LogsService is required');
    });

    it('caps start to VICTORIALOGS_RETENTION when shorter than 10-day window and degraded=true', async () => {
      const queryMock = jest.fn().mockResolvedValue([]);
      securityScanService.setVictoriaLogsClient({ query: queryMock });
      const prevRetention = process.env.VICTORIALOGS_RETENTION;
      process.env.VICTORIALOGS_RETENTION = '5d';
      try {
        const result = await securityScanService.processLogsInParallel({});
        expect(result.degraded).toBe(true);
        expect(queryMock).toHaveBeenCalledTimes(1);
        const args = queryMock.mock.calls[0][0];
        const startMs = new Date(args.start).getTime();
        const nowMs = Date.now();
        const expectedDelta = 5 * 86400000;
        expect(nowMs - startMs).toBeLessThanOrEqual(expectedDelta + 5000);
        expect(nowMs - startMs).toBeGreaterThan(expectedDelta - 5000);
      } finally {
        if (prevRetention === undefined) delete process.env.VICTORIALOGS_RETENTION;
        else process.env.VICTORIALOGS_RETENTION = prevRetention;
      }
    });
  });

  describe('checkFailedLogins', () => {
    it('should return cached failed logins when available', async () => {
      const cachedData = {
        scanTime: new Date().toISOString(),
        vulnerabilities: { critical: 0, medium: 0, low: 0, details: [] },
        vulnerabilityDetails: { critical: [], medium: [], low: [] },
        failedLoginDetails: [{ timestamp: '2026-05-26', message: 'Failed login' }],
        suspiciousDetails: [],
        status: 'completed',
        message: 'cached',
        skipped: false,
        reason: null
      };
      mockFs.stat.mockResolvedValueOnce({ mtime: new Date() });
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(cachedData));

      const result = await securityScanService.checkFailedLogins({});
      expect(result).toHaveLength(1);
    });
  });

  describe('checkSuspiciousActivities', () => {
    it('should return cached suspicious activities when available', async () => {
      const cachedData = {
        scanTime: new Date().toISOString(),
        vulnerabilities: { critical: 0, medium: 0, low: 0, details: [] },
        vulnerabilityDetails: { critical: [], medium: [], low: [] },
        failedLoginDetails: [],
        suspiciousDetails: [{ timestamp: '2026-05-26', message: 'Suspicious activity' }],
        status: 'completed',
        message: 'cached',
        skipped: false,
        reason: null
      };
      mockFs.stat.mockResolvedValueOnce({ mtime: new Date() });
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(cachedData));

      const result = await securityScanService.checkSuspiciousActivities({});
      expect(result).toHaveLength(1);
    });
  });
});
