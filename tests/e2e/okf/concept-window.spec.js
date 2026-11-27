// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// E2E: the #2188 WINDOWED PARALLEL CONCEPT-LIST CRAWL + the #2189 WINDOWED
// CONCEPT RAIL in the Studio.
//
// WHY THIS SPEC EXISTS: #2188 replaced the editor rail's sequential page
// crawl (~50 round trips at 400–700 ms apiece on a 10k-concept repo, every
// one a 304 cache hit) with windows of five concurrent requests committed
// once per wave, and made the crawl's operation-wait entry CANCELLABLE with
// a real AbortController. #2189 then made the RAIL itself render a window —
// the measured wall was never the network (1.1 s) but the unvirtualized
// list re-rendering every row per wave commit. The unit suites pin the
// mechanics; this spec proves the acceptance on the real stack, in a real
// browser, against the real okf-server:
//
//   1. the rail settles O(viewport) with the full collection behind a tail
//      spacer, and the wait panel clears — the crawl terminates (first
//      open; also warms the browser HTTP cache);
//   2. a SECOND open (cache warm — the exact condition the issue measured,
//      every response a 304) settles within the ORIGINAL 5 s acceptance
//      (re-armed here per David's 2026-11-26 ruling — this story owns the
//      wall), with the first rows painting early, the scrollbar reflecting
//      the whole collection, and scrolling reaching the rest of it;
//   3. Cancel is REAL: clicking it mid-crawl stops the request stream (no
//      new wave dispatches), keeps the already-committed rows, and raises
//      no error (the ABORTED contract — the PII panel's fail-closed
//      partial-read semantics ride on this).
//
// The crawl is exercised against the venue's LARGEST repository (by
// concept_count) — a small repo never leaves page 1 and proves nothing.
// Test 3 slows the concepts route with per-request latency (real transport,
// delayed responses) so the cancel click has a deterministic window; the
// abort itself is the browser's real one.
//
// Run against the local build (OKF_ENABLED=1):
//   cd C:/Dev/builds/main && npx playwright test \
//     --config=D:/ITU-Gitlab/playwright.config.js tests/e2e/okf/concept-window.spec.js

const { test, expect } = require('@playwright/test');
const { loginViaUI } = require('../helpers/chatbot');
const { okfAdminUser } = require('../helpers/okf-studio');
const { getSessionToken, request } = require('../helpers/auth');
const { okfEnabled, okfParkedReason, skipUnlessVenue } = require('../helpers/venue-profile');
const { pinEnglish } = require('../helpers/locale');
const { BASE_URL } = require('../helpers/base-url');

const ROW = '[data-test-id^="okf-concept-row-"]';
const TAIL = '[data-test-id="okf-cl-tail"]';
const RAIL_LIST = '[data-test-id="okf-cl-list"]';
// Declared handles (the e2e-handle-locators contract: no class, no text
// locators). The overlay exposes panel/row/cancel/failure handles; the row
// carries data-op with the registry's op name.
const OP_PANEL = '[data-test-id="op-wait-panel"]';
const OP_CANCEL = '[data-test-id="op-wait-cancel"]';
const OP_CONCEPT_ROW = '[data-test-id="op-wait-row"][data-op="concept-list-fetch"]';
const CARD = (repoId) => `[data-test-id="okf-studio-repo-${repoId}"]`;

/** The #2189 windowed-rail contract: the rail mounts O(viewport) rows and
 *  the unrendered remainder stands as tail-spacer height (the scrollbar
 *  reflects the whole collection). */
async function expectWindowedRail(page, expectedTotal) {
  const rendered = await page.locator(ROW).count();
  expect(rendered, 'the rail mounts O(viewport), not the collection').toBeLessThan(400);
  const spacer = page.locator(TAIL);
  await spacer.waitFor({ state: 'attached', timeout: 5000 });
  // the scrollbar stays honest: rendered rows + spacer cover the collection
  const sh = await page.locator(RAIL_LIST).evaluate((el) => el.scrollHeight);
  expect(sh, 'scrollHeight covers every concept').toBeGreaterThanOrEqual(expectedTotal * 26);
  expect(sh, 'scrollHeight claims no more than the collection').toBeLessThanOrEqual(expectedTotal * 60);
  return rendered;
}

