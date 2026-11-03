const { test, expect } = require('@playwright/test');
const { loginViaUI, BASE_URL, TEST_ADMIN_USER } = require('../helpers/chatbot');

/**
 * Failure states for the admin overview, mirroring
 * tests/e2e/chatbot/error-handling.spec.js: an /api/admin/* error must
 * render the visible failure (the global error notification) and never a
 * silent blank — the dashboard shell keeps rendering around it, and the
 * surface recovers on the next successful load.
 *
 * The asserted toast is the one the COMPONENT raises from its catch path
 * ("Failed to load system health data"), not any `.notification.error`:
 * the axios interceptor raises its own toast for every non-401 answer
 * (httpService.handleResponseError), so the class alone is satisfied even
 * if the component stops reporting the failure — the assertion would then
 * be decorative.
 *
 * On mount the overview fires exactly ONE admin call (system-health), so
 * a single interception has no toast races: the component shows one
 * notification at a time and a later one would replace the earlier.
 */
const COMPONENT_ERROR_TEXT = 'Failed to load system health data';

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

    // The visible failure — the notification the component raises from
    // its catch path.
    const errorToast = page.locator('.notification.error', { hasText: COMPONENT_ERROR_TEXT });
    await expect(errorToast).toBeVisible();

    // Never a silent blank: the dashboard shell and the four stat tiles
    // still render around the failure (tiles keep their last/initial
    // values — the failure surface is the toast, not a broken page).
    await expect(page.locator('[data-test-id="admin-dashboard"]')).toBeVisible();
    await expect(page.locator('.stat-card .stat-value')).toHaveCount(4);
  });

  test('recovers on the next successful load after a 503', async ({ page }) => {
    await loginViaUI(page, TEST_ADMIN_USER);

    // First load fails.
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
    await expect(page.locator('.notification.error', { hasText: COMPONENT_ERROR_TEXT })).toBeVisible();

    await page.unroute('**/api/admin/system-health');

    // The recovery load answers with a DISTINCTIVE payload: proving the
    // reload re-rendered from a successful load needs an assertion whose
    // expected value cannot be the component's initial state. The
    // component's default uptime (99.98) is what a failed recovery would
    // leave on screen, so a mocked value the deployment cannot produce is
    // the only non-vacuous witness here.
    const recovery = { calls: 0 };
    await page.route('**/api/admin/system-health', (route) => {
      recovery.calls++;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          metrics: {
            systemUptime: 42.42,
            avgResponseTime: 7,
            errorRate: 0.5,
            monthlyActiveUsers: 3,
          },
          healthServices: [],
          resourceUsage: {},
        }),
      });
    });

    await page.reload({ waitUntil: 'networkidle' });

    // Recovery: the dashboard renders the successful load's payload and
    // the component reports no failure any more.
    await expect(page.locator('[data-test-id="stat-system-uptime"] .stat-value')).toHaveText('42.42%');
    await expect(page.locator('.notification.error', { hasText: COMPONENT_ERROR_TEXT })).toHaveCount(0);
    expect(recovery.calls).toBeGreaterThanOrEqual(1);
  });
});
