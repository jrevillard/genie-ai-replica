const { test, expect } = require('@playwright/test');
const path = require('path');
const {
  navigateToDocumentManagement,
  uploadFile,
  waitForDocumentInTable,
  deleteAllTestDocuments,
} = require('../helpers/documents');

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');

test.describe('Document Upload', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToDocumentManagement(page);
  });

  test.afterAll(async () => {
    await deleteAllTestDocuments('test-document');
  });

  test('upload a .txt file and verify it appears in the document table', async ({ page }) => {
    await uploadFile(page, path.join(FIXTURES_DIR, 'test-document.txt'));

    const row = await waitForDocumentInTable(page, 'test-document.txt');
    await expect(row).toBeVisible();

    const fileName = await row.locator('td.cell-main').innerText();
    expect(fileName.trim()).toContain('test-document.txt');

    const statusTag = row.locator('DsStatusTag, .status-tag, [class*="status"]');
    const statusText = (await statusTag.isVisible())
      ? (await statusTag.innerText()).trim()
      : '';
    expect(statusText.toLowerCase()).toContain('pending');
  });

  test('upload a .md file and verify it appears in the document table', async ({ page }) => {
    await uploadFile(page, path.join(FIXTURES_DIR, 'test-document.md'));

    const row = await waitForDocumentInTable(page, 'test-document.md');
    await expect(row).toBeVisible();

    const fileName = await row.locator('td.cell-main').innerText();
    expect(fileName.trim()).toContain('test-document.md');

    const statusTag = row.locator('DsStatusTag, .status-tag, [class*="status"]');
    const statusText = (await statusTag.isVisible())
      ? (await statusTag.innerText()).trim()
      : '';
    expect(statusText.toLowerCase()).toContain('pending');
  });

  test('upload a .pdf file and verify it appears in the document table', async ({ page }) => {
    await uploadFile(page, path.join(FIXTURES_DIR, 'test-document.pdf'));

    const row = await waitForDocumentInTable(page, 'test-document.pdf');
    await expect(row).toBeVisible();

    const fileName = await row.locator('td.cell-main').innerText();
    expect(fileName.trim()).toContain('test-document.pdf');

    const statusTag = row.locator('DsStatusTag, .status-tag, [class*="status"]');
    const statusText = (await statusTag.isVisible())
      ? (await statusTag.innerText()).trim()
      : '';
    expect(statusText.toLowerCase()).toContain('pending');
  });

  test('reject .exe file and display error message', async ({ page }) => {
    const uploadBtn = page.locator('.filter-bar').getByText('Upload Files');
    await expect(uploadBtn).toBeVisible({ timeout: 5000 });
    await uploadBtn.click();

    const dialog = page.locator('.dialog-container');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const fileInput = page.locator('.drop-zone input[type="file"]');
    await fileInput.setInputFiles(path.join(FIXTURES_DIR, 'invalid-document.exe'));

    const errorMessage = page.locator('.dialog-container .error-message');
    await expect(errorMessage).toBeVisible({ timeout: 5000 });
    const errorText = await errorMessage.innerText();
    expect(errorText.toLowerCase()).toMatch(/not allowed|not supported|invalid/i);
  });
});
