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

// Mock the TARGET services
jest.mock('../../services/user-profile-service', () => ({
  getUserProfile: jest.fn(),
  updateUserProfile: jest.fn(),
  resetUserData: jest.fn()
}));
jest.mock('../../services/keycloak-proxy-service', () => ({
  updateOwnProfile: jest.fn(),
  deleteUser: jest.fn()
}));

// Mock ALL other services loaded by index.js (even unused ones)
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

const userProfileService = require('../../services/user-profile-service');
const keycloakProxyService = require('../../services/keycloak-proxy-service');
const { keycloakAuthMiddleware } = require('../../middleware/keycloak-auth-middleware');

const validToken = createValidToken();

let app;
beforeAll(() => {
  app = createApp({ services: { userProfileService } });
});

beforeEach(() => {
  jest.clearAllMocks();
  keycloakAuthMiddleware.authenticate.mockImplementation((req, res, next) => {
    req.user = { iss_sub: 'http://localhost:8080/realms/genie#user-123', _key: 'user-123' };
    req.claims = { realm_access: { roles: ['offline_access', 'default-roles-genie', 'admin', 'uma_authorization'] } };
    next();
  });
});

function authGet(path) {
  return request(app).get(path).set('Authorization', `Bearer ${validToken}`);
}
function authPost(path, body) {
  return request(app).post(path).set('Authorization', `Bearer ${validToken}`).send(body);
}
function authPut(path, body) {
  return request(app).put(path).set('Authorization', `Bearer ${validToken}`).send(body);
}

// ============================================================
// AC2.1: Auth guard — all endpoints require authentication
// ============================================================
describe('Auth guard', () => {
  it('should return 401 on GET /api/me without token', async () => {
    keycloakAuthMiddleware.authenticate.mockImplementation((req, res) => {
      res.status(401).json({ error: 'TOKEN_INVALID', message: 'Authentication required' });
    });

    const response = await request(app).get('/api/me');
    expect(response.status).toBe(401);
  });

  it('should return 401 on GET /api/me/context without token', async () => {
    keycloakAuthMiddleware.authenticate.mockImplementation((req, res) => {
      res.status(401).json({ error: 'TOKEN_INVALID', message: 'Authentication required' });
    });

    const response = await request(app).get('/api/me/context');
    expect(response.status).toBe(401);
  });

  it('should return 401 on POST /api/me/reset-data without token', async () => {
    keycloakAuthMiddleware.authenticate.mockImplementation((req, res) => {
      res.status(401).json({ error: 'TOKEN_INVALID', message: 'Authentication required' });
    });

    const response = await request(app).post('/api/me/reset-data');
    expect(response.status).toBe(401);
  });

  it('should return 401 on POST /api/me/delete without token', async () => {
    keycloakAuthMiddleware.authenticate.mockImplementation((req, res) => {
      res.status(401).json({ error: 'TOKEN_INVALID', message: 'Authentication required' });
    });

    const response = await request(app).post('/api/me/delete');
    expect(response.status).toBe(401);
  });

  it('should return 401 on PUT /api/me without token', async () => {
    keycloakAuthMiddleware.authenticate.mockImplementation((req, res) => {
      res.status(401).json({ error: 'TOKEN_INVALID', message: 'Authentication required' });
    });

    const response = await request(app).put('/api/me').send({ name: 'test' });
    expect(response.status).toBe(401);
  });
});

// ============================================================
// AC2.2: GET /api/me
// ============================================================
describe('GET /api/me', () => {
  it('should return 200 with user profile', async () => {
    const user = { _key: 'u1', name: 'Test User', email: 'test@example.com' };
    userProfileService.getUserProfile.mockResolvedValue(user);

    const response = await authGet('/api/me');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(user);
  });

  it('should return 500 on service error', async () => {
    userProfileService.getUserProfile.mockRejectedValue(new Error('DB error'));

    const response = await authGet('/api/me');

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('DB error');
  });
});

// ============================================================
// AC2.3: GET /api/me/context
// ============================================================
describe('GET /api/me/context', () => {
  it('should return 200 with sanitized context', async () => {
    const user = { name: 'Test User', roles: ['admin'], emailVerified: true, password: 'secret' };
    userProfileService.getUserProfile.mockResolvedValue(user);

    const response = await authGet('/api/me/context');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ name: 'Test User', role: ['admin'], emailVerified: true });
    expect(response.body).not.toHaveProperty('password');
  });

  it('should return 404 when user not found', async () => {
    userProfileService.getUserProfile.mockResolvedValue(null);

    const response = await authGet('/api/me/context');

    expect(response.status).toBe(404);
    expect(response.body.message).toContain('not found');
  });

  it('should return 500 on service error', async () => {
    userProfileService.getUserProfile.mockRejectedValue(new Error('DB error'));

    const response = await authGet('/api/me/context');

    expect(response.status).toBe(500);
  });

  it('should use default values when user properties are missing', async () => {
    userProfileService.getUserProfile.mockResolvedValue({});

    const response = await authGet('/api/me/context');

    expect(response.status).toBe(200);
    expect(response.body.name).toBe('User');
    // Roles come from JWT claims (set in beforeEach mock), not from ArangoDB user document
    expect(response.body.role).toEqual(['admin']);
    expect(response.body.emailVerified).toBe(false);
  });
});

