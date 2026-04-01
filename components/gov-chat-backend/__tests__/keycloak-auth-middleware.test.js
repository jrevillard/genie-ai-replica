'use strict';

// Mock shared-lib (middleware requires it as '../shared-lib' from its location)
jest.mock('../shared-lib', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}), { virtual: true });

// Mock keycloak-auth-service
const mockVerifyToken = jest.fn();
jest.mock('../services/keycloak-auth-service', () => ({
  verifyToken: (...args) => mockVerifyToken(...args)
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

  it('should identify /api/auth/login as public', () => {
    expect(isPublicRoute('/api/auth/login')).toBe(true);
  });

  it('should identify /api/auth/register as public', () => {
    expect(isPublicRoute('/api/auth/register')).toBe(true);
  });

  it('should NOT identify /api/chat as public', () => {
    expect(isPublicRoute('/api/chat')).toBe(false);
  });

  it('should NOT identify /api/users as public', () => {
    expect(isPublicRoute('/api/users')).toBe(false);
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
    const err = new Error('Token has expired');
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

  it('should return 401 TOKEN_INVALID when token verification fails', async () => {
    req.headers.authorization = 'Bearer invalid-token';
    const err = new Error('Token verification failed');
    err.code = 'TOKEN_INVALID';
    mockVerifyToken.mockRejectedValue(err);

    await keycloakAuthMiddleware.authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'TOKEN_INVALID'
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('should call next() and set req.user with valid token', async () => {
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

    await keycloakAuthMiddleware.authenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user.iss_sub).toBe('http://localhost:8080/realms/genie#12345678');
    expect(req.user.sub).toBe('12345678');
    expect(req.user.email).toBe('test@example.com');
    expect(req.user.name).toBe('Test User');
    expect(req.user.roles).toEqual(['user', 'admin']);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should handle missing name field by falling back to preferred_username', async () => {
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

    await keycloakAuthMiddleware.authenticate(req, res, next);

    expect(req.user.roles).toEqual([]);
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
