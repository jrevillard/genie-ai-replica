const { expect } = require('@playwright/test');
// The venue fixtures (and the credential accessors over them) live in
// helpers/e2e-fixtures.js — the same definitions the provisioning script
// (tests/e2e/provision-e2e-fixtures.js) creates, so a credential is
// written once. Re-exported here for the specs that import credentials
// alongside the login helpers.
const {
  TEST_USER,
  TEST_ADMIN_USER,
  TEST_PLAIN_USER,
} = require('./e2e-fixtures');
const { runPostOnlyRouteHandler } = require('./route');
// The venue's edge lives in its own module (helpers/base-url.js): a spec
// that needs the edge but no credential requires it from there, so the
// two credential import paths are never mixed in one file.
const { BASE_URL } = require('./base-url');

// The handles the chat surface declares. A row's handle carries its
// sender (`chat-message-bot` / `chat-message-user`), so a spec never
// reads the row's class to know who spoke. Exported: a spec that
// addresses the same elements reuses these strings instead of
// re-typing them.
const MESSAGE_ROW = '[data-testid^="chat-message-"]';
const BOT_BUBBLE = '[data-testid="chat-message-bot"] [data-testid="message-bubble-bot"]';
const NAV_STATUS = '[data-testid="nav-status"]';
const CHAT_TITLE_INPUT = '[data-testid="chat-title"]';

// The stream interception contract lives in its own module
// (helpers/stream-route.js): the endpoint, the interception glob and the
// SSE envelope — no credential in it, so a spec that intercepts the
// stream and needs nothing else never imports the credential module.
// Re-exported here for the specs that already import the login helpers.
const { CORS_HEADERS, STREAM_PATH, STREAM_ROUTE, sseBody, sseFulfill } = require('./stream-route');

// The wait from the submit click to the dashboard: the identity provider
// deciding to issue a code, then the app exchanging it. On an idle stack the
// whole handshake takes about a second (median 974 ms, max 1085 ms over 10
// sessions), so this budget is not sized for the happy path — it is sized for
// a stack that stalls or rejects, and the retry is what recovers from that.
const AUTH_BUDGET_MS = 30000;

// The retry catches a partially recovered stack: a token exchange that
// completed just after the first wait expired, or a slow identity
// provider that recovered mid-attempt. The retry budget is therefore
// shorter than the first (15 s vs 30 s) — the per-test ceiling that
// constrains the total is playwright.config.js's timeout, and a helper
// that cannot report why it failed is no better than one that failed.
const AUTH_RETRY_BUDGET_MS = 15000;

// The per-test ceiling a spec that logs in through the browser needs:
// loginViaUI's two attempts cost up to ≈135 s on a stalled stack
// (attempt 1: 30 s navigation + 15 s redirect + 30 s dashboard wait;
// attempt 2: 30 + 15 + 15), and navigateToChatbot adds 30 s — past the
// project's 60 s default, where the test dies BEFORE this helper can
// print its own two-attempt diagnosis (#1798). 300 s covers the
// worst-case hook with the test body's own budget still ahead of it.
// Apply with test.describe.configure({ timeout: LOGIN_BUDGET_TIMEOUT_MS })
// in the describes that log in (or test.setTimeout at describe scope,
// the conversation-history spelling). ONE owner of the derivation: when
// the login's arithmetic changes, this constant moves with it.
const LOGIN_BUDGET_TIMEOUT_MS = 300000;

/**
 * Authenticate via page-level login (Keycloak redirect flow).
 *
 * Retries once, because a slow identity provider under load must not fail a
 * test that has nothing to do with authentication. A genuine failure — bad
 * credentials, wrong realm — fails both passes, and the error names both.
 */
async function loginViaUI(page, user = TEST_USER) {
  let firstError;
  try {
    await loginAttempt(page, user, AUTH_BUDGET_MS);
    return;
  } catch (error) {
    firstError = error;
  }

  let secondError;
  try {
    await loginAttempt(page, user, AUTH_RETRY_BUDGET_MS);
    return;
  } catch (error) {
    secondError = error;
  }

  throw new Error(
    `loginViaUI failed on both attempts.\n` +
      `  attempt 1 (budget ${AUTH_BUDGET_MS}ms): ${firstError.message}\n` +
      `  attempt 2 (budget ${AUTH_RETRY_BUDGET_MS}ms): ${secondError.message}`
  );
}

/**
 * One pass of the Keycloak redirect flow.
 */
