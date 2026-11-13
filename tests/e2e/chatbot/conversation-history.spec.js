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
  BASE_URL
} = require('../helpers/chatbot');
const {
  getSessionToken,
  getSessionTokenViaUI,
  describeUnauthorized,
  mapWithConcurrency,
  request,
  SESSION_MINT_TIMEOUT_MS,
  SWEEP_DELETE_CONCURRENCY,
  SWEEP_MAX_DELETES,
  SWEEP_MAX_LIST_PAGES
} = require('../helpers/auth');

const API_TIMEOUT_MS = 30000;

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
      const list = listRes.data?.conversations || listRes.data;
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
    const own = pagesRead > 0
      ? conversations.filter((c) => c.title?.startsWith('E2E ')).map((c) => c._key || c.id)
      : [...createdConversationIds];
    const populationKnown = total !== undefined;
    const enumeratedAll = populationKnown ? conversations.length >= total : exhausted;

    const deleteSet = own.slice(0, SWEEP_MAX_DELETES);
    const beyondBudget = own.length - deleteSet.length;

    // The deletes run in bounded-parallel waves: a sequential sweep of a
    // full page costs 50 × 30 s — more than the hook's budget and more
    // than the realm's access-token lifespan, so the tail of it would run
    // on an expired token. The width and the arithmetic live in
    // helpers/auth.js (SWEEP_DELETE_CONCURRENCY).
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
