// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// E2E: the OKF CONCEPT-DOCUMENT CEILING in the Studio's concept editor.
//
// WHY THIS SPEC EXISTS: the ceiling has to be VISIBLE before the curator
// hits it, and a refusal has to say WHY. A generic "Save failed — retry"
// is advice that cannot work for an over-ceiling save — the retry fails
// identically forever — so the editor renders the server's own message.
//
// The claims this spec proves, in a real browser:
//
//   1. the advisory carries the SERVER's ceiling (the number that rides the
//      concept read), never a copy in the frontend — so the advice cannot
//      contradict the refusal that follows;
//   2. it turns into the WARNING state while the curator is still typing,
//      i.e. before the save is refused;
//   3. a refused save shows the SERVER'S message — the size, the ceiling and
//      the remedy — and NOT the generic retry wording.
//
// The payloads are INJECTED (page.route), the same measure-don't-look rule
// as admin/logs-view.spec.js: the ceiling on screen can only have come from
// the intercepted response, and the interception is what makes the
// over-ceiling state reachable without typing a quarter-megabyte of text.
//
// WHY IT LIVES HERE (tests/e2e/okf/): the Studio only exists on an
// OKF-enabled deployment (OKF_ENABLED=1). The local run executes the whole
// tree — this directory included — against whatever venue it is pointed at,
// so on a core-profile venue the spec skips ITSELF, with the venue's own
// profile as the reason (#1742).
//
// Run against the local build (OKF_ENABLED=1):
//   cd C:/Dev/builds/main && npx playwright test \
//     --config=D:/ITU-Gitlab/playwright.config.js tests/e2e/okf/concept-ceiling.spec.js

const { test, expect } = require('@playwright/test');
const { loginViaUI, BASE_URL } = require('../helpers/chatbot');
const { okfEnabled, okfParkedReason } = require('../helpers/venue-profile');

/**
 * WHO LOGS IN.
 *
 * The Studio's repository list is scope-gated by okf-server ("OKF authz
 * denied: no okf scope"), and the e2e fixture user (`testadmin`) carries the
 * `admin` REALM role but no `okf_scopes` attribute — so the Studio renders
 * EMPTY lanes for it and this spec has nothing to drive.
 *
 * The account the Studio actually works with is the deployment's own admin
 * (`genie-admin`), which carries the `okf:*:*:admin` wildcard. Its
 * credentials come from the environment (the local build's `.env` carries
 * them; the Playwright config loads dotenv from the CWD, so running from
 * the build tree picks them up).
 */
const ADMIN_USER = {
  username: process.env.GENIE_ADMIN_USERNAME || 'genie-admin',
  password: process.env.GENIE_ADMIN_PASSWORD || ''
};

/** The ceiling the stubbed server enforces. Small, so the over-ceiling state
 *  is reachable with a realistic amount of text. */
const CEILING = 100;
/** The body the stubbed concept carries — 40 characters, under the ceiling. */
const BODY = 'x'.repeat(40);
const CONCEPT_ID = 'alpha';

/** The stubbed concept read — the same shape the server answers, including
 *  the `max_doc_chars` the editor's advisory rides. */
const CONCEPT = {
  concept_id: CONCEPT_ID,
  frontmatter: { type: 'topic', title: 'Alpha' },
  body: BODY,
  max_doc_chars: CEILING
};

/**
 * Open the Studio at a repository and select a concept, so the concept
 * editor is on screen. Returns the captured PATCH bodies.
 */
async function openEditor(page) {
  const patches = [];

  // The concept read — intercepted so the ceiling and the body are known.
  // The pattern matches ANY concept id (the LIST is a different URL — it has
  // no trailing segment — so it is not intercepted, and the real repository's
  // own concepts are what the curator sees in the tree).
  await page.route('**/api/okf/repos/*/concepts/*', (route) => {
    if (route.request().method() === 'PATCH') {
      patches.push(route.request().postData());
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'CONCEPT_TOO_LARGE',
          message: `concept "${CONCEPT_ID}" is 101 characters, over the ${CEILING}-character ceiling. Split it.`
        })
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(CONCEPT)
    });
  });

  await loginViaUI(page, ADMIN_USER);
  await page.goto(`${BASE_URL}/admin?tab=studio`, { waitUntil: 'networkidle', timeout: 30000 });

  // The studio's repository list → the first repository card.
  const card = page.locator('[data-test-id^="okf-studio-repo-"]').first();
  await expect(card).toBeVisible({ timeout: 15000 });
  await card.click();

  // The repo editor's "Editor" sub-tab → the concept list.
  const editorTab = page.locator('[data-test-id="ds-tab-editor"]');
  await expect(editorTab).toBeVisible({ timeout: 15000 });
  await editorTab.click();

  // The concept list → the first concept (WHICH concept is irrelevant: the
  // read is intercepted, so the editor always opens the stub).
  const row = page.locator('[data-test-id^="okf-concept-row-"]').first();
  await expect(row).toBeVisible({ timeout: 15000 });
  await row.click();

  await expect(page.locator('[data-test-id="okf-concept-editor"]')).toBeVisible({ timeout: 15000 });
  return patches;
}

