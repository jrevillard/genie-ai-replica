const { test, expect } = require('@playwright/test');

// Test D.7b — Full External IdP Login Flow
// Prerequisite: Phase D Steps 1-5 in epic1-keycloak-foundation.md
// (create external-idp realm, broker client, add IdP to genie realm)
// If the external IdP is not configured, this test fails with a clear assertion
// explaining the missing prerequisite — no silent skip.
// Source: e2e-test-plan-external-idp.md Phase D, Step 7b

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
    const idpLink = page.locator('#social-external-idp');
    await expect(idpLink, 'External IdP link must exist on login page. Run Phase D Steps 1-5 first.').toBeVisible({ timeout: 10000 });
    await idpLink.click();

    // Step 3: Should redirect to the external-idp realm login page
    await page.waitForURL('**/realms/external-idp/**', {
      timeout: 15000,
    });

    // Step 4: Login with external IdP credentials
    await page.fill('#username', 'external-test-user');
    await page.fill('#password', 'External123!');
    await page.click('#kc-login');

    // Step 5: Wait for the full broker redirect chain to complete
    // The flow is: external-idp -> broker exchange -> genie realm callback -> app dashboard
    // First wait until we reach /callback (the app processes the code exchange there)
    await page.waitForURL(
      (url) => {
        const urlStr = url.toString();
        return urlStr.includes('/callback') || urlStr.includes('/dashboard');
      },
      { timeout: 30000 },
    );

    // If we landed on /callback, wait for the Vue app to process the auth code
    // and redirect to the dashboard (the handleCallback action does the code exchange)
    const currentUrl = page.url();
    if (currentUrl.includes('/callback')) {
      // Wait for navigation away from /callback (to /dashboard or / on error)
      await page.waitForURL(
        (url) => !url.toString().includes('/callback'),
        { timeout: 30000 },
      );
    }

    // Step 6: Verify we are back on the app as an authenticated user
    const finalUrl = page.url();
    expect(
      finalUrl.includes('dashboard'),
      `Expected final URL to contain 'dashboard', got: ${finalUrl}. External IdP broker flow failed.`,
    ).toBeTruthy();

    // Step 7: Verify the token was issued by the genie realm (not the external IdP realm)
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 200));
    expect(
      bodyText.includes('GENIE.AI'),
      `Expected page body to contain 'GENIE.AI'. External IdP broker flow failed. Got: ${bodyText}`,
    ).toBeTruthy();

    // Step 8: Verify authenticated state — login button should not be visible
    const loginButton = page.locator('#kc-login');
    const isLoginVisible = await loginButton.isVisible().catch(() => false);
    expect(
      isLoginVisible,
      'Login button should not be visible after successful authentication',
    ).toBeFalsy();

    await context.close();
  } catch (error) {
    const errorUrl = page.url();
    const errorBody = await page
      .evaluate(() => document.body.innerText.substring(0, 500))
      .catch(() => 'N/A');

    await context.close();

    throw new Error(
      `External IdP login flow failed.\n` +
        `  Error: ${error.message}\n` +
        `  Final URL: ${errorUrl}\n` +
        `  Page body (first 500 chars): ${errorBody}\n` +
        `  Hint: Run Phase D Steps 1-5 in docs/e2e-tests/epic1-keycloak-foundation.md first`,
    );
  }
});
