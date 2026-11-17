const { expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
// The shared document-status vocabulary: the frontend owns the rule this
// helper mirrors, so the helper IMPORTS it instead of spelling it (#1781).
// The bridge is Node's CommonJS-require-of-an-ES-module (unflagged from
// Node 22.12, 20.19 on the 20 line). Below that floor the require is a
// bare SyntaxError at load with nothing to act on — so probe the
// capability (`process.features.require_module`, the flag's own name)
// and name the floor and the runner's version HERE (#1804 review of
// #1781).
if (!process.features.require_module) {
  throw new Error(
    `tests/e2e/helpers/documents.js needs a Node with unflagged CommonJS require of ES modules (>= 22.12, or >= 20.19 on the 20 line — the shared document-status vocabulary is an ES module); this runner is Node ${process.versions.node}`
  );
}
const { normalizeStatus } = require('../../../components/gov-chat-frontend/src/utils/documentStatus');
const { loginViaUI, BASE_URL, TEST_ADMIN_USER } = require('./chatbot');
const {
  describeUnauthorized,
  getSessionTokenViaUI,
  dedupeByIds,
  mapWithConcurrency,
  request,
  SWEEP_DELETE_CONCURRENCY,
  SWEEP_DOCS_MAX_DELETES,
  SWEEP_MAX_LIST_PAGES
} = require('./auth');

// The page size the cleanup sweep lists the population with. The
// endpoint validates `limit <= 50`, so this is also its maximum, and
// the sweep recognises the last page by a page shorter than this.
const PAGE_SIZE = 50;

/**
 * Login and navigate to Document Management tab in Admin Dashboard.
 * The documents surface (upload, delete, lifecycle) is ADMIN_ONLY on the
 * document-repository, so the session is the admin test user.
 */
async function navigateToDocumentManagement(page) {
  await loginViaUI(page, TEST_ADMIN_USER);
  await page.goto(`${BASE_URL}/admin`, {
    waitUntil: 'networkidle',
    timeout: 30000
  });

  // UX-1 (#1512) replaced the sidebar nav rail with the tab rack: the
  // documents section is a rack BUTTON now, addressed by the handle the
  // component declares. The old sidebar LINK this helper waited for is
  // gone from the shell — the wait never resolved after UX-1.
  const docTab = page.locator('[data-test-id="admin-documents-link"]');
  await expect(docTab).toBeVisible({ timeout: 10000 });
  await docTab.click();

  await expect(page.locator('[data-test-id="document-table"]')).toBeVisible({ timeout: 15000 });
}

/**
 * Open the upload dialog and return it. One copy of the dialog-entry
 * contract (action-bar button → dialog container), shared by uploadFile
 * and the rejection spec.
 */
async function openUploadDialog(page) {
  // The upload button lives in the documents card's action bar
  // (.card-actions), not in .filter-bar — the filter bar holds only the
  // search and status controls. The button declares the handle
  // (`documents-upload-files`, AdminDashboard.vue): the handle is the
  // locator (#1865) — its name is i18n copy (`translate('admin.
  // documents.uploadFiles', …)`), and a non-English venue broke the
  // old role locator before its first assertion.
  const uploadBtn = page.locator('[data-test-id="documents-upload-files"]');
  await expect(uploadBtn).toBeVisible({ timeout: 5000 });
  await uploadBtn.click();

  const dialog = page.locator('[data-test-id="upload-files-dialog"]');
  await expect(dialog).toBeVisible({ timeout: 5000 });
  return dialog;
}

/**
 * Upload a file via the upload dialog.
 * Opens dialog → sets file on input → confirms upload → waits for success.
 */
async function uploadFile(page, filePath) {
  const dialog = await openUploadDialog(page);

  const fileInput = page.locator('[data-test-id="upload-file-input"]');
  await fileInput.setInputFiles(filePath);

  const fileItem = dialog.locator('[data-test-id="upload-file-item"]');
  await expect(fileItem).toBeVisible({ timeout: 5000 });

  // The confirm button carries the handle the component declares now
  // (UploadFilesDialog.vue footer, #1865): its old role locator matched
  // i18n copy (`Upload {count} File(s)`, templated), and `/upload/i`
  // also matched the `Uploading...` progress text — two buttons for one
  // locator, resolved by copy. The handle is one, always.
  const confirmBtn = dialog.locator('[data-test-id="upload-files-dialog-confirm"]');
  await expect(confirmBtn).toBeEnabled({ timeout: 5000 });
  await confirmBtn.click();

  await expect(dialog).toBeHidden({ timeout: 15000 });
}

/**
 * Wait for a document with the given file name to appear in the table.
 */
async function waitForDocumentInTable(page, fileName, options = {}) {
  const timeout = options.timeout || 15000;
  // The specs upload fixed fixture names repeatedly within one run, so a
  // name can legitimately match more than one row — assert that the file
  // appears (the first matching row), not that it appears exactly once.
  const row = page.locator('[data-test-id="document-row"]').filter({ hasText: fileName }).first();
  await expect(row).toBeVisible({ timeout });
  return row;
}

/**
 * The status predicate the admin table applies CLIENT-SIDE
 * (AdminDashboard.vue `filteredDocuments`): 'all' lists every document,
 * and any other selection lists the documents whose dataprep status equals
 * it. The list request carries NO status parameter, so the response
 * payload is the WHOLE page and the table renders the payload's subset of
 * the selected status.
 *
 * The normalisation is the SHARED vocabulary's (#1781): this predicate
 * derives from the same `normalizeStatus` the require at the top of this
 * file loads and the admin filter applies — one rule, three consumers,
 * no mirror to go stale (the bridge and its floor are documented there).
 *
 * @param {object} file - one document of the /api/files payload
 * @param {string} status - the selected status
 * @returns {boolean} whether the table would list the document
 */
function matchesStatus(file, status) {
  const wanted = normalizeStatus(status);
  if (wanted === 'all') return true;
  return Boolean(file.dataprep) && normalizeStatus(file.dataprep.status) === wanted;
}

/**
 * The response's own error code, when the body carries one — the
 * repository maps its refusals to codes (STILL_SERVING, CRAWL_ACTIVE,
 * BUNDLE_PROTECTED) that name the remedy; a bare status does not.
 */
function describeCode(res) {
  const data = (res && res.data) || {};
  return data.code ? ` (${data.code})` : '';
}

/**
 * The response body's own diagnostic, for a failure report: the
 * `message` field when the repository wrote one (the retract remedy
 * lives there), the `error` field as the fallback class label, and the
 * `details` field — the raw upstream response doc-repo attaches to its
 * own failures (dataprep's retract answer) — bounded so a verbose body
 * cannot flood the report (#1864 review).
 */
function detailOf(res) {
  const data = (res && res.data) || {};
  const text = data.message || data.error;
  let out = text || '';
  if (data.details !== undefined && data.details !== null) {
    out += `${out ? ' — ' : ''}details: ${JSON.stringify(data.details).slice(0, 200)}`;
  }
  return out;
}

/**
 * The id a /api/files payload entry addresses its file by. ONE home for
 * the fallback chain — the pagination-drift dedupe keys on the same id
 * the delete targets, so the two cannot silently diverge (#1864 quality
 * review). A row carrying none of the three fields resolves to
 * undefined; its delete fails loud on the missing id, as before.
 */
function fileIdOf(file) {
  return file.file_id || file._key || file.id;
}

/**
 * The failure line for one non-2xx response, shared by the sweep's two
 * legs so the status/code/detail formatting is written once: a 401 keeps
 * the token-expiry diagnosis (the retract caller names its leg via
 * `legNote`), anything else reads `HTTP <status> (<code>) — <detail>`,
 * wrapped in the retract caller's `wrap` prefix. Byte-identical outputs
 * are pinned by documents.spec.js.
 */
function describeFailure(res, token, { legNote = '', wrap = '' } = {}) {
  if (res.status === 401) {
    return `${describeUnauthorized(res, token)}${legNote ? ` (on the ${legNote})` : ''}`;
  }
  const detail = detailOf(res);
  const body = `HTTP ${res.status}${describeCode(res)}${detail ? ` — ${detail}` : ''}`;
  return wrap ? `${wrap}${body})` : body;
}

/**
 * One per-file sweep delete: a bare DELETE, and — when the repository
 * refuses with 409 STILL_SERVING — the remedy that response itself
 * prescribes, retract-then-delete (#1864). Before #1864 the sweep issued
 * the bare DELETE only, so a leftover that had reached a serving state
 * (`ingested`, `ingesting`, `ingested with warnings` — the delete guard
 * in document-repository's fileService) failed every later afterAll
 * identically with a bare `HTTP 409`: cleanup loud but structurally
 * unable to converge.
 *
 * The remedy keys on the response's CODE, not on 409 alone: a
 * CRAWL_ACTIVE 409 means "retry shortly" (kill-before-delete in
 * progress), not "retract first", and retracting an actively crawling
 * file is not the sweep's call — it stays a reported failure.
 *
 * The transport (`request`) is injected by parameter: it belongs to
 * helpers/auth.js, and the unit spec (documents.spec.js) scripts it —
 * the call sequence IS the contract under test.
 *
 * @param {Function} request - the auth helper's `request` transport
 * @param {object} file - one entry of the /api/files payload
 * @param {string} token - the sweep's bearer token
 * @returns {Promise<string|null>} the failure string, or null on success
 */
async function sweepDeleteOneFile(request, file, token) {
  const file_id = fileIdOf(file);
  const headers = { Authorization: `Bearer ${token}` };
  const attempt = () => request('DELETE', `/api/files/${file_id}`, { headers });
  try {
    let res = await attempt();
    if (res.status === 409 && res.data && res.data.code === 'STILL_SERVING') {
      const retractRes = await request('POST', `/api/files/${file_id}/retract`, { headers });
      if (retractRes.status < 200 || retractRes.status >= 300) {
        // A 401 on this leg is the same token-expiry diagnosis the delete
        // legs produce (verdict + expiry label), not a generic detail —
        // the token can lapse between the first DELETE and the retract
        // (#1864 review). describeFailure names the leg for the other
        // statuses.
        return `${file.file_name}: ${describeFailure(retractRes, token, {
          legNote: 'retract after a STILL_SERVING refusal',
          wrap: 'retract failed before delete ('
        })}`;
      }
      res = await attempt();
    }
    if (res.status < 200 || res.status >= 300) {
      return `${file.file_name}: ${describeFailure(res, token)}`;
    }
    return null;
  } catch (e) {
    return `${file.file_name}: ${e.message}`;
  }
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
 * @param {string} [options.status='all'] - The status the table filters
 *        on. 'all' is the table's own "no filter" selection: the table
 *        then lists the whole payload. With a status, the table lists
 *        the payload's documents of that status, and comparing the rows
 *        with the WHOLE payload could only hold on a page whose
 *        documents all carry that status.
 */
async function waitForTableRowsSettled(page, filesResponse, { status = 'all' } = {}) {
  const payload = (await filesResponse.json()).data || [];
  const expectedNames = payload
    .filter((f) => matchesStatus(f, status))
    .map((f) => f.file_name)
    .sort();
  await expect
    .poll(async () => (await getDocumentTableRows(page)).map((r) => r.fileName).sort(), {
      timeout: 10000
    })
    .toEqual(expectedNames);
}

/**
 * Search documents by typing in the search input and waiting for the table
 * to render the search's own response.
 */
async function searchDocuments(page, query) {
  // DsInput binds unknown attrs (the declared handle here) onto the
  // input element itself, so the locator addresses the field directly.
  const searchInput = page.locator('[data-test-id="document-search-input"]');
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
  const filesResponsePromise = page.waitForResponse(
    (r) => {
      if (!r.url().includes('/api/files')) return false;
      const match = r.url().match(/[?&]search=([^&]*)/);
      // `+` is a space in query-string form encoding; decode it before
      // comparing, or a two-word query never matches its own response.
      const decoded = match ? decodeURIComponent(match[1].replace(/\+/g, '%20')) : '';
      return decoded === (query || '');
    },
    {
      timeout: 5000
    }
  );
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
  const rows = page.locator('[data-test-id="document-row"]');
  const count = await rows.count();
  const result = [];

  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const fileName = (await row.locator('[data-test-id="document-name"]').innerText()).trim();
    // DsStatusTag renders unconditionally, so the status cell is always
    // present — the status TEXT is what varies ('' when the payload
    // carries no status); the read is direct, and a broken locator fails
    // it instead of silently reporting no status.
    const status = (await row.locator('[data-test-id="document-status"]').innerText()).trim();
    const labelTags = row.locator('[data-test-id="document-label"]');
    const labelCount = await labelTags.count();
    const labels = [];
    for (let j = 0; j < labelCount; j++) {
      labels.push((await labelTags.nth(j).innerText()).trim());
    }
    // The two trailing cells are handle-anchored, not indexed: the row
    // has SIX cells (checkbox, name, status, labels, date, size) and the
    // old nth(3)/nth(4) indexes read the LABELS and DATE cells — the
    // exported date/size were wrong by one column since the labels
    // column landed.
    const date = (await row.locator('[data-test-id="document-upload-date"]').innerText()).trim();
    const size = (await row.locator('[data-test-id="document-size"]').innerText()).trim();

    result.push({ fileName, status, labels, date, size });
  }

  return result;
}

/**
 * One multipart/form-data body for the repository's single-file upload route
 * (POST /api/files/upload, multer field `file`).
 *
 * UTF-8 TEXT fixtures only: the body is assembled as a string and the shared
 * transport writes strings as UTF-8, so the bytes arrive exactly as read for
 * an ASCII/UTF-8 text file. A binary fixture (a PDF, a ZIP) would be
 * corrupted by the string round-trip and needs a transport Buffer arm first
 * — no such fixture is ingested through this helper.
 *
 * Pure, so the unit spec can pin the bytes at the helper's own boundary
 * through uploadFileViaApi's scripted transport.
 *
 * @param {string} boundary - the multipart boundary (no leading `--`)
 * @param {string} fileName - the file name the server should see
 * @param {string} contentType - the part's Content-Type
 * @param {string} content - the file's text, as read from disk
 * @returns {string} the full multipart body
 */
function multipartBody(boundary, fileName, contentType, content) {
  return (
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n` +
    content +
    `\r\n--${boundary}--\r\n`
  );
}

/**
 * Upload one text file through the repository's HTTP contract and return the
 * response payload's file record (file_id, file_name, dataprep...).
 *
 * The transport (`request`) is injected by parameter, like sweepDeleteOneFile's:
 * it belongs to helpers/auth.js, and the unit spec scripts it — the request
 * shape (multipart body, boundary header, bearer) IS the contract under test.
 *
 * @param {Function} request - the auth helper's `request` transport
 * @param {string} token - the uploader's bearer token (the document surface is
 *        ADMIN_ONLY on the document-repository)
 * @param {string} filePath - absolute path of the text file to upload
 * @returns {Promise<object>} the response payload's `data` file record
 */
async function uploadFileViaApi(request, token, filePath) {
  const fileName = path.basename(filePath);
  const content = fs.readFileSync(filePath, 'utf8');
  const boundary = `e2e-upload-${Math.random().toString(16).slice(2)}`;
  const res = await request('POST', '/api/files/upload', {
    headers: { Authorization: `Bearer ${token}` },
    // The transport sets Content-Type from `contentType` and OVERWRITES any
    // Content-Type in the headers map (it is the one that writes the body) —
    // a multipart body sent as application/json is parsed as JSON by the
    // repository and refused with a 400 naming the body's first token.
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: multipartBody(boundary, fileName, 'text/markdown', content)
  });
  if (res.status !== 201) {
    throw new Error(
      `the upload of ${fileName} answered HTTP ${res.status} ` + `(body: ${JSON.stringify(res.data).slice(0, 200)})`
    );
  }
  if (!res.data || !res.data.data || !res.data.data.file_id) {
    throw new Error(
      `the upload of ${fileName} answered 201 without a file record ` +
        `(body: ${JSON.stringify(res.data).slice(0, 200)})`
    );
  }
  return res.data.data;
}

/**
 * Trigger the dataprep ingest of one file through the repository's HTTP
 * contract (POST /api/files/:fileId/ingest) — the same call the admin
 * dashboard's batch ingest makes.
 *
 * The ingest runs asynchronously: a 200/207 means the work was ACCEPTED, not
 * finished — the caller waits for the status with waitForFileIngestedViaApi.
 *
 * @param {Function} request - the auth helper's `request` transport
 * @param {string} token - the caller's bearer token
 * @param {string} fileId - the file to ingest
 * @returns {Promise<object>} the response payload (per-file result or status)
 */
async function triggerIngestViaApi(request, token, fileId) {
  const res = await request('POST', `/api/files/${fileId}/ingest`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  // 200 (accepted) and 207 (multi-status envelope) both mean the ingest was
  // taken on. A 409 is dataprep's idempotency guard — a live task already owns
  // the file, which is the state the caller wants — and the repository
  // answers it with ITS OWN body: {success:false, error:'Conflict',
  // message:'An ingest for this file is already running…'}. The producer's
  // code ('ingest_already_running') is accepted too, because a repository
  // that forwards the producer's body answers with it.
  const alreadyRunning =
    res.status === 409 &&
    res.data &&
    (res.data.code === 'ingest_already_running' || /already running/i.test(String(res.data.message || '')));
  const accepted = res.status === 200 || res.status === 207 || alreadyRunning;
  if (!accepted) {
    throw new Error(
      `the ingest call for file ${fileId} answered HTTP ${res.status} ` +
        `(body: ${JSON.stringify(res.data).slice(0, 200)})`
    );
  }
  return res.data;
}

/**
 * Hold until one file's dataprep status reads an INGESTED status over the
 * API — the shared vocabulary's normalised form (the stored value is
 * capitalised; the comparison is normalizeStatus's, like every other
 * consumer's).
 *
 * The status it waits for is the EXACT 'ingested' one: 'ingested with
 * warnings' is a real, indexed outcome (partial labels, a truncated
 * document context), but it is not the status the callers assert, and a
 * wait that accepted it would let a spec claim an 'Ingested' it never
 * saw. It ends the wait at once, named, like the other terminal
 * statuses — it will not become 'ingested'.
 *
 * The TERMINAL statuses fail AT ONCE (named, with the status): 'ingestion
 * error' is a failed ingest, 'retracted' is a file withdrawn from the
 * corpus and 'killed' is a killed ingest — none of them will ever read an
 * ingested status, so polling them to the timeout would only delay the
 * same red. The ingest budget expires on 'pending'/'ingesting' with the
 * last observed status in the message — that is the shape a venue without
 * (or with a wedged) dataprep chain produces, and the message says which.
 *
 * @param {Function} request - the auth helper's `request` transport
 * @param {string} token - the caller's bearer token
 * @param {string} fileId - the file whose status is waited for
 * @param {object} [options]
 * @param {number} [options.timeoutMs=240000] - the ingest budget
 * @returns {Promise<object>} the file record that reached an ingested status
 */
async function waitForFileIngestedViaApi(request, token, fileId, { timeoutMs = 240000 } = {}) {
  const read = async () => {
    const res = await request('GET', `/api/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.status !== 200) {
      // A 401 here is the session's own expiry (the realm's access token
      // lives 300 s), not a missing file: the shared auth helper names
      // that verdict, and this reader reuses it so the failure says which.
      const detail = res.status === 401 ? describeUnauthorized(res, token) : `HTTP ${res.status}`;
      throw new Error(`the file record of ${fileId} answered ${detail} while polling for an ingested status`);
    }
    // The record rides the response's `data` envelope (GET /api/files/:fileId
    // → {success, message, data}); the dataprep block is what the wait reads.
    return res.data && res.data.data;
  };

  // One read before the wait: a file that already ingested (a re-run against
  // a converged venue) must not spend the budget discovering it.
  const statusOf = (record) => normalizeStatus(record && record.dataprep && record.dataprep.status);
  // The statuses that will NOT become 'ingested': a failed ingest, a
  // withdrawn file, a killed ingest, and the degraded-but-indexed one.
  const TERMINAL = ['ingestion error', 'retracted', 'killed', 'ingested with warnings'];
  const terminalError = (record) =>
    `the ingest of file ${fileId} did not reach 'Ingested' — the dataprep status is ` +
    `'${record.dataprep.status}', and that status will not change`;
  let file = await read();
  if (TERMINAL.includes(statusOf(file))) {
    throw new Error(terminalError(file));
  }
  if (statusOf(file) !== 'ingested') {
    await expect
      .poll(
        async () => {
          file = await read();
          const status = statusOf(file);
          // A terminal status that arrives MID-WAIT ends the wait at
          // once (the poll propagates the throw): a retracted file never
          // reads an ingested status, and polling it to the deadline would
          // only delay the same named failure.
          if (TERMINAL.includes(status)) {
            throw new Error(terminalError(file));
          }
          return status;
        },
        { timeout: timeoutMs, intervals: [1000, 5000] }
      )
      // The exact status, compared as a whole: the vocabulary's normalised
      // form is 'ingested', and the degraded 'ingested with warnings' is a
      // DIFFERENT status — it ended the wait above, named.
      .toBe('ingested');
  }
  return file;
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
 * (see tests/e2e/helpers/auth.js). The budget that covers the sweep, the
 * wave width and the delete cap are documented there.
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
  // NAME starts with the prefix. One page is therefore not the
  // population, and the sweep cannot
  // tell "the files beyond the page are not mine" from "the files beyond
  // the page are mine and were not removed" — the second one is a
  // leftover. Enumerate the pages the budget allows.
  const files = [];
  let total;
  let listFailure = null;
  let exhausted = false;
  let pagesRead = 0;
  for (let page = 1; page <= SWEEP_MAX_LIST_PAGES; page++) {
    let listRes;
    try {
      listRes = await request(
        'GET',
        `/api/files?limit=${PAGE_SIZE}&page=${page}&search=${encodeURIComponent(prefix)}`,
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
    const pageFiles = listRes.data?.data;
    if (!Array.isArray(pageFiles)) {
      // A response without the array is a changed contract, not an empty
      // population: reading it as empty would end the sweep with a green
      // report and the suite's documents still in place.
      listFailure = `page ${page} carried no file array (the response shape changed)`;
      break;
    }
    files.push(...pageFiles);
    pagesRead++;
    // The population is the same on every page: keep the first count
    // that arrives, so a page without a pagination object does not erase
    // what the previous page established.
    if (total === undefined) {
      total = listRes.data?.pagination?.totalFiles;
    }
    if (pageFiles.length < PAGE_SIZE) {
      exhausted = true;
      break;
    }
  }

  // Two populations, and the report must not conflate them: the
  // POPULATION is every file the endpoint matched (the CONTAINS set),
  // the suite's OWN is the prefix-matching ones inside it — only those
  // are the sweep's to remove.
  const own = files.filter((f) => f.file_name && f.file_name.startsWith(prefix));
  const populationKnown = total !== undefined;
  const enumeratedAll = populationKnown ? files.length >= total : exhausted;

  // The delete set holds each file ONCE: dedupeByIds drops the rows
  // pagination drift listed twice (why: dedupeByIds in helpers/auth.js,
  // #1864).
  const ownUnique = dedupeByIds(own, fileIdOf);

  const deleteSet = ownUnique.slice(0, SWEEP_DOCS_MAX_DELETES);
  const beyondBudget = ownUnique.length - deleteSet.length;

  // The deletes run in bounded-parallel waves: with the STILL_SERVING
  // remedy a serving file costs up to three calls (DELETE, retract,
  // DELETE), so the wave and budget arithmetic lives in helpers/auth.js
  // (SWEEP_DOCS_MAX_DELETES) and must account for all three (#1864).
  const failures = (
    await mapWithConcurrency(deleteSet, SWEEP_DELETE_CONCURRENCY, async (f) => {
      // The whole per-file sequence — the delete and its STILL_SERVING
      // remedy — lives in sweepDeleteOneFile, so the unit spec can script
      // the transport and pin the call order (#1864).
      return sweepDeleteOneFile(request, f, token);
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
      `${beyondBudget} test documents are beyond the sweep's delete budget (${SWEEP_DOCS_MAX_DELETES} ` +
        `per run) — they stay behind until a later run removes them`
    );
  }
  if (!enumeratedAll) {
    // What the sweep knows depends on the branch: either the POPULATION
    // exceeds the window it enumerated, or the population's size is
    // unknown. Either way the sweep cannot account for everything it
    // may own — and it says so, rather than naming a leftover it has
    // not established.
    problems.push(
      populationKnown
        ? `the sweep did not enumerate the whole population — a prefix-matching file beyond the ` +
            `last enumerated page, if any, was not removed`
        : pagesRead > 0
          ? `the population size is unknown — the sweep read full pages, so a prefix-matching file ` +
            `beyond the last enumerated page, if any, was not removed`
          : `the population size is unknown and the sweep read NOTHING — no prefix-matching file ` +
            `can be accounted for, and any of them may remain`
    );
  }
  if (problems.length > 0) {
    const scope = populationKnown
      ? `population: ${total} matching files, ${files.length} read, ${ownUnique.length} of them the suite's own`
      : `population unknown, ${files.length} matching files read, ${ownUnique.length} of them the suite's own`;
    throw new Error(`cleanup: ${problems.length} problem(s) — ${scope} — ${problems.join(' | ')}`);
  }
}

module.exports = {
  navigateToDocumentManagement,
  openUploadDialog,
  uploadFile,
  uploadFileViaApi,
  triggerIngestViaApi,
  waitForFileIngestedViaApi,
  waitForDocumentInTable,
  searchDocuments,
  waitForTableRowsSettled,
  getDocumentTableRows,
  deleteAllTestDocuments,
  sweepDeleteOneFile,
  matchesStatus
};
