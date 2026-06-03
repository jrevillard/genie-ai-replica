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
    },
    dbService: { getConnection: jest.fn() }
  }),
  { virtual: true }
);

jest.mock('arangojs', () => ({
  aql: (strings, ...values) => ({ _aql: true, strings, values })
}));

const mockFs = {
  readFile: jest.fn(),
  access: jest.fn(),
  mkdir: jest.fn(),
  rename: jest.fn(),
  readdir: jest.fn(),
  writeFile: jest.fn(),
  stat: jest.fn(),
  statfs: jest.fn(),
  open: jest.fn()
};

jest.mock('fs', () => ({
  promises: mockFs,
  constants: { R_OK: 4 }
}));

jest.mock('os', () => ({
  uptime: jest.fn().mockReturnValue(2592000),
  cpus: jest.fn().mockReturnValue([{ model: 'Test CPU' }]),
  totalmem: jest.fn().mockReturnValue(16 * 1024 * 1024 * 1024),
  freemem: jest.fn().mockReturnValue(8 * 1024 * 1024 * 1024),
  loadavg: jest.fn().mockReturnValue([1.5]),
  type: jest.fn().mockReturnValue('Linux'),
  platform: jest.fn().mockReturnValue('linux'),
  release: jest.fn().mockReturnValue('5.15.0')
}));

jest.mock('../../services/path-sanitizer', () => ({
  isValidDateStr: jest.fn()
}));

function createMockCursor(results) {
  return {
    next: jest.fn().mockResolvedValue(results.length > 0 ? results[0] : null),
    all: jest.fn().mockResolvedValue(results)
  };
}

function createMockCollection(figures) {
  return {
    all: jest.fn().mockResolvedValue(createMockCursor([])),
    figures: jest.fn().mockResolvedValue(figures || { count: 0, size: 0 }),
    name: 'testCollection'
  };
}

let adminDashboardService;
let mockDb;

beforeEach(() => {
  jest.clearAllMocks();

  mockDb = {
    collection: jest.fn().mockImplementation(() => createMockCollection()),
    collections: jest.fn().mockResolvedValue([]),
    query: jest.fn()
  };

  const { dbService } = require('../../shared-lib');
  dbService.getConnection.mockResolvedValue(mockDb);

  jest.isolateModules(() => {
    adminDashboardService = require('../../services/admin-dashboard-service');
  });
  adminDashboardService.initialized = false;
});

