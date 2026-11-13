const { test, expect } = require('@playwright/test');
const {
  getAdminToken,
  getUserToken,
  getSessionTokenViaUI,
  request: authRequest,
  parseJwtClaims,
  SESSION_MINT_TIMEOUT_MS,
} = require('../helpers/auth');
const { createUser, deleteUser, enableDirectAccessGrants } = require('../helpers/keycloak-admin');
const { realmExists, missingRealmReason, skipUnlessVenue } = require('../helpers/venue-profile');

/**
 * Phase I: Multi-Realm Configuration (Story 2-9)
 *
 * Prerequisites (set up in Phase 0, Step 0.6):
 *   - KEYCLOAK_ADDITIONAL_REALMS includes "genie2" in .env
 *   - genie2 realm exists in Keycloak (created before backend started)
 *   - Backend has been restarted to load genie2 JWKS
 */
test.describe.serial('Phase I: Multi-Realm Configuration', () => {
  // See SESSION_MINT_TIMEOUT_MS: describe.configure covers the tests,
  // the in-hook test.setTimeout covers beforeAll (hooks read the
  // project timeout, not the suite timeout).
  test.describe.configure({ timeout: SESSION_MINT_TIMEOUT_MS });

  let adminToken;
  let genie1Token;
  const TEST_REALM = 'genie2';
  const TEST_USER = { username: 'testuser2', password: 'TestPass123!', email: 'testuser2@genie2.local' };

  // The venue profile decides: a deployment that exposes no second realm
  // cannot answer a multi-realm request, so the test below SKIPS WITH A
  // REASON instead of failing on a realm that was never provisioned
  // (#1742). The reason is the venue's own profile, read from the realm
  // inventory — not a guess, and never a silent skip.
  // The venue profile decides: a deployment that exposes no second realm
  // cannot answer a multi-realm request, so the test below SKIPS WITH A
  // REASON instead of failing on a realm that was never provisioned
  // (#1742). The wiring is the shared registrar's (#1773), stated once —
  // the reason is the venue's own profile, read from the realm inventory.
  test.beforeEach(
    skipUnlessVenue(test, () => realmExists(TEST_REALM), () => missingRealmReason(TEST_REALM))
  );

  // The second realm is absent: the tests skip, and the hooks after a
  // skipped hook do not run (pinned in the helper's unit spec) — the
  // setup below never mints into a realm that does not exist. The guard
  // is the registrar's (#1773), stated once.
  test.beforeAll(
    skipUnlessVenue(test, () => realmExists(TEST_REALM), () => missingRealmReason(TEST_REALM))
  );

  test.beforeAll(async () => {
    test.setTimeout(SESSION_MINT_TIMEOUT_MS);

    adminToken = await getAdminToken();

    // genie2 is test-only: enable ROPC for its direct token mints
    // (see enableDirectAccessGrants — never on the primary realm).
    await enableDirectAccessGrants(adminToken, TEST_REALM, 'genie-app');

    // Primary-realm token from a browser login session — minted once,
    // like the sibling suites. The helper launches its own throwaway
    // browser when none is handed in (this hook takes no fixtures:
    // Playwright requires a hook's first positional parameter to be a
    // destructuring pattern, so a guard wrapper cannot forward one).
    genie1Token = await getSessionTokenViaUI();

    // Create test user in genie2 (realm should already exist from Phase
    // 0.6; createUser tolerates a 409 from a previous run)
    await createUser(adminToken, TEST_REALM, TEST_USER);
  });

  test.afterAll(async () => {
    // Cleanup chains up to three 30s-capped admin requests on a stalled
    // stack — past the 60s project timeout the hook otherwise runs under.
    test.setTimeout(SESSION_MINT_TIMEOUT_MS);

    // The second realm is absent: the tests skipped, there is nothing to
    // clean up, and the admin calls below would hit a realm that does not
    // exist.
    if (!(await realmExists(TEST_REALM))) return;

    // Cleanup: delete test user only (realm lifecycle is managed by Phase 0).
    // A failed delete fails the suite and names the leftover: the account
    // stays in genie2 until the next run's createUser (409-tolerant) reuses it.
    const token = await getAdminToken();
    const searchRes = await authRequest(
      'GET',
      `/auth/admin/realms/${TEST_REALM}/users?username=${TEST_USER.username}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (searchRes.data && searchRes.data.length > 0) {
      await deleteUser(token, TEST_REALM, searchRes.data[0].id);
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
    // genie1 from the beforeAll browser session; genie2 keeps ROPC as
    // provisioned above.
    const genie2Token = await getUserToken(TEST_USER.username, TEST_USER.password, { realm: TEST_REALM });

    const claims1 = parseJwtClaims(genie1Token);
    const claims2 = parseJwtClaims(genie2Token);

    // Assert: issuers are different
    // endsWith, not contains: 'realms/genie2' contains 'realms/genie'.
    expect(claims1.iss, 'genie1 issuer must end with "realms/genie"').toMatch(/realms\/genie$/);
    expect(claims2.iss, 'genie2 issuer must contain "realms/genie2"').toContain('realms/genie2');
    expect(claims1.iss, 'Issuers must be different').not.toBe(claims2.iss);
  });

  test('I.3 — backend validates tokens from both realms simultaneously', async () => {
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
