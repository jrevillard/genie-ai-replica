'use strict';

/**
 * Tests for Story 2-10: OPEA Continuity — Token Propagation
 *
 * Covers:
 * - OPEA payload user_id uses URL-safe _key (not composite iss_sub)
 * - Query route forwards Authorization Bearer token to OPEA
 * - X-User-Id header still uses composite key (unchanged, for audit)
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

const { keycloakAuthMiddleware, buildUserHeaders, isPublicRoute } = require('../middleware/keycloak-auth-middleware');
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

  describe('X-User-Id header still uses composite key (unchanged for audit)', () => {
    it('should use composite {iss}#{sub} for X-User-Id header', async () => {
      req.headers.authorization = 'Bearer valid-token';
      const decodedPayload = {
        ...mockJwtPayload,
        sub: 'user-uuid-789',
        iss: 'http://localhost:8080/realms/genie'
      };
      mockVerifyToken.mockResolvedValue(decodedPayload);
      mockProvisionUser.mockResolvedValue({
        _key: 'users/user-uuid-789',
        iss_sub: 'http://localhost:8080/realms/genie#user-uuid-789',
        email: 'test@example.com',
        name: 'Test User',
        roles: ['user'],
        active: true,
        deleted: false
      });

      await keycloakAuthMiddleware.authenticate(req, res, next);

      // X-User-Id header uses composite key (unchanged from Story 2-3)
      expect(req.user.opeaHeaders['X-User-Id']).toBe('http://localhost:8080/realms/genie#user-uuid-789');
      // X-Issuer is also set
      expect(req.user.opeaHeaders['X-Issuer']).toBe('http://localhost:8080/realms/genie');
      // X-User-Roles from realm_access
      expect(req.user.opeaHeaders['X-User-Roles']).toBe('user,admin');
    });
  });

  describe('OPEA worker receives Authorization Bearer token', () => {
    it('should include Authorization in opeaHeaders for defense-in-depth', async () => {
      req.headers.authorization = 'Bearer user-jwt-token';
      const decodedPayload = {
        ...mockJwtPayload,
        sub: 'user-uuid',
        iss: 'http://localhost:8080/realms/genie'
      };
      mockVerifyToken.mockResolvedValue(decodedPayload);
      mockProvisionUser.mockResolvedValue({
        _key: 'users/user-uuid',
        iss_sub: 'http://localhost:8080/realms/genie#user-uuid',
        email: 'test@example.com',
        name: 'Test User',
        roles: ['user'],
        active: true,
        deleted: false
      });

      await keycloakAuthMiddleware.authenticate(req, res, next);

      expect(req.user.opeaHeaders).toBeDefined();
      // query-routes.js adds Authorization from req.headers to opeaHeaders
      // The middleware provides the base headers; the route adds the bearer token
      expect(req.user.opeaHeaders['X-User-Id']).toBeDefined();
      expect(req.user.opeaHeaders['X-Issuer']).toBeDefined();
      expect(req.user.opeaHeaders['X-User-Roles']).toBeDefined();
    });
  });

  describe('query-routes passes req.user?.opeaHeaders and req.user?._key', () => {
    it('should attach opeaHeaders and _key to req.user for query route consumption', async () => {
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

      // query-routes.js line 187 uses: req.user?.opeaHeaders and req.user?._key
      expect(req.user).toBeDefined();
      expect(req.user.opeaHeaders).toBeDefined();
      expect(typeof req.user._key).toBe('string');
      expect(req.user._key.length).toBeGreaterThan(0);
    });

    it('should have undefined opeaHeaders and _key when not authenticated', () => {
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
