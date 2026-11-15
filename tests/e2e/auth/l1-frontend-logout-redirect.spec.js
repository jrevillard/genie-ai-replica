const { test, expect } = require('@playwright/test');
const { BASE_URL } = require('../helpers/base-url');
const { TEST_USER } = require('../helpers/e2e-fixtures');
const { NAV_LOGOUT_BUTTON } = require('../helpers/navbar');
const {
  KEYCLOAK_AUTH_ENDPOINT_GLOB,
  waitForRealmAuthEndpoint,
  expectKeycloakLoginForm,
} = require('../helpers/keycloak-landing');

// Test L.1 — Frontend Logout Redirect
// Complete logout flow: login, click logout button, verify redirect to Keycloak login page.
// Source: docs/e2e-tests/suite-map.md § The acceptance phases, Phase L

test('clicks logout button and redirects to Keycloak login page', async ({ browser }) => {
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
  await page.waitForURL(KEYCLOAK_AUTH_ENDPOINT_GLOB, {
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
  // /dashboard), so that is the one expected landing; a login flow that
  // parks anywhere else fails here.
  await page.waitForURL(`${BASE_URL}/dashboard`, { timeout: 30000 });

  // Step 5: Click the logout button (NavBarComponent desktop logout button).
  // Its visibility is the authenticated-state pin: it renders only inside
  // the authenticated shell — see the note beside NAV_LOGOUT_BUTTON in
  // helpers/navbar.js.
  const logoutButton = page.locator(NAV_LOGOUT_BUTTON);
  await expect(logoutButton, 'Logout button should be visible after login').toBeVisible({ timeout: 10000 });
  await logoutButton.click();

  // Step 6: Settle on the realm (helpers/keycloak-landing.js)…
  await waitForRealmAuthEndpoint(page);

  // Step 7: …and prove the landing (the form renders only while the realm
  // holds no live SSO session — a partial logout bounces back into the app
  // and never renders it).
  await expectKeycloakLoginForm(
    page,
    `Expected the Keycloak login form after logout (session cleared); the browser was last at: ${page.url()}`,
  );

  await context.close();
});
