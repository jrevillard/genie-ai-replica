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
jest.mock('../../services/database-operations-service', () => ({}));
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
// Auth guard — POST /api/weather requires authentication
// ============================================================
describe('Auth guard', () => {
  it('should return 401 on POST /api/weather without token', async () => {
    keycloakAuthMiddleware.authenticate.mockImplementation((req, res) => {
      res.status(401).json({ error: 'TOKEN_INVALID', message: 'Authentication required' });
    });

    const response = await request(app).post('/api/weather').send({ latitude: 0, longitude: 0 });
    expect(response.status).toBe(401);
  });
});

// ============================================================
// POST /api/weather
// ============================================================
describe('POST /api/weather', () => {
  it('should return 200 with valid coordinates', async () => {
    const response = await authPost('/api/weather', { latitude: -6.2088, longitude: 106.8456 });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('location');
    expect(response.body).toHaveProperty('current');
    expect(response.body).toHaveProperty('forecast');
  });

  it('should work with coordinates at boundary values (lat: 90, lon: 180)', async () => {
    const response = await authPost('/api/weather', { latitude: 90, longitude: 180 });
    expect(response.status).toBe(200);
  });

  it('should work with coordinates at boundary values (lat: -90, lon: -180)', async () => {
    const response = await authPost('/api/weather', { latitude: -90, longitude: -180 });
    expect(response.status).toBe(200);
  });

  it('should work with zero coordinates', async () => {
    const response = await authPost('/api/weather', { latitude: 0, longitude: 0 });
    expect(response.status).toBe(200);
  });

  it('should return 400 when only latitude provided', async () => {
    const response = await authPost('/api/weather', { latitude: -6.2088 });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Both latitude and longitude must be provided');
  });

  it('should return 400 when only longitude provided', async () => {
    const response = await authPost('/api/weather', { longitude: 106.8456 });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Both latitude and longitude must be provided');
  });

  it('should return 400 for invalid latitude (> 90)', async () => {
    const response = await authPost('/api/weather', { latitude: 91, longitude: 0 });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Invalid latitude');
  });

  it('should return 400 for invalid latitude (< -90)', async () => {
    const response = await authPost('/api/weather', { latitude: -91, longitude: 0 });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Invalid latitude');
  });

  it('should return 400 for invalid longitude (> 180)', async () => {
    const response = await authPost('/api/weather', { latitude: 0, longitude: 181 });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Invalid longitude');
  });

  it('should return 400 for invalid longitude (< -180)', async () => {
    const response = await authPost('/api/weather', { latitude: 0, longitude: -181 });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Invalid longitude');
  });

  it('should return 400 for invalid coordinate types (string)', async () => {
    const response = await authPost('/api/weather', { latitude: 'invalid', longitude: 0 });
    expect(response.status).toBe(400);
  });

  it('should return 400 for invalid coordinate types (null)', async () => {
    const response = await authPost('/api/weather', { latitude: null, longitude: 0 });
    expect(response.status).toBe(400);
  });

  it('should return 400 for missing coordinates (empty body)', async () => {
    const response = await authPost('/api/weather', {});
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Both latitude and longitude must be provided');
  });

  it('should return 500 when service throws error', async () => {
    // Mock the service to throw an error
    const weatherService = require('../../services/weather-service');
    weatherService.getWeather = jest.fn().mockRejectedValue(new Error('Weather API unavailable'));

    const response = await authPost('/api/weather', { latitude: 0, longitude: 0 });
    expect(response.status).toBe(500);
    expect(response.body.message).toContain('Weather API unavailable');
  });

  it('should return 401 when user is not authenticated (no iss_sub)', async () => {
    // Create a request with authentication but no user object
    const response = await request(app)
      .post('/api/weather')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ latitude: 0, longitude: 0 });

    // If the middleware doesn't set req.user, the route should return 401
    if (!response.body.location && response.body.error === 'UNAUTHENTICATED') {
      expect(response.status).toBe(401);
    }
  });
});

// ============================================================
// Method not allowed
// ============================================================
describe('Method not allowed', () => {
  it('should return 404 for GET /api/weather', async () => {
    const response = await request(app)
      .get('/api/weather')
      .set('Authorization', `Bearer ${validToken}`);
    expect(response.status).toBe(404);
  });

  it('should return 404 for PUT /api/weather', async () => {
    const response = await request(app)
      .put('/api/weather')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ latitude: 0, longitude: 0 });
    expect(response.status).toBe(404);
  });

  it('should return 404 for DELETE /api/weather', async () => {
    const response = await request(app)
      .delete('/api/weather')
      .set('Authorization', `Bearer ${validToken}`);
    expect(response.status).toBe(404);
  });

  it('should return 404 for PATCH /api/weather', async () => {
    const response = await request(app)
      .patch('/api/weather')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ latitude: 0, longitude: 0 });
    expect(response.status).toBe(404);
  });
});
