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

  test('the authorize dialog exposes the genie OIDC config', async ({ page }) => {
    await page.goto('/api-docs');
    await page.waitForLoadState('networkidle');

    // Click the Authorize button to open the authorization modal
    const authorizeBtn = page.locator('button.btn.authorize');
    await authorizeBtn.click();

    // Wait for the authorization modal/dialog to appear
    const authContainer = page.locator('.auth-container');
    await expect(authContainer, 'Authorization modal should open').toBeVisible();

    // Verify the dialog shows the Keycloak OAuth2 configuration
    // Swagger UI 5.x renders the authorization URL in a <label> or text, and
    // client_id as a labeled input field (not embedded in the URL text).
    const authContainerText = await authContainer.textContent();
    expect(authContainerText, 'Authorization dialog should reference the genie realm').toContain('realms/genie');
    expect(authContainerText, 'Authorization dialog should show client_id field').toContain('client_id');

    // The dialog PRE-FILLS the client_id from the page's initOAuth config —
    // the deployment contract's OIDC client (compose and realm both default
    // to genie-app), pinned exactly like the realm name above.
    await expect(
      authContainer.locator('input#client_id_authorizationCode'),
      'the dialog must pre-fill the deployed OIDC client id'
    ).toHaveValue('genie-app');

    // NOTE: this test pins the DECLARED contract only — the dialog and its
    // OIDC configuration. It does NOT run the authorize round-trip (Swagger →
    // Keycloak → code → token), and on the current k8s venue it cannot: the
    // backend serves the OAuth2 flow URLs from KEYCLOAK_URL, which the venue
    // points at the cluster-internal Keycloak address, so the browser cannot
    // reach them. The round-trip spec lands once the venue serves
    // browser-reachable URLs (#1889).
  });
});
