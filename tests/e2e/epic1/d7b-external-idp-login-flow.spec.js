const { test, expect } = require('@playwright/test');

// Test D.7b — Full External IdP Login Flow
// Prerequisite: Phase D Steps 1-5 in epic1-keycloak-foundation.md
// (create external-idp realm, broker client, add IdP to genie realm)
// If the external IdP is not configured, this test fails with a clear assertion
// explaining the missing prerequisite — no silent skip.
// Source: e2e-test-plan-external-idp.md Phase D, Step 7b

/**
 * Performs the full External IdP broker login: navigate to app, click IdP link,
 * login at external IdP (if login page is shown), and wait for the broker
 * redirect chain to settle.
 */
async function brokerLogin(page) {
  await page.goto('https://localhost/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForURL('**/protocol/openid-connect/auth**', { timeout: 15000 });
  await page.locator('#social-external-idp').click({ timeout: 10000 });

  // Wait for the redirect chain to settle (may land on external-idp login,
  // VERIFY_EMAIL required action, or directly on callback/dashboard)
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

  // If we landed on the external-idp login page, fill credentials and submit
  const currentUrl = page.url();
  if (currentUrl.includes('realms/external-idp')) {
    await page.fill('#username', 'external-test-user');
    await page.fill('#password', 'External123!');
    await page.click('#kc-login');
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  }
}

test('completes full external IdP brokered login flow', async ({ browser }) => {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    bypassCSP: true,
  });
  const page = await context.newPage();
  const apiContext = context.request;

  // Get admin token for realm configuration changes
  const adminTokenRes = await apiContext.post(
    'https://localhost/auth/realms/master/protocol/openid-connect/token',
    {
      data: new URLSearchParams({
        client_id: 'admin-cli',
        username: 'admin',
        password: process.env.KEYCLOAK_ADMIN_PASSWORD,
        grant_type: 'password',
      }),
      ignoreHTTPSErrors: true,
    },
  );
  const adminToken = (await adminTokenRes.json()).access_token;
  const authHeaders = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };

  try {
    // Step 1: Temporarily disable the VERIFY_EMAIL required action (test environment only)
    // When verifyEmail=true on the realm, Keycloak adds VERIFY_EMAIL as a required action
    // for brokered users. In production, SMTP sends the verification email and the flow
    // works normally. In the test environment (no SMTP), Keycloak shows a "Failed to send
    // email" page that blocks the broker flow. We disable the required action for the
    // duration of this test. It will be restored by keycloak-config-cli on next deploy.
    await apiContext.put(
      'https://localhost/auth/admin/realms/genie/authentication/required-actions/VERIFY_EMAIL',
      { headers: authHeaders, data: { enabled: false }, ignoreHTTPSErrors: true },
    );

    try {
      // Step 2: Perform broker login (no VERIFY_EMAIL will be triggered)
      await brokerLogin(page);

      // Step 3: Wait for the full broker redirect chain to complete
      // The flow is: external-idp -> broker exchange -> genie realm callback -> app dashboard
      await page.waitForURL(
        (url) => {
          const urlStr = url.toString();
          return urlStr.includes('/callback') || urlStr.includes('/dashboard');
        },
        { timeout: 30000 },
      );

      // If we landed on /callback, wait for the Vue app to process the auth code
      // and redirect to the dashboard (the handleCallback action does the code exchange)
      if (page.url().includes('/callback')) {
        await page.waitForURL(
          (url) => !url.toString().includes('/callback'),
          { timeout: 30000 },
        );
      }

      // Step 4: Verify we are back on the app as an authenticated user
      const finalUrl = page.url();
      expect(
        finalUrl.includes('dashboard'),
        `Expected final URL to contain 'dashboard', got: ${finalUrl}. External IdP broker flow failed.`,
      ).toBeTruthy();

      // Step 5: Verify the token was issued by the genie realm (not the external IdP realm)
      const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 200));
      expect(
        bodyText.includes('GENIE.AI'),
        `Expected page body to contain 'GENIE.AI'. External IdP broker flow failed. Got: ${bodyText}`,
      ).toBeTruthy();

      // Step 6: Verify authenticated state — login button should not be visible
      const loginButton = page.locator('#kc-login');
      const isLoginVisible = await loginButton.isVisible().catch(() => false);
      expect(
        isLoginVisible,
        'Login button should not be visible after successful authentication',
      ).toBeFalsy();
    } finally {
      // Step 7: Re-enable VERIFY_EMAIL required action (best effort)
      // Note: Keycloak 26 removes (unregisters) the action when disabled.
      // It will be fully restored by keycloak-config-cli on next deploy.
      await apiContext.put(
        'https://localhost/auth/admin/realms/genie/authentication/required-actions/VERIFY_EMAIL',
        { headers: authHeaders, data: { enabled: true }, ignoreHTTPSErrors: true },
      ).catch(() => {});
    }

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
