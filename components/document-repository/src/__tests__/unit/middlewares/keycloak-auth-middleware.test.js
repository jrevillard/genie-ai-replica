let authenticateToken, authorizeRole, isPublicRoute, PUBLIC_PATHS;
let mockVerifyToken;

// Re-require middleware before each test
beforeEach(() => {
  jest.resetModules();

  // The verification core is the shared OIDC verifier (DW-427); the mock
  // stands in for it at the module boundary. Issuer/alias/pin semantics are
  // that module's contract, pinned in the backend verifier suite and the
  // real-crypto suite — not here.
  mockVerifyToken = jest.fn();
  jest.mock('../../shared-lib/keycloak-auth-service', () => ({
    verifyToken: (...args) => mockVerifyToken(...args)
  }));

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
      expect(mockVerifyToken).not.toHaveBeenCalled();
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

    it('should delegate verification to the shared verifier with the raw token', async () => {
      mockVerifyToken.mockResolvedValue(createMockPayload(['admin']));
      const { req, res, next } = createMocks({
        req: { headers: { authorization: 'Bearer valid-token' } }
      });
      await authenticateToken(req, res, next);
      expect(mockVerifyToken).toHaveBeenCalledWith('valid-token');
      expect(next).toHaveBeenCalledWith();
    });

    it('should return 401 TOKEN_EXPIRED when the verifier reports an expired token', async () => {
      mockVerifyToken.mockRejectedValue({ code: 'TOKEN_EXPIRED', message: 'Token has expired' });
      const { req, res, next } = createMocks({
        req: { headers: { authorization: 'Bearer expired-token' } }
      });
      await authenticateToken(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'TOKEN_EXPIRED' }));
    });

    it('should return 401 TOKEN_INVALID when verification fails', async () => {
      mockVerifyToken.mockRejectedValue({ code: 'TOKEN_INVALID', message: 'Token verification failed' });
      const { req, res, next } = createMocks({
        req: { headers: { authorization: 'Bearer invalid-token' } }
      });
      await authenticateToken(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'TOKEN_INVALID' }));
    });

    it('should map a claim-validation failure to 401 with the verifier message', async () => {
      mockVerifyToken.mockRejectedValue({ code: 'TOKEN_INVALID', message: 'Token claim validation failed' }); // internal message
      const { req, res, next } = createMocks({
        req: { headers: { authorization: 'Bearer bad-claim-token' } }
      });
      await authenticateToken(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'TOKEN_INVALID', message: 'Token verification failed' })
      );
    });

    it('should return 503 AUTH_SERVICE_UNAVAILABLE when Keycloak discovery is unavailable (init failure)', async () => {
      // The shared verifier surfaces init/cooldown failures as
      // AUTH_SERVICE_UNAVAILABLE; the middleware maps it to the doc-repo 503
      // contract the frontend httpService handles (a Keycloak outage is not a
      // bad token).
      mockVerifyToken.mockRejectedValue({
        code: 'AUTH_SERVICE_UNAVAILABLE',
        message: 'Authentication service is temporarily unavailable'
      });
      const { req, res, next } = createMocks({
        req: { headers: { authorization: 'Bearer some-token' } }
      });
      await authenticateToken(req, res, next);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'AUTH_SERVICE_UNAVAILABLE',
          message: 'Authentication service unavailable'
        })
      );
    });

    it('should log the 401 root cause (token issuer) for a failed verification', async () => {
      const { logger } = require('../../../__tests__/__mocks__/shared-lib');
      mockVerifyToken.mockRejectedValue({ code: 'TOKEN_INVALID', message: 'Unknown issuer' });
      const { req, res, next } = createMocks({
        req: { headers: { authorization: 'Bearer wrong-issuer-token' } }
      });
      await authenticateToken(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(logger.error).toHaveBeenCalledWith(
        '[KEYCLOAK-AUTH] verifyToken failed',
        expect.objectContaining({ err_code: 'TOKEN_INVALID', token_issuer: 'unparseable' })
      );
    });

    it('should attach user object for valid token with admin role', async () => {
      const payload = createMockPayload(['admin']);
      mockVerifyToken.mockResolvedValue(payload);

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
    });

    // D4 (review fix 2026-11-07): the okf_scopes claim mapping runs in this
    // middleware but was never asserted anywhere — the D4 route suite mocks
    // the middleware wholesale, so a dropped/misnamed mapping would 403 every
    // legitimately-granted scope holder on restricted sources with green
    // gates. Pin the mapping here on the REAL middleware.
    it('should map the okf_scopes array claim onto req.user.okfScopes', async () => {
      const payload = { ...createMockPayload(['user']), okf_scopes: ['okf:t:repo-a:read', 'okf:t:*:admin'] };
      mockVerifyToken.mockResolvedValue(payload);

      const { req, res, next } = createMocks({
        req: { headers: { authorization: 'Bearer valid-token' } }
      });
      await authenticateToken(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.user.okfScopes).toEqual(['okf:t:repo-a:read', 'okf:t:*:admin']);
    });

    it('should default req.user.okfScopes to [] when the claim is absent', async () => {
      const payload = createMockPayload(['user']); // no okf_scopes claim
      mockVerifyToken.mockResolvedValue(payload);

      const { req, res, next } = createMocks({
        req: { headers: { authorization: 'Bearer valid-token' } }
      });
      await authenticateToken(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.user.okfScopes).toEqual([]);
    });

    it('should map dataprep-service role correctly', async () => {
      const payload = createMockPayload(['dataprep-service']);
      mockVerifyToken.mockResolvedValue(payload);

      const { req, res, next } = createMocks({
        req: { headers: { authorization: 'Bearer valid-token' } }
      });
      await authenticateToken(req, res, next);

      expect(req.user.role).toBe('dataprep-service');
    });

    it('should map the okf-service role verbatim', async () => {
      const payload = createMockPayload(['default-roles-genie', 'offline_access', 'okf-service']);
      mockVerifyToken.mockResolvedValue(payload);

      const { req, res, next } = createMocks({
        req: { headers: { authorization: 'Bearer okf-service-token' } }
      });
      await authenticateToken(req, res, next);

      expect(req.user.role).toBe('okf-service');
    });

    it('should map the tools-admin role verbatim', async () => {
      const payload = createMockPayload(['default-roles-genie', 'offline_access', 'tools-admin']);
      mockVerifyToken.mockResolvedValue(payload);

      const { req, res, next } = createMocks({
        req: { headers: { authorization: 'Bearer tools-admin-token' } }
      });
      await authenticateToken(req, res, next);

      expect(req.user.role).toBe('tools-admin');
    });

    it('should map user role with first letter capitalized', async () => {
      const payload = createMockPayload(['user']);
      mockVerifyToken.mockResolvedValue(payload);

      const { req, res, next } = createMocks({
        req: { headers: { authorization: 'Bearer valid-token' } }
      });
      await authenticateToken(req, res, next);

      expect(req.user.role).toBe('User');
    });

    it('should default to User when roles array is empty', async () => {
      const payload = createMockPayload([]);
      mockVerifyToken.mockResolvedValue(payload);

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
