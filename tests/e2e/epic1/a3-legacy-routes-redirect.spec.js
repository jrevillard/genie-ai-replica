const { test, expect } = require('@playwright/test');

// Test A.3 — Legacy Routes Redirect
// Verifies that legacy auth routes (/login, /register, /forgot-password)
// are handled gracefully. These routes were removed in Story 1-11.
// They should redirect to Keycloak (same as any protected route) or show a 404.
// Source: e2e-test-plan-external-idp.md Phase A.3

const LEGACY_ROUTES = ['/login', '/register', '/forgot-password'];

for (const path of LEGACY_ROUTES) {
  test(`legacy route ${path} redirects to Keycloak login`, async ({ browser }) => {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      bypassCSP: true,
    });
    const page = await context.newPage();

    await page.goto(`https://localhost${path}`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    // Wait for any client-side redirects to settle
    await page.waitForURL(
      (url) => {
        const urlStr = url.toString();
        return (
          urlStr.includes('/auth/realms/genie/') ||
          urlStr.includes('dashboard') ||
          urlStr === 'https://localhost/' ||
          urlStr === 'https://localhost'
        );
      },
      { timeout: 15000 },
    ); // If no redirect happens, the assertion below will catch it

    const currentUrl = page.url();

    // The SPA handles routing client-side. Legacy auth routes no longer exist
    // as pages, so the OIDC layer should trigger a redirect to Keycloak.
    // Verify the app does not crash and we end up on a valid page.
    const redirectedToKeycloak = currentUrl.includes('/auth/realms/genie/');
    const onAppRoot = currentUrl === 'https://localhost/' || currentUrl === 'https://localhost';
    const onDashboard = currentUrl.includes('dashboard');

    // At minimum, the app must not crash. Acceptable outcomes:
    // 1. Redirected to Keycloak login (most likely — OIDC intercept triggers)
    // 2. Redirected back to app root or dashboard (if OIDC catches the route)
    const isValidOutcome = redirectedToKeycloak || onAppRoot || onDashboard;

    await expect(
      isValidOutcome,
      `Expected ${path} to redirect to Keycloak, app root, or dashboard, got: ${currentUrl}`,
    ).toBeTruthy();

    // Verify the page is not an error/crash page by checking for basic content
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 100));
    await expect(
      bodyText.length > 0,
      'Expected non-empty page body (app should not crash)',
    ).toBeTruthy();

    await context.close();
  });
}
