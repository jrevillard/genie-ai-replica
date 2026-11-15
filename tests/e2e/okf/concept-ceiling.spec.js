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
const { LOGIN_BUDGET_TIMEOUT_MS } = require('../helpers/chatbot');
const { openStudioRepo, stubStudioRepoRoutes } = require('../helpers/okf-studio');
const { runRouteHandler } = require('../helpers/route');
const { okfEnabled, okfParkedReason, skipUnlessVenue } = require('../helpers/venue-profile');

/**
 * WHO LOGS IN.
 *
 * The Studio's repository list is scope-gated by okf-server ("OKF authz
 * denied: no okf scope"), and the e2e fixture user (`testadmin`) carries the
 * `admin` REALM role but no `okf_scopes` attribute — so the Studio renders
 * EMPTY lanes for it and this spec has nothing to drive. The deployment's
 * own admin (`genie-admin`) carries the `okf:*:*:admin` wildcard: the
 * shared scaffold's `openStudioRepo` logs in as it (helpers/okf-studio.js,
 * #1841 — the credential block and the open-a-repo walk live there now).
 */
const REPO_ID = 'e2e-concept-ceiling-repo';

/** The stubbed repository the dashboard lists. */
const REPO = {
  repo_id: REPO_ID,
  name: 'E2E Concept Ceiling Repo',
  lifecycle_state: 'draft',
  concept_count: 1,
  version: 1
};

/** The concepts list the Studio's tree renders — one row, so the editor has
 *  a concept to open (the read below is intercepted; WHICH concept the row
 *  names is irrelevant). */
const CONCEPTS = [{ concept_id: 'alpha', title: 'Alpha', is_index: false }];

/** A draft the editor resumes without complaint (the wizard step the shell
 *  opens on is irrelevant: this spec clicks the Editor sub-tab itself). */
const DRAFT = {
  name: REPO.name,
  domain: '',
  concept_count: 1,
  studio_step: 0,
  updated_at: 1700000000000
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

  // The Studio's transport-shaped scaffolding (repos list, draft, concepts
  // list) is the shared helper's; this spec's fixture rides `conceptsBody`.
  await stubStudioRepoRoutes(page, { repoId: REPO_ID, repo: REPO, draftBody: DRAFT, conceptsBody: CONCEPTS });

  // The concept read — intercepted so the ceiling and the body are known.
  // The pattern matches ANY concept id (the LIST is a different URL — it has
  // no trailing segment — so it is not intercepted, and the stubbed list is
  // what the curator sees in the tree).
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

  await openStudioRepo(page, REPO_ID);

  // The repo editor's "Editor" sub-tab → the concept list.
  const editorTab = page.locator('[data-test-id="ds-tab-editor"]');
  await expect(editorTab).toBeVisible({ timeout: 15000 });
  await editorTab.click();

  // The concept list → the stubbed concept (WHICH concept is irrelevant: the
  // read is intercepted, so the editor always opens the stub).
  const row = page.locator('[data-test-id^="okf-concept-row-"]').first();
  await expect(row).toBeVisible({ timeout: 15000 });
  await row.click();

  await expect(page.locator('[data-test-id="okf-concept-editor"]')).toBeVisible({ timeout: 15000 });

  // The editor opens RENDERED by default since #1634 (the raw textarea is
  // v-if'd out in the preview view — #1884). These tests' subject is the RAW
  // body (the advisory's character count, the typed over-ceiling text), so
  // the walk switches to Source mode through the toggle handle the component
  // now declares.
  await page.locator('[data-test-id="okf-concept-view-source"]').click();
  await expect(page.locator('[data-test-id="okf-md-body"]')).toBeVisible({ timeout: 15000 });

  return patches;
}

