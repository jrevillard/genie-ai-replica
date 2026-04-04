const { test, expect } = require('@playwright/test');

test.describe('Swagger UI OAuth2', () => {
  test.use({ ignoreHTTPSErrors: true });

  test('Swagger spec contains OAuth2 security scheme', async ({ request }) => {
    const response = await request.get('/api-docs.json');
    expect(response.ok(), 'GET /api-docs.json should succeed').toBeTruthy();

    const spec = await response.json();

    const securitySchemes = spec.components?.securitySchemes;
    expect(securitySchemes, 'components.securitySchemes should exist').toBeDefined();

    const keycloakScheme = securitySchemes.KeycloakOAuth2;
    expect(keycloakScheme, 'KeycloakOAuth2 security scheme should exist').toBeDefined();
    expect(keycloakScheme.type).toBe('oauth2');
    expect(keycloakScheme.flows, 'securitySchemes.KeycloakOAuth2.flows should exist').toBeDefined();
    expect(keycloakScheme.flows.authorizationCode, 'Authorization Code flow should be configured').toBeDefined();
    expect(keycloakScheme.flows.authorizationCode.authorizationUrl).toContain('/protocol/openid-connect/auth');
    expect(keycloakScheme.flows.authorizationCode.scopes).toHaveProperty('openid');
    expect(keycloakScheme.flows.authorizationCode.scopes).toHaveProperty('profile');
  });

  test('Swagger UI loads with Authorize button', async ({ page }) => {
    await page.goto('/api-docs');
    await page.waitForLoadState('networkidle');

    // Verify Swagger UI loaded (title contains "Swagger" or similar)
    const title = await page.title();
    expect(title.toLowerCase()).toContain('swagger');

    // Verify the authorize button exists
    const authorizeBtn = page.locator('button.btn.authorize');
    await expect(authorizeBtn, 'Authorize button should be visible').toBeVisible();
  });

  test('Swagger UI OAuth2 authorization flow', async ({ page }) => {
    await page.goto('/api-docs');
    await page.waitForLoadState('networkidle');

    // Click the Authorize button to open the authorization modal
    const authorizeBtn = page.locator('button.btn.authorize');
    await authorizeBtn.click();

    // Wait for the authorization modal/dialog to appear
    const authContainer = page.locator('.auth-container');
    await expect(authContainer, 'Authorization modal should open').toBeVisible();

    // Verify the dialog shows the Keycloak OAuth2 authorization link
    const keycloakLink = page.locator('a[href*="protocol/openid-connect/auth"]');
    await expect(keycloakLink, 'Keycloak OAuth2 authorization link should be visible').toBeVisible();

    // Verify the link targets the correct realm and client
    const href = await keycloakLink.getAttribute('href');
    expect(href, 'Authorization URL should target the genie realm').toContain('realms/genie');
    expect(href, 'Authorization URL should use the genie-app client').toContain('client_id=genie-app');

    // NOTE: Do NOT actually complete the login flow here.
    // The full OAuth2 redirect through Keycloak is tested separately.
    // This test only validates that the Authorize button opens the
    // correct dialog with the expected Keycloak OIDC configuration.
  });
});
