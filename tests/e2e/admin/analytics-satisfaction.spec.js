const { test, expect } = require('@playwright/test');
const { loginViaUI, BASE_URL, TEST_ADMIN_USER } = require('../helpers/chatbot');

/**
 * The analytics page's satisfaction charts — the gauge and the heatmap —
 * rendered in a real browser from INJECTED payloads (#1571).
 *
 * WHY THIS SPEC EXISTS: until this spec, the satisfaction charts were covered
 * only by Jest component tests. A runtime regression in the real
 * bundle-resolution path — a missing i18n key, a wrong namespace, a locale
 * that does not reach the chart — would render English fallbacks or raw keys
 * on the analytics page with no E2E assertion going red. The charts carry
 * their own data-test-id handles (analytics-gauge*, analytics-heatmap), added
 * for this spec; the assertions below read the RENDERED result through them.
 *
 * The payloads are INJECTED (page.route): the trend labels and the heatmap
 * axis on screen can only have come from the intercepted answers, and the
 * interception is what makes the satisfaction state reachable on a venue
 * whose analytics data is whatever the deployment happened to log.
 *
 * The asserted labels are the ACTIVE LOCALE's (the venue default, en). The
 * historical-trend rows are keyed by the UNTRANSLATED period key
 * (`analytics-gauge-trend-<periodKey>`), so the handles are stable while the
 * display text is what the locale renders.
 */

/** The gauge payload: current value, target, and the five-period history the
 *  backend's period vocabulary defines (SATISFACTION_PERIOD_KEYS). */
const GAUGE = {
  currentValue: 87.5,
  previousValue: 80.0,
  changePercentage: 2.3,
  target: 85,
  historicalData: [
    { label: 'current', value: 87.5, periodStart: '2026-11-01', periodEnd: '2026-11-13' },
    { label: 'week1', value: 82.1, periodStart: '2026-10-25', periodEnd: '2026-10-31' },
    { label: 'week2', value: 78.4, periodStart: '2026-10-18', periodEnd: '2026-10-24' },
    { label: 'week3', value: 74.9, periodStart: '2026-10-11', periodEnd: '2026-10-17' },
    { label: 'week4', value: 71.2, periodStart: '2026-10-04', periodEnd: '2026-10-10' }
  ]
};

/** The heatmap payload: two knowledge areas across the same periods. The
 *  series names are payload data, not copy — a fine assertion subject. */
const HEATMAP = [
  {
    name: 'Health services',
    data: [
      { x: 'current', y: 91 },
      { x: 'week1', y: 84 },
      { x: 'week2', y: 79 }
    ]
  },
  {
    name: 'Pensions',
    data: [
      { x: 'current', y: 77 },
      { x: 'week1', y: 69 },
      { x: 'week2', y: 72 }
    ]
  }
];

/** The trend rows, keyed by period key, with the en label and the exact
 *  rendered percentage (toFixed(2) + '%'). */
const TREND_ROWS = [
  { key: 'current', label: 'Current', value: '87.50%' },
  { key: 'week1', label: 'Last Week', value: '82.10%' },
  { key: 'week2', label: '2 Weeks Ago', value: '78.40%' },
  { key: 'week3', label: '3 Weeks Ago', value: '74.90%' },
  { key: 'week4', label: '4 Weeks Ago', value: '71.20%' }
];

/** Every analytics answer the page fires, dispatched by path. The loaders
 *  the satisfaction section does not need still get a well-formed answer —
 *  a failing comparison/timeseries fetch has its own catch, but the
 *  dashboard/uniqueUsers fetches set the page's error state, which would
 *  replace the charts this spec drives. */
async function openAnalyticsWithPayloads(page) {
  await page.route('**/api/analytics/**', (route) => {
    const url = route.request().url();
    const fulfill = (body) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/analytics/dashboard')) {
      return fulfill({
        totalQueries: 1234,
        uniqueUsers: 42,
        averageResponseTime: 350,
        satisfactionRate: 87.5,
        topQueries: [],
        queryDistribution: []
      });
    }
    if (url.includes('/analytics/metric/')) {
      return fulfill({ value: 42 });
    }
    if (url.includes('/analytics/timeseries/')) {
      return fulfill([]);
    }
    if (url.includes('/analytics/satisfaction/gauge')) {
      return fulfill(GAUGE);
    }
    if (url.includes('/analytics/satisfaction/heatmap')) {
      return fulfill(HEATMAP);
    }
    // An endpoint this spec does not know: fail loudly — a silent generic
    // answer would let the page render from a payload nobody asserted.
    throw new Error(`analytics-satisfaction.spec: unexpected analytics path: ${url}`);
  });

  await loginViaUI(page, TEST_ADMIN_USER);
  await page.goto(`${BASE_URL}/analytics`, { waitUntil: 'networkidle', timeout: 30000 });
}

test.describe('Analytics satisfaction charts', () => {
  // The login helper's own worst case exceeds shorter ceilings (see
  // failure-states.spec.js): give it the login budget.
  test.setTimeout(300000);

  test('renders the gauge trends with the active locale labels and payload values', async ({ page }) => {
    await openAnalyticsWithPayloads(page);

    // The historical trends render, one row per period, keyed by the
    // UNTRANSLATED period key (the handle must not carry the locale's text).
    await expect(page.locator('[data-test-id="analytics-gauge-trends"]')).toBeVisible({
      timeout: 15000
    });
    for (const row of TREND_ROWS) {
      const item = page.locator(`[data-test-id="analytics-gauge-trend-${row.key}"]`);
      await expect(item).toBeVisible();
      // The label is the LOCALE's (en here): the translation pipeline —
      // key namespace, active locale, render — is what this assertion
      // pins; a raw `analytics.timePeriods.week1` key leaking through is
      // exactly the regression the Jest layer cannot see.
      await expect(item).toContainText(row.label);
      await expect(item).toContainText(row.value);
    }

    // The target indicator: exact rendered copy.
    await expect(page.locator('[data-test-id="analytics-gauge-target"]')).toHaveText('Target: 85%');

    // The gauge's center value, inside the chart SVG: the payload's
    // currentValue through the chart's own formatter (toFixed(2) + '%').
    await expect(
      page.locator('[data-test-id="analytics-gauge"] text').filter({ hasText: '87.50%' }).first()
    ).toBeVisible();
  });

  test('renders the heatmap with its title and the locale week axis', async ({ page }) => {
    await openAnalyticsWithPayloads(page);

    const heatmap = page.locator('[data-test-id="analytics-heatmap"]');
    await expect(heatmap).toBeVisible({ timeout: 15000 });

    // The chart title — the locale's, via the same i18n pipeline.
    await expect(heatmap.locator('text').filter({ hasText: 'Satisfaction by Knowledge Area' })).toBeVisible();

    // The week axis: the payload's period keys, rendered translated. The
    // series names are payload data and carry the service names verbatim.
    await expect(heatmap.locator('text').filter({ hasText: 'Last Week' }).first()).toBeVisible();
    await expect(heatmap.locator('text').filter({ hasText: '2 Weeks Ago' }).first()).toBeVisible();
    await expect(heatmap.locator('text').filter({ hasText: 'Health services' }).first()).toBeVisible();
    await expect(heatmap.locator('text').filter({ hasText: 'Pensions' }).first()).toBeVisible();
  });
});
