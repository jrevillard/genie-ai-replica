const { test, expect } = require('@playwright/test');
const { getAdminToken, getUserToken, request: authRequest } = require('../helpers/auth');
const { createUser, deleteUser, updateRealmSettings } = require('../helpers/keycloak-admin');

test.describe.serial('Phase K: Auth Error Display', () => {
  let adminToken;
  let userToken;
  let noRolesUserId;
  const NOROLES_USERNAME = 'noroles-user-e2e';
  const NOROLES_PASSWORD = 'TestPass123!';

  test.beforeAll(async () => {
    adminToken = await getAdminToken();
    userToken = await getUserToken('testuser', 'TestPass123!');
  });

  test.afterAll(async () => {
    // Always restore realm settings (even if K.2 or K.3 failed)
    try {
      const token = await getAdminToken();
      await updateRealmSettings(token, 'genie', { accessTokenLifespan: '300' });
    } catch {
      // Best-effort restore
    }

    // Cleanup: delete no-roles user if created
    if (noRolesUserId) {
      try {
        const token = await getAdminToken();
        await deleteUser(token, 'genie', noRolesUserId);
      } catch {
        // User may already be deleted
      }
    }
  });

  test('K.1 — TOKEN_INVALID (modified token)', async () => {
    // Modify one character in the token
    const tokenParts = userToken.split('.');
    tokenParts[1] = 'X' + tokenParts[1].slice(1); // Change first char of payload
    const modifiedToken = tokenParts.join('.');

    const res = await authRequest('GET', '/api/users/me', {
      headers: { Authorization: `Bearer ${modifiedToken}` },
    });
    expect(res.status).toBe(401);
    expect(res.data.error).toBe('TOKEN_INVALID');
  });

  test('K.2 — TOKEN_EXPIRED (short-lived token)', async () => {
    // Reduce lifespan to 10s
    await updateRealmSettings(adminToken, 'genie', { accessTokenLifespan: '10' });

    // Get fresh token (expires in 10s)
    const shortToken = await getUserToken('testuser', 'TestPass123!');

    // Wait for expiry
    await new Promise((resolve) => setTimeout(resolve, 12000));

    const res = await authRequest('GET', '/api/users/me', {
      headers: { Authorization: `Bearer ${shortToken}` },
    });
    expect(res.status).toBe(401);
    expect(res.data.error).toBe('TOKEN_EXPIRED');

    // Note: lifespan restore happens in afterAll
  });

  test('K.3 — FORBIDDEN (user without roles)', async () => {
    // Create no-roles user
    noRolesUserId = await createUser(adminToken, 'genie', {
      username: NOROLES_USERNAME,
      password: NOROLES_PASSWORD,
      email: 'noroles-e2e@genie.local',
      realmRoles: [], // No roles
    });

    // Get token for no-roles user
    const noRolesToken = await getUserToken(NOROLES_USERNAME, NOROLES_PASSWORD);

    // Attempt admin endpoint
    const res = await authRequest('GET', '/api/admin/users', {
      headers: { Authorization: `Bearer ${noRolesToken}` },
    });
    expect(res.status).toBe(403);
    expect(res.data.error).toBe('FORBIDDEN');
  });

  test.fixme('K.4 — TOKEN_INVALID (Keycloak unavailable)', async () => {
    // NOTE: Keycloak unavailability testing requires `docker service scale genieai_keycloak=0`
    // which cannot be done from Playwright. The curl-based test in epic2-secure-api-access.md
    // handles this scenario. This test verifies the error code pattern for invalid tokens.
    const res = await authRequest('GET', '/api/users/me', {
      headers: { Authorization: 'Bearer clearly-invalid-token' },
    });
    expect(res.status).toBe(401);
    expect(res.data.error).toBe('TOKEN_INVALID');
  });

});
