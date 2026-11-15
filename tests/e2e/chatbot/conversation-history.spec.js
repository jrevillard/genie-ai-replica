const { test, expect } = require('@playwright/test');
const {
  loginViaUI,
  navigateToChatbot,
  LOGIN_BUDGET_TIMEOUT_MS,
  sendMessage,
  waitForBotMessage,
  mockChatStream,
  saveChat,
  CHAT_TITLE_INPUT,
  BASE_URL,
  MESSAGE_ROW
} = require('../helpers/chatbot');
const {
  getSessionToken,
  getSessionTokenViaUI,
  describeUnauthorized,
  dedupeByIds,
  mapWithConcurrency,
  request,
  SESSION_MINT_TIMEOUT_MS,
  SWEEP_DELETE_CONCURRENCY,
  SWEEP_MAX_DELETES,
  SWEEP_MAX_LIST_PAGES
} = require('../helpers/auth');

const API_TIMEOUT_MS = 30000;

/**
 * The list endpoint's ONE wire shape, read once: { conversations: [...] }.
 * A response without the array is a changed contract, named as such —
 * reading it as empty would turn a shape change into a silent no-find.
 */
function conversationListFrom(parsedBody) {
  const conversations = parsedBody?.conversations;
  expect(Array.isArray(conversations), 'the list wire shape is { conversations: [...] }').toBe(true);
  return conversations;
}

// The page size the cleanup sweep lists the conversation population with.
// The endpoint accepts up to 100, and the sweep enumerates two pages — a
// window of 200 conversations. The delete budget is a separate cap
// (SWEEP_MAX_DELETES).
const LIST_PAGE_SIZE = 100;

const MOCKED_ANSWER = 'Mocked answer for the history test.';

