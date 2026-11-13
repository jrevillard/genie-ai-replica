const { randomBytes } = require('crypto');
const { test, expect } = require('@playwright/test');
const {
  getAdminToken,
  getSessionTokenViaUI,
  parseJwtClaims,
  request: authRequest,
  SESSION_MINT_TIMEOUT_MS,
} = require('../helpers/auth');
const {
  createUser,
  deleteUser,
  findUsers,
  findClient,
  createClient,
  deleteClient
} = require('../helpers/keycloak-admin');

test.describe.serial('Phase K: Auth Error Display', () => {
  // See SESSION_MINT_TIMEOUT_MS: describe.configure covers the tests
  // (the serial suite stacks two browser logins and admin-API calls).
  test.describe.configure({ timeout: SESSION_MINT_TIMEOUT_MS });

  let noRolesUserId;
  // K.2's dedicated expiry client: a CLIENT-SCOPED 10s token lifespan
  // (the 'access.token.lifespan' attribute) — the realm's global default
  // stays what the deployment runs (#1785), so the suite is safe on a
  // shared venue. Created by K.2, swept by NAME in afterAll together
  // with the service-account user its creation spawns.
  const EXPIRY_CLIENT_ID = 'e2e-k1-token-expiry';
  const EXPIRY_LIFESPAN_SECONDS = 10;
  const EXPIRY_SERVICE_ACCOUNT = `service-account-${EXPIRY_CLIENT_ID}`;
  // Random per run: a committed secret would make a leftover client (a
  // failed cleanup) mintable by anyone who reads this file.
  const EXPIRY_CLIENT_SECRET = randomBytes(24).toString('hex');
  const NOROLES_USERNAME = 'noroles-user-e2e';
  const NOROLES_PASSWORD = 'TestPass123!';

  // Sweep the dedicated expiry client BY NAME — one contract both ends of
  // the failure window need: K.2 clears a previous run's leftover before
  // creating fresh, afterAll clears this run's leftover no matter how
  // K.2 died. One copy, so a change to one end moves both. Throws on
  // failure — the caller owns the reporting.
  async function sweepExpiryClient(adminTokenForSweep) {
    const stale = await findClient(adminTokenForSweep, 'genie', EXPIRY_CLIENT_ID);
    if (stale) {
      await deleteClient(adminTokenForSweep, 'genie', stale.id, EXPIRY_CLIENT_ID);
    }
  }

  test.afterAll(async () => {
    // Cleanup chains several 30s-capped admin requests on a stalled
    // stack — past the 60s project timeout the hook otherwise runs under.
    test.setTimeout(SESSION_MINT_TIMEOUT_MS);

    // Every cleanup runs, and EVERY failure is reported: a throw from the
    // first one used to abort the hook and skip the rest, so the next
    // suite inherited the leftovers while the report named only the
    // first. One array, one entry per failure: the message names it, the
    // cause is the error behind it. Two parallel arrays could drift.
    const failures = [];

    // ONE admin token for all cleanups: several mints would mean several
    // password grants to the master realm, and a later one could eat the
    // rest of the hook's budget on a stalled realm — reported then as a
    // generic hook timeout instead of the leftovers this hook names.
    let adminTokenForCleanup = null;
    try {
      adminTokenForCleanup = await getAdminToken();
    } catch (e) {
      // Name what stays behind: the report's header says every leftover
      // is named, and a mint that fails skips every cleanup.
      const skipped = [`the expiry client ${EXPIRY_CLIENT_ID} sweep`, 'the service-account sweep'];
      if (noRolesUserId) skipped.push(`the no-roles user ${noRolesUserId} delete`);
      failures.push({
        message:
          `the master-realm admin token could not be minted — ${skipped.length} cleanup(s) did not ` +
          `run: ${skipped.join(', ')}. Cause: ${e.message}`,
        cause: e
      });
    }

    // The dedicated expiry client, swept BY NAME (not by a uuid a failed
    // test left untracked): its client-scoped 10s lifespan keeps applying
    // to tokens minted through it, so a leftover must not survive the
    // suite. The realm's global default is never touched anymore (#1785)
    // — the lifespan capture/restore that used to guard it is gone.
    if (adminTokenForCleanup) {
      try {
        await sweepExpiryClient(adminTokenForCleanup);
      } catch (e) {
        failures.push({
          message:
            `the expiry client ${EXPIRY_CLIENT_ID} was not deleted — its client-scoped 10s token ` +
            `lifespan keeps applying to tokens minted through it. Cause: ${e.message}`,
          cause: e
        });
      }

      // The service-account user Keycloak spawns with the client. The
      // client delete normally removes it; when it survives, delete it
      // explicitly — a leftover account is named and removed, never
      // dropped.
      try {
        const serviceAccounts = await findUsers(adminTokenForCleanup, 'genie', 'username', EXPIRY_SERVICE_ACCOUNT);
        for (const account of serviceAccounts) {
          try {
            await deleteUser(adminTokenForCleanup, 'genie', account.id);
          } catch (e) {
            failures.push({
              message:
                `the service-account user ${account.username} was not deleted — it stays in the realm ` +
                `for the next run. Cause: ${e.message}`,
              cause: e
            });
          }
        }
      } catch (e) {
        failures.push({
          message:
            `the service-account sweep for ${EXPIRY_SERVICE_ACCOUNT} could not read the realm's users. ` +
            `Cause: ${e.message}`,
          cause: e
        });
      }

      // Cleanup: delete no-roles user. A failed delete fails the suite and
      // names the leftover; a leftover account is harmless to the next run
      // only because createUser tolerates the 409, so the failure must be
      // visible, not swallowed.
      if (noRolesUserId) {
        try {
          await deleteUser(adminTokenForCleanup, 'genie', noRolesUserId);
        } catch (e) {
          failures.push({
            message:
              `the no-roles user ${noRolesUserId} was not deleted — it stays in the realm for the next ` +
              `run. Cause: ${e.message}`,
            cause: e
          });
        }
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `k1 afterAll: ${failures.length} cleanup(s) failed — every leftover is named: ` +
          `${failures.map((f) => f.message).join(' | ')}`,
        { cause: failures[0].cause }
      );
    }
  });

  test('K.1 — TOKEN_INVALID (modified token)', async ({ browser }) => {
    // A GENIE session token, not the admin token: the backend accepts a
    // genie token unmodified, so only the mangling below can produce the
    // rejection — with an admin token the assertion could never fail
    // (unknown issuer is already TOKEN_INVALID). Mangling the first
    // payload character corrupts the base64/JSON: the token dies at
    // payload decode, before signature verification is attempted.
    const genieToken = await getSessionTokenViaUI({ browser });
    const tokenParts = genieToken.split('.');
    tokenParts[1] = 'X' + tokenParts[1].slice(1); // Change first char of payload
    const modifiedToken = tokenParts.join('.');

    const res = await authRequest('GET', '/api/me', {
      headers: { Authorization: `Bearer ${modifiedToken}` },
    });
    expect(res.status).toBe(401);
    expect(res.data.error).toBe('TOKEN_INVALID');
  });

  test('K.2 — TOKEN_EXPIRED (short-lived token)', async () => {
    // Fresh admin token: each test mints its own — no cross-test state.
    const adminToken = await getAdminToken();

    // A client a previous run's failed cleanup left behind would carry an
    // unknown state — remove it before creating fresh. The client-scoped
    // 'access.token.lifespan' attribute shortens ONLY this client's
    // tokens: the realm's global default stays what the deployment runs,
    // so the suite is safe on a shared venue (#1785).
    await sweepExpiryClient(adminToken);
    await createClient(adminToken, 'genie', {
      clientId: EXPIRY_CLIENT_ID,
      enabled: true,
      protocol: 'openid-connect',
      publicClient: false,
      serviceAccountsEnabled: true,
      standardFlowEnabled: false,
      directAccessGrantsEnabled: false,
      secret: EXPIRY_CLIENT_SECRET,
      attributes: { 'access.token.lifespan': String(EXPIRY_LIFESPAN_SECONDS) },
    });

    // Mint the short-lived token with client_credentials: the service
    // account needs neither a user nor a browser session, and the mint
    // cannot collide with another seat's session on a shared venue.
    const mintRes = await authRequest('POST', '/auth/realms/genie/protocol/openid-connect/token', {
      body: new URLSearchParams({
        client_id: EXPIRY_CLIENT_ID,
        client_secret: EXPIRY_CLIENT_SECRET,
        grant_type: 'client_credentials',
      }).toString(),
      contentType: 'application/x-www-form-urlencoded',
    });
    expect(mintRes.status, `the client_credentials mint failed: ${JSON.stringify(mintRes.data)}`).toBe(200);
    const shortToken = mintRes.data.access_token;
    const claims = parseJwtClaims(shortToken);

    // Assert the client-scoped lifespan ACTUALLY applied, from the
    // token's own claims. A realm-default token (300 s) would wait five
    // minutes and then still pass the expiry assertion below — silently
    // proving nothing.
    const lifespan = claims.exp - claims.iat;
    expect(
      lifespan,
      `the client-scoped ${EXPIRY_LIFESPAN_SECONDS}s lifespan did not apply — the token expires ` +
        `${lifespan}s after issuance (realm default? the attribute is ignored)`
    ).toBeLessThanOrEqual(EXPIRY_LIFESPAN_SECONDS + 5);

    // Wait for the token's OWN expiry: a bounded wait-for-condition on
    // the exp claim, not a fixed sleep. The bound counts POLLS, not a
    // clock delta: a clock that jumps backward can defeat any timestamp
    // comparison, but it cannot make extra polls appear — so the bound
    // is the one shape a stuck clock cannot escape. It covers the
    // asserted lifespan plus a 5s margin.
    const expiresAtMs = claims.exp * 1000;
    const pollMs = 500;
    const maxPolls = Math.ceil((EXPIRY_LIFESPAN_SECONDS * 1000 + 5000) / pollMs);
    for (let polls = 0; Date.now() < expiresAtMs; polls += 1) {
      if (polls >= maxPolls) {
        throw new Error(
          `the clock did not reach the token's exp (${new Date(expiresAtMs).toISOString()}) within ` +
            `${maxPolls * pollMs}ms of bounded polling`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    // ONE call, with the expired token. No fresh-token call precedes it:
    // the backend provisions a user document on a VERIFIED token, and
    // the expired path answers BEFORE provisioning — the venue keeps no
    // trace of this token.
    const res = await authRequest('GET', '/api/me', {
      headers: { Authorization: `Bearer ${shortToken}` },
    });
    expect(res.status).toBe(401);
    expect(res.data.error).toBe('TOKEN_EXPIRED');
  });

  test('K.3 — FORBIDDEN (user without roles)', async ({ browser }) => {
    // Fresh admin token — each test mints its own, no cross-test state.
    const adminToken = await getAdminToken();

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
