// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// E2E: the RAGAS judge/model selector is VISIBLE in the running UI.
//
// David 2026-10-25: "you removed the model selection from the RAGAS
// generation and benchmarking ... Put it back and make sure it INCLUDES
// the default configured model from the .env as an OPTION."
//
// The defect had two halves and the unit tests could only see one of them:
// the panel renders the judge dropdown only when a judge can be chosen
// (`hasJudgeChoice`), and `hasJudgeChoice` needs the configuration list —
// which used to 403 for anyone without tools-admin. The unit test proves
// the panel renders from a given envelope; THIS test proves the envelope
// ARRIVES in a real browser session and the dropdown is on the screen.
//
// It walks the real path an operator walks:
//   /admin -> OKF Studio -> the repo card's "Testing Lab" ->
//   the dialog's "RAGAS Benchmarks" tab -> the judge dropdown.
//
// Run against the local build:
//   cd C:/Dev/builds/main && npx playwright test --config=D:/ITU-Gitlab/playwright.config.js

const { test, expect } = require('@playwright/test');
const { getAdminToken, request } = require('../helpers/auth');
const { createUser, deleteUser } = require('../helpers/keycloak-admin');
const BASE_URL = process.env.BASE_URL || 'https://localhost';

const REALM = process.env.KEYCLOAK_REALM || 'genie';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID || 'genie-app';
const REPO_NAME = process.env.OKF_SMOKE_REPO_NAME || 'El Salvador';
const USER = 'okf-judge-e2e';
const PW = 'JudgeE2ePass123!';

test.describe('the RAGAS model selection is in the UI', () => {
  let adminToken;
  let userId;

  test.beforeAll(async () => {
    adminToken = await getAdminToken();
    userId = await createUser(adminToken, REALM, {
      username: USER,
      email: 'okf-judge-e2e@example.invalid',
      password: PW,
      realmRoles: ['tools-admin']
    });
  });

  test.afterAll(async () => {
    if (adminToken && userId) await deleteUser(adminToken, REALM, userId);
  });

  test('the judge dropdown is on screen in the RAGAS Benchmarks tab, with the .env default among its options', async ({
    browser
  }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, bypassCSP: true });
    const page = await context.newPage();

    // 1. log in through Keycloak
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForURL('**/protocol/openid-connect/auth**', { timeout: 20000 });
    await page.fill('#username', USER);
    await page.fill('#password', PW);
    await page.click('#kc-login');
    await page.waitForURL(`${BASE_URL}/**`, { timeout: 30000 });

    // 2. the admin dashboard -> OKF Studio
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle', timeout: 30000 });
    const studioTab = page.getByRole('button', { name: /OKF Studio/i }).first();
    await expect(studioTab, 'the OKF Studio tab must be reachable').toBeVisible({ timeout: 20000 });
    await studioTab.click();
    await page.waitForTimeout(1500);

    // 3. the repo card -> Testing Lab (the dialog that carries the Benchmarks tab)
    const card = page.locator('.okf-dashboard__card-wrap', { hasText: REPO_NAME }).first();
    await expect(card, `the ${REPO_NAME} repo card must be listed`).toBeVisible({ timeout: 20000 });
    const testingLab = card.getByRole('button', { name: /Testing Lab/i }).first();
    await expect(testingLab, 'the Testing Lab button must be on the card').toBeVisible({ timeout: 20000 });
    await testingLab.click();

    // 4. the dialog's "RAGAS Benchmarks" tab
    const ragasTab = page.getByRole('button', { name: /RAGAS Benchmarks/i }).first();
    await expect(ragasTab, 'the RAGAS Benchmarks tab must be present').toBeVisible({ timeout: 20000 });
    await ragasTab.click();
    await page.waitForTimeout(2500);

    // 5. THE ASSERTION — the judge dropdown, with the env default among its
    // options, in BOTH the generation form and the benchmark-run form.
    // David 2026-10-25: "put it back for both generation and benchmark, run".
    const judgeSelects = page.locator('select').filter({ has: page.locator('option[value="__env__"]') });
    const count = await judgeSelects.count();
    expect(count, 'the judge/model selector must be rendered in BOTH the generation and the run form').toBe(2);

    for (let i = 0; i < count; i += 1) {
      const options = await judgeSelects
        .nth(i)
        .locator('option')
        .evaluateAll((els) => els.map((e) => ({ value: e.value, label: e.textContent.trim() })));
      const envOption = options.find((o) => o.value === '__env__');
      expect(envOption, `the .env default judge must be one of the options (select ${i})`).toBeTruthy();
      expect(envOption.label, 'the env option must NAME the model it resolves to').toMatch(/\(.+\)/);
      // The named configurations must be there too — the same envelope.
      expect(options.length, `the named configurations must be listed (select ${i})`).toBeGreaterThan(1);
    }

    await page.screenshot({ path: 'test-results/ragas-judge-selector.png', fullPage: false });
    await context.close();
  });

  test('the admin Models tab lists the configured models — the same envelope feeds it', async ({ browser }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, bypassCSP: true });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForURL('**/protocol/openid-connect/auth**', { timeout: 20000 });
    await page.fill('#username', USER);
    await page.fill('#password', PW);
    await page.click('#kc-login');
    await page.waitForURL(`${BASE_URL}/**`, { timeout: 30000 });

    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle', timeout: 30000 });
    const modelsTab = page.getByRole('button', { name: /^Models$/i }).first();
    await expect(modelsTab, 'the Models tab must be reachable').toBeVisible({ timeout: 20000 });
    await modelsTab.click();
    await page.waitForTimeout(2000);

    // The named configurations must be ON SCREEN — the tab read `res.configs`
    // from the same broken envelope and was blank for the same reason.
    const bodyText = await page.evaluate(() => document.body.innerText);
    expect(bodyText, 'the Models tab must list the configured models').toMatch(/GLM-5\.3|Minimax|Deepseek/i);

    await page.screenshot({ path: 'test-results/okf-models-tab.png', fullPage: false });
    await context.close();
  });
});
