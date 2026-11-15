const { test, expect } = require('@playwright/test');
const { BASE_URL } = require('../helpers/base-url');
const { loginViaUI, LOGIN_BUDGET_TIMEOUT_MS } = require('../helpers/chatbot');
const { NAV_LOGOUT_BUTTON } = require('../helpers/navbar');

// Test L.2 — localStorage Cleanup on Logout
// Login (through loginViaUI — the suite's one login path, #1854), inject
// legacy localStorage items, trigger logout, verify they are removed.
// The Vuex logout action clears 'user' and 'auth_token' from localStorage before the Keycloak signoutRedirect.
// Source: docs/e2e-tests/suite-map.md § The acceptance phases, Phase L

test('clears legacy localStorage items after logout', async ({ browser }) => {
  // #1798 — the budget's derivation lives on LOGIN_BUDGET_TIMEOUT_MS.
  test.setTimeout(LOGIN_BUDGET_TIMEOUT_MS);
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    bypassCSP: true,
  });
  const page = await context.newPage();

  // Step 1: Log in through the browser — the Keycloak redirect flow is
  // the helper's (retry-once budget included), not this spec's subject.
  await loginViaUI(page);

  // Step 2: Inject legacy localStorage items that the logout action should clean up
  await page.evaluate(() => {
    localStorage.setItem('user', '{"email":"test@test.com"}');
    localStorage.setItem('auth_token', 'fake-token');
  });

  // Verify the legacy items were set
  const userBefore = await page.evaluate(() => localStorage.getItem('user'));
  const tokenBefore = await page.evaluate(() => localStorage.getItem('auth_token'));

  await expect(
    userBefore !== null,
    `Expected 'user' to be set in localStorage before logout, got: ${userBefore}`,
  ).toBeTruthy();
  await expect(
    tokenBefore !== null,
    `Expected 'auth_token' to be set in localStorage before logout, got: ${tokenBefore}`,
  ).toBeTruthy();

  // Step 3: Click the logout button
  const logoutButton = page.locator(NAV_LOGOUT_BUTTON);
  await expect(logoutButton, 'Logout button should be visible').toBeVisible({ timeout: 10000 });

  await logoutButton.click();

  // Step 4: Wait for navigation to complete (redirect to Keycloak or back to app)
  await page.waitForURL(
    (url) => {
      const urlStr = url.toString();
      return (
        urlStr.includes('/auth/realms/genie/') ||
        urlStr.includes('dashboard')
      );
    },
    { timeout: 30000 },
  );

  // Step 5: Navigate back to app origin and check localStorage
  // Use about:blank to reset, then navigate to app origin
  await page.goto('about:blank');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'commit', timeout: 15000 });

  // Check localStorage on the app origin (before Keycloak redirect completes)
  const userAfter = await page.evaluate(() => localStorage.getItem('user'));
  const tokenAfter = await page.evaluate(() => localStorage.getItem('auth_token'));

  await expect(
    userAfter === null,
    `Expected 'user' to be null after logout, got: ${userAfter}`,
  ).toBeTruthy();
  await expect(
    tokenAfter === null,
    `Expected 'auth_token' to be null after logout, got: ${tokenAfter}`,
  ).toBeTruthy();

  await context.close();
});
