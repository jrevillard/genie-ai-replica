// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// E2E: the RAGAS guide's ERRORS chapter is on screen, and it says what
// the code actually does.
//
// David 2026-10-25: "whatever you decide to do with errors and how they
// are mapped to benchmark results must be documented in the embedded guide
// for users".
//
// The jest test proves the component assembles the table from the locale
// tree. THIS test proves the chapter is REACHABLE and renders in a real
// browser session — and, more importantly, that it says the true thing.
//
// The first version of the table was wrong: it claimed a failed row
// carries no metrics and drops out of every mean, and that an abstention
// is never judged and never a metric failure. Both claims were the
// opposite of the code (`samples = entries.map(...)` at
// ragas-suite-service.js:2274 — no filter, so every row reaches the
// judge). So this test asserts the CORRECTED claims are present AND the
// retracted ones are absent — otherwise the guide can drift back into
// lying.
//
// Run against the local build:
//   cd C:/Dev/builds/main && npx playwright test --config=D:/ITU-Gitlab/playwright.config.js

const { test, expect } = require('@playwright/test');
const { getAdminToken } = require('../helpers/auth');
const { createUser, deleteUser } = require('../helpers/keycloak-admin');
const { pinLocale } = require('../helpers/locale');
const BASE_URL = process.env.BASE_URL || 'https://localhost';

const REALM = process.env.KEYCLOAK_REALM || 'genie';
const REPO_NAME = process.env.OKF_SMOKE_REPO_NAME || 'El Salvador';
const USER = 'okf-guide-e2e';
const PW = 'GuideE2ePass123!';

