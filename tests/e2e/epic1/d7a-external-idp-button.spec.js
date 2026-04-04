const { test, expect } = require('@playwright/test');

// Test D.7a — External IdP Button Visible on Login Page
// Verifies that when an external IdP is configured in the genie realm,
// the Keycloak login page shows the external IdP login button/link.
// Source: e2e-test-plan-external-idp.md Phase D, Step 7a

test.skip(({ browser }) => {
  const enabled = process.env.EXTERNAL_IDP_ENABLED;
  return !enabled || enabled === '0' || enabled === 'false';
}, 'External IdP not configured (set EXTERNAL_IDP_ENABLED=1 to run)');

test('external IdP button is visible on Keycloak login page', async ({ browser }) => {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    bypassCSP: true,
  });
  const page = await context.newPage();

  // Navigate to app root — will redirect to Keycloak login
  await page.goto('https://localhost/', {
    waitUntil: 'networkidle',
    timeout: 30000,
  });

  // Wait for Keycloak login page
  await page.waitForURL('**/protocol/openid-connect/auth**', {
    timeout: 15000,
  });

  // Wait for Keycloak login page to fully render (social providers section loads after form)
  await page.waitForSelector('#kc-login', { state: 'visible', timeout: 10000 });

  // Extract all links from the login page to find the external IdP button
  const links = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a')).map((a) => ({
      text: a.textContent.trim(),
      href: a.href,
    })),
  );

  // Look for the external IdP link by display text
  const hasExternalIdpLink = links.some((l) => l.text.includes('External IdP'));

  await expect(
    hasExternalIdpLink,
    `Expected to find an 'External IdP' link on the login page. Found links: ${JSON.stringify(links)}`,
  ).toBeTruthy();

  // Also verify the social login link element exists (Keycloak uses id="social-external-idp")
  const socialLink = page.locator('#social-external-idp');
  await expect(socialLink).toBeVisible({ timeout: 5000 });

  // Verify the link points to the broker endpoint
  const socialLinkHref = await socialLink.getAttribute('href');
  await expect(
    socialLinkHref.includes('broker/external-idp/login'),
    `Expected broker URL to contain 'broker/external-idp/login', got: ${socialLinkHref}`,
  ).toBeTruthy();

  await context.close();
});