async function loginAttempt(page, user, budgetMs) {
  await page.goto(`${BASE_URL}/`, {
    waitUntil: 'networkidle',
    timeout: 30000
  });

  // A previous attempt's token exchange can complete just after its wait
  // expired — that is precisely the failure this helper retries. The session
  // is then already established and there is nothing left to log in to.
  if (page.url().includes('dashboard')) return;

  await page.waitForURL('**/protocol/openid-connect/auth**', {
    timeout: 15000
  });

  await page.fill('#username', user.username);
  await page.fill('#password', user.password);
  await page.click('#kc-login');

  await page.waitForURL(
    (url) => {
      const urlStr = url.toString();
      return urlStr.includes('dashboard') || urlStr === `${BASE_URL}/`;
    },
    { timeout: budgetMs }
  );

  const finalUrl = page.url();
  // Dashboard only — deliberately stricter than the waitForURL predicate:
  // the bare origin is also where CallbackView lands when the code
  // exchange fails (router.replace('/')), so accepting it here would
  // report a failed exchange as success and skip the retry that recovers
  // a transient one by re-entering Keycloak with the session cookie.
  expect(finalUrl.includes('dashboard'), `Expected URL to contain 'dashboard', got: ${finalUrl}`).toBeTruthy();
}

/**
 * Navigate to the chatbot view from the dashboard.
 */
async function navigateToChatbot(page) {
  await page.goto(`${BASE_URL}/chat`, {
    waitUntil: 'networkidle',
    timeout: 30000
  });
}

/**
 * Send a message via the chatbot input.
 */
async function sendMessage(page, message) {
  const textarea = page.locator('[data-testid="composer-field"]');
  await expect(textarea).toBeVisible({ timeout: 10000 });
  await textarea.fill(message);
  await textarea.press('Enter');
}

/**
 * Wait for a bot response to complete in the chat window.
 *
 * The completion signal is two-fold, because neither half is enough:
 *
 * 1. The last bot bubble carries content. The send handler mounts it as
 *    an empty placeholder, and the streamed answer fills it — so content
 *    means the turn has started, not that it has ended.
 *
 * 2. The turn's own streaming flag is cleared. The app marks the bot
 *    message `isStreaming` while the SSE stream is open and clears it
 *    when the stream ends; the DOM has no marker for that (the
 *    `streaming-indicator` element exists only while the answer is
 *    still EMPTY), so the flag is read from the store the component
 *    renders from.
 */
async function waitForBotResponse(page, options = {}) {
  const timeout = options.timeout || 60000;

  await expect(page.locator(BOT_BUBBLE).last()).toContainText(/\S/, { timeout });

  await expect.poll(() => botStreamingFlag(page), { timeout }).toBe(false);
}

/**
 * The turn's streaming flag, read from the page.
 *
 * The WIRING between the wait and the page-side read is what #1738 was
 * about: the read used to ask the store for a path the frontend no
 * longer exposes. It is a function of its own so that a spec can drive
 * it — the wait is the only thing that used it, and nothing could test
 * it there.
 *
 * @param {object} page - the Playwright page
 * @returns {Promise<boolean|null>} the flag: true while the turn streams,
 *   false when it is over, null when the page is not ready to say
 */
async function botStreamingFlag(page) {
  return page.evaluate(readStreamingState).then(streamingFlagOf);
}

/**
 * The page-side read: the open conversation's messages and their
 * streaming flags, in the shape the decision needs.
 *
 * SELF-CONTAINED on purpose. Playwright sends this function to the page
 * as SOURCE, so it may not close over anything in this module — only
 * page globals. That is also what makes it TESTABLE: a spec builds a
 * fake `#app` carrying a fake store and calls this very function, so the
 * read is exercised on the same path the suite uses, not a copy of it.
 *
 * The store's PUBLIC read path: the "conversation" module's getter returns
 * the open conversation — its messages and the stream flag. The raw state
 * shape is NOT a contract: the CSR refactor moved the messages under
 * conversations[openId], and a helper reading "state.conversation.messages"
 * threw on every poll (the three chat specs went red the day it landed).
 *
 * The flag's ABSENCE crosses the wire as absence: a message with no
 * `isStreaming` key at all is the WELCOME bubble (the app commits it
 * without one), and it is NOT a turn. Coercing it to `false` here would
 * say "the turn finished" — the wait would end before the answer
 * existed, which is the defect this read exists to prevent. The value is
 * copied as it is, so "absent" and "false" stay distinct.
 */
