'use strict';

require('../setup-env');

// Mock shared-lib — virtual because it only exists after Docker packaging
jest.mock('../../shared-lib', () => require('../mocks/shared-lib'), { virtual: true });

// Mock keycloak-auth-service (used by middleware)
jest.mock('../../services/keycloak-auth-service', () => ({
  verifyToken: jest.fn(),
  checkUserStatusInKeycloak: jest.fn()
}));

// Mock user-provisioning-service (used by middleware)
jest.mock('../../services/user-provisioning-service', () => ({
  provisionUser: jest.fn(),
  initialize: jest.fn(),
  markUserAsDeleted: jest.fn()
}));

// Mock session-service singleton (loaded by index.js)
jest.mock('../../services/session-service', () => ({
  getUserSessions: jest.fn(),
  endSession: jest.fn(),
  createSession: jest.fn()
}));

// Mock adminDashboardService with ALL methods validated by route constructor
jest.mock('../../services/admin-dashboard-service', () => ({
  getSystemHealth: jest.fn(),
  getDatabaseStats: jest.fn(),
  getLogs: jest.fn(),
  rolloverLogs: jest.fn(),
  getUserStats: jest.fn(),
  searchLogs: jest.fn(),
  debugYesterdayLogs: jest.fn(),
  backupDatabase: jest.fn(),
  optimizeDatabase: jest.fn(),
  searchUsers: jest.fn(),
  runDiagnostics: jest.fn()
}));

// Mock logsService
jest.mock('../../services/logs-service', () => ({
  getLogsSummary: jest.fn()
}));

// Mock securityScanService (imported directly by admin-routes.js)
jest.mock('../../services/security-scan-service', () => ({
  getLastScanDetails: jest.fn(),
  runSecurityScan: jest.fn()
}));

// Mock swagger dependencies
jest.mock('swagger-jsdoc', () => () => ({
  openapi: '3.0.0',
  info: {},
  components: {},
  security: []
}), { virtual: true });
jest.mock('swagger-ui-express', () => ({
  serve: [],
  setup: () => (req, res, next) => next()
}), { virtual: true });

// Mock all other services loaded by index.js
jest.mock('../../services/user-profile-service', () => ({}));
jest.mock('../../services/analytics-service', () => ({}));
jest.mock('../../services/query-service', () => ({}));
jest.mock('../../services/chat-history-service', () => ({}));
jest.mock('../../services/service-category-service', () => ({}));
jest.mock('../../services/database-operations-service', () => ({}));
jest.mock('../../services/weather-service', () => ({}));
jest.mock('../../services/translation-service', () => ({}));

// Mock keycloak-auth-middleware — allow pass-through, override for 401/403 tests
jest.mock('../../middleware/keycloak-auth-middleware', () => ({
  keycloakAuthMiddleware: {
    authenticate: jest.fn((req, res, next) => next()),
    requireAdmin: jest.fn((req, res, next) => next())
  }
}));

// Prevent process.exit during tests
const originalExit = process.exit;
beforeAll(() => {
  process.exit = jest.fn();
});
afterAll(() => {
  process.exit = originalExit;
});

const { createApp } = require('../../index');
const request = require('supertest');
const { createValidToken } = require('../fixtures/tokens');

// Get references to mocked modules
const { keycloakAuthMiddleware } = require('../../middleware/keycloak-auth-middleware');
const adminService = require('../../services/admin-dashboard-service');
const logsService = require('../../services/logs-service');
const securityScanService = require('../../services/security-scan-service');

const validToken = createValidToken();

// Create app once for all tests
let app;
beforeAll(() => {
  app = createApp({ services: { adminDashboardService: adminService, logsService } });
});

beforeEach(() => {
  jest.clearAllMocks();

  // Default: middleware passes through
  keycloakAuthMiddleware.authenticate.mockImplementation((req, res, next) => next());
  keycloakAuthMiddleware.requireAdmin.mockImplementation((req, res, next) => next());
});

// Helpers for authenticated requests
function authGet(path) {
  return request(app).get(path).set('Authorization', `Bearer ${validToken}`);
}
function authPost(path, body) {
  return request(app).post(path).set('Authorization', `Bearer ${validToken}`).send(body);
}

