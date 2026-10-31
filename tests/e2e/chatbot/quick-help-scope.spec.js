// The Quick Help grid's RENDERED scope states.
//
// The drift contract is visible: a card whose declared labels or category the live
// hierarchy cannot name renders as an error card with a caption that says what is
// gone, and its click sends nothing. The Jest suite asserts the STATE (the chip
// item, the guard, the caption text); this spec asserts the RENDERED result —
// the grid waits for the hierarchy, the error card and its caption are on screen,
// and the click produces no turn.
//
// BOTH the hierarchy AND the configuration are STUBBED, so the spec does not
// depend on what the deployment happens to ship:
//   - the hierarchy is served by this spec, so the spec decides which scopes the
//     live tree can name;
//   - the configuration is served by this spec, so the spec decides which cards
//     exist and what each of them DECLARES. A deployment whose own config has
//     no scoped card (or one with different labels) would otherwise make this
//     spec assert nothing, or assert the wrong thing.
//
// The stubbed configuration keeps the served document's own schema, so the
// frontend's Ajv validation still runs on it — a stub that bypassed validation
// would prove nothing about the real thing.
//
// MUTATION CHECK (run against a live stack before trusting these assertions):
//   - drop `v-if="quickHelpScopeSettled"` on .quick-help-grid   -> test 1 fails
//     (the grid would render while the hierarchy is still on its way — the
//      hierarchy is HELD in that test, and the config's application is
//      waited for first, so the window is real and observed)
//   - drop the 'config-error' class from .quick-help-item       -> test 2 fails
//   - drop the .config-error-icon                               -> test 2 fails
//   - remove the BROKEN-card guard in selectQuickHelpOption     -> test 2 fails
//     (the send-time guard would still block the QUERY — checkContextConfig
//      refuses a broken installed chip too — so "nothing was sent" cannot
//      tell the two guards apart. What only the tile guard does is refuse
//      the CHIP: without it the card installs its context item and the
//      welcome screen leaves. Test 2 asserts the welcome screen STAYS.)
//   - drop the LABEL-GONE part of the caption assembly          -> test 3 fails
//     (the caption would name the category instead of the label, and the
//      user would be pointed at the wrong half of their configuration)
//   - render every card as an error card                        -> test 5 fails
//     (the healthy card's click must reach the query path)
//   - drop the TITLE clause from the card's broken verdict      -> test 4 fails
//     (the card with no title would render as a blank-label card
//      that looks alive, and its click would be swallowed)
//
// The NAMEABLE guard has no mutation check HERE, and it cannot have one: a
// card whose category is gone is refused by the broken-guard too, so no
// rendered assertion can tell the two apart. It is pinned by the Jest suite
// ("a scoped button sends nothing when the tree is not there to name its
// category"), which drives the guard directly.
//
// The assertions below are deliberately structural (a class, a testid, a
// caption's wording, a count of user turns) — a screenshot alone would prove
// nothing.
const { test, expect } = require('@playwright/test');
const { openWelcomeScreen } = require('../helpers/welcome');

// The live hierarchy this spec serves. The category 'Civil Registry' exists and
// names itself in ENGLISH; 'Taxes & Revenue' does not exist at all.
//
// The cards name their category the way a CONFIGURATION does: by the
// hierarchy's ENGLISH name — the spelling a deployment can write down. The
// hierarchy's own key ('2') stays accepted, for configurations written
// before that spelling was adopted.
const HIERARCHY = [
  {
    catKey: '2',
    name: 'Civil Registry',
    nameEN: 'Civil Registry',
    children: [{ name: 'Births', nameEN: 'Births' }]
  }
];

