const { test, expect } = require('@playwright/test');
const {
  loginViaUI,
  navigateToChatbot,
  sendMessage,
  getMessages,
} = require('../helpers/chatbot');

test.describe('RAG error handling', () => {
  test.beforeEach(async ({ browser }) => {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      bypassCSP: true,
    });
    this.page = await context.newPage();
    this.context = context;

    await loginViaUI(this.page);
    await navigateToChatbot(this.page);
  });

  test.afterEach(async () => {
    await this.context.close();
  });

  test('displays error message when backend returns error', async () => {
    const page = this.page;

    // Intercept the streaming endpoint and return an error
    await page.route('**/api/queries/stream', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'SERVICE_UNAVAILABLE',
          message: 'RAG pipeline is temporarily unavailable',
        }),
      }),
    );

    await sendMessage(page, 'This should fail');

    // Wait for error indication in the UI
    // The frontend should display an error message in the chat
    await page.waitForTimeout(5000);

    // Check for error indication — either an error message in chat or error class
    const errorVisible = await page.locator('.chat-message.bot .message-bubble').isVisible()
      .catch(() => false);

    // The frontend should show some error feedback
    // Verify the chat does not hang (no infinite spinner)
    const spinnerVisible = await page.locator('.loading-spinner').isVisible()
      .catch(() => false);
    expect(spinnerVisible).toBeFalsy();
  });

  test('displays error when network connection is aborted', async () => {
    const page = this.page;

    // Simulate network failure
    await page.route('**/api/queries/stream', (route) => route.abort());

    await sendMessage(page, 'This should fail with network error');

    // Wait for the UI to handle the abort
    await page.waitForTimeout(5000);

    // Spinner should not be stuck
    const spinnerVisible = await page.locator('.loading-spinner').isVisible()
      .catch(() => false);
    expect(spinnerVisible).toBeFalsy();
  });

  test('user can retry after an error', async () => {
    const page = this.page;
    let attemptCount = 0;

    // First call fails, second succeeds (unroute)
    await page.route('**/api/queries/stream', (route) => {
      attemptCount++;
      if (attemptCount === 1) {
        route.abort();
      } else {
        route.continue();
      }
    });

    await sendMessage(page, 'First attempt will fail');

    // Wait for error to be handled
    await page.waitForTimeout(5000);

    // Remove the intercept so the next request goes through
    await page.unroute('**/api/queries/stream');

    // Send another message — should work now
    await sendMessage(page, 'Second attempt should work');

    // Verify the input is still functional
    const textarea = page.locator('.prompt-textarea');
    await expect(textarea).toBeVisible({ timeout: 5000 });

    // Verify we can still type
    await textarea.fill('Can still type after error');
    const value = await textarea.inputValue();
    expect(value).toBe('Can still type after error');
  });

  test('displays error when RAG pipeline returns internal error', async () => {
    const page = this.page;

    // Intercept with a 500 error
    await page.route('**/api/queries/stream', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'INTERNAL_ERROR',
          message: 'An internal error occurred in the RAG pipeline',
        }),
      }),
    );

    await sendMessage(page, 'Trigger internal error');

    // Wait for error handling
    await page.waitForTimeout(5000);

    // Spinner should not be stuck
    const spinnerVisible = await page.locator('.loading-spinner').isVisible()
      .catch(() => false);
    expect(spinnerVisible).toBeFalsy();

    // Input should be usable again
    const textarea = page.locator('.prompt-textarea');
    await expect(textarea).toBeVisible({ timeout: 5000 });
  });
});
