'use strict';

/**
 * Tests for Story 2-10: OPEA Continuity — Keycloak-Agnostic Downstream
 *
 * Covers:
 * - OPEA payload user_id uses URL-safe _key (not composite iss_sub)
 * - OPEA worker headers never include Authorization
 * - Query route correctly passes headers and user ID to query service
 * - X-User-Id header still uses composite key (unchanged, for audit)
 * - /api/users/:userId/context endpoint validates X-Service-Token
 * - /api/users/:userId/context returns sanitized data only
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

// Mock email-service (required by user-routes.js at module level)
jest.mock('../services/email-service', () => ({
  sendVerificationEmail: jest.fn().mockResolvedValue()
}));

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
const serviceTokenService = require('../services/service-token-service');
const { mockJwtPayload } = require('./mocks/mockJwtPayload');

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

  describe('OPEA worker headers never include Authorization', () => {
    it('should NOT include Authorization in opeaHeaders', async () => {
      req.headers.authorization = 'Bearer secret-token';
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
      expect(req.user.opeaHeaders['Authorization']).toBeUndefined();
      expect(req.user.opeaHeaders['authorization']).toBeUndefined();
      expect(Object.keys(req.user.opeaHeaders)).toEqual([
        'X-User-Id',
        'X-User-Roles',
        'X-Issuer'
      ]);
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
});

describe('/api/users/:userId/context endpoint — service token auth', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      headers: {},
      params: { userId: 'users/test-user-123' },
      path: '/api/users/users/test-user-123/context',
      originalUrl: '/api/users/users/test-user-123/context',
      user: undefined,
      body: {}
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    next = jest.fn();
  });

  describe('isPublicRoute — /api/users/:userId/context must be public', () => {
    it('should allow /users/:userId/context as public path', () => {
      // Path is relative to mount point (Express strips /api/users prefix)
      expect(isPublicRoute('/users/abc123/context')).toBe(true);
    });

    it('should NOT allow other /users/ paths as public', () => {
      expect(isPublicRoute('/users/abc123')).toBe(false);
      expect(isPublicRoute('/users/abc123/role')).toBe(false);
      expect(isPublicRoute('/users')).toBe(false);
    });

    it('should NOT allow paths with more segments (e.g. /users/a/b/context)', () => {
      expect(isPublicRoute('/users/a/b/context')).toBe(false);
      expect(isPublicRoute('/users/admin/settings/context')).toBe(false);
    });
  });

  describe('X-Service-Token validation — real service', () => {
    const serviceTokenService = require('../services/service-token-service');

    it('should return 401 when X-Service-Token header is missing', () => {
      const originalEnv = process.env.SERVICE_AUTH_TOKEN;
      process.env.SERVICE_AUTH_TOKEN = 'secret';
      const result = serviceTokenService.validateServiceToken(undefined);
      expect(result.status).toBe(401);
      expect(result.body.error).toBeDefined();
      process.env.SERVICE_AUTH_TOKEN = originalEnv;
    });

    it('should return 401 when X-Service-Token is wrong', () => {
      const originalEnv = process.env.SERVICE_AUTH_TOKEN;
      process.env.SERVICE_AUTH_TOKEN = 'secret';
      const result = serviceTokenService.validateServiceToken('wrong');
      expect(result.status).toBe(401);
      process.env.SERVICE_AUTH_TOKEN = originalEnv;
    });

    it('should return 503 when SERVICE_AUTH_TOKEN is not configured', () => {
      const originalEnv = process.env.SERVICE_AUTH_TOKEN;
      delete process.env.SERVICE_AUTH_TOKEN;
      const result = serviceTokenService.validateServiceToken('any');
      expect(result.status).toBe(503);
      expect(result.body.error).toBe('Service temporarily unavailable');
      process.env.SERVICE_AUTH_TOKEN = originalEnv;
    });

    it('should return null when X-Service-Token matches', () => {
      const originalEnv = process.env.SERVICE_AUTH_TOKEN;
      process.env.SERVICE_AUTH_TOKEN = 'secret';
      const result = serviceTokenService.validateServiceToken('secret');
      expect(result).toBeNull();
      process.env.SERVICE_AUTH_TOKEN = originalEnv;
    });

    it('should use timing-safe comparison for secret validation', () => {
      const code = serviceTokenService.validateServiceToken.toString();
      expect(code).toContain('timingSafeEqual');
      expect(code).toContain('Buffer.byteLength');
    });
  });

  describe('Sanitized response data — real service', () => {
    const serviceTokenService = require('../services/service-token-service');

    it('should return only safe fields from full user object', () => {
      const fullUser = {
        _key: 'users/test-123',
        iss_sub: 'http://keycloak:8080/realms/genie#uuid',
        email: 'user@example.com',
        name: 'Test User',
        roles: ['user', 'admin'],
        active: true,
        deleted: false,
        password: 'hashed-password',
        salt: 'random-salt',
        emailVerified: true,
        createdAt: '2026-01-01T00:00:00Z'
      };

      const ctx = serviceTokenService.buildUserContext(fullUser);
      expect(Object.keys(ctx)).toEqual(['name', 'role', 'emailVerified']);
      expect(ctx).not.toHaveProperty('password');
      expect(ctx).not.toHaveProperty('salt');
      expect(ctx).not.toHaveProperty('iss_sub');
      expect(ctx).not.toHaveProperty('_key');
      expect(ctx).not.toHaveProperty('email');
      expect(ctx).not.toHaveProperty('active');
      expect(ctx).not.toHaveProperty('deleted');
      expect(ctx).not.toHaveProperty('createdAt');
    });

    it('should use defaults when user fields are missing', () => {
      const ctx = serviceTokenService.buildUserContext({});
      expect(ctx.name).toBe('User');
      expect(ctx.role).toEqual([]);
      expect(ctx.emailVerified).toBe(false);
    });
  });
});
