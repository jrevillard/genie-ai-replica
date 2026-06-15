'use strict';

// Mock shared-lib (middleware requires it as '../shared-lib' from its location)
jest.mock(
  '../shared-lib',
  () => ({
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    }
  }),
  { virtual: true }
);

// Mock keycloak-auth-service
const mockVerifyToken = jest.fn();
const mockCheckUserStatusInKeycloak = jest.fn();
jest.mock('../services/keycloak-auth-service', () => ({
  verifyToken: (...args) => mockVerifyToken(...args),
  checkUserStatusInKeycloak: (...args) => mockCheckUserStatusInKeycloak(...args)
}));

// Mock user-provisioning-service
const mockProvisionUser = jest.fn();
const mockMarkUserAsDeleted = jest.fn();
jest.mock('../services/user-provisioning-service', () => ({
  provisionUser: (...args) => mockProvisionUser(...args),
  markUserAsDeleted: (...args) => mockMarkUserAsDeleted(...args)
}));

const { keycloakAuthMiddleware, isPublicRoute, PUBLIC_PATHS } = require('../middleware/keycloak-auth-middleware');

describe('isPublicRoute', () => {
  it('should identify /health as public', () => {
    expect(isPublicRoute('/health')).toBe(true);
  });

  it('should identify /api/health as public', () => {
    expect(isPublicRoute('/api/health')).toBe(true);
  });

  it('should identify /api-docs as public', () => {
    expect(isPublicRoute('/api-docs')).toBe(true);
  });

  it('should identify /api/auth/callback as public', () => {
    expect(isPublicRoute('/api/auth/callback')).toBe(true);
  });

  it('should identify /api/auth/logout/callback as public', () => {
    expect(isPublicRoute('/api/auth/logout/callback')).toBe(true);
  });

  it('should NOT identify /api/auth/login as public (legacy endpoint removed)', () => {
    expect(isPublicRoute('/api/auth/login')).toBe(false);
  });

  it('should NOT identify /api/auth/register as public (legacy endpoint removed)', () => {
    expect(isPublicRoute('/api/auth/register')).toBe(false);
  });

  it('should NOT identify /api/chat as public', () => {
    expect(isPublicRoute('/api/chat')).toBe(false);
  });

  it('should NOT identify /api/me as public', () => {
    expect(isPublicRoute('/api/me')).toBe(false);
  });

  it('should NOT identify /api/admin as public', () => {
    expect(isPublicRoute('/api/admin')).toBe(false);
  });

  it('should NOT identify /api/analytics as public', () => {
    expect(isPublicRoute('/api/analytics')).toBe(false);
  });

  it('should NOT identify /api/files as public', () => {
    expect(isPublicRoute('/api/files')).toBe(false);
  });

  it('should NOT identify /api/categories as public', () => {
    expect(isPublicRoute('/api/categories')).toBe(false);
  });
});

