'use strict';

require('../setup-env');

// Mock shared-lib — must include ALL exports used by index.js
jest.mock(
  '../../shared-lib',
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

jest.mock('../../middleware/keycloak-auth-middleware', () => ({
  keycloakAuthMiddleware: { authenticate: (req, res, next) => next() }
}));

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

jest.mock('../../services/user-profile-service', () => ({}));
jest.mock('../../services/admin-dashboard-service', () => ({}));
jest.mock('../../services/analytics-service', () => ({}));
jest.mock('../../services/query-service', () => ({}));
jest.mock('../../services/chat-history-service', () => ({}));
jest.mock('../../services/service-category-service', () => ({}));
jest.mock('../../services/logs-service', () => ({}));
jest.mock('../../services/database-operations-service', () => ({}));
jest.mock('../../services/weather-service', () => ({}));
jest.mock('../../services/security-scan-service', () => ({}));
jest.mock('../../services/translation-service', () => ({}));
jest.mock('../../services/user-provisioning-service', () => ({ initialize: jest.fn() }));
jest.mock(
  '../../controllers/analyticsController',
  () =>
    function () {
      return {};
    }
);

const originalExit = process.exit;
beforeAll(() => {
  process.exit = jest.fn();
});
afterAll(() => {
  process.exit = originalExit;
});

const { createApp } = require('../../index');
const request = require('supertest');

describe('security middleware', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp({ services: {} });
  });

  // ---- Sensitive path blocker ----
  describe('sensitive path blocking', () => {
    it('should return 404 for /.git/HEAD', async () => {
      const res = await request(app).get('/.git/HEAD');
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Not Found');
    });

    it('should return 404 for /.env', async () => {
      const res = await request(app).get('/.env');
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Not Found');
    });

    it('should return 404 for /BitKeeper', async () => {
      const res = await request(app).get('/BitKeeper');
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Not Found');
    });

    it('should return 404 for dotfile paths (/.anything)', async () => {
      const res = await request(app).get('/.htaccess');
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Not Found');
    });

    it('should allow normal paths through', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
    });

    it('should allow /api paths through (not blocked by sensitive path middleware)', async () => {
      const res = await request(app).get('/api/nonexistent-path-xyz');
      // Sensitive path blocker returns { message: 'Not Found' } with 404.
      // If we get anything else, the path was not blocked by the sensitive middleware.
      expect(res.body.message).not.toBe('Not Found');
    });
  });

  // ---- CORS origin validation ----
  describe('CORS origin validation', () => {
    beforeEach(() => {
      process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:5173,http://example.com';
    });

    it('should allow requests from allowed origin', async () => {
      const res = await request(app).get('/').set('Origin', 'http://localhost:5173');
      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    });

    it('should deny requests from disallowed origin', async () => {
      const res = await request(app).get('/').set('Origin', 'http://evil.com');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('should allow requests with no origin (server-to-server)', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('should support regex patterns in allowlist', async () => {
      process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:5173,/\\.example\\.com$/';
      let freshApp;
      jest.isolateModules(() => {
        freshApp = require('../../index').createApp({ services: {} });
      });
      const res = await request(freshApp).get('/').set('Origin', 'http://test.example.com');
      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('http://test.example.com');
    });
  });

  // ---- Debug middleware ----
  describe('debug middleware', () => {
    it('should log request IP, headers, path, method', async () => {
      const { logger } = require('../../shared-lib');
      await request(app).get('/');
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Request IP details'),
        expect.objectContaining({
          path: '/',
          method: 'GET',
          headers: expect.any(Object)
        })
      );
    });
  });
});
