const { test, expect } = require('@playwright/test');
const {
  loginViaUI,
  navigateToChatbot,
  sendMessage,
  waitForBotResponse,
  getLastBotMessage,
  mockChatStream,
  mockStreamError,
  NAV_STATUS,
  STREAM_ROUTE,
} = require('../helpers/chatbot');

// A failed turn ends with the answer card's error block, and that card
// is the turn's completion signal: the app renders it only once the
// stream has closed. It is also the surface the old assertions missed —
// `.loading-spinner` (the spinner wait) and `.status-error-message`
// (the error fallback) are rendered by no component, so neither half of
// the old assertion could ever pass on its own and the error was never
// really observed. Every test in this file waits on the card instead.
//
// One spec, one claim: the app cannot tell a 502 from a 503 from a 500.
// The client turns every non-2xx into the same error and the store maps
// every 5xx to the same branch (`refused` is the 4xx case alone), so one
// server error is enough to own it — the refusal branch, the idle
// timeout and the server error frames have their own owners in the store
// tests, and a dropped connection has one in chat-conversation.spec.js.
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
    // The backend answers the stream with a server error; only the
    // status matters here, the body is the helper's default.
    await mockStreamError(page, { status: 503 });

    await sendMessage(page, 'First attempt will fail');

    // The failed turn ends with the error card — see the describe
    // comment for why that card is the wait.
    await expect(page.locator('[data-testid="answer-error"]')).toBeVisible({ timeout: 30000 });

    // A 5xx means the deployment is down, not that it refused the
    // request: the navbar pill flips to its offline state.
    await expect(page.locator(NAV_STATUS)).toHaveAttribute('data-status', 'offline');

    // Input should be usable again after error
    const textarea = page.locator('[data-testid="composer-field"]');
    await expect(textarea).toBeVisible({ timeout: 5000 });

    // Replace the failing mock with an answering one: the retry probe
    // proves the app RECOVERS from the error state, which is a property
    // of the app — whether the real RAG pipeline answers is not, and a
    // live-backend dependency here would fail the spec on a loaded venue
    // (tests/e2e/CLAUDE.md: fixed, deterministic seed). The probe is only
    // a probe if the retry actually ANSWERS: a second turn that silently
    // fails must fail this test too — hence the answer assertion below.
    await page.unroute(STREAM_ROUTE);
    await mockChatStream(page, ['Recovered answer after the error.']);

    await sendMessage(page, 'Second attempt should work');
    await waitForBotResponse(page, { timeout: 120000 });
    expect(await getLastBotMessage(page), 'the retry must produce an answer').not.toBe('');

    // Verify the input is still functional
    await expect(textarea).toBeVisible({ timeout: 5000 });

    await textarea.fill('Can still type after error');
    const value = await textarea.inputValue();
    expect(value).toBe('Can still type after error');
  });
});
