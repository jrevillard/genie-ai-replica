// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// E2E: the RAGAS guide's READ chapter explains how to read the output, and
// a re-score is a RUN — it is tracked, it shows a progress bar, and it can
// be stopped.
//
// David 2026-10-25: "You have not updated the guide to explain how to read
// the 55/100 etc. in the output" and, live, "it also cannot be tracked and
// does not connect to the UI with a progress bar… I cannot stop the
// re-scoring".
//
// The jest tests prove the components assemble the table and that the
// service writes a running doc. THIS test proves it in a real browser
// session against the running build: the chapter is REACHABLE and renders,
// and the re-score's run row appears in the history while it runs.
//
// The re-score is CANCELLED at the end of the test — it must not leave a
// judge leg paying the GPU for the rest of the suite.
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
const USER = 'okf-rescore-e2e';
const PW = 'RescoreE2ePass123!';

test.describe('the RAGAS guide explains the output, and a re-score is a tracked run', () => {
  let adminToken;
  let userId;

  test.beforeAll(async () => {
    adminToken = await getAdminToken();
    userId = await createUser(adminToken, REALM, {
      username: USER,
      email: 'okf-rescore-e2e@example.invalid',
      password: PW,
      realmRoles: ['tools-admin']
    });
  });

  test.afterAll(async () => {
    if (adminToken && userId) await deleteUser(adminToken, REALM, userId);
  });

  test('the read chapter renders the output table, and a re-score is tracked and cancellable', async ({ browser }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, bypassCSP: true });
    // The spec asserts rendered English copy, so the locale must be
    // PINNED — the app resolves it from navigator.language when
    // localStorage holds no preference.
    await pinLocale(context, 'en');
    const page = await context.newPage();

    // 1. log in through Keycloak
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForURL('**/protocol/openid-connect/auth**', { timeout: 20000 });
    await page.fill('#username', USER);
    await page.fill('#password', PW);
    await page.click('#kc-login');
    await page.waitForURL(`${BASE_URL}/**`, { timeout: 30000 });

    // 2. admin -> OKF Studio -> the repo card's "Testing Lab"
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

    // 3. the dialog's "RAGAS Benchmarks" tab
    const ragasTab = page.getByRole('button', { name: /RAGAS Benchmarks/i }).first();
    await expect(ragasTab, 'the RAGAS Benchmarks tab must be present').toBeVisible({ timeout: 20000 });
    await ragasTab.click();
    await page.waitForTimeout(2500);

    const guideButton = page.locator('.okf-ragas__help-toggle').first();
    await expect(guideButton, 'the Guide button must be in the RAGAS panel').toBeVisible({ timeout: 20000 });
    await guideButton.click();

    // Scope to the GUIDE dialog by its heading: the Testing Lab dialog is
    // still open behind it and is ALSO a role="dialog" — and it carries
    // its own tables, so an unscoped `table tbody tr` counts the wrong rows.
    const guide = page
      .locator('.ds-modal')
      .filter({ has: page.getByRole('heading', { name: /RAGAS benchmarking guide/i }) })
      .first();
    await expect(guide, 'the guide dialog must open').toBeVisible({ timeout: 20000 });

    // ---- A. the READ chapter's output table ----
    const readTab = guide
      .locator('.ds-tabs__btn')
      .filter({ hasText: /read the results/i })
      .first();
    await expect(readTab, 'the guide must have a read-the-results chapter').toBeVisible({ timeout: 20000 });
    await readTab.click();
    await page.waitForTimeout(600);

    // The guide keeps EVERY chapter in the DOM (v-show), so a table count
    // must be scoped to the VISIBLE pane — the errors chapter's five rows
    // are still in the document.
    const guideRows = guide.locator('.okf-guide__pane:visible table tbody tr');
    await expect(guideRows, 'the output must be a table').toHaveCount(6);

    const guideText = await guide.evaluate((el) => el.innerText);
    // The on-screen pieces an operator has to decode.
    for (const label of ['The mean', 'The fraction (55/100)', 'The invalid-run banner', 'Re-score']) {
      expect(guideText, `the output table must carry "${label}"`).toContain(label);
    }
    // The three misreadings the table exists to prevent.
    expect(guideText, 'the uncovered rows are never counted as zero').toContain('never counted as zero');
    expect(guideText, 'the banner is a floor, not a summary').toContain('floor, not a summary');
    expect(guideText, 'a running run is still moving').toContain('still moving');

    // Scroll the table into view — the dialog opens at the top of the
    // chapter, and the table is the point of the screenshot.
    await guideRows.first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'test-results/ragas-guide-read.png', fullPage: false });
    await guide
      .getByRole('button', { name: /^Close$/i })
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(800);

    // ---- B. a re-score is TRACKED and CANCELLABLE ----
    // The history lists the runs; the newest DONE one can be re-scored.
    const historyRows = page.locator('.okf-ragas__section table tbody tr');
    await expect(historyRows.first(), 'the run history must list the runs').toBeVisible({ timeout: 20000 });

    // Find the newest row whose status pill says 'done' and click ITS
    // Re-score button — not the first row's, which may be a cancelled run.
    const doneRow = historyRows.filter({ has: page.locator('.ds-pill', { hasText: /^done$/i }) }).first();
    await expect(doneRow, 'a finished run must be in the history').toBeVisible({ timeout: 20000 });
    const sourceKey = (await doneRow.locator('.okf-ragas__run-key').innerText()).trim();

    const rescoreButton = doneRow.getByRole('button', { name: /^Re-score$/ }).first();
    await expect(rescoreButton, 'a finished run must offer Re-score').toBeEnabled({ timeout: 20000 });
    await rescoreButton.click();

    const rescoreDialog = page
      .locator('.ds-modal')
      .filter({ has: page.getByRole('heading', { name: /re-score with a judge/i }) })
      .first();
    await expect(rescoreDialog, 'the re-score dialog must open').toBeVisible({ timeout: 20000 });

    // The ENV judge = the sidecar's default = the deployment's granite.
    const judgeSelect = rescoreDialog.locator('select').first();
    await expect(judgeSelect, 'the re-score dialog must offer a judge').toBeVisible({ timeout: 20000 });
    await judgeSelect.selectOption('__env__');

    await rescoreDialog
      .getByRole('button', { name: /^Re-score$/ })
      .first()
      .click();
    await page.waitForTimeout(3000);

    // The re-score is a RUN: a progress bar and a Cancel button.
    const cancelRun = page.getByRole('button', { name: /cancel run/i }).first();
    await expect(cancelRun, 'the re-score must offer a Cancel run button').toBeVisible({ timeout: 20000 });
    await expect(page.locator('.okf-ragas__progress'), 'the re-score must show a progress bar').toBeVisible({
      timeout: 20000
    });

    // And it is TRACKED — a row for the new run appears in the history,
    // with the lineage back to the source run.
    const newRow = historyRows.filter({ hasText: /re-scored from/i }).first();
    await expect(newRow, 'the new re-score must appear in the run history').toBeVisible({ timeout: 30000 });
    await expect(newRow, 'the new row must name the source run').toContainText(sourceKey);
    await page.screenshot({ path: 'test-results/ragas-rescore-running.png', fullPage: false });

    // ---- C. and it can be STOPPED ----
    await cancelRun.click();
    await page.waitForTimeout(4000);

    // The row lands 'cancelled' — never 'failed', and it does not vanish.
    const cancelledRow = historyRows.filter({ hasText: /re-scored from/i }).first();
    await expect(cancelledRow, 'the cancelled re-score must stay in the history').toBeVisible({ timeout: 30000 });
    await expect(cancelledRow.locator('.ds-pill').first(), 'the cancelled re-score must read cancelled').toContainText(
      /cancelled/i,
      { timeout: 30000 }
    );

    await page.screenshot({ path: 'test-results/ragas-rescore-cancelled.png', fullPage: false });
    await context.close();
  });
});