test.describe('the RAGAS guide documents what each error state does to the result', () => {
  let adminToken;
  let userId;

  test.beforeAll(async () => {
    adminToken = await getAdminToken();
    userId = await createUser(adminToken, REALM, {
      username: USER,
      email: 'okf-guide-e2e@example.invalid',
      password: PW,
      realmRoles: ['tools-admin']
    });
  });

  test.afterAll(async () => {
    if (adminToken && userId) await deleteUser(adminToken, REALM, userId);
  });

  test('the errors chapter is reachable and its table renders a row per state', async ({ browser }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, bypassCSP: true });
    // The assertions below read rendered English copy, so the locale must
    // be PINNED — the app resolves it from navigator.language when
    // localStorage has no preference, and a runner with another browser
    // language would render another locale.
    await pinLocale(context, 'en');
    const page = await context.newPage();

    // 1. log in through Keycloak
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForURL('**/protocol/openid-connect/auth**', { timeout: 20000 });
    await page.fill('#username', USER);
    await page.fill('#password', PW);
    await page.click('#kc-login');
    await page.waitForURL(`${BASE_URL}/**`, { timeout: 30000 });

    // 2. the admin dashboard -> OKF Studio -> the repo card's "Testing Lab"
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle', timeout: 30000 });
    const studioTab = page.getByRole('button', { name: /OKF Studio/i }).first();
    await expect(studioTab, 'the OKF Studio tab must be reachable').toBeVisible({ timeout: 20000 });
    await studioTab.click();
    await page.waitForTimeout(1500);

    const card = page.locator('.okf-dashboard__card-wrap', { hasText: REPO_NAME }).first();
    await expect(card, `the ${REPO_NAME} repo card must be listed`).toBeVisible({ timeout: 20000 });
    const testingLab = card.getByRole('button', { name: /Testing Lab/i }).first();
    await expect(testingLab, 'the Testing Lab button must be on the card').toBeVisible({ timeout: 20000 });
    await testingLab.click();

    // 3. the dialog's "RAGAS Benchmarks" tab, then the guide
    const ragasTab = page.getByRole('button', { name: /RAGAS Benchmarks/i }).first();
    await expect(ragasTab, 'the RAGAS Benchmarks tab must be present').toBeVisible({ timeout: 20000 });
    await ragasTab.click();
    await page.waitForTimeout(2000);

    const guideButton = page.locator('.okf-ragas__help-toggle').first();
    await expect(guideButton, 'the Guide button must be in the RAGAS panel').toBeVisible({ timeout: 20000 });
    await guideButton.click();

    // 4. the errors chapter is the SIXTH tab — one per documented state
    //    family, after the five operator chapters.
    //
    //    Scope to the GUIDE dialog by its title: the Testing Lab dialog is
    //    still open behind it and is ALSO a role="dialog" — and it carries
    //    its own tables (the entries parity table), so an unscoped
    //    `table tbody tr` would count the wrong rows.
    const dialog = page
      .locator('.ds-modal')
      .filter({ has: page.getByRole('heading', { name: /RAGAS benchmarking guide/i }) })
      .first();
    await expect(dialog, 'the guide dialog must open').toBeVisible({ timeout: 20000 });

    const errorsTab = dialog
      .locator('.ds-tabs__btn')
      .filter({ hasText: /errors/i })
      .first();
    await expect(errorsTab, 'the guide must have an errors chapter').toBeVisible({ timeout: 20000 });
    await errorsTab.click();
    await page.waitForTimeout(600);

    // 5. THE TABLE — one row per state, with a meaning and an effect.
    //
    //    Scoped to the VISIBLE pane: the guide keeps every chapter in the
    //    DOM (v-show), and the read chapter's own six-row output table is
    //    still in the document.
    const rows = dialog.locator('.okf-guide__pane:visible table tbody tr');
    await expect(rows, 'the mapping must be a table, not prose').toHaveCount(6);

    // innerText, not textContent: the other chapters stay in the DOM
    // (v-show), and only the RENDERED text of this chapter must be read.
    const bodyText = await dialog.evaluate((el) => el.innerText);

    // The state labels an operator looks for.
    for (const label of [
      'errored',
      'abstained',
      'declined, not judged',
      'not measured',
      'below threshold',
      'out of scope'
    ]) {
      expect(bodyText, `the table must carry the "${label}" state`).toContain(label);
    }

    // The CORRECTED claims. These are the ones that were wrong the first
    // time, and they are the whole point of the chapter.
    //
    // A DECLINE is TWO states, not one (2026-10-25). A decline that came
    // WITH an answer was judged and its zeros ARE in the averages; a
    // decline that came with NO answer was never judged at all — it
    // carries no score and it lowers the measured coverage. The guide
    // taught only the first, and its unit test PINNED the false claim.
    // Measured live: 48 of 48 observed abstention rows carry an empty
    // answer, so the second case is the common one.
    expect(bodyText, 'a failed row is NOT handed to the judge').toContain('NOT handed to the judge');
    expect(bodyText, 'a failed row is never counted as a zero').toContain('never counted as a zero');
    expect(bodyText, 'a judged decline IS handed to the judge').toContain('handed to the judge');
    expect(bodyText, 'and its zeros are in the averages').toContain('zeros ARE counted in the averages');
    expect(bodyText, 'an unjudged decline was never handed to the judge').toContain('declined — not judged');
    expect(bodyText, 'the two declines are told apart').toContain('A DECLINE is not one thing but two');

    // The RETRACTED claims must be gone. A guide that says the opposite
    // is worse than no guide at all.
    expect(bodyText, 'a failed row does NOT drop out of the means').not.toMatch(
      /excluded from every mean|no metrics for this row/i
    );
    expect(bodyText, 'an abstention is NOT declared never-a-failure').not.toMatch(/never a metric failure/i);
    // The claim that EVERY row reaches the judge — the errored row does not.
    expect(bodyText, 'a failed row is NOT declared as judged').not.toMatch(
      /The row is still handed to the judge, which scores an empty answer/i
    );
    // And the unconditional "a decline still has an answer" — false for the
    // empty-answer decline.
    expect(bodyText, 'a decline is NOT declared always judged').not.toMatch(/DECLINED still has an answer/i);

    // An out-of-scope control is outside the means and the bar.
    expect(bodyText, 'a control is outside the means').toContain('never inside a mean');

    await page.screenshot({ path: 'test-results/ragas-guide-errors.png', fullPage: false });
    await context.close();
  });
});
