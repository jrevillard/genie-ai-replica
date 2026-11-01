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
    // Counter guards the assertions below against a vacuous pass: the
    // empty-summary row renders whenever the component state is empty,
    // so the tests must prove the summary call actually happened.
    page._summaryCalls = 0;
    await page.route('**/api/admin/logs/summary*', (route) => {
      page._summaryCalls++;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        // The wire contract is FLAT — LogsService returns
        // {errors, warnings, services, date, degraded} at the top level
        // and the component reads response.data.errors off the axios
        // envelope. A {data: ...} wrapper here would take the invalid-
        // structure branch and zero both summaries.
        body: JSON.stringify({
          errors: summaryPayload.errors,
          warnings: summaryPayload.warnings,
          services: [],
          date: new Date().toISOString().split('T')[0],
          degraded: false,
        }),
      });
    });
    // The Logs tab also fires the raw /api/admin/logs read; mock it so
    // the spec stays isolated from the VictoriaLogs-backed query path.
    await page.route('**/api/admin/logs?*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ logs: [], total: 0, limit: 20, offset: 0 }),
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
    expect(page._summaryCalls).toBeGreaterThanOrEqual(1);
  });

  test('an empty summary renders the explicit empty row', async ({ page }) => {
    await loginAdminWithSummary(page, { errors: [], warnings: [] });

    // Both roll-up tables render their own empty row; scope to the
    // warnings card (the table this spec's payload drives).
    const warningsCard = page.locator('.logs-summary', { hasText: 'Warning Logs' });
    await expect(warningsCard.locator('.empty-logs')).toBeVisible();
    await expect(warningsCard.locator('.log-count')).toHaveCount(0);
    expect(page._summaryCalls).toBeGreaterThanOrEqual(1);
  });
});