// ============================================================
// AC1: Auth guard — all admin routes require authentication + admin role
// ============================================================
describe('AC1: Auth guard', () => {
  it('should return 401 on GET /api/admin/system-health without token', async () => {
    keycloakAuthMiddleware.authenticate.mockImplementation((req, res) => {
      res.status(401).json({ error: 'TOKEN_INVALID', message: 'Authentication required' });
    });

    const response = await request(app).get('/api/admin/system-health');
    expect(response.status).toBe(401);
  });

  it('should return 403 for non-admin user on GET /api/admin/system-health', async () => {
    keycloakAuthMiddleware.requireAdmin.mockImplementation((req, res) => {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Admin access required' });
    });

    const response = await authGet('/api/admin/system-health');
    expect(response.status).toBe(403);
    expect(response.body.error).toBe('FORBIDDEN');
  });

  it('should return 401 on POST /api/admin/security-scan without token', async () => {
    keycloakAuthMiddleware.authenticate.mockImplementation((req, res) => {
      res.status(401).json({ error: 'TOKEN_INVALID', message: 'Authentication required' });
    });

    const response = await request(app).post('/api/admin/security-scan');
    expect(response.status).toBe(401);
  });

  it('should return 403 for non-admin user on POST /api/admin/security-scan', async () => {
    keycloakAuthMiddleware.requireAdmin.mockImplementation((req, res) => {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Admin access required' });
    });

    const response = await authPost('/api/admin/security-scan', {});
    expect(response.status).toBe(403);
  });
});

// ============================================================
// AC2: System health endpoints
// ============================================================
describe('AC2: System health endpoints', () => {
  describe('GET /api/admin/system-health', () => {
    it('should return 200 with system health data', async () => {
      const healthData = { status: 'healthy', uptime: 12345, database: 'connected' };
      adminService.getSystemHealth.mockResolvedValue(healthData);

      const response = await authGet('/api/admin/system-health');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(healthData);
      expect(adminService.getSystemHealth).toHaveBeenCalled();
    });

    it('should call next(error) on service failure', async () => {
      adminService.getSystemHealth.mockRejectedValue(new Error('Health check failed'));

      const response = await authGet('/api/admin/system-health');

      expect(response.status).toBe(500);
    });
  });

  describe('GET /api/admin/database/stats', () => {
    it('should return 200 with database stats', async () => {
      const stats = { collections: 12, documents: 50000, size: '2GB' };
      adminService.getDatabaseStats.mockResolvedValue(stats);

      const response = await authGet('/api/admin/database/stats');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(stats);
      expect(adminService.getDatabaseStats).toHaveBeenCalled();
    });

    it('should call next(error) on service failure', async () => {
      adminService.getDatabaseStats.mockRejectedValue(new Error('DB stats failed'));

      const response = await authGet('/api/admin/database/stats');

      expect(response.status).toBe(500);
    });
  });

  describe('GET /api/admin/user-stats', () => {
    it('should return 200 with user stats', async () => {
      const stats = { totalUsers: 150, activeUsers: 120, newUsers: 15 };
      adminService.getUserStats.mockResolvedValue(stats);

      const response = await authGet('/api/admin/user-stats');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(stats);
      expect(adminService.getUserStats).toHaveBeenCalled();
    });

    it('should call next(error) on service failure', async () => {
      adminService.getUserStats.mockRejectedValue(new Error('User stats failed'));

      const response = await authGet('/api/admin/user-stats');

      expect(response.status).toBe(500);
    });
  });
});

