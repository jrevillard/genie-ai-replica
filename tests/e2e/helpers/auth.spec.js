const { test, expect } = require('@playwright/test');
const { getUserToken } = require('./auth');

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
