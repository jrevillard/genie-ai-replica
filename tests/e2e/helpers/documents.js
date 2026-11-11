const { expect } = require('@playwright/test');
const { loginViaUI, BASE_URL, TEST_ADMIN_USER } = require('./chatbot');
const {
  getSessionTokenViaUI,
  mapWithConcurrency,
  request,
  SWEEP_DELETE_CONCURRENCY,
  SWEEP_MAX_DELETES,
  SWEEP_MAX_LIST_PAGES
} = require('./auth');

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

  // UX-1 (#1512) replaced the sidebar nav rail with the tab rack: the
  // documents section is a rack BUTTON now, addressed by the handle the
  // component declares. The old sidebar LINK this helper waited for is
  // gone from the shell — the wait never resolved after UX-1.
  const docTab = page.locator('[data-test-id="admin-documents-link"]');
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
 * The status predicate the admin table applies CLIENT-SIDE
 * (AdminDashboard.vue `filteredDocuments`): 'all' lists every document,
 * and any other selection lists the documents whose dataprep status —
 * lowercased and trimmed — equals it. The list request carries NO status
 * parameter, so the response payload is the WHOLE page and the table
 * renders the payload's subset of the selected status.
 *
 * @param {object} file - one document of the /api/files payload
 * @param {string} status - the selected status
 * @returns {boolean} whether the table would list the document
 */
function matchesStatus(file, status) {
  const wanted = String(status).toLowerCase().trim();
  if (wanted === 'all') return true;
  return Boolean(file.dataprep) && String(file.dataprep.status).toLowerCase().trim() === wanted;
}

/**
 * Hold until the rendered document table rows ARE the payload of a
 * /api/files response. getDocumentTableRows reads once, without
 * retrying — a response the table has not painted is not a settled
 * state, and a single-shot read before this hold can see the rows from
 * BEFORE the request. Takes the awaited Playwright Response.
 *
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Response} filesResponse
 * @param {object} [options]
 * @param {string} [options.status] - The status the table filters on.
 *        Without it the table lists the whole payload; with it the table
 *        lists the payload's documents of that status, and comparing the
 *        rows with the WHOLE payload could only hold on a page whose
 *        documents all carry that status.
 */
async function waitForTableRowsSettled(page, filesResponse, { status } = {}) {
  const payload = (await filesResponse.json()).data || [];
  const expectedNames = payload
    .filter((f) => (status === undefined ? true : matchesStatus(f, status)))
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
 * the worker's browser instead of launching a throwaway one. The sweep
 * outlives the 60s hook default — callers must set
 * `test.setTimeout(SESSION_MINT_TIMEOUT_MS)` as the first line of the hook
 * (see tests/e2e/helpers/auth.js). That budget covers the sweep: the mint
 * (≈135s on a stalled stack) plus the pages plus the bounded-parallel delete
 * waves, and the token the sweep holds outlives it too — the realm issues
 * it for 300s.
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
    throw new Error(`cleanup: login failed — no test document was deleted: ${e.message}`, { cause: e });
  }

  // The list is paginated, and its search matches a SUPERSET of the
  // suite's own files: the endpoint filters CONTAINS(LOWER(file_name)) OR
  // CONTAINS(LOWER(source_url)), while the sweep deletes the files whose
  // NAME starts with the prefix. One page (the endpoint validates
  // limit <= 50) is therefore not the population, and the sweep cannot
  // tell "the files beyond the page are not mine" from "the files beyond
  // the page are mine and were not removed" — the second one is a
  // leftover. Enumerate the pages the budget allows.
  const files = [];
  let total;
  let listFailure = null;
  let exhausted = false;
  for (let page = 1; page <= SWEEP_MAX_LIST_PAGES; page++) {
    let listRes;
    try {
      listRes = await request(
        'GET',
        `/api/files?limit=50&page=${page}&search=${encodeURIComponent(prefix)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch (e) {
      listFailure = `page ${page} failed: ${e.message}`;
      break;
    }
    if (listRes.status !== 200) {
      listFailure = `page ${page} returned HTTP ${listRes.status}`;
      break;
    }
    const pageFiles = listRes.data?.data || [];
    files.push(...pageFiles);
    total = listRes.data?.pagination?.totalFiles;
    if (pageFiles.length < 50) {
      exhausted = true;
      break;
    }
  }

  // Two populations, and the report must not conflate them: the POPULATION
  // is every file the endpoint matched (the CONTAINS set), the DELETE SET
  // is the suite's own files inside it (the prefix-matching ones). Only
  // the delete set is the sweep's to remove.
  const testFiles = files.filter((f) => f.file_name && f.file_name.startsWith(prefix));
  const population = total !== undefined ? total : files.length;
  const enumeratedAll = total !== undefined ? files.length >= total : exhausted;

  const deleteSet = testFiles.slice(0, SWEEP_MAX_DELETES);
  const beyondBudget = testFiles.length - deleteSet.length;

  // The deletes run in bounded-parallel waves. Every one of them is
  // capped at the 30 s request timeout, so a sequential sweep of a full
  // page costs 50 × 30 s — more than the hook's budget AND more than the
  // realm's access-token lifespan, and the tail of it would run on an
  // expired token. The wave width is bounded by SWEEP_DELETE_CONCURRENCY
  // so the sweep still fits both.
  const failures = (
    await mapWithConcurrency(deleteSet, SWEEP_DELETE_CONCURRENCY, async (f) => {
      const file_id = f.file_id || f._key || f.id;
      try {
        const res = await request('DELETE', `/api/files/${file_id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status < 200 || res.status >= 300) {
          return `${f.file_name}: HTTP ${res.status}`;
        }
        return null;
      } catch (e) {
        return `${f.file_name}: ${e.message}`;
      }
    })
  ).filter(Boolean);

  // Every failure condition is reported: the first throw used to hide the
  // others (a delete failure hid the enumeration gap), so a run could
  // name one leftover and pass over the rest.
  const problems = [];
  if (listFailure) {
    problems.push(`the file list could not be read — ${listFailure}`);
  }
  if (failures.length > 0) {
    problems.push(
      `${failures.length} of ${deleteSet.length} test documents were not deleted — leftover ` +
        `documents remain in the stack: ${failures.join('; ')}`
    );
  }
  if (beyondBudget > 0) {
    problems.push(
      `${beyondBudget} test documents are beyond the sweep's delete budget (${SWEEP_MAX_DELETES} ` +
        `per run) — they stay behind until a later run removes them`
    );
  }
  if (!enumeratedAll && !listFailure) {
    problems.push(
      `the population is ${population} matching files and the sweep enumerated ${files.length} of ` +
        `them — a prefix-matching file beyond the last enumerated page was not removed`
    );
  }
  if (problems.length > 0) {
    const scope = listFailure
      ? 'the file list could not be read, so the population is unknown'
      : `the population holds ${population} matching files, of which ${testFiles.length} are the suite's own`;
    throw new Error(`cleanup: ${problems.length} problem(s) — ${scope} — ${problems.join(' | ')}`);
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