describe('keycloakAuthMiddleware.authenticate', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      headers: {},
      user: undefined,
      path: '/api/protected',
      originalUrl: '/api/protected'
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    next = jest.fn();
    mockVerifyToken.mockReset();
    mockProvisionUser.mockReset();
    mockCheckUserStatusInKeycloak.mockReset();
    mockMarkUserAsDeleted.mockReset();
  });

  it('should return 401 TOKEN_INVALID when no Authorization header is present', async () => {
    await keycloakAuthMiddleware.authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'TOKEN_INVALID',
      message: 'Missing or malformed Authorization header',
      details: {}
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 TOKEN_INVALID when Authorization header does not start with Bearer', async () => {
    req.headers.authorization = 'Basic abc123';

    await keycloakAuthMiddleware.authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'TOKEN_INVALID',
      message: 'Missing or malformed Authorization header',
      details: {}
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 TOKEN_INVALID when Bearer token is empty', async () => {
    req.headers.authorization = 'Bearer ';

    await keycloakAuthMiddleware.authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'TOKEN_INVALID',
      message: 'Missing or malformed Authorization header',
      details: {}
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 TOKEN_EXPIRED when token is expired', async () => {
    req.headers.authorization = 'Bearer valid-token';
    const err = new Error('some-internal-detail-exposed');
    err.code = 'TOKEN_EXPIRED';
    mockVerifyToken.mockRejectedValue(err);

    await keycloakAuthMiddleware.authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'TOKEN_EXPIRED',
      message: 'Token has expired',
      details: {}
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('should call Keycloak introspection on TOKEN_EXPIRED and mark user as deleted when disabled', async () => {
    // Create a valid JWT format token for issuer extraction
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: '12345678-1234-1234-1234-123456789012',
        iss: 'http://localhost:8080/realms/genie',
        exp: Math.floor(Date.now() / 1000) - 3600
      })
    ).toString('base64url');
    const sig = Buffer.from('mock-signature').toString('base64url');
    const expiredToken = `${header}.${payload}.${sig}`;

    req.headers.authorization = `Bearer ${expiredToken}`;
    const err = new Error('Token expired');
    err.code = 'TOKEN_EXPIRED';
    mockVerifyToken.mockRejectedValue(err);
    mockCheckUserStatusInKeycloak.mockResolvedValue({ active: false, disabled: true });
    mockMarkUserAsDeleted.mockResolvedValue(undefined);

    await keycloakAuthMiddleware.authenticate(req, res, next);

    expect(mockCheckUserStatusInKeycloak).toHaveBeenCalledWith(expiredToken, 'http://localhost:8080/realms/genie');
    expect(mockMarkUserAsDeleted).toHaveBeenCalledWith(
      'http://localhost:8080/realms/genie#12345678-1234-1234-1234-123456789012'
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'TOKEN_EXPIRED',
      message: 'Token has expired',
      details: {}
    });
  });

  it('should not mark user as deleted when Keycloak introspection returns active user', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: '12345678-1234-1234-1234-123456789012',
        iss: 'http://localhost:8080/realms/genie',
        exp: Math.floor(Date.now() / 1000) - 3600
      })
    ).toString('base64url');
    const sig = Buffer.from('mock-signature').toString('base64url');
    const expiredToken = `${header}.${payload}.${sig}`;

    req.headers.authorization = `Bearer ${expiredToken}`;
    const err = new Error('Token expired');
    err.code = 'TOKEN_EXPIRED';
    mockVerifyToken.mockRejectedValue(err);
    mockCheckUserStatusInKeycloak.mockResolvedValue({ active: true, disabled: false });

    await keycloakAuthMiddleware.authenticate(req, res, next);

    expect(mockCheckUserStatusInKeycloak).toHaveBeenCalledWith(expiredToken, 'http://localhost:8080/realms/genie');
    expect(mockMarkUserAsDeleted).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should not mark user as deleted when Keycloak introspection fails (returns null)', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: '12345678-1234-1234-1234-123456789012',
        iss: 'http://localhost:8080/realms/genie',
        exp: Math.floor(Date.now() / 1000) - 3600
      })
    ).toString('base64url');
    const sig = Buffer.from('mock-signature').toString('base64url');
    const expiredToken = `${header}.${payload}.${sig}`;

    req.headers.authorization = `Bearer ${expiredToken}`;
    const err = new Error('Token expired');
    err.code = 'TOKEN_EXPIRED';
    mockVerifyToken.mockRejectedValue(err);
    mockCheckUserStatusInKeycloak.mockResolvedValue(null); // Introspection failed

    await keycloakAuthMiddleware.authenticate(req, res, next);

    expect(mockCheckUserStatusInKeycloak).toHaveBeenCalled();
    expect(mockMarkUserAsDeleted).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should not call introspection when token format is invalid (cannot extract issuer)', async () => {
    req.headers.authorization = 'Bearer invalid-token-format';
    const err = new Error('Token expired');
    err.code = 'TOKEN_EXPIRED';
    mockVerifyToken.mockRejectedValue(err);

    await keycloakAuthMiddleware.authenticate(req, res, next);

    expect(mockCheckUserStatusInKeycloak).not.toHaveBeenCalled();
    expect(mockMarkUserAsDeleted).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should not call introspection when token has malformed base64url payload', async () => {
    req.headers.authorization = 'Bearer header.invalidbase64==.signature';
    const err = new Error('Token expired');
    err.code = 'TOKEN_EXPIRED';
    mockVerifyToken.mockRejectedValue(err);

    await keycloakAuthMiddleware.authenticate(req, res, next);

    expect(mockCheckUserStatusInKeycloak).not.toHaveBeenCalled();
    expect(mockMarkUserAsDeleted).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should return 401 TOKEN_INVALID when token verification fails', async () => {
    req.headers.authorization = 'Bearer invalid-token';
    const err = new Error('internal-jose-error-details');
    err.code = 'TOKEN_INVALID';
    mockVerifyToken.mockRejectedValue(err);

    await keycloakAuthMiddleware.authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'TOKEN_INVALID',
      message: 'Token verification failed',
      details: {}
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('should call next() and set req.user from ArangoDB provisioning result', async () => {
    req.headers.authorization = 'Bearer valid-token';
    const decodedPayload = {
      iss_sub: 'http://localhost:8080/realms/genie#12345678',
      sub: '12345678',
      iss: 'http://localhost:8080/realms/genie',
      aud: 'genie-app',
      email: 'test@example.com',
      name: 'Test User',
      preferred_username: 'testuser',
      realm_access: { roles: ['user', 'admin'] },
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000)
    };
    mockVerifyToken.mockResolvedValue(decodedPayload);

    const arangoDbUser = {
      _key: 'users/123',
      iss_sub: 'http://localhost:8080/realms/genie#12345678',
      sub: '12345678',
      iss: 'http://localhost:8080/realms/genie',
      email: 'test@example.com',
      name: 'Test User',
      roles: ['user', 'admin'],
      active: true,
      deleted: false,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-30T00:00:00.000Z'
    };
    mockProvisionUser.mockResolvedValue(arangoDbUser);

    await keycloakAuthMiddleware.authenticate(req, res, next);

    expect(mockProvisionUser).toHaveBeenCalledWith(decodedPayload);
    expect(next).toHaveBeenCalled();
    // Verify JWT authentication fields, NOT ArangoDB internal fields
    expect(req.user.iss_sub).toBe('http://localhost:8080/realms/genie#12345678');
    expect(req.user.sub).toBe('12345678');
    expect(req.user.email).toBe('test@example.com');
    expect(req.user.roles).toEqual(['user', 'admin']);
    // Do NOT verify req.user._key (ArangoDB internal field)
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should pass through provisioning result when user has no name (uses preferred_username from ArangoDB)', async () => {
    req.headers.authorization = 'Bearer valid-token';
    const decodedPayload = {
      iss_sub: 'http://localhost:8080/realms/genie#12345678',
      sub: '12345678',
      iss: 'http://localhost:8080/realms/genie',
      aud: 'genie-app',
      email: 'test@example.com',
      preferred_username: 'testuser',
      realm_access: { roles: ['user'] },
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000)
    };
    mockVerifyToken.mockResolvedValue(decodedPayload);
    mockProvisionUser.mockResolvedValue({
      _key: 'users/123',
      iss_sub: 'http://localhost:8080/realms/genie#12345678',
      sub: '12345678',
      iss: 'http://localhost:8080/realms/genie',
      email: 'test@example.com',
      name: 'testuser',
      roles: ['user'],
      active: true,
      deleted: false,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-30T00:00:00.000Z'
    });

    await keycloakAuthMiddleware.authenticate(req, res, next);

    expect(req.user.name).toBe('testuser');
  });

  it('should handle missing realm_access gracefully', async () => {
    req.headers.authorization = 'Bearer valid-token';
    const decodedPayload = {
      iss_sub: 'http://localhost:8080/realms/genie#12345678',
      sub: '12345678',
      iss: 'http://localhost:8080/realms/genie',
      aud: 'genie-app',
      email: 'test@example.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000)
    };
    mockVerifyToken.mockResolvedValue(decodedPayload);
    mockProvisionUser.mockResolvedValue({
      _key: 'users/123',
      iss_sub: 'http://localhost:8080/realms/genie#12345678',
      sub: '12345678',
      iss: 'http://localhost:8080/realms/genie',
      email: 'test@example.com',
      name: null,
      roles: [],
      active: true,
      deleted: false,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-30T00:00:00.000Z'
    });

    await keycloakAuthMiddleware.authenticate(req, res, next);

    expect(req.user.roles).toEqual([]);
  });

  it('should return 403 when provisioning returns a soft-deleted user (defense-in-depth)', async () => {
    req.headers.authorization = 'Bearer valid-token';
    const decodedPayload = {
      iss_sub: 'http://localhost:8080/realms/genie#12345678',
      sub: '12345678',
      iss: 'http://localhost:8080/realms/genie',
      aud: 'genie-app',
      email: 'deleted@example.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000)
    };
    mockVerifyToken.mockResolvedValue(decodedPayload);
    mockProvisionUser.mockResolvedValue({
      _key: 'users/123',
      iss_sub: 'http://localhost:8080/realms/genie#12345678',
      sub: '12345678',
      iss: 'http://localhost:8080/realms/genie',
      email: 'deleted@example.com',
      name: 'Deleted User',
      roles: [],
      active: false,
      deleted: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-15T00:00:00.000Z'
    });

    await keycloakAuthMiddleware.authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'FORBIDDEN',
      message: 'User account is deactivated',
      details: {}
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('should allow re-activated user (provisionUser returns user with deleted=false)', async () => {
    req.headers.authorization = 'Bearer valid-token';
    const decodedPayload = {
      iss_sub: 'http://localhost:8080/realms/genie#12345678',
      sub: '12345678',
      iss: 'http://localhost:8080/realms/genie',
      aud: 'genie-app',
      email: 'reactivated@example.com',
      name: 'Reactivated User',
      realm_access: { roles: ['user'] },
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000)
    };
    mockVerifyToken.mockResolvedValue(decodedPayload);
    mockProvisionUser.mockResolvedValue({
      _key: 'users/123',
      iss_sub: 'http://localhost:8080/realms/genie#12345678',
      sub: '12345678',
      iss: 'http://localhost:8080/realms/genie',
      email: 'reactivated@example.com',
      name: 'Reactivated User',
      roles: ['user'],
      active: true,
      deleted: false,
      deletedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: expect.any(String)
    });

    await keycloakAuthMiddleware.authenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user.deleted).toBe(false);
    expect(req.user.deletedAt).toBeNull();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should return 500 PROVISIONING_FAILED when provisioning throws error', async () => {
    req.headers.authorization = 'Bearer valid-token';
    const decodedPayload = {
      iss_sub: 'http://localhost:8080/realms/genie#12345678',
      sub: '12345678',
      iss: 'http://localhost:8080/realms/genie',
      aud: 'genie-app',
      email: 'test@example.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000)
    };
    mockVerifyToken.mockResolvedValue(decodedPayload);
    mockProvisionUser.mockRejectedValue(new Error('ArangoDB connection refused'));

    await keycloakAuthMiddleware.authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'PROVISIONING_FAILED',
      message: 'User provisioning failed',
      details: {}
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 TOKEN_INVALID with generic message when TokenVerificationError has internal details', async () => {
    req.headers.authorization = 'Bearer token-with-internal-details';
    const err = new Error('http://keycloak:8080/realms/genie exposed URL');
    err.code = 'TOKEN_INVALID';
    mockVerifyToken.mockRejectedValue(err);

    await keycloakAuthMiddleware.authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'TOKEN_INVALID',
      message: 'Token verification failed',
      details: {}
    });
  });

  it('should return 401 TOKEN_EXPIRED with hardcoded message when TokenVerificationError has internal details', async () => {
    req.headers.authorization = 'Bearer expired-with-internal-details';
    const err = new Error('JWTExpired at epoch 1714435200 for client genie-app');
    err.code = 'TOKEN_EXPIRED';
    mockVerifyToken.mockRejectedValue(err);

    await keycloakAuthMiddleware.authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'TOKEN_EXPIRED',
      message: 'Token has expired',
      details: {}
    });
  });

  it('should return 401 TOKEN_INVALID with generic message for unknown error type (non-TokenVerificationError)', async () => {
    req.headers.authorization = 'Bearer unexpected-error';
    mockVerifyToken.mockRejectedValue(new TypeError('Cannot read properties of undefined'));

    await keycloakAuthMiddleware.authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'TOKEN_INVALID',
      message: 'Token verification failed',
      details: {}
    });
  });

  it('should attach JWT claims to req.claims for header construction', async () => {
    req.headers.authorization = 'Bearer valid-token';
    const decodedPayload = {
      iss_sub: 'http://localhost:8080/realms/genie#12345678',
      sub: '12345678',
      iss: 'http://localhost:8080/realms/genie',
      aud: 'genie-app',
      email: 'test@example.com',
      name: 'Test User',
      preferred_username: 'testuser',
      realm_access: { roles: ['user', 'admin'] },
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000)
    };
    mockVerifyToken.mockResolvedValue(decodedPayload);
    mockProvisionUser.mockResolvedValue({
      _key: 'users/123',
      iss_sub: 'http://localhost:8080/realms/genie#12345678',
      sub: '12345678',
      iss: 'http://localhost:8080/realms/genie',
      email: 'test@example.com',
      name: 'Test User',
      roles: ['user', 'admin'],
      active: true,
      deleted: false,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-30T00:00:00.000Z'
    });

    await keycloakAuthMiddleware.authenticate(req, res, next);

    expect(req.claims).toBeDefined();
    expect(req.claims.iss).toBe('http://localhost:8080/realms/genie');
    expect(req.claims.sub).toBe('12345678');
    expect(req.claims.realm_access).toEqual({ roles: ['user', 'admin'] });
  });
});

