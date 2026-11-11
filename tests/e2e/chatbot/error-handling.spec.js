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

// The answer the mocked retry serves — the same string the assertion
// reads, so the two cannot drift apart.
const RECOVERED_ANSWER = 'Recovered answer after the error.';

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
  // This spec's OWN budget. The project's 60 s is too small for what it
  // asserts on purpose: the waits below are ceilings, and a loaded
  // venue spends them slowly. A budget that cannot cover its own
  // ceilings would abort the test with a generic timeout instead of the
  // assertion that names the cause.
  //
  // The ceilings of the BODY, in the order they are waited:
  //
  //   - sendMessage #1 waits for the composer: 10 s;
  //   - the error card: 30 s;
  //   - the navbar's offline state (expect's default): 15 s;
  //   - the composer again: 5 s;
  //   - sendMessage #2 waits for the composer again: 10 s;
  //   - the retry's answer: TWO successive 10 s waits — the bubble's
  //     text, then the streaming flag — so 20 s;
  //   - the composer a third time: 5 s.
  //
  // That is 95 s of waiting in the BODY. The beforeEach adds the login
  // (up to 30 s + a 15 s retry) and the navigation (30 s) — 75 s more.
  //
  // The budget covers the BODY's sum: the hook has its own budget, and
  // `test.describe.configure({ timeout })` reaches it (measured: the hook
  // reads the same 180 s).
  test.describe.configure({ timeout: 180000 });

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
    // status matters here, and the helper's default IS that status.
    await mockStreamError(page);

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
    await mockChatStream(page, [RECOVERED_ANSWER]);

    await sendMessage(page, 'Second attempt should work');
    // A mocked answer arrives in milliseconds: the ceiling is a ceiling,
    // not a floor. waitForBotResponse applies it to TWO successive waits
    // (the bubble's text, then the streaming flag), so 10 s is 20 s in
    // the worst case — and the two ceilings are never both spent: the
    // error card's 30 s wait above aborts the test there if it expires.
    // A retry that HANGS fails on that wait, with the helper's own
    // message; a retry that ERRORS renders no answer bubble and fails on
    // the assertion below. The spec's own timeout (120 s, above) covers
    // the sum of these ceilings plus the beforeEach's login.
    await waitForBotResponse(page, { timeout: 10000 });
    // The ANSWER, not merely a non-empty bubble: the welcome turn is a
    // bot bubble too, so "not empty" would pass on a retry that never
    // answered. The mock makes the exact text assertable.
    expect(await getLastBotMessage(page), 'the retry must produce the answer').toContain(RECOVERED_ANSWER);

    // Verify the input is still functional
    await expect(textarea).toBeVisible({ timeout: 5000 });

    await textarea.fill('Can still type after error');
    const value = await textarea.inputValue();
    expect(value).toBe('Can still type after error');
  });
});
