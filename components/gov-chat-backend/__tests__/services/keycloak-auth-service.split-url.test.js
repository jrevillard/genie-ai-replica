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

const PARTNER_DISCOVERY = {
  issuer: 'http://kong:8000/auth/realms/partner',
  jwks_uri: 'http://kong:8000/auth/realms/partner/protocol/openid-connect/certs'
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

  test('multi-realm: initAllRealms keeps the PRIMARY realm public-issuer alias on the primary JWKS', async () => {
    // The clobber (review 2026-10-29): the partner realm's init used to
    // register https://localhost/auth/realms/genie — KEYCLOAK_PUBLIC_URL plus
    // the MODULE-level KEYCLOAK_REALM — onto the partner JWKS, so every
    // primary-realm browser token carrying the public issuer verified against
    // the wrong realm's keys. KEYCLOAK_ADDITIONAL_REALMS is read at module
    // load, hence the resetModules inside loadService after setting it.
    // initAllRealms is not exported — verifyToken is the public entry that
    // drives it (ensureInitialized → initAllRealms).
    process.env.KEYCLOAK_ADDITIONAL_REALMS = '["partner"]';
    try {
      const svc = loadService('https://localhost/auth');
      global.fetch = jest.fn((url) =>
        Promise.resolve({
          ok: true,
          json: async () => (String(url).includes('/realms/partner/') ? PARTNER_DISCOVERY : DISCOVERY)
        })
      );
      const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const token = `${b64({ alg: 'RS256' })}.${b64({
        iss: DISCOVERY.issuer,
        sub: 'user-1',
        exp: Math.floor(Date.now() / 1000) + 3600
      })}.sig`;
      mockJwtVerify.mockResolvedValue({
        payload: { iss: DISCOVERY.issuer, sub: 'user-1' },
        protectedHeader: { alg: 'RS256' }
      });

      await svc.verifyToken(token);

      const primaryInternal = svc._getJwksCache(DISCOVERY.issuer);
      const partnerInternal = svc._getJwksCache(PARTNER_DISCOVERY.issuer);
      const primaryPublicAlias = svc._getJwksCache('https://localhost/auth/realms/genie');
      const partnerPublicAlias = svc._getJwksCache('https://localhost/auth/realms/partner');

      expect(primaryInternal).toBeDefined();
      expect(partnerInternal).toBeDefined();
      expect(partnerInternal).not.toBe(primaryInternal);
      // The primary alias survives pointing at the PRIMARY realm's own JWKS
      // (pre-fix this resolved to the PARTNER realm's cache).
      expect(primaryPublicAlias).toBe(primaryInternal);
      // The alias is the primary realm's by definition — the partner init
      // registers no public-issuer alias of its own.
      expect(partnerPublicAlias).toBeUndefined();
    } finally {
      delete process.env.KEYCLOAK_ADDITIONAL_REALMS;
    }
  });
});
