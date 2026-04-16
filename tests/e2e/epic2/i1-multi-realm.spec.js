const { test, expect } = require('@playwright/test');
const { getAdminToken, getUserToken, request: authRequest, parseJwtClaims } = require('../helpers/auth');
const { createUser, deleteUser } = require('../helpers/keycloak-admin');

/**
 * Phase I: Multi-Realm Configuration (Story 2-9)
 *
 * Prerequisites (set up in Phase 0, Step 0.7b):
 *   - KEYCLOAK_ADDITIONAL_REALMS includes "genie2" in .env
 *   - genie2 realm exists in Keycloak (created before backend started)
 *   - Backend has been restarted to load genie2 JWKS
 */
test.describe.serial('Phase I: Multi-Realm Configuration', () => {
  let adminToken;
  const TEST_REALM = 'genie2';
  const TEST_USER = { username: 'testuser2', password: 'TestPass123!', email: 'testuser2@genie2.local' };

  test.beforeAll(async () => {
    adminToken = await getAdminToken();

    // Create test user in genie2 (realm should already exist from Phase 0.7b)
    try {
      await createUser(adminToken, TEST_REALM, TEST_USER);
    } catch (err) {
      // User may already exist from a previous test run — that's OK
      if (!err.message.includes('409')) {
        throw err; // Re-throw real errors (e.g. realm doesn't exist)
      }
    }
  });

  test.afterAll(async () => {
    // Cleanup: delete test user only (realm lifecycle is managed by Phase 0)
    try {
      const token = await getAdminToken();
      const searchRes = await authRequest(
        'GET',
        `/auth/admin/realms/${TEST_REALM}/users?username=${TEST_USER.username}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (searchRes.data && searchRes.data.length > 0) {
        await deleteUser(token, TEST_REALM, searchRes.data[0].id);
      }
    } catch {
      // Best-effort cleanup
    }
  });

  test('I.1 — backend validates token from additional realm', async () => {
    const genie2Token = await getUserToken(TEST_USER.username, TEST_USER.password, { realm: TEST_REALM });
    const claims = parseJwtClaims(genie2Token);

    // Assert: token is issued by genie2 realm
    expect(claims.iss, 'Token must be issued by genie2 realm').toContain('realms/genie2');
    expect(claims.azp, 'Token must be for genie-app client').toBe('genie-app');

    // Assert: backend accepts the token (proves multi-realm JWKS initialization worked)
    const res = await authRequest('GET', '/api/me', {
      headers: { Authorization: `Bearer ${genie2Token}` },
    });
    expect(res.status, 'Backend must accept genie2 tokens').toBe(200);
  });

  test('I.2 — tokens from different realms have different issuers', async () => {
    const genie1Token = await getUserToken('testuser', 'TestPass123!');
    const genie2Token = await getUserToken(TEST_USER.username, TEST_USER.password, { realm: TEST_REALM });

    const claims1 = parseJwtClaims(genie1Token);
    const claims2 = parseJwtClaims(genie2Token);

    // Assert: issuers are different
    expect(claims1.iss, 'genie1 issuer must contain "realms/genie"').toContain('realms/genie');
    expect(claims2.iss, 'genie2 issuer must contain "realms/genie2"').toContain('realms/genie2');
    expect(claims1.iss, 'Issuers must be different').not.toBe(claims2.iss);
  });

  test('I.3 — backend validates tokens from both realms simultaneously', async () => {
    const genie1Token = await getUserToken('testuser', 'TestPass123!');
    const genie2Token = await getUserToken(TEST_USER.username, TEST_USER.password, { realm: TEST_REALM });

    const res1 = await authRequest('GET', '/api/me', {
      headers: { Authorization: `Bearer ${genie1Token}` },
    });
    const res2 = await authRequest('GET', '/api/me', {
      headers: { Authorization: `Bearer ${genie2Token}` },
    });

    // Assert: both tokens accepted
    expect(res1.status, 'genie realm token must be accepted').toBe(200);
    expect(res2.status, 'genie2 realm token must be accepted').toBe(200);
  });
});
