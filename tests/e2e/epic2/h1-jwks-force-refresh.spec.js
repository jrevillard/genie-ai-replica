const { test, expect } = require('@playwright/test');
const { getAdminToken, getSessionTokenViaUI, request: authRequest, SESSION_MINT_TIMEOUT_MS } = require('../helpers/auth');
const { rotateRealmKeys } = require('../helpers/keycloak-admin');

const REALM = 'genie';

// The key providers of the realm, as the components API answers them.
async function readKeyProviders(adminToken) {
  const res = await authRequest('GET', `/auth/admin/realms/${REALM}/components?type=org.keycloak.keys.KeyProvider`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  expect(res.status).toBe(200);
  return res.data;
}

// Keycloak reads a provider that carries neither flag as active and
// enabled; active=false makes it passive, enabled=false disables it.
function isActive(provider) {
  const config = provider.config || {};
  return (!config.enabled || config.enabled[0] !== 'false') && (!config.active || config.active[0] !== 'false');
}

// The RSA providers sign with RS256; the others — the HMAC, the AES and
// the RSA encryption ones — serve another purpose.
function isRsaSigning(provider) {
  return provider.providerId === 'rsa' || provider.providerId === 'rsa-generated';
}

test.describe('Phase H: JWKS Force-Refresh', () => {
  // See SESSION_MINT_TIMEOUT_MS: describe.configure covers the tests,
  // the in-hook test.setTimeout covers beforeAll (hooks read the
  // project timeout, not the suite timeout).
  test.describe.configure({ timeout: SESSION_MINT_TIMEOUT_MS });

  let adminToken;
  let userToken;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(SESSION_MINT_TIMEOUT_MS);
    adminToken = await getAdminToken();
    userToken = await getSessionTokenViaUI({ browser });
  });

  test('H.1 — valid token passes with cached JWKS', async () => {
    const res = await authRequest('GET', '/api/me', {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(200);
  });

  test('H.2 — rotate realm signing keys', async () => {
    const before = await readKeyProviders(adminToken);

    const result = await rotateRealmKeys(adminToken, REALM);
    expect(result).toHaveProperty('oldKeyIds');
    expect(result.oldKeyIds.length).toBeGreaterThan(0);

    // A second rotation must not leave the realm with a second signer.
    await rotateRealmKeys(adminToken, REALM);

    const after = await readKeyProviders(adminToken);

    // Exactly one RSA signing provider is active: the rotation replaced
    // the old one instead of leaving two signers behind.
    expect(after.filter((p) => isRsaSigning(p) && isActive(p))).toHaveLength(1);

    // The RSA signing provider the rotation replaced no longer signs.
    for (const provider of before.filter((p) => isRsaSigning(p) && isActive(p))) {
      const rotated = after.find((p) => p.id === provider.id);
      expect(rotated).toBeTruthy();
      expect(isActive(rotated)).toBe(false);
    }

    // The providers that do not sign with RSA — the HMAC, the AES and the
    // RSA encryption ones — are untouched by the rotation.
    for (const provider of before.filter((p) => !isRsaSigning(p))) {
      const rotated = after.find((p) => p.id === provider.id);
      expect(rotated).toBeTruthy();
      expect(isActive(rotated)).toBe(isActive(provider));
    }
  });

  test('H.3 — old token succeeds via force-refresh after key rotation', async () => {
    // Use the SAME token from beforeAll (signed with old key)
    const res = await authRequest('GET', '/api/me', {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    // Backend should force-refresh JWKS and validate the token
    expect(res.status).toBe(200);
  });

  test('H.4 — corrupted token is rejected without retry', async () => {
    const corruptedToken = userToken.slice(0, -5) + 'XXXXX';
    const res = await authRequest('GET', '/api/me', {
      headers: { Authorization: `Bearer ${corruptedToken}` },
    });
    expect(res.status).toBe(401);
  });
});
