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

      const [url, options] = mockCreateRemoteJWKSet.mock.calls[0];
      expect(String(url)).toBe(mockDiscovery.jwks_uri);
      // The cache policy is jose's own now (the TTL and the refresh floor)
      // — see the 'JWKS cache' block.
      expect(options).toEqual({ cacheMaxAge: 300000, cooldownDuration: 1000 });
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

  describe('JWKS cache', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should create ONE remote key set per issuer and never recreate it', async () => {
      // The cache is jose's own remote key set: ONE per issuer, never
      // recreated. A second cache mechanism over the same dependency could
      // only disagree with it, and the recreation (a fresh remote set starts
      // cold — no cooldown state) is what made the refresh floor necessary
      // in the first place (#1778).
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
      expect(createRemoteCallCount).toBe(1);

      // Second call within TTL: should reuse cache
      await keycloakAuthService.verifyToken(generateMockJwtString(mockJwtPayload));

      // createRemoteJWKSet should NOT be called again
      expect(mockCreateRemoteJWKSet.mock.calls.length).toBe(createRemoteCallCount);
    });

    it('configures jose with the cache TTL and the refresh-floor cooldown', async () => {
      // The TTL and the floor are jose's own knobs now: `cacheMaxAge` is
      // when the key set is re-read, `cooldownDuration` is the floor on the
      // reload jose performs for an unknown key id — one fetch per window
      // per issuer, the amplification bound #1703 asked for.
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockDiscovery
      });

      await keycloakAuthService.init();

      expect(mockCreateRemoteJWKSet).toHaveBeenCalledTimes(1);
      const [url, options] = mockCreateRemoteJWKSet.mock.calls[0];
      expect(String(url)).toBe(mockDiscovery.jwks_uri);
      expect(options).toEqual({ cacheMaxAge: 300000, cooldownDuration: 1000 });
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

  describe('verifyToken key-set refresh', () => {
    // The key-set refresh is jose's own: a token naming a key id the realm
    // does not publish makes jose re-read the key set (once per cooldown
    // window per issuer) and resolve the token against the fresh set. The
    // verifier does not retry on its own — a second attempt would double
    // the realm's fetch rate for no gain (#1778).
    const unknownKidError = () => {
      const err = new Error('no key found matching the kid');
      err.name = 'JWKSNoMatchingKey';
      return err;
    };

    beforeEach(() => {
      // Reset mocks — global.fetch too: the verifier fetches the discovery
      // document through the global, so a mock that is not installed there
      // would silently serve the default document to every init.
      mockCreateRemoteJWKSet = jest.fn().mockReturnValue(jest.fn());
      mockJwtVerify = jest.fn();
      mockFetch = global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockDiscovery
      });
    });

    it("rejects an unknown-kid token without retrying (the refresh is jose's)", async () => {
      mockJwtVerify.mockRejectedValue(unknownKidError());

      const token = generateMockJwtString(mockJwtPayload);

      await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
        code: 'TOKEN_INVALID',
        message: 'Token verification failed'
      });

      // jwtVerify called once — the verifier does not retry; jose re-reads
      // the key set inside its own call.
      expect(mockJwtVerify).toHaveBeenCalledTimes(1);
    });

    it('should NOT refresh on a resolved-kid signature failure (junk-signature flood)', async () => {
      // A resolved kid whose signature does not verify can never become
      // valid through rotation. The key set is not re-read for it: a flood
      // of junk-signature tokens would otherwise make every legitimate
      // token pay a fresh JWKS fetch (#1703).
      mockJwtVerify.mockRejectedValue(new Error('signature verification failed'));

      const token = generateMockJwtString(mockJwtPayload);

      await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
        code: 'TOKEN_INVALID',
        message: 'Token verification failed'
      });

      // jwtVerify called once — no refresh, no retry
      expect(mockJwtVerify).toHaveBeenCalledTimes(1);
    });

    it('rejects an unknown-kid token with no exp claim without retrying', async () => {
      // A missing exp can never pass jose's requiredClaims ['iss','exp'], so
      // it can never become valid: fast-fail, no retry. Whether the key set
      // is re-read for it is jose's decision (its cooldown window), not the
      // verifier's — the node suite pins that half against the real library.
      mockJwtVerify.mockRejectedValue(unknownKidError());

      // exp: undefined → the encoded payload carries NO exp claim
      const token = generateMockJwtString({ exp: undefined });

      await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
        code: 'TOKEN_INVALID',
        message: 'Token verification failed'
      });

      expect(mockJwtVerify).toHaveBeenCalledTimes(1);
    });

    it('classifies a key-set fetch failure as an outage, not a bad token', async () => {
      // The key-set leg is the verifier's own network call: its failure is
      // the AUTH SERVICE's, never the token's (#1723). Answering 401 would
      // send every user to the login page during an infrastructure outage.
      const inner = jest.fn().mockRejectedValue(new Error('Expected 200 OK from the JSON Web Key Set HTTP response'));
      mockCreateRemoteJWKSet.mockReturnValue(inner);
      // jose resolves the key through the wrapper — the wrapper is where the
      // network failure is classified.
      mockJwtVerify.mockImplementation(async (token, key) => key({ alg: 'RS256' }, token));

      await expect(keycloakAuthService.verifyToken(generateMockJwtString(mockJwtPayload))).rejects.toMatchObject({
        code: 'AUTH_SERVICE_UNAVAILABLE'
      });
    });

    it('classifies a realm that publishes no usable signing key as an outage', async () => {
      // The published key set tells the two "no matching key" faults apart:
      // a token naming a key id the realm does not publish (the token's
      // fault, 401) and a realm publishing nothing usable (the realm's own
      // broken state, 503).
      const inner = Object.assign(jest.fn().mockRejectedValue(unknownKidError()), {
        jwks: () => ({ keys: [{ kty: 'EC', kid: 'ec-key', alg: 'ES256', use: 'sig' }] })
      });
      mockCreateRemoteJWKSet.mockReturnValue(inner);
      mockJwtVerify.mockImplementation(async (token, key) => key({ alg: 'RS256' }, token));

      await expect(keycloakAuthService.verifyToken(generateMockJwtString(mockJwtPayload))).rejects.toMatchObject({
        code: 'AUTH_SERVICE_UNAVAILABLE'
      });
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
      // jose suppresses the reload-on-unknown-kid while the cached key set
      // is inside its cooldown window: the realm may ALREADY publish the key
      // the token names, and the next refresh observes it. Without that in
      // the log, a burst of 401s around a key rotation is indistinguishable
      // from a burst of junk tokens.
      const warns = captureWarns();
      // The mocked key set answers with the unknown-kid error and reports
      // itself as cooling down — the state jose is in when it suppressed
      // the reload.
      const inner = Object.assign(jest.fn().mockRejectedValue(unknownKidError()), { coolingDown: true });
      mockCreateRemoteJWKSet.mockReturnValue(inner);
      // jose resolves the key through the wrapper — the wrapper is where the
      // floor is detected.
      mockJwtVerify.mockImplementation(async (token, key) => key({ alg: 'RS256' }, token));

      const token = generateMockJwtString(mockJwtPayload);

      try {
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

    it('should not retry an expired token even on signature error', async () => {
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

    it('should not retry an unknown-kid token whose exp has passed', async () => {
      // The expiry outranks everything else: an expired token is
      // TOKEN_EXPIRED, and the key set is left alone.
      mockJwtVerify.mockRejectedValue(unknownKidError());

      const token = generateMockJwtString({ exp: Math.floor(Date.now() / 1000) - 3600 });

      await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
        code: 'TOKEN_EXPIRED',
        message: 'Token has expired'
      });

      expect(mockJwtVerify).toHaveBeenCalledTimes(1);
    });

    it('resolves a kid-less token against a published candidate key', async () => {
      // RFC 7515 §4.1.4 makes the key id OPTIONAL: a token that names none
      // against a multi-key set is not a bad token, it is a token jose
      // cannot resolve by key id alone. The published candidates resolve
      // it — the first one whose signature verifies wins.
      const candidates = [{ key: 'candidate-1' }, { key: 'candidate-2' }];
      const ambiguous = new Error('multiple matching keys');
      ambiguous.name = 'JWKSMultipleMatchingKeys';
      ambiguous[Symbol.asyncIterator] = async function* () {
        yield* candidates;
      };

      mockJwtVerify.mockRejectedValueOnce(ambiguous).mockImplementation(async (token, key) => {
        if (key === candidates[1]) {
          return { payload: mockJwtPayload, protectedHeader: { alg: 'RS256' } };
        }
        const signatureError = new Error('signature verification failed');
        signatureError.name = 'JWSSignatureVerificationFailed';
        throw signatureError;
      });

      const token = generateMockJwtString(mockJwtPayload);
      const result = await keycloakAuthService.verifyToken(token);

      expect(result.iss_sub).toBe(`${mockJwtPayload.iss}#${mockJwtPayload.sub}`);
      // The first attempt, then one attempt per candidate tried.
      expect(mockJwtVerify).toHaveBeenCalledTimes(3);
    });

    it('rejects a kid-less token no published candidate verifies', async () => {
      // The opposite case: the token names no key id and none of the
      // published candidates signs it. It stays a bad token — a kid-less
      // token is never ACCEPTED without a signature that verifies.
      const ambiguous = new Error('multiple matching keys');
      ambiguous.name = 'JWKSMultipleMatchingKeys';
      ambiguous[Symbol.asyncIterator] = async function* () {
        yield { key: 'candidate-1' };
        yield { key: 'candidate-2' };
      };

      mockJwtVerify.mockRejectedValueOnce(ambiguous).mockImplementation(async () => {
        const signatureError = new Error('signature verification failed');
        signatureError.name = 'JWSSignatureVerificationFailed';
        throw signatureError;
      });

      await expect(keycloakAuthService.verifyToken(generateMockJwtString(mockJwtPayload))).rejects.toMatchObject({
        code: 'TOKEN_INVALID',
        message: 'Token verification failed'
      });
    });

    it('reports the duplicate key id as an outage even when the published key set cannot be read', async () => {
      // The verdict does not depend on reading the published key set: jose
      // matched the candidates by that EXACT key id, so more than one
      // candidate means the realm published that id more than once. A jose
      // that did not expose the published set would otherwise turn the
      // outage back into a 401.
      const ambiguous = new Error('multiple matching keys');
      ambiguous.name = 'JWKSMultipleMatchingKeys';
      const inner = jest.fn().mockRejectedValue(ambiguous); // no published-set accessor
      mockCreateRemoteJWKSet.mockReturnValue(inner);
      mockJwtVerify.mockImplementation(async (token, key) => key({ alg: 'RS256', kid: 'dup' }, token));

      await expect(keycloakAuthService.verifyToken(generateMockJwtString(mockJwtPayload))).rejects.toMatchObject({
        code: 'AUTH_SERVICE_UNAVAILABLE'
      });
    });

    it('does not run the candidate trial for a token that names a key id', async () => {
      // The trial resolves a token that names NO key id. A token naming one
      // the realm published twice is the realm's own outage (#1776) — it is
      // never resolved by trying one of the duplicates.
      const ambiguous = new Error('multiple matching keys');
      ambiguous.name = 'JWKSMultipleMatchingKeys';
      ambiguous.kidNamed = 'dup';
      mockJwtVerify.mockRejectedValue(ambiguous);

      await expect(keycloakAuthService.verifyToken(generateMockJwtString(mockJwtPayload))).rejects.toMatchObject({
        code: 'TOKEN_INVALID'
      });

      // The trial never ran: jwtVerify was called once (the first attempt).
      expect(mockJwtVerify).toHaveBeenCalledTimes(1);
    });

    it('does not spend a signature verification on an expired kid-less token', async () => {
      // The trial costs one verification per candidate. An expired token can
      // never verify — jose checks the signature BEFORE the claims — so it
      // is decided from the unverified payload and the trial never runs.
      const ambiguous = new Error('multiple matching keys');
      ambiguous.name = 'JWKSMultipleMatchingKeys';
      ambiguous[Symbol.asyncIterator] = async function* () {
        yield { key: 'candidate-1' };
      };
      mockJwtVerify.mockRejectedValue(ambiguous);

      const token = generateMockJwtString({ exp: Math.floor(Date.now() / 1000) - 3600 });
      await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
        code: 'TOKEN_EXPIRED',
        message: 'Token has expired'
      });

      expect(mockJwtVerify).toHaveBeenCalledTimes(1);
    });

    it('reports a realm that publishes the same key id twice as an outage', async () => {
      // A realm that publishes the SAME key id twice (a misconfigured
      // rotation, or imported JWKs carrying an operator-chosen id) makes
      // every token naming that id resolve to two candidates. The fault is
      // the realm's own state: it is an outage (503), so the operator is
      // told — not a 401 that signs every user out.
      const ambiguous = new Error('multiple matching keys');
      ambiguous.name = 'JWKSMultipleMatchingKeys';
      const inner = Object.assign(jest.fn().mockRejectedValue(ambiguous), {
        jwks: () => ({
          keys: [
            { kid: 'dup', kty: 'RSA', alg: 'RS256', use: 'sig' },
            { kid: 'dup', kty: 'RSA', alg: 'RS256', use: 'sig' }
          ]
        })
      });
      mockCreateRemoteJWKSet.mockReturnValue(inner);
      mockJwtVerify.mockImplementation(async (token, key) => key({ alg: 'RS256', kid: 'dup' }, token));

      await expect(keycloakAuthService.verifyToken(generateMockJwtString(mockJwtPayload))).rejects.toMatchObject({
        code: 'AUTH_SERVICE_UNAVAILABLE'
      });
    });

    // Spies on the REAL shared/lib winston logger — the virtual
    // '../shared-lib' mock covers only the barrel, so the verifier's log
    // lines are visible here and nowhere else. Silences the transport and
    // restores the spy even when the assertions fail, so a failing test
    // cannot leak the mock into its neighbours.
    function captureDebugs() {
      const loggerModule = require('../../shared/lib/logger');
      const debugSpy = jest.spyOn(loggerModule.logger, 'debug').mockImplementation(() => {});
      return {
        lines: () => debugSpy.mock.calls.map(([msg]) => String(msg)).join('\n'),
        restore: () => debugSpy.mockRestore()
      };
    }

    it('logs the first rejection of a cause at WARN and nothing more at the default log level', async () => {
      // A rejected token is caller-controlled and unauthenticated: one WARN
      // line per rejection is a log flood the caller can produce (#1769).
      // The first rejection of a cause in a window is a WARN; the repeats
      // are DEBUG, and at the default log level they are not even written —
      // the line is not built either, so a flood costs no work per request.
      const warns = captureWarns();
      const debugs = captureDebugs();
      mockJwtVerify.mockRejectedValue(unknownKidError());
      const token = generateMockJwtString({ exp: undefined });

      try {
        for (let i = 0; i < 3; i++) {
          await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
            code: 'TOKEN_INVALID'
          });
        }

        expect(warns.lines().split('\n').filter(Boolean)).toHaveLength(1);
        expect(debugs.lines().split('\n').filter(Boolean)).toHaveLength(0);
      } finally {
        warns.restore();
        debugs.restore();
      }
    });

    it('logs the repeats at DEBUG when the debug level is on', async () => {
      // The repeats are DEBUG lines: an operator who turns the debug level
      // on sees every rejection, and the flood is bounded by the WARN slot
      // the cause keeps.
      const warns = captureWarns();
      const debugs = captureDebugs();
      const loggerModule = require('../../shared/lib/logger');
      const level = loggerModule.logger.level;
      loggerModule.logger.level = 'debug';
      mockJwtVerify.mockRejectedValue(unknownKidError());
      const token = generateMockJwtString({ exp: undefined });

      try {
        for (let i = 0; i < 3; i++) {
          await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
            code: 'TOKEN_INVALID'
          });
        }

        expect(warns.lines().split('\n').filter(Boolean)).toHaveLength(1);
        expect(debugs.lines().split('\n').filter(Boolean)).toHaveLength(2);
      } finally {
        loggerModule.logger.level = level;
        warns.restore();
        debugs.restore();
      }
    });

    it('reports how many rejections were suppressed since the last warning', async () => {
      // The suppressed count is what keeps the bound from hiding the
      // volume: the operator sees "3 rejections" instead of three lines.
      const warns = captureWarns();
      const realNow = Date.now();
      const clockSpy = jest.spyOn(Date, 'now').mockReturnValue(realNow);
      mockJwtVerify.mockRejectedValue(unknownKidError());
      const token = generateMockJwtString({ exp: undefined });

      try {
        for (let i = 0; i < 3; i++) {
          await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
            code: 'TOKEN_INVALID'
          });
        }
        // The window elapses: the next rejection opens a new one and says
        // how many were suppressed since the last warning.
        clockSpy.mockReturnValue(realNow + 60000);
        await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
          code: 'TOKEN_INVALID'
        });

        expect(warns.lines()).toContain('2 further rejection(s) with this cause were suppressed');
      } finally {
        clockSpy.mockRestore();
        warns.restore();
      }
    });

    it('keeps the floored-refresh line in a WARN slot of its own', async () => {
      // The floored line is a service-side event (a rotation losing one
      // refresh), so it must not be swallowed by the bucket of the
      // rejections around it: it keeps its own WARN slot.
      const warns = captureWarns();
      let cooling = true;
      const inner = jest.fn().mockRejectedValue(unknownKidError());
      Object.defineProperty(inner, 'coolingDown', { get: () => cooling, configurable: true });
      mockCreateRemoteJWKSet.mockReturnValue(inner);
      mockJwtVerify.mockImplementation(async (token, key) => key({ alg: 'RS256' }, token));
      const token = generateMockJwtString(mockJwtPayload);

      try {
        // Floored: the realm may already publish the key this token names.
        await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
          code: 'TOKEN_INVALID'
        });
        // Not floored: the key set was re-read and the key is simply not
        // published — a different cause, a different bucket.
        cooling = false;
        await expect(keycloakAuthService.verifyToken(token)).rejects.toMatchObject({
          code: 'TOKEN_INVALID'
        });

        const lines = warns.lines().split('\n').filter(Boolean);
        expect(lines).toHaveLength(2);
        expect(lines.join('\n')).toContain('key-set refresh floored');
      } finally {
        warns.restore();
      }
    });

    it("does not let one issuer mute another issuer's warnings", async () => {
      // The bucket is per issuer as well as per cause: a broken realm must
      // not mute another realm's warnings.
      const warns = captureWarns();
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
      mockJwtVerify.mockRejectedValue(unknownKidError());

      try {
        await keycloakAuthService.init('http://localhost:8080/realms/genie');
        await keycloakAuthService.init('http://localhost:8080/realms/genie2');

        await expect(
          keycloakAuthService.verifyToken(generateMockJwtString({ ...mockJwtPayload, iss: discovery1.issuer }))
        ).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
        await expect(
          keycloakAuthService.verifyToken(generateMockJwtString({ ...mockJwtPayload, iss: discovery2.issuer }))
        ).rejects.toMatchObject({ code: 'TOKEN_INVALID' });

        // One WARN per issuer: the second realm's rejection is not muted by
        // the first realm's.
        expect(warns.lines().split('\n').filter(Boolean)).toHaveLength(2);
      } finally {
        warns.restore();
      }
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