function readStreamingState() {
  const app = document.querySelector('#app');
  const store = app && app.__vue_app__ ? app.__vue_app__.config.globalProperties.$store : null;
  const getters = store ? store.getters : null;
  // The getter's EXISTENCE and its VALUE are two different findings: a
  // store without the getter is a broken contract, while a getter that
  // returns nothing means no conversation is OPEN yet — a normal state
  // (the app may still open one), not a broken one. Reporting the
  // second as the first would name a cause the operator cannot act on.
  const hasGetter = !!(getters && 'conversation/openConversation' in getters);
  const open = hasGetter ? getters['conversation/openConversation'] : null;
  // A booted app without the getter is a broken store contract, not a
  // slow answer: say so now, in the shape the reader (streamingFlagOf)
  // turns into a named failure, instead of polling to a cause-less
  // timeout.
  // NOT booted (no app, no __vue_app__) is transient — the app may still
  // be mounting, or a reload is in flight. A BOOTED app whose store is
  // gone is a broken contract, and so is a store without the getter.
  if (!app || !app.__vue_app__) return { state: 'not-booted' };
  if (!store) return { state: 'no-store' };
  if (!hasGetter) return { state: 'no-getter' };
  if (!open) return { state: 'no-open-conversation' };
  // Only what the decision needs: each message's sender and streaming
  // flag. The whole conversation would cross the wire on every poll tick
  // — and WHICH messages are the bot's is decided on this side, where it
  // is unit tested.
  const messages = open.messages
    ? open.messages.map((m) => ({ sender: m.sender, isStreaming: m.isStreaming }))
    : [];
  return { state: 'ok', messages };
}

/**
 * The streaming flag of the last bot message, from a read of the store's
 * public getter.
 *
 * Pure, and OUT of the page: the page hands over what it read, this
 * decides what it MEANS. Every case the read can report is named here,
 * because each is easy to break by accident:
 *
 * - NOT BOOTED is transient, not broken: the app may still be mounting,
 *   or a reload is in flight — the wait continues;
 * - a BOOTED app whose store is gone is a broken contract: it fails now,
 *   by name ("the app is booted but has no store");
 * - a store that does not expose the getter at all is a broken contract
 *   too: it fails now, by name, instead of polling to a cause-less
 *   timeout;
 * - a getter that EXISTS and returns nothing is a different finding — no
 *   conversation is open yet — and the wait continues;
 * - no bot message yet is NOT "not streaming" — the turn has not
 *   produced one, so the wait continues (null is not false).
 *
 * @param {{state: string, messages?: object[]}} read - what the page read
 * @returns {boolean|null} the flag, or null while the turn has no answer
 */
function streamingFlagOf(read) {
  if (read && read.state === 'not-booted') {
    // NOT booted is transient — the app may still be mounting (a reload
    // mid-wait). The wait continues.
    return null;
  }
  if (read && read.state === 'no-open-conversation') {
    // The getter exists and returns NOTHING: no conversation is open
    // yet. That is not a broken contract — the turn has no answer to
    // give, so the wait continues.
    return null;
  }
  if (!read || read.state !== 'ok') {
    const cause =
      read && read.state === 'no-store'
        ? 'the app is booted but has no store'
        : 'the store does not expose the conversation/openConversation getter';
    throw new Error(`${cause} — that is a broken store contract, not a slow answer`);
  }
  const messages = read.messages || [];
  const bots = messages.filter((m) => m.sender === 'bot');
  const last = bots[bots.length - 1];
  // No bot message yet — or the last one is the WELCOME bubble, which
  // carries no flag at all: the turn has not produced an answer, so the
  // wait continues (null is not false). A message without the flag is
  // not the turn's answer.
  //
  // The flag's ABSENCE is the signal, so the page must not coerce it: a
  // welcome bubble coerced to `false` here would read as "the turn
  // finished" and end the wait before the answer existed.
  if (last === undefined || last.isStreaming === undefined) return null;
  return last.isStreaming;
}

/**
 * Get all chat messages as an array of { sender, text } objects.
 */
async function getMessages(page) {
  const messages = [];
  const elements = await page.locator(MESSAGE_ROW).all();

  for (const el of elements) {
    // The row's handle carries the sender: `chat-message-bot` or
    // `chat-message-user`. Reading the class attribute instead would
    // couple the helper to the markup's styling.
    const handle = (await el.getAttribute('data-testid')) || '';
    const sender = handle.endsWith('-user') ? 'user' : 'bot';
    const bubble = el.locator(`[data-testid="message-bubble-${sender}"]`);
    const text = (await bubble.isVisible()) ? (await bubble.innerText()).trim() : '';
    messages.push({ sender, text });
  }

  return messages;
}