// ============================================================
// AC3: Log management endpoints
// ============================================================
describe('AC3: Log management endpoints', () => {
  describe('GET /api/admin/logs', () => {
    it('should return 200 with logs (no filters)', async () => {
      const logs = [{ level: 'INFO', message: 'Server started', timestamp: '2025-01-01T00:00:00Z' }];
      adminService.getLogs.mockResolvedValue(logs);

      const response = await authGet('/api/admin/logs');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(logs);
      expect(adminService.getLogs).toHaveBeenCalledWith({ limit: undefined, level: undefined, service: undefined });
    });

    it('should pass query params: limit, level, service', async () => {
      adminService.getLogs.mockResolvedValue([]);

      const response = await authGet('/api/admin/logs?limit=50&level=ERROR&service=backend');

      expect(response.status).toBe(200);
      expect(adminService.getLogs).toHaveBeenCalledWith({ limit: '50', level: 'ERROR', service: 'backend' });
    });

    it('should call next(error) on service failure', async () => {
      adminService.getLogs.mockRejectedValue(new Error('Logs fetch failed'));

      const response = await authGet('/api/admin/logs');

      expect(response.status).toBe(500);
    });
  });

  describe('POST /api/admin/logs/rollover', () => {
    it('should return 200 after rollover', async () => {
      const result = { success: true, message: 'Logs rolled over' };
      adminService.rolloverLogs.mockResolvedValue(result);

      const response = await authPost('/api/admin/logs/rollover', {});

      expect(response.status).toBe(200);
      expect(response.body).toEqual(result);
      expect(adminService.rolloverLogs).toHaveBeenCalled();
    });

    it('should call next(error) on service failure', async () => {
      adminService.rolloverLogs.mockRejectedValue(new Error('Rollover failed'));

      const response = await authPost('/api/admin/logs/rollover', {});

      expect(response.status).toBe(500);
    });
  });

  describe('GET /api/admin/logs/summary', () => {
    it('should return 200 with logs summary', async () => {
      const summary = { total: 1000, byLevel: { INFO: 800, ERROR: 200 } };
      logsService.getLogsSummary.mockResolvedValue(summary);

      const response = await authGet('/api/admin/logs/summary?date=2025-01-15&level=ERROR');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ data: summary });
      expect(logsService.getLogsSummary).toHaveBeenCalledWith({ date: '2025-01-15', level: 'ERROR' });
    });

    it('should call next(error) on service failure', async () => {
      logsService.getLogsSummary.mockRejectedValue(new Error('Summary failed'));

      const response = await authGet('/api/admin/logs/summary');

      expect(response.status).toBe(500);
    });
  });

  describe('GET /api/admin/logs/search', () => {
    it('should return 200 with search results', async () => {
      const results = [{ message: 'found log', level: 'ERROR' }];
      adminService.searchLogs.mockResolvedValue(results);

      const response = await authGet('/api/admin/logs/search?term=error&level=ERROR&service=backend&dateRange=week&startDate=2025-01-01&endDate=2025-01-31');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(results);
      expect(adminService.searchLogs).toHaveBeenCalledWith({
        term: 'error', level: 'ERROR', service: 'backend', dateRange: 'week', startDate: '2025-01-01', endDate: '2025-01-31'
      });
    });

    it('should call next(error) on service failure', async () => {
      adminService.searchLogs.mockRejectedValue(new Error('Search failed'));

      const response = await authGet('/api/admin/logs/search');

      expect(response.status).toBe(500);
    });
  });

  describe('GET /api/admin/logs/debug-yesterday', () => {
    it('should return 200 with debug data', async () => {
      const debugData = { logs: [], warnings: 0 };
      adminService.debugYesterdayLogs.mockResolvedValue(debugData);

      const response = await authGet('/api/admin/logs/debug-yesterday');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(debugData);
      expect(adminService.debugYesterdayLogs).toHaveBeenCalled();
    });

    it('should call next(error) on service failure', async () => {
      adminService.debugYesterdayLogs.mockRejectedValue(new Error('Debug failed'));

      const response = await authGet('/api/admin/logs/debug-yesterday');

      expect(response.status).toBe(500);
    });
  });
});