// The cards this spec serves. The ids are distinct from the deployment's own
// ('just-chat', 'identity-civil', …) so a card that leaks in from the real
// configuration can never be mistaken for one of these.
const STUB_BUTTONS = [
  {
    // The composer entry. It is not a scope — it declares none — and it
    // renders the welcome composer. It is also the spec's SIGNAL that the
    // configuration has been read and applied: the composer appears only
    // after the config's buttons are known.
    id: 'e2e-composer',
    title: { en: 'Just Chat' },
    icon: { type: 'file', value: '/config/quickhelp/just-chat.svg' },
    category: null,
    placement: 'composer',
    styles: { backgroundColor: '#fff', hoverColor: '#eee', outlineColor: '#ccc' }
  },
  {
    // A card whose CATEGORY names fine but whose LABEL is gone: the
    // broken-guard is the only thing that refuses it. Its category is the
    // hierarchy's own KEY — the legacy spelling — so the rendered layer
    // also proves the key resolves (its caption must not blame the
    // category; the healthy card beside it proves the NAME does).
    id: 'e2e-label-gone',
    title: { en: 'Label gone' },
    icon: { type: 'file', value: '/config/quickhelp/identity-civil.svg' },
    category: '2',
    serviceLabels: ['No Such Service'],
    // The dual-prompt action is what makes the click REACH the query path
    // when the guard is gone: without a hidden prompt the click would stop
    // at the chip, and the "no query went out" assertion would pass for
    // the wrong reason — the guard's absence would be invisible.
    action: {
      visibleText: { en: 'Tell me about the vanished label' },
      hiddenPrompt: { en: 'Tell me about the vanished label' }
    },
    styles: { backgroundColor: '#fff', hoverColor: '#eee', outlineColor: '#ccc' }
  },
  {
    // A card whose CATEGORY is gone: the hierarchy cannot name it.
    id: 'e2e-category-gone',
    title: { en: 'Category gone' },
    icon: { type: 'file', value: '/config/quickhelp/taxes-revenue.svg' },
    category: 'Taxes & Revenue',
    action: {
      visibleText: { en: 'Tell me about the vanished category' },
      hiddenPrompt: { en: 'Tell me about the vanished category' }
    },
    styles: { backgroundColor: '#fff', hoverColor: '#eee', outlineColor: '#ccc' }
  },
  {
    // A healthy card: its category and its label both name fine. It is the
    // CONTROL — without it, a spec that stubs everything to "broken" would
    // pass even if the app rendered every card as an error.
    //
    // Its category is the ENGLISH NAME — the spelling every shipped
    // configuration now writes, and the one the rendered layer must prove
    // reaches the query path. The legacy key is exercised by the label-gone
    // card beside it.
    //
    // The dual-prompt action is what makes the click SEND: a card without a
    // hidden prompt installs its chip and stops there, so a control card
    // without one would prove nothing about the query path.
    id: 'e2e-healthy',
    title: { en: 'Healthy card' },
    icon: { type: 'file', value: '/config/quickhelp/healthcare-social.svg' },
    category: 'Civil Registry',
    serviceLabels: ['Births'],
    action: {
      visibleText: { en: 'Tell me about births' },
      hiddenPrompt: { en: 'Tell me about births' }
    },
    styles: { backgroundColor: '#fff', hoverColor: '#eee', outlineColor: '#ccc' }
  },
  {
    // A card whose TITLE resolves to nothing: the locale map's only entry
    // is empty, so there is no text to show. Its SCOPE is fine — it
    // declares none — so the missing title is the only thing wrong with
    // it, and the card must still say so: a blank-label card that looks
    // alive and swallows the click is the defect this card exists for.
    //
    // It declares no category, so it is the grid's only 'just-chat' card
    // and can be told apart from the others without a label to find it
    // by.
    id: 'e2e-title-missing',
    title: { en: '' },
    icon: { type: 'file', value: '/config/quickhelp/just-chat.svg' },
    category: null,
    styles: { backgroundColor: '#fff', hoverColor: '#eee', outlineColor: '#ccc' }
  }
];

/**
 * Serves the configuration, with the Quick Help cards replaced by the spec's
 * own. The rest of the served document — including its own schema — is the
 * deployment's, untouched.
 */
async function stubConfiguration(page) {
  await page.route('**/config/genie-ai-config.json', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.features = body.features || {};
    body.features.chat = body.features.chat || {};
    body.features.chat.quickHelp = body.features.chat.quickHelp || {};
    body.features.chat.quickHelp.buttons = STUB_BUTTONS;
    // Fulfil WITHOUT `response`: passing it would inherit the served
    // document's `Content-Length` — a length that no longer matches the
    // modified body, and Chromium's handling of the stale one is not
    // ours to bet the spec on. `json` alone sets the status (200), the
    // content type and a recomputed length.
    await route.fulfill({ json: body });
  });
}

