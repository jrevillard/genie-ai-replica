const { test, expect } = require('@playwright/test');
const { getAdminToken, getSessionTokenViaUI, request: authRequest } = require('../helpers/auth');
const { createUser, deleteUser, updateRealmSettings } = require('../helpers/keycloak-admin');

test.describe.serial('Phase K: Auth Error Display', () => {
  // The session mints run two login attempts when the stack stalls
  // (30s navigation + 15s redirect wait + retry budget each), and K.2
  // stacks a 30s expiry poll on top of its own mint — past the 60s
  // default. Hooks inherit the test timeout.
  test.setTimeout(180000);

  let adminToken;
  let userToken;
  let noRolesUserId;
  const NOROLES_USERNAME = 'noroles-user-e2e';
  const NOROLES_PASSWORD = 'TestPass123!';

  test.beforeAll(async ({ browser }) => {
    adminToken = await getAdminToken();
    userToken = await getSessionTokenViaUI({ browser });
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

    const res = await authRequest('GET', '/api/me', {
      headers: { Authorization: `Bearer ${modifiedToken}` },
    });
    expect(res.status).toBe(401);
    expect(res.data.error).toBe('TOKEN_INVALID');
  });

  test('K.2 — TOKEN_EXPIRED (short-lived token)', async ({ browser }) => {
    // Reduce lifespan to 10s
    await updateRealmSettings(adminToken, 'genie', { accessTokenLifespan: '10' });

    // Get fresh session token (issued after the lifespan change above,
    // so it carries the 10s expiry)
    const shortToken = await getSessionTokenViaUI({ browser });

    // Wait for expiry (polling up to 30s)
    const startTime = Date.now();
    while (Date.now() - startTime < 30000) {
      const res = await authRequest('GET', '/api/me', {
        headers: { Authorization: `Bearer ${shortToken}` },
      });
      if (res.status === 401 && res.data.error === 'TOKEN_EXPIRED') break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    const res = await authRequest('GET', '/api/me', {
      headers: { Authorization: `Bearer ${shortToken}` },
    });
    expect(res.status).toBe(401);
    expect(res.data.error).toBe('TOKEN_EXPIRED');

    // Note: lifespan restore happens in afterAll
  });

  test('K.3 — FORBIDDEN (user without roles)', async ({ browser }) => {
    // Restore the normal lifespan first: K.2 left it at 10s, and the
    // browser-session mint below adds SPA-bootstrap latency after the
    // token is issued — on a loaded stack the admin request could hit
    // TOKEN_EXPIRED instead of the FORBIDDEN this test verifies.
    await updateRealmSettings(adminToken, 'genie', { accessTokenLifespan: '300' });

    // Create no-roles user
    noRolesUserId = await createUser(adminToken, 'genie', {
      username: NOROLES_USERNAME,
      password: NOROLES_PASSWORD,
      email: 'noroles-e2e@genie.local',
      realmRoles: [], // No roles
    });

    // Get token for no-roles user via a browser login session — the realm
    // refuses ROPC by design, and login itself is not role-gated (only
    // the admin endpoint below is).
    const noRolesToken = await getSessionTokenViaUI({
      browser,
      user: { username: NOROLES_USERNAME, password: NOROLES_PASSWORD },
    });

    // Attempt admin endpoint
    const res = await authRequest('GET', '/api/admin/users', {
      headers: { Authorization: `Bearer ${noRolesToken}` },
    });
    expect(res.status).toBe(403);
    expect(res.data.error).toBe('FORBIDDEN');
  });

  test('K.4 — TOKEN_INVALID (invalid token string)', async () => {
    // NOTE: Keycloak unavailability (docker service scale keycloak=0) is tested
    // via curl in epic2-secure-api-access.md Phase K.4 — cannot be done from Playwright.
    const res = await authRequest('GET', '/api/me', {
      headers: { Authorization: 'Bearer clearly-invalid-token' },
    });
    expect(res.status).toBe(401);
    expect(res.data.error).toBe('TOKEN_INVALID');
  });

});