test.describe('the concept-document ceiling in the concept editor', () => {
  // The advisory's label is translated (okf.editor.ceiling); pin the locale
  // so the exact wording is fixed.
  test.use({ locale: 'en-US' });

  // The Studio's concept editor is an OKF surface: a deployment whose OKF
  // pillar is parked does not render it, and this spec would fail looking
  // for a surface that never appears. It SKIPS WITH A REASON instead
  // (#1742), and the reason is the venue's own profile — read from the
  // runtime config the frontend itself reads — not a guess.
  test.beforeEach(async () => {
    test.skip(!(await okfEnabled()), await okfParkedReason());
  });

  test("the advisory carries the SERVER's ceiling", async ({ page }) => {
    await openEditor(page);

    const advisory = page.locator('[data-test-id="concept-ceiling"]');
    await expect(advisory).toBeVisible({ timeout: 15000 });

    // The character count is measured on the BODY the editor holds — not on
    // the whole markdown (the frontmatter is metadata the ceiling does not
    // describe). Derive it from the editor's own content rather than
    // hardcoding a number: the assertion is the INVARIANT, and a hardcoded
    // count would be a table written before the layout existed.
    const markdown = await page.locator('[data-test-id="okf-md-body"]').inputValue();
    const body = markdown.replace(/^---\n[\s\S]*?\n---\n?/, '');
    expect(body.length, "the stub body must be the editor's body").toBeGreaterThan(0);

    // The number on screen is the SERVER's ceiling (the injected
    // `max_doc_chars`) and the body's own length.
    await expect(advisory).toContainText(String(CEILING));
    await expect(advisory).toHaveText(`${body.length} / ${CEILING} characters`);
  });

  test('going OVER the ceiling turns the warning on BEFORE the save is refused', async ({ page }) => {
    await openEditor(page);

    const advisory = page.locator('[data-test-id="concept-ceiling"]');
    await expect(advisory).toBeVisible({ timeout: 15000 });
    // Not yet over: the neutral state.
    await expect(advisory.locator('.ds-pill--warning')).toHaveCount(0);

    // Type a body over the ceiling — the real interaction, through the
    // browser's input path.
    const editor = page.locator('[data-test-id="okf-md-body"]');
    await expect(editor).toBeVisible({ timeout: 15000 });
    await editor.fill('y'.repeat(CEILING + 1));

    // The warning is on, and the curator is told what to do.
    await expect(advisory.locator('.ds-pill--warning')).toHaveCount(1);
    await expect(advisory).toContainText('Over the limit');
  });

  test('a refused save shows the SERVER\'s message, not "retry"', async ({ page }) => {
    const patches = await openEditor(page);

    const editor = page.locator('[data-test-id="okf-md-body"]');
    await expect(editor).toBeVisible({ timeout: 15000 });
    await editor.fill('z'.repeat(50));

    // Force the save (the autosave is debounced; the button is explicit).
    const save = page.locator('[data-test-id="okf-concept-save"]');
    await expect(save).toBeEnabled({ timeout: 15000 });
    await save.click();

    // The PATCH really went out — the assertion below is about what the
    // curator SEES because of it.
    await expect.poll(() => patches.length, { timeout: 15000 }).toBeGreaterThan(0);

    const status = page.locator('[data-test-id="okf-concept-save-status"]');
    await expect(status).toContainText('101 characters', { timeout: 15000 });
    await expect(status).toContainText(`${CEILING}-character ceiling`);
    // The generic wording is the WRONG advice for this refusal.
    await expect(status).not.toContainText('retry');
  });
});
