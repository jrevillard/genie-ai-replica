const { test, expect } = require('@playwright/test');
const { getAdminToken, getUserToken, request: authRequest, parseJwtClaims } = require('../helpers/auth');
const { createRealm, createUser, deleteRealm } = require('../helpers/keycloak-admin');

test.describe.serial('Phase I: Multi-Realm Configuration', () => {
  let adminToken;
  const TEST_REALM = 'genie2';
  const TEST_CLIENT = 'genie-app';
  const TEST_USER = { username: 'testuser2', password: 'TestPass123!', email: 'testuser2@genie2.local' };

  test.beforeAll(async () => {
    adminToken = await getAdminToken();
  });

  test.afterAll(async () => {
    // Cleanup: delete test realm
    try {
      const token = await getAdminToken();
      await deleteRealm(token, TEST_REALM);
    } catch (e) {
      // Realm may already be deleted
    }
  });

  test('I.1 — create second realm with test user', async () => {
    await createRealm(adminToken, TEST_REALM, TEST_CLIENT);
    await createUser(adminToken, TEST_REALM, TEST_USER);
  });

  test('I.2 — get token from genie2 realm and verify different iss', async () => {
    const token = await getUserToken(TEST_USER.username, TEST_USER.password, { realm: TEST_REALM });
    const claims = parseJwtClaims(token);
    expect(claims.iss).toContain('realms/genie2');
    expect(claims.azp).toBe(TEST_CLIENT);
  });

  test('I.3 — backend validates tokens from both realms simultaneously', async () => {
    const genie1Token = await getUserToken('testuser', 'TestPass123!');
    const genie2Token = await getUserToken(TEST_USER.username, TEST_USER.password, { realm: TEST_REALM });

    const res1 = await authRequest('GET', '/api/users/me', {
      headers: { Authorization: `Bearer ${genie1Token}` },
    });
    const res2 = await authRequest('GET', '/api/users/me', {
      headers: { Authorization: `Bearer ${genie2Token}` },
    });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });
});
