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

  // Step 4: Wait for redirect back to the app — the dashboard, exactly:
  // the login is requested from '/' (whose redirect target is
  // /dashboard), and CallbackView replaces to that same returnUrl. One
  // expected landing; a login flow that parks anywhere else fails here.
  await page.waitForURL(`${BASE_URL}/dashboard`, {
    timeout: 30000,
  });

  // Authenticated-shell proof: the logout button renders only inside
  // App.vue's authenticated gate — see the note beside NAV_LOGOUT_BUTTON
  // in helpers/navbar.js. The exact-URL pin above proves the router guard
  // admitted a session; this proves the shell behind it actually rendered.
  const logoutButton = page.locator(NAV_LOGOUT_BUTTON);
  await expect(
    logoutButton,
    `Expected the authenticated shell (logout button visible) on the dashboard; got URL: ${page.url()}`,
  ).toBeVisible({ timeout: 10000 });

  await context.close();
});
