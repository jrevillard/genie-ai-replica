const { test, expect } = require('@playwright/test');
const { loginViaUI, BASE_URL, TEST_ADMIN_USER } = require('../helpers/chatbot');

/**
 * Failure states for the admin overview, mirroring
 * tests/e2e/chatbot/error-handling.spec.js: an /api/admin/* error must
 * render the visible failure (the global error notification) and never a
 * silent blank — the dashboard shell keeps rendering around it, and the
 * surface recovers on the next successful load.
 *
 * On mount the overview fires exactly ONE admin call (system-health), so
 * a single interception has no toast races: the component shows one
 * notification at a time and a later one would replace the earlier.
 */
test.describe('Admin overview failure states', () => {
  test.setTimeout(120000);

  test('renders the error notification when system-health returns 500', async ({ page }) => {
    await loginViaUI(page, TEST_ADMIN_USER);
    await page.route('**/api/admin/system-health', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'INTERNAL_ERROR',
          message: 'An internal error occurred',
        }),
      }),
    );
    // domcontentloaded, not networkidle: the toast hides itself after 3 s,
    // and waiting for the network to go quiet can land the first
    // assertion after it is already gone. The toast assertion below
    // auto-waits from the moment the DOM is ready.
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'domcontentloaded' });

    // The visible failure — the global toast the component raises from
    // its catch path.
    const errorToast = page.locator('.notification.error');
    await expect(errorToast).toBeVisible();

    // Never a silent blank: the dashboard shell and the four stat tiles
    // still render around the failure (tiles keep their last/initial
    // values — the failure surface is the toast, not a broken page).
    await expect(page.locator('[data-test-id="admin-dashboard"]')).toBeVisible();
    await expect(page.locator('.stat-card .stat-value')).toHaveCount(4);
  });

  test('recovers on the next successful load after a 503', async ({ page }) => {
    await loginViaUI(page, TEST_ADMIN_USER);

    // First load fails; the reload after unroute goes through to the
    // real backend. The overview fires exactly one system-health call
    // per mount, so no attempt counting is needed.
    await page.route('**/api/admin/system-health', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'SERVICE_UNAVAILABLE',
          message: 'Temporarily unavailable',
        }),
      }),
    );

    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.notification.error')).toBeVisible();

    await page.unroute('**/api/admin/system-health');
    await page.reload({ waitUntil: 'networkidle' });

    // Recovery: no error toast on the reloaded dashboard and the stat
    // tiles render from the successful load.
    await expect(page.locator('.notification.error')).toBeHidden();
    await expect(page.locator('.stat-card .stat-value')).toHaveCount(4);
  });
});
