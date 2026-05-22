const { expect } = require('@playwright/test');

const TEST_USER = {
  username: 'testuser',
  password: 'TestPass123!',
};

const BASE_URL = 'https://localhost';

/**
 * Authenticate via page-level login (Keycloak redirect flow).
 * Navigates to the app, fills Keycloak credentials, waits for dashboard.
 * @param {import('@playwright/test').Page} page
 * @param {object} [user] - Override default test user
 * @returns {Promise<void>}
 */
async function loginViaUI(page, user = TEST_USER) {
  await page.goto(`${BASE_URL}/`, {
    waitUntil: 'networkidle',
    timeout: 30000,
  });

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
    { timeout: 30000 },
  );

  const finalUrl = page.url();
  expect(
    finalUrl.includes('dashboard'),
    `Expected URL to contain 'dashboard', got: ${finalUrl}`,
  ).toBeTruthy();
}

/**
 * Navigate to the chatbot view from the dashboard.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function navigateToChatbot(page) {
  await page.goto(`${BASE_URL}/chat`, {
    waitUntil: 'networkidle',
    timeout: 30000,
  });
}

/**
 * Send a message via the chatbot input.
 * Types into the textarea and clicks the send button (or presses Enter).
 * @param {import('@playwright/test').Page} page
 * @param {string} message
 * @returns {Promise<void>}
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
 * @param {import('@playwright/test').Page} page
 * @param {object} [options]
 * @param {number} [options.timeout=60000] - Max wait time in ms
 * @returns {Promise<void>}
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
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Array<{sender: string, text: string}>>}
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
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string>}
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
 * Click the save chat button and fill in the save dialog.
 * @param {import('@playwright/test').Page} page
 * @param {string} title - Chat title
 * @returns {Promise<void>}
 */
async function saveChat(page, title) {
  const saveButton = page.locator('button[title="Save Chat"]');
  await expect(saveButton).toBeVisible({ timeout: 5000 });
  await saveButton.click();

  // Wait for save dialog
  const titleInput = page.locator('#chatTitle');
  await expect(titleInput).toBeVisible({ timeout: 5000 });
  await titleInput.fill(title);

  // Click save in dialog
  const confirmButton = page.getByRole('button', { name: /save/i });
  await confirmButton.click();
}

/**
 * Dismiss the quick-help overlay if present.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function dismissQuickHelp(page) {
  const overlay = page.locator('.quick-help-item').first();
  if (await overlay.isVisible({ timeout: 2000 }).catch(() => false)) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
}

module.exports = {
  loginViaUI,
  navigateToChatbot,
  sendMessage,
  waitForBotResponse,
  getMessages,
  getLastBotMessage,
  saveChat,
  dismissQuickHelp,
  TEST_USER,
  BASE_URL,
};
