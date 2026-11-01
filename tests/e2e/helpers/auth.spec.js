const { test, expect } = require('@playwright/test');
const { getUserToken } = require('./auth');

// getUserToken mints tokens via ROPC, which the primary realm refuses by
// design. Both the implicit default and an explicit override must fail
// fast with the design decision named — not with a bare 400 from the
// token endpoint once the suite runs.
test.describe('getUserToken primary-realm guard', () => {
  test('rejects the implicit default realm with the design decision named', async () => {
    await expect(getUserToken('user', 'password')).rejects.toThrow(
      /refuses ROPC by design[\s\S]*getSessionTokenViaUI/
    );
  });

  test('rejects an explicit primary realm with the same error', async () => {
    await expect(
      getUserToken('user', 'password', { realm: 'genie' })
    ).rejects.toThrow(/refuses ROPC by design[\s\S]*getSessionTokenViaUI/);
  });
});
