const { test, expect } = require('@playwright/test');

// Test D.7b — Full External IdP Login Flow
// Complete brokered authentication: app -> genie realm -> external-idp realm -> back to app.
// This test uses a second Keycloak realm as a mock external IdP.
// Source: e2e-test-plan-external-idp.md Phase D, Step 7b

// Skip condition: if no external IdP is configured (no EXTERNAL_IDP_ENABLED),
// this test is skipped. The external IdP realm and broker must be set up first
// (Phase D, Steps 1-2 in the test plan).
test.describe('External IdP login flow', () => {
  test.skip(({ browser }, testInfo) => {
    // Skip if external IdP is not configured
    const enabled = process.env.EXTERNAL_IDP_ENABLED;
    return !enabled || enabled === '0' || enabled === 'false';
  }, 'External IdP not configured (set EXTERNAL_IDP_ENABLED=1 to run)');

  test('completes full external IdP brokered login flow', async ({ browser }) => {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      bypassCSP: true,
    });
    const page = await context.newPage();

    try {
      // Step 1: Navigate to app root — redirects to Keycloak (genie realm) login
      await page.goto('https://localhost/', {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      await page.waitForURL('**/protocol/openid-connect/auth**', {
        timeout: 15000,
      });

      // Step 2: Click the External IdP link on the Keycloak login page
      await page.click('a:has-text("External IdP")');

      // Step 3: Should redirect to the external-idp realm login page
      await page.waitForURL('**/realms/external-idp/**', {
        timeout: 15000,
      });

      // Step 4: Login with external IdP credentials
      // NOTE: These are different from the main test user credentials
      await page.fill('#username', 'external-test-user');
      await page.fill('#password', 'External123!');
      await page.click('#kc-login');

      // Step 5: Wait for the full broker redirect chain to complete
      // The flow is: external-idp -> broker exchange -> genie realm callback -> app dashboard
      await page.waitForURL(
        (url) => {
          const urlStr = url.toString();
          return urlStr.includes('/callback') || urlStr.includes('/dashboard');
        },
        { timeout: 30000 },
      );

      // Wait for the SPA to settle after OIDC callback
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 });

      // Step 6: Verify we are back on the app as an authenticated user
      const finalUrl = page.url();
      await expect(
        finalUrl.includes('dashboard'),
        `Expected final URL to contain 'dashboard', got: ${finalUrl}`,
      ).toBeTruthy();

      // Step 7: Verify the token was issued by the genie realm (not the external IdP realm)
      // The final token must be from the genie realm because Keycloak's broker
      // exchanges the external token and re-issues one from the home realm.
      // We check this by verifying the app shows user info (which comes from
      // the backend's /api/auth/me using the genie realm token).
      const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 200));
      await expect(
        bodyText.includes('GENIE.AI'),
        `Expected page body to contain 'GENIE.AI', got: ${bodyText}`,
      ).toBeTruthy();

      // Step 8: Verify authenticated state by checking the page does not show
      // login elements (confirming the OIDC flow completed successfully)
      const loginButton = page.locator('#kc-login');
      const isLoginVisible = await loginButton.isVisible().catch(() => false);
      await expect(
        isLoginVisible,
        'Login button should not be visible after successful authentication',
      ).toBeFalsy();

      await context.close();
    } catch (error) {
      // On failure, capture the current page state for debugging
      const errorUrl = page.url();
      const errorBody = await page
        .evaluate(() => document.body.innerText.substring(0, 500))
        .catch(() => 'N/A');

      // Close context before throwing so resources are cleaned up
      await context.close();

      // Re-throw with diagnostic information
      throw new Error(
        `External IdP login flow failed.\n` +
          `  Error: ${error.message}\n` +
          `  Final URL: ${errorUrl}\n` +
          `  Page body (first 500 chars): ${errorBody}`,
      );
    }
  });
});
