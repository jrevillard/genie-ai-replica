// The Quick Help grid's RENDERED scope states.
//
// The drift contract is visible: a card whose declared labels or category the live
// hierarchy cannot name renders as an error card with a caption that says what is
// gone, and its click sends nothing. The Jest suite asserts the STATE (the chip
// item, the guard, the caption text); this spec asserts the RENDERED result —
// the grid appears once the hierarchy settles, the error card and its caption are
// on screen, and the click produces no turn.
//
// The hierarchy is STUBBED (an empty list is the strongest drift: every scoped
// card is broken) so the spec does not depend on the deployment's own hierarchy.
//
// MUTATION CHECK (run against a live stack before trusting these assertions):
//   - drop `v-if="quickHelpScopeSettled"` on .quick-help-grid        -> test 1 fails
//   - drop the 'config-error' class / the .config-error-icon         -> test 2 fails
//   - remove the broken-card guard in selectQuickHelpOption           -> test 2 fails
// The assertions below are deliberately structural (a class, a testid, a count of
// user turns) — a screenshot alone would prove nothing.
const { test, expect } = require('@playwright/test');
const { loginViaUI } = require('./helpers/chatbot');

const SCOPED_TREE = [
  {
    catKey: '2',
    name: 'Civil Registry',
    nameEN: 'Civil Registry',
    children: [{ name: 'Births', nameEN: 'Births' }]
  }
];

async function openWelcomeWithHierarchy(browser, categories) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true
  });
  const page = await ctx.newPage();

  // The hierarchy the app reads: stubbed BEFORE the login, so the first
  // chat mount already sees it.
  await page.route('**/api/services/categories*', async (route) => {
    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(categories)
      });
    } catch {
      /* the context closed before the fulfillment */
    }
  });

  await loginViaUI(page);
  await page.waitForSelector('.quick-help-banner', { timeout: 15000 });
  await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('.quick-help-banner', { timeout: 15000 });
  await page.waitForTimeout(1500);
  return { ctx, page };
}

test.describe('Quick Help scope states', () => {
  test('the grid renders once the hierarchy settles', async ({ browser }) => {
    const { ctx, page } = await openWelcomeWithHierarchy(browser, SCOPED_TREE);

    const grid = page.locator('.quick-help-grid');
    await expect(grid).toBeVisible({ timeout: 15000 });
    // The cards are the grid's children — the grid is not an empty box.
    expect(await page.locator('.quick-help-item').count()).toBeGreaterThan(0);

    await ctx.close();
  });

  test('a card the hierarchy cannot name renders the error state and sends nothing', async ({ browser }) => {
    const { ctx, page } = await openWelcomeWithHierarchy(browser, []);

    // An EMPTY hierarchy: every card that declares a scope is broken.
    const broken = page.locator('.quick-help-item.config-error');
    const brokenCount = await broken.count();
    expect(
      brokenCount,
      'the deployment carries scoped cards, and an empty hierarchy breaks every one'
    ).toBeGreaterThan(0);

    // The broken card says so: the icon and the caption naming the problem.
    await expect(broken.first().locator('.config-error-icon')).toBeVisible();
    const caption = broken.first().locator('[data-testid="quick-help-error-caption"]');
    await expect(caption).toBeVisible();
    expect((await caption.innerText()).trim().length).toBeGreaterThan(0);

    // And the click sends NOTHING: no turn, no user message.
    let streamed = false;
    await page.route('**/queries/stream**', async (route) => {
      streamed = true;
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
    });
    await broken.first().click();
    await page.waitForTimeout(1200);

    expect(streamed, 'a broken card must not reach the query path').toBe(false);
    expect(await page.locator('[data-testid="user-avatar"]').count()).toBe(0);

    await ctx.close();
  });
});
