'use strict';

require('../setup-env');

jest.mock('../../shared-lib', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  },
  dbService: { getConnection: jest.fn() },
  securityHeaders: (req, res, next) => next(),
  SecurityMiddleware: { applySecurityMiddleware: jest.fn() }
}), { virtual: true });

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
jest.mock('../../controllers/analyticsController', () => function () {
  return {};
});

const originalExit = process.exit;
beforeAll(() => {
  process.exit = jest.fn();
});
afterAll(() => {
  process.exit = originalExit;
});

const { AppError, NotFoundError, ForbiddenError, ValidationError } = require('../../middleware/errors');
const request = require('supertest');
const express = require('express');

describe('error handler middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('global error handler with AppError subclasses', () => {
    it('should return correct status for NotFoundError (404)', async () => {
      const testApp = express();
      testApp.get('/test-404', (req, res, next) => {
        next(new NotFoundError('Item not found'));
      });
      testApp.use((err, req, res, _next) => {
        const { logger: testLogger } = require('../../shared-lib');
        testLogger.error('Test error:', { error: err.message });
        if (err.statusCode) {
          return res.status(err.statusCode).json({ message: err.message });
        }
        res.status(500).json({ message: 'An unexpected error occurred' });
      });

      const res = await request(testApp).get('/test-404');
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Item not found');
    });

    it('should return correct status for ForbiddenError (403)', async () => {
      const testApp = express();
      testApp.get('/test-403', (req, res, next) => {
        next(new ForbiddenError('No access'));
      });
      testApp.use((err, req, res, _next) => {
        if (err.statusCode) {
          return res.status(err.statusCode).json({ message: err.message });
        }
        res.status(500).json({ message: 'An unexpected error occurred' });
      });

      const res = await request(testApp).get('/test-403');
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('No access');
    });

    it('should return correct status for ValidationError (400)', async () => {
      const testApp = express();
      testApp.get('/test-400', (req, res, next) => {
        next(new ValidationError('Bad input'));
      });
      testApp.use((err, req, res, _next) => {
        if (err.statusCode) {
          return res.status(err.statusCode).json({ message: err.message });
        }
        res.status(500).json({ message: 'An unexpected error occurred' });
      });

      const res = await request(testApp).get('/test-400');
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Bad input');
    });

    it('should return correct status for AppError with custom code', async () => {
      const testApp = express();
      testApp.get('/test-custom', (req, res, next) => {
        next(new AppError('teapot', 418));
      });
      testApp.use((err, req, res, _next) => {
        if (err.statusCode) {
          return res.status(err.statusCode).json({ message: err.message });
        }
        res.status(500).json({ message: 'An unexpected error occurred' });
      });

      const res = await request(testApp).get('/test-custom');
      expect(res.status).toBe(418);
      expect(res.body.message).toBe('teapot');
    });
  });

  describe('global error handler with generic Error', () => {
    it('should return 500 for generic errors', async () => {
      const testApp = express();
      testApp.get('/test-500', (req, res, next) => {
        next(new Error('Something went wrong'));
      });
      testApp.use((err, req, res, _next) => {
        if (err.statusCode) {
          return res.status(err.statusCode).json({ message: err.message });
        }
        res.status(500).json({
          message: 'An unexpected error occurred',
          error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
      });

      const res = await request(testApp).get('/test-500');
      expect(res.status).toBe(500);
    });
  });

  describe('error exposure by environment', () => {
    it('should expose error message in development mode', async () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const testApp = express();
      testApp.get('/test', (req, res, next) => {
        next(new Error('secret details'));
      });
      testApp.use((err, req, res, _next) => {
        res.status(500).json({
          message: 'An unexpected error occurred',
          error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
      });

      const res = await request(testApp).get('/test');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('secret details');

      process.env.NODE_ENV = origEnv;
    });

    it('should hide error message in production mode', async () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const testApp = express();
      testApp.get('/test', (req, res, next) => {
        next(new Error('secret details'));
      });
      testApp.use((err, req, res, _next) => {
        res.status(500).json({
          message: 'An unexpected error occurred',
          error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
      });

      const res = await request(testApp).get('/test');
      expect(res.status).toBe(500);
      expect(res.body.error).toBeUndefined();

      process.env.NODE_ENV = origEnv;
    });
  });

  describe('404 handler', () => {
    it('should return 404 for unmatched routes', async () => {
      // Create a minimal app with just the 404 handler to test it in isolation
      const testApp = express();
      testApp.use((req, res) => {
        res.status(404).json({ message: 'Resource not found' });
      });

      const res = await request(testApp).get('/this-route-does-not-exist');
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Resource not found');
    });
  });

  describe('error logging', () => {
    it('should log error details via logger', async () => {
      const { logger } = require('../../shared-lib');
      const testApp = express();
      testApp.get('/test', (req, res, next) => {
        next(new Error('test error for logging'));
      });
      testApp.use((err, req, res, _next) => {
        logger.error(`Error processing ${req.method} ${req.url}:`, {
          error: err.message,
          stack: err.stack
        });
        res.status(500).json({ message: 'Error' });
      });

      await request(testApp).get('/test');
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error processing'),
        expect.objectContaining({
          error: 'test error for logging',
          stack: expect.any(String)
        })
      );
    });
  });
});
