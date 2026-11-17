const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  navigateToDocumentManagement,
  openUploadDialog,
  uploadFile,
  searchDocuments,
  waitForFileIngestedViaApi,
  waitForDocumentInTable,
  deleteAllTestDocuments
} = require('../helpers/documents');
const { request, getSessionTokenViaUI, SESSION_MINT_TIMEOUT_MS } = require('../helpers/auth');
const { TEST_ADMIN_USER } = require('../helpers/e2e-fixtures');
const { pinLocale } = require('../helpers/locale');
const {
  skipUnlessVenue,
  ingestChainReady,
  ingestChainMissingReason,
  INGEST_PROBE_BUDGET_MS
} = require('../helpers/venue-profile');
const { normalizeStatus } = require('../../../components/gov-chat-frontend/src/utils/documentStatus');

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');
// The ingest chain is real dataprep work (ClamAV scan, chunking, LLM
// labeling, indexing) behind a possibly loaded shared venue — the wait is
// bounded, never a sleep, and its expiry is the failure.
const INGEST_BUDGET_MS = 240000;
// This run's seed identity. The name is an identity, never an asserted
// value (the same rule as the suite's unique seed names).
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

test.describe('Document Upload', () => {
  // Login (30 s + 15 s retry) + navigation + table waits compose past the
  // 60 s default on a stalling stack; keep the failure on its own step.
  test.setTimeout(120000);

  test.beforeEach(async ({ page }) => {
    // The status pill's TEXT is i18n copy: the pin makes the English label
    // the proven state of every session in this file, so a status read is
    // a value comparison and never a locale bet (helpers/locale.js).
    await pinLocale(page.context(), 'en');
    await navigateToDocumentManagement(page);
  });

  test.afterAll(async ({ browser }) => {
    // The helper's mint + list + delete sweep outlives the 60s hook default.
    test.setTimeout(SESSION_MINT_TIMEOUT_MS);
    await deleteAllTestDocuments('test-document', { browser });
  });

  for (const ext of ['txt', 'md', 'pdf']) {
    test(`upload a .${ext} file and verify it appears in the document table`, async ({ page }) => {
      const fileName = `test-document.${ext}`;
      await uploadFile(page, path.join(FIXTURES_DIR, fileName));

      const row = await waitForDocumentInTable(page, fileName);
      await expect(row).toBeVisible();

      const cellText = await row.locator('[data-test-id="document-name"]').innerText();
      expect(cellText.trim()).toContain(fileName);

      // DsStatusTag renders unconditionally, so the status cell is always
      // present — the status TEXT is what varies; the read is direct.
      const statusText = (await row.locator('[data-test-id="document-status"]').innerText()).trim();
      expect(statusText.toLowerCase()).toContain('pending');
    });
  }

  test('reject .exe file and display error message', async ({ page }) => {
    const dialog = await openUploadDialog(page);

    const fileInput = page.locator('[data-test-id="upload-file-input"]');
    await fileInput.setInputFiles(path.join(FIXTURES_DIR, 'invalid-document.exe'));

    const errorMessage = dialog.locator('[data-test-id="upload-error-message"]');
    await expect(errorMessage).toBeVisible({ timeout: 5000 });
    const errorText = await errorMessage.innerText();
    // The rejection copy IS the subject (#1865): the .exe fixture can
    // only take the typeNotAllowed branch, and the copy must carry the
    // offending extension. The old three-way alternation
    // (`not allowed|not supported|invalid`) also matched the shortcut
    // branch and kept passing when the copy dropped the extension — a
    // wrong-branch regression was green.
    expect(errorText).toMatch(/^File type "\.exe" is not allowed\.$/);
  });
});

