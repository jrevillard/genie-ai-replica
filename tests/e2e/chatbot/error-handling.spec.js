const { test, expect } = require('@playwright/test');
const {
  loginViaUI,
  navigateToChatbot,
  sendMessage,
  waitForBotResponse,
  getLastBotMessage,
  BASE_URL,
} = require('../helpers/chatbot');

// A failed turn ends with the answer card's error block, and that card
// is the turn's completion signal: the app renders it only once the
// stream has closed. It is also the surface the old assertions missed —
// `.loading-spinner` (the spinner wait) and `.status-error-message`
// (the error fallback) are rendered by no component, so neither half of
// the old assertion could ever pass on its own and the error was never
// really observed. Every test below waits on the card instead.
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
    let attemptCount = 0;

    // First call returns error, second call proceeds normally (validates retry)
    await page.route('**/api/queries/stream', (route) => {
      attemptCount++;
      if (attemptCount === 1) {
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'SERVICE_UNAVAILABLE',
            message: 'RAG pipeline is temporarily unavailable',
          }),
        });
      } else {
        route.fallback();
      }
    });

    await sendMessage(page, 'First attempt will fail');

    // The failed turn ends with the error card — see the describe
    // comment for why that card is the wait.
    await expect(page.locator('[data-testid="answer-error"]')).toBeVisible({ timeout: 30000 });

    // Input should be usable again after error
    const textarea = page.locator('[data-testid="composer-field"]');
    await expect(textarea).toBeVisible({ timeout: 5000 });

    // Remove the intercept so subsequent requests go through normally
    await page.unroute('**/api/queries/stream');

    // Send another message — should work now (retry probe). The
    // probe is only a probe if the retry actually ANSWERS: a second
    // turn that silently fails must fail this test too.
    await sendMessage(page, 'Second attempt should work');
    await waitForBotResponse(page, { timeout: 120000 });
    expect(await getLastBotMessage(page), 'the retry must produce an answer').not.toBe('');

    // Verify the input is still functional
    await expect(textarea).toBeVisible({ timeout: 5000 });

    await textarea.fill('Can still type after error');
    const value = await textarea.inputValue();
    expect(value).toBe('Can still type after error');
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

    // The failed turn ends with the error card — see the describe
    // comment for why that card is the wait.
    await expect(page.locator('[data-testid="answer-error"]')).toBeVisible({ timeout: 30000 });

    // Verify the chat is not stuck
    const textarea = page.locator('[data-testid="composer-field"]');
    await expect(textarea).toBeVisible({ timeout: 5000 });
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

    // The failed turn ends with the error card — see the describe
    // comment for why that card is the wait.
    await expect(page.locator('[data-testid="answer-error"]')).toBeVisible({ timeout: 30000 });

    // Input should be usable again
    const textarea = page.locator('[data-testid="composer-field"]');
    await expect(textarea).toBeVisible({ timeout: 5000 });
  });
});
