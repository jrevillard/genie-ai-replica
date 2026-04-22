let jose, authenticateToken, authorizeRole, isPublicRoute, PUBLIC_PATHS;

// Re-require middleware before each test to reset module-level JWKS cache
beforeEach(() => {
  jest.resetModules();

  jest.mock('jose', () => ({
    createRemoteJWKSet: jest.fn(),
    jwtVerify: jest.fn()
  }));

  jest.mock('../../../config/appConfig', () => ({
    security: {
      keycloakUrl: 'https://localhost/auth',
      keycloakRealm: 'genie',
      keycloakClientId: 'genie-app'
    }
  }));

  jest.mock('../../../../shared-lib', () => ({
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn()
    }
  }));

  jose = require('jose');
  const middleware = require('../../../middlewares/keycloak-auth-middleware');
  authenticateToken = middleware.authenticateToken;
  authorizeRole = middleware.authorizeRole;
  isPublicRoute = middleware.isPublicRoute;
  PUBLIC_PATHS = middleware.PUBLIC_PATHS;
});

// Helper to create a mock request/response/next
function createMocks(overrides = {}) {
  const req = {
    originalUrl: '/api/files',
    headers: {},
    user: undefined,
    ...overrides.req
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis()
  };
  const next = jest.fn();
  return { req, res, next };
}

// Helper to create a valid JWT-like payload
function createMockPayload(roles = ['admin']) {
  return {
    sub: 'user-123',
    iss: 'https://localhost/auth/realms/genie',
    azp: 'genie-app',
    realm_access: { roles },
    exp: Math.floor(Date.now() / 1000) + 3600
  };
}

