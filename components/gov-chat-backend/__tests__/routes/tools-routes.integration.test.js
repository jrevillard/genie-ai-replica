'use strict';

// Composed-app integration test: real keycloak-auth-middleware (authenticate +
// requireRole), real ROUTE_CONFIGS mount order from index.js, only the
// Keycloak service boundary is mocked. Guards the regression where
// admin-routes' blanket requireAdmin intercepted /api/admin/tools/* before the
// tools router mounted, making the tools-admin/tools-reader RBAC inert.
jest.mock('../../shared-lib', () => require('../mocks/shared-lib'), { virtual: true });

// Real middleware calls these two services — mock at the service boundary so
// the middleware itself (claims extraction, role checks) runs for real
const mockVerifyToken = jest.fn();
jest.mock('../../services/keycloak-auth-service', () => ({
  verifyToken: (...args) => mockVerifyToken(...args),
  checkUserStatusInKeycloak: jest.fn()
}));
jest.mock('../../services/user-provisioning-service', () => ({
  provisionUser: jest.fn().mockResolvedValue({
    iss_sub: 'http://localhost:8080/realms/genie#user-1',
    deleted: false
  }),
  initialize: jest.fn().mockResolvedValue(undefined),
  markUserAsDeleted: jest.fn()
}));

// Mock every other service index.js loads (same set as weather-routes.test.js)
jest.mock('../../services/admin-dashboard-service', () => ({}));
jest.mock('../../services/user-profile-service', () => ({}));
jest.mock('../../services/analytics-service', () => ({ init: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../services/query-service', () => ({}));
jest.mock('../../services/chat-history-service', () => ({}));
jest.mock('../../services/service-category-service', () => ({}));
jest.mock('../../services/database-operations-service', () => ({}));
jest.mock('../../services/translation-service', () => ({}));
jest.mock('../../services/session-service', () => ({
  getUserSessions: jest.fn(),
  endSession: jest.fn(),
  createSession: jest.fn()
}));
jest.mock('../../services/logs-service', () => ({}));
jest.mock('../../services/security-scan-service', () => ({}));
jest.mock('../../services/weather-service', () =>
  jest.fn().mockImplementation(() => ({
    init: jest.fn().mockResolvedValue(undefined),
    getWeather: jest.fn(),
    setAnalyticsService: jest.fn()
  }))
);
jest.mock('../../services/tools-service', () => ({}));

jest.mock('swagger-jsdoc', () => () => ({ openapi: '3.0.0', info: {}, components: {}, security: [] }), {
  virtual: true
});
jest.mock('swagger-ui-express', () => ({ serve: [], setup: () => (req, res, next) => next() }), { virtual: true });

const originalExit = process.exit;
beforeAll(() => {
  process.exit = jest.fn();
});
afterAll(() => {
  process.exit = originalExit;
});

const request = require('supertest');
const { createApp } = require('../../index');

const toolsService = {
  getFeeds: jest.fn().mockResolvedValue([{ id: 'feed-1', name: 'News' }]),
  createFeed: jest.fn().mockResolvedValue({ id: 'feed-2', name: 'New feed' }),
  updateFeed: jest.fn().mockResolvedValue({ id: 'feed-1', name: 'Updated' }),
  deleteFeed: jest.fn().mockResolvedValue({ success: true })
};

const app = createApp({ services: { toolsService } });

// Real middleware verifies the bearer via verifyToken; the roles we grant
// land in the decoded token exactly as Keycloak would put them
function bearerWithRoles(roles) {
  mockVerifyToken.mockResolvedValue({
    iss: 'http://localhost:8080/realms/genie',
    sub: 'user-1',
    realm_access: { roles }
  });
}

// ============================================================
// Mount order — admin-routes must NOT intercept tools traffic
// ============================================================
describe('composed app RBAC (real middleware, real mount order)', () => {
  it('GET /feeds returns 200 for tools-reader (was 403 Admin access required)', async () => {
    bearerWithRoles(['user', 'tools-reader']);
    const response = await request(app).get('/api/admin/tools/feeds').set('Authorization', 'Bearer test-token');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('POST /feeds returns 403 tools-role error (not admin-routes interception) for tools-reader', async () => {
    bearerWithRoles(['user', 'tools-reader']);
    const response = await request(app)
      .post('/api/admin/tools/feeds')
      .set('Authorization', 'Bearer test-token')
      .send({ name: 'x' });
    expect(response.status).toBe(403);
    expect(response.body.error).toBe('FORBIDDEN');
    expect(response.body.message).toBe('tools-admin or admin access required');
    expect(toolsService.createFeed).not.toHaveBeenCalled();
  });

  it('POST /feeds returns 201 for tools-admin without legacy admin role', async () => {
    bearerWithRoles(['user', 'tools-admin']);
    const response = await request(app)
      .post('/api/admin/tools/feeds')
      .set('Authorization', 'Bearer test-token')
      .send({ name: 'x' });
    expect(response.status).toBe(201);
    expect(toolsService.createFeed).toHaveBeenCalled();
  });

  it('rejects missing token with 401 before any role check', async () => {
    const response = await request(app).get('/api/admin/tools/feeds');
    expect(response.status).toBe(401);
    expect(response.body.error).toBe('TOKEN_INVALID');
  });

  it('default-denies unmatched paths under /api/admin/tools', async () => {
    bearerWithRoles(['user', 'tools-admin']);
    const response = await request(app).get('/api/admin/tools/nonexistent').set('Authorization', 'Bearer test-token');
    expect(response.status).toBe(403);
    expect(response.body.error).toBe('FORBIDDEN');
  });
});
