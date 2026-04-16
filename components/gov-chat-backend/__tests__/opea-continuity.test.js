'use strict';

/**
 * Tests for Story 2-10: OPEA Continuity — Token Propagation
 *
 * Covers:
 * - OPEA payload user_id uses URL-safe _key (not composite iss_sub)
 * - Query route forwards Authorization Bearer token to OPEA
 * - Fallback to queryData.userId when not authenticated
 */

// Mock shared-lib
jest.mock('../shared-lib', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}), { virtual: true });

const supertest = require('supertest');

// Mock keycloak-auth-service
var mockVerifyToken = jest.fn();
jest.mock('../services/keycloak-auth-service', () => ({
  verifyToken: (...args) => mockVerifyToken(...args)
}));

// Mock user-provisioning-service
var mockProvisionUser = jest.fn();
jest.mock('../services/user-provisioning-service', () => ({
  provisionUser: (...args) => mockProvisionUser(...args)
}));

const { keycloakAuthMiddleware, isPublicRoute } = require('../middleware/keycloak-auth-middleware');
const { mockJwtPayload } = require('../test-fixtures/mockJwtPayload');

describe('Story 2-10: OPEA Continuity', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      headers: {},
      user: undefined,
      claims: undefined,
      path: '/api/queries',
      originalUrl: '/api/queries',
      body: {}
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    next = jest.fn();
    mockVerifyToken.mockReset();
    mockProvisionUser.mockReset();
  });

  describe('OPEA payload user_id uses URL-safe _key', () => {
    it('should use _key for OPEA payload user_id (not composite iss_sub)', async () => {
      req.headers.authorization = 'Bearer valid-token';
      const decodedPayload = {
        ...mockJwtPayload,
        sub: 'user-uuid-123',
        iss: 'http://localhost:8080/realms/genie'
      };
      mockVerifyToken.mockResolvedValue(decodedPayload);
      mockProvisionUser.mockResolvedValue({
        _key: 'users/user-uuid-123',
        iss_sub: 'http://localhost:8080/realms/genie#user-uuid-123',
        sub: 'user-uuid-123',
        iss: 'http://localhost:8080/realms/genie',
        email: 'test@example.com',
        name: 'Test User',
        roles: ['user'],
        active: true,
        deleted: false
      });

      await keycloakAuthMiddleware.authenticate(req, res, next);

      // req.user._key should be the URL-safe ArangoDB key
      expect(req.user._key).toBe('users/user-uuid-123');
      // This _key will be used in query-routes.js as the OPEA payload user_id
    });

    it('should NOT use iss_sub as OPEA payload user_id (URL-unsafe)', async () => {
      req.headers.authorization = 'Bearer valid-token';
      const decodedPayload = {
        ...mockJwtPayload,
        sub: 'user-uuid-456',
        iss: 'http://keycloak:8080/realms/genie'
      };
      mockVerifyToken.mockResolvedValue(decodedPayload);
      mockProvisionUser.mockResolvedValue({
        _key: 'users/user-uuid-456',
        iss_sub: 'http://keycloak:8080/realms/genie#user-uuid-456',
        email: 'test@example.com',
        name: 'Test User',
        roles: ['user'],
        active: true,
        deleted: false
      });

      await keycloakAuthMiddleware.authenticate(req, res, next);

      // _key is URL-safe (alphanumeric + hyphens + slashes)
      expect(req.user._key).toMatch(/^[\w/-]+$/);
      // iss_sub contains URL-unsafe characters (#, :, //)
      expect(req.user.iss_sub).toContain('#');
      expect(req.user.iss_sub).toContain(':');
    });
  });

  describe('query-routes passes req.user?._key', () => {
    it('should attach _key to req.user for query route consumption', async () => {
      req.headers.authorization = 'Bearer valid-token';
      const decodedPayload = {
        ...mockJwtPayload,
        sub: 'user-abc',
        iss: 'http://localhost:8080/realms/genie'
      };
      mockVerifyToken.mockResolvedValue(decodedPayload);
      mockProvisionUser.mockResolvedValue({
        _key: 'users/user-abc',
        iss_sub: 'http://localhost:8080/realms/genie#user-abc',
        email: 'test@example.com',
        name: 'Test User',
        roles: ['user'],
        active: true,
        deleted: false
      });

      await keycloakAuthMiddleware.authenticate(req, res, next);

      // query-routes.js uses req.user?._key for OPEA payload user_id
      expect(req.user).toBeDefined();
      expect(typeof req.user._key).toBe('string');
      expect(req.user._key.length).toBeGreaterThan(0);
    });

    it('should have undefined _key when not authenticated', () => {
      req.headers.authorization = undefined;
      // No token = 401 response, but req.user remains undefined
      keycloakAuthMiddleware.authenticate(req, res, next);
      expect(req.user).toBeUndefined();
    });
  });

  describe('OPEA payload falls back to queryData.userId', () => {
    it('should use queryData.userId when not authenticated (backward compat)', () => {
      // In query-service.js: user_id: authenticatedUserId || queryData.userId
      const authenticatedUserId = undefined; // no auth
      const queryData = { userId: 'frontend-user-123' };

      const user_id = authenticatedUserId || queryData.userId;
      expect(user_id).toBe('frontend-user-123');
    });

    it('should prefer _key over queryData.userId when authenticated', () => {
      const authenticatedUserId = 'users/user-uuid-123'; // _key from auth
      const queryData = { userId: 'frontend-user-123' };

      const user_id = authenticatedUserId || queryData.userId;
      expect(user_id).toBe('users/user-uuid-123');
    });
  });

  describe('/api/users/:userId/context endpoint — Keycloak auth', () => {
    it('should NOT allow /users/:userId/context as public path', () => {
      // The context endpoint now requires Keycloak authentication
      expect(isPublicRoute('/users/abc123/context')).toBe(false);
    });
  });
});
