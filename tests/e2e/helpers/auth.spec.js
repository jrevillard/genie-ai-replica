const { test, expect } = require('@playwright/test');
const { getUserToken, getAdminToken } = require('./auth');

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
    if (saved.ADMIN_TOKEN === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = saved.ADMIN_TOKEN;
    if (saved.KEYCLOAK_ADMIN_PASSWORD === undefined) delete process.env.KEYCLOAK_ADMIN_PASSWORD;
    else process.env.KEYCLOAK_ADMIN_PASSWORD = saved.KEYCLOAK_ADMIN_PASSWORD;
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
