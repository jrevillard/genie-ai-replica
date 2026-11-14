const { test, expect } = require('@playwright/test');
const { BASE_URL } = require('../helpers/base-url');
const { getAdminToken } = require('../helpers/auth');
const { hasIdentityProvider, missingIdentityProviderReason, skipUnlessVenue } = require('../helpers/venue-profile');

const REALM = process.env.KEYCLOAK_REALM || 'genie';

// Test D.7b — Full External IdP Login Flow
// Prerequisite: Phase D Steps 1-5 (docs/e2e-tests/suite-map.md § The acceptance phases)
// (create external-idp realm, broker client, add IdP to genie realm)
// If the external IdP is not configured, this test SKIPS WITH A REASON that
// names the missing prerequisite — never a silent skip, and never a failure
// looking for a surface the venue does not render (#1742).
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
      return urlStr.includes('realms/external-idp') || urlStr.includes('/callback') || urlStr.includes('/dashboard');
    },
    { timeout: 30000 }
  );

  // If we landed on the external-idp login page, fill credentials and submit
  const currentUrl = page.url();
  if (currentUrl.includes('realms/external-idp')) {
    await page.fill('#username', 'external-test-user');
    await page.fill('#password', 'External123!');
    await page.click('#kc-login');
  }
}

// The venue profile decides: the brokered login is an external-IdP
// surface, and a deployment without a brokered identity provider does not
// answer it — the spec SKIPS WITH A REASON instead (#1742). The wiring is
// the shared registrar's (#1773), stated once.
test.beforeEach(
  skipUnlessVenue(
    test,
    () => hasIdentityProvider(REALM),
    () => missingIdentityProviderReason(REALM)
  )
);

