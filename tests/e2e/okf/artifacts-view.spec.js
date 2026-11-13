// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// E2E (W6 / EPIC-6 / CAP-5): the OKF ARTIFACTS view.
//
// WHY THIS SPEC EXISTS: the bundle zips used to sit in the document list
// wearing the costume of documents — unlabeled, with a Delete affordance
// the server refuses (WS2 → 403 BUNDLE_PROTECTED for every caller but the
// okf-service account). The artifacts view is the honest surface for them,
// and this spec drives it in a real browser and asserts the three claims it
// makes:
//
//   1. it asks for the ARTIFACTS (is_bundle=true) while the document list
//      asks for the documents (is_bundle=false) — the two never mix;
//   2. every row carries its PROVENANCE — the repository it came from and
//      the version it was minted for (and "unknown version" when the
//      artifact carries none — never a guess);
//   3. it offers NO delete — the affordance the server would refuse.
//
// The payloads are INJECTED (page.route), the same measure-don't-look rule
// as admin/logs-view.spec.js: a row on screen can only have come from the
// intercepted response, and the request parameters are captured so the
// filter is proven rather than assumed.
//
// WHY IT LIVES HERE (tests/e2e/okf/) and not in tests/e2e/documents/: the
// artifacts are the OKF lifecycle's output, so the surface only exists on
// an OKF-enabled deployment (OKF_ENABLED=1). The local run executes the
// whole tree — this directory included — against whatever venue it is
// pointed at, so on a core-profile venue the spec skips ITSELF, with the
// venue's own profile as the reason (#1742).
//
// Run against the local build (OKF_ENABLED=1):
//   cd C:/Dev/builds/main && npx playwright test \
//     --config=D:/ITU-Gitlab/playwright.config.js tests/e2e/okf/artifacts-view.spec.js

const { test, expect } = require('@playwright/test');
const { loginViaUI, BASE_URL, TEST_ADMIN_USER, LOGIN_BUDGET_TIMEOUT_MS } = require('../helpers/chatbot');
const { okfEnabled, okfParkedReason } = require('../helpers/venue-profile');

/** The artifacts the interception serves. Two of them: one complete, one
 *  without a bundle_version (the version must read "unknown", not a
 *  number guessed from the file name). */
const ARTIFACTS = [
  {
    file_id: 'artifact-1',
    file_name: 'kenya-v18.zip',
    is_bundle: true,
    repo_id: 'repo-kenya',
    bundle_version: 18,
    dataprep: { status: 'Ingested' }
  },
  {
    file_id: 'artifact-2',
    file_name: 'bali-v2.zip',
    is_bundle: true,
    repo_id: 'repo-bali',
    bundle_version: null,
    dataprep: { status: 'Pending' }
  }
];

/** The repositories the OKF store resolves the ids against. */
const REPOS = [{ repo_id: 'repo-kenya', name: 'Kenya Government Services' }];

