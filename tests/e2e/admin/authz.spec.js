const { test, expect } = require('@playwright/test');
const { loginViaUI, BASE_URL, TEST_PLAIN_USER, TEST_ADMIN_USER } = require('../helpers/chatbot');

/**
 * Admin route authorization, end to end.
 *
 * The frontend router guard on /admin is auth-only (no role check) — the
 * refusal lives in TWO places: the navbar admin button is disabled without
 * the `admin` realm role, and the backend gate
 * (keycloakAuthMiddleware.requireAdmin) answers 403 FORBIDDEN for every
 * /api/admin/* call. Both halves are asserted here against the REAL
 * backend (route.fetch replays the browser's authenticated request), so a
 * reverted requireAdmin or a broken role mapping turns these red.
 *
 * testadmin carries the `admin` realm role and testplain carries none —
 * both are provisioned by the same venues that provision testuser (the
 * CI e2e setup job and docs/e2e-tests/00-clean-start.md Phase 0).
 */

/**
 * Install the authenticated backend probe shared by both tests: it
 * replays each matching request and records status/body for assertion IN
 * the test body — an expect inside a route handler only surfaces as an
 * unhandled rejection that can outlive the await chain. The call counter
 * keeps the assertions from passing vacuously: if the dashboard mount
 * never fires the call, the test fails on the count, not on tiles that
 * render from their defaults.
 */
function probeSystemHealth(page) {
  const state = { calls: 0, status: null, body: null };
  page.route('**/api/admin/system-health', async (route) => {
    state.calls++;
    const response = await route.fetch();
    state.status = response.status();
    state.body = await response.json().catch(() => ({}));
    await route.fulfill({ response });
  });
  return state;
}

test.describe('Admin route authorization', () => {
  test.setTimeout(120000);

  test('admin role renders the admin dashboard', async ({ page }) => {
    await loginViaUI(page, TEST_ADMIN_USER);

    // requireAdmin must let an admin-role JWT through.
    const health = probeSystemHealth(page);

    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });

    await expect(page.locator('[data-test-id="admin-dashboard"]')).toBeVisible();
    // The four overview stat tiles render (real backend data — values are
    // deployment-specific, the wiring is asserted in data-wiring.spec.js).
    await expect(page.locator('.stat-card .stat-value')).toHaveCount(4);
    await expect(page.locator('[data-test-id="nav-admin-button"]')).toBeEnabled();
    expect(health.calls).toBeGreaterThanOrEqual(1);
    expect(health.status).toBe(200);
  });

  test('non-admin session is refused by the backend and the navbar', async ({ page }) => {
    await loginViaUI(page, TEST_PLAIN_USER);

    // requireAdmin must answer 403 FORBIDDEN for the role-less session.
    const health = probeSystemHealth(page);

    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });

    // The router guard is auth-only, so the shell still renders — the
    // refusal is the 403 below, not a redirect. Pin that shape: if the
    // frontend ever grows a role gate, this assertion is the one to update
    // deliberately, not silently.
    await expect(page.locator('[data-test-id="admin-dashboard"]')).toBeVisible();
    expect(health.calls).toBeGreaterThanOrEqual(1);
    expect(health.status).toBe(403);
    expect(health.body.error).toBe('FORBIDDEN');

    // The navbar admin entry is disabled without the role — the visible
    // half of the refusal (the mobile twin carries its own anchor).
    await expect(page.locator('[data-test-id="nav-admin-button"]')).toBeDisabled();
  });
});
