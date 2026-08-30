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

// Mock database-operations-service with proper implementation
jest.mock('../../services/database-operations-service', () => {
  return jest.fn().mockImplementation(() => ({
    init: jest.fn().mockResolvedValue(undefined),
    backupDatabase: jest.fn().mockResolvedValue({
      success: true,
      message: 'Backup completed',
      backupPath: '/backups/db-backup.tar.gz'
    }),
    optimizeDatabase: jest.fn().mockResolvedValue({
      success: true,
      message: 'Database optimized'
    })
  }));
});

// Mock ALL other services loaded by index.js (even unused ones)
jest.mock('../../services/admin-dashboard-service', () => ({}));
jest.mock('../../services/user-profile-service', () => ({}));
jest.mock('../../services/analytics-service', () => ({
  init: jest.fn().mockResolvedValue(undefined)
}));
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
const DatabaseOperationsService = require('../../services/database-operations-service');

const { keycloakAuthMiddleware } = require('../../middleware/keycloak-auth-middleware');

const validToken = createValidToken();

let app;
let databaseService;

beforeAll(() => {
  databaseService = new DatabaseOperationsService();
  // Note: The route config uses 'databaseOperationsService' as the key
  app = createApp({ services: { databaseOperationsService: databaseService } });
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
    // Override the service mock for this test
    databaseService.backupDatabase.mockResolvedValueOnce({
      success: false,
      message: 'Backup failed'
    });

    const response = await authPost('/api/database/backup');

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('Backup failed');
  });

  it('should return 500 when backup throws unexpected error', async () => {
    // Override the service mock for this test
    databaseService.backupDatabase.mockRejectedValueOnce(new Error('Unexpected error'));

    const response = await authPost('/api/database/backup');

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('Unexpected error during database backup');
  });

  // Note: Service initialization failures are not directly testable at the route level
  // because init() is async and the route doesn't await it or check its result.
  // The service would fail on the actual method call (backup/optimize) if initialization failed.
  //
  // it('should return 500 when service initialization fails', async () => {
  //   // This would require mocking the service to fail initialization
  //   // which isn't straightforward with the current route structure
  // });
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
    // Override the service mock for this test
    databaseService.optimizeDatabase.mockResolvedValueOnce({
      success: false,
      message: 'Optimization failed'
    });

    const response = await authPost('/api/database/optimize');

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('Optimization failed');
  });

  it('should return 500 when optimization throws unexpected error', async () => {
    // Override the service mock for this test
    databaseService.optimizeDatabase.mockRejectedValueOnce(new Error('Unexpected error'));

    const response = await authPost('/api/database/optimize');

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('Unexpected error during database optimization');
  });

  // Note: Service initialization failures are not directly testable at the route level
  // because init() is async and the route doesn't await it or check its result.
  //
  // it('should return 500 when service initialization fails', async () => {
  //   // This would require mocking the service to fail initialization
  //   // which isn't straightforward with the current route structure
  // });
});

// ============================================================
// Method not allowed
// ============================================================
describe('Method not allowed', () => {
  it('should return 404 for GET /api/database/backup', async () => {
    const response = await request(app).get('/api/database/backup').set('Authorization', `Bearer ${validToken}`);
    expect(response.status).toBe(404);
  });

  it('should return 404 for GET /api/database/optimize', async () => {
    const response = await request(app).get('/api/database/optimize').set('Authorization', `Bearer ${validToken}`);
    expect(response.status).toBe(404);
  });

  it('should return 404 for PUT /api/database/backup', async () => {
    const response = await request(app).put('/api/database/backup').set('Authorization', `Bearer ${validToken}`);
    expect(response.status).toBe(404);
  });

  it('should return 404 for DELETE /api/database/optimize', async () => {
    const response = await request(app).delete('/api/database/optimize').set('Authorization', `Bearer ${validToken}`);
    expect(response.status).toBe(404);
  });

  it('should return 404 for PATCH /api/database/backup', async () => {
    const response = await request(app).patch('/api/database/backup').set('Authorization', `Bearer ${validToken}`);
    expect(response.status).toBe(404);
  });
});

// ============================================================
// Service initialization failure
// ============================================================
// Note: Service initialization failures are not directly testable at the route level
// because init() is async and the route doesn't await it or check its result.
// These tests would require a different approach (e.g., mocking at the module level).
//
// describe('Service initialization failure', () => {
//   it('should handle backup when service cannot be initialized', async () => {
//     // Would require module-level mocking
//   });
//
//   it('should handle optimize when service cannot be initialized', async () => {
//     // Would require module-level mocking
//   });
// });
