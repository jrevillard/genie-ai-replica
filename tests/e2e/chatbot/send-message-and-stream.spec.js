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
const { SESSION_MINT_TIMEOUT_MS } = require('../helpers/auth');
const { skipUnlessVenue, frenchStreamingReady, frenchStreamingMissingReason } = require('../helpers/venue-profile');

// The French-only words the answer must carry. French shares 'la', 'le',
// 'un', 'de', 'que', 'ce' and 'il' with Spanish, Italian and Portuguese —
// a word from that set would pass an answer in another Latin-script
// language — so the list carries only words French does not share:
// 'est' (Spanish 'es'), 'sont', 'elle', 'nous', 'vous', 'dans', 'avec',
// 'cette', 'pour', 'une', 'des', 'du', 'les', 'qui', 'tout', 'aux',
// 'leur', 'ses', 'être', 'aussi', 'ainsi', 'donc', 'ne', 'pas'. ('plus'
// is deliberately absent: it is an ordinary English word, and an English
// answer would carry it.)
const FRENCH_ONLY_WORDS = [
  'est',
  'sont',
  'elle',
  'elles',
  'nous',
  'vous',
  'dans',
  'avec',
  'cette',
  'pour',
  'une',
  'des',
  'du',
  'les',
  'qui',
  'tout',
  'toute',
  'aux',
  'leur',
  'ses',
  'être',
  'aussi',
  'ainsi',
  'donc',
  'ne',
  'pas'
];

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
  // deployment's whitelist, an app that adopts it, and a translation chain
  // that answers en→fr with a TRANSLATED text, this group's pin would
  // measure a fallback page and its premise is simply absent (#1742). The
  // skip hook is the group's first beforeAll, so the guarded setup after it
  // never runs on a parked venue.
  test.beforeAll(async () => {
    // The premise opens a browser session of its own (the realm refuses
    // direct grants, so the probe logs in through the browser — a mint
    // budgeted at SESSION_MINT_TIMEOUT_MS). A hook runs under the PROJECT's
    // timeout otherwise (60 s), and the probe would be cut mid-login: the
    // group would ERROR instead of skipping, which is the opposite of what
    // the venue-skip contract is for.
    test.setTimeout(SESSION_MINT_TIMEOUT_MS + 120000);
    await skipUnlessVenue(test, frenchStreamingReady, frenchStreamingMissingReason)();
  });

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

    // The answer is FRENCH, not merely untranslated: a venue whose
    // translation chain silently answered with the English text would
    // carry translationFailed=false and pass the two checks below without
    // having translated anything.
    //
    // The words are FRENCH-ONLY ones — 'est', 'sont', 'elle', 'nous',
    // 'dans', 'avec', 'cette', 'pour' … — and not the words French shares
    // with Spanish or Italian ('la', 'le', 'un', 'de', 'que', 'ce'): one
    // shared word would pass an answer in another Latin-script language.
    // TWO of them are required, so a single quoted coincidence (a file
    // name in the sources, a proper noun) cannot carry the assertion.
    const frenchWords = FRENCH_ONLY_WORDS.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(botText));
    expect(
      frenchWords.length,
      `the answer is in French (French-only words found: ${frenchWords.join(', ') || 'none'})`
    ).toBeGreaterThanOrEqual(2);

    // The app's own translation verdict, read twice on two channels:
    //
    // 0. The DOM must have PROCESSED the done frame before the marker can
    //    be read: the action row renders only on a completed turn (it
    //    carries the query id the done frame delivers), so its presence is
    //    the DOM's own signal that the frame landed. Without that wait the
    //    marker check below would read a DOM one patch behind the store
    //    and pass for the wrong reason.
    await expect(page.locator('[data-testid="answer-actions"]')).toBeVisible();
    //
    // 1. The DOM marker renders ONLY when the done frame carried
    //    translationFailed=true (the amber note beside an English answer a
    //    failed translation left behind) — its absence is the UI contract.
    await expect(page.locator('[data-testid="translation-failed"]')).toHaveCount(0);

    // 2. The store's flag on the completed turn — the same getter the
    //    streaming-flag wait reads, mapped through the helper's page-side
    //    read. `false` is the contract: the completed turn carries NO
    //    failed-translation verdict, which is what the backend reports on
    //    `done` when its translator could not answer. (The store coerces
    //    the flag with Boolean(), so a turn that never received a verdict
    //    carries `false` too — the flag says "the translation did not
    //    fail", not "the backend sent a verdict". The answer's LANGUAGE,
    //    asserted above, is what proves the translation happened.)
    const read = await page.evaluate(readStreamingState);
    const translationFailed = lastBotTranslationFailedOf(read);
    if (translationFailed === NOT_READABLE) {
      throw new Error(`the store read could not see the completed turn: ${read && read.state}`);
    }
    expect(
      translationFailed,
      `the completed turn carries no failed-translation verdict (got ${JSON.stringify(translationFailed)})`
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
