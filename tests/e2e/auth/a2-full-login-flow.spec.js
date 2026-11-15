const { test, expect } = require('@playwright/test');
const { BASE_URL } = require('../helpers/base-url');
const { TEST_USER } = require('../helpers/e2e-fixtures');
const { NAV_LOGOUT_BUTTON } = require('../helpers/navbar');

// Test A.2 — Full Login Flow
// Complete login flow: navigate to app, get redirected to Keycloak,
// fill credentials, submit, and verify authenticated state in the app.
// Source: e2e-test-plan-external-idp.md Phase A.2

test('completes full login flow from app to Keycloak and back', async ({ browser }) => {
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
  await page.fill('#username', TEST_USER.username);
  await page.fill('#password', TEST_USER.password);
  await page.click('#kc-login');

  // Step 4: Wait for redirect back to the app
  await page.waitForURL(`${BASE_URL}/**`, {
    timeout: 30000,
  });

  // Step 5: Verify authenticated state — wait for navigation to settle
  await page.waitForURL(
    (url) => {
      const urlStr = url.toString();
      return urlStr.includes('dashboard') || urlStr === `${BASE_URL}/`;
    },
    { timeout: 30000 },
  );

  const finalUrl = page.url();
  await expect(
    finalUrl.includes('dashboard'),
    `Expected URL to contain 'dashboard', got: ${finalUrl}`,
  ).toBeTruthy();

  // Authenticated-shell proof: the navbar renders only inside App.vue's
  // authenticated gate (isAuthenticated && currentUser), so a visible
  // logout button proves the authenticated UI actually rendered. The URL
  // pin above proves the router guard admitted a session; this proves the
  // shell behind it is alive (the deleted brand-substring check was this
  // same proof, keyed on copy text instead of a declared handle).
  const logoutButton = page.locator(NAV_LOGOUT_BUTTON);
  await expect(
    logoutButton,
    `Expected the authenticated shell (logout button visible) on the dashboard; got URL: ${finalUrl}`,
  ).toBeVisible({ timeout: 10000 });

  await context.close();
});
