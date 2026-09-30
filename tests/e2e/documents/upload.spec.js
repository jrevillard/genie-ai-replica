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

  for (const ext of ['txt', 'md', 'pdf']) {
    test(`upload a .${ext} file and verify it appears in the document table`, async ({ page }) => {
      const fileName = `test-document.${ext}`;
      await uploadFile(page, path.join(FIXTURES_DIR, fileName));

      const row = await waitForDocumentInTable(page, fileName);
      await expect(row).toBeVisible();

      const cellText = await row.locator('td.cell-main').innerText();
      expect(cellText.trim()).toContain(fileName);

      const statusTag = row.locator('DsStatusTag, .status-tag, [class*="status"]');
      const statusText = (await statusTag.isVisible())
        ? (await statusTag.innerText()).trim()
        : '';
      expect(statusText.toLowerCase()).toContain('pending');
    });
  }

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
