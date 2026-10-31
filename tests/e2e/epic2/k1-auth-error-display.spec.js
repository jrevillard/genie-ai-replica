const { test, expect } = require('@playwright/test');
const { getAdminToken, getSessionTokenViaUI, request: authRequest } = require('../helpers/auth');
const { createUser, deleteUser, getRealmSettings, updateRealmSettings } = require('../helpers/keycloak-admin');

test.describe.serial('Phase K: Auth Error Display', () => {
  // The session mints log in through the browser — a stalled cycle costs
  // ≈135s, and K.2 stacks a 30s expiry poll on top of its own mint.
  // test.describe.configure covers the tests; the in-hook test.setTimeout
  // covers beforeAll, which reads the project timeout otherwise.
  test.describe.configure({ timeout: 360000 });

  let adminToken;
  let noRolesUserId;
  let originalLifespan;
  const NOROLES_USERNAME = 'noroles-user-e2e';
  const NOROLES_PASSWORD = 'TestPass123!';

  test.beforeAll(async () => {
    test.setTimeout(360000);
    adminToken = await getAdminToken();

    // K.2 mutates the realm's token lifespan; restore whatever the
    // deployment actually runs, not an assumed default. Failing the
    // capture fails the suite BEFORE K.2 can mutate anything — a
    // best-guess restore would write 300 onto a stack running
    // something else.
    const realm = await getRealmSettings(adminToken, 'genie');
    if (!realm.accessTokenLifespan) {
      throw new Error('Cannot capture accessTokenLifespan — refusing to run the lifespan-mutating tests');
    }
    originalLifespan = String(realm.accessTokenLifespan);
  });

  test.afterAll(async () => {
    // Restore the lifespan only when it was actually captured AND K.2
    // could have mutated it — afterAll runs even when beforeAll threw,
    // and guessing 300 would rewrite a deployment running something else.
    if (originalLifespan) {
      try {
        const token = await getAdminToken();
        await updateRealmSettings(token, 'genie', { accessTokenLifespan: originalLifespan });
      } catch (e) {
        // Best-effort, never silent: a failed restore leaves the realm
        // at K.2's 10s lifespan, poisoning every suite that runs after.
        console.warn(`k1 afterAll: lifespan restore failed — realm may still be at 10s: ${e.message}`);
      }
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
    // Mangling the first payload character corrupts the base64/JSON —
    // the token dies at payload decode, before signature verification
    // is attempted. The admin token (already in hand) keeps this a
    // pure-API test with no browser login.
    const tokenParts = adminToken.split('.');
    tokenParts[1] = 'X' + tokenParts[1].slice(1); // Change first char of payload
    const modifiedToken = tokenParts.join('.');

    const res = await authRequest('GET', '/api/me', {
      headers: { Authorization: `Bearer ${modifiedToken}` },
    });
    expect(res.status).toBe(401);
    expect(res.data.error).toBe('TOKEN_INVALID');
  });

  test('K.2 — TOKEN_EXPIRED (short-lived token)', async ({ browser }) => {
    // Fresh admin token: the beforeAll mint can be minutes old once K.2's
    // own session mint and expiry poll have run.
    adminToken = await getAdminToken();

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

    // Note: K.3 restores the captured lifespan before its own mint;
    // afterAll restores it again for the failure paths.
  });

  test('K.3 — FORBIDDEN (user without roles)', async ({ browser }) => {
    // Fresh admin token — the beforeAll mint can be minutes old by now.
    adminToken = await getAdminToken();

    // Restore the genie lifespan before the browser mint below: K.2
    // left it at 10s, and the no-roles token is issued by genie — with
    // the lifespan still at 10s, a loaded stack could see that token
    // expire between its mint and the admin request, where FORBIDDEN
    // is what this test verifies. Admin tokens are issued by the
    // master realm and are not affected by the genie setting.
    await updateRealmSettings(adminToken, 'genie', { accessTokenLifespan: originalLifespan });

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
