const { test, expect } = require('@playwright/test');

// Test L.1 — Frontend Logout Redirect
// Complete logout flow: login, click logout button, verify redirect to Keycloak login page.
// Source: docs/e2e-tests/epic3-session-lifecycle-gdpr.md Phase L

test('clicks logout button and redirects to Keycloak login page', async ({ browser }) => {
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

  // Step 2: Wait for Keycloak login page
  await page.waitForURL('**/protocol/openid-connect/auth**', {
    timeout: 15000,
  });

  // Verify we are on the Keycloak login page
  const loginUrl = page.url();
  await expect(
    loginUrl.includes('/auth/realms/genie/'),
    `Expected Keycloak login URL, got: ${loginUrl}`,
  ).toBeTruthy();

  // Step 3: Fill credentials and submit
  await page.fill('#username', 'testuser');
  await page.fill('#password', 'TestPass123!');
  await page.click('#kc-login');

  // Step 4: Wait for redirect back to the app (dashboard)
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

  // Step 5: Verify authenticated state — app content should be visible
  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 200));
  await expect(
    bodyText.includes('GENIE.AI'),
    `Expected page body to contain 'GENIE.AI', got: ${bodyText}`,
  ).toBeTruthy();

  // Step 6: Click the logout button (NavBarComponent desktop logout button)
  const logoutButton = page.getByRole('button', { name: 'Log out' });
  await expect(logoutButton, 'Logout button should be visible after login').toBeVisible({ timeout: 10000 });
  await logoutButton.click();

  // Step 7: Wait for redirect to Keycloak — either the logout endpoint
  // (signoutRedirect via oidc-client-ts) or back to the login auth endpoint
  // after Keycloak processes the logout and redirects to post_logout_redirect_uri.
  await page.waitForURL(
    (url) => {
      const urlStr = url.toString();
      return (
        urlStr.includes('/auth/realms/genie/protocol/openid-connect/logout') ||
        urlStr.includes('/auth/realms/genie/protocol/openid-connect/auth') ||
        urlStr.includes('/auth/realms/genie/login')
      );
    },
    { timeout: 30000 },
  );

  const finalUrl = page.url();
  await expect(
    finalUrl.includes('/auth/realms/genie/'),
    `Expected URL to contain Keycloak realm path after logout, got: ${finalUrl}`,
  ).toBeTruthy();

  await context.close();
});
