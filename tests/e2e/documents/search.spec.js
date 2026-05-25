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

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');

test.describe('Document Search', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToDocumentManagement(page);
  });

  test.afterAll(async () => {
    await deleteAllTestDocuments('test-document');
  });

  test('search by partial file name returns matching documents', async ({ page }) => {
    await uploadFile(page, path.join(FIXTURES_DIR, 'test-document.txt'));
    await waitForDocumentInTable(page, 'test-document.txt');

    await searchDocuments(page, 'test-document');

    const rows = await getDocumentTableRows(page);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const hasMatch = rows.some((r) => r.fileName.includes('test-document'));
    expect(hasMatch).toBeTruthy();
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

    const statusFilter = page.locator('.filter-select select');
    await expect(statusFilter).toBeVisible({ timeout: 5000 });
    await statusFilter.selectOption('pending');
    await page.waitForTimeout(500);

    const rows = await getDocumentTableRows(page);
    if (rows.length > 0) {
      const allPending = rows.every(
        (r) => r.status.toLowerCase() === 'pending',
      );
      expect(allPending).toBeTruthy();
    }
  });
});
