const { test, expect } = require('@playwright/test');
const { loginViaUI, BASE_URL, TEST_ADMIN_USER } = require('../helpers/chatbot');

/**
 * Overview data wiring: the stat tiles, health services and resource usage
 * render FROM the /api/admin/system-health payload.
 *
 * The payload is injected by route interception with values that collide
 * with nothing — the component's uninitialized defaults are
 * 99.98 / 245 / 0.05 / 0, so seeing 87.65 / 321 / 2.5% / 1,234 on screen
 * can only mean the API response drove the render. Mutation gate: flip a
 * value in the mocked payload (or break the component's assignment) and
 * the exact-text assertions below fail.
 */
// The injected metric values. Single source for both tests: a
// mutation-gate edit changes them once.
const METRICS = {
  systemUptime: 87.65,
  avgResponseTime: 321,
  errorRate: 2.5,
  monthlyActiveUsers: 1234,
};

test.describe('Admin overview data wiring', () => {
  test.setTimeout(120000);
  // Pin the locale: monthlyActiveUsers renders through
  // toLocaleString(), whose grouping separator follows the browser
  // locale ("1,234" en-US vs "1.234" de-DE).
  test.use({ locale: 'en-US' });

  async function loginWithWiredPayload(page, payload) {
    await loginViaUI(page, TEST_ADMIN_USER);
    await page.route('**/api/admin/system-health', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      }),
    );
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });
  }

  test('stat tiles render the system-health payload values', async ({ page }) => {
    await loginWithWiredPayload(page, {
      metrics: METRICS,
      healthServices: [],
      resourceUsage: {},
    });

    // Exact text, tile by tile — the template appends the unit
    // (%, ms) and errorRateLabel appends % (or an em dash when the
    // metric is null).
    await expect(page.locator('[data-test-id="stat-system-uptime"] .stat-value')).toHaveText('87.65%');
    await expect(page.locator('[data-test-id="stat-avg-response-time"] .stat-value')).toHaveText('321ms');
    await expect(page.locator('[data-test-id="stat-error-rate"] .stat-value')).toHaveText('2.5%');
    await expect(page.locator('[data-test-id="stat-monthly-active-users"] .stat-value')).toHaveText('1,234');
  });

  test('health services and resource usage render from the payload', async ({ page }) => {
    await loginWithWiredPayload(page, {
      metrics: METRICS,
      healthServices: [
        { id: 'wiredAlpha', name: 'Wired Service Alpha', status: 'healthy' },
        { id: 'wiredBeta', name: 'Wired Service Beta', status: 'down' },
      ],
      resourceUsage: { cpu: 42, memory: 67 },
    });

    // Health rows carry the per-service status class and the service
    // name (the i18n fallback — no admin.services.wiredAlpha key exists).
    const alpha = page.locator('.health-item', { hasText: 'Wired Service Alpha' });
    await expect(alpha).toBeVisible();
    await expect(alpha).toHaveClass(/status-healthy/);

    const beta = page.locator('.health-item', { hasText: 'Wired Service Beta' });
    await expect(beta).toBeVisible();
    await expect(beta).toHaveClass(/status-down/);

    // Resource rows: the row anchor is the canonical resource id (the
    // label itself is i18n); value and bar width come from the payload.
    const cpu = page.locator('[data-test-id="usage-cpu"]');
    await expect(cpu.locator('.usage-value')).toHaveText('42%');
    await expect(cpu.locator('.usage-fill')).toHaveAttribute('style', /width: 42%/);

    const memory = page.locator('[data-test-id="usage-memory"]');
    await expect(memory.locator('.usage-value')).toHaveText('67%');
  });
});
