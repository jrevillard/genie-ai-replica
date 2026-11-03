const { test, expect } = require('@playwright/test');
const { SESSION_MINT_TIMEOUT_MS } = require('../helpers/auth');
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
  // The login helper's own worst case (two attempts, navigation +
  // redirect waits) exceeds two minutes: a shorter ceiling would fire
  // first and hide the helper's diagnosis behind a bare timeout.
  test.setTimeout(SESSION_MINT_TIMEOUT_MS);

  /**
   * Log in and open the admin overview with the system-health call
   * failing with the given status.
   *
   * domcontentloaded, not networkidle: the toast hides itself after 3 s,
   * and waiting for the network to go quiet can land the first assertion
   * after it is already gone. The toast assertion auto-waits from the
   * moment the DOM is ready.
   */
  async function openAdminWithFailure(page, status, error, message) {
    await loginViaUI(page, TEST_ADMIN_USER);
    await page.route('**/api/admin/system-health', (route) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify({ error, message }),
      }),
    );
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'domcontentloaded' });
  }

  test('renders the error notification when system-health returns 500', async ({ page }) => {
    await openAdminWithFailure(page, 500, 'INTERNAL_ERROR', 'An internal error occurred');

    // The visible failure — the notification the component raises from
    // its catch path.
    const errorToast = page.locator('[data-test-id="notification-error"]', { hasText: COMPONENT_ERROR_TEXT });
    await expect(errorToast).toBeVisible();

    // Never a silent blank: the dashboard shell and the four stat tiles
    // still render around the failure (tiles keep their last/initial
    // values — the failure surface is the toast, not a broken page).
    await expect(page.locator('[data-test-id="admin-dashboard"]')).toBeVisible();
    await expect(page.locator('[data-test-id^="stat-"]')).toHaveCount(4);
  });

  test('recovers on the next successful load after a 503', async ({ page }) => {
    // First load fails.
    await openAdminWithFailure(page, 503, 'SERVICE_UNAVAILABLE', 'Temporarily unavailable');
    await expect(page.locator('[data-test-id="notification-error"]', { hasText: COMPONENT_ERROR_TEXT })).toBeVisible();

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

    // Recovery: the dashboard renders the successful load's payload. The
    // witness is the VALUE (42.42% on a tile whose initial value is
    // 99.98) — not the absence of a toast: the notification hides itself
    // after 3 s, so "no toast right now" can also mean "the toast is not
    // there yet" and would pass on a failed recovery.
    await expect(page.locator('[data-test-id="stat-system-uptime"]')).toContainText('42.42%');
    expect(recovery.calls).toBeGreaterThanOrEqual(1);
  });
});
