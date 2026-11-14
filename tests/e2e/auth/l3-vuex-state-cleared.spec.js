const { test, expect } = require('@playwright/test');
const { BASE_URL } = require('../helpers/base-url');
const { TEST_USER } = require('../helpers/e2e-fixtures');
const { NAV_LOGOUT_BUTTON } = require('../helpers/navbar');

// Test L.3 — Vuex Auth State Cleared on Logout
// Login, verify isAuthenticated is true, trigger logout, verify the app no
// longer restores the session: it lands on the Keycloak login page. That
// landing IS the Vuex-cleared proof — the navigation guard only redirects
// unauthenticated users, and the genie_post_logout flag blocks session
// restoration (frontend auth store).
// Source: docs/e2e-tests/suite-map.md § The acceptance phases, Phase L

test('clears Vuex auth state after logout — lands on the Keycloak login page', async ({ browser }) => {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    bypassCSP: true
  });
  const page = await context.newPage();

  // Step 1: Navigate to app root — should redirect to Keycloak
  await page.goto(`${BASE_URL}/`, {
    waitUntil: 'networkidle',
    timeout: 30000
  });

  // Step 2: Wait for Keycloak login page and fill credentials
  await page.waitForURL('**/protocol/openid-connect/auth**', {
    timeout: 15000
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
    { timeout: 30000 }
  );

  const dashboardUrl = page.url();
  await expect(
    dashboardUrl.includes('dashboard'),
    `Expected URL to contain 'dashboard' after login, got: ${dashboardUrl}`
  ).toBeTruthy();

  // Step 4: Verify authenticated state via Vuex store — the store is
  // reachable once __vue_app__ exists.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const app = document.querySelector('#app');
          return Boolean(app && app.__vue_app__);
        }),
      { timeout: 15000 }
    )
    .toBe(true);

  const authStateBefore = await page.evaluate(() => {
    const app = document.querySelector('#app');
    if (app && app.__vue_app__) {
      const store = app.__vue_app__.config.globalProperties.$store;
      return {
        isAuthenticated: store.getters.isAuthenticated,
        user: store.getters.currentUser,
        accessToken: store.getters.accessToken ? 'present' : null
      };
    }
    return null;
  });

  await expect(authStateBefore !== null, 'Vuex store should be accessible via Vue app instance').toBeTruthy();

  await expect(
    authStateBefore.isAuthenticated === true,
    `Expected isAuthenticated to be true after login, got: ${authStateBefore.isAuthenticated}`
  ).toBeTruthy();

  await expect(
    authStateBefore.user !== null,
    `Expected user to be non-null after login, got: ${JSON.stringify(authStateBefore.user)}`
  ).toBeTruthy();

  await expect(
    authStateBefore.accessToken === 'present',
    `Expected an access token after login, got: ${authStateBefore.accessToken}`
  ).toBeTruthy();

  // Step 5: Click the logout button
  const logoutButton = page.locator(NAV_LOGOUT_BUTTON);
  await expect(logoutButton, 'Logout button should be visible').toBeVisible({ timeout: 10000 });
  await logoutButton.click();

  // Step 6: Wait for redirect to Keycloak
  await page.waitForURL(
    (url) => {
      const urlStr = url.toString();
      return (
        urlStr.includes('/auth/realms/genie/protocol/openid-connect/logout') ||
        urlStr.includes('/auth/realms/genie/protocol/openid-connect/auth')
      );
    },
    { timeout: 30000 }
  );

  // Step 7: Navigate back to app to verify the session is gone
  // After Keycloak processes logout, navigate back: the L.3 contract
  // (docs/e2e-tests/suite-map.md § Test L.3) is that the app must NOT
  // restore the session — it lands on the Keycloak login page, exactly as
  // it does for an unauthenticated visitor (steps 1-2). The
  // genie_post_logout flag blocks session restoration (frontend auth
  // store), so landing anywhere else is a cleared-state failure.
  await page.goto(`${BASE_URL}/`, {
    waitUntil: 'networkidle',
    timeout: 30000
  });

  // Step 8: Assert the landing (the locator auto-waits across the
  // redirect) — the login form renders only when the realm holds no live
  // SSO session, so this is the cleared-state proof (the navigation guard
  // only fires when isAuthenticated is false). A URL match alone could
  // report a false pass: a surviving session (a partial logout) passes
  // through the auth endpoint on its 302 back to the app and never
  // renders this form. One expected landing, asserted unconditionally.
  await expect(
    page.locator('#username'),
    `Expected the Keycloak login form after logout (session cleared); the browser was last at: ${page.url()}`
  ).toBeVisible({ timeout: 15000 });

  await context.close();
});
