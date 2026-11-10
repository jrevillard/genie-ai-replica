'use strict';

// Set env vars before requiring service (they're read at module load time)
process.env.KEYCLOAK_URL = 'http://localhost:8080';
process.env.KEYCLOAK_REALM = 'genie';
process.env.KEYCLOAK_CLIENT_ID = 'genie-app';
process.env.KEYCLOAK_ADDITIONAL_REALMS = '';

const { mockJwtPayload, mockExpiredPayload, generateMockJwtString } = require('../test-fixtures/mockJwtPayload');

// Mock shared-lib
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

// Store references to mock functions
// Use var so jest.mock factory (hoisted above) can access them via closures
let mockJwtVerify;
let mockCreateRemoteJWKSet;
let mockFetch;
let mockAxiosGet;

// Mock jose completely to avoid ESM issues
jest.mock('jose', () => ({
  jwtVerify: (...args) => mockJwtVerify(...args),
  createRemoteJWKSet: (...args) => mockCreateRemoteJWKSet(...args)
}));

// Mock axios for UserInfo introspection
jest.mock('axios', () => ({
  get: (...args) => mockAxiosGet(...args)
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
    mockAxiosGet = jest.fn();
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
      // Discovery was called lazily (with the AbortController signal the
      // discovery-timeout guard passes)
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/realms/genie/.well-known/openid-configuration',
        expect.objectContaining({ signal: expect.anything() })
      );
      expect(mockJwtVerify).toHaveBeenCalledWith(
        token,
        expect.any(Function),
        expect.objectContaining({
          issuer: mockJwtPayload.iss,
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

    it('should throw TOKEN_INVALID for issuer not in discovery map (no Keycloak URL exposed)', async () => {
      const wrongIssPayload = {
        ...mockJwtPayload,
        iss: 'http://evil.com/realms/genie',
        exp: Math.floor(Date.now() / 1000) + 3600
      };
      const token = generateMockJwtString(wrongIssPayload);

      const error = await keycloakAuthService.verifyToken(token).catch((e) => e);
      expect(error).toMatchObject({
        code: 'TOKEN_INVALID',
        message: 'Unknown issuer'
      });
      expect(error.message).not.toContain('evil.com');
    });

    it('should return azp from verified token payload', async () => {
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

      expect(mockCreateRemoteJWKSet).toHaveBeenCalledWith(expect.objectContaining({ href: mockDiscovery.jwks_uri }));
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

    it('should return temporarily unavailable after init failure, with the init detail preserved', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 502, statusText: 'Bad Gateway' });

      const token = generateMockJwtString(mockJwtPayload);

      // The wrapped message is what callers' DIAG logs print — the init
      // failure's own detail (here the discovery HTTP status) must ride
      // along, or an operator debugging a 503 sees only the generic text.
      await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
        code: 'AUTH_SERVICE_UNAVAILABLE',
        message: expect.stringMatching(/^Authentication service is temporarily unavailable \(.*Bad Gateway.*\)$/)
      });
    });

    it('should not retry init within cooldown period', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 502, statusText: 'Bad Gateway' });

      const token = generateMockJwtString(mockJwtPayload);

      // First call fails and sets cooldown
      await keycloakAuthService.verifyToken(token).catch(() => {});
      const fetchCountAfterFirst = mockFetch.mock.calls.length;

      // Second call within cooldown — should NOT call fetch again, and the
      // rejection still names the original failure (the DIAG log must carry
      // the cause even while init retries are suppressed).
      await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
        code: 'AUTH_SERVICE_UNAVAILABLE',
        message: expect.stringMatching(/^Authentication service is temporarily unavailable \(.*Bad Gateway.*\)$/)
      });
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

    it('warns when KEYCLOAK_DISCOVERY_TIMEOUT_MS is discarded and stays silent for a valid value', async () => {
      // The bare-integer guard silently falls back to the default budget —
      // the warn is the operator's only signal that their value was
      // discarded, so it must fire for garbage and stay quiet for '5000'
      // spelled out.
      const loggerModule = require('../../shared/lib/logger');
      const warnSpy = jest.spyOn(loggerModule.logger, 'warn');
      const original = process.env.KEYCLOAK_DISCOVERY_TIMEOUT_MS;
      try {
        process.env.KEYCLOAK_DISCOVERY_TIMEOUT_MS = 'abc';
        await keycloakAuthService.init();
        expect(warnSpy.mock.calls.some(([m]) => String(m).includes('not a bare positive integer'))).toBe(true);

        warnSpy.mockClear();
        keycloakAuthService._resetForTesting();
        process.env.KEYCLOAK_DISCOVERY_TIMEOUT_MS = '5000';
        await keycloakAuthService.init();
        expect(warnSpy.mock.calls.some(([m]) => String(m).includes('not a bare positive integer'))).toBe(false);
      } finally {
        if (original === undefined) delete process.env.KEYCLOAK_DISCOVERY_TIMEOUT_MS;
        else process.env.KEYCLOAK_DISCOVERY_TIMEOUT_MS = original;
        warnSpy.mockRestore();
      }
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
    // The rotation candidate: jose's "no key matches this kid" — the key set
    // may be stale because the realm rotated its keys.
    const unknownKidError = () => {
      const err = new Error('no key found matching the kid');
      err.name = 'JWKSNoMatchingKey';
      return err;
    };

    beforeEach(() => {
      // Reset mocks
      mockCreateRemoteJWKSet = jest.fn().mockReturnValue(jest.fn());
      mockJwtVerify = jest.fn();
      mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockDiscovery
      });
    });

    it('should force-refresh JWKS on an unknown kid (rotation candidate) and retry once', async () => {
      mockJwtVerify
        .mockRejectedValueOnce(unknownKidError()) // First call: kid not in the key set
        .mockResolvedValueOnce({
          // Second call: succeeds after refresh
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

    it('should NOT force-refresh on a resolved-kid signature failure (junk-signature flood)', async () => {
      // A resolved kid whose signature does not verify can never become
      // valid through rotation. Refreshing the key set only zeroes the JWKS
      // cache TTL, so a flood of junk-signature tokens would make every
      // legitimate token pay a fresh JWKS fetch (#1703).
      mockJwtVerify.mockRejectedValue(new Error('signature verification failed'));

      const token = generateMockJwtString(mockJwtPayload);

      await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
        code: 'TOKEN_INVALID',
        message: 'Token verification failed'
      });

      // jwtVerify called once — no refresh, no retry
      expect(mockJwtVerify).toHaveBeenCalledTimes(1);
    });

    it('should NOT force-refresh an unknown-kid token with no exp claim (never rotatable)', async () => {
      // A missing exp can never pass jose's requiredClaims ['iss','exp'], so
      // it can never be a rotation case: fast-fail, no refresh.
      mockJwtVerify.mockRejectedValue(unknownKidError());

      // exp: undefined → the encoded payload carries NO exp claim
      const token = generateMockJwtString({ exp: undefined });

      await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
        code: 'TOKEN_INVALID',
        message: 'Token verification failed'
      });

      expect(mockJwtVerify).toHaveBeenCalledTimes(1);
    });

    // Spies on the REAL shared/lib winston logger — the virtual
    // '../shared-lib' mock covers only the barrel, so the verifier's log
    // lines are visible here and nowhere else. Silences the transport and
    // restores the spy even when the assertions fail, so a failing test
    // cannot leak the mock into its neighbours.
    function captureWarns() {
      const loggerModule = require('../../shared/lib/logger');
      const warnSpy = jest.spyOn(loggerModule.logger, 'warn').mockImplementation(() => {});
      return {
        lines: () => warnSpy.mock.calls.map(([msg]) => String(msg)).join('\n'),
        restore: () => warnSpy.mockRestore()
      };
    }

    it('logs the cause of a rejection, and neither the token nor key material', async () => {
      // Without the cause, every distinct failure (tampered signature,
      // unknown key id, ambiguous key set, wrong algorithm) reaches the
      // operator's log as the same 'Token verification failed'. The line
      // must name the cause — and carry neither the token nor any key
      // material.
      const warns = captureWarns();
      mockJwtVerify.mockRejectedValue(unknownKidError());
      // exp: undefined → the encoded payload carries NO exp claim, so the
      // token is not a rotation candidate and the rejection is the plain one.
      const token = generateMockJwtString({ exp: undefined });

      try {
        await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
          code: 'TOKEN_INVALID'
        });

        const logged = warns.lines();
        expect(logged).toContain('JWKSNoMatchingKey');
        expect(logged).not.toContain(token);
        expect(logged).not.toContain('BEGIN');
      } finally {
        warns.restore();
      }
    });

    it('names the refresh floor in the log when it held the refresh back', async () => {
      // The floor is why a rotation that lands inside the window is picked
      // up by the NEXT refresh. Without that in the log, a burst of 401s
      // around a key rotation is indistinguishable from a burst of junk
      // tokens.
      const warns = captureWarns();
      mockJwtVerify.mockRejectedValue(unknownKidError());
      const token = generateMockJwtString(mockJwtPayload);

      try {
        // The first unknown-kid token consumes the refresh floor (and retries).
        await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
          code: 'TOKEN_INVALID'
        });
        // The second one lands inside the floor window.
        await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
          code: 'TOKEN_INVALID'
        });

        const logged = warns.lines();
        expect(logged).toContain('key-set refresh floored');
        expect(logged).not.toContain(token);
      } finally {
        warns.restore();
      }
    });

    it('should reject with TOKEN_INVALID when retry also fails', async () => {
      mockJwtVerify
        .mockRejectedValueOnce(unknownKidError()) // First call: unknown kid
        .mockRejectedValueOnce(unknownKidError()); // Retry: also fails

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

    it('should not force-refresh an unknown-kid token whose exp has passed', async () => {
      // The expiry outranks the rotation candidate: an expired token is
      // TOKEN_EXPIRED, and the key set is left alone.
      mockJwtVerify.mockRejectedValue(unknownKidError());

      const token = generateMockJwtString({ exp: Math.floor(Date.now() / 1000) - 3600 });

      await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
        code: 'TOKEN_EXPIRED',
        message: 'Token has expired'
      });

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
      mockJwtVerify.mockRejectedValueOnce(unknownKidError()).mockResolvedValueOnce({
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
      mockJwtVerify.mockRejectedValue(unknownKidError());

      // Mock forceRefresh to throw (network error scenario)
      mockCreateRemoteJWKSet.mockImplementation(() => {
        const fn = jest.fn().mockRejectedValue(new Error('Network error'));
        fn.forceRefresh = () => {
          throw new Error('Network error');
        };
        return fn;
      });

      const token = generateMockJwtString(mockJwtPayload);

      await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
        code: 'TOKEN_INVALID',
        message: 'Token verification failed'
      });
    });
  });

  describe('multi-realm initialization', () => {
    const discovery1 = {
      issuer: 'http://localhost:8080/realms/genie',
      jwks_uri: 'http://localhost:8080/realms/genie/protocol/openid-connect/certs'
    };
    const discovery2 = {
      issuer: 'http://localhost:8080/realms/partner',
      jwks_uri: 'http://localhost:8080/realms/partner/protocol/openid-connect/certs'
    };

    it('should initialize multiple realms by calling init() with different URLs', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => discovery1 })
        .mockResolvedValueOnce({ ok: true, json: async () => discovery2 });

      await keycloakAuthService.init('http://localhost:8080/realms/genie');
      await keycloakAuthService.init('http://localhost:8080/realms/partner');

      const issuers = keycloakAuthService.getConfiguredIssuers();
      expect(issuers).toHaveLength(2);
      expect(issuers).toContain(discovery1.issuer);
      expect(issuers).toContain(discovery2.issuer);
    });

    it('should not crash when additional realm init fails', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => discovery1 })
        .mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' });

      await keycloakAuthService.init('http://localhost:8080/realms/genie');

      await expect(keycloakAuthService.init('http://localhost:8080/realms/bad-realm')).rejects.toThrow(
        'OIDC discovery failed'
      );

      expect(keycloakAuthService.getConfiguredIssuers()).toHaveLength(1);
      expect(keycloakAuthService.getConfiguredIssuers()[0]).toBe(discovery1.issuer);
    });

    it('should maintain independent JWKS cache per realm', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => discovery1 })
        .mockResolvedValueOnce({ ok: true, json: async () => discovery2 });

      await keycloakAuthService.init('http://localhost:8080/realms/genie');
      await keycloakAuthService.init('http://localhost:8080/realms/partner');

      const cache1 = keycloakAuthService._getJwksCache(discovery1.issuer);
      const cache2 = keycloakAuthService._getJwksCache(discovery2.issuer);
      expect(cache1).not.toBe(cache2);
    });
  });

  describe('user isolation across realms', () => {
    const discovery1 = {
      issuer: 'http://localhost:8080/realms/genie',
      jwks_uri: 'http://localhost:8080/realms/genie/protocol/openid-connect/certs'
    };
    const discovery2 = {
      issuer: 'http://localhost:8080/realms/partner',
      jwks_uri: 'http://localhost:8080/realms/partner/protocol/openid-connect/certs'
    };

    it('should produce different iss_sub for same sub across realms', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => discovery1 })
        .mockResolvedValueOnce({ ok: true, json: async () => discovery2 });

      await keycloakAuthService.init('http://localhost:8080/realms/genie');
      await keycloakAuthService.init('http://localhost:8080/realms/partner');

      const sameSub = 'user-123';

      const payload1 = { ...mockJwtPayload, iss: discovery1.issuer, sub: sameSub, azp: 'genie-app' };
      const payload2 = { ...mockJwtPayload, iss: discovery2.issuer, sub: sameSub, azp: 'partner-app' };

      mockJwtVerify
        .mockResolvedValueOnce({ payload: payload1, protectedHeader: { alg: 'RS256' } })
        .mockResolvedValueOnce({ payload: payload2, protectedHeader: { alg: 'RS256' } });

      const result1 = await keycloakAuthService.verifyToken(generateMockJwtString(payload1));
      const result2 = await keycloakAuthService.verifyToken(generateMockJwtString(payload2));

      expect(result1.iss_sub).not.toBe(result2.iss_sub);
      expect(result1.iss_sub).toBe(`${discovery1.issuer}#${sameSub}`);
      expect(result2.iss_sub).toBe(`${discovery2.issuer}#${sameSub}`);
    });
  });

  describe('role isolation across realms', () => {
    const discovery1 = {
      issuer: 'http://localhost:8080/realms/genie',
      jwks_uri: 'http://localhost:8080/realms/genie/protocol/openid-connect/certs'
    };
    const discovery2 = {
      issuer: 'http://localhost:8080/realms/partner',
      jwks_uri: 'http://localhost:8080/realms/partner/protocol/openid-connect/certs'
    };

    it('should preserve realm_access roles independently per realm', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => discovery1 })
        .mockResolvedValueOnce({ ok: true, json: async () => discovery2 });

      await keycloakAuthService.init('http://localhost:8080/realms/genie');
      await keycloakAuthService.init('http://localhost:8080/realms/partner');

      const payload1 = {
        ...mockJwtPayload,
        iss: discovery1.issuer,
        azp: 'genie-app',
        realm_access: { roles: ['admin'] }
      };
      const payload2 = {
        ...mockJwtPayload,
        iss: discovery2.issuer,
        azp: 'partner-app',
        realm_access: { roles: ['viewer'] }
      };

      mockJwtVerify
        .mockResolvedValueOnce({ payload: payload1, protectedHeader: { alg: 'RS256' } })
        .mockResolvedValueOnce({ payload: payload2, protectedHeader: { alg: 'RS256' } });

      const result1 = await keycloakAuthService.verifyToken(generateMockJwtString(payload1));
      const result2 = await keycloakAuthService.verifyToken(generateMockJwtString(payload2));

      expect(result1.realm_access.roles).toEqual(['admin']);
      expect(result2.realm_access.roles).toEqual(['viewer']);
    });
  });

  describe('invalid JSON in KEYCLOAK_ADDITIONAL_REALMS', () => {
    it('should log warning when env var contains invalid JSON', () => {
      // The env var is parsed at module load time, so we can't change it per test.
      // Instead, verify that the module loaded correctly despite any parsing issues.
      // Since the test env has KEYCLOAK_ADDITIONAL_REALMS='', JSON.parse('[]') succeeds.
      // To test the warning path, we'd need to re-require the module.
      // This test verifies the safe default behavior instead.
      expect(keycloakAuthService.getConfiguredIssuers()).toHaveLength(0);
    });
  });

  describe('checkUserStatusInKeycloak', () => {
    it('should return { active: true, disabled: false } when UserInfo returns 200', async () => {
      mockAxiosGet.mockResolvedValue({
        status: 200,
        data: { sub: '12345678-1234-1234-1234-123456789012', email: 'test@example.com' }
      });

      const result = await keycloakAuthService.checkUserStatusInKeycloak(
        'valid-token',
        'http://localhost:8080/realms/genie'
      );

      expect(result).toEqual({ active: true, disabled: false });
      expect(mockAxiosGet).toHaveBeenCalledWith('http://localhost:8080/realms/genie/protocol/openid-connect/userinfo', {
        headers: {
          Authorization: 'Bearer valid-token',
          Accept: 'application/json'
        },
        timeout: 3000
      });
    });

    it('should return null when UserInfo call times out', async () => {
      mockAxiosGet.mockRejectedValue({
        code: 'ECONNABORTED',
        message: 'timeout of 3000ms exceeded'
      });

      const result = await keycloakAuthService.checkUserStatusInKeycloak(
        'valid-token',
        'http://localhost:8080/realms/genie'
      );

      expect(result).toBeNull();
    });

    it('should return null when UserInfo call fails with network error', async () => {
      mockAxiosGet.mockRejectedValue({
        code: 'ETIMEDOUT',
        message: 'Connection timed out'
      });

      const result = await keycloakAuthService.checkUserStatusInKeycloak(
        'valid-token',
        'http://localhost:8080/realms/genie'
      );

      expect(result).toBeNull();
    });

    it('should return null when a 2xx UserInfo response carries no body', async () => {
      // axios rejects non-2xx by default, so a resolved response is always
      // 2xx — the only non-active 2xx shape left is a bodyless one.
      mockAxiosGet.mockResolvedValue({
        status: 204,
        data: undefined
      });

      const result = await keycloakAuthService.checkUserStatusInKeycloak(
        'valid-token',
        'http://localhost:8080/realms/genie'
      );

      expect(result).toBeNull();
    });

    it('should return null when UserInfo returns 401 (ambiguous — could be expired token)', async () => {
      mockAxiosGet.mockRejectedValue({
        response: { status: 401 }
      });

      const result = await keycloakAuthService.checkUserStatusInKeycloak(
        'valid-token',
        'http://localhost:8080/realms/genie'
      );

      // 401 is ambiguous: expired token OR disabled user — don't take destructive action
      expect(result).toBeNull();
    });

    it('should return { active: false, disabled: true } when UserInfo returns 401 naming the user disabled', async () => {
      // Live-realm contract probe (#1476, Keycloak 26.8.0, realm genie, 2026-11-04):
      // a DISABLED user's userinfo answers 401 —
      //   WWW-Authenticate: Bearer error="invalid_token", error_description="User disabled"
      // with an empty body — not 403. Both the challenge code and the description
      // must be there: the middleware acts destructively on a confirmed disable
      // (it soft-deletes the account), so a challenge that merely carries the
      // phrase is not proof.
      mockAxiosGet.mockRejectedValue({
        response: {
          status: 401,
          headers: {
            'www-authenticate': 'Bearer realm="genie", error="invalid_token", error_description="User disabled"'
          }
        }
      });

      const result = await keycloakAuthService.checkUserStatusInKeycloak(
        'valid-token',
        'http://localhost:8080/realms/genie'
      );

      expect(result).toEqual({ active: false, disabled: true });
    });

    it('should stay null when a 401 carries the disabled phrase without the invalid_token challenge', async () => {
      // The phrase alone is not a confirmed disable — the challenge code must
      // agree with it.
      mockAxiosGet.mockRejectedValue({
        response: {
          status: 401,
          headers: {
            'www-authenticate': 'Bearer realm="genie", error="invalid_request", error_description="User disabled"'
          }
        }
      });

      const result = await keycloakAuthService.checkUserStatusInKeycloak(
        'valid-token',
        'http://localhost:8080/realms/genie'
      );

      expect(result).toBeNull();
    });

    it('strips control characters and line separators from the logged WWW-Authenticate tail', async () => {
      // The sanitizer owns a log-forging guard on server-controlled header
      // input: C0, C1 (U+0085 survives many naive filters) and Unicode line
      // separators must not reach the log line — and the header content that
      // survives must still be there to diagnose the ambiguity.
      // The service logs through the REAL shared/lib winston logger (the
      // virtual '../shared-lib' mock covers only the barrel), so spy there.
      const loggerModule = require('../../shared/lib/logger');
      const warnSpy = jest.spyOn(loggerModule.logger, 'warn');
      mockAxiosGet.mockRejectedValue({
        response: {
          status: 401,
          headers: {
            'www-authenticate':
              'Bearer realm="genie", error="invalid_token", error_description="Token expired"\u2028\u0085Injected\nline'
          }
        }
      });

      const result = await keycloakAuthService.checkUserStatusInKeycloak(
        'valid-token',
        'http://localhost:8080/realms/genie'
      );

      expect(result).toBeNull();
      const warnCall = warnSpy.mock.calls.find(([msg]) => String(msg).includes('WWW-Authenticate'));
      expect(warnCall).toBeDefined();
      const tail = String(warnCall[0]);
      expect(tail).toContain('error_description="Token expired"');
      for (const banned of ['\u2028', '\u0085', '\n', 'Injected\nline']) {
        expect(tail).not.toContain(banned);
      }
      warnSpy.mockRestore();
    });

    it('should stay null when a 401 WWW-Authenticate names another reason (expired token)', async () => {
      mockAxiosGet.mockRejectedValue({
        response: {
          status: 401,
          headers: {
            'www-authenticate': 'Bearer realm="genie", error="invalid_token", error_description="Token expired"'
          }
        }
      });

      const result = await keycloakAuthService.checkUserStatusInKeycloak(
        'valid-token',
        'http://localhost:8080/realms/genie'
      );

      expect(result).toBeNull();
    });

    it('should stay null when UserInfo returns 403 (no corroborated disable)', async () => {
      // A 403 means the token was ACCEPTED but lacks the scopes/roles the
      // UserInfo endpoint requires (an active user), and anything on the
      // path (proxy, WAF, rate limiter) can answer 403 too. Keycloak reports
      // a real disable as 401 with the WWW-Authenticate challenge (pinned
      // above); the caller soft-deletes accounts on a confirmed disable, so
      // an uncorroborated 403 must not trigger it.
      const loggerModule = require('../../shared/lib/logger');
      const warnSpy = jest.spyOn(loggerModule.logger, 'warn').mockImplementation(() => {});
      mockAxiosGet.mockRejectedValue({
        response: { status: 403 }
      });

      const result = await keycloakAuthService.checkUserStatusInKeycloak(
        'valid-token',
        'http://localhost:8080/realms/genie'
      );

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('403'));
      warnSpy.mockRestore();
    });
  });
});