describe('keycloak-auth-middleware', () => {
  describe('isPublicRoute', () => {
    it('should return true for /health', () => {
      expect(isPublicRoute('/health')).toBe(true);
    });

    it('should return true for /api-docs', () => {
      expect(isPublicRoute('/api-docs')).toBe(true);
    });

    it('should return true for /api', () => {
      expect(isPublicRoute('/api')).toBe(true);
    });

    it('should return true for /api-docs.json', () => {
      expect(isPublicRoute('/api-docs.json')).toBe(true);
    });

    it('should return false for /api/files', () => {
      expect(isPublicRoute('/api/files')).toBe(false);
    });

    it('should return false for /api/files/123', () => {
      expect(isPublicRoute('/api/files/123')).toBe(false);
    });
  });

  describe('PUBLIC_PATHS', () => {
    it('should contain expected public paths', () => {
      expect(PUBLIC_PATHS).toEqual(['/health', '/api-docs', '/api', '/api-docs.json']);
    });
  });

  describe('authenticateToken', () => {
    it('should skip authentication for public routes', async () => {
      const { req, res, next } = createMocks({ req: { originalUrl: '/health' } });
      await authenticateToken(req, res, next);
      expect(next).toHaveBeenCalledWith();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should return 401 when Authorization header is missing', async () => {
      const { req, res, next } = createMocks();
      await authenticateToken(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'TOKEN_INVALID' }));
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when Authorization header is malformed', async () => {
      const { req, res, next } = createMocks({ req: { headers: { authorization: 'Basic abc123' } } });
      await authenticateToken(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'TOKEN_INVALID' }));
    });

    it('should return 401 for expired token (JWTExpired)', async () => {
      jose.createRemoteJWKSet.mockReturnValue({});
      const expiredError = new Error('JWT expired');
      expiredError.name = 'JWTExpired';
      jose.jwtVerify.mockRejectedValue(expiredError);

      const { req, res, next } = createMocks({
        req: { headers: { authorization: 'Bearer expired-token' } }
      });
      await authenticateToken(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'TOKEN_EXPIRED' }));
    });

    it('should return 401 for invalid token', async () => {
      jose.createRemoteJWKSet.mockReturnValue({});
      jose.jwtVerify.mockRejectedValue(new Error('Invalid signature'));

      const { req, res, next } = createMocks({
        req: { headers: { authorization: 'Bearer invalid-token' } }
      });
      await authenticateToken(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'TOKEN_INVALID' }));
    });

    it('should return 401 for claim validation failure (JWTClaimValidationFailed)', async () => {
      jose.createRemoteJWKSet.mockReturnValue({});
      const claimError = new Error('claim validation failed');
      claimError.name = 'JWTClaimValidationFailed';
      jose.jwtVerify.mockRejectedValue(claimError);

      const { req, res, next } = createMocks({
        req: { headers: { authorization: 'Bearer bad-claim-token' } }
      });
      await authenticateToken(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'TOKEN_INVALID', message: 'Token claim validation failed' })
      );
    });

    it('should return 503 when JWKS initialization fails', async () => {
      jose.createRemoteJWKSet.mockImplementation(() => {
        throw new Error('Network error');
      });

      const { req, res, next } = createMocks({
        req: { headers: { authorization: 'Bearer some-token' } }
      });
      await authenticateToken(req, res, next);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'AUTH_SERVICE_UNAVAILABLE' }));
    });

    it('should attach user object for valid token with admin role', async () => {
      const payload = createMockPayload(['admin']);
      jose.createRemoteJWKSet.mockReturnValue({});
      jose.jwtVerify.mockResolvedValue({ payload });

      const { req, res, next } = createMocks({
        req: { headers: { authorization: 'Bearer valid-token' } }
      });
      await authenticateToken(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.user).toBeDefined();
      expect(req.user.userId).toBe('user-123');
      expect(req.user.role).toBe('Admin');
      expect(req.user.iss).toBe('https://localhost/auth/realms/genie');
      expect(req.user.roles).toEqual(['admin']);

      // Verify jwtVerify was called with correct issuer
      expect(jose.jwtVerify).toHaveBeenCalledWith(
        'valid-token',
        expect.anything(),
        expect.objectContaining({
          issuer: 'https://localhost/auth/realms/genie',
          requiredClaims: ['iss', 'exp']
        })
      );
    });

    it('should return 401 when token azp does not match expected client', async () => {
      const payload = {
        ...createMockPayload(['admin']),
        azp: 'evil-client'
      };
      jose.createRemoteJWKSet.mockReturnValue({});
      jose.jwtVerify.mockResolvedValue({ payload });

      const { req, res, next } = createMocks({
        req: { headers: { authorization: 'Bearer valid-token-wrong-azp' } }
      });
      await authenticateToken(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'TOKEN_INVALID', message: 'Token audience validation failed' })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should accept token without azp claim (some flows omit it)', async () => {
      const payload = { ...createMockPayload(['admin']) };
      delete payload.azp;
      jose.createRemoteJWKSet.mockReturnValue({});
      jose.jwtVerify.mockResolvedValue({ payload });

      const { req, res, next } = createMocks({
        req: { headers: { authorization: 'Bearer no-azp-token' } }
      });
      await authenticateToken(req, res, next);
      expect(next).toHaveBeenCalledWith();
      expect(req.user.role).toBe('Admin');
    });

    it('should map dataprep-service role correctly', async () => {
      const payload = createMockPayload(['dataprep-service']);
      jose.createRemoteJWKSet.mockReturnValue({});
      jose.jwtVerify.mockResolvedValue({ payload });

      const { req, res, next } = createMocks({
        req: { headers: { authorization: 'Bearer valid-token' } }
      });
      await authenticateToken(req, res, next);

      expect(req.user.role).toBe('dataprep-service');
    });

    it('should map user role with first letter capitalized', async () => {
      const payload = createMockPayload(['user']);
      jose.createRemoteJWKSet.mockReturnValue({});
      jose.jwtVerify.mockResolvedValue({ payload });

      const { req, res, next } = createMocks({
        req: { headers: { authorization: 'Bearer valid-token' } }
      });
      await authenticateToken(req, res, next);

      expect(req.user.role).toBe('User');
    });

    it('should default to User when roles array is empty', async () => {
      const payload = createMockPayload([]);
      jose.createRemoteJWKSet.mockReturnValue({});
      jose.jwtVerify.mockResolvedValue({ payload });

      const { req, res, next } = createMocks({
        req: { headers: { authorization: 'Bearer valid-token' } }
      });
      await authenticateToken(req, res, next);

      expect(req.user.role).toBe('User');
    });
  });

  describe('authorizeRole', () => {
    it('should allow user with matching Admin role', () => {
      const { req, res, next } = createMocks({ req: { user: { role: 'Admin', userId: 'user-1' } } });
      const middleware = authorizeRole(['Admin']);
      middleware(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });

    it('should allow user with dataprep-service role', () => {
      const { req, res, next } = createMocks({ req: { user: { role: 'dataprep-service', userId: 'service-1' } } });
      const middleware = authorizeRole(['Admin', 'dataprep-service']);
      middleware(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });

    it('should return 403 for user without allowed role', () => {
      const { req, res, next } = createMocks({ req: { user: { role: 'User', userId: 'user-1' } } });
      const middleware = authorizeRole(['Admin']);
      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'FORBIDDEN' }));
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when user is not authenticated', () => {
      const { req, res, next } = createMocks({ req: { user: undefined } });
      const middleware = authorizeRole(['Admin']);
      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'TOKEN_INVALID' }));
    });

    it('should perform case-insensitive role comparison', () => {
      const { req, res, next } = createMocks({ req: { user: { role: 'admin', userId: 'user-1' } } });
      const middleware = authorizeRole(['Admin']);
      middleware(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });
  });
});
