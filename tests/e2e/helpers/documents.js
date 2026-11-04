const { expect } = require('@playwright/test');
const { loginViaUI, BASE_URL, TEST_ADMIN_USER } = require('./chatbot');
const { getSessionTokenViaUI, request } = require('./auth');

/**
 * Login and navigate to Document Management tab in Admin Dashboard.
 * The documents surface (upload, delete, lifecycle) is ADMIN_ONLY on the
 * document-repository, so the session is the admin test user.
 */
async function navigateToDocumentManagement(page) {
  await loginViaUI(page, TEST_ADMIN_USER);
  await page.goto(`${BASE_URL}/admin`, {
    waitUntil: 'networkidle',
    timeout: 30000,
  });

  // The admin shell renders "Document Management" twice by design: the
  // sidebar nav link and the DsTabs tab button. Only the sidebar entry is
  // a link, so scope by role — a bare getByText resolves to both.
  const docTab = page.getByRole('link', { name: /Document Management/ });
  await expect(docTab).toBeVisible({ timeout: 10000 });
  await docTab.click();

  await expect(page.locator('table.data-table')).toBeVisible({ timeout: 15000 });
}

/**
 * Open the upload dialog and return it. One copy of the dialog-entry
 * contract (action-bar button → dialog container), shared by uploadFile
 * and the rejection spec.
 */
async function openUploadDialog(page) {
  // The upload button lives in the documents card's action bar
  // (.card-actions), not in .filter-bar — the filter bar holds only the
  // search and status controls.
  const uploadBtn = page.getByRole('button', { name: /Upload Files/i });
  await expect(uploadBtn).toBeVisible({ timeout: 5000 });
  await uploadBtn.click();

  const dialog = page.locator('.dialog-container');
  await expect(dialog).toBeVisible({ timeout: 5000 });
  return dialog;
}

/**
 * Upload a file via the upload dialog.
 * Opens dialog → sets file on input → confirms upload → waits for success.
 */
async function uploadFile(page, filePath) {
  await openUploadDialog(page);

  const fileInput = page.locator('.drop-zone input[type="file"]');
  await fileInput.setInputFiles(filePath);

  const fileItem = page.locator('.file-list .file-item');
  await expect(fileItem).toBeVisible({ timeout: 5000 });

  const confirmBtn = page.locator('.dialog-footer').getByRole('button', { name: /upload/i });
  await expect(confirmBtn).toBeEnabled({ timeout: 5000 });
  await confirmBtn.click();

  await expect(page.locator('.dialog-container')).toBeHidden({ timeout: 15000 });
}

/**
 * Wait for a document with the given file name to appear in the table.
 */
async function waitForDocumentInTable(page, fileName, options = {}) {
  const timeout = options.timeout || 15000;
  // The specs upload fixed fixture names repeatedly within one run, so a
  // name can legitimately match more than one row — assert that the file
  // appears (the first matching row), not that it appears exactly once.
  const row = page.locator('tr.document-row').filter({ hasText: fileName }).first();
  await expect(row).toBeVisible({ timeout });
  return row;
}

/**
 * Hold until the rendered document table rows ARE the payload of a
 * /api/files response. getDocumentTableRows reads once, without
 * retrying — a response the table has not painted is not a settled
 * state, and a single-shot read before this hold can see the rows from
 * BEFORE the request. Takes the awaited Playwright Response.
 */
async function waitForTableRowsSettled(page, filesResponse) {
  const expectedNames = ((await filesResponse.json()).data || [])
    .map((f) => f.file_name)
    .sort();
  await expect
    .poll(async () => (await getDocumentTableRows(page)).map((r) => r.fileName).sort(), {
      timeout: 10000,
    })
    .toEqual(expectedNames);
}

/**
 * Search documents by typing in the search input and waiting for the table
 * to render the search's own response.
 */
async function searchDocuments(page, query) {
  // DsInput renders the passed class on the input element itself — the
  // search field IS `input.search-input`, not a child of `.search-input`.
  const searchInput = page.locator('input.search-input');
  await expect(searchInput).toBeVisible({ timeout: 5000 });
  await searchInput.clear();
  // The table refreshes on a 250 ms debounce plus a fetch: wait for the
  // request the fill triggers, then hold until the rendered rows ARE the
  // response's file list — a response the table has not painted is not a
  // settled state, and getDocumentTableRows reads once, without retrying.
  // The wait is bound before the fill so the response cannot be missed,
  // and the predicate matches the DECODED search param exactly, so a
  // background refresh or another control's request (including the
  // clear's own, whose search param differs) cannot answer for this
  // search. A missed response fails here: the request IS the search.
  const filesResponsePromise = page.waitForResponse((r) => {
    if (!r.url().includes('/api/files')) return false;
    const match = r.url().match(/[?&]search=([^&]*)/);
    // `+` is a space in query-string form encoding; decode it before
    // comparing, or a two-word query never matches its own response.
    const decoded = match ? decodeURIComponent(match[1].replace(/\+/g, '%20')) : '';
    return decoded === (query || '');
  }, {
    timeout: 5000,
  });
  if (query) {
    await searchInput.fill(query);
  }
  const filesResponse = await filesResponsePromise;
  await waitForTableRowsSettled(page, filesResponse);
}

