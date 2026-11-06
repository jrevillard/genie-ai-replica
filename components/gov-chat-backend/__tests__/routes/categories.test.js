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

// Mock session-service singleton (loaded by index.js)
jest.mock('../../services/session-service', () => ({
  getUserSessions: jest.fn(),
  endSession: jest.fn(),
  createSession: jest.fn()
}));

// Automock the real service: the mock can only expose what the service
// implements, so a route calling a method the service lacks cannot pass its
// own test.
jest.mock('../../services/service-category-service', () =>
  jest.createMockFromModule('../../services/service-category-service')
);

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

// Mock all other services loaded by index.js
jest.mock('../../services/user-profile-service', () => ({}));
jest.mock('../../services/admin-dashboard-service', () => ({}));
jest.mock('../../services/analytics-service', () => ({}));
jest.mock('../../services/query-service', () => ({}));
jest.mock('../../services/chat-history-service', () => ({}));
jest.mock('../../services/logs-service', () => ({}));
jest.mock('../../services/database-operations-service', () => ({}));
jest.mock('../../services/weather-service', () => ({}));
jest.mock('../../services/security-scan-service', () => ({}));
jest.mock('../../services/translation-service', () => ({}));

// Mock analytics controller (required to prevent errors when index.js loads analytics-routes)
jest.mock('../../controllers/analyticsController', () => {
  return function () {
    return {};
  };
});

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
const { AppError, NotFoundError } = require('../../middleware/errors');
const { createValidToken } = require('../fixtures/tokens');
const { createMockUser } = require('../fixtures/users');

// Get references to mocked modules
const keycloakAuthService = require('../../services/keycloak-auth-service');
const userProvisioningService = require('../../services/user-provisioning-service');
const serviceCategoryService = require('../../services/service-category-service');

const mockUser = createMockUser();
const validToken = createValidToken();

// Create app once for all tests
let app;
beforeAll(() => {
  app = createApp({ services: { serviceCategoryService } });
});

beforeEach(() => {
  jest.clearAllMocks();

  // Default: middleware passes through with valid user
  keycloakAuthService.verifyToken.mockResolvedValue({
    sub: 'user-123',
    iss: 'http://localhost:8080/realms/genie',
    iss_sub: 'http://localhost:8080/realms/genie#user-123',
    realm_access: { roles: ['user'] }
  });
  keycloakAuthService.checkUserStatusInKeycloak.mockResolvedValue(null);
  userProvisioningService.provisionUser.mockResolvedValue(mockUser);
});

// Helpers for authenticated requests
function authGet(path) {
  return request(app).get(path).set('Authorization', `Bearer ${validToken}`);
}
function authPost(path, body) {
  return request(app).post(path).set('Authorization', `Bearer ${validToken}`).send(body);
}
function authPut(path, body) {
  return request(app).put(path).set('Authorization', `Bearer ${validToken}`).send(body);
}
function authDelete(path) {
  return request(app).delete(path).set('Authorization', `Bearer ${validToken}`);
}

// ============================================================
// Auth guard — all service-categories routes require authentication
// ============================================================
describe('Auth guard', () => {
  it('should return 401 on GET /api/service-categories/categories without token', async () => {
    const response = await request(app).get('/api/service-categories/categories');
    expect(response.status).toBe(401);
  });

  it('should return 401 on POST /api/service-categories without token', async () => {
    const response = await request(app).post('/api/service-categories').send({ nameEN: 'test' });
    expect(response.status).toBe(401);
  });
});

// ============================================================
// AC10: GET /api/service-categories/categories
// ============================================================
describe('GET /api/service-categories/categories (AC10)', () => {
  it('should return 200 with category list', async () => {
    const categories = [{ catKey: 'cat-1', name: 'Health', children: ['service-1'] }];
    serviceCategoryService.getAllCategoriesWithServices.mockResolvedValue(categories);

    const response = await authGet('/api/service-categories/categories');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(categories);
    expect(serviceCategoryService.getAllCategoriesWithServices).toHaveBeenCalledWith('en');
  });

  it('should pass locale query param', async () => {
    serviceCategoryService.getAllCategoriesWithServices.mockResolvedValue([]);

    const response = await authGet('/api/service-categories/categories?locale=fr');

    expect(response.status).toBe(200);
    expect(serviceCategoryService.getAllCategoriesWithServices).toHaveBeenCalledWith('fr');
  });
});

// ============================================================
// AC11: GET /api/service-categories/categories/detailed
// ============================================================
describe('GET /api/service-categories/categories/detailed (AC11)', () => {
  it('should return 200 with detailed category data', async () => {
    const detailedCategories = [
      { catKey: 'cat-1', name: 'Health', services: [{ _key: 'svc-1', nameEN: 'Vaccination' }] }
    ];
    serviceCategoryService.getAdminAllCategoriesWithServices.mockResolvedValue(detailedCategories);

    const response = await authGet('/api/service-categories/categories/detailed');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(detailedCategories);
    expect(serviceCategoryService.getAdminAllCategoriesWithServices).toHaveBeenCalledWith('en');
  });
});

