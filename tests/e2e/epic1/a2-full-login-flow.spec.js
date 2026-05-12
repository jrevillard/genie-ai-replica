const { test, expect } = require('@playwright/test');

// Test A.2 — Full Login Flow
// Complete login flow: navigate to app, get redirected to Keycloak,
// fill credentials, submit, and verify authenticated state in the app.
// Source: e2e-test-plan-external-idp.md Phase A.2

test('completes full login flow from app to Keycloak and back', async ({ browser }) => {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    bypassCSP: true,
  });
  const page = await context.newPage();

  // Step 1: Navigate to app root — should redirect to Keycloak
  await page.goto('https://localhost/', {
    waitUntil: 'networkidle',
    timeout: 30000,
  });

  // Step 2: Wait for Keycloak login page
  await page.waitForURL('**/protocol/openid-connect/auth**', {
    timeout: 15000,
  });

  // Verify we are on the Keycloak login page
  const loginUrl = page.url();
  await expect(
    loginUrl.includes('/auth/realms/genie/'),
    `Expected Keycloak login URL, got: ${loginUrl}`,
  ).toBeTruthy();

  // Step 3: Fill credentials and submit
  await page.fill('#username', 'testuser');
  await page.fill('#password', 'TestPass123!');
  await page.click('#kc-login');

  // Step 4: Wait for redirect back to the app
  await page.waitForURL('https://localhost/**', {
    timeout: 30000,
  });

  // Step 5: Verify authenticated state — wait for navigation to settle
  await page.waitForURL(
    (url) => {
      const urlStr = url.toString();
      return urlStr.includes('dashboard') || urlStr === 'https://localhost/';
    },
    { timeout: 30000 },
  );

  const finalUrl = page.url();
  await expect(
    finalUrl.includes('dashboard'),
    `Expected URL to contain 'dashboard', got: ${finalUrl}`,
  ).toBeTruthy();

  // Verify the page body contains the app content (not a login page)
  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 200));
  await expect(
    bodyText.includes('GENIE.AI'),
    `Expected page body to contain 'GENIE.AI', got: ${bodyText}`,
  ).toBeTruthy();

  await context.close();
});
