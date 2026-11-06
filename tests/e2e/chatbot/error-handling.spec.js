const { test, expect } = require('@playwright/test');
const {
  loginViaUI,
  navigateToChatbot,
  sendMessage,
  waitForBotResponse,
  getLastBotMessage,
} = require('../helpers/chatbot');

// One spelling for the stream endpoint inside this file: the route and
// the unroute that removes it must be the same string — Playwright drops
// a handler only on an exact match — so both read the constant.
const STREAM_ROUTE = '**/queries/stream**';

/**
 * Answer the app's stream POST with an error status.
 *
 * Only the POST carries a stream: a CORS preflight (the cross-origin
 * posture) must reach the network — answered with the error body it fails
 * the handshake and the browser never delivers the POST. The mocked
 * response carries the CORS header a cross-origin reader needs, or the
 * browser drops it and the app renders a transport failure instead of the
 * injected status.
 */
async function mockStreamError(page, { status, error, message }) {
  const body = JSON.stringify({ error, message });
  await page.route(STREAM_ROUTE, async (route) => {
    try {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body,
      });
    } catch (failure) {
      // The context can close while a request is still in flight, and that
      // race must not fail the spec. Every other failure surfaces — a
      // swallowed one fails the spec later, with a cause that points
      // nowhere (tests/e2e/CLAUDE.md: no swallowing).
      if (!/has been closed/i.test(failure?.message || '')) {
        throw failure;
      }
    }
  });
}

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
    await mockStreamError(page, {
      status: 503,
      error: 'SERVICE_UNAVAILABLE',
      message: 'RAG pipeline is temporarily unavailable',
    });

    await sendMessage(page, 'First attempt will fail');

    // The failed turn ends with the error card — see the describe
    // comment for why that card is the wait.
    await expect(page.locator('[data-testid="answer-error"]')).toBeVisible({ timeout: 30000 });

    // A 5xx means the deployment is down, not that it refused the
    // request: the navbar pill flips to its offline state.
    await expect(page.locator('[data-testid="nav-status"]')).toHaveAttribute('data-status', 'offline');

    // Input should be usable again after error
    const textarea = page.locator('[data-testid="composer-field"]');
    await expect(textarea).toBeVisible({ timeout: 5000 });

    // Remove the intercept so subsequent requests go through normally
    await page.unroute(STREAM_ROUTE);

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
    await mockStreamError(page, {
      status: 502,
      error: 'BAD_GATEWAY',
      message: 'Network connection failed',
    });

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
    await mockStreamError(page, {
      status: 500,
      error: 'INTERNAL_ERROR',
      message: 'An internal error occurred in the RAG pipeline',
    });

    await sendMessage(page, 'Trigger internal error');

    // The failed turn ends with the error card — see the describe
    // comment for why that card is the wait.
    await expect(page.locator('[data-testid="answer-error"]')).toBeVisible({ timeout: 30000 });

    // Input should be usable again
    const textarea = page.locator('[data-testid="composer-field"]');
    await expect(textarea).toBeVisible({ timeout: 5000 });
  });
});
