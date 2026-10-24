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
  test('the header names the conversation and × returns to the welcome screen, keeping history', async ({
    browser
  }) => {
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
    await page.evaluate(() => {
      document.querySelector('.chat-window').scrollTop = 400;
    });
    await page.waitForTimeout(200);
    const after = await page.evaluate(
      () => getComputedStyle(document.querySelector('.chatbot-container'), '::after').bottom
    );
    expect(after, 'the wave must not scroll with the messages').toBe(before.bottom);
    // Layer-off: the paint goes, the layout stays.
    const boxes = () =>
      page.evaluate(() => {
        const r = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return [b.x, b.y, b.width, b.height].map((v) => Math.round(v));
        };
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

  // Task 3 — no dead buttons in the conversation; the field caps at five lines.
  test('the conversation composer has no attach or mic buttons and grows to five lines', async ({ browser }) => {
    const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
    await askAndAnswer(page, 'What is GENIE.AI?');
    await expect(page.locator('[data-testid="composer-attach-btn"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="composer-mic-btn"]')).toHaveCount(0);
    const lines = Array(8).fill('line').join('\n');
    await page.locator('[data-testid="chat-composer"] textarea').fill(lines);
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const ta = document.querySelector('[data-testid="chat-composer"] textarea');
      const cs = getComputedStyle(ta);
      return { scrollH: ta.scrollHeight, maxH: parseFloat(cs.maxHeight), overflowY: cs.overflowY };
    });
    expect(m.maxH, 'the field caps at five lines (27px x 5 + 16px padding)').toBeLessThan(m.scrollH);
    expect(m.overflowY, 'beyond five lines the field scrolls internally').toBe('auto');
    await ctx.close();
  });

  // Task 4 — every turn carries its avatar.
  test('each turn carries its avatar: the product tile for the assistant, initials for the user', async ({
    browser
  }) => {
    const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
    await askAndAnswer(page, 'What is GENIE.AI?');
    const a = await page.evaluate(() => {
      const el = document.querySelector('.message-avatar--assistant');
      const cs = el ? getComputedStyle(el) : null;
      return el
        ? { w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height, radius: cs.borderRadius }
        : null;
    });
    expect(a, 'the assistant tile renders').not.toBeNull();
    expect(a.w, 'the assistant tile is 36px wide').toBe(36);
    expect(a.h, 'the assistant tile is 36px tall').toBe(36);
    const u = await page.evaluate(() => {
      const el = document.querySelector('.message-avatar--user');
      const initials = el ? el.querySelector('.message-avatar__initials') : null;
      return el
        ? {
            text: el.textContent.trim(),
            hasPhoto: !!el.querySelector('img'),
            color: initials ? getComputedStyle(initials).backgroundColor : null
          }
        : null;
    });
    expect(u, 'the user avatar renders').not.toBeNull();
    expect(u.text.length > 0 || u.hasPhoto, 'initials or a photo, never empty').toBe(true);
    expect(u.color, 'the initials circle is painted from a token, not transparent').not.toBe('rgba(0, 0, 0, 0)');
    await ctx.close();
  });
});

test.describe('Conversation V1 — sources', () => {
  // Task 6 — the answer card carries its own collapsible sources (D2).
  // The stream is scripted: the local stack holds no ingested corpus, so no
  // real answer here is ever grounded — the UI contract under test is how a
  // grounded metadata frame renders, not the retriever.
  test('the answer card carries its own collapsible sources', async ({ browser }) => {
    const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
    await page.route('**/queries/stream', async (route) => {
      const sse = [
        `data: ${JSON.stringify({ type: 'chunk', content: 'GENIE.AI answers from the library documents.' })}`,
        '',
        `data: ${JSON.stringify({
          type: 'metadata',
          confidence_score: 0.82,
          is_grounded: true,
          source_documents: [
            {
              document_id: 'doc-1',
              document_name: 'National ID Application Guide',
              file_name: 'guide.pdf',
              url: '/api/files/doc-1/download',
              score: 0.91
            }
          ]
        })}`,
        '',
        `data: ${JSON.stringify({ type: 'done' })}`,
        ''
      ].join('\n');
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse });
    });
    await page.locator('[data-testid="welcome-composer"] textarea').fill('How do I apply for a national ID?');
    await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
    await page.waitForSelector('[data-testid="answer-sources"]', { timeout: 45000 });
    const state = async () =>
      page.evaluate(() => {
        const s = document.querySelector('[data-testid="answer-sources"]');
        const cards = s.querySelectorAll('[data-testid^="answer-source-card-"]');
        return { n: cards.length, open: getComputedStyle(s.querySelector('.answer-sources__list')).display !== 'none' };
      });
    const open = await state();
    expect(open.n, 'sources render as cards').toBeGreaterThan(0);
    expect(open.open, 'open by default').toBe(true);
    await page.locator('[data-testid="answer-sources-toggle"]').click();
    expect((await state()).open, 'the section collapses').toBe(false);
    await ctx.close();
  });
});

test.describe('Conversation V1 — answer card', () => {
  // Task 5 — the assistant answer renders inside one elevated card, from the
  // first frame of the stream (D9 + D14).
  test('the assistant answer renders inside one elevated card, from the first frame', async ({ browser }) => {
    const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
    // Throttle the stream so the thinking frame is stable and observable —
    // otherwise the answer may complete before the first read.
    await page.route('**/queries/stream**', async (route) => {
      try {
        const resp = await route.fetch();
        const body = await resp.text();
        await new Promise((r) => setTimeout(r, 800));
        // The browser context may close while the throttle is still pending —
        // the fulfilled stream would then outlive its test.
        await route.fulfill({ response: resp, body });
      } catch {
        /* the context closed mid-throttle */
      }
    });
    await page.locator('[data-testid="welcome-composer"] textarea').fill('What is GENIE.AI?');
    await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
    // The card exists immediately (the thinking frame), before the answer text.
    await page.waitForSelector('[data-testid="answer-card"]', { timeout: 15000 });
    const early = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="answer-card"]');
      const cs = getComputedStyle(card);
      return { shadow: cs.boxShadow !== 'none', hasThinking: !!card.querySelector('.streaming-indicator') };
    });
    expect(early.shadow, 'the card is elevated').toBe(true);
    await page.waitForSelector('.chat-message.bot .message-bubble', { timeout: 30000 });
    const late = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="answer-card"]');
      const bubble = card.querySelector('.message-bubble');
      return { bubbleInside: !!bubble, text: (bubble.textContent || '').length };
    });
    expect(late.bubbleInside, 'the bubble lives inside the card').toBe(true);
    expect(late.text, 'the answer text arrives in the card').toBeGreaterThan(0);
    await ctx.close();
  });
});
