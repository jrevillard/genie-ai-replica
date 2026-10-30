const { expect } = require('@playwright/test');

const TEST_USER = {
  username: 'testuser',
  password: 'TestPass123!',
};

const BASE_URL = process.env.BASE_URL || 'https://localhost';

// The wait from the submit click to the dashboard: the identity provider
// deciding to issue a code, then the app exchanging it. On an idle stack the
// whole handshake takes about a second (median 974 ms, max 1085 ms over 10
// sessions), so this budget is not sized for the happy path — it is sized for
// a stack that stalls or rejects, and the retry is what recovers from that.
const AUTH_BUDGET_MS = 30000;

// The retry runs after the first budget has already been spent, and both have
// to fit inside Playwright's 60 s per-test timeout alongside the spec's own
// work. 30 s + 15 s = 45 s leaves room; 30 s + 30 s would not, and a helper
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
  expect(
    finalUrl.includes('dashboard'),
    `Expected URL to contain 'dashboard', got: ${finalUrl}`,
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

module.exports = {
  loginViaUI,
  navigateToChatbot,
  sendMessage,
  waitForBotResponse,
  getMessages,
  getLastBotMessage,
  saveChat,
  TEST_USER,
  BASE_URL,
};
