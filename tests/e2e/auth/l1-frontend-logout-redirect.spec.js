const { test, expect } = require('@playwright/test');
const { loginViaUI, LOGIN_BUDGET_TIMEOUT_MS } = require('../helpers/chatbot');
const { NAV_LOGOUT_BUTTON } = require('../helpers/navbar');

// Test L.1 — Frontend Logout Redirect
// Complete logout flow: login (through loginViaUI — the suite's one login
// path, #1854), click logout button, verify redirect to Keycloak login page.
// Source: docs/e2e-tests/suite-map.md § The acceptance phases, Phase L

test('clicks logout button and redirects to Keycloak login page', async ({ browser }) => {
  // loginViaUI's worst case is past the project default (#1798); the
  // constant owns that derivation.
  test.setTimeout(LOGIN_BUDGET_TIMEOUT_MS);
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    bypassCSP: true,
  });
  const page = await context.newPage();

  // Step 1: Log in through the browser — the Keycloak redirect flow is
  // the helper's (retry-once budget included), not this spec's subject.
  await loginViaUI(page);

  // Step 2: Verify authenticated state — app content should be visible
  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 200));
  await expect(
    bodyText.includes('GENIE.AI'),
    `Expected page body to contain 'GENIE.AI', got: ${bodyText}`,
  ).toBeTruthy();

  // Step 3: Click the logout button (NavBarComponent desktop logout button)
  const logoutButton = page.locator(NAV_LOGOUT_BUTTON);
  await expect(logoutButton, 'Logout button should be visible after login').toBeVisible({ timeout: 10000 });
  await logoutButton.click();

  // Step 4: Wait for redirect to Keycloak — either the logout endpoint
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
