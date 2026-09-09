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

describe('SecurityScanService VL bulk behaviour (P3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('normalized VL row compat', () => {
    it('classifies a normalized SQL injection row into critical (attack_attempt)', async () => {
      const normalizedRow = {
        timestamp: '2026-05-26T10:00:00.000Z',
        message: 'SQL injection attempt from 1.2.3.4',
        stream: { service: 'http', environment: 'prod' },
        level: 'WARN',
        service: 'http',
        fields: {},
        date: '2026-05-26',
        time: '10:00:00'
      };
      securityScanService.setVictoriaLogsClient({
        query: jest.fn().mockResolvedValue([normalizedRow])
      });
      const result = await securityScanService.processLogsInParallel({});
      expect(result.vulnerabilities.critical).toHaveLength(1);
      const v = result.vulnerabilities.critical[0];
      expect(v.type).toBe('attack_attempt');
      expect(v.service).toBe('http');
      expect(v.instanceCount).toBe(1);
      expect(v.firstSeen).toBe('2026-05-26T10:00:00.000Z');
    });

    it('classifies a normalized XSS row via pattern regex', async () => {
      const row = {
        timestamp: '2026-05-26T11:00:00.000Z',
        message: 'Possible XSS attempt blocked',
        stream: { service: 'http' },
        level: 'ERROR'
      };
      securityScanService.setVictoriaLogsClient({ query: jest.fn().mockResolvedValue([row]) });
      const result = await securityScanService.processLogsInParallel({});
      expect(result.vulnerabilities.critical).toHaveLength(1);
      expect(result.vulnerabilities.critical[0].type).toBe('attack_attempt');
    });

    it('produces the same bucket key for wire and normalized shapes when fields match', async () => {
      const wireRow = {
        _time: '2026-05-26T10:00:00.000Z',
        _msg: 'SQL injection attempt',
        _stream: { service: 'http' }
      };
      const normalizedRow = {
        timestamp: '2026-05-26T10:00:00.000Z',
        message: 'SQL injection attempt',
        stream: { service: 'http' },
        service: 'http',
        level: 'INFO'
      };
      securityScanService.setVictoriaLogsClient({
        query: jest.fn().mockResolvedValue([wireRow, normalizedRow])
      });
      const result = await securityScanService.processLogsInParallel({});
      expect(result.vulnerabilities.critical).toHaveLength(1);
      expect(result.vulnerabilities.critical[0].instanceCount).toBe(2);
    });
  });

  describe('one-query shape', () => {
    it('issues exactly one VL query per scan regardless of row count', async () => {
      const queryMock = jest.fn().mockResolvedValue([]);
      securityScanService.setVictoriaLogsClient({ query: queryMock });
      await securityScanService.processLogsInParallel({});
      expect(queryMock).toHaveBeenCalledTimes(1);
    });

    it('passes a single OR-joined LogSQL `q` with service:* filter and limit 100000', async () => {
      const queryMock = jest.fn().mockResolvedValue([]);
      securityScanService.setVictoriaLogsClient({ query: queryMock });
      await securityScanService.processLogsInParallel({});
      const args = queryMock.mock.calls[0][0];
      expect(args.q).toContain('service:*');
      expect(args.q).toContain(' OR ');
      expect(args.q).toMatch(/^\(/);
      expect(args.q).toContain('SQL injection');
      expect(args.limit).toBe(100000);
      expect(typeof args.start).toBe('string');
      expect(typeof args.end).toBe('string');
    });
  });

  describe('output shape parity', () => {
    it('returns {vulnerabilities, failedLogins, suspiciousActivities, degraded, error}', async () => {
      securityScanService.setVictoriaLogsClient({ query: jest.fn().mockResolvedValue([]) });
      const result = await securityScanService.processLogsInParallel({});
      expect(Array.isArray(result.vulnerabilities.critical)).toBe(true);
      expect(Array.isArray(result.vulnerabilities.medium)).toBe(true);
      expect(Array.isArray(result.vulnerabilities.low)).toBe(true);
      expect(Array.isArray(result.failedLogins)).toBe(true);
      expect(Array.isArray(result.suspiciousActivities)).toBe(true);
      expect(typeof result.degraded).toBe('boolean');
      expect(result.error).toBeNull();
    });

    it('populates failedLogins from rows matching /Invalid credentials|failed login/i', async () => {
      const rows = [
        {
          _time: '2026-05-26T10:00:00Z',
          _msg: 'Invalid credentials for user foo',
          _stream: { service: 'auth', level: 'WARN' },
          fields: { level: 'WARN' }
        },
        {
          _time: '2026-05-26T10:01:00Z',
          _msg: 'failed login attempt from 5.6.7.8',
          _stream: { service: 'auth', level: 'ERROR' },
          fields: { level: 'ERROR' }
        },
        {
          _time: '2026-05-26T10:02:00Z',
          _msg: 'SQL injection attempt',
          _stream: { service: 'http' }
        }
      ];
      securityScanService.setVictoriaLogsClient({ query: jest.fn().mockResolvedValue(rows) });
      const result = await securityScanService.processLogsInParallel({});
      expect(result.failedLogins).toHaveLength(2);
      expect(result.failedLogins[0]).toMatchObject({
        timestamp: '2026-05-26T10:00:00Z',
        level: 'WARN',
        message: 'Invalid credentials for user foo',
        service: 'auth'
      });
      expect(result.failedLogins[1].timestamp).toBe('2026-05-26T10:01:00Z');
    });

    it('populates suspiciousActivities from rows matching the suspicious regex', async () => {
      const rows = [
        {
          _time: '2026-05-26T10:00:00Z',
          _msg: 'SQL injection attempt',
          _stream: { service: 'http' }
        },
        {
          _time: '2026-05-26T10:01:00Z',
          _msg: 'XSS payload blocked',
          _stream: { service: 'http' }
        },
        {
          _time: '2026-05-26T10:02:00Z',
          _msg: 'IP blocked due to brute force',
          _stream: { service: 'system' }
        },
        {
          _time: '2026-05-26T10:03:00Z',
          _msg: 'threat detection triggered',
          _stream: { service: 'system' }
        },
        {
          _time: '2026-05-26T10:04:00Z',
          _msg: 'Generic INFO log entry',
          _stream: { service: 'system' }
        }
      ];
      securityScanService.setVictoriaLogsClient({ query: jest.fn().mockResolvedValue(rows) });
      const result = await securityScanService.processLogsInParallel({});
      expect(result.suspiciousActivities).toHaveLength(4);
      expect(result.suspiciousActivities.map((r) => r.message)).toEqual([
        'SQL injection attempt',
        'XSS payload blocked',
        'IP blocked due to brute force',
        'threat detection triggered'
      ]);
    });

    it('deduplicates failedLogins and suspiciousActivities via removeDuplicateLogEntries', async () => {
      const dup = {
        _time: '2026-05-26T10:00:00Z',
        _msg: 'Invalid credentials',
        _stream: { service: 'auth' }
      };
      securityScanService.setVictoriaLogsClient({
        query: jest.fn().mockResolvedValue([dup, dup, dup])
      });
      const result = await securityScanService.processLogsInParallel({});
      expect(result.failedLogins).toHaveLength(1);
      expect(result.suspiciousActivities).toHaveLength(0);
    });

    it('preserves faithful matchedTerm and url on vulnerability entries', async () => {
      const row = {
        _time: '2026-05-26T10:00:00Z',
        _msg: 'SQL injection on https://api.example.com/v1/users',
        _stream: { service: 'http' }
      };
      securityScanService.setVictoriaLogsClient({ query: jest.fn().mockResolvedValue([row]) });
      const result = await securityScanService.processLogsInParallel({});
      const v = result.vulnerabilities.critical[0];
      expect(v.matchedTerm).toBe(VULN_REGEX_SOURCE);
      expect(v.url).toBe('https://api.example.com/v1/users');
    });
  });

  describe('7-day bulk scan performance', () => {
    it('completes a 7-day bulk scan with a deterministic mock under 2 seconds', async () => {
      const N = 5000;
      const rows = Array.from({ length: N }, (_, i) => ({
        _time: new Date(Date.now() - (i % 7) * 86400000).toISOString(),
        _msg: i % 3 === 0 ? 'SQL injection attempt' : i % 3 === 1 ? 'IP blocked' : 'Invalid credentials',
        _stream: { service: i % 5 === 0 ? 'http' : 'auth' }
      }));
      const queryMock = jest.fn().mockResolvedValue(rows);
      securityScanService.setVictoriaLogsClient({ query: queryMock });
      const start = Date.now();
      const result = await securityScanService.processLogsInParallel({});
      const elapsedMs = Date.now() - start;
      expect(elapsedMs).toBeLessThan(2000);
      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(
        result.vulnerabilities.critical.length +
          result.vulnerabilities.medium.length +
          result.vulnerabilities.low.length
      ).toBeGreaterThan(0);
    });
  });
});

const VULN_REGEX_SOURCE = /SQL injection|XSS|CSRF/i.source;
