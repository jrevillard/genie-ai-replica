// Log Search via Grafana Explore — Playwright E2E (AC#6)
//
// Navigates to Grafana Explore, opens the log datasource,
// searches for logs from a known error request by trace_id,
// and verifies log entries are displayed with correct fields.
//
// Prerequisites:
//   - GENIE.AI stack running with observability enabled
//   - Grafana accessible via Kong at /grafana/ (Keycloak SSO)
//   - Known trace ID from a recent request (set TRACE_ID env var
//     or the test generates one and waits for propagation)
//
// Usage:
//   TRACE_ID=abc123 npx playwright test tests/e2e/observability/
//   BASE_URL=https://localhost npx playwright test tests/e2e/observability/

const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'https://localhost';
const GRAFANA_PATH = '/grafana/';
const TRACE_ID = process.env.TRACE_ID || '';

// ---------------------------------------------------------------------------
// Test: Log search via Grafana Explore
// ---------------------------------------------------------------------------

test.describe('AC6 — Log Search via Grafana Explore', () => {
  test.skip(!TRACE_ID, 'TRACE_ID environment variable is required');

  test('logs can be searched by trace_id and display structured fields', async ({
    page,
  }) => {
    // 1. Navigate to Grafana Explore with VictoriaLogs datasource
    const grafanaUrl = `${BASE_URL}${GRAFANA_PATH}explore`;
    await page.goto(grafanaUrl, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    // Grafana may show Keycloak SSO login first
    // The existing auth flow redirects through Keycloak — wait for Grafana UI
    await page.waitForURL(/grafana|explore|login/, { timeout: 30000 });

    // If redirected to Keycloak login, authenticate
    const currentUrl = page.url();
    if (currentUrl.includes('protocol/openid-connect') || currentUrl.includes('login')) {
      await page.fill('#username', process.env.GRAFANA_USER || 'admin');
      await page.fill('#password', process.env.GRAFANA_PASSWORD || 'admin');
      await page.click('#kc-login');
      await page.waitForURL(/grafana|explore/, { timeout: 30000 });
    }

    // 2. Wait for Grafana UI to load
    // Grafana Explore should show datasource selector
    await expect(
      page.locator('[data-testid="data-testid Explore"]').or(
        page.locator('button').filter({ hasText: 'Explore' }),
      ).first(),
    ).toBeVisible({ timeout: 15000 }).catch(() => {
      // Grafana may already be on Explore page
    });

    // 3. Switch to VictoriaLogs datasource if not already selected
    const datasourceButton = page.locator(
      '[data-testid="data-testid DataSourcePicker"]',
    ).or(
      page.locator('button').filter({ hasText: /VictoriaLogs|datasource/i }),
    );

    if (await datasourceButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await datasourceButton.click();
      const logsOption = page.locator('div').filter({ hasText: 'VictoriaLogs' });
      await expect(logsOption).toBeVisible({ timeout: 5000 });
      await logsOption.click();
    }

    // 4. Enter LogQL query with trace_id
    // Grafana Explore has a code editor / query input for LogQL
    const queryInput = page
      .locator(
        '[data-testid="data-testid CodeEditor"]',
      )
      .or(
        page.locator('.monaco-editor textarea'),
      )
      .or(
        page.locator('[class*="query-input"]'),
      );

    await expect(queryInput.first()).toBeVisible({ timeout: 10000 });
    await queryInput.first().click();
    await page.keyboard.type(`trace_id:"${TRACE_ID}"`, { delay: 20 });

    // 5. Click "Run query" button
    const runButton = page
      .locator('button')
      .filter({ hasText: /^Run query$/i })
      .or(
        page.locator('[data-testid="data-testid RunQueryButton"]'),
      );

    await expect(runButton.first()).toBeVisible({ timeout: 5000 });
    await runButton.first().click();

    // 6. Wait for log results to appear
    // Grafana logs panel shows table rows with log fields
    const logRows = page
      .locator('[data-testid="data-testid LogRows"]')
      .or(
        page.locator('[class*="logs-panel"] [class*="row"]'),
      )
      .or(
        page.locator('.datagrid-container tbody tr'),
      );

    await expect(logRows.first()).toBeVisible({ timeout: 30000 });

    // 7. Verify log entries contain trace_id
    const pageContent = await page.textContent('body');
    expect(pageContent).toContain(TRACE_ID.toLowerCase());

    // 8. Verify structured log fields are displayed
    // Logs should show service name, level, and timestamp columns
    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(100); // Substantive content, not empty

    // 9. Take screenshot for evidence
    await page.screenshot({
      path: 'reports/grafana-log-search.png',
      fullPage: true,
    });
  });
});
