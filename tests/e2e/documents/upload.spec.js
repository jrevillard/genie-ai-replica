const { test, expect } = require('@playwright/test');
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
const { request, getSessionToken, SESSION_MINT_TIMEOUT_MS } = require('../helpers/auth');
const { pinLocale } = require('../helpers/locale');
const { skipUnlessVenue, ingestChainReady, ingestChainMissingReason } = require('../helpers/venue-profile');
const { normalizeStatus } = require('../../../components/gov-chat-frontend/src/utils/documentStatus');

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');
// The ingest chain is real dataprep work (ClamAV scan, chunking, LLM
// labeling, indexing) behind a possibly loaded shared venue — the wait is
// bounded, never a sleep, and its expiry is the failure.
const INGEST_BUDGET_MS = 240000;

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
    // The canary runs a REAL ingest on a shared venue and holds until the
    // status lands: its budget (180 s) must fit inside this hook's clock,
    // or the hook's deadline would cut the verdict off mid-wait.
    test.setTimeout(INGEST_BUDGET_MS + 180000);
    await skipUnlessVenue(test, ingestChainReady, ingestChainMissingReason)();
  });

  // Upload + navigation + a bounded wait for real dataprep work compose
  // well past the upload group's own ceiling.
  test.setTimeout(INGEST_BUDGET_MS + 120000);

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

  test('ingest an uploaded file and reach the Ingested status', async ({ page }) => {
    // The ingested file is MARKDOWN, and the extension is part of the
    // subject: the dataprep routes the docling-supported extensions to
    // docling, and docling does not accept plain text — a .txt file fails
    // at chunking with 'File format not allowed' and its status never
    // reaches 'Ingested'. The .md fixture is ingested for real.
    //
    // Its NAME is its own, distinct from the upload group's fixture: the
    // dashboard's table lists the rows by name, so a shared name would let
    // the batch action target another group's leftover row instead of this
    // run's — and the wait below would then watch a row nobody ingested.
    const fileName = 'test-document-ingest.md';

    // The upload dialog does not hand back the server's file id, and the
    // fixture name may match rows a previous run left behind — snapshot
    // the ids BEFORE the upload, so the wait keys on THIS run's row, never
    // on a leftover that may sit in another status forever. (A snapshot
    // taken after the upload would list this run's own row among the
    // known ids, and the run's row would never be found.)
    const token = await getSessionToken(page);
    const before = await request('GET', `/api/files?limit=50&search=${encodeURIComponent(fileName)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(before.status, 'the file list answers the snapshot read').toBe(200);
    const knownIds = new Set(
      ((before.data && before.data.data) || []).filter((f) => f.file_name === fileName).map((f) => f.file_id)
    );

    await uploadFile(page, path.join(FIXTURES_DIR, fileName));

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

    // The chain the UI cannot show by itself: the ingest was accepted, and
    // the dataprep status lands 'Ingested' over the API — the source of
    // truth the table echoes. The wait is bounded and keys on the file id
    // this run created; its expiry carries the last observed status.
    const uploaded = await request('GET', `/api/files?limit=50&search=${encodeURIComponent(fileName)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(uploaded.status, 'the file list answers the post-ingest read').toBe(200);
    const mine = ((uploaded.data && uploaded.data.data) || []).find(
      (f) => f.file_name === fileName && !knownIds.has(f.file_id)
    );
    expect(mine, 'this run uploaded exactly one new row under the fixture name').toBeDefined();
    const file = await waitForFileIngestedViaApi(request, token, mine.file_id, {
      timeoutMs: INGEST_BUDGET_MS
    });
    expect(
      normalizeStatus(file.dataprep && file.dataprep.status),
      "the dataprep chain landed Ingested for this run's file"
    ).toBe('ingested');

    // The rendered verdict: the search refresh re-reads the list (the
    // table has no auto-poll), and the pinned-English pill reads the
    // ingested status — the same vocabulary, seen by the user. The CASE is
    // folded before the comparison: the status tag renders through a CSS
    // `text-transform: uppercase`, so the text the browser hands back is
    // 'INGESTED' whatever the DOM carries.
    await searchDocuments(page, fileName);
    const ingestedRow = await waitForDocumentInTable(page, fileName);
    const statusText = (await ingestedRow.locator('[data-test-id="document-status"]').innerText()).trim();
    expect(statusText.toLowerCase(), 'the table renders the Ingested status').toBe('ingested');
  });
});
