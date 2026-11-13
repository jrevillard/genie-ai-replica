const { test, expect } = require('@playwright/test');
const {
  loginViaUI,
  navigateToChatbot,
  LOGIN_BUDGET_TIMEOUT_MS,
  sendMessage,
  waitForBotResponse,
  getMessages,
  getLastBotMessage,
  BOT_BUBBLE,
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
      bypassCSP: true,
    });
    page = await context.newPage();

    await loginViaUI(page);
    await navigateToChatbot(page);
  });

  test.afterEach(async () => {
    await context?.close();
  });

  test('sends a message and displays it as a user bubble', async () => {
    const userText = 'What services are available?';

    await sendMessage(page, userText);

    const messages = await getMessages(page);
    expect(messages.length).toBeGreaterThanOrEqual(1);

    const userMessage = messages.find(
      (m) => m.sender === 'user' && m.text.includes('What services are available'),
    );
    expect(userMessage).toBeTruthy();
  });

  test('receives a bot response after sending a message', async () => {
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
    const nextBotIdx = messages.findIndex(
      (m, i) => i > firstUserIdx && m.sender === 'bot',
    );
    expect(nextBotIdx).toBeGreaterThan(firstUserIdx);
  });

  test('SSE stream renders bot response progressively', async () => {
    await sendMessage(page, 'Tell me about public services');

    // Progressive rendering: the bubble's text grows as SSE chunks arrive.
    // The baseline is captured once the turn has started (content in the
    // placeholder) — a number the growth matcher can compare against —
    // and the poll holds until the text has grown past it: a bubble that
    // only ever renders its full text in one frame fails the poll.
    const botBubble = page.locator(BOT_BUBBLE).last();
    await expect(botBubble).toContainText(/\S/, { timeout: 30000 });
    const firstLength = (await botBubble.innerText()).trim().length;
    await expect
      .poll(async () => (await botBubble.innerText()).trim().length, { timeout: 30000 })
      .toBeGreaterThan(firstLength);

    // Completion: the full answer is in, and the spinner is gone
    // (waitForBotResponse asserts both).
    await waitForBotResponse(page, { timeout: 120000 });
  });
});
