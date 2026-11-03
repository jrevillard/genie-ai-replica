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
   * Login, install the summary interception, open /admin. Returns
   * {calls} — the counter guards the assertions against a vacuous pass:
   * the empty-summary row renders whenever the component state is empty,
   * so the tests must prove the summary call actually happened.
   *
   * The overview mount never calls the logs endpoints — the summary is
   * fetched when the Logs tab activates (loadDataForTab('logs')), so the
   * interception is in place before the click that triggers it.
   */
  async function loginAdminWithSummary(page, summaryPayload) {
    await loginViaUI(page, TEST_ADMIN_USER);
    const state = { calls: 0 };
    await page.route('**/api/admin/logs/summary*', (route) => {
      state.calls++;
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
    // The admin sections are sidebar links (not buttons), so the anchor
    // on the Logs entry is the unambiguous way to reach the tab.
    await page.locator('[data-test-id="admin-logs-link"]').click();
    return state;
  }

  test('warning rows render from the logs summary payload', async ({ page }) => {
    const summary = await loginAdminWithSummary(page, {
      errors: [],
      warnings: [
        { type: 'auth', service: 'wired-keycloak', count: 3 },
        { type: 'database', service: 'wired-arangodb', count: 7 },
      ],
    });

    // Scoped to the warnings card: the component assigns the errors and
    // the warnings roll-ups independently, so an unscoped row locator
    // would also match a swapped assignment (the rows would render in the
    // errors card and the spec would stay green).
    const warningsCard = page.locator('[data-test-id="logs-warnings-card"]');

    const keycloakRow = warningsCard.locator('[data-test-id="log-row-wired-keycloak"]');
    await expect(keycloakRow).toBeVisible();
    await expect(page.locator('[data-test-id="log-count-wired-keycloak"]')).toHaveText('3');

    const arangoRow = warningsCard.locator('[data-test-id="log-row-wired-arangodb"]');
    await expect(arangoRow).toBeVisible();
    await expect(page.locator('[data-test-id="log-count-wired-arangodb"]')).toHaveText('7');
    expect(summary.calls).toBeGreaterThanOrEqual(1);
  });

  test('an empty summary renders the explicit empty row', async ({ page }) => {
    // The errors roll-up carries a row and the warnings roll-up is empty:
    // that pairing tells the two apart. An empty summary alone cannot —
    // the invalid-response branch renders the same empty row for both.
    const summary = await loginAdminWithSummary(page, {
      errors: [{ type: 'auth', service: 'wired-keycloak', count: 3 }],
      warnings: [],
    });

    const errorsCard = page.locator('[data-test-id="logs-errors-card"]');
    await expect(errorsCard.locator('[data-test-id="log-row-wired-keycloak"]')).toBeVisible();

    // Both roll-up tables render their own empty row; scope to the
    // warnings card anchor (the table this spec's payload drives).
    const warningsCard = page.locator('[data-test-id="logs-warnings-card"]');
    await expect(warningsCard.locator('[data-test-id="logs-warnings-empty"]')).toBeVisible();
    await expect(warningsCard.locator('[data-test-id^="log-count-"]')).toHaveCount(0);
    expect(summary.calls).toBeGreaterThanOrEqual(1);
  });
});
