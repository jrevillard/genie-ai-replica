const { expect } = require('@playwright/test');

const TEST_USER = {
  username: 'testuser',
  password: 'TestPass123!',
};

const BASE_URL = process.env.BASE_URL || 'https://localhost';

/**
 * Authenticate via page-level login (Keycloak redirect flow).
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
 * Click the save chat button and fill in the save dialog.
 * Uses chat-header button selector (last button in header) to avoid
 * dependency on i18n-translated title attributes.
 */
async function saveChat(page, title) {
  // data-testid is the primary selector; title attribute as fallback for
  // pre-built images that don't include the latest data-testid.
  const button = page.locator('[data-testid="save-chat-btn"], .input-actions button[title="Save Chat"]').first();
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
 * Dismiss the quick-help overlay if present.
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