/**
 * Serves the hierarchy. When [gate] is given, the answer is HELD until the
 * gate opens — the window in which the hierarchy is "still on its way" is
 * then real and observable, instead of a race against a fast stub.
 */
async function stubHierarchy(page, gate = null) {
  await page.route('**/api/services/categories*', async (route) => {
    try {
      if (gate) {
        await gate;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(HIERARCHY)
      });
    } catch {
      /* the context closed before the fulfillment */
    }
  });
}

async function openWelcome(browser, { holdHierarchy = false } = {}) {
  // Both stubs are installed BEFORE the login, so the first chat mount
  // already sees them. The gate is created here and released by the
  // caller, which is what makes the "hierarchy still on its way" window
  // real instead of a race against a fast stub.
  let release = null;
  const setupPage = async (page) => {
    await stubConfiguration(page);
    const gate = holdHierarchy
      ? new Promise((resolve) => {
          release = resolve;
        })
      : null;
    await stubHierarchy(page, gate);
  };

  // A held hierarchy must not be reloaded for: the reload waits for
  // networkidle, and the held answer never settles it. A held run also
  // gets no settle pause — the spec's own wait is the gate.
  const { ctx, page } = await openWelcomeScreen(browser, {
    setupPage,
    reload: !holdHierarchy,
    ...(holdHierarchy ? {} : { settle: 1500 })
  });

  // The composer appears only once the configuration's buttons are known:
  // it is the signal that the config has been read and applied.
  await page.waitForSelector('[data-testid="welcome-composer"]', { timeout: 15000 });
  return { ctx, page, release };
}

/**
 * Watches the query path. Returns a getter that says whether a query went out.
 */
async function watchQueries(page) {
  let streamed = false;
  await page.route('**/queries/stream**', async (route) => {
    streamed = true;
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
  });
  return () => streamed;
}

