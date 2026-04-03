'use strict';

// Set env vars before requiring service (they're read at module load time)
process.env.KEYCLOAK_URL = 'http://localhost:8080';
process.env.KEYCLOAK_REALM = 'genie';
process.env.KEYCLOAK_CLIENT_ID = 'genie-app';

const {
  mockJwtPayload,
  mockExpiredPayload,
  mockWrongAudPayload,
  generateMockJwtString
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
// Use var so jest.mock factory (hoisted above) can access them via closures
var mockJwtVerify;
var mockCreateRemoteJWKSet;
var mockFetch;

// Mock jose completely to avoid ESM issues
jest.mock('jose', () => ({
  jwtVerify: (...args) => mockJwtVerify(...args),
  createRemoteJWKSet: (...args) => mockCreateRemoteJWKSet(...args)
}));

// Mock global fetch for OIDC discovery
global.fetch = jest.fn();

const keycloakAuthService = require('../services/keycloak-auth-service');

// Discovery response matching KEYCLOAK_URL + KEYCLOAK_REALM
const mockDiscovery = {
  issuer: 'http://localhost:8080/realms/genie',
  jwks_uri: 'http://localhost:8080/realms/genie/protocol/openid-connect/certs'
};

describe('keycloakAuthService', () => {
  beforeEach(() => {
    keycloakAuthService._resetForTesting();
    mockCreateRemoteJWKSet = jest.fn().mockReturnValue(jest.fn());
    mockJwtVerify = jest.fn();
    mockFetch = global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockDiscovery
    });
  });

  describe('verifyToken', () => {
    it('should lazily initialize and return decoded payload with iss_sub', async () => {
      mockJwtVerify.mockResolvedValue({
        payload: mockJwtPayload,
        protectedHeader: { alg: 'RS256' }
      });

      const token = generateMockJwtString(mockJwtPayload);
      const result = await keycloakAuthService.verifyToken(token);

      expect(result).toBeDefined();
      expect(result.iss_sub).toBe(`${mockJwtPayload.iss}#${mockJwtPayload.sub}`);
      // Discovery was called lazily
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/realms/genie/.well-known/openid-configuration'
      );
      expect(mockJwtVerify).toHaveBeenCalledWith(
        token,
        expect.any(Function),
        expect.objectContaining({
          issuer: mockJwtPayload.iss,
          algorithms: ['RS256'],
          requiredClaims: ['iss', 'exp']
        })
      );
    });

    it('should throw TOKEN_EXPIRED when jose reports JWTExpired', async () => {
      const jwtExpiredError = new Error('exp check failed');
      jwtExpiredError.name = 'JWTExpired';
      mockJwtVerify.mockRejectedValue(jwtExpiredError);

      const token = generateMockJwtString(mockExpiredPayload);

      await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
        code: 'TOKEN_EXPIRED',
        message: 'Token has expired'
      });
    });

    it('should throw TOKEN_INVALID for wrong azp (client ID mismatch)', async () => {
      mockJwtVerify.mockResolvedValue({
        payload: { ...mockJwtPayload, azp: 'wrong-client-id' },
        protectedHeader: { alg: 'RS256' }
      });

      const token = generateMockJwtString(mockJwtPayload);

      await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
        code: 'TOKEN_INVALID',
        message: 'Token audience validation failed'
      });
    });

    it('should throw TOKEN_INVALID for issuer not in discovery map (no Keycloak URL exposed)', async () => {
      const wrongIssPayload = {
        ...mockJwtPayload,
        iss: 'http://evil.com/realms/genie',
        exp: Math.floor(Date.now() / 1000) + 3600
      };
      const token = generateMockJwtString(wrongIssPayload);

      const error = await keycloakAuthService.verifyToken(token).catch(e => e);
      expect(error).toMatchObject({
        code: 'TOKEN_INVALID',
        message: 'Unknown issuer'
      });
      expect(error.message).not.toContain('evil.com');
    });

    it('should throw TOKEN_INVALID when azp does not match client ID', async () => {
      mockJwtVerify.mockResolvedValue({
        payload: { ...mockJwtPayload, azp: 'wrong-client-id' },
        protectedHeader: { alg: 'RS256' }
      });

      const token = generateMockJwtString(mockJwtPayload);

      await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
        code: 'TOKEN_INVALID',
        message: 'Token audience validation failed'
      });
    });

    it('should accept token with correct azp', async () => {
      mockJwtVerify.mockResolvedValue({
        payload: mockJwtPayload,
        protectedHeader: { alg: 'RS256' }
      });

      const token = generateMockJwtString(mockJwtPayload);
      const result = await keycloakAuthService.verifyToken(token);

      expect(result.azp).toBe('genie-app');
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

    it('should throw TOKEN_INVALID for unknown issuer (not in discovery map)', async () => {
      const unknownIssPayload = {
        ...mockJwtPayload,
        iss: 'https://unknown-idp.example.com/realms/genie',
        exp: Math.floor(Date.now() / 1000) + 3600
      };
      const token = generateMockJwtString(unknownIssPayload);

      await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
        code: 'TOKEN_INVALID',
        message: 'Unknown issuer'
      });
    });

    it('should throw TOKEN_INVALID when jwtVerify throws generic error (signature failure)', async () => {
      mockJwtVerify.mockRejectedValue(new Error('Signature verification failed'));

      const token = generateMockJwtString(mockJwtPayload);

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

      const result = await keycloakAuthService.verifyToken(generateMockJwtString(mockJwtPayload));

      expect(result.realm_access).toBeDefined();
      expect(result.realm_access.roles).toEqual(['user', 'admin']);
    });

    it('should pass JWKS URI from discovery to createRemoteJWKSet', async () => {
      mockJwtVerify.mockResolvedValue({
        payload: mockJwtPayload,
        protectedHeader: { alg: 'RS256' }
      });

      await keycloakAuthService.verifyToken(generateMockJwtString(mockJwtPayload));

      expect(mockCreateRemoteJWKSet).toHaveBeenCalledWith(
        expect.objectContaining({ href: mockDiscovery.jwks_uri })
      );
    });

    it('should throw TOKEN_INVALID with generic message for azp mismatch (no client ID exposed)', async () => {
      mockJwtVerify.mockResolvedValue({
        payload: { ...mockJwtPayload, azp: 'wrong-client-id' },
        protectedHeader: { alg: 'RS256' }
      });

      const token = generateMockJwtString(mockJwtPayload);

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

      const token = generateMockJwtString(mockJwtPayload);

      await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
        code: 'TOKEN_INVALID',
        message: 'Token verification failed'
      });
    });

    it('should not re-fetch discovery on subsequent calls after successful init', async () => {
      mockJwtVerify.mockResolvedValue({
        payload: mockJwtPayload,
        protectedHeader: { alg: 'RS256' }
      });

      await keycloakAuthService.verifyToken(generateMockJwtString(mockJwtPayload));
      await keycloakAuthService.verifyToken(generateMockJwtString(mockJwtPayload));

      // fetch called only once (lazy init)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('lazy init with retry cooldown', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should return temporarily unavailable after init failure', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 502, statusText: 'Bad Gateway' });

      const token = generateMockJwtString(mockJwtPayload);

      await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
        code: 'TOKEN_INVALID',
        message: 'Authentication service is temporarily unavailable'
      });
    });

    it('should not retry init within cooldown period', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 502, statusText: 'Bad Gateway' });

      const token = generateMockJwtString(mockJwtPayload);

      // First call fails and sets cooldown
      await keycloakAuthService.verifyToken(token).catch(() => {});
      const fetchCountAfterFirst = mockFetch.mock.calls.length;

      // Second call within cooldown — should NOT call fetch again
      await keycloakAuthService.verifyToken(token).catch(() => {});
      expect(mockFetch.mock.calls.length).toBe(fetchCountAfterFirst);
    });

    it('should retry init after cooldown expires', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 502, statusText: 'Bad Gateway' });

      const token = generateMockJwtString(mockJwtPayload);

      // First call fails
      await keycloakAuthService.verifyToken(token).catch(() => {});

      // Advance past cooldown (30s)
      const nowSpy = jest.spyOn(Date, 'now');
      nowSpy.mockReturnValue(Date.now() + 31000);

      // Now fetch should be called again
      await keycloakAuthService.verifyToken(token).catch(() => {});
      expect(mockFetch.mock.calls.length).toBe(2);

      nowSpy.mockRestore();
    });

    it('should recover after successful init following failure', async () => {
      // First call: discovery fails
      mockFetch.mockResolvedValue({ ok: false, status: 502, statusText: 'Bad Gateway' });
      const token = generateMockJwtString(mockJwtPayload);
      await keycloakAuthService.verifyToken(token).catch(() => {});

      // Advance past cooldown
      const nowSpy = jest.spyOn(Date, 'now');
      nowSpy.mockReturnValue(Date.now() + 31000);

      // Second call: discovery succeeds
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockDiscovery
      });
      mockJwtVerify.mockResolvedValue({
        payload: mockJwtPayload,
        protectedHeader: { alg: 'RS256' }
      });

      const result = await keycloakAuthService.verifyToken(token);
      expect(result.sub).toBe(mockJwtPayload.sub);

      nowSpy.mockRestore();
    });
  });

  describe('init', () => {
    it('should populate issuerMap from discovery document', async () => {
      await keycloakAuthService.init();
      const issuers = keycloakAuthService.getConfiguredIssuers();
      expect(issuers).toContain('http://localhost:8080/realms/genie');
    });

    it('should throw if discovery fetch fails', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 502, statusText: 'Bad Gateway' });

      await expect(keycloakAuthService.init()).rejects.toThrow('OIDC discovery failed');
    });

    it('should throw if discovery document is missing required fields', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ issuer: 'http://localhost:8080/realms/genie' })
      });

      await expect(keycloakAuthService.init()).rejects.toThrow('missing required fields');
    });
  });

  describe('getExpectedIssuer', () => {
    it('should return undefined when not initialized', () => {
      expect(keycloakAuthService.getExpectedIssuer()).toBeUndefined();
    });

    it('should return the issuer from discovery after init', async () => {
      await keycloakAuthService.init();
      expect(keycloakAuthService.getExpectedIssuer()).toBe('http://localhost:8080/realms/genie');
    });
  });

  describe('getClientId', () => {
    it('should return the configured client ID', () => {
      expect(keycloakAuthService.getClientId()).toBe('genie-app');
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

  describe('JWKS cache with TTL', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should reuse cached JWKS within TTL (no re-fetch)', async () => {
      const mockJwksFunction = jest.fn().mockResolvedValue({ key: 'cached-key' });
      mockCreateRemoteJWKSet.mockReturnValue(mockJwksFunction);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockDiscovery
      });
      mockJwtVerify.mockResolvedValue({
        payload: mockJwtPayload,
        protectedHeader: { alg: 'RS256' }
      });

      // First call: initializes and caches JWKS
      await keycloakAuthService.init();
      const createRemoteCallCount = mockCreateRemoteJWKSet.mock.calls.length;

      // Second call within TTL: should reuse cache
      await keycloakAuthService.verifyToken(generateMockJwtString(mockJwtPayload));

      // createRemoteJWKSet should NOT be called again
      expect(mockCreateRemoteJWKSet.mock.calls.length).toBe(createRemoteCallCount);
    });

    it('should re-fetch JWKS after TTL expires (5 minutes)', async () => {
      // Test createJwksCache directly to verify TTL behavior
      const nowSpy = jest.spyOn(Date, 'now');
      const now = 1000000;
      nowSpy.mockReturnValue(now);

      let createRemoteCallCount = 0;
      mockCreateRemoteJWKSet.mockImplementation(() => {
        createRemoteCallCount++;
        return jest.fn().mockResolvedValue({ key: `key-${createRemoteCallCount}` });
      });

      // Create a JWKS cache - calls createRemoteJWKSet once during creation
      const jwksCache = keycloakAuthService.createJwksCache('http://example.com/jwks');
      expect(createRemoteCallCount).toBe(1);

      // Call within TTL - should reuse cached inner function (no additional createRemoteJWKSet call)
      await jwksCache({ alg: 'RS256' }, 'token');
      expect(createRemoteCallCount).toBe(1);

      // Advance time past TTL (5 minutes + 1 second)
      nowSpy.mockReturnValue(now + 301000);

      // Call after TTL - should trigger re-fetch (createRemoteJWKSet called again)
      await jwksCache({ alg: 'RS256' }, 'token');
      expect(createRemoteCallCount).toBe(2);

      nowSpy.mockRestore();
    });

    it('should force refresh JWKS when forceRefresh() is called', async () => {
      // Test createJwksCache directly to verify forceRefresh behavior
      const nowSpy = jest.spyOn(Date, 'now');
      const now = 1000000;
      nowSpy.mockReturnValue(now);

      let createRemoteCallCount = 0;
      mockCreateRemoteJWKSet.mockImplementation(() => {
        createRemoteCallCount++;
        return jest.fn().mockResolvedValue({ key: `key-${createRemoteCallCount}` });
      });

      // Create a JWKS cache - calls createRemoteJWKSet once during creation
      const jwksCache = keycloakAuthService.createJwksCache('http://example.com/jwks');
      expect(createRemoteCallCount).toBe(1);

      // Call within TTL - should reuse
      await jwksCache({ alg: 'RS256' }, 'token');
      expect(createRemoteCallCount).toBe(1);

      // Force refresh by calling forceRefresh() method
      jwksCache.forceRefresh();

      // Next call should re-fetch (createRemoteJWKSet called again)
      await jwksCache({ alg: 'RS256' }, 'token');
      expect(createRemoteCallCount).toBe(2);

      nowSpy.mockRestore();
    });

    it('should maintain independent cache per issuer', async () => {
      const discovery1 = {
        issuer: 'http://localhost:8080/realms/genie',
        jwks_uri: 'http://localhost:8080/realms/genie/protocol/openid-connect/certs'
      };
      const discovery2 = {
        issuer: 'http://localhost:8080/realms/genie2',
        jwks_uri: 'http://localhost:8080/realms/genie2/protocol/openid-connect/certs'
      };

      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => discovery1 })
        .mockResolvedValueOnce({ ok: true, json: async () => discovery2 });

      mockJwtVerify.mockResolvedValue({
        payload: mockJwtPayload,
        protectedHeader: { alg: 'RS256' }
      });

      // Initialize first issuer
      await keycloakAuthService.init('http://localhost:8080/realms/genie');

      // Initialize second issuer
      await keycloakAuthService.init('http://localhost:8080/realms/genie2');

      const issuers = keycloakAuthService.getConfiguredIssuers();
      expect(issuers).toHaveLength(2);

      // Each issuer should have its own cache
      const cache1 = keycloakAuthService._getJwksCache(discovery1.issuer);
      const cache2 = keycloakAuthService._getJwksCache(discovery2.issuer);

      expect(cache1).not.toBe(cache2);
    });
  });

  describe('verifyToken with force-refresh on signature failure', () => {
    beforeEach(() => {
      // Reset mocks
      mockCreateRemoteJWKSet = jest.fn().mockReturnValue(jest.fn());
      mockJwtVerify = jest.fn();
      mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockDiscovery
      });
    });

    it('should force-refresh JWKS on signature failure with valid exp and retry once', async () => {
      const signatureError = new Error('Signature verification failed');
      mockJwtVerify
        .mockRejectedValueOnce(signatureError) // First call: signature fails
        .mockResolvedValueOnce({ // Second call: succeeds after refresh
          payload: mockJwtPayload,
          protectedHeader: { alg: 'RS256' }
        });

      mockCreateRemoteJWKSet.mockReturnValue(jest.fn());

      const token = generateMockJwtString(mockJwtPayload);
      const result = await keycloakAuthService.verifyToken(token);

      // Should have succeeded on retry
      expect(result).toBeDefined();
      expect(result.iss_sub).toBe(`${mockJwtPayload.iss}#${mockJwtPayload.sub}`);

      // jwtVerify should be called twice (initial + retry)
      expect(mockJwtVerify).toHaveBeenCalledTimes(2);
    });

    it('should reject with TOKEN_INVALID when retry also fails', async () => {
      const signatureError = new Error('Signature verification failed');
      mockJwtVerify
        .mockRejectedValueOnce(signatureError) // First call: fails
        .mockRejectedValueOnce(signatureError); // Retry: also fails

      mockCreateRemoteJWKSet.mockReturnValue(jest.fn());

      const token = generateMockJwtString(mockJwtPayload);

      await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
        code: 'TOKEN_INVALID',
        message: 'Token verification failed'
      });

      // jwtVerify should be called twice (initial + retry)
      expect(mockJwtVerify).toHaveBeenCalledTimes(2);
    });

    it('should reject immediately with TOKEN_EXPIRED for expired token (no refresh)', async () => {
      const jwtExpiredError = new Error('exp check failed');
      jwtExpiredError.name = 'JWTExpired';
      mockJwtVerify.mockRejectedValue(jwtExpiredError);

      const token = generateMockJwtString(mockExpiredPayload);

      await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
        code: 'TOKEN_EXPIRED',
        message: 'Token has expired'
      });

      // jwtVerify should be called only once (no retry)
      expect(mockJwtVerify).toHaveBeenCalledTimes(1);
    });

    it('should not force-refresh for expired token even on signature error', async () => {
      const signatureError = new Error('Signature verification failed');
      mockJwtVerify.mockRejectedValue(signatureError);

      // Token with exp in the past
      const expiredPayload = {
        ...mockJwtPayload,
        exp: Math.floor(Date.now() / 1000) - 3600
      };
      const token = generateMockJwtString(expiredPayload);

      await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
        code: 'TOKEN_EXPIRED',
        message: 'Token has expired'
      });

      // jwtVerify should be called only once (no retry for expired tokens)
      expect(mockJwtVerify).toHaveBeenCalledTimes(1);
    });

    it('should reject with TOKEN_INVALID on JWTClaimValidationFailed (iss mismatch)', async () => {
      const claimError = new Error('iss claim validation failed');
      claimError.name = 'JWTClaimValidationFailed';
      claimError.claim = 'iss';
      mockJwtVerify.mockRejectedValue(claimError);

      const token = generateMockJwtString(mockJwtPayload);

      await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
        code: 'TOKEN_INVALID',
        message: 'Token issuer validation failed'
      });

      // jwtVerify should be called only once (claim errors don't trigger refresh)
      expect(mockJwtVerify).toHaveBeenCalledTimes(1);
    });

    it('should succeed on retry after force-refresh', async () => {
      const signatureError = new Error('Signature verification failed');
      mockJwtVerify
        .mockRejectedValueOnce(signatureError)
        .mockResolvedValueOnce({
          payload: mockJwtPayload,
          protectedHeader: { alg: 'RS256' }
        });

      mockCreateRemoteJWKSet.mockReturnValue(jest.fn());

      const token = generateMockJwtString(mockJwtPayload);
      const result = await keycloakAuthService.verifyToken(token);

      expect(result.iss_sub).toBe(`${mockJwtPayload.iss}#${mockJwtPayload.sub}`);
      expect(mockJwtVerify).toHaveBeenCalledTimes(2);
    });

    it('should handle forceRefresh errors gracefully', async () => {
      const signatureError = new Error('Signature verification failed');
      mockJwtVerify.mockRejectedValue(signatureError);

      // Mock forceRefresh to throw (network error scenario)
      mockCreateRemoteJWKSet.mockImplementation(() => {
        const fn = jest.fn().mockRejectedValue(new Error('Network error'));
        fn.forceRefresh = () => { throw new Error('Network error'); };
        return fn;
      });

      const token = generateMockJwtString(mockJwtPayload);

      await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
        code: 'TOKEN_INVALID',
        message: 'Token verification failed'
      });
    });
  });
});
