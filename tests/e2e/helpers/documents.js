const { expect } = require('@playwright/test');
const { loginViaUI, BASE_URL, TEST_ADMIN_USER } = require('./chatbot');
const { getSessionToken, request } = require('./auth');

/**
 * Login and navigate to Document Management tab in Admin Dashboard.
 * The documents surface (upload, delete, lifecycle) is ADMIN_ONLY on the
 * document-repository, so the session is the admin test user by default.
 */
async function navigateToDocumentManagement(page, user = TEST_ADMIN_USER) {
  await loginViaUI(page, user);
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
 * Upload a file via the upload dialog.
 * Opens dialog → sets file on input → confirms upload → waits for success.
 */
async function uploadFile(page, filePath) {
  // The upload button lives in the documents card's action bar
  // (.card-actions), not in .filter-bar — the filter bar holds only the
  // search and status controls.
  const uploadBtn = page.getByRole('button', { name: /Upload Files/i });
  await expect(uploadBtn).toBeVisible({ timeout: 5000 });
  await uploadBtn.click();

  const dialog = page.locator('.dialog-container');
  await expect(dialog).toBeVisible({ timeout: 5000 });

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
 * Search documents by typing in the search input and waiting for table refresh.
 */
async function searchDocuments(page, query) {
  // DsInput renders the passed class on the input element itself — the
  // search field IS `input.search-input`, not a child of `.search-input`.
  const searchInput = page.locator('input.search-input');
  await expect(searchInput).toBeVisible({ timeout: 5000 });
  await searchInput.clear();
  if (query) {
    await searchInput.fill(query);
  }
  await page.waitForTimeout(500);
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
    const status = (await statusTag.isVisible().catch(() => false))
      ? (await statusTag.innerText()).trim()
      : '';
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
 * realm tokens only).
 */
async function deleteAllTestDocuments(prefix = 'test-document') {
  const { chromium } = require('@playwright/test');
  const browser = await chromium.launch();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  let token;
  try {
    await loginViaUI(page, TEST_ADMIN_USER);
    token = await getSessionToken(page);
  } finally {
    await browser.close();
  }

  // The list endpoint validates limit <= 50 — a bigger page is a 400.
  const files = [];
  for (let pageNum = 1; ; pageNum++) {
    const listRes = await request('GET', `/api/files?limit=50&page=${pageNum}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (listRes.status !== 200) break;
    const pageFiles = listRes.data?.data || listRes.data?.files || [];
    files.push(...pageFiles);
    if (pageFiles.length < 50) break;
  }

  const testFiles = files.filter((f) => f.file_name && f.file_name.startsWith(prefix));

  for (const f of testFiles) {
    const file_id = f.file_id || f._key || f.id;
    await request('DELETE', `/api/files/${file_id}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).catch((e) => console.error('Cleanup: failed to delete', f.file_name, e.message));
  }
}

module.exports = {
  navigateToDocumentManagement,
  uploadFile,
  waitForDocumentInTable,
  searchDocuments,
  getDocumentTableRows,
  deleteAllTestDocuments,
};
