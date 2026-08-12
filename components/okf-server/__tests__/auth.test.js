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
    expect(keycloakAuthService.verifyToken).toHaveBeenCalledWith('token-value');
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