test.describe('Document Upload — the ingest chain', () => {
  // The venue premise runs FIRST: without a dataprep chain that lands
  // 'Ingested' (proven by the venue profile's own canary), this group's
  // premise is absent, not broken (#1742). The skip hook is the group's
  // first beforeAll, so the guarded setup after it never runs on a venue
  // without the chain.
  test.beforeAll(async () => {
    // The premise's real cost is a browser login (the realm refuses
    // direct grants, so the probe mints through the browser — budgeted at
    // SESSION_MINT_TIMEOUT_MS) PLUS the canary's own ingest wait PLUS the
    // canary's cleanup sweep. The hook runs under the PROJECT's timeout
    // otherwise, and a hook cut mid-probe ERRORS the group instead of
    // skipping it — and the canary's cleanup, which sits AFTER the wait,
    // would never run: the canary would stay in the venue's corpus.
    test.setTimeout(SESSION_MINT_TIMEOUT_MS + INGEST_PROBE_BUDGET_MS + 120000);
    await skipUnlessVenue(test, ingestChainReady, ingestChainMissingReason)();
  });

  // The test itself mints a session of its own (the wait reads the API
  // with a token that must not expire mid-wait), then uploads, then waits
  // for real dataprep work: all three compose past the group's own
  // ceiling.
  test.setTimeout(SESSION_MINT_TIMEOUT_MS + INGEST_BUDGET_MS + 120000);

  test.beforeEach(async ({ page }) => {
    await pinLocale(page.context(), 'en');
    await navigateToDocumentManagement(page);
  });

  test.afterAll(async ({ browser }) => {
    // The helper's mint + list + delete sweep outlives the 60s hook
    // default. Same prefix as the upload group's sweep: the fixture name
    // this group uploads carries it too.
    test.setTimeout(SESSION_MINT_TIMEOUT_MS);
    await deleteAllTestDocuments('test-document', { browser });
  });

  test('ingest an uploaded file and reach the Ingested status', async ({ page, browser }) => {
    // The ingested file is MARKDOWN, and the extension is part of the
    // subject: the dataprep routes the docling-supported extensions to
    // docling, and docling does not accept plain text — a .txt file fails
    // at chunking with 'File format not allowed' and its status never
    // reaches 'Ingested'. The .md fixture is ingested for real.
    //
    // Its NAME is unique per RUN: the dashboard's table lists the rows by
    // name and the batch action takes the row it finds, so a name another
    // run (or another group) also uses would let the action target a
    // leftover row instead of this run's — and the wait below would then
    // watch a row nobody ingested. The seed is the fixture's own text,
    // copied out under this run's name.
    const fileName = `test-document-ingest-${RUN_ID}.md`;
    const uploadPath = `${os.tmpdir()}/${fileName}`;
    fs.copyFileSync(path.join(FIXTURES_DIR, 'test-document-ingest.md'), uploadPath);

    // The wait reads the API, and a realm access token lives 300 s: the
    // page's own token would be minutes old by the time the ingest lands
    // and would expire mid-wait. A session minted for the wait answers in
    // its own right.
    const token = await getSessionTokenViaUI({ user: TEST_ADMIN_USER, browser });

    try {
      await uploadFile(page, uploadPath);

      // The ingest is the dashboard's own batch action on the fresh row:
      // the checkbox is a structural tail of the declared row handle, the
      // two buttons are role-located under the pinned-English copy (the
      // confirm dialog declares no handles — the accepted fallback).
      const row = await waitForDocumentInTable(page, fileName);
      await row.locator('input[type="checkbox"]').check();
      await page.getByRole('button', { name: /ingest selected/i }).click();
      await page.getByRole('button', { name: 'Ingest', exact: true }).click();
      await expect(
        page.locator('[data-test-id="notification-success"]'),
        'the batch ingest confirms itself'
      ).toBeVisible();

      // The chain the UI cannot show by itself: the ingest was accepted,
      // and the dataprep status lands 'Ingested' over the API — the source
      // of truth the table echoes. The wait is bounded and keys on the
      // file id this run created; its expiry carries the last observed
      // status.
      const uploaded = await request('GET', `/api/files?limit=50&search=${encodeURIComponent(fileName)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      expect(uploaded.status, 'the file list answers the post-ingest read').toBe(200);
      const mine = ((uploaded.data && uploaded.data.data) || []).find((f) => f.file_name === fileName);
      expect(mine, 'this run uploaded exactly one row under its own name').toBeDefined();
      const file = await waitForFileIngestedViaApi(request, token, mine.file_id, {
        timeoutMs: INGEST_BUDGET_MS
      });
      expect(
        normalizeStatus(file.dataprep && file.dataprep.status),
        "the dataprep chain landed Ingested for this run's file"
      ).toBe('ingested');

      // The rendered verdict: the search refresh re-reads the list (the
      // table has no auto-poll), and the pinned-English pill reads the
      // ingested status — the same vocabulary, seen by the user. The CASE
      // is folded before the comparison: the status tag renders through a
      // CSS `text-transform: uppercase`, so the text the browser hands
      // back is 'INGESTED' whatever the DOM carries.
      await searchDocuments(page, fileName);
      const ingestedRow = await waitForDocumentInTable(page, fileName);
      const statusText = (await ingestedRow.locator('[data-test-id="document-status"]').innerText()).trim();
      expect(statusText.toLowerCase(), 'the table renders the Ingested status').toBe('ingested');
    } finally {
      // The runner's own scratch copy of the seed: the venue-side document
      // is removed by the group's sweep, this file is the runner's.
      try {
        fs.unlinkSync(uploadPath);
      } catch {
        // The scratch copy is the runner's own state; a leftover in the
        // runner's tmp is not venue state and must not fail the spec.
      }
    }
  });
});
