'use strict';

require('../setup-env');

jest.mock('../../shared-lib', () => require('../mocks/shared-lib'), { virtual: true });

jest.mock('../../services/keycloak-auth-service', () => ({
  verifyToken: jest.fn(),
  checkUserStatusInKeycloak: jest.fn()
}));

jest.mock('../../services/user-provisioning-service', () => ({
  provisionUser: jest.fn(),
  initialize: jest.fn(),
  markUserAsDeleted: jest.fn()
}));

jest.mock('../../services/session-service', () => ({
  getUserSessions: jest.fn(),
  endSession: jest.fn(),
  createSession: jest.fn()
}));

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

jest.mock('../../services/logs-service', () => ({
  getLogsSummary: jest.fn()
}));

jest.mock('../../services/security-scan-service', () => ({
  getLastScanDetails: jest.fn(),
  runSecurityScan: jest.fn()
}));

jest.mock('../../services/query-service', () => ({
  getQueriesForInspector: jest.fn(),
  getQueryInspectorDetails: jest.fn()
}));

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

jest.mock('../../services/user-profile-service', () => ({}));
jest.mock('../../services/analytics-service', () => ({}));
jest.mock('../../services/chat-history-service', () => ({}));
jest.mock('../../services/service-category-service', () => ({}));
jest.mock('../../services/database-operations-service', () => ({}));
jest.mock('../../services/weather-service', () => ({}));
jest.mock('../../services/translation-service', () => ({
  translate: jest.fn()
}));

jest.mock(
  '../../routes/translation-routes',
  () => {
    const express = require('express');
    return express.Router();
  },
  { virtual: true }
);

jest.mock('../../middleware/keycloak-auth-middleware', () => ({
  keycloakAuthMiddleware: {
    authenticate: jest.fn((req, res, next) => next()),
    requireAdmin: jest.fn((req, res, next) => next())
  }
}));

const originalExit = process.exit;
beforeAll(() => {
  process.exit = jest.fn();
});
afterAll(() => {
  process.exit = originalExit;
});

const express = require('express');
const request = require('supertest');
const { createValidToken } = require('../fixtures/tokens');

const { keycloakAuthMiddleware } = require('../../middleware/keycloak-auth-middleware');
const queryService = require('../../services/query-service');

const validToken = createValidToken();

let app;

beforeAll(() => {
  jest.clearAllMocks();

  // Build a minimal app that mirrors the real admin-routes setup
  app = express();
  app.use(express.json());

  // Apply the same auth middleware pattern as the real app
  app.use('/api/admin', keycloakAuthMiddleware.authenticate);

  // Load admin routes with the mocked services
  const adminService = require('../../services/admin-dashboard-service');
  const logsService = require('../../services/logs-service');
  const adminRoutes = require('../../routes/admin-routes');
  const router = adminRoutes(adminService, logsService);
  app.use('/api/admin', router);
});

beforeEach(() => {
  jest.clearAllMocks();
  keycloakAuthMiddleware.authenticate.mockImplementation((req, res, next) => next());
  keycloakAuthMiddleware.requireAdmin.mockImplementation((req, res, next) => next());
});

function authGet(path) {
  return request(app).get(path).set('Authorization', `Bearer ${validToken}`);
}