// ============================================================
// AC12: GET /api/service-categories/categories/:categoryId
// ============================================================
describe('GET /api/service-categories/categories/:categoryId (AC12)', () => {
  it('should return 200 with single category when valid ID', async () => {
    const category = { catKey: 'cat-1', name: 'Health', children: ['service-1'] };
    serviceCategoryService.getCategoryWithServices.mockResolvedValue(category);

    const response = await authGet('/api/service-categories/categories/cat-1');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(category);
    expect(serviceCategoryService.getCategoryWithServices).toHaveBeenCalledWith('cat-1', 'en');
  });

  it('should return 404 when category not found', async () => {
    serviceCategoryService.getCategoryWithServices.mockRejectedValue(new NotFoundError('Category not found'));

    const response = await authGet('/api/service-categories/categories/nonexistent');

    expect(response.status).toBe(404);
  });
});

// ============================================================
// AC13: Translation endpoints
// ============================================================
describe('GET /api/service-categories/:categoryId/translations (AC13)', () => {
  it('should return 200 with translation list', async () => {
    const translations = [
      { lang: 'FR', text: 'Santé et services sociaux' },
      { lang: 'SW', text: 'Afya na huduma za kijamii' }
    ];
    serviceCategoryService.getCategoryTranslations.mockResolvedValue(translations);

    const response = await authGet('/api/service-categories/cat-1/translations');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(translations);
    expect(serviceCategoryService.getCategoryTranslations).toHaveBeenCalledWith('cat-1');
  });
});

describe('GET /api/service-categories/services/:serviceId/translations (AC13)', () => {
  it('should return 200 with the service translations read shape {lang, text}', async () => {
    // The real service projects {lang (lowercased), text} — not the write
    // shape {languageCode, translation}.
    const translations = [{ lang: 'fr', text: 'Vaccination' }];
    serviceCategoryService.getServiceTranslations.mockResolvedValue(translations);

    const response = await authGet('/api/service-categories/services/svc-1/translations');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(translations);
    expect(serviceCategoryService.getServiceTranslations).toHaveBeenCalledWith('svc-1');
  });
});

