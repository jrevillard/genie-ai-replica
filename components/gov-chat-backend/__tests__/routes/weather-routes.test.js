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

// Mock weather service with proper implementation
jest.mock('../../services/weather-service', () => {
  return jest.fn().mockImplementation(() => ({
    init: jest.fn().mockResolvedValue(undefined),
    getWeather: jest.fn().mockResolvedValue({
      location: { name: 'Jakarta', country: 'Indonesia' },
      current: { temp: 30, condition: 'Cloudy' },
      forecast: []
    }),
    setAnalyticsService: jest.fn()
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
jest.mock('../../services/database-operations-service', () => ({}));
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
const WeatherService = require('../../services/weather-service');

const { keycloakAuthMiddleware } = require('../../middleware/keycloak-auth-middleware');

const validToken = createValidToken();

let app;
let weatherService;

beforeAll(() => {
  weatherService = new WeatherService();
  app = createApp({ services: { weatherService } });
});

beforeEach(() => {
  jest.clearAllMocks();
  // Set up middleware to pass through and set req.user
  keycloakAuthMiddleware.authenticate.mockImplementation((req, res, next) => {
    req.user = {
      iss_sub: 'http://localhost:8080/realms/genie#user-123',
      sub: 'user-123',
      iss: 'http://localhost:8080/realms/genie'
    };
    next();
  });
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

  it('should return 503 CITY_NOT_FOUND for (0, 0) — mid-ocean coords have no city within 25km', async () => {
    // Post-Issue-8 contract: the service no longer falls back to a default
    // location. (0, 0) is in the South Atlantic — no populated place within
    // the offline index's lookup radius — and the typed 503 surfaces as
    // weatherErrorDefault in the UI. The service is mocked here so the
    // contract is asserted at the route layer.
    weatherService.getWeather.mockRejectedValueOnce(
      Object.assign(new Error('No city found near the provided coordinates'), {
        statusCode: 503,
        code: 'CITY_NOT_FOUND'
      })
    );
    const response = await authPost('/api/weather', { latitude: 0, longitude: 0 });
    expect(response.status).toBe(503);
    expect(response.body.error).toBe('CITY_NOT_FOUND');
  });

  it('should return 400 when only latitude provided', async () => {
    const response = await authPost('/api/weather', { latitude: -6.2088 });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Valid latitude and longitude are required');
  });

  it('should return 400 when only longitude provided', async () => {
    const response = await authPost('/api/weather', { longitude: 106.8456 });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Valid latitude and longitude are required');
  });

  it('should return 400 LOCATION_REQUIRED for invalid latitude (> 90)', async () => {
    // Range validation now lives in the service; the route maps the typed
    // 400 error back to the client. No silent fallback to a default.
    weatherService.getWeather.mockRejectedValueOnce(
      Object.assign(new Error('Valid latitude and longitude are required'), {
        statusCode: 400,
        code: 'LOCATION_REQUIRED'
      })
    );
    const response = await authPost('/api/weather', { latitude: 91, longitude: 1 });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('LOCATION_REQUIRED');
  });

  it('should return 400 LOCATION_REQUIRED for invalid latitude (< -90)', async () => {
    weatherService.getWeather.mockRejectedValueOnce(
      Object.assign(new Error('Valid latitude and longitude are required'), {
        statusCode: 400,
        code: 'LOCATION_REQUIRED'
      })
    );
    const response = await authPost('/api/weather', { latitude: -91, longitude: 1 });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('LOCATION_REQUIRED');
  });

  it('should return 400 LOCATION_REQUIRED for invalid longitude (> 180)', async () => {
    weatherService.getWeather.mockRejectedValueOnce(
      Object.assign(new Error('Valid latitude and longitude are required'), {
        statusCode: 400,
        code: 'LOCATION_REQUIRED'
      })
    );
    const response = await authPost('/api/weather', { latitude: 1, longitude: 181 });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('LOCATION_REQUIRED');
  });

  it('should return 400 LOCATION_REQUIRED for invalid longitude (< -180)', async () => {
    weatherService.getWeather.mockRejectedValueOnce(
      Object.assign(new Error('Valid latitude and longitude are required'), {
        statusCode: 400,
        code: 'LOCATION_REQUIRED'
      })
    );
    const response = await authPost('/api/weather', { latitude: 1, longitude: -181 });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('LOCATION_REQUIRED');
  });

  it('should return 400 LOCATION_REQUIRED for invalid coordinate types (string)', async () => {
    // Strings that do not parse to numbers hit the service's Number.isFinite
    // check and surface as a typed 400 — no silent default.
    weatherService.getWeather.mockRejectedValueOnce(
      Object.assign(new Error('Valid latitude and longitude are required'), {
        statusCode: 400,
        code: 'LOCATION_REQUIRED'
      })
    );
    const response = await authPost('/api/weather', { latitude: 'invalid', longitude: 0 });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('LOCATION_REQUIRED');
  });

  it('should return 400 when latitude is null', async () => {
    // Null coords are caught by the route's explicit null guard before
    // the service is invoked — short-circuit, no wasted call.
    const response = await authPost('/api/weather', { latitude: null, longitude: 0 });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('LOCATION_REQUIRED');
    expect(weatherService.getWeather).not.toHaveBeenCalled();
  });

  it('should return 400 LOCATION_REQUIRED when no coordinates are provided', async () => {
    // Privacy-respectful: the server does not invent a position. Empty
    // body → explicit 400, never a silently-mislocated forecast.
    const response = await authPost('/api/weather', {});
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('LOCATION_REQUIRED');
    expect(weatherService.getWeather).not.toHaveBeenCalled();
  });

  it('should return 500 when service throws a generic error', async () => {
    // Override the service mock for this test
    weatherService.getWeather.mockRejectedValueOnce(new Error('Weather API unavailable'));

    const response = await authPost('/api/weather', { latitude: 0, longitude: 0 });
    expect(response.status).toBe(500);
    expect(response.body.message).toContain('Weather API unavailable');
  });

  it('should return 503 when service throws a typed upstream-unavailable error', async () => {
    // Mirrors the ea3e08253 graceful-degradation pattern: external upstream
    // failures surface as 503, not generic 500.
    const typedError = Object.assign(new Error('Weather service temporarily unavailable'), {
      statusCode: 503,
      code: 'WEATHER_UPSTREAM_UNAVAILABLE'
    });
    weatherService.getWeather.mockRejectedValueOnce(typedError);

    const response = await authPost('/api/weather', { latitude: 46.2, longitude: 6.15 });
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      error: 'WEATHER_UPSTREAM_UNAVAILABLE'
    });
  });

  // Note: The middleware is mocked to always pass authentication in this test suite.
  // Testing actual 401 behavior when req.user is not set would require mocking the middleware
  // differently per test, which adds complexity. The route logic checks req.user.iss_sub
  // and returns 401 if missing, but our mock always sets it.
  // This test would require a more complex mock setup to override per test.
  //
  // it('should return 401 when user is not authenticated (no iss_sub)', async () => {
  //   // Would need to override middleware mock for this specific test
  // });
});

// ============================================================
// Method not allowed
// ============================================================
describe('Method not allowed', () => {
  it('should return 404 for GET /api/weather', async () => {
    const response = await request(app).get('/api/weather').set('Authorization', `Bearer ${validToken}`);
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
    const response = await request(app).delete('/api/weather').set('Authorization', `Bearer ${validToken}`);
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
