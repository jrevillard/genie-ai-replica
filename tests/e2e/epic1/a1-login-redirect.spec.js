const { test, expect } = require('@playwright/test');

// Test A.1 — Redirect to Keycloak
// Verifies that navigating to the app root redirects to the Keycloak login page.
// Source: e2e-test-plan-external-idp.md Phase A.1

test('redirects to Keycloak login page when accessing app root', async ({ browser }) => {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    bypassCSP: true,
  });
  const page = await context.newPage();

  await page.goto('https://localhost/', {
    waitUntil: 'networkidle',
    timeout: 30000,
  });

  // Wait for redirect to Keycloak OIDC authorization endpoint
  await page.waitForURL('**/protocol/openid-connect/auth**', {
    timeout: 15000,
  });

  const currentUrl = page.url();

  // Verify URL contains the Keycloak genie realm auth path
  await expect(
    currentUrl.includes('/auth/realms/genie/protocol/openid-connect/auth'),
    `Expected URL to contain Keycloak auth path, got: ${currentUrl}`,
  ).toBeTruthy();

  // Verify Keycloak login form elements are present
  const usernameField = page.locator('#username');
  const passwordField = page.locator('#password');
  const loginButton = page.locator('#kc-login');

  await expect(usernameField).toBeVisible({ timeout: 10000 });
  await expect(passwordField).toBeVisible();
  await expect(loginButton).toBeVisible();

  await context.close();
});
