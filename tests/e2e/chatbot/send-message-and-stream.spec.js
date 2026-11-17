const { test, expect } = require('@playwright/test');
const {
  loginViaUI,
  navigateToChatbot,
  LOGIN_BUDGET_TIMEOUT_MS,
  sendMessage,
  waitForBotResponse,
  getMessages,
  getLastBotMessage,
  readStreamingState,
  lastBotResponseTimeOf,
  lastBotTranslationFailedOf,
  NOT_READABLE,
  USER_BUBBLE
} = require('../helpers/chatbot');
const { pinLocale, assertAdoptedLocale } = require('../helpers/locale');
const { skipUnlessVenue, frenchStreamingReady, frenchStreamingMissingReason } = require('../helpers/venue-profile');

test.describe('Chatbot message sending and SSE streaming', () => {
  // The beforeEach logs in through the browser and navigates — the
  // budget is the login's own ceiling, derived once beside loginViaUI
  // (#1798).
  test.describe.configure({ timeout: LOGIN_BUDGET_TIMEOUT_MS });

  let page;
  let context;

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext({
      ignoreHTTPSErrors: true,
      bypassCSP: true
    });
    page = await context.newPage();

    await loginViaUI(page);
    await navigateToChatbot(page);
  });

  test.afterEach(async () => {
    await context?.close();
  });

  test('sends a message and displays it verbatim as the only user bubble', async () => {
    const userText = 'What services are available?';

    await sendMessage(page, userText);

    // The exact echo, not a probe: the bubble carries the whole question,
    // untruncated, and the fresh chat renders exactly one user turn.
    const userBubble = page.locator(USER_BUBBLE);
    await expect(userBubble).toHaveCount(1);
    await expect(userBubble).toHaveText(userText, { timeout: 10000 });
  });

  test('receives a bot response carrying the stream metadata after sending a message', async () => {
    await sendMessage(page, 'Hello, what can you help me with?');
    await waitForBotResponse(page, { timeout: 120000 });

    const botText = await getLastBotMessage(page);
    expect(botText.length).toBeGreaterThan(0);

    // The turn's completion is already asserted twice above — content in
    // the bubble, and the store's streaming flag cleared (the poll in
    // waitForBotResponse). The streaming indicator renders only while the
    // answer is empty, so it is structurally gone once content exists; an
    // explicit "no spinner" count here could never fail.

    // Verify chat window contains both user and bot messages in correct order
    const messages = await getMessages(page);
    const userMsgs = messages.filter((m) => m.sender === 'user');
    const botMsgs = messages.filter((m) => m.sender === 'bot');
    expect(userMsgs.length).toBeGreaterThanOrEqual(1);
    expect(botMsgs.length).toBeGreaterThanOrEqual(1);

    // The user message should be immediately followed by a bot response
    const firstUserIdx = messages.findIndex((m) => m.sender === 'user');
    const nextBotIdx = messages.findIndex((m, i) => i > firstUserIdx && m.sender === 'bot');
    expect(nextBotIdx).toBeGreaterThan(firstUserIdx);

    // The real stream's metadata reached the app: the backend ALWAYS
    // emits a metadata frame on a completed turn (its own responseTime —
    // query-routes.js writes it even when chatqna sent none), and the
    // store commits it onto the turn. Read it through the helper's store
    // read (the same wiring the streaming-flag wait uses, unit-tested
    // against the page-side read), and decide on the mapped value. The
    // turn's presence alone proves nothing — the streaming placeholder
    // mounts with a metadata object already on it — so the CONTRACT is
    // the frame's own field: a numeric responseTime only a metadata
    // frame can deliver.
    const read = await page.evaluate(readStreamingState);
    const responseTime = lastBotResponseTimeOf(read);
    if (responseTime === NOT_READABLE) {
      // The read could not see a completed turn at all — a broken store
      // contract or a missing getter, the same named causes the flag
      // reader reports, not a slow answer to wait out.
      throw new Error(`the store read could not see the completed turn: ${read && read.state}`);
    }
    expect(
      typeof responseTime,
      `the backend's responseTime rode the metadata frame (got ${JSON.stringify(responseTime)})`
    ).toBe('number');
  });
});

test.describe('Chatbot message sending and SSE streaming — the French answer', () => {
  // The venue premise runs FIRST: without an active 'fr' locale in the
  // deployment's whitelist and a translation chain that answers en→fr,
  // this group's pin would measure a fallback page and its premise is
  // simply absent (#1742). The skip hook is the group's first beforeAll,
  // so the guarded setup after it never runs on a parked venue.
  test.beforeAll(skipUnlessVenue(test, frenchStreamingReady, frenchStreamingMissingReason));

  test.describe.configure({ timeout: LOGIN_BUDGET_TIMEOUT_MS });

  let page;
  let context;

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext({
      ignoreHTTPSErrors: true,
      bypassCSP: true
    });
    page = await context.newPage();

    // The locale is pinned BEFORE any page script runs, and the pin is
    // proven (helpers/locale.js): the request's `context.language` is the
    // app's own UI locale, so a pin that did not land would ask for a
    // different language than the one this spec asserts. The adoption is
    // asserted on the booted app — a session that fell back to 'en'
    // measures the fallback and passes vacuously (#1891).
    await pinLocale(context, 'fr');
    await loginViaUI(page);
    await navigateToChatbot(page);
    await assertAdoptedLocale(page, 'the French streaming spec', 'fr');
  });

  test.afterEach(async () => {
    await context?.close();
  });

  test('streams the French translation when the UI locale is fr', async () => {
    // The question names the product, so the grounded answer carries the
    // proper noun in ANY language — the subject survives its translation
    // and the assertion is not a copy comparison.
    const question = 'What is GENIE.AI?';

    await sendMessage(page, question);
    await waitForBotResponse(page, { timeout: 120000 });

    const botText = await getLastBotMessage(page);
    expect(botText.length, 'the French answer arrived').toBeGreaterThan(0);
    expect(botText, 'the answer still names the subject of the question').toContain('GENIE');

    // The app's own translation verdict, read twice on two channels:
    //
    // 1. The DOM marker renders ONLY when the done frame carried
    //    translationFailed=true (the amber note beside an English answer a
    //    failed translation left behind) — its absence is the UI contract.
    await expect(page.locator('[data-testid="translation-failed"]')).toHaveCount(0);

    // 2. The store's flag on the completed turn — the same getter the
    //    streaming-flag wait reads, mapped through the helper's page-side
    //    read. `false` (not absent) is the contract: the done frame
    //    delivered the verdict for this turn.
    const read = await page.evaluate(readStreamingState);
    const translationFailed = lastBotTranslationFailedOf(read);
    if (translationFailed === NOT_READABLE) {
      throw new Error(`the store read could not see the completed turn: ${read && read.state}`);
    }
    expect(
      translationFailed,
      `the done frame carried translationFailed=false (got ${JSON.stringify(translationFailed)})`
    ).toBe(false);
  });
});

// NOTE on progressive rendering: there is deliberately NO frame-growth
// assertion on this real-stream surface. The BFF legitimately coalesces
// the answer into one chunk frame under buffering, so "the bubble grew
// between frames" would red a correct product; and a Playwright route
// interception cannot pace SSE frames (a fulfilled route delivers its
// whole body in one read). The frame-by-frame mechanics are owned by the
// store's Jest suite (conversation.test.js — chunk storms, metadata
// stamps), which controls the frames exactly.
