const { test, expect } = require('@playwright/test');
const { BASE_URL } = require('../helpers/base-url');
const { loginViaUI, LOGIN_BUDGET_TIMEOUT_MS } = require('../helpers/chatbot');
const { NAV_LOGOUT_BUTTON } = require('../helpers/navbar');

// Test L.3 — Vuex Auth State Cleared on Logout
// Login (through loginViaUI — the suite's one login path, #1854), verify
// isAuthenticated is true, trigger logout, verify the app no
// longer restores the session: it lands on the Keycloak login page. That
// landing IS the Vuex-cleared proof — the navigation guard only redirects
// unauthenticated users, and the genie_post_logout flag blocks session
// restoration (frontend auth store).
// Source: docs/e2e-tests/suite-map.md § The acceptance phases, Phase L

test('clears Vuex auth state after logout — lands on the Keycloak login page', async ({ browser }) => {
  // loginViaUI's two attempts cost up to ≈135 s on a stalled stack —
  // past the project default (#1798). LOGIN_BUDGET_TIMEOUT_MS owns the
  // derivation; this file only applies it.
  test.setTimeout(LOGIN_BUDGET_TIMEOUT_MS);
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    bypassCSP: true
  });
  const page = await context.newPage();

  // Step 1: Log in through the browser — the Keycloak redirect flow is
  // the helper's (retry-once budget included), not this spec's subject.
  await loginViaUI(page);

  // Step 2: Verify authenticated state via Vuex store — the store is
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

  // Step 3: Click the logout button
  const logoutButton = page.locator(NAV_LOGOUT_BUTTON);
  await expect(logoutButton, 'Logout button should be visible').toBeVisible({ timeout: 10000 });
  await logoutButton.click();

  // Step 4: Wait for redirect to Keycloak
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

  // Step 5: Navigate back to app to verify the session is gone
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

  // Step 6: Assert the landing — the form is server-rendered by the time
  // goto lands; the locator auto-waits the render. The login form renders
  // only when the realm holds no live SSO session, so this is the
  // cleared-state proof (the navigation guard only fires when
  // isAuthenticated is false). A URL match alone could report a false
  // pass: a surviving session (a partial logout) passes through the auth
  // endpoint on its 302 back to the app and never renders this form. One
  // expected landing, asserted unconditionally.
  await expect(
    page.locator('#username'),
    `Expected the Keycloak login form after logout (session cleared); the browser was last at: ${page.url()}`
  ).toBeVisible({ timeout: 15000 });

  await context.close();
});
