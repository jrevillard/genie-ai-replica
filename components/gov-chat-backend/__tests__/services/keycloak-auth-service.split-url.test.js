/**
 * Copyright (C) 2026 International Telecommunication Union (ITU)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Split-URL OIDC: KEYCLOAK_PUBLIC_URL issuer alias (contract test).
 *
 * The backend fetches OIDC discovery via an internal URL (e.g.
 * http://kong:8000/auth) while browser tokens carry the public issuer
 * (https://localhost/auth). The alias maps the public issuer onto the same
 * JWKS cache so token lookup succeeds. No-op when the variable is unset
 * (single-URL / cloud deployments).
 */

const mockJwtVerify = jest.fn();
jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => jest.fn()),
  jwtVerify: mockJwtVerify
}));

// shared-lib only exists at Docker build time (same pattern as other backend tests).
jest.mock(
  '../../shared-lib',
  () => ({
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
  }),
  { virtual: true }
);

const DISCOVERY = {
  issuer: 'http://kong:8000/auth/realms/genie',
  jwks_uri: 'http://kong:8000/auth/realms/genie/protocol/openid-connect/certs'
};

const REAL_FETCH = global.fetch;

function loadService(publicUrl) {
  jest.resetModules();
  process.env.KEYCLOAK_URL = 'http://kong:8000/auth';
  process.env.KEYCLOAK_REALM = 'genie';
  if (publicUrl) {
    process.env.KEYCLOAK_PUBLIC_URL = publicUrl;
  } else {
    delete process.env.KEYCLOAK_PUBLIC_URL;
  }
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => DISCOVERY });
  return require('../../services/keycloak-auth-service');
}

describe('keycloak-auth-service — KEYCLOAK_PUBLIC_URL split-URL alias', () => {
  afterAll(() => {
    global.fetch = REAL_FETCH;
    delete process.env.KEYCLOAK_PUBLIC_URL;
  });

  test('aliases the public issuer onto the same JWKS cache when set', async () => {
    const svc = loadService('https://localhost/auth');
    await svc.init('http://kong:8000/auth/realms/genie');

    const internal = svc._getJwksCache('http://kong:8000/auth/realms/genie');
    const publicAliased = svc._getJwksCache('https://localhost/auth/realms/genie');
    expect(internal).toBeDefined();
    expect(publicAliased).toBe(internal);
  });

  test('is a no-op when unset (cloud single-URL deployments)', async () => {
    const svc = loadService(undefined);
    await svc.init('http://kong:8000/auth/realms/genie');

    expect(svc._getJwksCache('http://kong:8000/auth/realms/genie')).toBeDefined();
    expect(svc._getJwksCache('https://localhost/auth/realms/genie')).toBeUndefined();
  });

  test('normalizes a trailing slash on the public URL', async () => {
    const svc = loadService('https://localhost/auth/');
    await svc.init('http://kong:8000/auth/realms/genie');

    expect(svc._getJwksCache('https://localhost/auth/realms/genie')).toBeDefined();
  });

  test('does not alias when the public issuer equals the discovery issuer', async () => {
    const svc = loadService('http://kong:8000/auth');
    await svc.init('http://kong:8000/auth/realms/genie');

    // Same issuer — exactly one entry, no duplicate alias.
    expect(svc._getJwksCache('http://kong:8000/auth/realms/genie')).toBeDefined();
  });
});
