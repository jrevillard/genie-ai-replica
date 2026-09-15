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

// Mock ALL other services loaded by index.js (even unused ones)
jest.mock('../../services/admin-dashboard-service', () => ({
  getSystemHealth: jest.fn(),
  getDatabaseStats: jest.fn(),
  getLogs: jest.fn(),
  getUserStats: jest.fn(),
  searchLogs: jest.fn(),
  debugYesterdayLogs: jest.fn(),
  backupDatabase: jest.fn(),
  optimizeDatabase: jest.fn(),
  searchUsers: jest.fn(),
  runDiagnostics: jest.fn()
}));
jest.mock('../../services/user-profile-service', () => ({}));
jest.mock('../../services/analytics-service', () => ({}));
jest.mock('../../services/query-service', () => ({}));
jest.mock('../../services/chat-history-service', () => ({}));
jest.mock('../../services/service-category-service', () => ({}));
jest.mock('../../services/database-operations-service', () => ({}));
jest.mock('../../services/weather-service', () => ({}));
jest.mock('../../services/translation-service', () => ({}));
jest.mock('../../services/session-service', () => ({
  getUserSessions: jest.fn(),
  endSession: jest.fn(),
  createSession: jest.fn()
}));
jest.mock('../../services/logs-service', () => ({
  getLogsSummary: jest.fn()
}));
jest.mock('../../services/security-scan-service', () => ({
  getLastScanDetails: jest.fn(),
  runSecurityScan: jest.fn()
}));

// Mock swagger dependencies
jest.mock(
  'swagger-jsdoc',
  () => () => ({
    openapi: '3.0.0',
    info: {},
    components: {},
    security: []
  }),
  { virtual: true }
);
jest.mock(
  'swagger-ui-express',
  () => ({
    serve: [],
    setup: () => (req, res, next) => next()
  }),
  { virtual: true }
);

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

const sharedLib = require('../../shared-lib');
const { keycloakAuthMiddleware } = require('../../middleware/keycloak-auth-middleware');
const { logger } = require('../../shared-lib');

const validToken = createValidToken();

let app;
beforeAll(() => {
  app = createApp();
});

beforeEach(() => {
  jest.clearAllMocks();
  keycloakAuthMiddleware.authenticate.mockImplementation((req, res, next) => {
    req.user = {
      iss_sub: 'user-123',
      email: 'test@example.com',
      realm_access: { roles: ['admin'] }
    };
    next();
  });
  keycloakAuthMiddleware.requireAdmin.mockImplementation((req, res, next) => next());
});

function authPost(path, body) {
  return request(app).post(path).set('Authorization', `Bearer ${validToken}`).send(body);
}

// ============================================================
// Auth guard — both endpoints require authentication + admin (still enforced)
// ============================================================
describe('Auth guard', () => {
  it('should return 401 on POST /api/logger/configure without token', async () => {
    keycloakAuthMiddleware.authenticate.mockImplementation((req, res) => {
      res.status(401).json({ error: 'TOKEN_INVALID', message: 'Authentication required' });
    });

    const response = await request(app).post('/api/logger/configure').send({ level: 'debug' });
    expect(response.status).toBe(401);
  });

  it('should return 403 for non-admin user on POST /api/logger/configure', async () => {
    keycloakAuthMiddleware.requireAdmin.mockImplementation((req, res) => {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Admin access required' });
    });

    const response = await authPost('/api/logger/configure', { level: 'debug' });
    expect(response.status).toBe(403);
  });

  it('should return 401 on POST /api/logger/configure without token', async () => {
    keycloakAuthMiddleware.authenticate.mockImplementation((req, res) => {
      res.status(401).json({ error: 'TOKEN_INVALID', message: 'Authentication required' });
    });

    const response = await request(app).post('/api/logger/configure').send({ level: 'debug' });
    expect(response.status).toBe(401);
  });

  it('should return 403 for non-admin user on POST /api/logger/configure', async () => {
    keycloakAuthMiddleware.requireAdmin.mockImplementation((req, res) => {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Admin access required' });
    });

    const response = await authPost('/api/logger/configure', { level: 'debug' });
    expect(response.status).toBe(403);
  });
});

// ============================================================
// Deprecated POST /api/logger/configure
// ============================================================
describe('POST /api/logger/configure (deprecated)', () => {
  it('should return 200 with deprecation body for admin caller and not call reconfigureLogger', async () => {
    const response = await authPost('/api/logger/configure', { level: 'debug' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      deprecated: true,
      message:
        'Logger configuration is deprecated; log level and file transports are managed via LOG_LEVEL / LOG_TO_FILE environment variables.'
    });
    expect(sharedLib.reconfigureLogger).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('/api/logger/configure is deprecated'),
      expect.objectContaining({ user: 'user-123' })
    );
  });

  it('should return 200 with deprecation body even with invalid legacy payload (no validation, no error)', async () => {
    const response = await authPost('/api/logger/configure', { level: 'trace', errorMaxSize: '10x' });

    expect(response.status).toBe(200);
    expect(response.body.deprecated).toBe(true);
    expect(sharedLib.reconfigureLogger).not.toHaveBeenCalled();
  });
});
