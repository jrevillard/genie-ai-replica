const { test, expect } = require('@playwright/test');
const { BASE_URL } = require('../helpers/base-url');
const { TEST_USER } = require('../helpers/e2e-fixtures');
const { NAV_LOGOUT_BUTTON } = require('../helpers/navbar');

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

  // Step 4: Wait for redirect back to the app (dashboard)
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

  // Step 5: Click the logout button (NavBarComponent desktop logout button).
  // The button renders only inside the authenticated shell (App.vue renders
  // the navbar only for isAuthenticated && currentUser), so its visibility is
  // the authenticated-state pin — no brand-substring check beside it.
  const logoutButton = page.locator(NAV_LOGOUT_BUTTON);
  await expect(logoutButton, 'Logout button should be visible after login').toBeVisible({ timeout: 10000 });
  await logoutButton.click();

  // Step 6: Wait for the Keycloak logout redirect chain to reach the realm —
  // the logout endpoint (signoutRedirect via oidc-client-ts) and, once the
  // realm session is destroyed, the auth endpoint that renders the login
  // page (the same two endpoints the l3 spec waits for). Nothing in the
  // app, Keycloak or the docs produces /auth/realms/genie/login — that
  // alternative matched nothing and only weakened the wait.
  await page.waitForURL(
    (url) => {
      const urlStr = url.toString();
      return (
        urlStr.includes('/auth/realms/genie/protocol/openid-connect/logout') ||
        urlStr.includes('/auth/realms/genie/protocol/openid-connect/auth')
      );
    },
    { timeout: 30000 },
  );

  // Step 7: The landing-form proof (the l3 spec's corrected step 8): the
  // Keycloak login form renders only while the realm holds no live SSO
  // session, so it is the proof the logout completed. A partial logout —
  // a surviving SSO session — bounces through the auth endpoint straight
  // back into the app and never renders this form; a realm-path URL match
  // alone cannot tell the two apart. One expected landing, asserted
  // unconditionally.
  await expect(
    page.locator('#username'),
    `Expected the Keycloak login form after logout (session cleared); the browser was last at: ${page.url()}`,
  ).toBeVisible({ timeout: 15000 });

  await context.close();
});
