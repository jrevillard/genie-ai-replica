const { test } = require('@playwright/test');
const { BASE_URL } = require('../helpers/base-url');
const {
  KEYCLOAK_AUTH_ENDPOINT_GLOB,
  expectKeycloakLoginForm,
} = require('../helpers/keycloak-landing');

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

    // The exact auth endpoint is the fixed landing — a routing regression
    // that parks a legacy route anywhere else fails here (the chain that
    // produces it is narrated in this file's header).
    await page.waitForURL(KEYCLOAK_AUTH_ENDPOINT_GLOB, {
      timeout: 15000,
    });

    // The login form is the landing proof (helpers/keycloak-landing.js):
    // it renders only while the realm holds no live SSO session for this
    // browser, so it pins both the destination and the unauthenticated
    // state the redirect exists to produce.
    await expectKeycloakLoginForm(
      page,
      `Expected the Keycloak login form after visiting ${path}; the browser was last at: ${page.url()}`,
    );

    await context.close();
  });
}
