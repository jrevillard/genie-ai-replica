const { test, expect } = require('@playwright/test');
const {
  loginViaUI,
  navigateToChatbot,
  LOGIN_BUDGET_TIMEOUT_MS,
  sendMessage,
  waitForBotResponse,
  getMessages,
  getLastBotMessage
} = require('../helpers/chatbot');

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
    const userBubble = page.locator('[data-testid="chat-message-user"] [data-testid="message-bubble-user"]');
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
    // store commits it onto the turn. Read it from the store's public
    // getter, the same path the streaming-flag read uses.
    const metadata = await page.evaluate(() => {
      const app = document.querySelector('#app');
      const store = app && app.__vue_app__ ? app.__vue_app__.config.globalProperties.$store : null;
      const open = store && store.getters ? store.getters['conversation/openConversation'] : null;
      const bots = open && open.messages ? open.messages.filter((m) => m.sender === 'bot') : [];
      const last = bots[bots.length - 1];
      return last ? { hasMetadata: !!last.metadata, responseTime: last.metadata?.responseTime } : null;
    });
    expect(metadata, 'the completed turn is in the store').not.toBeNull();
    expect(metadata.hasMetadata, 'the turn carries the stream metadata').toBe(true);
    expect(
      typeof metadata.responseTime,
      `the backend's responseTime rode the metadata frame (got ${JSON.stringify(metadata.responseTime)})`
    ).toBe('number');
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
