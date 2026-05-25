const { test, expect } = require('@playwright/test');
const {
  loginViaUI,
  navigateToChatbot,
  sendMessage,
  BASE_URL,
} = require('../helpers/chatbot');

test.describe('RAG error handling', () => {
  let page;
  let context;

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext({
      ignoreHTTPSErrors: true,
      bypassCSP: true,
    });
    page = await context.newPage();

    await loginViaUI(page);
    await navigateToChatbot(page);
  });

  test.afterEach(async () => {
    await context?.close();
  });

  test('displays error message when backend returns error', async () => {
    // Intercept the streaming endpoint and return a 503 error
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

    // Wait for spinner to disappear (frontend handled the error)
    await expect(page.locator('.loading-spinner')).toBeHidden({ timeout: 30000 });

    // Verify error message is displayed to the user (AC4)
    const statusError = page.locator('.status-error-message');
    const botBubble = page.locator('.chat-message.bot .message-bubble').last();
    await expect(
      statusError.or(botBubble),
    ).toBeVisible({ timeout: 5000 });

    // Input should be usable again after error
    const textarea = page.locator('.prompt-textarea');
    await expect(textarea).toBeVisible({ timeout: 5000 });
  });

  test('displays error when network connection fails', async () => {
    // Simulate network failure with error response (more reliable than abort for fetch+ReadableStream)
    await page.route('**/api/queries/stream', (route) =>
      route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'BAD_GATEWAY',
          message: 'Network connection failed',
        }),
      }),
    );

    await sendMessage(page, 'This should fail with network error');

    // Wait for spinner to disappear
    await expect(page.locator('.loading-spinner')).toBeHidden({ timeout: 30000 });

    // Verify error message is displayed (AC4)
    const statusError = page.locator('.status-error-message');
    const botBubble = page.locator('.chat-message.bot .message-bubble').last();
    await expect(
      statusError.or(botBubble),
    ).toBeVisible({ timeout: 5000 });

    // Verify the chat is not stuck
    const textarea = page.locator('.prompt-textarea');
    await expect(textarea).toBeVisible({ timeout: 5000 });
  });

  test('user can retry after an error', async () => {
    let attemptCount = 0;

    // First call returns error, second call proceeds normally
    await page.route('**/api/queries/stream', (route) => {
      attemptCount++;
      if (attemptCount === 1) {
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'SERVICE_UNAVAILABLE', message: 'Temporarily unavailable' }),
        });
      } else {
        route.fallback();
      }
    });

    await sendMessage(page, 'First attempt will fail');

    // Wait for error to be handled
    await expect(page.locator('.loading-spinner')).toBeHidden({ timeout: 30000 });

    // Remove the intercept so subsequent requests go through normally
    await page.unroute('**/api/queries/stream');

    // Send another message — should work now
    await sendMessage(page, 'Second attempt should work');

    // Verify the input is still functional
    const textarea = page.locator('.prompt-textarea');
    await expect(textarea).toBeVisible({ timeout: 5000 });

    await textarea.fill('Can still type after error');
    const value = await textarea.inputValue();
    expect(value).toBe('Can still type after error');
  });

  test('displays error when RAG pipeline returns internal error', async () => {
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

    // Wait for spinner to disappear
    await expect(page.locator('.loading-spinner')).toBeHidden({ timeout: 30000 });

    // Verify error message is displayed (AC4)
    const statusError = page.locator('.status-error-message');
    const botBubble = page.locator('.chat-message.bot .message-bubble').last();
    await expect(
      statusError.or(botBubble),
    ).toBeVisible({ timeout: 5000 });

    // Input should be usable again
    const textarea = page.locator('.prompt-textarea');
    await expect(textarea).toBeVisible({ timeout: 5000 });
  });
});
