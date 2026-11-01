const { test, expect } = require('@playwright/test');
const { loginViaUI, BASE_URL, TEST_ADMIN_USER } = require('../helpers/chatbot');

/**
 * Admin logs view: the Logs tab drives /api/admin/logs/summary (the
 * VL-backed roll-up) and renders the rows it returns.
 *
 * The roll-up payload is injected by route interception, the same
 * measure-don't-look rule as data-wiring.spec.js: rows on screen that
 * carry the injected type/service/count can only have come from the API
 * response. The search dialog (a second VL read path) is out of scope
 * here — the roll-up table is the tab's own surface.
 */
test.describe('Admin logs view', () => {
  test.setTimeout(120000);

  /**
   * Login, install the summary interception, open /admin.
   * The overview mount never calls the logs endpoints — the summary is
   * fetched when the Logs tab activates (loadDataForTab('logs')), so the
   * interception is in place before the click that triggers it.
   */
  async function loginAdminWithSummary(page, summaryPayload) {
    await loginViaUI(page, TEST_ADMIN_USER);
    await page.route('**/api/admin/logs/summary*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            errors: summaryPayload.errors,
            warnings: summaryPayload.warnings,
            services: [],
            date: new Date().toISOString().split('T')[0],
            degraded: false,
          },
        }),
      }),
    );
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });
    // The DsTabs control renders the tab as a button (the sidebar nav
    // entries are links, so the role separates the two).
    await page.getByRole('button', { name: 'Logs' }).click();
  }

  test('warning rows render from the logs summary payload', async ({ page }) => {
    await loginAdminWithSummary(page, {
      errors: [],
      warnings: [
        { type: 'auth', service: 'wired-keycloak', count: 3 },
        { type: 'database', service: 'wired-arangodb', count: 7 },
      ],
    });

    const keycloakRow = page.locator('.log-summary-table tr', { hasText: 'wired-keycloak' });
    await expect(keycloakRow).toBeVisible();
    await expect(keycloakRow.locator('.log-count')).toHaveText('3');

    const arangoRow = page.locator('.log-summary-table tr', { hasText: 'wired-arangodb' });
    await expect(arangoRow).toBeVisible();
    await expect(arangoRow.locator('.log-count')).toHaveText('7');
  });

  test('an empty summary renders the explicit empty row', async ({ page }) => {
    await loginAdminWithSummary(page, { errors: [], warnings: [] });

    await expect(page.locator('.log-summary-table .empty-logs')).toBeVisible();
    await expect(page.locator('.log-summary-table .log-count')).toHaveCount(0);
  });
});
