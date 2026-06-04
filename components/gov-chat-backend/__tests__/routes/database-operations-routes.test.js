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
jest.mock('../../services/admin-dashboard-service', () => ({}));
jest.mock('../../services/user-profile-service', () => ({}));
jest.mock('../../services/analytics-service', () => ({}));
jest.mock('../../services/query-service', () => ({}));
jest.mock('../../services/chat-history-service', () => ({}));
jest.mock('../../services/service-category-service', () => ({}));
jest.mock('../../services/weather-service', () => ({}));
jest.mock('../../services/translation-service', () => ({}));
jest.mock('../../services/session-service', () => ({
  getUserSessions: jest.fn(),
  endSession: jest.fn(),
  createSession: jest.fn()
}));
jest.mock('../../services/logs-service', () => ({}));
jest.mock('../../services/security-scan-service', () => ({}));

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

const { keycloakAuthMiddleware } = require('../../middleware/keycloak-auth-middleware');

const validToken = createValidToken();

let app;
beforeAll(() => {
  app = createApp();
});

beforeEach(() => {
  jest.clearAllMocks();
  keycloakAuthMiddleware.authenticate.mockImplementation((req, res, next) => next());
  keycloakAuthMiddleware.requireAdmin.mockImplementation((req, res, next) => next());
});

function authPost(path, body) {
  return request(app).post(path).set('Authorization', `Bearer ${validToken}`).send(body);
}

// ============================================================
// Auth guard — All /api/database/* routes require authentication
// ============================================================
describe('Auth guard', () => {
  it('should return 401 on POST /api/database/backup without token', async () => {
    keycloakAuthMiddleware.authenticate.mockImplementation((req, res) => {
      res.status(401).json({ error: 'TOKEN_INVALID', message: 'Authentication required' });
    });

    const response = await request(app).post('/api/database/backup');
    expect(response.status).toBe(401);
  });

  it('should return 401 on POST /api/database/optimize without token', async () => {
    keycloakAuthMiddleware.authenticate.mockImplementation((req, res) => {
      res.status(401).json({ error: 'TOKEN_INVALID', message: 'Authentication required' });
    });

    const response = await request(app).post('/api/database/optimize');
    expect(response.status).toBe(401);
  });
});

// ============================================================
// POST /api/database/backup
// ============================================================
describe('POST /api/database/backup', () => {
  it('should return 200 with successful backup', async () => {
    const response = await authPost('/api/database/backup');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('success', true);
    expect(response.body).toHaveProperty('message');
  });

  it('should return 500 when backup fails (service error)', async () => {
    const databaseService = require('../../services/database-operations-service');
    databaseService.backupDatabase = jest.fn().mockResolvedValue({
      success: false,
      message: 'Backup failed'
    });

    const response = await authPost('/api/database/backup');

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('Backup failed');
  });

  it('should return 500 when backup throws unexpected error', async () => {
    const databaseService = require('../../services/database-operations-service');
    databaseService.backupDatabase = jest.fn().mockRejectedValue(new Error('Unexpected error'));

    const response = await authPost('/api/database/backup');

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('Unexpected error during database backup');
  });

  it('should return 500 when service initialization fails', async () => {
    const databaseService = require('../../services/database-operations-service');
    databaseService.init = jest.fn().mockRejectedValue(new Error('Service unavailable'));

    const response = await authPost('/api/database/backup');

    expect(response.status).toBe(500);
  });
});

// ============================================================
// POST /api/database/optimize
// ============================================================
describe('POST /api/database/optimize', () => {
  it('should return 200 with successful optimization', async () => {
    const response = await authPost('/api/database/optimize');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('success', true);
    expect(response.body).toHaveProperty('message');
  });

  it('should return 500 when optimization fails (service error)', async () => {
    const databaseService = require('../../services/database-operations-service');
    databaseService.optimizeDatabase = jest.fn().mockResolvedValue({
      success: false,
      message: 'Optimization failed'
    });

    const response = await authPost('/api/database/optimize');

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('Optimization failed');
  });

  it('should return 500 when optimization throws unexpected error', async () => {
    const databaseService = require('../../services/database-operations-service');
    databaseService.optimizeDatabase = jest.fn().mockRejectedValue(new Error('Unexpected error'));

    const response = await authPost('/api/database/optimize');

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('Unexpected error during database optimization');
  });

  it('should return 500 when service initialization fails', async () => {
    const databaseService = require('../../services/database-operations-service');
    databaseService.init = jest.fn().mockRejectedValue(new Error('Service unavailable'));

    const response = await authPost('/api/database/optimize');

    expect(response.status).toBe(500);
  });
});

// ============================================================
// Method not allowed
// ============================================================
describe('Method not allowed', () => {
  it('should return 404 for GET /api/database/backup', async () => {
    const response = await request(app)
      .get('/api/database/backup')
      .set('Authorization', `Bearer ${validToken}`);
    expect(response.status).toBe(404);
  });

  it('should return 404 for GET /api/database/optimize', async () => {
    const response = await request(app)
      .get('/api/database/optimize')
      .set('Authorization', `Bearer ${validToken}`);
    expect(response.status).toBe(404);
  });

  it('should return 404 for PUT /api/database/backup', async () => {
    const response = await request(app)
      .put('/api/database/backup')
      .set('Authorization', `Bearer ${validToken}`);
    expect(response.status).toBe(404);
  });

  it('should return 404 for DELETE /api/database/optimize', async () => {
    const response = await request(app)
      .delete('/api/database/optimize')
      .set('Authorization', `Bearer ${validToken}`);
    expect(response.status).toBe(404);
  });

  it('should return 404 for PATCH /api/database/backup', async () => {
    const response = await request(app)
      .patch('/api/database/backup')
      .set('Authorization', `Bearer ${validToken}`);
    expect(response.status).toBe(404);
  });
});

// ============================================================
// Service initialization failure
// ============================================================
describe('Service initialization failure', () => {
  it('should handle backup when service cannot be initialized', async () => {
    const databaseService = require('../../services/database-operations-service');
    databaseService.init = jest.fn().mockRejectedValue(new Error('Cannot connect to database'));

    const response = await authPost('/api/database/backup');

    expect(response.status).toBe(500);
  });

  it('should handle optimize when service cannot be initialized', async () => {
    const databaseService = require('../../services/database-operations-service');
    databaseService.init = jest.fn().mockRejectedValue(new Error('Cannot connect to database'));

    const response = await authPost('/api/database/optimize');

    expect(response.status).toBe(500);
  });
});
