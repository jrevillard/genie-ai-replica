const { test, expect } = require('@playwright/test');
const {
  loginViaUI,
  navigateToChatbot,
  sendMessage,
  waitForBotMessage,
  mockChatStream,
  saveChat,
  BASE_URL
} = require('../helpers/chatbot');
const { getSessionToken, getSessionTokenViaUI, request, SESSION_MINT_TIMEOUT_MS } = require('../helpers/auth');

const API_TIMEOUT_MS = 30000;

const MOCKED_ANSWER = 'Mocked answer for the history test.';

test.describe('Conversation history persistence', () => {
  // The steps compose: a mocked answer on a slow stack, a reload and two
  // API fetches each carry their own budgets — well past the 60 s default
  // if several run long. The suite's own timeout keeps a failure attached
  // to its step instead of dying on the generic 60 s wall.
  test.setTimeout(120000);

  let page;
  let context;
  const createdConversationIds = [];

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext({
      ignoreHTTPSErrors: true,
      bypassCSP: true
    });
    page = await context.newPage();

    await loginViaUI(page);
    await navigateToChatbot(page);
    // The save path only persists conversations carrying a completed turn
    // (isStorableTurn refuses an all-error chat), so every test drives a
    // mocked answer stream — the same posture the conversation invariants
    // suite uses. Deterministic on any stack: no LLM dependency.
    await mockChatStream(page, [MOCKED_ANSWER]);
  });

  test.afterEach(async () => {
    await context?.close();
  });

  // Direct access grants are disabled on the realm by design, so the
  // cleanup session logs in through the browser like the tests do and
  // reuses that session's token for the API deletes. The sweep is by the
  // suite's title prefix, not just the ids captured in-flight — a test
  // that failed between its save and its bookkeeping must not leak the
  // conversation it already persisted.
  test.afterAll(async ({ browser }) => {
    // Cleanup chains a browser session mint plus a list and a delete sweep
    // on a stalled stack — past the 60s project timeout the hook otherwise
    // runs under.
    test.setTimeout(SESSION_MINT_TIMEOUT_MS);

    const token = await getSessionTokenViaUI({ browser }).catch((e) => {
      console.warn('cleanup: cleanup login failed — skipping conversation cleanup:', e.message);
      return null;
    });
    if (!token) return;

    let targets = [];
    // searchTerm narrows the list to the suite's own titles (the route's
    // default page is 20 — old leftovers would rotate off it unfiltered).
    const listRes = await request('GET', `${BASE_URL}/api/chat/conversations?searchTerm=E2E&limit=50`, {
      headers: { Authorization: `Bearer ${token}` }
    }).catch((e) => {
      console.error(`cleanup: conversation list failed: ${e.message}`);
      return null;
    });
    if (listRes && listRes.status === 200) {
      const list = listRes.data.conversations || listRes.data;
      targets = (Array.isArray(list) ? list : []).filter((c) => c.title?.startsWith('E2E ')).map((c) => c._key || c.id);
    } else {
      targets = [...createdConversationIds];
    }

    let failed = 0;
    for (const convId of targets) {
      try {
        const res = await request('DELETE', `${BASE_URL}/api/chat/conversations/${convId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.status < 200 || res.status >= 300) {
          failed++;
          console.error(`cleanup: delete of conversation ${convId} returned ${res.status}`);
        }
      } catch (err) {
        failed++;
        console.error(`cleanup: failed to delete conversation ${convId}: ${err.message}`);
      }
    }
    if (failed > 0) {
      console.warn(
        `cleanup: deleted ${targets.length - failed} of ${targets.length} conversations — leftovers will accumulate`
      );
    }
  });

  test('saves a conversation and restores it after page reload', async () => {
    const userText = 'Tell me about healthcare services';
    const chatTitle = `E2E Test Chat ${Date.now()}`;

    // Send a message and wait for the mocked answer to render
    await sendMessage(page, userText);
    await waitForBotMessage(page, MOCKED_ANSWER);

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
    const conversationsResponse = await page.evaluate(
      async (args) => {
        const res = await fetch(`${args.baseUrl}/api/chat/conversations`, {
          headers: { Authorization: `Bearer ${args.token}` },
          signal: AbortSignal.timeout(args.timeout)
        });
        return { status: res.status, body: await res.text() };
      },
      { baseUrl: BASE_URL, token, timeout: API_TIMEOUT_MS }
    );

    expect(conversationsResponse.status).toBe(200);

    const parsed = JSON.parse(conversationsResponse.body);
    const conversations = parsed.conversations || parsed;
    expect(Array.isArray(conversations)).toBeTruthy();

    // Find our saved conversation
    const saved = conversations.find((c) => c.title === chatTitle || c.title?.includes(chatTitle));
    expect(saved).toBeTruthy();

    if (saved?._key || saved?.id) {
      createdConversationIds.push(saved._key || saved.id);
    }
  });

  test('list conversations endpoint returns conversations for authenticated user', async () => {
    const token = await getSessionToken(page);

    const response = await page.evaluate(
      async (args) => {
        const res = await fetch(`${args.baseUrl}/api/chat/conversations`, {
          headers: { Authorization: `Bearer ${args.token}` },
          signal: AbortSignal.timeout(args.timeout)
        });
        return { status: res.status, body: await res.text() };
      },
      { baseUrl: BASE_URL, token, timeout: API_TIMEOUT_MS }
    );

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
    await waitForBotMessage(page, MOCKED_ANSWER);

    // Save the conversation
    await saveChat(page, chatTitle);
    await expect(page.locator('#chatTitle')).toBeHidden({ timeout: 10000 });

    // Get the saved conversation via API, with the page session's token
    const token = await getSessionToken(page);
    const convResponse = await page.evaluate(
      async (args) => {
        const res = await fetch(`${args.baseUrl}/api/chat/conversations`, {
          headers: { Authorization: `Bearer ${args.token}` },
          signal: AbortSignal.timeout(args.timeout)
        });
        return await res.json();
      },
      { baseUrl: BASE_URL, token, timeout: API_TIMEOUT_MS }
    );

    const conversations = convResponse.conversations || convResponse;
    const savedConv = conversations.find((c) => c.title === chatTitle || c.title?.includes(chatTitle));
    expect(savedConv).toBeTruthy();

    if (savedConv?._key || savedConv?.id) {
      createdConversationIds.push(savedConv._key || savedConv.id);
    }

    // Fetch full conversation with messages
    const fullConv = await page.evaluate(
      async (args) => {
        const res = await fetch(`${args.baseUrl}/api/chat/conversations/${args.convId}`, {
          headers: { Authorization: `Bearer ${args.token}` },
          signal: AbortSignal.timeout(args.timeout)
        });
        return await res.json();
      },
      { baseUrl: BASE_URL, token, convId: savedConv._key || savedConv.id, timeout: API_TIMEOUT_MS }
    );

    // Verify messages exist
    const messages = fullConv.messages || fullConv.data?.messages || [];
    expect(messages.length).toBeGreaterThanOrEqual(1);

    // Verify order: the turn was complete on screen before the save (the
    // mocked answer text was asserted), so both sides must have persisted —
    // a one-sided save is exactly the defect this spec exists to catch.
    expect(messages.length, 'both turns persisted').toBeGreaterThanOrEqual(2);
    const firstUserIdx = messages.findIndex((m) => m.role === 'user' || m.sender === 'user');
    const firstBotIdx = messages.findIndex(
      (m) => m.role === 'assistant' || m.sender === 'assistant' || m.sender === 'bot'
    );
    expect(firstUserIdx, 'the user turn persisted').toBeGreaterThanOrEqual(0);
    // The API persists the assistant turn with sender 'assistant'; the UI
    // spells the same side 'bot' — match both.
    expect(firstBotIdx, 'the bot turn persisted').toBeGreaterThanOrEqual(0);
    expect(firstUserIdx).toBeLessThan(firstBotIdx);
  });
});
