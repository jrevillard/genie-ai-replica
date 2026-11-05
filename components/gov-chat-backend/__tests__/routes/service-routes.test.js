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

// Mock the TARGET service — automocked from the real one, so the mock can only
// expose what the service implements.
jest.mock('../../services/service-category-service', () =>
  jest.createMockFromModule('../../services/service-category-service')
);

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

const serviceCategoryService = require('../../services/service-category-service');
const { keycloakAuthMiddleware } = require('../../middleware/keycloak-auth-middleware');

const validToken = createValidToken();

let app;
beforeAll(() => {
  app = createApp({ services: { serviceCategoryService } });
});

beforeEach(() => {
  jest.clearAllMocks();
  keycloakAuthMiddleware.authenticate.mockImplementation((req, res, next) => next());
});

function authGet(path) {
  return request(app).get(path).set('Authorization', `Bearer ${validToken}`);
}

// ============================================================
// AC3.1: Auth guard — all endpoints require authentication
// ============================================================
describe('Auth guard', () => {
  it('should return 401 on GET /api/services/categories without token', async () => {
    keycloakAuthMiddleware.authenticate.mockImplementation((req, res) => {
      res.status(401).json({ error: 'TOKEN_INVALID', message: 'Authentication required' });
    });

    const response = await request(app).get('/api/services/categories');
    expect(response.status).toBe(401);
  });

  it('should return 401 on GET /api/services/categories/:id without token', async () => {
    keycloakAuthMiddleware.authenticate.mockImplementation((req, res) => {
      res.status(401).json({ error: 'TOKEN_INVALID', message: 'Authentication required' });
    });

    const response = await request(app).get('/api/services/categories/cat1');
    expect(response.status).toBe(401);
  });

  it('should return 401 on GET /api/services/search without token', async () => {
    keycloakAuthMiddleware.authenticate.mockImplementation((req, res) => {
      res.status(401).json({ error: 'TOKEN_INVALID', message: 'Authentication required' });
    });

    const response = await request(app).get('/api/services/search');
    expect(response.status).toBe(401);
  });
});

// ============================================================
// #442: the three /api/services GET routes are 301 redirects to the
// canonical /api/service-categories paths (service-category-routes.js).
// The query string must survive the redirect.
// ============================================================
describe('GET /api/services/categories redirects to the canonical route', () => {
  it('should 301 to /api/service-categories/categories', async () => {
    const response = await authGet('/api/services/categories');

    expect(response.status).toBe(301);
    expect(response.headers.location).toBe('/api/service-categories/categories');
    expect(serviceCategoryService.getAllCategoriesWithServices).not.toHaveBeenCalled();
  });

  it('should preserve the query string in the redirect target', async () => {
    const response = await authGet('/api/services/categories?locale=fr');

    expect(response.status).toBe(301);
    expect(response.headers.location).toBe('/api/service-categories/categories?locale=fr');
  });
});

describe('GET /api/services/categories/:categoryId redirects to the canonical route', () => {
  it('should 301 to /api/service-categories/categories/:categoryId', async () => {
    const response = await authGet('/api/services/categories/cat1');

    expect(response.status).toBe(301);
    expect(response.headers.location).toBe('/api/service-categories/categories/cat1');
    expect(serviceCategoryService.getCategoryWithServices).not.toHaveBeenCalled();
  });
});

describe('GET /api/services/search redirects to the canonical route', () => {
  it('should 301 to /api/service-categories/search with the query string', async () => {
    const response = await authGet('/api/services/search?query=health');

    expect(response.status).toBe(301);
    expect(response.headers.location).toBe('/api/service-categories/search?query=health');
    expect(serviceCategoryService.searchCategoriesAndServices).not.toHaveBeenCalled();
  });
});
