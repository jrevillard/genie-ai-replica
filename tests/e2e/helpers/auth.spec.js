const { test, expect } = require('@playwright/test');
const auth = require('./auth');
const { getUserToken, getAdminToken } = auth;

// getUserToken mints tokens via ROPC, which the primary realm refuses by
// design. A missing realm must be reported as missing (not folded into a
// realm the caller never asked for), and the primary realm must fail fast
// with the design decision named — not with a bare 400 from the token
// endpoint once the suite runs.
test.describe('getUserToken primary-realm guard', () => {
  test('rejects a missing realm with a message naming the requirement', async () => {
    // Covers a spec copying the call pattern without the realm override —
    // the original trap — and any falsy realm read from an unset env var.
    await expect(getUserToken('user', 'password')).rejects.toThrow(
      /realm is required[\s\S]*enableDirectAccessGrants/
    );
  });

  test('rejects the primary realm with the design decision named', async () => {
    await expect(
      getUserToken('user', 'password', { realm: 'genie' })
    ).rejects.toThrow(/refuses ROPC by design[\s\S]*getSessionTokenViaUI/);
  });
});

// The admin credential: ADMIN_TOKEN wins over the environment's password
// (the same precedence the provisioning script uses), so the fixtures and
// the venue-profile probes cannot end up on different credentials. No
// caller passes an explicit password argument today; the environment IS
// the contract, so the spec drives it through process.env and restores it.
test.describe('the master-realm admin credential', () => {
  const saved = { ADMIN_TOKEN: process.env.ADMIN_TOKEN, KEYCLOAK_ADMIN_PASSWORD: process.env.KEYCLOAK_ADMIN_PASSWORD };

  test.afterEach(() => {
    for (const name of ['ADMIN_TOKEN', 'KEYCLOAK_ADMIN_PASSWORD']) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  test('ADMIN_TOKEN wins over the environment password, without a round trip', async () => {
    process.env.ADMIN_TOKEN = 'the-runner-token';
    process.env.KEYCLOAK_ADMIN_PASSWORD = 'the-environment-password';
    await expect(getAdminToken()).resolves.toBe('the-runner-token');
  });

  test('without a token and without a password, the requirement is named', async () => {
    // Offline on purpose: this is the precedence's other arm, and minting
    // would be a venue round trip.
    delete process.env.ADMIN_TOKEN;
    delete process.env.KEYCLOAK_ADMIN_PASSWORD;
    await expect(getAdminToken()).rejects.toThrow(/KEYCLOAK_ADMIN_PASSWORD env var is required/);
  });
});

// The no-access_token verdict: a 200 whose body carries no token is the
// same failure class as a non-200 — every later realm call would run
// without a token (a `Bearer undefined` header), and a proxy error page
// shaped as JSON answers exactly like this. The transport is swapped at
// the module-object seam (#1842 — the same substitution idiom
// keycloak-admin.js and venue-profile.js read through), so both arms of
// the verdict run OFFLINE: no venue, no TLS fixture. The real transport's
// own response contract (a non-JSON body REJECTS before this verdict can
// see it) is owned by auth-request.spec.js and deliberately not mirrored
// here — a mirror would go stale silently when the real helper moves.
test.describe("getAdminToken's no-access_token verdict", () => {
  const saved = { ADMIN_TOKEN: process.env.ADMIN_TOKEN, KEYCLOAK_ADMIN_PASSWORD: process.env.KEYCLOAK_ADMIN_PASSWORD };
  const realRequest = auth.request;

  test.afterEach(() => {
    auth.request = realRequest;
    // Both env inputs are restored: workers=1 means every later spec file
    // in this process inherits what this describe leaves behind.
    for (const name of ['ADMIN_TOKEN', 'KEYCLOAK_ADMIN_PASSWORD']) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  test('a 200 with an empty body names the missing access_token', async () => {
    delete process.env.ADMIN_TOKEN;
    process.env.KEYCLOAK_ADMIN_PASSWORD = 'the-password';
    auth.request = async () => ({ status: 200, data: null, headers: {} });
    await expect(getAdminToken()).rejects.toThrow(/answered 200 without an access_token/);
  });

  test('a 200 shaped as JSON but carrying no access_token names it, with the body excerpt', async () => {
    delete process.env.ADMIN_TOKEN;
    process.env.KEYCLOAK_ADMIN_PASSWORD = 'the-password';
    auth.request = async () => ({
      status: 200,
      data: { error: 'upstream unreachable', message: 'the proxy answered in its place' },
      headers: {}
    });
    await expect(getAdminToken()).rejects.toThrow(
      /answered 200 without an access_token[\s\S]*upstream unreachable/
    );
  });
});
