// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// E2E: the OKF Studio wizard's SPLIT REPORT note (#1591).
//
// WHY THIS SPEC EXISTS: the concept-document ceiling makes the SERVER split
// an oversized source document into several concepts, and the import answer
// carries a `split_documents` report. The wizard's Input step renders that
// report as one status line (`okf-input-split-note`) — the only place the
// curator learns their file became several concepts. Until this spec, that
// note had Jest component coverage only: no browser-level proof that the
// note is rendered from the SERVER's answer, that it names the file and the
// part count, or that it stays SILENT when nothing was split (a note that
// always appears is noise the curator learns to ignore).
//
// The claims this spec proves, in a real browser:
//
//   1. the wizard resumes into the Input step from the persisted draft's
//      `studio_step` (the step-lock contract);
//   2. an import answer carrying `split_documents` renders the note with
//      the file's name and the part count — the note can only have come
//      from the intercepted server answer;
//   3. an import answer without `split_documents` renders NO note.
//
// The payloads are INJECTED (page.route); the file upload uses Playwright's
// setInputFiles with an in-memory buffer — the same measure-don't-look rule
// as the sibling ceiling spec (no quarter-megabyte of typing).
//
// Run against an OKF-enabled venue (see helpers/venue-profile.js): on a venue
// whose runtime config parks the pillar the spec skips ITSELF, with the
// venue's own profile as the reason (#1742).

const { test, expect } = require('@playwright/test');
const { loginViaUI, BASE_URL } = require('../helpers/chatbot');
const { okfEnabled, okfParkedReason, skipUnlessVenue } = require('../helpers/venue-profile');

/**
 * WHO LOGS IN — the deployment's own admin (the account the Studio works
 * with). Same account as the sibling ceiling spec.
 */
const ADMIN_USER = {
  username: process.env.GENIE_ADMIN_USERNAME || 'genie-admin',
  password: process.env.GENIE_ADMIN_PASSWORD || ''
};

const REPO_ID = 'e2e-split-note-repo';
const FILE_NAME = 'river-report.md';

/** A draft parked AT the Input step (index 2) — the wizard's mounted
 *  `activeStep = Math.min(draft.studio_step, 9)` lands there without any
 *  step clicks, which is the resume contract this spec also pins. */
const DRAFT = {
  repo_id: REPO_ID,
  name: 'E2E Split Note Repo',
  domain: '',
  concept_count: 0,
  studio_step: 2,
  updated_at: 1700000000000
};

/** The stubbed repository the dashboard lists. */
const REPO = {
  repo_id: REPO_ID,
  name: 'E2E Split Note Repo',
  lifecycle_state: 'draft',
  concept_count: 0,
  version: 1
};

/** The en locale's `okf.steps.input.splitReport` with the substitutions the
 *  spec's own split report produces. The assertion is the full sentence:
 *  file name AND part count, from the server's answer. */
function splitReportCopy(from, into) {
  return `1 file(s) were split to fit the size limit: ${from} (${into} parts)`;
}

/**
 * Register the Studio routes with the import answer the test is named after,
 * log in, resume the repo, and land on the wizard's Input step. Returns
 * nothing; the caller asserts from here.
 */
async function openWizardInputStep(page, importBody) {
  // The dashboard's repository list — one repo, so the resume card exists.
  await page.route(
    `**/api/okf/repos?*`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [REPO], next_cursor: null })
      }),
    { times: 10 }
  );
  // The persisted draft — parked at the Input step.
  await page.route(
    `**/api/okf/repos/${REPO_ID}/draft`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ repo_id: REPO_ID, draft: DRAFT })
      }),
    { times: 10 }
  );
  // The concept tree the Input step refreshes after the import.
  await page.route(
    `**/api/okf/repos/${REPO_ID}/concepts`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([])
      }),
    { times: 10 }
  );
  // THE import — the answer the test is named after.
  await page.route(
    `**/api/okf/repos/${REPO_ID}/import`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(importBody)
      }),
    { times: 10 }
  );

  await loginViaUI(page, ADMIN_USER);
  await page.goto(`${BASE_URL}/admin?tab=studio`, { waitUntil: 'networkidle', timeout: 30000 });

  const card = page.locator(`[data-test-id="okf-studio-repo-${REPO_ID}"]`);
  await expect(card).toBeVisible({ timeout: 15000 });
  await card.click();

  // The editor shell opens on the WIZARD sub-tab by default (StudioTab
  // onResume dispatches setEditorSubTab('wizard') — C1 Amendment A): no
  // sub-tab click needed, the step body is the wizard's own.
  const stepSection = page.locator('[data-test-id="okf-studio-wizard-step"]');
  await expect(stepSection).toBeVisible({ timeout: 15000 });
  await expect(stepSection).toHaveAttribute('aria-label', /Input/i);
}

test.describe('OKF wizard split report note', () => {
  test.beforeEach(
    skipUnlessVenue(
      test,
      () => okfEnabled(),
      () => okfParkedReason()
    )
  );

  test('names the file and the part count when the server splits the document', async ({ page }) => {
    await openWizardInputStep(page, {
      ok: true,
      split_documents: [{ from: FILE_NAME, into: 3 }]
    });

    // The upload: the hidden file input behind the DS button. setInputFiles
    // fires the input's real change handler (onFsFiles), which reads the
    // buffer, POSTs the concept, and renders the note from the ANSWER.
    await page.locator('[data-test-id="okf-input-file-input"]').setInputFiles({
      name: FILE_NAME,
      mimeType: 'text/markdown',
      buffer: Buffer.from('# River report\n\nThe river runs through the valley.'.repeat(20))
    });

    // The note, verbatim: one split file, three parts — the server's own
    // report, rendered as the curator reads it.
    await expect(page.locator('[data-test-id="okf-input-split-note"]')).toHaveText(splitReportCopy(FILE_NAME, 3), {
      timeout: 15000
    });
  });

  test('renders no note when the server splits nothing', async ({ page }) => {
    // The import succeeded and split nothing — the normal case. The note's
    // ABSENCE is half the contract.
    await openWizardInputStep(page, { ok: true });

    await page.locator('[data-test-id="okf-input-file-input"]').setInputFiles({
      name: FILE_NAME,
      mimeType: 'text/markdown',
      buffer: Buffer.from('# Small note\n\nBarely a paragraph.')
    });

    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-test-id="okf-input-split-note"]')).toHaveCount(0);
  });
});