test.describe('the OKF artifacts view', () => {
  // The labels under test are translated (admin.documents.status*); pin the
  // locale so the exact wording is fixed.
  test.use({ locale: 'en-US' });

  // The view opens behind a browser login — the budget is the login's
  // own ceiling, derived once beside loginViaUI (#1798).
  test.describe.configure({ timeout: LOGIN_BUDGET_TIMEOUT_MS });

  // The artifacts view is an OKF surface: a deployment whose OKF pillar is
  // parked does not render it, and this spec would fail looking for a
  // surface that never appears. It SKIPS WITH A REASON instead (#1742), and
  // the reason is the venue's own profile — read from the runtime config
  // the frontend itself reads — not a guess.
  test.beforeEach(async () => {
    test.skip(!(await okfEnabled()), await okfParkedReason());
  });

  /**
   * Log in as the admin, intercept the two reads the surface performs, and
   * open the artifacts view. Returns the captured `is_bundle` request
   * parameters — the proof that the two lists are filtered apart.
   */
  async function openArtifacts(page) {
    const filters = [];
    await page.route('**/api/files*', (route) => {
      const url = new URL(route.request().url());
      const isBundle = url.searchParams.get('is_bundle');
      filters.push(isBundle);
      // The documents list (is_bundle=false) gets NOTHING — the two views
      // must not share a payload.
      const rows = isBundle === 'true' ? ARTIFACTS : [];
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: rows,
          pagination: { totalFiles: rows.length, currentPage: 1 }
        })
      });
    });
    // The repository NAMES the provenance pill resolves the repo_id against.
    await page.route('**/api/okf/repos?*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: REPOS })
      })
    );

    await loginViaUI(page, TEST_ADMIN_USER);
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle', timeout: 30000 });

    // The tab rack replaced the sidebar nav in UX-1: the documents tab is
    // reached by its declared handle.
    await page.locator('[data-test-id="admin-documents-link"]').click();
    await expect(page.locator('[data-test-id="admin-documents-view-toggle"]')).toBeVisible({ timeout: 10000 });
    await page.locator('[data-test-id="admin-documents-view-artifacts"]').click();
    await expect(page.locator('[data-test-id="okf-artifacts-view"]')).toBeVisible({ timeout: 15000 });
    // The artifacts read is fired by the view's `mounted()`, so the request
    // can be dispatched a tick AFTER the element is in the DOM — the view
    // being visible does NOT mean its read has been captured yet. Wait for
    // the capture explicitly (bounded) instead of racing it: an implicit
    // race is what makes an E2E suite flaky under load.
    await expect.poll(() => filters.includes('true'), { timeout: 15000 }).toBe(true);
    return filters;
  }

  test('the two views ask for two different things (artifacts vs documents)', async ({ page }) => {
    const filters = await openArtifacts(page);
    // Both reads happened…
    expect(filters, 'the surface must read the file list').toContain('true');
    // …and the artifacts read is the one that carried the artifacts.
    expect(filters.filter((f) => f === 'true').length).toBeGreaterThanOrEqual(1);
    expect(filters.filter((f) => f === 'false').length).toBeGreaterThanOrEqual(1);
  });

  test('a row carries the artifact and its provenance', async ({ page }) => {
    await openArtifacts(page);

    const name = page.locator('[data-test-id="okf-artifact-artifact-1"]');
    await expect(name).toHaveText('kenya-v18.zip');

    // The repository NAME (resolved from the OKF store) and the version the
    // artifact was minted for.
    await expect(page.locator('[data-test-id="okf-artifact-provenance-artifact-1"]')).toHaveText(
      'Kenya Government Services@v18'
    );
    await expect(page.locator('[data-test-id="okf-artifact-state-artifact-1"]')).toHaveText('Ingested');
  });

  test('an artifact with no version says the version is unknown (never a guess)', async ({ page }) => {
    await openArtifacts(page);
    await expect(page.locator('[data-test-id="okf-artifact-artifact-2"]')).toHaveText('bali-v2.zip');
    // The repository does not resolve → the raw id, and the version unknown.
    // NEVER a version parsed out of the file name.
    await expect(page.locator('[data-test-id="okf-artifact-provenance-artifact-2"]')).toHaveText(
      'repo-bali@unknown version'
    );
  });

  test('the artifacts view offers NO delete — the server would refuse it', async ({ page }) => {
    await openArtifacts(page);
    const view = page.locator('[data-test-id="okf-artifacts-view"]');
    await expect(view).toBeVisible();
    // No delete/remove control anywhere in the view, for any state.
    await expect(view.getByRole('button', { name: /delete|remove/i })).toHaveCount(0);
    await expect(view.locator('button').filter({ hasText: /delete|remove/i })).toHaveCount(0);
  });

  test('the deep link opens the artifacts view directly', async ({ page }) => {
    await page.route('**/api/files*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: ARTIFACTS,
          pagination: { totalFiles: ARTIFACTS.length, currentPage: 1 }
        })
      })
    );
    await loginViaUI(page, TEST_ADMIN_USER);
    await page.goto(`${BASE_URL}/admin?tab=documents&view=artifacts`, { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page.locator('[data-test-id="okf-artifacts-view"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-test-id="okf-artifact-artifact-1"]')).toHaveText('kenya-v18.zip');
  });
});
