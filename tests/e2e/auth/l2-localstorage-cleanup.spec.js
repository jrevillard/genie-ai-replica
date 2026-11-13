const { test, expect } = require('@playwright/test');
const { BASE_URL } = require('../helpers/base-url');
const { TEST_USER } = require('../helpers/e2e-fixtures');

// Test L.2 — localStorage Cleanup on Logout
// Login, inject legacy localStorage items, trigger logout, verify they are removed.
// The Vuex logout action clears 'user' and 'auth_token' from localStorage before the Keycloak signoutRedirect.
// Source: docs/e2e-tests/epic3-session-lifecycle-gdpr.md Phase L

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
  const logoutButton = page.getByRole('button', { name: 'Log out' });
  await expect(logoutButton, 'Logout button should be visible').toBeVisible({ timeout: 10000 });

  await logoutButton.click();

  // Step 6: Wait for navigation to complete (redirect to Keycloak or back to app)
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

  // Step 7: Navigate back to app origin and check localStorage
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