/**
 * Get the last bot message text.
 */
async function getLastBotMessage(page) {
  const botMessages = page.locator(BOT_BUBBLE);
  const count = await botMessages.count();
  if (count === 0) {
    return '';
  }
  return (await botMessages.nth(count - 1).innerText()).trim();
}

/**
 * Click the save button and fill in the save dialog.
 * The conversation-header save button is the only save affordance that
 * renders: ChatComposer's save-chat-btn is gated on a show-save prop no
 * parent passes, so the header button is what the app ships.
 */
async function saveChat(page, title) {
  const button = page.locator('[data-testid="conversation-header-save"]');
  await expect(button).toBeVisible({ timeout: 5000 });
  await button.click();

  // Wait for save dialog
  const titleInput = page.locator(CHAT_TITLE_INPUT);
  await expect(titleInput).toBeVisible({ timeout: 5000 });
  await titleInput.fill(title);

  // Click save in dialog (exact match to avoid "Saved Chats" tab)
  const confirmButton = page.getByRole('button', { name: /^save$/i });
  await confirmButton.click();
}

/**
 * Wait until the last bot bubble carries the given text. The bubble mounts
 * as a streaming placeholder the moment the send handler runs, so bubble
 * presence alone says nothing — this waits for CONTENT. Under the specs'
 * SSE mock (chunk + done delivered in one body) content-on-screen means
 * the turn is complete and storable; against a real streamed answer it
 * would not, so a spec driving a live stream needs its own completion
 * signal.
 */
async function waitForBotMessage(page, text, { timeout = 30000 } = {}) {
  await expect(page.locator(BOT_BUBBLE).last()).toContainText(text, { timeout });
}


/**
 * Mock the chat answer stream. `chunks` arrive as chunk frames; `metadata`,
 * when given, rides a metadata frame before the done frame. The interception
 * sits at the network layer (page.route), so the app's own fetch + SSE
 * parsing path runs — only the bytes on the wire are scripted.
 */
async function mockChatStream(page, chunks, metadata) {
  // The body is registration-invariant: chunks and metadata are literals at
  // every call site, so build the wire bytes once, not per interception.
  const body = sseBody(chunks, metadata);
  await page.route(
    STREAM_ROUTE,
    runPostOnlyRouteHandler(page, async (route) => {
      await sseFulfill(route, body);
    })
  );
}

/**
 * Mock a FAILED stream: the app must render the error card for a non-2xx
 * answer. Beside `mockChatStream` because it is the same contract — the
 * same endpoint, the same POST-only interception, the same CORS header a
 * cross-origin reader needs.
 */
async function mockStreamError(page) {
  // Registration-invariant like the SSE body: build the wire bytes once.
  // The answer is the app's own error shape — every 5xx reaches the same
  // branch, so the mock carries no knob for it.
  const body = JSON.stringify({
    error: 'SERVICE_UNAVAILABLE',
    message: 'RAG pipeline is temporarily unavailable',
  });
  await page.route(
    STREAM_ROUTE,
    runPostOnlyRouteHandler(page, async (route) => {
      await route.fulfill({ status: 503, contentType: 'application/json', headers: CORS_HEADERS, body });
    })
  );
}

/**
 * Answer the feedback POST with an empty success, so a test that rates an
 * answer does not depend on the network for the rated state. Tests that
 * never rate need not install it.
 */
async function ackFeedback(page) {
  await page.route(
    '**/feedback**',
    runPostOnlyRouteHandler(page, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    })
  );
}

module.exports = {
  CHAT_TITLE_INPUT,
  readStreamingState,
  streamingFlagOf,
  botStreamingFlag,
  loginViaUI,
  navigateToChatbot,
  LOGIN_BUDGET_TIMEOUT_MS,
  sendMessage,
  waitForBotResponse,
  waitForBotMessage,
  sseBody,
  sseFulfill,
  mockChatStream,
  mockStreamError,
  ackFeedback,
  getMessages,
  getLastBotMessage,
  saveChat,
  TEST_USER,
  TEST_ADMIN_USER,
  TEST_PLAIN_USER,
  BASE_URL,
  MESSAGE_ROW,
  BOT_BUBBLE,
  NAV_STATUS,
  STREAM_PATH,
  STREAM_ROUTE
};