/**
 * Get all visible document table rows as data objects.
 */
async function getDocumentTableRows(page) {
  const rows = page.locator('tr.document-row');
  const count = await rows.count();
  const result = [];

  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const fileName = (await row.locator('td.cell-main').innerText()).trim();
    const statusTag = row.locator('DsStatusTag, .status-tag, [class*="status"]');
    // A row's status tag is data-driven — documents without a status render
    // none — so the branch is on the row's shape, not on timing. isVisible
    // answers false for an absent element; a broken locator fails the read.
    const status = (await statusTag.isVisible()) ? (await statusTag.innerText()).trim() : '';
    const labelTags = row.locator('.label-tag');
    const labelCount = await labelTags.count();
    const labels = [];
    for (let j = 0; j < labelCount; j++) {
      labels.push((await labelTags.nth(j).innerText()).trim());
    }
    const cells = row.locator('td');
    const date = (await cells.nth(3).innerText()).trim();
    const size = (await cells.nth(4).innerText()).trim();

    result.push({ fileName, status, labels, date, size });
  }

  return result;
}

/**
 * Delete all test documents matching a prefix via API.
 * Used for test cleanup. Direct access grants are disabled on the realm by
 * design, so the deletes run with a browser-session token (the master admin
 * token is minted for the wrong issuer — the document-repository validates
 * realm tokens only). Pass `{ browser }` from the afterAll fixture to reuse
 * the worker's browser instead of launching a throwaway one. The mint plus
 * list plus delete sweep outlives the 60s hook default — callers must set
 * `test.setTimeout(SESSION_MINT_TIMEOUT_MS)` as the first line of the hook
 * (see tests/e2e/helpers/auth.js).
 * @param {string} [prefix] - File-name prefix to delete
 * @param {object} [options]
 * @param {import('@playwright/test').Browser} [options.browser] - Reuse this
 *        browser for the cleanup login
 */
async function deleteAllTestDocuments(prefix = 'test-document', { browser } = {}) {
  let token;
  try {
    token = await getSessionTokenViaUI({ user: TEST_ADMIN_USER, browser });
  } catch (e) {
    throw new Error(`cleanup: login failed — no test document was deleted: ${e.message}`);
  }

  // The search param narrows the list to the prefix itself, so one page
  // (the endpoint validates limit <= 50) covers the test documents however
  // many unrelated files the stack holds.
  let listRes;
  try {
    listRes = await request('GET', `/api/files?limit=50&search=${encodeURIComponent(prefix)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    throw new Error(`cleanup: file list failed — no test document was deleted: ${e.message}`);
  }
  if (listRes.status !== 200) {
    throw new Error(`cleanup: file list failed with HTTP ${listRes.status} — no test document was deleted`);
  }
  const files = listRes.data?.data || [];
  if (files.length === 50) {
    throw new Error(
      'cleanup: the file list hit the 50-entry page cap — the sweep cannot enumerate ' +
        'every prefix-matching file, so deletions it cannot verify as complete must not run silently'
    );
  }

  const testFiles = files.filter((f) => f.file_name && f.file_name.startsWith(prefix));
  const failures = [];
  for (const f of testFiles) {
    const file_id = f.file_id || f._key || f.id;
    let res = null;
    let cause = null;
    try {
      res = await request('DELETE', `/api/files/${file_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (e) {
      cause = e.message;
    }
    if (!res || res.status < 200 || res.status >= 300) {
      failures.push(`${f.file_name}: ${cause || `HTTP ${res ? res.status : 'no response'}`}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `cleanup: ${failures.length} of ${testFiles.length} test documents were not deleted — ` +
        `leftover documents remain in the stack: ${failures.join('; ')}`
    );
  }
}

module.exports = {
  navigateToDocumentManagement,
  openUploadDialog,
  uploadFile,
  waitForDocumentInTable,
  searchDocuments,
  waitForTableRowsSettled,
  getDocumentTableRows,
  deleteAllTestDocuments,
};