/** Pull the venue's largest repository (by concept_count) through the
 *  session's own token — the crawl needs a repo with more than one page
 *  (PAGE = 200) to be a crawl at all. */
async function largestRepo(page) {
  const token = await getSessionToken(page);
  const res = await request('GET', '/api/okf/repos?limit=200&projection=summary', {
    headers: { Authorization: `Bearer ${token}` }
  });
  expect(res.status, 'the repos list answers').toBe(200);
  const repos = (res.data && (res.data.items || res.data)) || [];
  const sorted = [...repos]
    .filter((r) => (r.concept_count || 0) > 200)
    .sort((a, b) => (b.concept_count || 0) - (a.concept_count || 0));
  expect(sorted.length, 'a multi-page (>200 concepts) repository exists on the venue').toBeGreaterThan(0);
  return sorted[0];
}

/** The rail lives on the Editor sub-tab — the shell opens at the wizard step.
 *  Click through so the rows are PAINTED, not merely mounted in the DOM. */
async function openEditorTab(page) {
  const editorTab = page.locator('[data-test-id="ds-tab-editor"]');
  await editorTab.waitFor({ state: 'visible', timeout: 15000 });
  await editorTab.click();
}

/** Open the Studio dashboard, click the repo card, and watch the crawl: the
 *  timestamps of the first painted row and of the settled rail (row count
 *  stable AND the wait panel gone). */
async function measureOpen(page, repoId) {
  await page.goto(`${BASE_URL}/admin?tab=studio`, { waitUntil: 'networkidle', timeout: 30000 });
  const card = page.locator(CARD(repoId));
  await card.waitFor({ state: 'visible', timeout: 15000 });
  const clicked = Date.now();
  await card.click();
  await openEditorTab(page);

  let firstRow = null;
  let settledAt = null;
  let lastCount = -1;
  let stableSince = 0;
  while (Date.now() - clicked < 90000) {
    const count = await page.locator(ROW).count();
    const panelGone = (await page.locator(OP_PANEL).count()) === 0;
    if (count > 0 && firstRow === null) firstRow = Date.now();
    if (count > 0 && count === lastCount && panelGone) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince >= 800) {
        settledAt = Date.now();
        break;
      }
    } else {
      stableSince = 0;
    }
    lastCount = count;
    await page.waitForTimeout(120);
  }
  expect(settledAt, 'the crawl settles inside the 90 s harness ceiling').not.toBeNull();
  const finalCount = await page.locator(ROW).count();
  return { clicked, firstRow, settledAt, finalCount };
}

