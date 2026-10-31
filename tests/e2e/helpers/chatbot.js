const { expect } = require('@playwright/test');

const TEST_USER = {
  username: 'testuser',
  password: 'TestPass123!',
};

// The documents admin surface (upload, delete, lifecycle) is ADMIN_ONLY on
// the document-repository — a plain user's POST /api/files/upload is 403 by
// design. The admin test user is provisioned with the `admin` realm role by
// Phase 0 of docs/e2e-tests/00-clean-start.md.
const TEST_ADMIN_USER = {
  username: 'testadmin',
  password: 'TestAdmin123!',
};

// Normalized once: page.url() never produces a trailing double slash,
// so every `${BASE_URL}/...` interpolation stays well-formed even when
// the environment configures BASE_URL with a trailing '/'.
const BASE_URL = (process.env.BASE_URL || 'https://localhost').replace(/\/+$/, '');

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
    timeout: 30000,
  });

  // A previous attempt's token exchange can complete just after its wait
  // expired — that is precisely the failure this helper retries. The session
  // is then already established and there is nothing left to log in to.
  if (page.url().includes('dashboard')) return;

  await page.waitForURL('**/protocol/openid-connect/auth**', {
    timeout: 15000,
  });

  await page.fill('#username', user.username);
  await page.fill('#password', user.password);
  await page.click('#kc-login');

  await page.waitForURL(
    (url) => {
      const urlStr = url.toString();
      return urlStr.includes('dashboard') || urlStr === `${BASE_URL}/`;
    },
    { timeout: budgetMs },
  );

  const finalUrl = page.url();
  // Same exits as the waitForURL predicate above — a login that settled
  // on the bare origin (the SPA's interim landing) succeeded and must
  // not be reported as a failure.
  expect(
    finalUrl.includes('dashboard') || finalUrl === `${BASE_URL}/`,
    `Expected the login to land on the dashboard or the bare origin, got: ${finalUrl}`,
  ).toBeTruthy();
}

/**
 * Navigate to the chatbot view from the dashboard.
 */
async function navigateToChatbot(page) {
  await page.goto(`${BASE_URL}/chat`, {
    waitUntil: 'networkidle',
    timeout: 30000,
  });
}

/**
 * Send a message via the chatbot input.
 */
async function sendMessage(page, message) {
  const textarea = page.locator('.prompt-textarea');
  await expect(textarea).toBeVisible({ timeout: 10000 });
  await textarea.fill(message);
  await textarea.press('Enter');
}

/**
 * Wait for a bot response to appear in the chat window.
 * Polls for new bot messages and ensures the loading spinner disappears.
 */
async function waitForBotResponse(page, options = {}) {
  const timeout = options.timeout || 60000;

  // Wait for loading spinner to appear (indicates processing started)
  await page.waitForSelector('.loading-spinner', {
    timeout: 5000,
  }).catch(() => {
    // Spinner may be very fast — OK if missed
  });

  // Wait for loading spinner to disappear (indicates response complete)
  await expect(page.locator('.loading-spinner')).toBeHidden({
    timeout,
  });
}

/**
 * Get all chat messages as an array of { sender, text } objects.
 */
async function getMessages(page) {
  const messages = [];
  const elements = await page.locator('.chat-message').all();

  for (const el of elements) {
    const classAttr = await el.getAttribute('class') || '';
    const sender = classAttr.includes('user') ? 'user' : 'bot';
    const bubble = el.locator('.message-bubble');
    const text = (await bubble.isVisible())
      ? (await bubble.innerText()).trim()
      : '';
    messages.push({ sender, text });
  }

  return messages;
}

/**
 * Get the last bot message text.
 */
async function getLastBotMessage(page) {
  const botMessages = page.locator('.chat-message.bot .message-bubble');
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
  const titleInput = page.locator('#chatTitle');
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
  await expect(page.locator('.chat-message.bot .message-bubble').last()).toContainText(text, {
    timeout,
  });
}

module.exports = {
  loginViaUI,
  navigateToChatbot,
  sendMessage,
  waitForBotResponse,
  waitForBotMessage,
  getMessages,
  getLastBotMessage,
  saveChat,
  TEST_USER,
  TEST_ADMIN_USER,
  BASE_URL,
};
