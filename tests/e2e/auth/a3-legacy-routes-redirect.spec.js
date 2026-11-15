const { test, expect } = require('@playwright/test');
const { BASE_URL } = require('../helpers/base-url');

// Test A.3 — Legacy Routes Redirect
// Verifies that legacy auth routes (/login, /register, /forgot-password)
// are handled deterministically. These routes were removed in Story 1-11:
// the router's catch-all redirects them to /dashboard, and the navigation
// guard — /dashboard requires authentication — sends the unauthenticated
// visitor to the Keycloak auth endpoint. A fresh browser context carries no
// SSO session, so that login page IS the one expected landing; the suite's
// determinism contract (tests/e2e/CLAUDE.md) forbids accepting it as one
// outcome among three.
// Source: e2e-test-plan-external-idp.md Phase A.3

const LEGACY_ROUTES = ['/login', '/register', '/forgot-password'];

for (const path of LEGACY_ROUTES) {
  test(`legacy route ${path} redirects to the Keycloak login page`, async ({ browser }) => {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      bypassCSP: true,
    });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}${path}`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    // The OIDC login redirect is the fixed outcome: SPA catch-all ->
    // /dashboard -> navigation guard -> Keycloak auth endpoint. Assert that
    // exact endpoint — no alternative landing is accepted, so a routing
    // regression that parks a legacy route anywhere else fails here.
    await page.waitForURL('**/protocol/openid-connect/auth**', {
      timeout: 15000,
    });

    // The login form is the landing proof (the L3 form proof,
    // l3-vuex-state-cleared.spec.js): it renders only while the realm holds
    // no live SSO session for this browser, so it pins both the destination
    // and the unauthenticated state the redirect exists to produce. It also
    // replaces the old body-length probe — an nginx 404 page is non-empty
    // too, so text presence proves nothing.
    await expect(
      page.locator('#username'),
      `Expected the Keycloak login form after visiting ${path}; the browser was last at: ${page.url()}`,
    ).toBeVisible({ timeout: 15000 });

    await context.close();
  });
}
