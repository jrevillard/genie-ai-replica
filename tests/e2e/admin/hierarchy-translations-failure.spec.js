const { test, expect } = require('@playwright/test');
const { loginViaUI, BASE_URL, TEST_ADMIN_USER, LOGIN_BUDGET_TIMEOUT_MS } = require('../helpers/chatbot');

/**
 * The hierarchy edit form's failed-translations dead-end (#1578, the UI
 * #1400 shipped) — rendered in a real browser from INJECTED answers.
 *
 * WHY THIS SPEC EXISTS: the dead-end state (persistent failure notice, Retry
 * action, disabled translation rows and Save) ships with Jest coverage whose
 * stubs render the disabled bindings in jsdom. No Playwright spec pinned the
 * RENDERED behaviour: a refactor that breaks the `:disabled` bindings or the
 * notice's `v-if` passes the jsdom suite and ships an editable dead-end form
 * — the exact regression #1400 fixed — with no gate turning red.
 *
 * The claims this spec proves, in a real browser:
 *
 *   1. a failed translations load renders the notice with its exact copy and
 *      DISABLES the translation rows, the Add-Translation action and Save
 *      (the dead-end is honest: nothing editable would let a save wipe the
 *      translations it failed to load);
 *   2. the Retry action recovers: a succeeding reload re-enables every
 *      control and populates the rows from the server answer, and the
 *      notice disappears;
 *   3. a healthy load renders NO notice — the absence half of the contract.
 *
 * The tree and the translations are INJECTED (page.route): the venue's real
 * hierarchy data plays no part, so the spec is its own seed and its own
 * cleanup.
 */

const CATEGORY_ID = 'cat-e2e';
const CATEGORY_NAME = 'E2E Hierarchy Category';

/** The tree the admin endpoint answers — one category, whose edit button the
 *  handle `hierarchy-edit-category-<catKey>` addresses. */
const TREE = [{ catKey: CATEGORY_ID, nameEN: CATEGORY_NAME, children: [] }];

/** The translations the recovery load answers — one non-English row (the en
 *  row is filtered out client-side, so a healthy form renders exactly this). */
const TRANSLATIONS = [{ lang: 'es', text: 'Hola' }];

/** The notice's exact copy (the en locale's
 *  `admin.hierarchy.translationsLoadFailedNotice`). */
const NOTICE_COPY =
  'Translations could not be loaded. Editing the translations and saving stay disabled until they load.';

/** The dead-end controls, by their own handles (row 0 of the form). */
const DEAD_END_CONTROLS = [
  '[data-test-id="hierarchy-translation-lang-0"]',
  '[data-test-id="hierarchy-translation-text-0"]',
  '[data-test-id="hierarchy-translation-add"]',
  '[data-test-id="hierarchy-save"]'
];

/**
 * Log in, open the hierarchy tab with the tree answering the injected
 * category, and open its edit form with `translationsStatus` as the
 * translations endpoint's verdict.
 */
async function openEditForm(page, translationsStatus, translationsBody) {
  // The deployment's locale whitelist feeds the translation-lang select's
  // options (languageConfig.getAvailableLanguages reads
  // window.APP_CONFIG.availableLocales), so on a whitelisted venue the
  // recovered row's 'es' value would have no option to land on and the
  // select would silently hold ''. The whitelist is rewritten IN the
  // venue's own runtime config — every other value (the OIDC origin, the
  // client id) stays the venue's — so the form's language set is the
  // deployment-independent fixture this spec's payload assumes.
  await page.route('**/runtime/config.js', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(/availableLocales:\s*"[^"]*"/, 'availableLocales: "en,es"');
    await route.fulfill({ response, body });
  });
  await page.route('**/api/service-categories/categories/detailed*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(TREE)
    })
  );
  await page.route(`**/api/service-categories/${CATEGORY_ID}/translations`, (route) =>
    route.fulfill({
      status: translationsStatus,
      contentType: 'application/json',
      body: JSON.stringify(translationsBody)
    })
  );

  await loginViaUI(page, TEST_ADMIN_USER);
  await page.goto(`${BASE_URL}/admin?tab=hierarchy`, { waitUntil: 'networkidle', timeout: 30000 });

  const editButton = page.locator(`[data-test-id="hierarchy-edit-category-${CATEGORY_ID}"]`);
  await expect(editButton).toBeVisible({ timeout: 15000 });
  await editButton.click();
}

test.describe('Hierarchy form failed-translations dead-end', () => {
  // The login helper's own worst case (two attempts, navigation + redirect
  // waits) exceeds two minutes: a shorter ceiling would fire first and hide
  // the helper's diagnosis behind a bare timeout. LOGIN_BUDGET_TIMEOUT_MS is
  // the ONE owner of the derivation (helpers/chatbot.js).
  test.setTimeout(LOGIN_BUDGET_TIMEOUT_MS);

  test('renders the notice, disables the controls, and recovers on Retry', async ({ page }) => {
    await openEditForm(page, 500, { error: 'INTERNAL_ERROR', message: 'translations unavailable' });

    // The dead-end notice, verbatim — the visible failure the curator reads.
    const notice = page.locator('[data-test-id="hierarchy-translations-load-failed"]');
    await expect(notice).toBeVisible({ timeout: 15000 });
    await expect(notice).toContainText(NOTICE_COPY);

    // Every mutating control is DISABLED: the dead-end is honest. An
    // editable row here is the exact regression #1400 fixed — a save from
    // it would wipe every translation the failed load could not show.
    for (const control of DEAD_END_CONTROLS) {
      await expect(page.locator(control)).toBeDisabled();
    }

    // Recovery: the same endpoint now answers with the rows.
    await page.unroute(`**/api/service-categories/${CATEGORY_ID}/translations`);
    await page.route(`**/api/service-categories/${CATEGORY_ID}/translations`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(TRANSLATIONS)
      })
    );

    await page.locator('[data-test-id="hierarchy-translations-retry"]').click();

    // The notice is GONE — strictly zero, not "not visible right now".
    await expect(page.locator('[data-test-id="hierarchy-translations-load-failed"]')).toHaveCount(0);

    // The rows are re-enabled and POPULATED from the server answer: the
    // recovery re-rendered from a successful load, which the value proves
    // (a failed recovery would leave the placeholder row's empty values).
    for (const control of DEAD_END_CONTROLS) {
      await expect(page.locator(control)).toBeEnabled();
    }
    await expect(page.locator('[data-test-id="hierarchy-translation-lang-0"]')).toHaveValue('es');
    await expect(page.locator('[data-test-id="hierarchy-translation-text-0"]')).toHaveValue('Hola');
  });

  test('renders no notice and leaves the controls editable on a healthy load', async ({ page }) => {
    await openEditForm(page, 200, TRANSLATIONS);

    // The healthy half: no notice — strictly zero.
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-test-id="hierarchy-translations-load-failed"]')).toHaveCount(0);

    // The controls are editable, and the rows carry the server's answer.
    for (const control of DEAD_END_CONTROLS) {
      await expect(page.locator(control)).toBeEnabled();
    }
    await expect(page.locator('[data-test-id="hierarchy-translation-lang-0"]')).toHaveValue('es');
    await expect(page.locator('[data-test-id="hierarchy-translation-text-0"]')).toHaveValue('Hola');
  });
});
