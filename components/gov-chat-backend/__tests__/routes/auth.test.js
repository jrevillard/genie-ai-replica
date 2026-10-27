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

// Mock session-service singleton (used by authController)
jest.mock('../../services/session-service', () => ({
  getUserSessions: jest.fn(),
  endSession: jest.fn(),
  createSession: jest.fn()
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

// Mock all other services loaded by index.js
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

// Mock analytics controller (required by analytics-routes factory)
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
const { createValidToken, createExpiredToken } = require('../fixtures/tokens');
const { createMockUser } = require('../fixtures/users');

// Get references to mocked modules
const keycloakAuthService = require('../../services/keycloak-auth-service');
const userProvisioningService = require('../../services/user-provisioning-service');
const sessionService = require('../../services/session-service');
const { logger } = require('../../shared-lib');

const mockUser = createMockUser();

// Create app once for all tests
let app;
beforeAll(() => {
  app = createApp();
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

describe('POST /api/auth/logout', () => {
  // --- Token validation tests (AC: #2, #3, #4) ---
  describe('token validation', () => {
    it('should return 401 TOKEN_INVALID when no Authorization header', async () => {
      const response = await request(app).post('/api/auth/logout');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: 'TOKEN_INVALID',
        message: 'Missing or malformed Authorization header',
        details: {}
      });
    });

    it('should return 401 TOKEN_EXPIRED when token is expired', async () => {
      const expiredToken = createExpiredToken();
      keycloakAuthService.verifyToken.mockRejectedValue(
        Object.assign(new Error('Token expired'), { code: 'TOKEN_EXPIRED' })
      );

      const response = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${expiredToken}`);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: 'TOKEN_EXPIRED',
        message: 'Token has expired',
        details: {}
      });
    });

    it('should return 401 TOKEN_INVALID when token is malformed', async () => {
      keycloakAuthService.verifyToken.mockRejectedValue(new Error('Invalid token'));

      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', 'Bearer malformed-token-string');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: 'TOKEN_INVALID',
        message: 'Token verification failed',
        details: {}
      });
    });

    it('should return 401 TOKEN_INVALID when Authorization header is "Bearer" with no token', async () => {
      const response = await request(app).post('/api/auth/logout').set('Authorization', 'Bearer ');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('TOKEN_INVALID');
    });
  });

  // --- Logout success tests (AC: #1, #5, #6) ---
  describe('successful logout', () => {
    it('should return 200 and end active sessions when valid token with sessions', async () => {
      const token = createValidToken();
      const activeSessions = [
        { _key: 'session-1', active: true },
        { _key: 'session-2', active: true }
      ];
      sessionService.getUserSessions.mockResolvedValue(activeSessions);
      sessionService.endSession.mockResolvedValue({ _key: 'session-1', active: false });

      const response = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: 'Logged out successfully'
      });
      expect(sessionService.getUserSessions).toHaveBeenCalledWith(mockUser.iss_sub, {
        legacyKey: mockUser._key,
        activeOnly: true
      });
      expect(sessionService.endSession).toHaveBeenCalledTimes(2);
      expect(sessionService.endSession).toHaveBeenCalledWith('session-1');
      expect(sessionService.endSession).toHaveBeenCalledWith('session-2');
    });

    it('should return 200 and not call endSession when no active sessions', async () => {
      const token = createValidToken();
      sessionService.getUserSessions.mockResolvedValue([]);

      const response = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: 'Logged out successfully'
      });
      expect(sessionService.getUserSessions).toHaveBeenCalled();
      expect(sessionService.endSession).not.toHaveBeenCalled();
    });

    it('should write audit log on successful logout', async () => {
      const token = createValidToken();
      sessionService.getUserSessions.mockResolvedValue([]);

      await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);

      // Verify audit log was written (logger.info called with JSON containing event: 'logout')
      const infoCalls = logger.info.mock.calls;
      const auditLog = infoCalls.find((call) => {
        try {
          const parsed = JSON.parse(call[0]);
          return parsed.event === 'logout';
        } catch {
          return false;
        }
      });
      expect(auditLog).toBeDefined();
      const parsed = JSON.parse(auditLog[0]);
      expect(parsed).toMatchObject({
        event: 'logout',
        userId: mockUser.iss_sub,
        issuer: mockUser.iss
      });
      expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  // --- Error handling tests (AC: #7) ---
  describe('error handling', () => {
    it('should return 200 when sessionService.getUserSessions throws', async () => {
      const token = createValidToken();
      sessionService.getUserSessions.mockRejectedValue(new Error('DB connection failed'));

      const response = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: 'Logged out successfully'
      });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to end sessions on logout'));
    });

    it('should return 200 when sessionService.endSession throws for a session', async () => {
      const token = createValidToken();
      const activeSessions = [{ _key: 'session-1', active: true }];
      sessionService.getUserSessions.mockResolvedValue(activeSessions);
      sessionService.endSession.mockRejectedValue(new Error('Write failed'));

      const response = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: 'Logged out successfully'
      });
      // The error is caught inside the for-loop, logged as warning
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to end sessions on logout'));
    });

    it('should return 200 and skip session cleanup when userId is null', async () => {
      const token = createValidToken();
      userProvisioningService.provisionUser.mockResolvedValue({
        ...mockUser,
        iss_sub: null
      });

      const response = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: 'Logged out successfully'
      });
      expect(sessionService.getUserSessions).not.toHaveBeenCalled();
    });
  });
});