test.describe('the concept-document ceiling in the concept editor', () => {
  // The advisory's label is translated (okf.editor.ceiling); pin the locale
  // so the exact wording is fixed.
  test.use({ locale: 'en-US' });

  // The editor opens behind a browser login — the budget is the login's
  // own ceiling, derived once beside loginViaUI (#1798).
  test.describe.configure({ timeout: LOGIN_BUDGET_TIMEOUT_MS });

  // The Studio's concept editor is an OKF surface: a deployment whose OKF
  // pillar is parked does not render it, and this spec would fail looking
  // for a surface that never appears. It SKIPS WITH A REASON instead
  // (#1742), and the reason is the venue's own profile — read from the
  // runtime config the frontend itself reads — not a guess.
  test.beforeEach(skipUnlessVenue(test, okfEnabled, okfParkedReason));

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
    // `max_doc_chars`) and the body's own length, pinned EXACTLY on the
    // advisory's status pill (`[data-state]`, the DsPill the count is
    // rendered in) — the advisory also carries the #1577 split affordance
    // beside it, so the whole-container text is no longer the count alone.
    await expect(advisory.locator('[data-state]')).toHaveText(`${body.length} / ${CEILING} characters`);
  });

  test('going OVER the ceiling turns the warning on BEFORE the save is refused', async ({ page }) => {
    await openEditor(page);

    const advisory = page.locator('[data-test-id="concept-ceiling"]');
    await expect(advisory).toBeVisible({ timeout: 15000 });
    // Not yet over: the neutral state.
    await expect(advisory.locator('[data-state="warning"]')).toHaveCount(0);

    // Type a body over the ceiling — the real interaction, through the
    // browser's input path (the walk's own wait gates the editor's
    // presence; fill() auto-waits on top of it).
    await page.locator('[data-test-id="okf-md-body"]').fill('y'.repeat(CEILING + 1));

    // The warning is on, and the curator is told what to do.
    await expect(advisory.locator('[data-state="warning"]')).toHaveCount(1);
    await expect(advisory).toContainText('Over the limit');
  });

  test('a refused save shows the SERVER\'s message, not "retry"', async ({ page }) => {
    const patches = await openEditor(page);

    // The text this test types — ONE constant, filled and asserted, so the
    // #1877 stale-body check below can never drift from what was typed.
    const EDITED_BODY = 'z'.repeat(50);
    await page.locator('[data-test-id="okf-md-body"]').fill(EDITED_BODY);

    // Force the save (the autosave is debounced; the button is explicit).
    const save = page.locator('[data-test-id="okf-concept-save"]');
    await expect(save).toBeEnabled({ timeout: 15000 });
    await save.click();

    // The PATCH really went out — the assertions below are about what the
    // curator SEES because of it.
    await expect.poll(() => patches.length, { timeout: 15000 }).toBeGreaterThan(0);

    // AND the save carries THE EDITED TEXT (#1877): a positive PATCH count
    // proves nothing about WHAT was saved — a stale-body regression (the
    // editor PATCHing the pre-edit text while rendering the edited text)
    // must fail here, not pass. The editor's content at save time is the
    // filled body, so every captured PATCH — the `{ body }` write of an
    // unchanged frontmatter or the `{ markdown }` write of a full page —
    // must carry exactly it.
    const stale = patches
      .map((raw) => JSON.parse(raw))
      .filter((payload) => (payload.body ?? payload.markdown) !== EDITED_BODY);
    expect(stale, 'every PATCH must carry the edited body, not the pre-edit one').toEqual([]);

    const status = page.locator('[data-test-id="okf-concept-save-status"]');
    await expect(status).toContainText('101 characters', { timeout: 15000 });
    await expect(status).toContainText(`${CEILING}-character ceiling`);
    // The generic wording is the WRONG advice for this refusal.
    await expect(status).not.toContainText('retry');
  });
});

// ── #1577 story 2 — the split affordance (CAP-3 "legible before") ───────────
//
// The claims this describe proves, in a real browser:
//
//   1. the split dialog renders the SERVER's seam preview — per-part ids and
//      sizes plus the ceiling — BEFORE any write: a preview issues ZERO split
//      POSTs;
//   2. confirming POSTs the split once and closes the dialog;
//   3. a typed refusal renders the SERVER's message verbatim with confirm
//      disabled — the corpus never changes from a refused preview.
//
// The preview and the write are INJECTED (page.route), the same
// measure-don't-look rule as the ceiling describe above: what the dialog
// shows can only have come from the intercepted preview.

/** The INJECTED split plan — the preview endpoint's answer. Part 1 keeps the
 *  original id (CAP-1's identity contract); part 2 takes the -part-2 suffix. */
const SPLIT_PLAN = {
  ok: true,
  concept_id: CONCEPT_ID,
  ceiling: CEILING,
  body_chars: 140,
  parts: [
    { concept_id: CONCEPT_ID, path: `${CONCEPT_ID}.md`, title: 'Alpha', chars: 90 },
    {
      concept_id: `${CONCEPT_ID}-part-2`,
      path: `${CONCEPT_ID}-part-2.md`,
      title: 'Alpha — part 2',
      chars: 50
    }
  ]
};

/**
 * Stub the split surface for one test: the preview GET answers `preview`
 * (either {status: 200, body} or an HTTP refusal {status, error, message});
 * the split POST captures every write and answers the story-1 summary.
 */
