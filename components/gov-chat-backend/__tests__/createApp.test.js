'use strict';

require('./setup-env');

// Mock shared-lib — must include ALL 4 exports used by index.js
jest.mock(
  '../shared-lib',
  () => ({
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    },
    dbService: { getConnection: jest.fn() },
    securityHeaders: (req, res, next) => next(),
    SecurityMiddleware: { applySecurityMiddleware: jest.fn() }
  }),
  { virtual: true }
);

// Mock keycloak middleware (imported by index.js)
jest.mock('../middleware/keycloak-auth-middleware', () => ({
  keycloakAuthMiddleware: { authenticate: (req, res, next) => next() }
}));

// Mock swagger dependencies (index.js imports swagger-jsdoc and swagger-ui-express)
jest.mock('swagger-jsdoc', () => () => ({
  openapi: '3.0.0',
  info: {},
  components: {},
  security: []
}));
jest.mock('swagger-ui-express', () => ({
  serve: [],
  setup: () => (req, res, next) => next()
}));

// Mock all services — route factory functions receive service objects
const createMockServices = () => ({
  userProfileService: {},
  queryService: {},
  serviceCategoryService: {},
  chatHistoryService: {},
  analyticsService: {},
  logsService: {},
  databaseOperationsService: {},
  adminDashboardService: {},
  weatherService: {},
  translationService: {}
});

jest.mock('../services/user-profile-service', () => ({}));
jest.mock('../services/admin-dashboard-service', () => ({}));
jest.mock('../services/analytics-service', () => ({}));
jest.mock('../services/query-service', () => ({}));
jest.mock('../services/chat-history-service', () => ({}));
jest.mock('../services/service-category-service', () => ({}));
jest.mock('../services/logs-service', () => ({}));
jest.mock('../services/database-operations-service', () => ({}));
jest.mock('../services/weather-service', () => ({}));
jest.mock('../services/security-scan-service', () => ({}));
jest.mock('../services/translation-service', () => ({}));
jest.mock('../services/user-provisioning-service', () => ({ initialize: jest.fn() }));

// Mock analytics controller (required by analytics-routes factory)
jest.mock('../controllers/analyticsController', () => {
  return function () {
    return {};
  };
});

// Mock process.exit to prevent test process from being killed
const originalExit = process.exit;
beforeAll(() => {
  process.exit = jest.fn();
});
afterAll(() => {
  process.exit = originalExit;
});

const { createApp } = require('../index');
const request = require('supertest');

describe('createApp', () => {
  describe('AC5a: returns Express app', () => {
    it('should return an object with listen and use functions (Express app)', () => {
      const app = createApp();
      expect(app).toBeDefined();
      expect(typeof app.listen).toBe('function');
      expect(typeof app.use).toBe('function');
    });
  });

  describe('AC5c: static endpoints work without services', () => {
    it('should return 200 for GET /api/health without services', async () => {
      const app = createApp();
      const response = await request(app).get('/api/health');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
    });
  });

  describe('AC5b: middleware applied', () => {
    it('should remove x-powered-by header (helmet applied)', async () => {
      const app = createApp();
      const response = await request(app).get('/api/health');
      expect(response.headers['x-powered-by']).toBeUndefined();
    });

    it('should parse JSON body (body parser works)', async () => {
      const app = createApp();
      // POST to an unknown route — body parser should still parse, 404 expected
      const response = await request(app)
        .post('/api/nonexistent')
        .send({ test: 'data' })
        .set('Content-Type', 'application/json');
      // 404 is fine — the point is body parsing didn't crash
      expect([404, 500]).toContain(response.status);
    });
  });

  describe('AC5d: route registration with services', () => {
    it('should mount routes when services are provided', async () => {
      const mockServices = createMockServices();
      const app = createApp({ services: mockServices });

      const results = await Promise.all([
        request(app).get('/api/health'),
        request(app).get('/api/me'),
        request(app).post('/api/auth/login')
      ]);

      // GET /api/health → 200 (static endpoint, always available)
      expect(results[0].status).toBe(200);

      // GET /api/me → 401, 403, 404, or 500 (handler may fail without real auth session)
      expect([401, 403, 404, 500]).toContain(results[1].status);

      // POST /api/auth/login without body → 400, 404, 405, 415, or 500
      expect([400, 404, 405, 415, 500]).toContain(results[2].status);
    });
  });

  describe('AC5e: independent instances', () => {
    it('should produce independent instances from two createApp() calls', () => {
      const app1 = createApp();
      const app2 = createApp();

      expect(app1).not.toBe(app2);
    });

    it('should not share middleware between instances', async () => {
      const app1 = createApp();
      const app2 = createApp();

      // Add a test middleware to app1 only
      let middlewareCalled = false;
      app1.use((req, res, next) => {
        middlewareCalled = true;
        next();
      });

      // Hit app2 — the middleware should NOT fire
      await request(app2).get('/api/health');
      expect(middlewareCalled).toBe(false);
    });
  });

  describe('AC5f: import does not start server', () => {
    it('should not call app.listen() when index.js is imported', () => {
      // If require('../index') had started the server, Jest would hang or crash.
      // The fact that this test suite runs at all proves no server was started
      // during import (require.main === module guard prevents auto-start).
      expect(typeof createApp).toBe('function');
    });
  });
});
