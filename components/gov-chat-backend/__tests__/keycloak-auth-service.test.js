'use strict';

// Set env vars before requiring service (they're read at module load time)
process.env.KEYCLOAK_URL = 'http://localhost:8080';
process.env.KEYCLOAK_REALM = 'genie';
process.env.KEYCLOAK_CLIENT_ID = 'genie-app';

const {
  mockJwtPayload,
  mockExpiredPayload,
  mockWrongAudPayload,
  mockMissingClaimsPayload
} = require('./mocks/mockJwtPayload');

// Mock shared-lib
jest.mock('../shared-lib', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}), { virtual: true });

// Store references to mock functions
let mockJwtVerify;
let mockCreateRemoteJWKS;

// Mock jose completely to avoid ESM issues
jest.mock('jose', () => ({
  jwtVerify: (...args) => mockJwtVerify(...args),
  createRemoteJWKS: (...args) => mockCreateRemoteJWKS(...args)
}));

const keycloakAuthService = require('../services/keycloak-auth-service');

describe('keycloakAuthService', () => {
  beforeEach(() => {
    // Default: createRemoteJWKS returns a function (as jose does)
    mockCreateRemoteJWKS = jest.fn().mockReturnValue(jest.fn());
    mockJwtVerify = jest.fn();
  });

  describe('verifyToken', () => {
    it('should return decoded payload with iss_sub composite key for a valid token', async () => {
      mockJwtVerify.mockResolvedValue({
        payload: mockJwtPayload,
        protectedHeader: { alg: 'RS256' }
      });

      const token = createTokenWithPayload(mockJwtPayload);
      const result = await keycloakAuthService.verifyToken(token);

      expect(result).toBeDefined();
      expect(result.sub).toBe(mockJwtPayload.sub);
      expect(result.iss).toBe(mockJwtPayload.iss);
      expect(result.aud).toBe(mockJwtPayload.aud);
      expect(result.iss_sub).toBe(`${mockJwtPayload.iss}#${mockJwtPayload.sub}`);
      expect(mockJwtVerify).toHaveBeenCalledWith(
        token,
        expect.any(Function),
        expect.objectContaining({
          algorithms: ['RS256'],
          requiredClaims: ['iss', 'aud', 'exp', 'sub']
        })
      );
    });

    it('should throw TOKEN_EXPIRED when token exp is in the past', async () => {
      // The service checks exp BEFORE calling jwtVerify
      const expiredToken = createTokenWithPayload(mockExpiredPayload);

      await expect(keycloakAuthService.verifyToken(expiredToken)).rejects.toMatchObject({
        code: 'TOKEN_EXPIRED',
        message: 'Token has expired'
      });

      // jwtVerify should NOT be called for expired tokens (early return)
      expect(mockJwtVerify).not.toHaveBeenCalled();
    });

    it('should throw TOKEN_INVALID for wrong audience', async () => {
      mockJwtVerify.mockResolvedValue({
        payload: mockWrongAudPayload,
        protectedHeader: { alg: 'RS256' }
      });

      const token = createTokenWithPayload(mockWrongAudPayload);

      await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
        code: 'TOKEN_INVALID',
        message: 'Token audience validation failed'
      });
    });

    it('should throw TOKEN_INVALID for array aud that does not include client ID', async () => {
      const arrayAudPayload = { ...mockJwtPayload, aud: ['other-client', 'another-client'] };
      mockJwtVerify.mockResolvedValue({
        payload: arrayAudPayload,
        protectedHeader: { alg: 'RS256' }
      });

      const token = createTokenWithPayload(arrayAudPayload);

      await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
        code: 'TOKEN_INVALID',
        message: 'Token audience validation failed'
      });
    });

    it('should accept array aud that includes client ID', async () => {
      const arrayAudPayload = { ...mockJwtPayload, aud: ['other-client', 'genie-app'] };
      mockJwtVerify.mockResolvedValue({
        payload: arrayAudPayload,
        protectedHeader: { alg: 'RS256' }
      });

      const token = createTokenWithPayload(arrayAudPayload);
      const result = await keycloakAuthService.verifyToken(token);

      expect(result.aud).toEqual(['other-client', 'genie-app']);
    });

    it('should throw TOKEN_INVALID for malformed JWT (not 3 parts)', async () => {
      await expect(keycloakAuthService.verifyToken('not-a-jwt')).rejects.toMatchObject({
        code: 'TOKEN_INVALID',
        message: 'Malformed JWT format'
      });
    });

    it('should throw TOKEN_INVALID for empty token', async () => {
      await expect(keycloakAuthService.verifyToken('')).rejects.toMatchObject({
        code: 'TOKEN_INVALID',
        message: 'Token is empty or not a string'
      });
    });

    it('should throw TOKEN_INVALID for null token', async () => {
      await expect(keycloakAuthService.verifyToken(null)).rejects.toMatchObject({
        code: 'TOKEN_INVALID',
        message: 'Token is empty or not a string'
      });
    });

    it('should throw TOKEN_INVALID when token has no iss claim', async () => {
      const noIssPayload = { ...mockJwtPayload, exp: Math.floor(Date.now() / 1000) + 3600, iss: undefined };
      const token = createTokenWithPayload(noIssPayload);

      await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
        code: 'TOKEN_INVALID',
        message: 'Token missing required iss claim'
      });
    });

    it('should throw TOKEN_INVALID when token has no exp claim', async () => {
      const noExpPayload = { ...mockJwtPayload, exp: undefined };
      const token = createTokenWithPayload(noExpPayload);

      await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
        code: 'TOKEN_INVALID',
        message: 'Token missing required exp claim'
      });
    });

    it('should pass JWKS URI from iss claim to createRemoteJWKS', async () => {
      mockJwtVerify.mockResolvedValue({
        payload: mockJwtPayload,
        protectedHeader: { alg: 'RS256' }
      });

      await keycloakAuthService.verifyToken(createTokenWithPayload(mockJwtPayload));

      expect(mockCreateRemoteJWKS).toHaveBeenCalledWith({
        url: 'http://localhost:8080/realms/genie/protocol/openid-connect/certs'
      });
    });

    it('should throw TOKEN_INVALID when jwtVerify throws', async () => {
      mockJwtVerify.mockRejectedValue(new Error('Signature verification failed'));

      const token = createTokenWithPayload(mockJwtPayload);

      await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
        code: 'TOKEN_INVALID',
        message: 'Token verification failed'
      });
    });

    it('should preserve realm_access roles in result', async () => {
      mockJwtVerify.mockResolvedValue({
        payload: mockJwtPayload,
        protectedHeader: { alg: 'RS256' }
      });

      const result = await keycloakAuthService.verifyToken(createTokenWithPayload(mockJwtPayload));

      expect(result.realm_access).toBeDefined();
      expect(result.realm_access.roles).toEqual(['user', 'admin']);
    });

    it('should throw TOKEN_INVALID with generic message for issuer mismatch (no Keycloak URL exposed)', async () => {
      const wrongIssPayload = {
        ...mockJwtPayload,
        iss: 'http://evil.com/realms/fake',
        exp: Math.floor(Date.now() / 1000) + 3600
      };

      const token = createTokenWithPayload(wrongIssPayload);

      const error = await keycloakAuthService.verifyToken(token).catch(e => e);
      expect(error).toMatchObject({
        code: 'TOKEN_INVALID',
        message: 'Token issuer validation failed'
      });
      expect(error.message).not.toContain('evil.com');
    });

    it('should throw TOKEN_INVALID with generic message for audience mismatch (no client ID exposed)', async () => {
      const wrongAudPayload = {
        ...mockJwtPayload,
        aud: 'wrong-client-id'
      };
      mockJwtVerify.mockResolvedValue({
        payload: wrongAudPayload,
        protectedHeader: { alg: 'RS256' }
      });

      const token = createTokenWithPayload(wrongAudPayload);

      const error = await keycloakAuthService.verifyToken(token).catch(e => e);
      expect(error).toMatchObject({
        code: 'TOKEN_INVALID',
        message: 'Token audience validation failed'
      });
      expect(error.message).not.toContain('genie-app');
      expect(error.message).not.toContain('wrong-client-id');
    });

    it('should throw TOKEN_INVALID for jwtVerify signature failure (revoked token scenario)', async () => {
      mockJwtVerify.mockRejectedValue(new Error('JWT signature verification failed: no matching key'));

      const token = createTokenWithPayload(mockJwtPayload);

      await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
        code: 'TOKEN_INVALID',
        message: 'Token verification failed'
      });
    });
  });

  describe('getExpectedIssuer', () => {
    it('should return the expected issuer URL from env vars', () => {
      const issuer = keycloakAuthService.getExpectedIssuer();
      expect(issuer).toContain('localhost:8080');
      expect(issuer).toContain('genie');
      expect(issuer).toMatch(/^https?:\/\/.+\/realms\/.+/);
    });
  });

  describe('getClientId', () => {
    it('should return the configured client ID', () => {
      const clientId = keycloakAuthService.getClientId();
      expect(clientId).toBe('genie-app');
    });
  });

  describe('TokenVerificationError', () => {
    it('should be exported and throwable', () => {
      const { TokenVerificationError } = keycloakAuthService;
      const err = new TokenVerificationError('TOKEN_INVALID', 'test message', { key: 'value' });
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe('TOKEN_INVALID');
      expect(err.message).toBe('test message');
      expect(err.details).toEqual({ key: 'value' });
    });
  });
});

/**
 * Helper: create a JWT-like string with given payload for testing
 */
function createTokenWithPayload(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key-id', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = Buffer.from('mock-signature').toString('base64url');
  return `${header}.${body}.${sig}`;
}
