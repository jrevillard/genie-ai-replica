const { expect } = require('@playwright/test');
const { loginViaUI, BASE_URL, TEST_USER } = require('./chatbot');
const { getAdminToken, request } = require('./auth');

/**
 * Login and navigate to Document Management tab in Admin Dashboard.
 */
async function navigateToDocumentManagement(page) {
  await loginViaUI(page);
  await page.goto(`${BASE_URL}/admin`, {
    waitUntil: 'networkidle',
    timeout: 30000,
  });

  const docTab = page.getByText('Document Management');
  await expect(docTab).toBeVisible({ timeout: 10000 });
  await docTab.click();

  await expect(page.locator('table.data-table')).toBeVisible({ timeout: 15000 });
}

/**
 * Upload a file via the upload dialog.
 * Opens dialog → sets file on input → confirms upload → waits for success.
 */
async function uploadFile(page, filePath) {
  const uploadBtn = page.locator('.filter-bar').getByText('Upload Files');
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
  const row = page.locator('tr.document-row').filter({ hasText: fileName });
  await expect(row).toBeVisible({ timeout });
  return row;
}

/**
 * Search documents by typing in the search input and waiting for table refresh.
 */
async function searchDocuments(page, query) {
  const searchInput = page.locator('.search-input input');
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
 * Delete a document by file name via API.
 * Uses admin token since DELETE requires Admin role.
 */
async function deleteDocumentByName(page, fileName) {
  const token = await getAdminToken();

  const listRes = await request('GET', '/api/files?limit=100', {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (listRes.status !== 200) {
    throw new Error(`Failed to list files: ${listRes.status}`);
  }

  const files = listRes.data.files || listRes.data;
  const match = files.find((f) => f.file_name === fileName);
  if (match) {
    const file_id = match.file_id || match._key || match.id;
    await request('DELETE', `/api/files/${file_id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }
}

/**
 * Delete all test documents matching a prefix via API.
 * Used for test cleanup.
 */
async function deleteAllTestDocuments(prefix = 'test-document') {
  const token = await getAdminToken();

  const listRes = await request('GET', '/api/files?limit=100', {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (listRes.status !== 200) return;

  const files = listRes.data.files || listRes.data;
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
  deleteDocumentByName,
  deleteAllTestDocuments,
};