test.describe('Conversation history persistence', () => {
  // Two ceilings compose: the beforeEach login (budgeted beside
  // loginViaUI) and this file's own steps — a mocked answer on a slow
  // stack, a reload and two API fetches (#1798). test.setTimeout is this
  // file's spelling; a failure stays attached to its step instead of
  // dying on the generic wall.
  test.setTimeout(LOGIN_BUDGET_TIMEOUT_MS);

  let page;
  let context;
  const createdConversationIds = [];

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext({
      ignoreHTTPSErrors: true,
      bypassCSP: true,
      // 1440 keeps the left sidebar in flow (it collapses below 1400):
      // the restore test drives the Saved Chats list there, and at the
      // default 1280 the tab it needs sits outside the viewport.
      viewport: { width: 1440, height: 900 }
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
  // suite's title prefix — and the ids captured in-flight are its FALLBACK
  // for the case where not one page of the list could be read: a test
  // that failed between its save and its bookkeeping must not leak the
  // conversation it already persisted.
  test.afterAll(async ({ browser }) => {
    // The cleanup's mint + list + delete sweep outlives the 60s hook
    // default. The budget that covers it, the wave width and the delete
    // cap are documented in helpers/auth.js.
    test.setTimeout(SESSION_MINT_TIMEOUT_MS);

    // A failing cleanup FAILS: a conversation left behind poisons later
    // runs (the suite's own titles match the next run's sweep), so any
    // leftover is thrown, never warned away.
    const token = await getSessionTokenViaUI({ browser }).catch((e) => {
      throw new Error(`cleanup login failed — the suite's conversations were not swept: ${e.message}`);
    });

    // The list is paginated, and its search matches a SUPERSET of the
    // suite's own conversations: the endpoint filters LIKE over title OR
    // lastMessage OR category, while the sweep deletes the conversations
    // whose TITLE starts with 'E2E '. One page is therefore not the
    // population, and the sweep cannot tell "the conversations beyond the
    // page are not mine" from "the conversations beyond the page are mine
    // and were not removed" — the second one is a leftover. Enumerate the
    // pages the budget allows.
    const conversations = [];
    let total;
    let listFailure = null;
    let exhausted = false;
    let pagesRead = 0;
    for (let offset = 0; offset < SWEEP_MAX_LIST_PAGES * LIST_PAGE_SIZE; offset += LIST_PAGE_SIZE) {
      let listRes;
      try {
        listRes = await request(
          'GET',
          `${BASE_URL}/api/chat/conversations?searchTerm=E2E&limit=${LIST_PAGE_SIZE}&offset=${offset}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
      } catch (e) {
        listFailure = `offset ${offset} failed: ${e.message}`;
        break;
      }
      if (listRes.status !== 200) {
        listFailure = `offset ${offset} returned HTTP ${listRes.status}`;
        break;
      }
      // ONE wire shape — the one this file's tests assert (the restored
      // list reads parsed.conversations and requires the array): { conversations: [...] }.
      const list = listRes.data?.conversations;
      if (!Array.isArray(list)) {
        // A response without the array is a changed contract, not an
        // empty population: reading it as empty would end the sweep with
        // a green report and the suite's conversations still in place.
        listFailure = `offset ${offset} carried no conversation array (the response shape changed)`;
        break;
      }
      conversations.push(...list);
      pagesRead++;
      // The population is the same on every page: keep the first count
      // that arrives, so a page without a pagination object does not
      // erase what the previous page established.
      if (total === undefined) {
        total = listRes.data?.pagination?.total;
      }
      if (list.length < LIST_PAGE_SIZE) {
        exhausted = true;
        break;
      }
    }

    // Two populations, and the report must not conflate them: the
    // POPULATION is every conversation the endpoint matched (the LIKE
    // set), the suite's OWN is the E2E-titled ones inside it — only
    // those are the sweep's to remove.
    //
    // The ids captured in-flight are the fallback when NOT ONE page
    // could be read: the deletes still run, and the failure is reported
    // below. A later page that fails must NOT discard the pages that
    // succeeded — those conversations are known, and leaving them behind
    // is the leftover this sweep exists to prevent.
    //
    // The delete set holds each conversation ONCE: dedupeByIds drops the
    // rows pagination drift listed twice (why: dedupeByIds in
    // helpers/auth.js, #1864/#1893).
    const own =
      pagesRead > 0
        ? dedupeByIds(
            conversations.filter((c) => c.title?.startsWith('E2E ')),
            (c) => c._key || c.id
          ).map((c) => c._key || c.id)
        : [...createdConversationIds];
    const populationKnown = total !== undefined;
    const enumeratedAll = populationKnown ? conversations.length >= total : exhausted;

    const deleteSet = own.slice(0, SWEEP_MAX_DELETES);
    const beyondBudget = own.length - deleteSet.length;

    // The deletes run in bounded-parallel waves: a sequential delete phase
    // costs up to SWEEP_MAX_DELETES × API_TIMEOUT_MS — more than the
    // hook's budget and more than the realm's access-token lifespan, so
    // the tail of it would run on an expired token. The width and the
    // budget arithmetic live in helpers/auth.js (SWEEP_DELETE_CONCURRENCY,
    // SWEEP_MAX_DELETES).
    const undeleted = (
      await mapWithConcurrency(deleteSet, SWEEP_DELETE_CONCURRENCY, async (convId) => {
        try {
          const res = await request('DELETE', `${BASE_URL}/api/chat/conversations/${convId}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (res.status < 200 || res.status >= 300) {
            return {
              id: convId,
              cause:
                res.status === 401
                  ? `DELETE returned ${describeUnauthorized(res, token)}`
                  : `DELETE returned ${res.status}`
            };
          }
          return null;
        } catch (err) {
          return { id: convId, cause: err.message };
        }
      })
    ).filter(Boolean);

    // Every failure condition is reported: the first throw used to hide
    // the others (the enumeration failure hid the failed deletes), so a
    // run could name one leftover and pass over the rest.
    const problems = [];
    if (listFailure) {
      problems.push(`the conversation list could not be read — ${listFailure}`);
    }
    if (undeleted.length > 0) {
      problems.push(
        `${undeleted.length} of ${deleteSet.length} conversations were not deleted — leftover: ` +
          `${undeleted.map((u) => `${u.id} (${u.cause})`).join(', ')}`
      );
    }
    if (beyondBudget > 0) {
      problems.push(
        `${beyondBudget} conversations are beyond the sweep's delete budget (${SWEEP_MAX_DELETES} per ` +
          `run) — they stay behind until a later run removes them`
      );
    }
    if (!enumeratedAll) {
      // What the sweep knows depends on the branch: either the POPULATION
      // exceeds the window it enumerated, or the population's size is
      // unknown. Either way the sweep cannot account for everything it
      // may own — and it says so, rather than naming a leftover it has
      // not established.
      problems.push(
        populationKnown
          ? `the sweep did not enumerate the whole population — a suite conversation beyond the ` +
              `last enumerated page, if any, was not removed`
          : pagesRead > 0
            ? `the population size is unknown — the sweep read full pages, so a suite conversation ` +
              `beyond the last enumerated page, if any, was not removed`
            : `the population size is unknown and the sweep read NOTHING — only the conversations ` +
              `captured in flight were removed, and any other suite conversation may remain`
      );
    }
    if (problems.length > 0) {
      // The scope must not claim a subset relation between two different
      // populations: when NOT ONE page could be read, `own` holds the
      // ids the tests captured in flight — the suite's own, but not a
      // subset of what was read.
      const scope = populationKnown
        ? `population: ${total} matching conversations, ${conversations.length} read, ` +
          `${own.length} of them the suite's own`
        : pagesRead > 0
          ? `population unknown, ${conversations.length} matching conversations read, ` +
            `${own.length} of them the suite's own`
          : `population unknown, nothing read, ${own.length} of the suite's own captured in flight`;
      throw new Error(`cleanup: ${problems.length} problem(s) — ${scope} — ${problems.join(' | ')}`);
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
    await expect(page.locator(CHAT_TITLE_INPUT)).toBeHidden({ timeout: 10000 });

    // Reload the page
    await page.reload({ waitUntil: 'networkidle', timeout: 30000 });

    // Navigate to chatbot to load saved chats
    await navigateToChatbot(page);

    // The persistence WITNESS, via the chat history API with the token
    // the page session holds. The wire shape is ONE: the endpoint serves
    // { conversations: [...] } (chat-history-routes.js → getUserConversations).
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

    const conversations = conversationListFrom(JSON.parse(conversationsResponse.body));

    // Find our saved conversation
    const saved = conversations.find((c) => c.title === chatTitle || c.title?.includes(chatTitle));
    expect(saved).toBeTruthy();

    if (saved?._key || saved?.id) {
      createdConversationIds.push(saved._key || saved.id);
    }

    // The RESTORATION the title claims, through the UI: the saved chat
    // appears in the left sidebar's Saved Chats list, and OPENING it from
    // there renders the persisted turns. The session rehydration would
    // otherwise make the row click a no-op — the reloaded page still
    // holds the saved conversation as its open one, and the
    // load-conversation guard swallows a click whose id is already open —
    // so the saved chat is closed FIRST (a just-saved conversation is
    // clean: the close runs without a prompt) and the click below opens
    // it from the list for real, through loadExistingConversation.
    await page.locator('[data-testid="conversation-header-close"]').click();
    await expect(page.locator('[data-testid="quick-help-overlay"]')).toBeVisible({ timeout: 15000 });

    await page.locator('[data-test-id="ds-tab-history"]').click();

    const row = page.locator('[data-testid="chat-history-item"]').filter({ hasText: chatTitle });
    await expect(row, 'the saved chat is listed after the reload').toBeVisible({ timeout: 15000 });
    await row.click();

    // The sidebar-open path renders EXACTLY the persisted turns: the
    // welcome turn is skipped by the save (a bot turn without a queryId
    // is not storable) and prepended only for a conversation with zero
    // persisted messages, so two rows — the user's question verbatim,
    // then the mocked answer. Nothing more.
    const rows = page.locator(MESSAGE_ROW);
    await expect(rows, 'the restored transcript').toHaveCount(2, { timeout: 15000 });
    await expect(page.locator('[data-testid="quick-help-overlay"]')).toHaveCount(0);
    expect(await rows.nth(0).getAttribute('data-testid'), 'the first row is the restored user turn').toBe(
      'chat-message-user'
    );
    await expect(
      rows.nth(0).locator('[data-testid="message-bubble-user"]'),
      'the user turn is restored verbatim'
    ).toHaveText(userText);
    await expect(rows.nth(1).locator('[data-testid="message-bubble-bot"]')).toContainText(MOCKED_ANSWER);
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

    expect(conversationListFrom(JSON.parse(response.body)).length).toBeGreaterThanOrEqual(0);
  });

  test('messages are restored in correct order when loading a saved conversation', async () => {
    const userText = 'What education programs exist?';
    const chatTitle = `E2E Order Test ${Date.now()}`;

    // Send a message and wait for the mocked answer to render
    await sendMessage(page, userText);
    await waitForBotMessage(page, MOCKED_ANSWER);

    // Save the conversation
    await saveChat(page, chatTitle);
    await expect(page.locator(CHAT_TITLE_INPUT)).toBeHidden({ timeout: 10000 });

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

    const conversations = conversationListFrom(convResponse);
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

    // Verify messages exist. The wire shape is ONE: the detail endpoint
    // serves { messages: [...] }, and each message carries `sender`
    // ('user' | 'assistant' — the save path's vocabulary, component
    // saveChat; there is no `role` field on a message document).
    const messages = fullConv.messages;
    expect(Array.isArray(messages), 'the detail wire shape is { messages: [...] }').toBe(true);

    // Verify order: the turn was complete on screen before the save (the
    // mocked answer text was asserted), so both sides must have persisted —
    // a one-sided save is exactly the defect this spec exists to catch.
    expect(messages.length, 'both turns persisted').toBeGreaterThanOrEqual(2);
    const firstUserIdx = messages.findIndex((m) => m.sender === 'user');
    const firstBotIdx = messages.findIndex((m) => m.sender === 'assistant');
    expect(firstUserIdx, 'the user turn persisted').toBeGreaterThanOrEqual(0);
    expect(firstBotIdx, 'the assistant turn persisted').toBeGreaterThanOrEqual(0);
    expect(firstUserIdx).toBeLessThan(firstBotIdx);
  });
});
