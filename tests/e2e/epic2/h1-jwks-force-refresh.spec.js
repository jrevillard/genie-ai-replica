const { test, expect } = require('@playwright/test');
const { getAdminToken, getUserToken, request: authRequest, parseJwtClaims } = require('../helpers/auth');
const { rotateRealmKeys } = require('../helpers/keycloak-admin');

test.describe('Phase H: JWKS Force-Refresh', () => {
  let adminToken;
  let userToken;

  test.beforeAll(async () => {
    adminToken = await getAdminToken();
    userToken = await getUserToken('testuser', 'TestPass123!');
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
