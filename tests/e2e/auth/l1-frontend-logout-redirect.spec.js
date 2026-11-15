const { test, expect } = require('@playwright/test');
const { loginViaUI, LOGIN_BUDGET_TIMEOUT_MS } = require('../helpers/chatbot');
const { NAV_LOGOUT_BUTTON } = require('../helpers/navbar');
const { waitForRealmAuthEndpoint, expectKeycloakLoginForm } = require('../helpers/keycloak-landing');

// Test L.1 — Frontend Logout Redirect
// Complete logout flow: login (through loginViaUI — the suite's one login
// path, #1854), click logout button, verify redirect to Keycloak login page.
// Source: docs/e2e-tests/suite-map.md § The acceptance phases, Phase L

test('clicks logout button and redirects to Keycloak login page', async ({ browser }) => {
  // #1798 — the budget's derivation lives on LOGIN_BUDGET_TIMEOUT_MS.
  test.setTimeout(LOGIN_BUDGET_TIMEOUT_MS);
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    bypassCSP: true
  });
  const page = await context.newPage();

  // Step 1: Log in through the browser — the Keycloak redirect flow is
  // the helper's (retry-once budget included), not this spec's subject.
  await loginViaUI(page);

  // Step 2: Click the logout button (NavBarComponent desktop logout button).
  // Its visibility is the authenticated-state pin: it renders only inside
  // the authenticated shell — see the note beside NAV_LOGOUT_BUTTON in
  // helpers/navbar.js.
  const logoutButton = page.locator(NAV_LOGOUT_BUTTON);
  await expect(logoutButton, 'Logout button should be visible after login').toBeVisible({ timeout: 10000 });
  await logoutButton.click();

  // Step 3: Settle on the realm (helpers/keycloak-landing.js) — the logout
  // chain's endpoints only; 'dashboard' is not an outcome here, it matches
  // the no-navigation state a failed logout leaves the browser in.
  await waitForRealmAuthEndpoint(page);

  // Step 4: …and prove the landing (the form renders only while the realm
  // holds no live SSO session — a partial logout bounces straight back
  // into the app and never renders it).
  await expectKeycloakLoginForm(
    page,
    `Expected the Keycloak login form after logout (session cleared); the browser was last at: ${page.url()}`
  );

  await context.close();
});
