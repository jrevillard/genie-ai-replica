const { test, expect } = require('@playwright/test');
const { BASE_URL } = require('../helpers/base-url');
const { TEST_USER } = require('../helpers/e2e-fixtures');
const { NAV_LOGOUT_BUTTON } = require('../helpers/navbar');
const { waitForRealmAuthEndpoint } = require('../helpers/keycloak-landing');

// Test L.2 — localStorage Cleanup on Logout
// Login, inject legacy localStorage items, trigger logout, verify they are removed.
// The Vuex logout action clears 'user' and 'auth_token' from localStorage before the Keycloak signoutRedirect.
// Source: docs/e2e-tests/suite-map.md § The acceptance phases, Phase L

test('clears legacy localStorage items after logout', async ({ browser }) => {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    bypassCSP: true,
  });
  const page = await context.newPage();

  // Step 1: Navigate to app root — should redirect to Keycloak
  await page.goto(`${BASE_URL}/`, {
    waitUntil: 'networkidle',
    timeout: 30000,
  });

  // Step 2: Wait for Keycloak login page and fill credentials
  await page.waitForURL('**/protocol/openid-connect/auth**', {
    timeout: 15000,
  });

  await page.fill('#username', TEST_USER.username);
  await page.fill('#password', TEST_USER.password);
  await page.click('#kc-login');

  // Step 3: Wait for redirect back to the app (dashboard)
  await page.waitForURL(
    (url) => {
      const urlStr = url.toString();
      return urlStr.includes('dashboard') || urlStr === `${BASE_URL}/`;
    },
    { timeout: 30000 },
  );

  const dashboardUrl = page.url();
  await expect(
    dashboardUrl.includes('dashboard'),
    `Expected URL to contain 'dashboard' after login, got: ${dashboardUrl}`,
  ).toBeTruthy();

  // Step 4: Inject legacy localStorage items that the logout action should clean up
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

  // Step 5: Click the logout button
  const logoutButton = page.locator(NAV_LOGOUT_BUTTON);
  await expect(logoutButton, 'Logout button should be visible').toBeVisible({ timeout: 10000 });

  await logoutButton.click();

  // Step 6: Settle on the realm after the logout click (the two chain
  // endpoints — see helpers/keycloak-landing.js). 'dashboard' is not an
  // outcome here: it matches the no-navigation state a failed logout
  // leaves the browser in, which would pass the wait without any logout
  // having happened.
  await waitForRealmAuthEndpoint(page);

  // Step 7: Read the app-origin localStorage after the logout. The read is
  // atomic with an origin guard: after a destroyed realm session the
  // unauthenticated app immediately bounces to Keycloak, so a late
  // evaluate would run on the Keycloak origin — where both keys are always
  // null, a false green for exactly the defect this spec exists to catch.
  // One evaluate checks its own origin first and throws if it lost the
  // race; the reads below therefore ran where they claim to have.
  await page.goto(`${BASE_URL}/`, { waitUntil: 'commit', timeout: 15000 });
  const storageAfter = await page.evaluate((origin) => {
    if (location.origin !== origin) {
      throw new Error(
        `localStorage read lost the auth-redirect race: the page is on ${location.origin}, expected ${origin}`,
      );
    }
    return {
      user: localStorage.getItem('user'),
      token: localStorage.getItem('auth_token'),
    };
  }, BASE_URL);

  await expect(
    storageAfter.user === null,
    `Expected 'user' to be null after logout, got: ${storageAfter.user}`,
  ).toBeTruthy();
  await expect(
    storageAfter.token === null,
    `Expected 'auth_token' to be null after logout, got: ${storageAfter.token}`,
  ).toBeTruthy();

  await context.close();
});