// ============================================================
// AC2.4: POST /api/me/reset-data
// ============================================================
describe('POST /api/me/reset-data', () => {
  it('should return 200 on successful reset', async () => {
    userProfileService.resetUserData.mockResolvedValue({ resetFields: ['chatHistory'] });

    const response = await authPost('/api/me/reset-data', {});

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(userProfileService.resetUserData).toHaveBeenCalled();
  });

  it('should return 500 on service error', async () => {
    userProfileService.resetUserData.mockRejectedValue(new Error('Reset failed'));

    const response = await authPost('/api/me/reset-data', {});

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
  });
});

// ============================================================
// AC2.5: POST /api/me/delete (GDPR)
// ============================================================
describe('POST /api/me/delete', () => {
  it('should return 200 on successful GDPR delete', async () => {
    keycloakProxyService.deleteUser.mockResolvedValue(undefined);

    const response = await authPost('/api/me/delete', {});

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, message: 'Account deleted' });
    expect(keycloakProxyService.deleteUser).toHaveBeenCalled();
  });

  it('should return 404 when user not found in Keycloak', async () => {
    const error = new Error('User not found');
    error.status = 404;
    keycloakProxyService.deleteUser.mockRejectedValue(error);

    const response = await authPost('/api/me/delete', {});

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
  });

  it('should return 500 on service error', async () => {
    keycloakProxyService.deleteUser.mockRejectedValue(new Error('Keycloak down'));

    const response = await authPost('/api/me/delete', {});

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
  });
});

// ============================================================
// AC2.6: PUT /api/me (profile update)
// ============================================================
describe('PUT /api/me', () => {
  it('should return 200 with JSON body (custom fields only)', async () => {
    const updatedUser = { _key: 'u1', bio: 'Updated bio' };
    userProfileService.updateUserProfile.mockResolvedValue(updatedUser);

    const response = await authPut('/api/me', { bio: 'Updated bio' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.user).toEqual(updatedUser);
    expect(keycloakProxyService.updateOwnProfile).not.toHaveBeenCalled();
  });

  it('should forward JIT fields to Keycloak', async () => {
    userProfileService.updateUserProfile.mockResolvedValue({ _key: 'u1' });
    keycloakProxyService.updateOwnProfile.mockResolvedValue(undefined);

    const response = await authPut('/api/me', { firstName: 'New', bio: 'text' });

    expect(response.status).toBe(200);
    expect(keycloakProxyService.updateOwnProfile).toHaveBeenCalledWith(expect.any(String), { firstName: 'New' });
    expect(userProfileService.updateUserProfile).toHaveBeenCalledWith(expect.any(String), { bio: 'text' }, []);
  });

  it('should return 401 when JIT fields present but authorization header missing', async () => {
    userProfileService.updateUserProfile.mockResolvedValue({ _key: 'u1' });

    const response = await request(app).put('/api/me').send({ firstName: 'New' });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(keycloakProxyService.updateOwnProfile).not.toHaveBeenCalled();
  });

  it('should return 400 for invalid JSON in multipart data field', async () => {
    const response = await request(app)
      .put('/api/me')
      .set('Authorization', `Bearer ${validToken}`)
      .field('data', 'not-valid-json');

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('Invalid');
  });

  it('should return 500 on service error', async () => {
    userProfileService.updateUserProfile.mockRejectedValue(new Error('Update failed'));

    const response = await authPut('/api/me', { bio: 'test' });

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
  });

  it('should return 404 when user not found', async () => {
    const error = new Error('User not found');
    error.status = 404;
    userProfileService.updateUserProfile.mockRejectedValue(error);

    const response = await authPut('/api/me', { bio: 'test' });

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
  });

  it('should return 403 when forbidden', async () => {
    const error = new Error('Forbidden');
    error.status = 403;
    userProfileService.updateUserProfile.mockRejectedValue(error);

    const response = await authPut('/api/me', { bio: 'test' });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
  });
});

// ============================================================
// AC2.7: Catch-all 404
// ============================================================
describe('Catch-all 404', () => {
  it('should return 404 for unknown /api/me/* routes', async () => {
    const response = await authGet('/api/me/unknown-route');

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('Route not found');
  });
});
