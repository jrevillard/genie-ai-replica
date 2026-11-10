// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const { authenticate } = require('../middleware/auth');

// Mock the shared keycloak-auth-service so no real OIDC discovery/JWKS fetch happens.
jest.mock('../shared-lib/keycloak-auth-service', () => ({
  verifyToken: jest.fn()
}));
const keycloakAuthService = require('../shared-lib/keycloak-auth-service');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('auth middleware (authenticate)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 401 TOKEN_INVALID when Authorization header is missing', async () => {
    const req = { headers: {}, path: '/api/okf' };
    const res = mockRes();
    const next = jest.fn();
    await authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'TOKEN_INVALID' }));
    expect(next).not.toHaveBeenCalled();
    expect(keycloakAuthService.verifyToken).not.toHaveBeenCalled();
  });

  test('returns 401 on a non-Bearer scheme', async () => {
    const req = { headers: { authorization: 'Basic abc' }, path: '/api/okf' };
    const res = mockRes();
    const next = jest.fn();
    await authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(keycloakAuthService.verifyToken).not.toHaveBeenCalled();
  });

  test('accepts a case-insensitive Bearer scheme (RFC 6750 §2.1) and attaches req.user', async () => {
    keycloakAuthService.verifyToken.mockResolvedValue({ sub: 'user-123', roles: ['user'] });
    const req = { headers: { authorization: 'bearer  token-value  ' }, path: '/api/okf' };
    const res = mockRes();
    const next = jest.fn();
    await authenticate(req, res, next);
    expect(keycloakAuthService.verifyToken).toHaveBeenCalledWith('token-value', {});
    expect(req.user).toEqual({ sub: 'user-123', roles: ['user'] });
    expect(next).toHaveBeenCalled();
  });

  test('returns 401 when verifyToken throws', async () => {
    keycloakAuthService.verifyToken.mockRejectedValue(new Error('signature invalid'));
    const req = { headers: { authorization: 'Bearer some-token' }, path: '/api/okf' };
    const res = mockRes();
    const next = jest.fn();
    await authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'TOKEN_INVALID' }));
    expect(next).not.toHaveBeenCalled();
  });

  test('a falsy verified payload: the same fixed 401 body shape', async () => {
    // verifyToken resolving to nothing is the same contract as a thrown
    // verification failure: 401 TOKEN_INVALID, fixed message, doc-repo shape.
    keycloakAuthService.verifyToken.mockResolvedValue(null);
    const req = { headers: { authorization: 'Bearer some-token' }, path: '/api/okf' };
    const res = mockRes();
    const next = jest.fn();
    await authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'TOKEN_INVALID',
      message: 'Token verification failed',
      details: {}
    });
    expect(next).not.toHaveBeenCalled();
  });

  test("the verifier's internal text never reaches the client (a fixed 401 body)", async () => {
    // The verification error carries operator detail (issuer mismatch, JWKS
    // key id, decoding detail). It belongs in the log, not in a body an
    // unauthenticated caller can read.
    keycloakAuthService.verifyToken.mockRejectedValue(
      new Error('token verification failed: unknown issuer "http://keycloak.internal/realms/genie"')
    );
    const req = { headers: { authorization: 'Bearer some-token' }, path: '/api/okf' };
    const res = mockRes();
    await authenticate(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'TOKEN_INVALID',
      message: 'Token verification failed',
      details: {}
    });
  });

  test('TOKEN_EXPIRED: 401 with the expiry code (the session expired — the token was not forged)', async () => {
    // The code carries the distinction the document-repository middleware and
    // the web app both rely on; the message stays fixed (no internals).
    keycloakAuthService.verifyToken.mockRejectedValue(
      Object.assign(new Error('Token has expired'), { code: 'TOKEN_EXPIRED', name: 'TokenVerificationError' })
    );
    const req = { headers: { authorization: 'Bearer some-token' }, path: '/api/okf' };
    const res = mockRes();
    const next = jest.fn();
    await authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'TOKEN_EXPIRED', message: 'Token has expired', details: {} });
    expect(next).not.toHaveBeenCalled();
  });

  test('maps AUTH_SERVICE_UNAVAILABLE to 503 — an outage is not a bad token', async () => {
    // The verifier's init-failure message carries operator detail (discovery
    // hostname, HTTP status, the pin-mismatch remedy). The middleware logs it
    // whole and sends a fixed body — an unauthenticated caller must not be
    // able to read internal topology out of a rejected request. The STATUS is
    // the doc-repo contract (503): a 401 would tell the client its session
    // had died and send it to the login page during an infrastructure outage.
    keycloakAuthService.verifyToken.mockRejectedValue(
      Object.assign(
        new Error(
          'Authentication service is temporarily unavailable (OIDC discovery from http://keycloak:8080/realms/genie/.well-known/openid-configuration failed: getaddrinfo ENOTFOUND keycloak)'
        ),
        { code: 'AUTH_SERVICE_UNAVAILABLE', name: 'TokenVerificationError' }
      )
    );
    const req = { headers: { authorization: 'Bearer some-token' }, path: '/api/okf' };
    const res = mockRes();
    const next = jest.fn();
    await authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      error: 'AUTH_SERVICE_UNAVAILABLE',
      message: 'Authentication service unavailable',
      details: {}
    });
    expect(next).not.toHaveBeenCalled();
  });
});

// ─── Story 6.1: scope resolution + opt-in audience ───────────────────────────

