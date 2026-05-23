const { test, expect } = require('@playwright/test');
const {
  loginViaUI,
  navigateToChatbot,
  sendMessage,
  waitForBotResponse,
  getMessages,
  saveChat,
  BASE_URL,
  TEST_USER,
} = require('../helpers/chatbot');
const { getUserToken } = require('../helpers/auth');

test.describe('Conversation history persistence', () => {
  let page;
  let context;
  const createdConversationIds = [];

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

  test.afterAll(async () => {
    // Clean up test conversations to prevent database bloat
    const token = await getUserToken(TEST_USER.username, TEST_USER.password).catch(() => null);
    if (!token) return;

    const { request } = require('../helpers/auth');
    for (const convId of createdConversationIds) {
      await request('DELETE', `${BASE_URL}/api/chat/conversations/${convId}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
  });

  test('saves a conversation and restores it after page reload', async () => {
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

    // Verify via the chat history API
    const token = await getUserToken(TEST_USER.username, TEST_USER.password);
    const conversationsResponse = await page.evaluate(async (args) => {
      const res = await fetch(`${args.baseUrl}/api/chat/conversations`, {
        headers: { Authorization: `Bearer ${args.token}` },
        signal: AbortSignal.timeout(15000),
      });
      return { status: res.status, body: await res.text() };
    }, { baseUrl: BASE_URL, token });

    expect(conversationsResponse.status).toBe(200);

    const parsed = JSON.parse(conversationsResponse.body);
    const conversations = parsed.conversations || parsed;
    expect(Array.isArray(conversations)).toBeTruthy();

    // Find our saved conversation
    const saved = conversations.find(
      (c) => c.title === chatTitle || c.title?.includes(chatTitle),
    );
    expect(saved).toBeTruthy();

    if (saved?._key || saved?.id) {
      createdConversationIds.push(saved._key || saved.id);
    }
  });

  test('list conversations endpoint returns conversations for authenticated user', async () => {
    const token = await getUserToken(TEST_USER.username, TEST_USER.password);

    const response = await page.evaluate(async (args) => {
      const res = await fetch(`${args.baseUrl}/api/chat/conversations`, {
        headers: { Authorization: `Bearer ${args.token}` },
        signal: AbortSignal.timeout(15000),
      });
      return { status: res.status, body: await res.text() };
    }, { baseUrl: BASE_URL, token });

    expect(response.status).toBe(200);

    const body = JSON.parse(response.body);
    const conversations = body.conversations || body;
    expect(Array.isArray(conversations)).toBeTruthy();
  });

  test('messages are restored in correct order when loading a saved conversation', async () => {
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
        signal: AbortSignal.timeout(15000),
      });
      return await res.json();
    }, { baseUrl: BASE_URL, token });

    const conversations = convResponse.conversations || convResponse;
    const savedConv = conversations.find(
      (c) => c.title === chatTitle || c.title?.includes(chatTitle),
    );
    expect(savedConv).toBeTruthy();

    if (savedConv?._key || savedConv?.id) {
      createdConversationIds.push(savedConv._key || savedConv.id);
    }

    // Fetch full conversation with messages
    const fullConv = await page.evaluate(async (args) => {
      const res = await fetch(
        `${args.baseUrl}/api/chat/conversations/${args.convId}`,
        {
          headers: { Authorization: `Bearer ${args.token}` },
          signal: AbortSignal.timeout(15000),
        },
      );
      return await res.json();
    }, { baseUrl: BASE_URL, token, convId: savedConv._key || savedConv.id });

    // Verify messages exist
    const messages = fullConv.messages || fullConv.data?.messages || [];
    expect(messages.length).toBeGreaterThanOrEqual(1);

    // Verify order: user message comes before bot message (when both exist)
    const firstUserIdx = messages.findIndex(
      (m) => m.role === 'user' || m.sender === 'user',
    );
    const firstBotIdx = messages.findIndex(
      (m) => m.role === 'assistant' || m.sender === 'bot',
    );
    if (firstUserIdx !== -1 && firstBotIdx !== -1) {
      expect(firstUserIdx).toBeLessThan(firstBotIdx);
    }
  });
});
