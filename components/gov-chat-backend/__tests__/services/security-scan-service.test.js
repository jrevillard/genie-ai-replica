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
        toFormat: jest.fn().mockReturnValue('2026-05-16')
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

jest.mock('worker_threads', () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    postMessage: jest.fn()
  })),
  isMainThread: true,
  parentPort: null,
  workerData: null
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
        vulnerabilityDetails: {
          critical: [{ type: 'breach' }],
          medium: [],
          low: []
        }
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
        vulnerabilityDetails: {
          critical: [{ type: 'cached' }],
          medium: [],
          low: []
        }
      };
      mockFs.stat.mockResolvedValueOnce({ mtime: new Date() });
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(cachedData));

      const result = await securityScanService.checkLogsForIssues({});
      expect(result.critical).toHaveLength(1);
    });
  });

  describe('checkFailedLogins', () => {
    it('should return cached failed logins when available', async () => {
      const cachedData = {
        failedLoginDetails: [{ timestamp: '2026-05-26', message: 'Failed login' }],
        vulnerabilityDetails: { critical: [], medium: [], low: [] }
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
        suspiciousDetails: [{ timestamp: '2026-05-26', message: 'Suspicious activity' }],
        vulnerabilityDetails: { critical: [], medium: [], low: [] }
      };
      mockFs.stat.mockResolvedValueOnce({ mtime: new Date() });
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(cachedData));

      const result = await securityScanService.checkSuspiciousActivities({});
      expect(result).toHaveLength(1);
    });
  });
});
