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
const {
  getSessionToken,
  getSessionTokenViaUI,
  mapWithConcurrency,
  request,
  SESSION_MINT_TIMEOUT_MS,
  SWEEP_DELETE_CONCURRENCY,
} = require('../helpers/auth');

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
    // The cleanup's mint + list + delete sweep outlives the 60s hook default.
    // The budget covers it: the mint (≈135s on a stalled stack) plus the list
    // plus the bounded-parallel delete waves, and the token the sweep holds
    // outlives it too — the realm issues it for 300s.
    test.setTimeout(SESSION_MINT_TIMEOUT_MS);

    // A failing cleanup FAILS: a conversation left behind poisons later
    // runs (the suite's own titles match the next run's sweep), so any
    // leftover is thrown, never warned away.
    const token = await getSessionTokenViaUI({ browser }).catch((e) => {
      throw new Error(`cleanup login failed — the suite's conversations were not swept: ${e.message}`);
    });

    let targets;
    let listFailure = null;
    // searchTerm narrows the list to the suite's own titles (the route's
    // default page is 20 — old leftovers would rotate off it unfiltered).
    const listRes = await request('GET', `${BASE_URL}/api/chat/conversations?searchTerm=E2E&limit=50`, {
      headers: { Authorization: `Bearer ${token}` }
    }).catch((e) => {
      listFailure = e.message;
      return null;
    });
    if (listRes && listRes.status === 200) {
      const list = listRes.data.conversations || listRes.data;
      const listed = Array.isArray(list) ? list : [];
      const total = listRes.data?.pagination?.total;
      // The list is ONE page. When the page is not the whole population,
      // the sweep cannot enumerate every conversation it must remove: it
      // deletes the ones it CAN see and REPORTS the ones it cannot.
      // Refusing to delete anything would leave the suite's conversations
      // behind for good — the next run would meet the same full page.
      if (total !== undefined ? total > listed.length : listed.length >= 50) {
        listFailure =
          `the conversation list is one page of ${total !== undefined ? total : listed.length} — ` +
          'the sweep cannot enumerate every conversation it must remove';
      }
      targets = listed.filter((c) => c.title?.startsWith('E2E ')).map((c) => c._key || c.id);
    } else {
      listFailure = listFailure || `list returned ${listRes ? listRes.status : 'no response'}`;
      // Fall back to the ids captured in-flight so the deletes still run,
      // but the unenumerated leftovers still fail the cleanup below.
      targets = [...createdConversationIds];
    }

    // The deletes run in bounded-parallel waves: each one is capped at the
    // 30 s request timeout, so a sequential sweep of a full page costs
    // 50 × 30 s — more than the hook's budget and more than the realm's
    // access-token lifespan, and the tail of it would run on an expired
    // token. The wave width is bounded by SWEEP_DELETE_CONCURRENCY so the
    // sweep still fits both, and so a fan-out does not pile up on the
    // data tier's one-writer-per-collection rule (the conversation delete
    // opens a write transaction over six collections).
    const undeleted = (
      await mapWithConcurrency(targets, SWEEP_DELETE_CONCURRENCY, async (convId) => {
        try {
          const res = await request('DELETE', `${BASE_URL}/api/chat/conversations/${convId}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (res.status < 200 || res.status >= 300) {
            return { id: convId, cause: `DELETE returned ${res.status}` };
          }
          return null;
        } catch (err) {
          return { id: convId, cause: err.message };
        }
      })
    ).filter(Boolean);
    if (listFailure) {
      throw new Error(
        `cleanup could not enumerate leftover conversations (${listFailure}) — ` +
          `${targets.length} enumerated conversations were deleted, but any conversation saved by a ` +
          `failed test and missed by the bookkeeping stays behind`
      );
    }
    if (undeleted.length > 0) {
      throw new Error(
        `cleanup deleted ${targets.length - undeleted.length} of ${targets.length} conversations — ` +
          `leftover: ${undeleted.map((u) => `${u.id} (${u.cause})`).join(', ')}`
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