describe('Query Inspector Routes', () => {
  describe('GET /api/admin/queries/inspect', () => {
    it('should return 200 with paginated queries', async () => {
      const mockResponse = {
        success: true,
        data: {
          queries: [{ _key: 'q1', text: 'What is tax rate?', metadata: { confidence_score: 0.9 } }],
          pagination: { total: 1, limit: 50, offset: 0, pages: 1, currentPage: 1 }
        }
      };
      queryService.getQueriesForInspector.mockResolvedValue(mockResponse);

      const response = await authGet('/api/admin/queries/inspect');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.queries).toHaveLength(1);
      expect(queryService.getQueriesForInspector).toHaveBeenCalledWith({});
    });

    it('should pass query parameters to service', async () => {
      queryService.getQueriesForInspector.mockResolvedValue({
        success: true,
        data: { queries: [], pagination: { total: 0, limit: 10, offset: 0, pages: 0, currentPage: 1 } }
      });

      await authGet(
        '/api/admin/queries/inspect?limit=10&offset=20&searchText=tax&minConfidence=0.5&maxConfidence=1.0&userId=user-1&startDate=2025-01-01&endDate=2025-12-31'
      );

      expect(queryService.getQueriesForInspector).toHaveBeenCalledWith({
        limit: '10',
        offset: '20',
        searchText: 'tax',
        minConfidence: '0.5',
        maxConfidence: '1.0',
        userId: 'user-1',
        startDate: '2025-01-01',
        endDate: '2025-12-31'
      });
    });

    it('should require admin authentication', async () => {
      keycloakAuthMiddleware.authenticate.mockImplementation((req, res) => {
        res.status(401).json({ error: 'TOKEN_INVALID', message: 'Authentication required' });
      });

      const response = await request(app).get('/api/admin/queries/inspect');

      expect(response.status).toBe(401);
      expect(queryService.getQueriesForInspector).not.toHaveBeenCalled();
    });

    it('should require admin role', async () => {
      keycloakAuthMiddleware.requireAdmin.mockImplementation((req, res) => {
        res.status(403).json({ error: 'FORBIDDEN', message: 'Admin access required' });
      });

      const response = await authGet('/api/admin/queries/inspect');

      expect(response.status).toBe(403);
      expect(queryService.getQueriesForInspector).not.toHaveBeenCalled();
    });

    it('should return 500 on service error', async () => {
      queryService.getQueriesForInspector.mockRejectedValue(new Error('DB error'));

      const response = await authGet('/api/admin/queries/inspect');

      expect(response.status).toBe(500);
    });
  });

  describe('GET /api/admin/queries/inspect/:queryId', () => {
    it('should return 200 with query details', async () => {
      const mockDetails = {
        success: true,
        data: {
          _key: 'q1',
          userId: 'user-1',
          userName: 'John Doe',
          text: 'What is tax rate?',
          response: 'The rate is 30%',
          messages: [{ role: 'user', content: 'What is tax rate?' }],
          metadata: { confidence_score: 0.92 }
        }
      };
      queryService.getQueryInspectorDetails.mockResolvedValue(mockDetails);

      const response = await authGet('/api/admin/queries/inspect/q1');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data._key).toBe('q1');
      expect(response.body.data.userName).toBe('John Doe');
      expect(queryService.getQueryInspectorDetails).toHaveBeenCalledWith('q1');
    });

    it('should return 404 when query not found', async () => {
      const error = new Error('document not found');
      error.errorNum = 1202;
      queryService.getQueryInspectorDetails.mockRejectedValue(error);

      const response = await authGet('/api/admin/queries/inspect/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Query not found');
    });

    it('should return 404 for string "document not found" error', async () => {
      queryService.getQueryInspectorDetails.mockRejectedValue(new Error('document not found'));

      const response = await authGet('/api/admin/queries/inspect/bad');

      expect(response.status).toBe(404);
    });

    it('should require admin authentication', async () => {
      keycloakAuthMiddleware.authenticate.mockImplementation((req, res) => {
        res.status(401).json({ error: 'TOKEN_INVALID', message: 'Authentication required' });
      });

      const response = await request(app).get('/api/admin/queries/inspect/q1');

      expect(response.status).toBe(401);
      expect(queryService.getQueryInspectorDetails).not.toHaveBeenCalled();
    });

    it('should require admin role', async () => {
      keycloakAuthMiddleware.requireAdmin.mockImplementation((req, res) => {
        res.status(403).json({ error: 'FORBIDDEN', message: 'Admin access required' });
      });

      const response = await authGet('/api/admin/queries/inspect/q1');

      expect(response.status).toBe(403);
      expect(queryService.getQueryInspectorDetails).not.toHaveBeenCalled();
    });

    it('should return 500 on service error', async () => {
      queryService.getQueryInspectorDetails.mockRejectedValue(new Error('DB error'));

      const response = await authGet('/api/admin/queries/inspect/q1');

      expect(response.status).toBe(500);
    });
  });
});