describe('requireAdmin', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      user: undefined,
      path: '/api/admin/something',
      originalUrl: '/api/admin/something'
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    next = jest.fn();
  });

  it('should allow access when user has admin role', async () => {
    req.user = {
      _key: 'users/123',
      iss_sub: 'http://localhost:8080/realms/genie#12345678',
      email: 'admin@example.com',
      name: 'Admin User',
      roles: ['user', 'admin']
    };
    req.claims = {
      realm_access: {
        roles: ['user', 'admin']
      }
    };

    keycloakAuthMiddleware.requireAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('should return 403 when user lacks admin role', async () => {
    req.user = {
      _key: 'users/456',
      iss_sub: 'http://localhost:8080/realms/genie#456789',
      email: 'user@example.com',
      name: 'Regular User',
      roles: ['user']
    };
    req.claims = {
      realm_access: {
        roles: ['user']
      }
    };

    keycloakAuthMiddleware.requireAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'FORBIDDEN',
      message: 'Admin access required',
      details: {}
    });
  });

  it('should return 403 when claims.realm_access.roles is missing', async () => {
    req.user = {
      _key: 'users/789',
      iss_sub: 'http://localhost:8080/realms/genie#789',
      email: 'no-roles@example.com',
      name: 'No Roles User'
    };
    // No realm_access in claims
    req.claims = {};

    keycloakAuthMiddleware.requireAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'FORBIDDEN',
      message: 'Admin access required',
      details: {}
    });
  });

  it('should return 403 when claims.realm_access.roles is not an array', async () => {
    req.user = {
      _key: 'users/999',
      iss_sub: 'http://localhost:8080/realms/genie#999',
      email: 'invalid-roles@example.com',
      name: 'Invalid Roles User'
    };
    req.claims = {
      realm_access: {
        roles: 'not-an-array'
      }
    };

    keycloakAuthMiddleware.requireAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'FORBIDDEN',
      message: 'Admin access required',
      details: {}
    });
  });

  it('should return 403 when claims is undefined', async () => {
    req.user = {
      _key: 'users/111',
      iss_sub: 'http://localhost:8080/realms/genie#111',
      email: 'user@example.com',
      name: 'Undefined Claims User'
    };
    req.claims = undefined;

    keycloakAuthMiddleware.requireAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'FORBIDDEN',
      message: 'Admin access required',
      details: {}
    });
  });

  it('should return 403 when claims.realm_access exists but has no roles', async () => {
    req.user = {
      _key: 'users/333',
      iss_sub: 'http://localhost:8080/realms/genie#333',
      email: 'no-roles-prop@example.com',
      name: 'No Roles Prop User'
    };
    req.claims = {
      realm_access: {}
    };

    keycloakAuthMiddleware.requireAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'FORBIDDEN',
      message: 'Admin access required',
      details: {}
    });
  });

  it('should return 403 when roles array is empty', async () => {
    req.user = {
      _key: 'users/000',
      iss_sub: 'http://localhost:8080/realms/genie#000',
      email: 'empty-roles@example.com',
      name: 'Empty Roles User'
    };
    req.claims = {
      realm_access: {
        roles: []
      }
    };

    keycloakAuthMiddleware.requireAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'FORBIDDEN',
      message: 'Admin access required',
      details: {}
    });
  });
});

describe('PUBLIC_PATHS', () => {
  it('should contain required public paths', () => {
    expect(PUBLIC_PATHS).toContain('/health');
    expect(PUBLIC_PATHS).toContain('/api/health');
    expect(PUBLIC_PATHS).toContain('/api-docs');
    expect(PUBLIC_PATHS).toContain('/api/auth/callback');
    expect(PUBLIC_PATHS).toContain('/api/auth/logout/callback');
  });
});