// ============================================================
// AC14: GET /api/service-categories/search
// ============================================================
describe('GET /api/service-categories/search (AC14)', () => {
  it('should return 200 with search results containing categories and services arrays', async () => {
    const searchResults = {
      categories: [{ type: 'category', key: 'cat-1', name: 'Health' }],
      services: [{ type: 'service', key: 'svc-1', name: 'Vaccination', categoryKey: 'cat-1', categoryName: 'Health' }]
    };
    serviceCategoryService.searchCategoriesAndServices.mockResolvedValue(searchResults);

    const response = await authGet('/api/service-categories/search?query=health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(searchResults);
    expect(serviceCategoryService.searchCategoriesAndServices).toHaveBeenCalledWith('health', 'en');
  });

  it('should return 400 when query param missing', async () => {
    const response = await authGet('/api/service-categories/search');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Search query is required' });
  });
});

// ============================================================
// AC15: POST /api/service-categories
// ============================================================
describe('POST /api/service-categories (AC15)', () => {
  it('should return 201 with created category when valid nameEN provided', async () => {
    const createdCategory = { _key: 'cat-new', nameEN: 'Education' };
    serviceCategoryService.createCategory.mockResolvedValue(createdCategory);

    const response = await authPost('/api/service-categories', { nameEN: 'Education' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(createdCategory);
    expect(serviceCategoryService.createCategory).toHaveBeenCalledWith({ nameEN: 'Education' });
  });

  it('should return 400 when nameEN missing', async () => {
    const response = await authPost('/api/service-categories', {});

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Payload with nameEN is required' });
  });
});

// ============================================================
// AC16: DELETE endpoints
// ============================================================
describe('DELETE /api/service-categories/:categoryId (AC16)', () => {
  it('should return 200 when category exists', async () => {
    serviceCategoryService.categoryExists.mockResolvedValue(true);
    serviceCategoryService.deleteCategory.mockResolvedValue({});

    const response = await authDelete('/api/service-categories/cat-1');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'Category cat-1 deleted successfully' });
    expect(serviceCategoryService.categoryExists).toHaveBeenCalledWith('cat-1');
    expect(serviceCategoryService.deleteCategory).toHaveBeenCalledWith('cat-1');
    // Verify categoryExists is called before deleteCategory
    const existsOrder = serviceCategoryService.categoryExists.mock.invocationCallOrder[0];
    const deleteOrder = serviceCategoryService.deleteCategory.mock.invocationCallOrder[0];
    expect(existsOrder).toBeLessThan(deleteOrder);
  });

  it('should return 404 when category not found', async () => {
    serviceCategoryService.categoryExists.mockResolvedValue(false);

    const response = await authDelete('/api/service-categories/nonexistent');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Category nonexistent not found' });
    expect(serviceCategoryService.deleteCategory).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/service-categories/services/:serviceId (AC16)', () => {
  it('should return 200 when service exists', async () => {
    serviceCategoryService.deleteService.mockResolvedValue({});

    const response = await authDelete('/api/service-categories/services/svc-1');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'Service svc-1 deleted successfully' });
    expect(serviceCategoryService.deleteService).toHaveBeenCalledWith('svc-1');
  });

  it('should return 404 when service not found', async () => {
    serviceCategoryService.deleteService.mockRejectedValue(new NotFoundError('Service not found'));

    const response = await authDelete('/api/service-categories/services/nonexistent');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Service not found' });
  });
});

// ============================================================
// AC17: PUT endpoints
// ============================================================
describe('PUT /api/service-categories/:categoryId (AC17)', () => {
  it('should return 200 with updated category', async () => {
    const updatedCategory = { _key: 'cat-1', nameEN: 'Health Updated' };
    serviceCategoryService.updateCategoryWithTranslations.mockResolvedValue(updatedCategory);

    const response = await authPut('/api/service-categories/cat-1', { nameEN: 'Health Updated' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(updatedCategory);
    expect(serviceCategoryService.updateCategoryWithTranslations).toHaveBeenCalledWith('cat-1', {
      nameEN: 'Health Updated'
    });
  });
});

describe('PUT /api/service-categories/services/:serviceId (AC17)', () => {
  it('should return 200 with updated service', async () => {
    const updatedService = { _key: 'svc-1', nameEN: 'Vaccination Updated' };
    serviceCategoryService.updateServiceWithTranslations.mockResolvedValue(updatedService);

    const response = await authPut('/api/service-categories/services/svc-1', { nameEN: 'Vaccination Updated' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(updatedService);
    expect(serviceCategoryService.updateServiceWithTranslations).toHaveBeenCalledWith('svc-1', {
      nameEN: 'Vaccination Updated'
    });
  });
});

// ============================================================
// ValidationError from the service layer is a client mistake —
// write handlers must answer 400, not 500.
// ============================================================
describe('write handlers map ValidationError to 400', () => {
  // { method, path, serviceKey } for each write handler that can reject
  // with a ValidationError raised on its payload.
  const cases = [
    { verb: 'post', path: '/api/service-categories', serviceKey: 'createCategory', body: { nameEN: 'X' } },
    {
      verb: 'put',
      path: '/api/service-categories/cat-1',
      serviceKey: 'updateCategoryWithTranslations',
      body: { nameEN: 'X' }
    },
    {
      verb: 'post',
      path: '/api/service-categories/cat-1/services',
      serviceKey: 'createServiceWithTranslations',
      body: { nameEN: 'X' }
    },
    {
      verb: 'put',
      path: '/api/service-categories/services/svc-1',
      serviceKey: 'updateServiceWithTranslations',
      body: { nameEN: 'X' }
    }
  ];

  cases.forEach(({ verb, path, serviceKey, body }) => {
    it(`${verb.toUpperCase()} ${path} returns 400 on ValidationError`, async () => {
      // The service layer throws a real ValidationError; the route checks
      // the class identity with instanceof.
      const { ValidationError } = require('../../middleware/errors');
      serviceCategoryService[serviceKey].mockRejectedValue(new ValidationError('nameEN is required'));

      const response = await request(app)[verb](path).set('Authorization', `Bearer ${validToken}`).send(body);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ message: 'nameEN is required' });
    });
  });

  it('PUT /api/service-categories/cat-1 still returns 500 for non-validation errors', async () => {
    serviceCategoryService.updateCategoryWithTranslations.mockRejectedValue(new Error('boom'));

    const response = await authPut('/api/service-categories/cat-1', { nameEN: 'X' });

    // Generic errors reach the global error middleware, which answers a
    // uniform 500 body (details only in development mode).
    expect(response.status).toBe(500);
    expect(response.body.message).toBe('An unexpected error occurred');
  });
});

// ============================================================
// AC21: POST /api/service-categories/:categoryId/services
// ============================================================
describe('POST /api/service-categories/:categoryId/services (AC21)', () => {
  it('should return 201 with created service when valid payload provided', async () => {
    const newService = { _key: 'svc-new', nameEN: 'Emergency Care', categoryKey: 'cat-1' };
    serviceCategoryService.createServiceWithTranslations.mockResolvedValue(newService);

    const response = await authPost('/api/service-categories/cat-1/services', { nameEN: 'Emergency Care' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(newService);
    expect(serviceCategoryService.createServiceWithTranslations).toHaveBeenCalledWith('cat-1', {
      nameEN: 'Emergency Care'
    });
  });
});

// ============================================================
// POST /api/service-categories/init — removed
// ============================================================
// Pinned as absent, so it cannot come back wired to a service method that does
// not exist. Seeding a taxonomy goes through the Knowledge Hierarchy tab of the
// Admin Dashboard or the create-knowledge-hierarchy.js script.
describe('POST /api/service-categories/init', () => {
  it('should return 404 — the endpoint no longer exists', async () => {
    const response = await authPost('/api/service-categories/init', {});

    expect(response.status).toBe(404);
  });
});

// ============================================================
// Error-path contract: the remaining catch blocks forward to the
// global error middleware (which renders typed statusCode), instead
// of answering a flat local 500.
// ============================================================
describe('error-path status contract', () => {
  it.each([
    ['GET', '/api/service-categories/categories', 'getAllCategoriesWithServices'],
    ['GET', '/api/service-categories/categories/detailed', 'getAdminAllCategoriesWithServices'],
    ['GET', '/api/service-categories/cat-1/translations', 'getCategoryTranslations'],
    ['GET', '/api/service-categories/services/svc-1/translations', 'getServiceTranslations'],
    ['GET', '/api/service-categories/search?query=health', 'searchCategoriesAndServices'],
    ['DELETE', '/api/service-categories/cat-1', 'deleteCategory']
  ])('%s %s renders a typed status instead of a flat 500', async (method, path, methodName) => {
    serviceCategoryService[methodName].mockRejectedValue(new AppError('gone wrong', 503));
    if (methodName === 'deleteCategory') {
      serviceCategoryService.categoryExists.mockResolvedValue(true);
    }

    const response = await request(app)[method.toLowerCase()](path).set('Authorization', `Bearer ${validToken}`);

    expect(response.status).toBe(503);
    expect(serviceCategoryService[methodName]).toHaveBeenCalled();
  });
});

// ============================================================
// Logging contract (#1462): an expected 404 is an outcome, not a
// fault — it is logged ONCE, at warn grade, without a stack, and
// never at error grade.
// ============================================================
describe('expected 404 logging contract', () => {
  const { logger } = require('../../shared-lib');

  it('logs an unknown service id once at warn grade, never at error grade', async () => {
    serviceCategoryService.deleteService.mockRejectedValue(new NotFoundError('Service not found'));

    const response = await authDelete('/api/service-categories/services/nonexistent');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Service not found' });
    // One line, at warn grade ...
    const warnCalls = logger.warn.mock.calls.filter((call) => String(call[0]).includes('Service not found'));
    expect(warnCalls).toHaveLength(1);
    // ... and no stack on it (a stack is what makes an expected outcome
    // expensive to read).
    expect(warnCalls[0][1] || {}).not.toHaveProperty('stack');
    // ... and nothing at error grade for THIS failure (another part of the
    // request may legitimately log an error of its own).
    const errorCalls = logger.error.mock.calls.filter((call) => String(call[0]).includes('Service not found'));
    expect(errorCalls).toHaveLength(0);
  });
});

// ============================================================
// Factory statefulness: each factory call returns its OWN router,
// routing to ITS service instance (a module-level router would stack
// both mounts' routes on one router whose handlers close over the
// first service).
// ============================================================
describe('routes factory', () => {
  it('returns an independent router per call, each bound to its own service', async () => {
    const buildRoutes = require('../../routes/service-category-routes');
    const express = require('express');

    const makeService = (label) => ({
      getAllCategoriesWithServices: jest.fn().mockResolvedValue([{ catKey: label }]),
      keycloakAuthMiddleware: undefined
    });
    const serviceA = makeService('A');
    const serviceB = makeService('B');

    const routerA = buildRoutes(serviceA);
    const routerB = buildRoutes(serviceB);
    expect(routerA).not.toBe(routerB);

    const appA = express();
    const appB = express();
    appA.use('/api/service-categories', routerA);
    appB.use('/api/service-categories', routerB);

    const [resA, resB] = await Promise.all([
      request(appA).get('/api/service-categories/categories').set('Authorization', `Bearer ${validToken}`),
      request(appB).get('/api/service-categories/categories').set('Authorization', `Bearer ${validToken}`)
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(resA.body).toEqual([{ catKey: 'A' }]);
    expect(resB.body).toEqual([{ catKey: 'B' }]);
    expect(serviceA.getAllCategoriesWithServices).toHaveBeenCalledTimes(1);
    expect(serviceB.getAllCategoriesWithServices).toHaveBeenCalledTimes(1);
  });
});