// ============================================================
// AC4: Security endpoints — direct res.status() error handling
// ============================================================
describe('AC4: Security endpoints', () => {
  describe('GET /api/admin/security-metrics', () => {
    it('should return 200 with security metrics', async () => {
      securityScanService.getLastScanDetails.mockResolvedValue({
        failedLoginDetails: [{ ip: '1.2.3.4' }],
        suspiciousDetails: [{ type: 'brute-force' }],
        scanTime: '2025-01-01T12:00:00Z',
        vulnerabilities: { critical: 1, medium: 3, low: 5 }
      });

      const response = await authGet('/api/admin/security-metrics');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        failedLoginAttempts: 1,
        suspiciousActivities: 1,
        lastSecurityScan: '2025-01-01T12:00:00Z',
        vulnerabilities: { critical: 1, medium: 3, low: 5 }
      });
    });

    it('should return 200 with defaults when scan details are empty', async () => {
      securityScanService.getLastScanDetails.mockResolvedValue({});

      const response = await authGet('/api/admin/security-metrics');

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({
        failedLoginAttempts: 0,
        suspiciousActivities: 0,
        lastSecurityScan: 'Never',
        vulnerabilities: { critical: 0, medium: 0, low: 0 }
      });
    });

    it('should return 500 with direct res.status (not next(error)) on failure', async () => {
      securityScanService.getLastScanDetails.mockRejectedValue(new Error('Scan service down'));

      const response = await authGet('/api/admin/security-metrics');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: 'Failed to fetch security metrics' });
    });
  });

  describe('POST /api/admin/security-scan', () => {
    it('should return 200 with scan results', async () => {
      const scanResult = { threats: 0, scanned: true };
      securityScanService.runSecurityScan.mockResolvedValue(scanResult);

      const response = await authPost('/api/admin/security-scan', {});

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true, data: scanResult });
      expect(securityScanService.runSecurityScan).toHaveBeenCalledWith(logsService);
    });

    it('should return 500 with direct res.status on failure', async () => {
      securityScanService.runSecurityScan.mockRejectedValue(new Error('Scan failed'));

      const response = await authPost('/api/admin/security-scan', {});

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ success: false, message: 'Failed to run security scan' });
    });
  });

  describe('GET /api/admin/security/last-scan', () => {
    it('should return 200 with last scan details', async () => {
      const scanDetails = { scanTime: '2025-01-01T12:00:00Z', threats: 0 };
      securityScanService.getLastScanDetails.mockResolvedValue(scanDetails);

      const response = await authGet('/api/admin/security/last-scan');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(scanDetails);
    });

    it('should return 500 with direct res.status including error message on failure', async () => {
      securityScanService.getLastScanDetails.mockRejectedValue(new Error('DB timeout'));

      const response = await authGet('/api/admin/security/last-scan');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to fetch last scan details', message: 'DB timeout' });
    });
  });
});

// ============================================================
// AC5: Diagnostic and database operation endpoints
// ============================================================
describe('AC5: Diagnostic and database operation endpoints', () => {
  describe('POST /api/admin/diagnostics', () => {
    it('should return 200 with diagnostics result', async () => {
      const result = { status: 'ok', checks: { db: 'connected', redis: 'connected' } };
      adminService.runDiagnostics.mockResolvedValue(result);

      const response = await authPost('/api/admin/diagnostics', {});

      expect(response.status).toBe(200);
      expect(response.body).toEqual(result);
      expect(adminService.runDiagnostics).toHaveBeenCalled();
    });

    it('should call next(error) on service failure', async () => {
      adminService.runDiagnostics.mockRejectedValue(new Error('Diagnostics failed'));

      const response = await authPost('/api/admin/diagnostics', {});

      expect(response.status).toBe(500);
    });
  });

  describe('POST /api/admin/database-operations/backup', () => {
    it('should return 200 with backup result', async () => {
      const result = { success: true, file: 'backup-2025-01-15.tar.gz' };
      adminService.backupDatabase.mockResolvedValue(result);

      const response = await authPost('/api/admin/database-operations/backup', {});

      expect(response.status).toBe(200);
      expect(response.body).toEqual(result);
      expect(adminService.backupDatabase).toHaveBeenCalled();
    });

    it('should call next(error) on service failure', async () => {
      adminService.backupDatabase.mockRejectedValue(new Error('Backup failed'));

      const response = await authPost('/api/admin/database-operations/backup', {});

      expect(response.status).toBe(500);
    });
  });

  describe('POST /api/admin/database-operations/optimize', () => {
    it('should return 200 with optimize result', async () => {
      const result = { success: true, optimized: true };
      adminService.optimizeDatabase.mockResolvedValue(result);

      const response = await authPost('/api/admin/database-operations/optimize', {});

      expect(response.status).toBe(200);
      expect(response.body).toEqual(result);
      expect(adminService.optimizeDatabase).toHaveBeenCalled();
    });

    it('should call next(error) on service failure', async () => {
      adminService.optimizeDatabase.mockRejectedValue(new Error('Optimize failed'));

      const response = await authPost('/api/admin/database-operations/optimize', {});

      expect(response.status).toBe(500);
    });
  });
});

