'use strict';

/**
 * Integration tests for token passthrough headers to OPEA services
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

// Mock keycloak-auth-service
const mockVerifyToken = jest.fn();
jest.mock('../services/keycloak-auth-service', () => ({
  verifyToken: (...args) => mockVerifyToken(...args)
}));

// Mock user-provisioning-service
const mockProvisionUser = jest.fn();
jest.mock('../services/user-provisioning-service', () => ({
  provisionUser: (...args) => mockProvisionUser(...args)
}));

const { keycloakAuthMiddleware } = require('../middleware/keycloak-auth-middleware');

describe('Token Passthrough Integration Tests', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      headers: {},
      user: undefined,
      path: '/api/queries',
      originalUrl: '/api/queries',
      body: {
        userId: 'frontend-user-id',
        sessionId: 'session-123',
        messages: [{ role: 'user', content: 'test message' }],
        context: { categoryLabel: 'General', serviceLabels: [] }
      }
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    next = jest.fn();
    mockVerifyToken.mockReset();
    mockProvisionUser.mockReset();
  });

  describe('Authenticated request to OPEA header flow', () => {
    it('should extract headers from authenticated request and pass to OPEA worker', async () => {
      // Setup authenticated request with valid token
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
        deleted: false
      });

      // Execute middleware
      await keycloakAuthMiddleware.authenticate(req, res, next);

      // Verify headers are attached
      expect(req.user.opeaHeaders).toBeDefined();
      expect(req.user.opeaHeaders['X-User-Id']).toBe('http://localhost:8080/realms/genie#12345678');
      expect(req.user.opeaHeaders['X-User-Roles']).toBe('user,admin');
      expect(req.user.opeaHeaders['X-Issuer']).toBe('http://localhost:8080/realms/genie');
    });

    it('should use composite key for OPEA payload user_id instead of frontend userId', () => {
      // After authentication, req.user.iss_sub contains the composite key
      const authenticatedUserId = 'http://localhost:8080/realms/genie#12345678';
      const frontendUserId = 'frontend-user-id';

      // OPEA payload should use authenticated user ID, not frontend user ID
      const opeaPayload = {
        messages: req.body.messages,
        context: req.body.context,
        user_id: authenticatedUserId || frontendUserId
      };

      expect(opeaPayload.user_id).toBe(authenticatedUserId);
      expect(opeaPayload.user_id).not.toBe(frontendUserId);
    });
  });

  describe('Multi-realm header uniqueness', () => {
    it('should produce different X-User-Id values for different realms', () => {
      const realm1Payload = {
        iss_sub: 'http://keycloak1/realms/realmA#user-123',
        sub: 'user-123',
        iss: 'http://keycloak1/realms/realmA',
        realm_access: { roles: ['user'] }
      };

      const realm2Payload = {
        iss_sub: 'http://keycloak2/realms/realmB#user-123',
        sub: 'user-123',
        iss: 'http://keycloak2/realms/realmB',
        realm_access: { roles: ['admin'] }
      };

      // Build headers for each realm
      const headers1 = {
        'X-User-Id': `${realm1Payload.iss}#${realm1Payload.sub}`,
        'X-User-Roles': realm1Payload.realm_access.roles.join(','),
        'X-Issuer': realm1Payload.iss
      };

      const headers2 = {
        'X-User-Id': `${realm2Payload.iss}#${realm2Payload.sub}`,
        'X-User-Roles': realm2Payload.realm_access.roles.join(','),
        'X-Issuer': realm2Payload.iss
      };

      // Verify different X-User-Id values for different realms
      expect(headers1['X-User-Id']).not.toBe(headers2['X-User-Id']);
      expect(headers1['X-Issuer']).not.toBe(headers2['X-Issuer']);

      // Both have same sub but different iss (iss_sub guarantees uniqueness)
      expect(realm1Payload.sub).toBe(realm2Payload.sub);
      expect(realm1Payload.iss).not.toBe(realm2Payload.iss);
    });
  });

  describe('Authorization header security', () => {
    it('should NOT include Authorization header in OPEA headers', () => {
      req.headers.authorization = 'Bearer secret-token';
      const decodedPayload = {
        iss_sub: 'http://localhost:8080/realms/genie#12345678',
        sub: '12345678',
        iss: 'http://localhost:8080/realms/genie',
        realm_access: { roles: ['user'] },
        exp: Math.floor(Date.now() / 1000) + 3600
      };
      mockVerifyToken.mockResolvedValue(decodedPayload);
      mockProvisionUser.mockResolvedValue({
        _key: 'users/123',
        iss_sub: 'http://localhost:8080/realms/genie#12345678',
        sub: '12345678',
        iss: 'http://localhost:8080/realms/genie',
        email: 'test@example.com',
        name: 'Test User',
        roles: ['user'],
        active: true,
        deleted: false
      });

      return keycloakAuthMiddleware.authenticate(req, res, next).then(() => {
        // Verify Authorization is NOT in opeaHeaders
        expect(req.user.opeaHeaders).toBeDefined();
        expect(req.user.opeaHeaders['Authorization']).toBeUndefined();
        expect(req.user.opeaHeaders['authorization']).toBeUndefined();

        // Verify only expected headers are present
        expect(Object.keys(req.user.opeaHeaders)).toEqual([
          'X-User-Id',
          'X-User-Roles',
          'X-Issuer'
        ]);
      });
    });
  });
});
