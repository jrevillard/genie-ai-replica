const { test, expect } = require('@playwright/test');
const {
  loginViaUI,
  navigateToChatbot,
  sendMessage,
  getMessages,
  saveChat,
  BASE_URL,
} = require('../helpers/chatbot');
const { getSessionToken } = require('../helpers/auth');

const API_TIMEOUT_MS = 30000;

const MOCKED_ANSWER = 'Mocked answer for the history test.';

// The save path only persists conversations carrying a completed turn
// (isStorableTurn refuses an all-error chat), so every test drives a
// mocked answer stream — the same posture the conversation invariants
// suite uses. Deterministic on any stack: no LLM dependency.
async function mockAnswerStream(page) {
  const frames = [
    `data: ${JSON.stringify({ type: 'chunk', content: MOCKED_ANSWER })}`,
    '',
    `data: ${JSON.stringify({ type: 'done', queryId: 'mock-query-1' })}`,
    '',
  ].join('\n');
  await page.route('**/queries/stream**', async (route) => {
    try {
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: frames });
    } catch {
      /* the context closed before the fulfillment */
    }
  });
}

// The turn's arrival signal is the rendered bot bubble — but that bubble
// mounts as a streaming placeholder the moment the send handler runs, and a
// mid-stream turn carries no queryId, so the save path would silently drop
// it. The turn is complete only when the mocked answer text is on screen.
async function waitForBotTurn(page) {
  await expect(page.locator('.chat-message.bot .message-bubble').last()).toContainText(MOCKED_ANSWER, {
    timeout: 30000,
  });
}

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
    await mockAnswerStream(page);
  });

  test.afterEach(async () => {
    await context?.close();
  });

  // Direct access grants are disabled on the realm by design, so the
  // cleanup session logs in through the browser like the tests do and
  // reuses that session's token for the API deletes.
  test.afterAll(async ({ browser }) => {
    if (createdConversationIds.length === 0) return;

    const cleanupContext = await browser.newContext({
      ignoreHTTPSErrors: true,
      bypassCSP: true,
    });
    const cleanupPage = await cleanupContext.newPage();
    try {
      await loginViaUI(cleanupPage);
      const token = await getSessionToken(cleanupPage);

      const { request } = require('../helpers/auth');
      for (const convId of createdConversationIds) {
        try {
          await request('DELETE', `${BASE_URL}/api/chat/conversations/${convId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
        } catch (err) {
          console.error(`cleanup: failed to delete conversation ${convId}: ${err.message}`);
        }
      }
    } finally {
      await cleanupContext.close();
    }
  });

  test('saves a conversation and restores it after page reload', async () => {
    const userText = 'Tell me about healthcare services';
    const chatTitle = `E2E Test Chat ${Date.now()}`;

    // Send a message and wait for the mocked answer to render
    await sendMessage(page, userText);
    await waitForBotTurn(page);

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

    // Verify via the chat history API, with the token the page session holds
    const token = await getSessionToken(page);
    const conversationsResponse = await page.evaluate(async (args) => {
      const res = await fetch(`${args.baseUrl}/api/chat/conversations`, {
        headers: { Authorization: `Bearer ${args.token}` },
        signal: AbortSignal.timeout(args.timeout),
      });
      return { status: res.status, body: await res.text() };
    }, { baseUrl: BASE_URL, token, timeout: API_TIMEOUT_MS });

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
    const token = await getSessionToken(page);

    const response = await page.evaluate(async (args) => {
      const res = await fetch(`${args.baseUrl}/api/chat/conversations`, {
        headers: { Authorization: `Bearer ${args.token}` },
        signal: AbortSignal.timeout(args.timeout),
      });
      return { status: res.status, body: await res.text() };
    }, { baseUrl: BASE_URL, token, timeout: API_TIMEOUT_MS });

    expect(response.status).toBe(200);

    const body = JSON.parse(response.body);
    const conversations = body.conversations || body;
    expect(Array.isArray(conversations)).toBeTruthy();
  });

  test('messages are restored in correct order when loading a saved conversation', async () => {
    const userText = 'What education programs exist?';
    const chatTitle = `E2E Order Test ${Date.now()}`;

    // Send a message and wait for the mocked answer to render
    await sendMessage(page, userText);
    await waitForBotTurn(page);

    // Capture message order before save
    const messagesBefore = await getMessages(page);
    const sendersBefore = messagesBefore.map((m) => m.sender);

    // Save the conversation
    await saveChat(page, chatTitle);
    await expect(page.locator('#chatTitle')).toBeHidden({ timeout: 10000 });

    // Get the saved conversation via API, with the page session's token
    const token = await getSessionToken(page);
    const convResponse = await page.evaluate(async (args) => {
      const res = await fetch(`${args.baseUrl}/api/chat/conversations`, {
        headers: { Authorization: `Bearer ${args.token}` },
        signal: AbortSignal.timeout(args.timeout),
      });
      return await res.json();
    }, { baseUrl: BASE_URL, token, timeout: API_TIMEOUT_MS });

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
          signal: AbortSignal.timeout(args.timeout),
        },
      );
      return await res.json();
    }, { baseUrl: BASE_URL, token, convId: savedConv._key || savedConv.id, timeout: API_TIMEOUT_MS });

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