async function stubSplitRoutes(page, preview) {
  const previews = [];
  const splits = [];
  await page.route(
    '**/api/okf/repos/*/concepts/*/split-preview',
    runRouteHandler(page, (route) => {
      previews.push(route.request().url());
      if (preview.status !== 200) {
        return route.fulfill({
          status: preview.status,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: preview.error, message: preview.message })
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(preview.body) });
    })
  );
  await page.route(
    '**/api/okf/repos/*/concepts/*/split',
    runRouteHandler(page, (route) => {
      splits.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, concept_id: CONCEPT_ID, parts: SPLIT_PLAN.parts, created: 1, updated: 1 })
      });
    })
  );
  return { previews, splits };
}

/**
 * Open the editor (the ceiling describe's own walk), then open the split
 * dialog from the TREE ROW. Hover first: the row actions render on hover
 * only, so the split glyph is invisible until the row is hovered.
 */
async function openSplitDialog(page, preview) {
  const captured = await stubSplitRoutes(page, preview);
  await stubStudioRepoRoutes(page, { repoId: REPO_ID, repo: REPO, draftBody: DRAFT, conceptsBody: CONCEPTS });
  await page.route(
    '**/api/okf/repos/*/concepts/*',
    runRouteHandler(page, (route) => {
      if (route.request().method() === 'PATCH') {
        return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({}) });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(CONCEPT)
      });
    })
  );

  await openStudioRepo(page, REPO_ID);
  const editorTab = page.locator('[data-test-id="ds-tab-editor"]');
  await expect(editorTab).toBeVisible({ timeout: 15000 });
  await editorTab.click();
  const row = page.locator(`[data-test-id="okf-concept-row-${CONCEPT_ID}"]`);
  await expect(row).toBeVisible({ timeout: 15000 });
  await row.hover();
  await row.locator('[data-test-id="okf-concept-split"]').click();
  await expect(page.locator('[data-test-id="okf-split-preview"]')).toBeVisible({ timeout: 15000 });
  return captured;
}

test.describe('the split affordance in the concept editor (#1577 story 2)', () => {
  test.use({ locale: 'en-US' });
  test.describe.configure({ timeout: LOGIN_BUDGET_TIMEOUT_MS });
  test.beforeEach(skipUnlessVenue(test, okfEnabled, okfParkedReason));

  test('the dialog renders the seam preview BEFORE any write', async ({ page }) => {
    const { previews, splits } = await openSplitDialog(page, { status: 200, body: SPLIT_PLAN });

    // The plan landed (the rows exist only once the preview fetch resolved).
    const rows = page.locator('[data-test-id="okf-split-part-row"]');
    await expect(rows).toHaveCount(2, { timeout: 15000 });
    await expect(rows.nth(0)).toContainText(CONCEPT_ID); // part 1 keeps the id
    await expect(rows.nth(1)).toContainText(`${CONCEPT_ID}-part-2`); // part 2 takes the suffix
    await expect(page.locator('[data-test-id="okf-split-preview"]')).toContainText(String(CEILING));
    // The preview ran exactly once — it is what the dialog shows.
    await expect(previews.length).toBe(1);

    // Confirm armed on a landed plan...
    await expect(page.locator('[data-test-id="okf-split-confirm"]')).toBeEnabled();
    // ...and THE CAP-3 pin: a preview is not a write — the POST never ran.
    await expect(splits.length).toBe(0);
  });

  test('confirming POSTs the split once and closes the dialog', async ({ page }) => {
    const { splits } = await openSplitDialog(page, { status: 200, body: SPLIT_PLAN });

    await page.locator('[data-test-id="okf-split-confirm"]').click();

    // THE write ran exactly once...
    await expect.poll(() => splits.length, { timeout: 15000 }).toBe(1);
    // ...and the dialog closed on success.
    await expect(page.locator('[data-test-id="okf-split-preview"]')).toBeHidden({ timeout: 15000 });
  });

  test('a typed refusal renders the SERVER message verbatim and confirm stays disabled', async ({ page }) => {
    const { previews, splits } = await openSplitDialog(page, {
      status: 409,
      error: 'PART_ID_CONFLICT',
      message:
        'splitting concept "alpha" would overwrite existing concept(s) alpha-part-2 — rename or delete them first, then split again'
    });

    await expect(previews.length).toBe(1);
    const refusal = page.locator('[data-test-id="okf-split-refusal"]');
    await expect(refusal).toBeVisible({ timeout: 15000 });
    // The refusal names the colliding id AND the remedy — the server's words.
    await expect(refusal).toContainText('alpha-part-2');
    await expect(refusal).toContainText('rename or delete them first');
    await expect(page.locator('[data-test-id="okf-split-confirm"]')).toBeDisabled();
    // The corpus never changes from a refused preview.
    await expect(splits.length).toBe(0);
  });
});
