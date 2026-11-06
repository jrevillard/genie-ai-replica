const { test, expect } = require('@playwright/test');
const { getAdminToken, getSessionTokenViaUI, request: authRequest, SESSION_MINT_TIMEOUT_MS } = require('../helpers/auth');
const { rotateRealmKeys } = require('../helpers/keycloak-admin');

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
    const result = await rotateRealmKeys(adminToken, 'genie');
    expect(result).toHaveProperty('oldKeyIds');
    expect(result.oldKeyIds.length).toBeGreaterThan(0);

    // A second rotation reuses the active rotated key: the realm must not
    // end up with a second active signer.
    const second = await rotateRealmKeys(adminToken, 'genie');
    expect(second.newKeyId).toBe(result.newKeyId);

    const providers = await authRequest('GET', '/auth/admin/realms/genie/components?type=org.keycloak.keys.KeyProvider', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(providers.status).toBe(200);

    // Only the RSA signing keys were demoted: the realm's encryption, HMAC
    // and AES providers survive the rotation.
    for (const id of result.oldKeyIds) {
      const provider = providers.data.find((c) => c.id === id);
      expect(provider).toBeTruthy();
      expect(['rsa', 'rsa-generated']).toContain(provider.providerId);
    }
    for (const providerId of ['rsa-enc-generated', 'hmac-generated', 'aes-generated']) {
      const provider = providers.data.find((c) => c.providerId === providerId);
      expect(provider).toBeTruthy();
      expect(result.oldKeyIds).not.toContain(provider.id);
    }

    // The realm keeps exactly one active rotated key.
    const activeRotated = providers.data.filter(
      (c) => c.name && c.name.startsWith('rsa-generated-rotated-') && c.config.active && c.config.active[0] === 'true'
    );
    expect(activeRotated).toHaveLength(1);
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
