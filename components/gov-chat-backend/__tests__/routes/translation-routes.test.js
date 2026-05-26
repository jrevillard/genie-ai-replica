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

// Mock the TARGET service
jest.mock('../../services/translation-service', () => ({
  translate: jest.fn(),
  translateMarkdown: jest.fn()
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
jest.mock('../../services/user-profile-service', () => ({}));
jest.mock('../../services/analytics-service', () => ({}));
jest.mock('../../services/chat-history-service', () => ({}));
jest.mock('../../services/service-category-service', () => ({}));
jest.mock('../../services/database-operations-service', () => ({}));
jest.mock('../../services/weather-service', () => ({}));
jest.mock('../../services/query-service', () => ({}));
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

const translationService = require('../../services/translation-service');
const { keycloakAuthMiddleware } = require('../../middleware/keycloak-auth-middleware');

const validToken = createValidToken();

let app;
beforeAll(() => {
  app = createApp({ services: { translationService } });
});

beforeEach(() => {
  jest.clearAllMocks();
  keycloakAuthMiddleware.authenticate.mockImplementation((req, res, next) => next());
});

function authPost(path, body) {
  return request(app).post(path).set('Authorization', `Bearer ${validToken}`).send(body);
}

// ============================================================
// AC4.1: Auth guard — both endpoints require authentication
// ============================================================
describe('Auth guard', () => {
  it('should return 401 on POST /api/translate without token', async () => {
    keycloakAuthMiddleware.authenticate.mockImplementation((req, res) => {
      res.status(401).json({ error: 'TOKEN_INVALID', message: 'Authentication required' });
    });

    const response = await request(app)
      .post('/api/translate')
      .send({ texts: ['hello'], source_lang: 'en', target_lang: 'fr' });
    expect(response.status).toBe(401);
  });

  it('should return 401 on POST /api/translate/markdown without token', async () => {
    keycloakAuthMiddleware.authenticate.mockImplementation((req, res) => {
      res.status(401).json({ error: 'TOKEN_INVALID', message: 'Authentication required' });
    });

    const response = await request(app)
      .post('/api/translate/markdown')
      .send({ markdown: '# Hello', source_lang: 'en', target_lang: 'fr' });
    expect(response.status).toBe(401);
  });
});

// ============================================================
// AC4.2: POST /api/translate
// ============================================================
describe('POST /api/translate', () => {
  it('should return 200 with translated texts', async () => {
    translationService.translate.mockResolvedValue(['Bonjour', 'Monde']);

    const response = await authPost('/api/translate', {
      texts: ['Hello', 'World'],
      source_lang: 'en',
      target_lang: 'fr'
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ translated_texts: ['Bonjour', 'Monde'] });
    expect(translationService.translate).toHaveBeenCalledWith(['Hello', 'World'], 'en', 'fr');
  });

  it('should return 400 when texts is missing', async () => {
    const response = await authPost('/api/translate', {
      source_lang: 'en',
      target_lang: 'fr'
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('texts');
  });

  it('should return 400 when source_lang is missing', async () => {
    const response = await authPost('/api/translate', {
      texts: ['Hello'],
      target_lang: 'fr'
    });

    expect(response.status).toBe(400);
  });

  it('should return 400 when target_lang is missing', async () => {
    const response = await authPost('/api/translate', {
      texts: ['Hello'],
      source_lang: 'en'
    });

    expect(response.status).toBe(400);
  });

  it('should return 400 when texts is not an array', async () => {
    const response = await authPost('/api/translate', {
      texts: 'not an array',
      source_lang: 'en',
      target_lang: 'fr'
    });

    expect(response.status).toBe(400);
  });

  it('should return 500 when translation service throws', async () => {
    translationService.translate.mockRejectedValue(new Error('Translation engine down'));

    const response = await authPost('/api/translate', {
      texts: ['Hello'],
      source_lang: 'en',
      target_lang: 'fr'
    });

    expect(response.status).toBe(500);
  });
});

// ============================================================
// AC4.3: POST /api/translate/markdown
// ============================================================
describe('POST /api/translate/markdown', () => {
  it('should return 200 with translated markdown', async () => {
    translationService.translateMarkdown.mockResolvedValue('# Bonjour');

    const response = await authPost('/api/translate/markdown', {
      markdown: '# Hello',
      source_lang: 'en',
      target_lang: 'fr'
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ translated_markdown: '# Bonjour' });
    expect(translationService.translateMarkdown).toHaveBeenCalledWith('# Hello', 'en', 'fr');
  });

  it('should return 400 when markdown is missing', async () => {
    const response = await authPost('/api/translate/markdown', {
      source_lang: 'en',
      target_lang: 'fr'
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('markdown');
  });

  it('should return 400 when source_lang is missing', async () => {
    const response = await authPost('/api/translate/markdown', {
      markdown: '# Hello',
      target_lang: 'fr'
    });

    expect(response.status).toBe(400);
  });

  it('should return 400 when target_lang is missing', async () => {
    const response = await authPost('/api/translate/markdown', {
      markdown: '# Hello',
      source_lang: 'en'
    });

    expect(response.status).toBe(400);
  });

  it('should return 500 when translation service throws', async () => {
    translationService.translateMarkdown.mockRejectedValue(new Error('Markdown engine down'));

    const response = await authPost('/api/translate/markdown', {
      markdown: '# Hello',
      source_lang: 'en',
      target_lang: 'fr'
    });

    expect(response.status).toBe(500);
  });
});
