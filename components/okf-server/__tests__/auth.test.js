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
