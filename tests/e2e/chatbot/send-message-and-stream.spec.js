const { test, expect } = require('@playwright/test');
const {
  loginViaUI,
  navigateToChatbot,
  sendMessage,
  waitForBotResponse,
  getMessages,
  getLastBotMessage,
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

    // Verify the chat is in a stable state (no loading spinner) after done event
    await expect(page.locator('.loading-spinner')).toBeHidden();

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
    // The poll holds until the text observed first has grown — a bubble
    // that only ever renders its full text in one frame fails the poll.
    const botBubble = page.locator('.chat-message.bot .message-bubble').last();
    let firstLength = null;
    await expect
      .poll(
        async () => {
          const text = (await botBubble.innerText()).trim();
          if (firstLength === null) {
            firstLength = text.length;
          }
          return text.length;
        },
        { timeout: 30000 }
      )
      .toBeGreaterThan(firstLength);

    // Completion: the full answer is in, and the spinner is gone
    // (waitForBotResponse asserts both).
    await waitForBotResponse(page, { timeout: 120000 });
  });
});
