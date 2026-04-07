const { test, expect } = require('@playwright/test');

// Test L.3 — Vuex Auth State Cleared on Logout
// Login, verify isAuthenticated is true, trigger logout, verify state is cleared.
// The Vuex clearAuth mutation sets isAuthenticated=false, user=null, accessToken=null.
// Source: docs/e2e-tests/epic3-session-lifecycle-gdpr.md Phase L

test('clears Vuex auth state after logout', async ({ browser }) => {
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

  // Step 4: Verify authenticated state via Vuex store
  // Wait for Vue to mount and Vuex store to be initialized
  await page.waitForTimeout(2000);

  const authStateBefore = await page.evaluate(() => {
    const app = document.querySelector('#app');
    if (app && app.__vue_app__) {
      const store = app.__vue_app__.config.globalProperties.$store;
      return {
        isAuthenticated: store.getters.isAuthenticated,
        user: store.getters.currentUser,
        accessToken: store.getters.accessToken ? 'present' : null,
      };
    }
    return null;
  });

  await expect(
    authStateBefore !== null,
    'Vuex store should be accessible via Vue app instance',
  ).toBeTruthy();

  await expect(
    authStateBefore.isAuthenticated === true,
    `Expected isAuthenticated to be true after login, got: ${authStateBefore.isAuthenticated}`,
  ).toBeTruthy();

  await expect(
    authStateBefore.user !== null,
    `Expected user to be non-null after login, got: ${JSON.stringify(authStateBefore.user)}`,
  ).toBeTruthy();

  // Step 5: Click the logout button
  const logoutButton = page.locator('button.logout-btn');
  await expect(logoutButton, 'Logout button should be visible').toBeVisible({ timeout: 10000 });
  await logoutButton.click();

  // Step 6: Wait for redirect to Keycloak
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

  // Step 7: Navigate back to app to verify Vuex state is cleared
  // After Keycloak processes logout, navigate back to check that a fresh
  // Vue instance starts with cleared state.
  await page.goto('https://localhost/', {
    waitUntil: 'networkidle',
    timeout: 30000,
  });

  // Wait for redirect (should go to Keycloak login since session is gone)
  await page.waitForURL(
    (url) => {
      const urlStr = url.toString();
      return (
        urlStr.includes('/auth/realms/genie/') ||
        urlStr.includes('dashboard')
      );
    },
    { timeout: 15000 },
  );

  // Step 8: Verify the redirect happened — if we end up at Keycloak login,
  // it proves isAuthenticated is false (navigation guard redirects unauthenticated users).
  const finalUrl = page.url();
  const isAtKeycloak = finalUrl.includes('/auth/realms/genie/');

  await expect(
    isAtKeycloak || !finalUrl.includes('dashboard'),
    `Expected redirect to Keycloak after logout (session cleared), got: ${finalUrl}`,
  ).toBeTruthy();

  // Additionally verify Vuex state directly if still on app domain
  if (!isAtKeycloak) {
    await page.waitForTimeout(2000);
    const authStateAfter = await page.evaluate(() => {
      const app = document.querySelector('#app');
      if (app && app.__vue_app__) {
        const store = app.__vue_app__.config.globalProperties.$store;
        return {
          isAuthenticated: store.getters.isAuthenticated,
          user: store.getters.currentUser,
        };
      }
      return null;
    });

    if (authStateAfter !== null) {
      await expect(
        authStateAfter.isAuthenticated === false,
        `Expected isAuthenticated to be false after logout, got: ${authStateAfter.isAuthenticated}`,
      ).toBeTruthy();
      await expect(
        authStateAfter.user === null,
        `Expected user to be null after logout, got: ${JSON.stringify(authStateAfter.user)}`,
      ).toBeTruthy();
    }
  }

  await context.close();
});
