const { test, expect } = require('@playwright/test');
const path = require('path');
const {
  navigateToDocumentManagement,
  uploadFile,
  waitForDocumentInTable,
  searchDocuments,
  getDocumentTableRows,
  deleteAllTestDocuments,
} = require('../helpers/documents');
const { SESSION_MINT_TIMEOUT_MS } = require('../helpers/auth');

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');

test.describe('Document Search', () => {
  // Same composition as the upload suite: login + navigation + table waits.
  test.setTimeout(120000);

  test.beforeEach(async ({ page }) => {
    await navigateToDocumentManagement(page);
  });

  test.afterAll(async ({ browser }) => {
    // The helper's mint + list + delete sweep outlives the 60s hook default.
    test.setTimeout(SESSION_MINT_TIMEOUT_MS);
    await deleteAllTestDocuments('test-document', { browser });
  });

  test('search by partial file name returns matching documents', async ({ page }) => {
    await uploadFile(page, path.join(FIXTURES_DIR, 'test-document.txt'));
    await uploadFile(page, path.join(FIXTURES_DIR, 'test-document.md'));
    await waitForDocumentInTable(page, 'test-document.md');

    await searchDocuments(page, 'test-document.txt');

    const rows = await getDocumentTableRows(page);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const hasMatch = rows.some((r) => r.fileName.includes('test-document.txt'));
    expect(hasMatch).toBeTruthy();
    const hasNonMatch = rows.some((r) => r.fileName.includes('test-document.md'));
    expect(hasNonMatch).toBeFalsy();
  });

  test('search for non-existent file name shows no results message', async ({ page }) => {
    await searchDocuments(page, 'nonexistent-file-xyz-12345');

    const emptyMessage = page.locator('.table-message');
    await expect(emptyMessage).toBeVisible({ timeout: 10000 });
    const text = await emptyMessage.innerText();
    expect(text.toLowerCase()).toContain('no documents');
  });

  test('clear search shows all documents again', async ({ page }) => {
    await uploadFile(page, path.join(FIXTURES_DIR, 'test-document.txt'));
    await waitForDocumentInTable(page, 'test-document.txt');

    await searchDocuments(page, 'nonexistent-xyz');
    const emptyMessage = page.locator('.table-message');
    await expect(emptyMessage).toBeVisible({ timeout: 10000 });

    await searchDocuments(page, '');

    const rows = await getDocumentTableRows(page);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  test('filter by Pending status shows only pending documents', async ({ page }) => {
    await uploadFile(page, path.join(FIXTURES_DIR, 'test-document.txt'));
    await waitForDocumentInTable(page, 'test-document.txt');

    // DsSelect renders the passed class on the native select itself
    const statusFilter = page.locator('select.filter-select');
    await expect(statusFilter).toBeVisible({ timeout: 5000 });
    // The filter watcher fires loadDocuments immediately (no debounce) —
    // wait for that request, then one render tick, before reading rows.
    // No .catch here: a filter that fires no request IS the defect this
    // test exists to catch, and the wait must fail loudly on it.
    const filesResponse = page.waitForResponse((r) => r.url().includes('/api/files'), { timeout: 5000 });
    await statusFilter.selectOption('pending');
    await filesResponse;
    await page.waitForTimeout(250);

    const rows = await getDocumentTableRows(page);
    // Earlier tests in this suite uploaded pending test documents, so a
    // working Pending filter lists them; an empty table means the filter
    // regressed, and the assertion must fail, not skip.
    expect(rows.length, 'the Pending filter lists the pending documents').toBeGreaterThanOrEqual(1);
    const allPending = rows.every((r) => r.status.toLowerCase() === 'pending');
    expect(allPending, 'every listed document is Pending').toBeTruthy();
  });
});
