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
test.describe('Admin route authorization', () => {
  test.setTimeout(120000);

  test('admin role renders the admin dashboard', async ({ page }) => {
    await loginViaUI(page, TEST_ADMIN_USER);

    // Probe the real backend with the admin's session before navigating:
    // requireAdmin must let an admin-role JWT through.
    await page.route('**/api/admin/system-health', async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.fulfill({ response });
    });

    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });

    await expect(page.locator('[data-test-id="admin-dashboard"]')).toBeVisible();
    // The four overview stat tiles render (real backend data — values are
    // deployment-specific, the wiring is asserted in data-wiring.spec.js).
    await expect(page.locator('.stat-card .stat-value')).toHaveCount(4);
    await expect(page.locator('[data-test-id="nav-admin-button"]')).toBeEnabled();
  });

  test('non-admin session is refused by the backend and the navbar', async ({ page }) => {
    await loginViaUI(page, TEST_PLAIN_USER);

    // Probe the real backend with the plain user's session: requireAdmin
    // must answer 403 FORBIDDEN.
    await page.route('**/api/admin/system-health', async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(403);
      const body = await response.json();
      expect(body.error).toBe('FORBIDDEN');
      await route.fulfill({ response });
    });

    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });

    // The router guard is auth-only, so the shell still renders — the
    // refusal is the 403 above, not a redirect. Pin that shape: if the
    // frontend ever grows a role gate, this assertion is the one to update
    // deliberately, not silently.
    await expect(page.locator('[data-test-id="admin-dashboard"]')).toBeVisible();

    // The navbar admin entry is disabled without the role — the visible
    // half of the refusal (the mobile twin carries its own anchor).
    await expect(page.locator('[data-test-id="nav-admin-button"]')).toBeDisabled();
  });
});
