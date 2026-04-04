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
    const res = await authRequest('GET', '/api/users/me', {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('name');
  });

  test('H.2 — rotate realm signing keys', async () => {
    const result = await rotateRealmKeys(adminToken, 'genie');
    expect(result).toHaveProperty('oldKeyIds');
    expect(result.oldKeyIds.length).toBeGreaterThan(0);
  });

  test('H.3 — old token succeeds via force-refresh after key rotation', async () => {
    // Use the SAME token from beforeAll (signed with old key)
    const res = await authRequest('GET', '/api/users/me', {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    // Backend should force-refresh JWKS and validate the token
    expect(res.status).toBe(200);
  });

  test.fixme('H.4 — expired token is rejected without retry', async () => {
    // NOTE: Full expired token testing requires realm settings manipulation.
    // The curl-based test in epic2-secure-api-access.md handles the complete flow.
    // This test verifies the error code for a corrupted token.
    const expiredToken = userToken.slice(0, -5) + 'XXXXX';
    const res = await authRequest('GET', '/api/users/me', {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    expect(res.status).toBe(401);
  });
});
