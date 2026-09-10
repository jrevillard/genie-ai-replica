/**
 * Copyright (C) 2026 International Telecommunication Union (ITU)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Split-URL OIDC: KEYCLOAK_PUBLIC_URL expected-issuer override (contract test).
 *
 * JWKS is fetched via the internal KEYCLOAK_URL (reachable on the container
 * network) while tokens minted through the public endpoint carry the public
 * issuer. KEYCLOAK_PUBLIC_URL overrides the expected issuer only. No-op when
 * unset (single-URL / cloud deployments).
 */

const mockJwtVerify = jest.fn();
jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => jest.fn()),
  jwtVerify: mockJwtVerify
}));

function loadMiddleware({ keycloakUrl, publicUrl }) {
  jest.resetModules();
  process.env.KEYCLOAK_URL = keycloakUrl;
  process.env.KC_REALM = 'genie';
  if (publicUrl) {
    process.env.KEYCLOAK_PUBLIC_URL = publicUrl;
  } else {
    delete process.env.KEYCLOAK_PUBLIC_URL;
  }
  mockJwtVerify.mockReset();
  mockJwtVerify.mockResolvedValue({
    payload: { sub: 'user-1', iss: 'irrelevant-to-unit-test', realm_access: { roles: ['User'] } }
  });
  return require('../../middlewares/keycloak-auth-middleware');
}

function runAuth(middleware) {
  return new Promise((resolve) => {
    const res = { status: jest.fn(() => res), json: jest.fn(() => resolve('responded')) };
    const req = { headers: { authorization: 'Bearer test-token' }, originalUrl: '/files/list' };
    middleware.authenticateToken(req, res, () => resolve('next'));
  });
}

describe('keycloak-auth-middleware — KEYCLOAK_PUBLIC_URL issuer alias', () => {
  afterAll(() => {
    delete process.env.KEYCLOAK_PUBLIC_URL;
  });

  test('validates against the public issuer when set; JWKS stays on the internal URL', async () => {
    const mw = loadMiddleware({ keycloakUrl: 'http://kong:8000/auth', publicUrl: 'https://localhost/auth' });
    const outcome = await runAuth(mw);

    expect(outcome).toBe('next');
    expect(mockJwtVerify).toHaveBeenCalledTimes(1);
    const options = mockJwtVerify.mock.calls[0][2];
    expect(options.issuer).toBe('https://localhost/auth/realms/genie');

    // JWKS is still constructed from the internal KEYCLOAK_URL.
    const jose = require('jose');
    expect(jose.createRemoteJWKSet).toHaveBeenCalledTimes(1);
    const jwksUrl = jose.createRemoteJWKSet.mock.calls[0][0];
    expect(jwksUrl.href).toBe('http://kong:8000/auth/realms/genie/protocol/openid-connect/certs');
  });

  test('is a no-op when unset — issuer derived from KEYCLOAK_URL', async () => {
    const mw = loadMiddleware({ keycloakUrl: 'http://kong:8000/auth', publicUrl: undefined });
    const outcome = await runAuth(mw);

    expect(outcome).toBe('next');
    const options = mockJwtVerify.mock.calls[0][2];
    expect(options.issuer).toBe('http://kong:8000/auth/realms/genie');
  });

  test('attaches req.user from the verified payload', async () => {
    const mw = loadMiddleware({ keycloakUrl: 'http://kong:8000/auth', publicUrl: 'https://localhost/auth' });
    let capturedUser = null;
    await new Promise((resolve) => {
      const res = { status: jest.fn(() => res), json: jest.fn(() => resolve()) };
      const req = { headers: { authorization: 'Bearer test-token' }, originalUrl: '/files/list' };
      mw.authenticateToken(req, res, () => {
        capturedUser = req.user;
        resolve();
      });
    });
    expect(capturedUser).toMatchObject({ userId: 'user-1', role: 'User' });
  });
});