test.describe('Quick Help scope states', () => {
  test('the grid waits for the hierarchy, then renders its cards', async ({ browser }) => {
    // The hierarchy is HELD on purpose: the window in which it is on its
    // way is the window the settle-gate governs. Without the gate the grid
    // would render during that window, offering cards whose scope nobody
    // can say is valid — and a click it cannot answer is a dead click.
    const { ctx, page, release } = await openWelcome(browser, { holdHierarchy: true });

    // The configuration is applied (the composer is there) and the hierarchy
    // has not answered: the grid must not exist.
    await expect(page.locator('.quick-help-grid')).toHaveCount(0);

    // Once the hierarchy lands, the grid appears — with its cards in it.
    release();
    const grid = page.locator('.quick-help-grid');
    await expect(grid).toBeVisible({ timeout: 20000 });
    expect(await page.locator('.quick-help-item').count()).toBeGreaterThan(0);

    await ctx.close();
  });

  test('a card whose label the hierarchy cannot name renders the error state and sends nothing', async ({
    browser
  }) => {
    const { ctx, page } = await openWelcome(browser);

    const broken = page.locator('.quick-help-item.config-error');
    const brokenCount = await broken.count();
    expect(brokenCount, 'the spec serves three broken cards').toBeGreaterThan(0);

    // The broken card says so: the icon and the caption naming the problem.
    await expect(broken.first().locator('.config-error-icon')).toBeVisible();
    const caption = broken.first().locator('[data-testid="quick-help-error-caption"]');
    await expect(caption).toBeVisible();
    expect((await caption.innerText()).trim().length).toBeGreaterThan(0);

    // And the click sends NOTHING: no turn, no user message.
    const streamed = await watchQueries(page);
    await broken.first().click();
    await page.waitForTimeout(1200);

    expect(streamed(), 'a broken card must not reach the query path').toBe(false);
    expect(await page.locator('[data-testid="user-avatar"]').count()).toBe(0);

    // The tile guard refuses BEFORE anything is installed: no context item
    // appears, and the welcome screen (which only renders while NO context
    // item is selected) is still there. This is the assertion that tells
    // the tile guard apart from the send-time guard — the send-time guard
    // blocks the query but leaves the chip installed.
    await expect(page.locator('.quick-help-banner')).toBeVisible();

    await ctx.close();
  });

  test('the caption names WHICH part of the scope is gone', async ({ browser }) => {
    const { ctx, page } = await openWelcome(browser);

    // The card whose CATEGORY left the hierarchy, and the card whose LABEL
    // did. Both are broken, and both refuse their click — but they are
    // DIFFERENT problems, and the caption is what tells the operator which
    // half of the configuration to fix. A caption that always named the
    // category (or always the label) would send the operator to the wrong
    // place.
    const gone = page.locator('.quick-help-item.config-error').filter({ hasText: 'Category gone' });
    expect(await gone.count(), 'the card whose category is gone is broken').toBe(1);

    const goneCaption = gone.first().locator('[data-testid="quick-help-error-caption"]');
    await expect(goneCaption).toBeVisible();
    const goneText = (await goneCaption.innerText()).trim();
    expect(goneText.length, 'the caption says something').toBeGreaterThan(0);
    expect(goneText.toLowerCase(), 'the caption names the CATEGORY as the gone thing').toContain('category');
    // The gone LABEL is named — the caption quotes it, so the operator knows
    // WHICH label to fix.
    expect(goneText, 'the caption does not blame a label that is still there').not.toContain('No Such Service');

    const labelGone = page.locator('.quick-help-item.config-error').filter({ hasText: 'Label gone' });
    expect(await labelGone.count(), 'the card whose label is gone is broken').toBe(1);

    const labelCaption = labelGone.first().locator('[data-testid="quick-help-error-caption"]');
    await expect(labelCaption).toBeVisible();
    const labelText = (await labelCaption.innerText()).trim();
    // The gone LABEL is quoted by name — that is the whole point of the
    // caption: the operator sees WHICH label to fix.
    expect(labelText, 'the caption quotes the label that is gone').toContain('No Such Service');
    expect(
      labelText.toLowerCase(),
      'the caption does not blame the category — its legacy KEY resolved'
    ).not.toContain('category');

    await ctx.close();
  });

  test('a card whose title resolves to nothing renders the error state and sends nothing', async ({ browser }) => {
    const { ctx, page } = await openWelcome(browser);

    // The card declares NO scope, so its scope is fine — the missing TITLE
    // is the only thing wrong with it. It must still be a VISIBLE failure:
    // the error class, the warning icon and the caption that says why.
    const card = page.locator('.quick-help-item.config-error.just-chat');
    await expect(card).toHaveCount(1);

    await expect(card.first().locator('.config-error-icon')).toBeVisible();
    const caption = card.first().locator('[data-testid="quick-help-error-caption"]');
    await expect(caption).toBeVisible();
    expect((await caption.innerText()).trim().length).toBeGreaterThan(0);

    // And the click sends NOTHING: no turn, and nothing installed — the
    // welcome screen (which only renders while NO context item is selected)
    // is still there.
    const streamed = await watchQueries(page);
    await card.first().click();
    await page.waitForTimeout(1200);

    expect(streamed(), 'a card with no title must not reach the query path').toBe(false);
    expect(await page.locator('[data-testid="user-avatar"]').count()).toBe(0);
    await expect(page.locator('.quick-help-banner')).toBeVisible();

    await ctx.close();
  });

  test('a healthy card is NOT an error card and its click does reach the query path', async ({ browser }) => {
    const { ctx, page } = await openWelcome(browser);

    // The CONTROL. A spec that stubs every card to "broken" would pass even
    // if the app rendered every card as an error — and a spec that only
    // asserts "nothing was sent" would pass even if NOTHING ever worked.
    const healthy = page.locator('.quick-help-item').filter({ hasText: 'Healthy card' });
    expect(await healthy.count(), 'the healthy card is rendered').toBe(1);
    expect(
      await healthy.first().locator('.config-error-icon').count(),
      'a card whose scope names fine is not an error card'
    ).toBe(0);

    const streamed = await watchQueries(page);
    await healthy.first().click();
    await page.waitForTimeout(1200);

    expect(streamed(), 'a healthy card DOES reach the query path').toBe(true);

    await ctx.close();
  });
});
