const { test, expect } = require('@playwright/test');

// Test L.2 — localStorage Cleanup on Logout
// Login, inject legacy localStorage items, trigger logout, verify they are removed.
// The Vuex logout action clears 'user' and 'auth_token' from localStorage in its finally block.
// Source: docs/e2e-tests/epic3-session-lifecycle-gdpr.md Phase L

test('clears legacy localStorage items after logout', async ({ browser }) => {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    bypassCSP: true,
  });
  const page = await context.newPage();

  // Step 1: Navigate to app root — should redirect to Keycloak
  await page.goto('https://localhost/', {
    waitUntil: 'networkidle',
    timeout: 30000,
  });

  // Step 2: Wait for Keycloak login page and fill credentials
  await page.waitForURL('**/protocol/openid-connect/auth**', {
    timeout: 15000,
  });

  await page.fill('#username', 'testuser');
  await page.fill('#password', 'TestPass123!');
  await page.click('#kc-login');

  // Step 3: Wait for redirect back to the app (dashboard)
  await page.waitForURL(
    (url) => {
      const urlStr = url.toString();
      return urlStr.includes('dashboard') || urlStr === 'https://localhost/';
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

  // Step 5: Intercept logout redirect to check localStorage BEFORE navigation
  // The logout action clears localStorage synchronously before signoutRedirect
  // We capture the state by listening for beforeunload
  let localStorageAfterLogout = null;
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/protocol/openid-connect/logout') || url.includes('/protocol/openid-connect/auth')) {
      // localStorage was already cleared by the Vuex action at this point
      // We can't read it cross-origin, so we verify via page.evaluate before redirect
    }
  });

  // Step 6: Click the logout button
  const logoutButton = page.locator('button.logout-btn');
  await expect(logoutButton, 'Logout button should be visible').toBeVisible({ timeout: 10000 });

  // Evaluate localStorage right before clicking (synchronous cleanup happens in the click handler)
  await logoutButton.click();

  // Step 7: Wait for navigation to complete (redirect to Keycloak or back to app)
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

  // Step 8: Navigate back to app origin and check localStorage
  // Use about:blank to reset, then navigate to app origin
  await page.goto('about:blank');
  await page.goto('https://localhost/', { waitUntil: 'commit', timeout: 15000 });

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
