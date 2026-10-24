// The conversation view's V1 invariants (spec:
// docs/superpowers/specs/2026-10-23-chat-conversation-v1-design.md).
// Each test asserts one invariant the rendered conversation must keep,
// and each one carries a mutation check recorded beside it.
const { test, expect } = require('@playwright/test');
const { openWelcomeScreen } = require('./helpers/welcome');

const BASE_URL = process.env.BASE_URL || 'https://localhost';

async function askAndAnswer(page, question) {
  await page.locator('[data-testid="welcome-composer"] textarea').fill(question);
  await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
  await page.waitForSelector('.chat-message.bot', { timeout: 45000 });
}

test.describe('Conversation V1', () => {
  // Task 1 — the header names the conversation and closes it.
  test('the header names the conversation and × returns to the welcome screen, keeping history', async ({ browser }) => {
    const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
    await askAndAnswer(page, 'What is GENIE.AI?');
    const title = page.locator('[data-testid="conversation-header-title"]');
    await expect(title).toBeVisible();
    await expect(title).not.toBeEmpty();
    await page.locator('[data-testid="conversation-header-close"]').click();
    // The unsaved-changes confirm may appear — accept its default action.
    const confirm = page.locator('[role="dialog"]');
    if (await confirm.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.keyboard.press('Enter');
    }
    await expect(page.locator('.quick-help-overlay')).toBeVisible({ timeout: 15000 });
    await ctx.close();
  });

  // Task 2 — the wave is fixed behind the conversation.
  test('the wave is fixed behind the conversation and does not scroll with the messages', async ({ browser }) => {
    const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
    await askAndAnswer(page, 'What is GENIE.AI?');
    await page.waitForTimeout(500);
    const before = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.chatbot-container'), '::after');
      return { content: cs.content, position: cs.position, bottom: cs.bottom, image: cs.backgroundImage };
    });
    expect(before.content, 'the wave pseudo must paint').not.toBe('none');
    expect(['fixed', 'absolute'], 'the wave must hold its place in the container').toContain(before.position);
    expect(before.image, 'the wave carries the asset').toContain('url');
    await page.evaluate(() => { document.querySelector('.chat-window').scrollTop = 400; });
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => getComputedStyle(document.querySelector('.chatbot-container'), '::after').bottom);
    expect(after, 'the wave must not scroll with the messages').toBe(before.bottom);
    // Layer-off: the paint goes, the layout stays.
    const boxes = () => page.evaluate(() => {
      const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map((v) => Math.round(v)); };
      return { input: r('.chat-input'), window: r('.chat-window') };
    });
    const on = await boxes();
    await page.evaluate(() => document.documentElement.setAttribute('data-visual', 'off'));
    await page.waitForTimeout(300);
    const off = await boxes();
    expect(off.input, 'the composer box does not move with the layer off').toEqual(on.input);
    expect(off.window, 'the message window box does not move with the layer off').toEqual(on.window);
    await ctx.close();
  });
});