// ============================================================
// AC6: User search
// ============================================================
describe('AC6: User search', () => {
  describe('GET /api/admin/users/search', () => {
    it('should return 200 with search results', async () => {
      const searchResults = {
        users: [{ _key: 'u1', name: 'John', email: 'john@test.com' }],
        total: 1
      };
      adminService.searchUsers.mockResolvedValue(searchResults);

      const response = await authGet('/api/admin/users/search?term=john&field=name&limit=10&offset=0');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(searchResults);
      expect(adminService.searchUsers).toHaveBeenCalledWith({
        term: 'john', field: 'name', limit: '10', offset: '0'
      });
    });

    it('should work without query params', async () => {
      adminService.searchUsers.mockResolvedValue({ users: [], total: 0 });

      const response = await authGet('/api/admin/users/search');

      expect(response.status).toBe(200);
      expect(adminService.searchUsers).toHaveBeenCalledWith({
        term: undefined, field: undefined, limit: undefined, offset: undefined
      });
    });

    it('should call next(error) on service failure', async () => {
      adminService.searchUsers.mockRejectedValue(new Error('Search failed'));

      const response = await authGet('/api/admin/users/search');

      expect(response.status).toBe(500);
    });
  });
});

// ============================================================
// AC7: Error handling — two patterns
// ============================================================
describe('AC7: Error handling patterns', () => {
  describe('Pattern A: next(error) — most routes', () => {
    it('should return 500 via error middleware when getSystemHealth throws', async () => {
      adminService.getSystemHealth.mockRejectedValue(new Error('Service crashed'));

      const response = await authGet('/api/admin/system-health');

      expect(response.status).toBe(500);
    });

    it('should return 500 via error middleware when getDatabaseStats throws', async () => {
      adminService.getDatabaseStats.mockRejectedValue(new Error('DB error'));

      const response = await authGet('/api/admin/database/stats');

      expect(response.status).toBe(500);
    });

    it('should return 500 via error middleware when runDiagnostics throws', async () => {
      adminService.runDiagnostics.mockRejectedValue(new Error('Diag error'));

      const response = await authPost('/api/admin/diagnostics', {});

      expect(response.status).toBe(500);
    });

    it('should return 500 via error middleware when backupDatabase throws', async () => {
      adminService.backupDatabase.mockRejectedValue(new Error('Backup error'));

      const response = await authPost('/api/admin/database-operations/backup', {});

      expect(response.status).toBe(500);
    });

    it('should return 500 via error middleware when searchUsers throws', async () => {
      adminService.searchUsers.mockRejectedValue(new Error('Search error'));

      const response = await authGet('/api/admin/users/search');

      expect(response.status).toBe(500);
    });
  });

  describe('Pattern B: direct res.status(500) — security routes', () => {
    it('should return 500 with { message } for security-metrics', async () => {
      securityScanService.getLastScanDetails.mockRejectedValue(new Error('Metrics error'));

      const response = await authGet('/api/admin/security-metrics');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: 'Failed to fetch security metrics' });
    });

    it('should return 500 with { success, message } for security-scan', async () => {
      securityScanService.runSecurityScan.mockRejectedValue(new Error('Scan error'));

      const response = await authPost('/api/admin/security-scan', {});

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ success: false, message: 'Failed to run security scan' });
    });

    it('should return 500 with { error, message } for security/last-scan', async () => {
      securityScanService.getLastScanDetails.mockRejectedValue(new Error('Details error'));

      const response = await authGet('/api/admin/security/last-scan');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to fetch last scan details', message: 'Details error' });
    });
  });
});