test('completes full external IdP brokered login flow', async ({ browser }) => {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    bypassCSP: true
  });
  const page = await context.newPage();
  const apiContext = context.request;

  // Set by the restore in the inner finally. The realm restore must not
  // throw over a flow failure that is already propagating: the flow error
  // is the root cause, so the restore failure travels WITH it.
  let restoreFailure = null;

  // A verdict's response-body excerpt, stated once: a non-JSON body (a
  // proxy error page) reads as its own failure, never as a crash.
  const bodyOf = async (res) => {
    try {
      return JSON.stringify(await res.json()).substring(0, 300);
    } catch (bodyError) {
      return `unavailable (read failed: ${bodyError.message})`;
    }
  };

  // The mint sits INSIDE the try: a failure here must close the browser
  // context through the catch below — a mint throw before the try leaked
  // the context with its authenticated Keycloak session.
  try {
    // Get admin token for realm configuration changes — through the ONE
    // owner of the mint (helpers/auth.js getAdminToken): the form-body
    // serialization, the status verdict, the ADMIN_TOKEN env precedence
    // and the no-access_token verdict are its contract, and its failures
    // already name the cause (a wrong password surfaces as
    // "Failed to get admin token: 400 ..."). An unchecked mint surfaces
    // those as a confusing downstream error — a `Bearer undefined` header
    // on every later call (#1713).
    let adminToken;
    try {
      adminToken = await getAdminToken();
    } catch (mintError) {
      mintError.isPassThrough = true;
      throw mintError;
    }
    const authHeaders = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };

    // Step 1: Temporarily disable the VERIFY_EMAIL required action (test environment only)
    // When verifyEmail=true on the realm, Keycloak adds VERIFY_EMAIL as a required action
    // for brokered users. In production, SMTP sends the verification email and the flow
    // works normally. In the test environment (no SMTP), Keycloak shows a "Failed to send
    // email" page that blocks the broker flow. We disable the required action for the
    // duration of this test.
    //
    // Keycloak 26.8's PUT on a required action does NOT merge the body with
    // the stored row: a partial body (`{enabled: false}` alone) rewrites the
    // row with the omitted fields nulled, so the action's alias disappears
    // and every later read 404s — the row is silently destroyed, and the
    // realm files declare no requiredActions, so keycloak-config-cli never
    // re-creates it. Every mutation here therefore PUTs the FULL
    // representation, read from the venue moments before: disable writes
    // back the observed row with enabled=false, the restore writes the
    // observed row back verbatim, and the restore READS THE STATE BACK
    // rather than assuming the PUT converged. Nothing here delegates to a
    // deploy.
    //
    // The MUTATE side carries the same verdict discipline as the restore side
    // (#1713): apiContext returns a response on non-2xx instead of throwing, so
    // the status is checked explicitly. The READ is a venue probe: an unreadable
    // venue is UNKNOWN, which is not the same as "the action is absent" — it
    // fails loudly with the status. An action the realm carries DISABLED, or
    // does not carry at all, already satisfies the precondition (no verification
    // page will appear), so no disable — and no restore — is owed. A disable
    // that fails means nothing was mutated, so it throws BEFORE the flow starts.
    const requiredActionUrl = `${BASE_URL}/auth/admin/realms/genie/authentication/required-actions/VERIFY_EMAIL`;
    const readRes = await apiContext.get(requiredActionUrl, { headers: authHeaders, ignoreHTTPSErrors: true });
    if (!readRes.ok() && readRes.status() !== 404) {
      const error = new Error(
        `VERIFY_EMAIL pre-test read failed — the venue state is UNKNOWN, which is not the ` +
          `same as "the action is absent". HTTP ${readRes.status()}. Body: ${await bodyOf(readRes)}.`
      );
      error.isPassThrough = true;
      throw error;
    }
    const preTestAction = readRes.status() === 404 ? null : await readRes.json();
    let disabledHere = false;
    if (preTestAction && preTestAction.enabled) {
      const disableRes = await apiContext.put(
        requiredActionUrl,
        { headers: authHeaders, data: { ...preTestAction, enabled: false }, ignoreHTTPSErrors: true }
      );
      if (!disableRes.ok()) {
        const error = new Error(
          `VERIFY_EMAIL disable failed — the required action stays ENABLED and the ` +
            `brokered login below would fail on the email-verification page instead of ` +
            `the flow under test, a cause the flow-failure envelope cannot name. ` +
            `Nothing was mutated, so no restore is owed. HTTP ${disableRes.status()}. ` +
            `Body: ${await bodyOf(disableRes)}.`
        );
        error.isPassThrough = true;
        throw error;
      }
      disabledHere = true;
    }

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
        { timeout: 30000 }
      );

      // If we landed on /callback, wait for the Vue app to process the auth code
      // and redirect to the dashboard (the handleCallback action does the code exchange)
      if (page.url().includes('/callback')) {
        await page.waitForURL((url) => !url.toString().includes('/callback'), { timeout: 30000 });
      }

      // Step 4: Verify we are back on the app as an authenticated user
      const finalUrl = page.url();
      expect(
        finalUrl.includes('dashboard'),
        `Expected final URL to contain 'dashboard', got: ${finalUrl}. External IdP broker flow failed.`
      ).toBeTruthy();

      // Step 5: Verify the token was issued by the genie realm (not the external IdP realm)
      const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 200));
      expect(
        bodyText.includes('GENIE.AI'),
        `Expected page body to contain 'GENIE.AI'. External IdP broker flow failed. Got: ${bodyText}`
      ).toBeTruthy();

      // Step 6: Verify authenticated state — login button should not be visible
      const loginButton = page.locator('#kc-login');
      await expect(loginButton, 'Login button should not be visible after successful authentication').not.toBeVisible({
        timeout: 15000
      });
    } finally {
      // Step 7: Converge VERIFY_EMAIL back to the pre-test state this spec
      // read. Only a disable THIS test performed is owed a restore: an
      // action the realm carried disabled, or carried not at all, is
      // already the state the realm keeps. The PUT carries the FULL
      // pre-test representation verbatim (see the mutate-side note: a
      // partial body nulls the omitted fields), and the converged state is
      // READ BACK — a restore that merely fires a PUT and moves on can
      // leave the row destroyed while reporting success. No throw here
      // even when the restore fails: a ThrowStatement inside a finally
      // block supersedes the flow's own pending result, so the restore
      // verdict is recorded and raised after the block instead.
      if (disabledHere) {
        let restoreStatus = null;
        try {
          const restoreRes = await apiContext.put(
            requiredActionUrl,
            { headers: authHeaders, data: preTestAction, ignoreHTTPSErrors: true }
          );
          if (!restoreRes.ok()) {
            restoreStatus = `HTTP ${restoreRes.status()}`;
          }
          if (restoreStatus === null) {
            const verifyRes = await apiContext.get(requiredActionUrl, { headers: authHeaders, ignoreHTTPSErrors: true });
            const state = verifyRes.ok() ? await verifyRes.json() : null;
            if (!state || state.enabled !== preTestAction.enabled) {
              restoreStatus = `the realm reports ${JSON.stringify(state)} after the restore`;
            }
          }
        } catch (restoreError) {
          restoreStatus = restoreError.message;
        }
        if (restoreStatus !== null) {
          restoreFailure =
            `VERIFY_EMAIL restore failed — the genie realm does not carry VERIFY_EMAIL in its ` +
            `pre-test state (registered=${Boolean(preTestAction)}, enabled=${Boolean(preTestAction && preTestAction.enabled)}), ` +
            `so brokered users keep skipping email verification. Restore error: ${restoreStatus}`;
        }
      }
    }

    if (restoreFailure) {
      // A restore failure on a PASSING flow is its own failure class:
      // throw it past the flow-diagnosis handler untouched, so it is
      // not wrapped in a URL/body/hint envelope that does not apply.
      const error = new Error(restoreFailure);
      error.isPassThrough = true;
      throw error;
    }

    await context.close();
  } catch (error) {
    if (error.isPassThrough) {
      // One pass-through for all three verdict classes (mint, disable,
      // restore): each message names its own real cause, and the flow
      // envelope's URL/body/hint does not apply to it — the mint and
      // disable run before the flow, and the page was never the subject.
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
        `  Hint: Run Phase D Steps 1-5 (docs/e2e-tests/suite-map.md § The acceptance phases) first`,
      { cause: error }
    );
  }
});