test.describe('#2188 windowed concept-list crawl', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(skipUnlessVenue(test, okfEnabled, okfParkedReason));
  test.beforeEach(pinEnglish);

  let repoId;
  let expectedTotal;

  test.beforeAll(async ({ browser }) => {
    // the per-test skip guard runs BEFOREACH, not before this hook — on a
    // non-OKF venue the discovery call below would error instead of skip
    if (!(await okfEnabled())) return;
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginViaUI(page, okfAdminUser());
    const repo = await largestRepo(page);
    repoId = repo.repo_id;
    expectedTotal = repo.concept_count;
    await context.close();
  });

  test('the crawl terminates: the rail settles O(viewport) with the collection behind the spacer (first open warms the cache)', async ({
    page
  }) => {
    test.setTimeout(180000);
    await loginViaUI(page, okfAdminUser());
    const m = await measureOpen(page, repoId);
    // the full collection is represented: a windowed rail + the tail spacer
    await expectWindowedRail(page, expectedTotal);
    // report the cold-open numbers (cache was cold; no timing assertion —
    // the acceptance is judged on the warm 304 path in the next test)
    console.log(
      `[#2188 cold open] repo=${repoId} total=${expectedTotal} firstRow=${m.firstRow - m.clicked}ms settled=${m.settledAt - m.clicked}ms rendered=${m.finalCount}`
    );
  });

  test('a warm open settles within the original 5 s acceptance, and the rail reaches the rest of the collection on scroll', async ({
    page
  }) => {
    test.setTimeout(120000);
    await loginViaUI(page, okfAdminUser());
    const m = await measureOpen(page, repoId);
    const toSettled = m.settledAt - m.clicked;
    const toFirst = m.firstRow - m.clicked;
    console.log(
      `[#2189 warm open] repo=${repoId} total=${expectedTotal} firstRow=${toFirst}ms settled=${toSettled}ms rendered=${m.finalCount}`
    );
    // ACCEPTANCE RE-ARMED (David, 2026-11-26, live ruling): #2188 measured
    // its network leg at 1.1 s and moved the <=5 s wall-clock acceptance to
    // the rail story. With the rail windowed, the settle time IS the wall:
    // a warm open must settle within the original 5 s.
    expect(toSettled).toBeLessThanOrEqual(5000);
    expect(toFirst).toBeLessThanOrEqual(2500);
    await expectWindowedRail(page, expectedTotal);

    // scrolling to the bottom extends the window — a deep jump renders the
    // prefix up to the viewport, so the far end of the collection arrives
    const before = await page.locator(ROW).count();
    await page.locator(RAIL_LIST).evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForFunction(
      (total) => document.querySelectorAll('[data-test-id^="okf-concept-row-"]').length >= total - 5,
      expectedTotal,
      { timeout: 20000 }
    );
    const after = await page.locator(ROW).count();
    expect(after, 'the deep jump rendered through to the end of the collection').toBeGreaterThan(before);
    console.log(`[#2189 deep jump] rendered ${before} -> ${after} of ${expectedTotal}`);
  });

  test('Cancel is real: the request stream stops, the rows stay, no error is raised', async ({ page }) => {
    test.setTimeout(120000);
    await loginViaUI(page, okfAdminUser());

    // delay every concepts page by ~400 ms (real transport, slower
    // responses) so the crawl is long enough for a deterministic cancel
    let conceptRequests = 0;
    await page.route('**/api/okf/repos/*/concepts?*', async (route) => {
      conceptRequests += 1;
      await new Promise((r) => setTimeout(r, 400));
      return route.continue();
    });

    await page.goto(`${BASE_URL}/admin?tab=studio`, { waitUntil: 'networkidle', timeout: 30000 });
    const card = page.locator(CARD(repoId));
    await card.waitFor({ state: 'visible', timeout: 15000 });
    await card.click();
    await openEditorTab(page);

    // the cancellable op is on screen
    const cancel = page.locator(OP_CANCEL);
    await cancel.waitFor({ state: 'visible', timeout: 15000 });
    // page 1 has committed (rows on the rail) BEFORE the click: cancelling a
    // read that has committed nothing keeps nothing — the correct
    // keep-last-known behavior for a zero-row read, and useless as a
    // keep-rows proof
    await page.locator(`${ROW}`).first().waitFor({ state: 'visible', timeout: 15000 });

    const rowsAtCancel = await page.locator(ROW).count();
    const requestsAtCancel = conceptRequests;
    await cancel.click();

    // the op retires (the registry's cancel() removes the entry at once)
    await expect(page.locator(OP_CONCEPT_ROW)).toHaveCount(0, { timeout: 5000 });
    // no failure line: a deliberate cancel is not an error
    await expect(page.locator('[data-test-id="op-wait-failure"]')).toHaveCount(0);

    // the request stream is DEAD: no new concepts request starts after the
    // cancel (the in-flight window was aborted, later waves never dispatch)
    await page.waitForTimeout(1500);
    expect(conceptRequests).toBe(requestsAtCancel);

    // keep-last-known: whatever was committed at cancel time stays
    const rowsAfter = await page.locator(ROW).count();
    expect(rowsAfter).toBeGreaterThanOrEqual(rowsAtCancel);
    expect(rowsAfter).toBeGreaterThan(0);
    // and the rail still works afterwards: a re-open completes the crawl
    // (windowed: the settle + the spacer carrying the rest IS completion)
    await measureOpen(page, repoId);
    await expectWindowedRail(page, expectedTotal);
  });
});
