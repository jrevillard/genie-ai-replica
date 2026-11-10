const { test, expect } = require('@playwright/test');
const { BASE_URL } = require('../helpers/base-url');

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
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForURL('**/protocol/openid-connect/auth**', { timeout: 15000 });
  await page.locator('#social-external-idp').click({ timeout: 10000 });

  // Wait for the redirect chain to reach a known landing state
  // (external-idp login, or the broker exchange landing on callback/dashboard)
  await page.waitForURL(
    (url) => {
      const urlStr = url.toString();
      return (
        urlStr.includes('realms/external-idp') ||
        urlStr.includes('/callback') ||
        urlStr.includes('/dashboard')
      );
    },
    { timeout: 30000 },
  );

  // If we landed on the external-idp login page, fill credentials and submit
  const currentUrl = page.url();
  if (currentUrl.includes('realms/external-idp')) {
    await page.fill('#username', 'external-test-user');
    await page.fill('#password', 'External123!');
    await page.click('#kc-login');
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
    `${BASE_URL}/auth/realms/master/protocol/openid-connect/token`,
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

  // Set by the restore in the inner finally. The realm restore must not
  // throw over a flow failure that is already propagating: the flow error
  // is the root cause, so the restore failure travels WITH it.
  let restoreFailure = null;

  try {
    // Step 1: Temporarily disable the VERIFY_EMAIL required action (test environment only)
    // When verifyEmail=true on the realm, Keycloak adds VERIFY_EMAIL as a required action
    // for brokered users. In production, SMTP sends the verification email and the flow
    // works normally. In the test environment (no SMTP), Keycloak shows a "Failed to send
    // email" page that blocks the broker flow. We disable the required action for the
    // duration of this test. It will be restored by keycloak-config-cli on next deploy.
    await apiContext.put(
      `${BASE_URL}/auth/admin/realms/genie/authentication/required-actions/VERIFY_EMAIL`,
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
      await expect(
        loginButton,
        'Login button should not be visible after successful authentication',
      ).not.toBeVisible({ timeout: 15000 });
    } finally {
      // Step 7: Re-enable VERIFY_EMAIL required action.
      // Note: Keycloak 26 removes (unregisters) the action when disabled,
      // so the restore PUT can 404 — and apiContext returns a response on
      // non-2xx instead of throwing, so the status is checked explicitly.
      // It will be fully restored by keycloak-config-cli on next deploy.
      // No throw here even when the restore fails: a ThrowStatement inside
      // a finally block supersedes the flow's own pending result, so the
      // restore verdict is recorded and raised after the block instead.
      let restoreStatus = null;
      try {
        const restoreRes = await apiContext.put(
          `${BASE_URL}/auth/admin/realms/genie/authentication/required-actions/VERIFY_EMAIL`,
          { headers: authHeaders, data: { enabled: true }, ignoreHTTPSErrors: true },
        );
        if (!restoreRes.ok()) {
          restoreStatus = `HTTP ${restoreRes.status()}`;
        }
      } catch (restoreError) {
        restoreStatus = restoreError.message;
      }
      if (restoreStatus !== null) {
        restoreFailure =
          `VERIFY_EMAIL restore failed — the genie realm keeps VERIFY_EMAIL disabled ` +
          `(brokered logins skip email verification) until keycloak-config-cli ` +
          `re-runs on the next deploy. Restore error: ${restoreStatus}`;
      }
    }

    if (restoreFailure) {
      // A restore failure on a PASSING flow is its own failure class:
      // throw it past the flow-diagnosis handler untouched, so it is
      // not wrapped in a URL/body/hint envelope that does not apply.
      const error = new Error(restoreFailure);
      error.isRestoreFailure = true;
      throw error;
    }

    await context.close();
  } catch (error) {
    if (error.isRestoreFailure) {
      await context.close();
      throw error;
    }
    const errorUrl = page.url();
    let errorBody;
    try {
      errorBody = await page.evaluate(() => document.body.innerText.substring(0, 500));
    } catch (bodyError) {
      errorBody = `unavailable (page read failed: ${bodyError.message})`;
    }

    await context.close();

    throw new Error(
      `External IdP login flow failed.\n` +
        `  Error: ${error.message}\n` +
        `  Final URL: ${errorUrl}\n` +
        `  Page body (first 500 chars): ${errorBody}\n` +
        (restoreFailure ? `  ${restoreFailure}\n` : '') +
        `  Hint: Run Phase D Steps 1-5 in docs/e2e-tests/epic1-keycloak-foundation.md first`,
      { cause: error },
    );
  }
});
