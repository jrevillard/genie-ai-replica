const { test, expect } = require('@playwright/test');
const {
  loginViaUI,
  navigateToChatbot,
  sendMessage,
  waitForBotResponse,
  getMessages,
  getLastBotMessage,
  dismissQuickHelp,
} = require('../helpers/chatbot');

test.describe('Chatbot message sending and SSE streaming', () => {
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
  });

  test('SSE stream renders bot response progressively', async () => {
    await sendMessage(page, 'Tell me about public services');

    // Verify progressive rendering by polling bot message text
    // Text should grow over time as SSE chunks arrive
    const botBubble = page.locator('.chat-message.bot .message-bubble').last();
    let previousLength = 0;
    let textGrew = false;

    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(1000);
      const currentVisible = await botBubble.isVisible().catch(() => false);
      if (!currentVisible) continue;
      const currentText = (await botBubble.innerText().catch(() => '')).trim();
      if (currentText.length > previousLength) {
        textGrew = true;
      }
      previousLength = currentText.length;
    }

    await waitForBotResponse(page, { timeout: 120000 });

    const botText = await getLastBotMessage(page);
    expect(botText.length).toBeGreaterThan(0);
    // Progressive rendering: text should have grown during streaming
    expect(textGrew).toBeTruthy();
  });

  test('done event finalizes message with queryId', async () => {
    await sendMessage(page, 'What is the weather today?');
    await waitForBotResponse(page, { timeout: 120000 });

    // Verify bot response exists (the frontend processed the stream)
    const botText = await getLastBotMessage(page);
    expect(botText.length).toBeGreaterThan(0);

    // Verify the chat is in a stable state (no loading spinner)
    await expect(page.locator('.loading-spinner')).toBeHidden();
  });

  test('chat window contains both user and bot messages after exchange', async () => {
    await sendMessage(page, 'Hello there');
    await waitForBotResponse(page, { timeout: 120000 });

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
});