describe('auth middleware — okf scope resolution (Story 6.1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.OKF_AUDIENCE;
  });
  afterEach(() => delete process.env.OKF_AUDIENCE);

  const mkReq = () => ({ headers: { authorization: 'Bearer test-token' } });

  test('parses okf_scopes array claim → req.okfScopes (deduped, order preserved)', async () => {
    keycloakAuthService.verifyToken.mockResolvedValue({
      sub: 'u1',
      okf_scopes: ['okf:t1:repoA:read', 'okf:t1:repoB:admin', 'okf:t1:repoA:read'],
      realm_access: { roles: ['user'] }
    });
    const req = mkReq();
    await authenticate(req, mockRes(), jest.fn());
    expect(req.okfScopes).toEqual(['okf:t1:repoA:read', 'okf:t1:repoB:admin']);
    expect(req.okfIsSuperAdmin).toBe(false);
  });

  test('parses okf_scopes as a space-separated string', async () => {
    keycloakAuthService.verifyToken.mockResolvedValue({
      sub: 'u1',
      okf_scopes: 'okf:t1:repoA:read okf:t2:repoC:admin',
      realm_access: { roles: [] }
    });
    const req = mkReq();
    await authenticate(req, mockRes(), jest.fn());
    expect(req.okfScopes).toEqual(['okf:t1:repoA:read', 'okf:t2:repoC:admin']);
  });

  test('parses the standard scope claim (space-separated) and keeps only okf: entries', async () => {
    keycloakAuthService.verifyToken.mockResolvedValue({
      sub: 'u1',
      scope: 'openid profile okf:t1:repoA:admin',
      realm_access: { roles: [] }
    });
    const req = mkReq();
    await authenticate(req, mockRes(), jest.fn());
    expect(req.okfScopes).toEqual(['okf:t1:repoA:admin']);
  });

  test('okf_scopes entries come FIRST when both claims are present, deduped', async () => {
    keycloakAuthService.verifyToken.mockResolvedValue({
      sub: 'u1',
      okf_scopes: ['okf:t1:repoA:read'],
      scope: 'openid okf:t1:repoB:admin okf:t1:repoA:read',
      realm_access: { roles: [] }
    });
    const req = mkReq();
    await authenticate(req, mockRes(), jest.fn());
    expect(req.okfScopes).toEqual(['okf:t1:repoA:read', 'okf:t1:repoB:admin']);
  });

  test('tools-admin realm role → req.okfIsSuperAdmin true (bootstrap super-role)', async () => {
    keycloakAuthService.verifyToken.mockResolvedValue({ sub: 'u1', realm_access: { roles: ['admin', 'tools-admin'] } });
    const req = mkReq();
    await authenticate(req, mockRes(), jest.fn());
    expect(req.okfIsSuperAdmin).toBe(true);
    expect(req.okfScopes).toEqual([]);
  });

  test('no okf scopes, no tools-admin → empty scopes, super=false (default-deny posture)', async () => {
    keycloakAuthService.verifyToken.mockResolvedValue({
      sub: 'u1',
      scope: 'openid profile',
      realm_access: { roles: ['admin'] }
    });
    const req = mkReq();
    await authenticate(req, mockRes(), jest.fn());
    expect(req.okfScopes).toEqual([]);
    expect(req.okfIsSuperAdmin).toBe(false);
  });

  test('non-string garbage inside okf_scopes is ignored, not crashed on', async () => {
    keycloakAuthService.verifyToken.mockResolvedValue({
      sub: 'u1',
      okf_scopes: [42, null, 'okf:t1:repoA:read'],
      realm_access: {}
    });
    const req = mkReq();
    await authenticate(req, mockRes(), jest.fn());
    expect(req.okfScopes).toEqual(['okf:t1:repoA:read']);
  });

  test('OKF_AUDIENCE env set → verifyToken receives { audience } (RFC 8707 opt-in)', async () => {
    process.env.OKF_AUDIENCE = 'okf-server';
    keycloakAuthService.verifyToken.mockResolvedValue({ sub: 'u1', realm_access: {} });
    await authenticate(mkReq(), mockRes(), jest.fn());
    expect(keycloakAuthService.verifyToken).toHaveBeenCalledWith('test-token', { audience: 'okf-server' });
  });

  test('OKF_AUDIENCE unset → no audience option (historical behavior)', async () => {
    keycloakAuthService.verifyToken.mockResolvedValue({ sub: 'u1', realm_access: {} });
    await authenticate(mkReq(), mockRes(), jest.fn());
    const opts = keycloakAuthService.verifyToken.mock.calls[0][1];
    expect(opts && opts.audience).toBeUndefined();
  });
});

describe('auth middleware — strictness additions (2026-08-16 review fixes)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.OKF_AUDIENCE;
  });
  afterEach(() => delete process.env.OKF_AUDIENCE);

  test('OKF_AUDIENCE with stray whitespace is trimmed (not a silent lockout)', async () => {
    process.env.OKF_AUDIENCE = '  okf-server  ';
    keycloakAuthService.verifyToken.mockResolvedValue({ sub: 'u1', realm_access: {} });
    const req = { headers: { authorization: 'Bearer test-token' } };
    await authenticate(req, {}, jest.fn());
    expect(keycloakAuthService.verifyToken).toHaveBeenCalledWith('test-token', { audience: 'okf-server' });
  });

  test('space-joined scopes inside ONE array element are split', async () => {
    keycloakAuthService.verifyToken.mockResolvedValue({
      sub: 'u1',
      okf_scopes: ['okf:t1:repoA:read okf:t2:repoB:admin'],
      realm_access: { roles: [] }
    });
    const req = { headers: { authorization: 'Bearer test-token' } };
    await authenticate(req, {}, jest.fn());
    expect(req.okfScopes).toEqual(['okf:t1:repoA:read', 'okf:t2:repoB:admin']);
  });
});
