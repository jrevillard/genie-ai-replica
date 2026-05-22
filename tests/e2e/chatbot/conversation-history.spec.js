const { test, expect } = require('@playwright/test');
const {
  loginViaUI,
  navigateToChatbot,
  sendMessage,
  waitForBotResponse,
  getMessages,
  saveChat,
} = require('../helpers/chatbot');
const { getUserToken } = require('../helpers/auth');

const BASE_URL = 'https://localhost';
const TEST_USER = { username: 'testuser', password: 'TestPass123!' };

test.describe('Conversation history persistence', () => {
  test.beforeEach(async ({ browser }) => {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      bypassCSP: true,
    });
    this.page = await context.newPage();
    this.context = context;

    await loginViaUI(this.page);
    await navigateToChatbot(this.page);
  });

  test.afterEach(async () => {
    await this.context.close();
  });

  test('saves a conversation and restores it after page reload', async () => {
    const page = this.page;
    const userText = 'Tell me about healthcare services';
    const chatTitle = `E2E Test Chat ${Date.now()}`;

    // Send a message and wait for response
    await sendMessage(page, userText);
    await waitForBotResponse(page, { timeout: 120000 });

    // Capture messages before save
    const messagesBefore = await getMessages(page);
    expect(messagesBefore.length).toBeGreaterThanOrEqual(2);

    // Save the conversation
    await saveChat(page, chatTitle);

    // Wait for save to complete (dialog closes)
    await expect(page.locator('#chatTitle')).toBeHidden({ timeout: 10000 });

    // Reload the page
    await page.reload({ waitUntil: 'networkidle', timeout: 30000 });

    // Navigate to chatbot to load saved chats
    await navigateToChatbot(page);

    // The saved conversation should be accessible via the sidebar/history
    // Verify by checking the chat history API directly
    const token = await getUserToken(TEST_USER.username, TEST_USER.password);
    const conversationsResponse = await page.evaluate(async (args) => {
      const res = await fetch(`${args.baseUrl}/api/chat/conversations`, {
        headers: { Authorization: `Bearer ${args.token}` },
      });
      return { status: res.status, data: await res.json() };
    }, { baseUrl: BASE_URL, token });

    expect(conversationsResponse.status).toBe(200);
    const conversations = conversationsResponse.data;
    expect(Array.isArray(conversations)).toBeTruthy();

    // Find our saved conversation
    const saved = conversations.find(
      (c) => c.title === chatTitle || c.title?.includes(chatTitle),
    );
    expect(saved).toBeTruthy();
  });

  test('list conversations endpoint returns conversations for authenticated user', async () => {
    const token = await getUserToken(TEST_USER.username, TEST_USER.password);
    const page = this.page;

    const response = await page.evaluate(async (args) => {
      const res = await fetch(`${args.baseUrl}/api/chat/conversations`, {
        headers: { Authorization: `Bearer ${args.token}` },
      });
      return { status: res.status, body: await res.text() };
    }, { baseUrl: BASE_URL, token });

    expect(response.status).toBe(200);

    const body = JSON.parse(response.body);
    expect(Array.isArray(body)).toBeTruthy();
  });

  test('messages are restored in correct order when loading a saved conversation', async () => {
    const page = this.page;
    const userText = 'What education programs exist?';
    const chatTitle = `E2E Order Test ${Date.now()}`;

    // Send a message and wait for response
    await sendMessage(page, userText);
    await waitForBotResponse(page, { timeout: 120000 });

    // Capture message order before save
    const messagesBefore = await getMessages(page);
    const sendersBefore = messagesBefore.map((m) => m.sender);

    // Save the conversation
    await saveChat(page, chatTitle);
    await expect(page.locator('#chatTitle')).toBeHidden({ timeout: 10000 });

    // Get the saved conversation via API
    const token = await getUserToken(TEST_USER.username, TEST_USER.password);
    const convResponse = await page.evaluate(async (args) => {
      const res = await fetch(`${args.baseUrl}/api/chat/conversations`, {
        headers: { Authorization: `Bearer ${args.token}` },
      });
      return await res.json();
    }, { baseUrl: BASE_URL, token });

    const savedConv = convResponse.find(
      (c) => c.title === chatTitle || c.title?.includes(chatTitle),
    );
    expect(savedConv).toBeTruthy();

    // Fetch full conversation with messages
    const fullConv = await page.evaluate(async (args) => {
      const res = await fetch(
        `${args.baseUrl}/api/chat/conversations/${args.convId}`,
        {
          headers: { Authorization: `Bearer ${args.token}` },
        },
      );
      return await res.json();
    }, { baseUrl: BASE_URL, token, convId: savedConv._key || savedConv.id });

    // Verify messages exist
    const messages = fullConv.messages || fullConv.data?.messages || [];
    expect(messages.length).toBeGreaterThanOrEqual(2);

    // Verify order: user message comes before bot message
    const firstUserIdx = messages.findIndex(
      (m) => m.role === 'user' || m.sender === 'user',
    );
    const firstBotIdx = messages.findIndex(
      (m) => m.role === 'assistant' || m.sender === 'bot',
    );
    expect(firstUserIdx).toBeLessThan(firstBotIdx);
  });
});