describe('AdminDashboardService', () => {
  describe('init', () => {
    it('should initialize database connection', async () => {
      await adminDashboardService.init();
      expect(adminDashboardService.db).toBe(mockDb);
      expect(adminDashboardService.initialized).toBe(true);
    });

    it('should skip re-initialization', async () => {
      adminDashboardService.initialized = true;
      await adminDashboardService.init();
      const { dbService } = require('../../shared-lib');
      expect(dbService.getConnection).not.toHaveBeenCalled();
    });

    it('should throw on DB connection failure', async () => {
      const { dbService } = require('../../shared-lib');
      dbService.getConnection.mockRejectedValueOnce(new Error('DB down'));
      jest.isolateModules(() => {
        adminDashboardService = require('../../services/admin-dashboard-service');
      });
      adminDashboardService.initialized = false;
      await expect(adminDashboardService.init()).rejects.toThrow('DB down');
    });
  });

  describe('setLogsService / setSecurityScanService', () => {
    it('should set logs service', () => {
      const mockLogsService = { searchLogs: jest.fn() };
      adminDashboardService.setLogsService(mockLogsService);
      expect(adminDashboardService.logsService).toBe(mockLogsService);
    });

    it('should set security scan service', () => {
      const mockScanService = { checkLogsForIssues: jest.fn() };
      adminDashboardService.setSecurityScanService(mockScanService);
      expect(adminDashboardService.securityScanService).toBe(mockScanService);
    });
  });

  describe('checkDatabaseHealth', () => {
    beforeEach(async () => {
      await adminDashboardService.init();
    });

    it('should return true when DB responds', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([1]));
      const result = await adminDashboardService.checkDatabaseHealth();
      expect(result).toBe(true);
    });

    it('should return false when DB fails', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('Connection lost'));
      const result = await adminDashboardService.checkDatabaseHealth();
      expect(result).toBe(false);
    });

    it('should throw when not initialized', async () => {
      adminDashboardService.db = null;
      await expect(adminDashboardService.checkDatabaseHealth()).rejects.toThrow('Database not initialized');
    });
  });

  describe('getDatabaseStats', () => {
    beforeEach(async () => {
      await adminDashboardService.init();
    });

    it('should return collection stats', async () => {
      const mockColl = createMockCollection({ count: 100, size: 5000 });
      mockColl.name = 'users';
      mockDb.collections.mockResolvedValueOnce([mockColl]);

      const result = await adminDashboardService.getDatabaseStats();
      expect(result.totalTables).toBe(1);
      expect(result.collections).toHaveLength(1);
      expect(result.collections[0].name).toBe('users');
      expect(result.collections[0].count).toBe(100);
    });

    it('should throw when not initialized', async () => {
      adminDashboardService.db = null;
      await expect(adminDashboardService.getDatabaseStats()).rejects.toThrow('Database not initialized');
    });

    it('should handle query errors', async () => {
      mockDb.collections.mockRejectedValueOnce(new Error('Query failed'));
      await expect(adminDashboardService.getDatabaseStats()).rejects.toThrow('Query failed');
    });
  });

  describe('getUserStats', () => {
    beforeEach(async () => {
      await adminDashboardService.init();
    });

    it('should return user statistics', async () => {
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([50]))
        .mockResolvedValueOnce(createMockCursor([10]))
        .mockResolvedValueOnce(createMockCursor([5]))
        .mockResolvedValueOnce(
          createMockCursor([
            { _key: 'u1', loginName: 'user1', email: 'u@e.com', fullName: 'User One', roles: ['admin'] }
          ])
        );

      const result = await adminDashboardService.getUserStats();
      expect(result.totalUsers).toBe(50);
      expect(result.activeUsers).toBe(10);
      expect(result.newUsers).toBe(5);
      expect(result.users).toHaveLength(1);
    });

    it('should throw when not initialized', async () => {
      adminDashboardService.db = null;
      await expect(adminDashboardService.getUserStats()).rejects.toThrow('Database not initialized');
    });
  });

  describe('searchUsers', () => {
    beforeEach(async () => {
      await adminDashboardService.init();
    });

    it('should search all fields by default', async () => {
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([1]))
        .mockResolvedValueOnce(
          createMockCursor([{ _key: 'u1', loginName: 'admin', email: 'a@e.com', fullName: 'Admin', roles: [] }])
        );

      const result = await adminDashboardService.searchUsers({ term: 'admin' });
      expect(result.total).toBe(1);
      expect(result.users).toHaveLength(1);
    });

    it('should search by name field', async () => {
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([1]))
        .mockResolvedValueOnce(
          createMockCursor([{ _key: 'u1', loginName: 'user', email: 'u@e.com', fullName: 'User', roles: [] }])
        );

      const result = await adminDashboardService.searchUsers({ term: 'User', field: 'name' });
      expect(result.users).toHaveLength(1);
    });

    it('should search by email field', async () => {
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([1]))
        .mockResolvedValueOnce(
          createMockCursor([{ _key: 'u1', loginName: 'user', email: 'u@e.com', fullName: 'User', roles: [] }])
        );

      const result = await adminDashboardService.searchUsers({ term: 'test@e.com', field: 'email' });
      expect(result.total).toBe(1);
    });

    it('should search by exactEmail field', async () => {
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([1]))
        .mockResolvedValueOnce(
          createMockCursor([{ _key: 'u1', loginName: 'user', email: 'u@e.com', fullName: 'User', roles: [] }])
        );

      const result = await adminDashboardService.searchUsers({ term: 'u@e.com', field: 'exactEmail' });
      expect(result.users).toHaveLength(1);
    });

    it('should search by role field', async () => {
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([2]))
        .mockResolvedValueOnce(
          createMockCursor([
            { _key: 'u1', loginName: 'admin1', email: 'a1@e.com', fullName: 'Admin One', roles: ['admin'] }
          ])
        );

      const result = await adminDashboardService.searchUsers({ term: 'admin', field: 'role' });
      expect(result.total).toBe(2);
    });

    it('should return all users when no search term', async () => {
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([3]))
        .mockResolvedValueOnce(
          createMockCursor([{ _key: 'u1', loginName: 'user1', email: 'u@e.com', fullName: 'User', roles: [] }])
        );

      const result = await adminDashboardService.searchUsers({ term: '' });
      expect(result.total).toBe(3);
    });

    it('should respect limit and offset', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([100])).mockResolvedValueOnce(createMockCursor([]));

      const result = await adminDashboardService.searchUsers({ limit: '10', offset: '20' });
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(20);
    });

    it('should throw when not initialized', async () => {
      adminDashboardService.db = null;
      await expect(adminDashboardService.searchUsers()).rejects.toThrow('Database not initialized');
    });
  });

  describe('getLogs', () => {
    const sampleLogContent = [
      '[2026-05-26T10:00:00.000Z] [INFO] [AuthService] User logged in',
      '[2026-05-26T10:01:00.000Z] [ERROR] [DatabaseService] Connection failed',
      ''
    ].join('\n');

    it('should read today logs by default', async () => {
      mockFs.readFile.mockResolvedValueOnce(sampleLogContent);
      const result = await adminDashboardService.getLogs();
      expect(result.logs.length).toBeGreaterThan(0);
      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('limit', 100);
    });

    it('should filter by level', async () => {
      mockFs.readFile.mockResolvedValueOnce(sampleLogContent);
      const result = await adminDashboardService.getLogs({ level: 'error' });
      expect(result.logs.every((log) => log.level === 'ERROR')).toBe(true);
    });

    it('should filter by service', async () => {
      mockFs.readFile.mockResolvedValueOnce(sampleLogContent);
      const result = await adminDashboardService.getLogs({ service: 'auth' });
      expect(result.logs.every((log) => log.service.toLowerCase().includes('auth'))).toBe(true);
    });

    it('should handle yesterday dateRange', async () => {
      mockFs.readFile.mockResolvedValueOnce(sampleLogContent);
      const result = await adminDashboardService.getLogs({ dateRange: 'yesterday' });
      expect(result).toHaveProperty('logs');
    });

    it('should handle week dateRange', async () => {
      mockFs.readFile.mockResolvedValue(sampleLogContent);
      const result = await adminDashboardService.getLogs({ dateRange: 'week' });
      expect(result).toHaveProperty('logs');
    });

    it('should handle month dateRange', async () => {
      mockFs.readFile.mockResolvedValue(sampleLogContent);
      const result = await adminDashboardService.getLogs({ dateRange: 'month' });
      expect(result).toHaveProperty('logs');
    });

    it('should handle custom dateRange with valid dates', async () => {
      const { isValidDateStr } = require('../../services/path-sanitizer');
      isValidDateStr.mockReturnValue(true);
      mockFs.readFile.mockResolvedValue(sampleLogContent);
      const result = await adminDashboardService.getLogs({
        dateRange: 'custom',
        startDate: '2026-05-20',
        endDate: '2026-05-26'
      });
      expect(result).toHaveProperty('logs');
    });

    it('should return empty for invalid custom dates', async () => {
      const { isValidDateStr } = require('../../services/path-sanitizer');
      isValidDateStr.mockReturnValue(false);
      const result = await adminDashboardService.getLogs({
        dateRange: 'custom',
        startDate: 'invalid',
        endDate: 'invalid'
      });
      expect(result.logs).toEqual([]);
      expect(result.totalLogs).toBe(0);
    });

    it('should handle file read errors gracefully', async () => {
      mockFs.readFile.mockRejectedValueOnce(new Error('ENOENT'));
      const result = await adminDashboardService.getLogs({ dateRange: 'today' });
      expect(result.logs).toEqual([]);
    });

    it('should respect limit option', async () => {
      const manyLogs = Array(200).fill('[2026-05-26T10:00:00.000Z] [INFO] [TestService] Message').join('\n');
      mockFs.readFile.mockResolvedValueOnce(manyLogs);
      const result = await adminDashboardService.getLogs({ limit: 5 });
      expect(result.logs.length).toBeLessThanOrEqual(5);
    });
  });

  describe('rolloverLogs', () => {
    it('should rename existing log file', async () => {
      mockFs.access.mockResolvedValueOnce(undefined);
      mockFs.rename.mockResolvedValueOnce(undefined);
      const result = await adminDashboardService.rolloverLogs();
      expect(result.status).toBe('success');
      expect(mockFs.rename).toHaveBeenCalled();
    });

    it('should handle missing log file gracefully', async () => {
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      mockFs.access.mockRejectedValueOnce(err);
      const result = await adminDashboardService.rolloverLogs();
      expect(result.status).toBe('success');
    });

    it('should re-throw non-ENOENT access errors', async () => {
      mockFs.access.mockRejectedValueOnce(new Error('Permission denied'));
      await expect(adminDashboardService.rolloverLogs()).rejects.toThrow('Permission denied');
    });
  });

  describe('debugYesterdayLogs', () => {
    it('should return debug and error logs from yesterday', async () => {
      const logContent = [
        '[2026-05-25T10:00:00.000Z] [DEBUG] [TestService] Debug message',
        '[2026-05-25T10:01:00.000Z] [ERROR] [TestService] Error message',
        '[2026-05-25T10:02:00.000Z] [INFO] [TestService] Info message'
      ].join('\n');
      mockFs.readFile.mockResolvedValueOnce(logContent);
      const result = await adminDashboardService.debugYesterdayLogs();
      expect(result.logs).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should handle missing log file', async () => {
      mockFs.readFile.mockRejectedValueOnce(new Error('ENOENT'));
      const result = await adminDashboardService.debugYesterdayLogs();
      expect(result.logs).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('getSecurityMetrics', () => {
    it('should return security metrics with vulnerabilities', async () => {
      const mockScanService = {
        checkLogsForIssues: jest.fn().mockResolvedValue({
          critical: [{ type: 'breach', message: 'Security breach', timestamp: '2026-05-26T00:00:00Z' }],
          medium: [{ type: 'auth', message: 'Auth failure', timestamp: '2026-05-26T00:00:00Z' }],
          low: [{ type: 'failed_login', message: 'Failed login', timestamp: '2026-05-26T00:00:00Z' }]
        })
      };
      adminDashboardService.setSecurityScanService(mockScanService);
      adminDashboardService.logsService = {};

      const result = await adminDashboardService.getSecurityMetrics();
      expect(result.vulnerabilities.critical).toBe(1);
      expect(result.vulnerabilities.medium).toBe(1);
      expect(result.vulnerabilities.low).toBe(1);
      expect(result.failedLoginDetails).toHaveLength(1);
      expect(result.suspiciousDetails).toHaveLength(1);
    });

    it('should return safe defaults when securityScanService is not set', async () => {
      const result = await adminDashboardService.getSecurityMetrics();
      expect(result.lastScan).toBe('Never');
      expect(result.vulnerabilities.critical).toBe(0);
      expect(result.vulnerabilities.medium).toBe(0);
      expect(result.vulnerabilities.low).toBe(0);
    });

    it('should return safe defaults on error', async () => {
      const mockScanService = {
        checkLogsForIssues: jest.fn().mockRejectedValue(new Error('Scan failed'))
      };
      adminDashboardService.setSecurityScanService(mockScanService);
      adminDashboardService.logsService = {};

      const result = await adminDashboardService.getSecurityMetrics();
      expect(result.lastScan).toBe('Never');
      expect(result.vulnerabilities.critical).toBe(0);
    });
  });

  describe('runDiagnostics', () => {
    it('should return system info, disk space, and network checks', async () => {
      await adminDashboardService.init();
      mockDb.query.mockResolvedValueOnce(createMockCursor([1]));
      mockFs.statfs.mockResolvedValueOnce({
        blocks: 1000000,
        bsize: 4096,
        bavail: 500000
      });

      const result = await adminDashboardService.runDiagnostics();
      expect(result.systemInfo).toBeDefined();
      expect(result.systemInfo.os.type).toBe('Linux');
      expect(result.systemInfo.memory).toBeDefined();
      expect(result.systemInfo.cpu.cores).toBe(1);
      expect(result.diskSpace).toContain('Filesystem /');
      expect(result.networkChecks).toHaveLength(4);
    });

    it('should handle statfs error', async () => {
      await adminDashboardService.init();
      mockDb.query.mockResolvedValueOnce(createMockCursor([1]));
      mockFs.statfs.mockRejectedValueOnce(new Error('Not available'));
      const result = await adminDashboardService.runDiagnostics();
      expect(result.diskSpace).toBe('Unable to fetch disk space information');
    });

    it('should handle DB health check failure in diagnostics', async () => {
      await adminDashboardService.init();
      mockDb.query.mockRejectedValueOnce(new Error('DB down'));
      mockFs.statfs.mockResolvedValueOnce({
        blocks: 1000000,
        bsize: 4096,
        bavail: 500000
      });

      const result = await adminDashboardService.runDiagnostics();
      const dbCheck = result.networkChecks.find((c) => c.service === 'Database');
      expect(dbCheck.status).toBe('error');
    });
  });

  describe('backupDatabase', () => {
    beforeEach(async () => {
      await adminDashboardService.init();
    });

    it('should backup all collections', async () => {
      const mockColl = createMockCollection({ count: 10, size: 500 });
      mockColl.name = 'users';
      const cursorMock = createMockCursor([{ _key: 'u1' }]);
      mockColl.all = jest.fn().mockResolvedValue(cursorMock);
      mockDb.collections.mockResolvedValueOnce([mockColl]);
      mockFs.mkdir.mockResolvedValueOnce(undefined);
      mockFs.writeFile.mockResolvedValueOnce(undefined);

      const result = await adminDashboardService.backupDatabase();
      expect(result.status).toBe('success');
      expect(result.collections).toContain('users');
      expect(result.documentCount).toBe(1);
    });

    it('should throw when not initialized', async () => {
      adminDashboardService.db = null;
      await expect(adminDashboardService.backupDatabase()).rejects.toThrow('Database not initialized');
    });

    it('should skip collections that fail to export', async () => {
      const mockColl = createMockCollection({ count: 0, size: 0 });
      mockColl.name = 'broken';
      mockColl.all.mockRejectedValueOnce(new Error('Cannot read'));
      mockDb.collections.mockResolvedValueOnce([mockColl]);
      mockFs.mkdir.mockResolvedValueOnce(undefined);
      mockFs.writeFile.mockResolvedValueOnce(undefined);

      const result = await adminDashboardService.backupDatabase();
      expect(result.status).toBe('success');
      expect(result.documentCount).toBe(0);
    });
  });

  describe('optimizeDatabase', () => {
    beforeEach(async () => {
      await adminDashboardService.init();
    });

    it('should optimize all collections', async () => {
      const mockColl = createMockCollection({ count: 10, size: 500 });
      mockColl.name = 'users';
      mockDb.collections.mockResolvedValueOnce([mockColl]);
      mockDb.query.mockResolvedValueOnce(createMockCursor([]));

      const result = await adminDashboardService.optimizeDatabase();
      expect(result.status).toBe('success');
      expect(result.timestamp).toBeDefined();
    });

    it('should throw when not initialized', async () => {
      adminDashboardService.db = null;
      await expect(adminDashboardService.optimizeDatabase()).rejects.toThrow('Database not initialized');
    });
  });

  describe('runSecurityScan', () => {
    it('should scan log files for vulnerabilities', async () => {
      const logContent = [
        '[ERROR] security breach detected',
        '[ERROR] SQL injection attempt',
        '[WARN] invalid token detected',
        '[INFO] login attempt from unknown IP',
        ''
      ].join('\n');
      mockFs.readdir.mockResolvedValueOnce(['combined-2026-05-26.log']);
      mockFs.readFile.mockResolvedValueOnce(logContent);

      const result = await adminDashboardService.runSecurityScan();
      expect(result.status).toBe('completed');
      expect(result.vulnerabilities).toBeDefined();
    });

    it('should handle empty logs directory', async () => {
      mockFs.readdir.mockResolvedValueOnce([]);
      const result = await adminDashboardService.runSecurityScan();
      expect(result.status).toBe('completed');
    });

    it('should handle unreadable log files', async () => {
      mockFs.readdir.mockResolvedValueOnce(['combined-2026-05-26.log']);
      mockFs.readFile.mockRejectedValueOnce(new Error('ENOENT'));
      const result = await adminDashboardService.runSecurityScan();
      expect(result.status).toBe('completed');
    });
  });

  describe('storeAnalyticsData', () => {
    beforeEach(async () => {
      await adminDashboardService.init();
    });

    it('should insert new analytics record', async () => {
      mockDb.query.mockResolvedValueOnce(createMockCursor([])).mockResolvedValueOnce(createMockCursor([]));

      await adminDashboardService.storeAnalyticsData({
        period: 'daily',
        startDate: '2026-05-26T00:00:00Z'
      });
      expect(mockDb.query).toHaveBeenCalledTimes(2);
    });

    it('should update existing analytics record', async () => {
      mockDb.query
        .mockResolvedValueOnce(createMockCursor([{ _key: 'existing-1' }]))
        .mockResolvedValueOnce(createMockCursor([]));

      await adminDashboardService.storeAnalyticsData({
        period: 'daily',
        startDate: '2026-05-26T00:00:00Z'
      });
      expect(mockDb.query).toHaveBeenCalledTimes(2);
    });

    it('should handle errors silently', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('DB error'));
      await expect(
        adminDashboardService.storeAnalyticsData({ period: 'daily', startDate: '2026-05-26' })
      ).resolves.toBeUndefined();
    });

    it('should throw when not initialized', async () => {
      adminDashboardService.db = null;
      await expect(adminDashboardService.storeAnalyticsData({ period: 'daily' })).rejects.toThrow(
        'Database not initialized'
      );
    });
  });

  describe('formatTimeAgo', () => {
    it('should return Today for same day', () => {
      const today = new Date();
      expect(adminDashboardService.formatTimeAgo(today)).toBe('Today');
    });

    it('should return 1 day ago', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      expect(adminDashboardService.formatTimeAgo(yesterday)).toBe('1 day ago');
    });

    it('should return N days ago', () => {
      const fiveDaysAgo = new Date();
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
      expect(adminDashboardService.formatTimeAgo(fiveDaysAgo)).toBe('5 days ago');
    });
  });

  describe('getLogsSummary', () => {
    it('should delegate to logsService', async () => {
      const mockLogsService = {
        getLogsSummary: jest.fn().mockResolvedValue({ errors: [], warnings: [], date: '2026-05-26' })
      };
      adminDashboardService.setLogsService(mockLogsService);
      const result = await adminDashboardService.getLogsSummary({ date: '2026-05-26' });
      expect(mockLogsService.getLogsSummary).toHaveBeenCalledWith({ date: '2026-05-26' });
      expect(result.errors).toEqual([]);
    });
  });

  describe('searchLogs', () => {
    it('should delegate to logsService', async () => {
      const mockLogsService = {
        searchLogs: jest.fn().mockResolvedValue({ logs: [], total: 0 })
      };
      adminDashboardService.setLogsService(mockLogsService);
      const result = await adminDashboardService.searchLogs({ term: 'error' });
      expect(mockLogsService.searchLogs).toHaveBeenCalledWith({ term: 'error' });
      expect(result.logs).toEqual([]);
    });

    it('should throw when logsService not set', async () => {
      await expect(adminDashboardService.searchLogs()).rejects.toThrow('LogsService not initialized');
    });

    it('should propagate logsService errors', async () => {
      const mockLogsService = {
        searchLogs: jest.fn().mockRejectedValue(new Error('Search failed'))
      };
      adminDashboardService.setLogsService(mockLogsService);
      await expect(adminDashboardService.searchLogs()).rejects.toThrow('Search failed');
    });
  });

  describe('refreshResourceUsage', () => {
    it('should return resource usage object', async () => {
      const result = await adminDashboardService.refreshResourceUsage();
      expect(result).toHaveProperty('cpu');
      expect(result).toHaveProperty('memory');
      expect(result).toHaveProperty('storage');
      expect(result).toHaveProperty('network');
    });
  });

  describe('getSystemHealth', () => {
    beforeEach(async () => {
      await adminDashboardService.init();
    });

    it('should throw when not initialized', async () => {
      adminDashboardService.db = null;
      await expect(adminDashboardService.getSystemHealth()).rejects.toThrow('Database not initialized');
    });

    it('should return health metrics and trends', async () => {
      const logContent = '[INFO] normal log\n[ERROR] error log\n';
      mockFs.readFile.mockResolvedValueOnce(logContent);

      mockDb.query
        .mockResolvedValueOnce(createMockCursor(['user1', 'user2']))
        .mockResolvedValueOnce(createMockCursor([{ uptime: 99.5 }]))
        .mockResolvedValueOnce(createMockCursor([]))
        .mockResolvedValueOnce(createMockCursor(['user1']))
        .mockResolvedValueOnce(createMockCursor([{ avgTime: 150, count: 10 }]))
        .mockResolvedValueOnce(createMockCursor([100]))
        .mockResolvedValueOnce(createMockCursor([2.5]))
        .mockResolvedValueOnce(createMockCursor([]))
        .mockResolvedValueOnce(createMockCursor([]));

      mockFs.statfs.mockResolvedValueOnce({
        blocks: 1000000,
        bsize: 4096,
        bavail: 500000
      });

      const result = await adminDashboardService.getSystemHealth();
      expect(result.metrics).toBeDefined();
      expect(result.metrics.systemUptime).toBeDefined();
      expect(result.metrics.monthlyActiveUsers).toBe(2);
      expect(result.trends).toBeDefined();
      expect(result.resourceUsage).toBeDefined();
      expect(result.healthServices).toHaveLength(6);
    });

    it('should handle log file read errors', async () => {
      mockFs.readFile.mockRejectedValueOnce(new Error('ENOENT'));

      mockDb.query
        .mockResolvedValueOnce(createMockCursor([]))
        .mockResolvedValueOnce(createMockCursor([]))
        .mockResolvedValueOnce(createMockCursor([]))
        .mockResolvedValueOnce(createMockCursor([]))
        .mockResolvedValueOnce(createMockCursor([{ avgTime: 0, count: 0 }]))
        .mockResolvedValueOnce(createMockCursor([]))
        .mockResolvedValueOnce(createMockCursor([]))
        .mockResolvedValueOnce(createMockCursor([]))
        .mockResolvedValueOnce(createMockCursor([]));

      mockFs.statfs.mockResolvedValueOnce({
        blocks: 1000000,
        bsize: 4096,
        bavail: 500000
      });

      const result = await adminDashboardService.getSystemHealth();
      expect(result.metrics.errorRate).toBe(0);
    });
  });
});
