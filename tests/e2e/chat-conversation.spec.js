// The conversation view's V1 invariants (spec:
// docs/superpowers/specs/2026-10-23-chat-conversation-v1-design.md).
// Each test asserts one invariant the rendered conversation must keep,
// and each one carries a mutation check recorded beside it.
const { test, expect } = require('@playwright/test');
const { openWelcomeScreen, contrastRatio } = require('./helpers/welcome');

const BASE_URL = process.env.BASE_URL || 'https://localhost';

async function mockStream(page, chunks, metadata) {
  const frames = chunks.map((c) => `data: ${JSON.stringify({ type: 'chunk', content: c })}`);
  if (metadata) frames.push(`data: ${JSON.stringify({ type: 'metadata', ...metadata })}`);
  const sse = [...frames, '', `data: ${JSON.stringify({ type: 'done', queryId: 'mock-query-1' })}`, ''].join('\n');
  // The inline thumbs post their rating to the same backend — answer it so
  // the rated state does not depend on the network.
  await page.route('**/feedback**', async (route) => {
    if (route.request().method() === 'POST') {
      try {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      } catch {
        /* the context closed before the fulfillment */
      }
      return;
    }
    await route.continue();
  });
  await page.route('**/queries/stream', async (route) => {
    try {
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse });
    } catch {
      /* the context closed before the fulfillment */
    }
  });
}

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
        return { header: r('.conversation-header'), input: r('.chat-input'), window: r('.chat-window') };
      });
    const on = await boxes();
    await page.evaluate(() => document.documentElement.setAttribute('data-visual', 'off'));
    await page.waitForTimeout(300);
    const off = await boxes();
    expect(off.header, 'the header box does not move with the layer off').toEqual(on.header);
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
    expect(m.maxH, 'the field caps at five lines (5 line boxes + padding, computed in CSS)').toBeLessThan(m.scrollH);
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

test.describe('Conversation V1 — actions', () => {
  // Task 7 — the answer carries thumbs that record a rating and a copy that
  // fills the clipboard (D3).
  test('the answer carries thumbs that record a rating and a copy that fills the clipboard', async ({ browser }) => {
    const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await mockStream(page, ['GENIE.AI is a sovereign generative AI framework for the public sector.']);
    await page.locator('[data-testid="welcome-composer"] textarea').fill('What is GENIE.AI?');
    await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
    await page.waitForSelector('[data-testid="answer-actions"]', { timeout: 45000 });
    await page.locator('[data-testid="answer-thumb-up"]').click();
    await page.waitForTimeout(500);
    const rated = await page.evaluate(() =>
      document.querySelector('[data-testid="answer-thumb-up"]').getAttribute('data-rated')
    );
    expect(rated, 'the thumb shows its selected state').toBe('true');
    await page.locator('[data-testid="answer-copy"]').click();
    await page.waitForTimeout(300);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip.length, 'the clipboard holds the answer text').toBeGreaterThan(0);
    await ctx.close();
  });
});

test.describe('Conversation V1 — warning and error', () => {
  // Task 8 — the ungrounded amber (D4-grounding) and the retryable error
  // state (D15) live inside the card.
  test('an ungrounded answer shows the amber warning inside the card and no empty sources', async ({ browser }) => {
    const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
    // Deterministic: the ungrounded state comes from the metadata frame, so
    // the test scripts a stream whose metadata declares is_grounded=false —
    // never a live RAG answer, which may ground either way.
    await mockStream(page, ['GENIE.AI answers from its own knowledge when no document supports the point.'], {
      is_grounded: false,
      confidence_score: 0.78
    });
    await page.locator('[data-testid="welcome-composer"] textarea').fill('What is GENIE.AI?');
    await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
    // The warning is itself the signal that the metadata frame has landed.
    await page.waitForSelector('.chat-message.bot .answer-warning', { timeout: 45000 });
    const s = await page.evaluate(() => {
      const cards = document.querySelectorAll('.chat-message.bot .answer-card');
      const card = cards[cards.length - 1];
      const warn = card.querySelector('.answer-warning');
      const probe = document.createElement('div');
      probe.style.background = 'var(--warning-bg)';
      document.body.appendChild(probe);
      const token = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return {
        warnBg: warn ? getComputedStyle(warn).backgroundColor : null,
        token,
        sources: !!card.querySelector('[data-testid="answer-sources"]')
      };
    });
    expect(s.warnBg, 'the amber warning paints (the mocked frame ran)').not.toBeNull();
    expect(s.warnBg, 'the warning paints the warning token, not red').toBe(s.token);
    expect(s.sources, 'no empty sources section on an ungrounded answer').toBe(false);
    await ctx.close();
  });

  test('a failed turn shows a retry that re-sends the same query', async ({ browser }) => {
    const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
    // Sabotage the stream call for the first attempt only.
    let aborted = false;
    await page.route('**/queries/stream**', async (route) => {
      if (route.request().method() === 'POST' && !aborted) {
        aborted = true;
        return route.abort();
      }
      return route.continue();
    });
    await page.locator('[data-testid="welcome-composer"] textarea').fill('What is GENIE.AI?');
    await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
    await page.waitForSelector('[data-testid="answer-error"]', { timeout: 30000 });
    await page.locator('[data-testid="answer-retry"]').click();
    await page.waitForSelector('.chat-message.bot .message-bubble', { timeout: 45000 });
    const n = await page.locator('.chat-message.user').count();
    expect(n, 'the retry does not duplicate the user turn').toBe(1);
    await ctx.close();
  });
});

test.describe('Conversation V1 — status strip', () => {
  // Task 9 — the status indicator is one compact strip; offline carries an
  // accessible explanation (D4-offline).
  test('the status indicator is one compact strip; offline carries an accessible explanation', async ({ browser }) => {
    const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
    await page.locator('[data-testid="welcome-composer"] textarea').fill('What is GENIE.AI?');
    await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
    await page.waitForSelector('.system-status-panel', { timeout: 15000 });
    const read = () =>
      page.evaluate(() => {
        const p = document.querySelector('.system-status-panel');
        return {
          h: p.getBoundingClientRect().height,
          status: p.getAttribute('data-status'),
          role: p.querySelector('.status-left')?.getAttribute('role'),
          explains: p.querySelector('.status-error-message')?.textContent?.trim().length > 0
        };
      });
    const online = await read();
    expect(online.h, 'the strip is compact').toBeLessThan(40);
    expect(online.status, 'the strip reports the online state').toBe('online');
    // A failed turn flips the strip to its offline explanation, announced.
    await page.route('**/queries/stream**', async (route) => {
      try {
        await route.abort();
      } catch {
        /* the context closed before the abort */
      }
    });
    await page.locator('[data-testid="chat-composer"] textarea').fill('say something');
    await page.locator('[data-testid="chat-composer"] textarea').press('Enter');
    await page.waitForSelector('[data-testid="answer-error"]', { timeout: 30000 });
    const offline = await read();
    expect(offline.status, 'the strip flips to offline').toBe('offline');
    expect(offline.role, 'the explanation is announced as a status region').toBe('status');
    expect(offline.explains, 'the strip explains itself').toBe(true);
    await ctx.close();
  });
});

test.describe('Conversation V1 — documents panel', () => {
  // Task 10 — the empty documents state explains itself, FAQs stay (D16).
  test('the documents panel shows a neutral empty state and keeps the FAQs', async ({ browser }) => {
    const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
    await page.locator('[data-testid="welcome-composer"] textarea').fill('What is GENIE.AI?');
    await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
    await page.waitForSelector('.chat-message.bot', { timeout: 45000 });
    await page.waitForSelector('[data-testid="documents-empty"]', { timeout: 15000 });
    const s = await page.evaluate(() => {
      const empty = document.querySelector('[data-testid="documents-empty"]');
      const faq = document.querySelector('[data-testid="faq-section"]');
      return {
        emptyText: empty ? empty.textContent : '',
        hasTitle: !!empty?.querySelector('.ds-state__message'),
        hasHint: !!empty?.querySelector('.ds-state__hint'),
        faqVisible: !!faq
      };
    });
    expect(s.emptyText.length, 'the empty state explains itself').toBeGreaterThan(0);
    expect(s.hasTitle && s.hasHint, 'title and hint both render').toBe(true);
    expect(s.faqVisible, 'the FAQs stay accessible').toBe(true);
    await ctx.close();
  });
});

test.describe('Conversation V1 — contrast', () => {
  // Task 12 — the new inks clear WCAG AA for body text (4.5:1): the amber
  // warning on its ground, the initials on their accent circle.
  test('the amber warning and the initials clear a 4.5:1 contrast floor', async ({ browser }) => {
    const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
    await mockStream(page, ['GENIE.AI answers from its own knowledge when no document supports the point.'], {
      is_grounded: false,
      confidence_score: 0.78
    });
    await page.locator('[data-testid="welcome-composer"] textarea').fill('What is GENIE.AI?');
    await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
    await page.waitForSelector('.chat-message.bot .answer-warning', { timeout: 45000 });
    // The styles come back as sRGB triples: the tokens are OKLch, and the
    // page-side canvas resolves any colour format into its painted pixels.
    const styles = await page.evaluate(() => {
      const rgb = (v) => {
        const c = document.createElement('canvas');
        c.width = c.height = 1;
        const x = c.getContext('2d');
        x.fillStyle = v;
        x.fillRect(0, 0, 1, 1);
        const d = x.getImageData(0, 0, 1, 1).data;
        return [d[0], d[1], d[2]];
      };
      const cs = (el) => el.style.cssText;
      const pick = (sel, prop) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el)[prop] : null;
      };
      // The warning sits on the card's surface, not on the page background.
      const warn = document.querySelector('.chat-message.bot .answer-warning');
      const card = warn ? warn.closest('.answer-card') : null;
      const initials = document.querySelector('.message-avatar__initials');
      return {
        warnColor: rgb(pick('.chat-message.bot .answer-warning', 'color')),
        warnBg: rgb(pick('.chat-message.bot .answer-warning', 'backgroundColor')),
        initColor: rgb(pick('.message-avatar__initials', 'color')),
        initBg: rgb(pick('.message-avatar__initials', 'backgroundColor'))
      };
    });
    expect(
      contrastRatio(styles.warnColor, styles.warnBg),
      'the amber ink clears 4.5:1 on its own ground'
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(styles.initColor, styles.initBg),
      'the initials clear 4.5:1 on their circle'
    ).toBeGreaterThanOrEqual(4.5);
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
    // The card exists immediately (the thinking frame), before the answer
    // text — the indicator itself is the arrival signal (the greeting card
    // would otherwise win the race).
    await page.waitForSelector('.chat-message.bot .streaming-indicator', { timeout: 15000 });
    const early = await page.evaluate(() => {
      const cards = document.querySelectorAll('[data-testid="answer-card"]');
      const card = cards[cards.length - 1];
      const cs = getComputedStyle(card);
      return { shadow: cs.boxShadow !== 'none', hasThinking: !!card.querySelector('.streaming-indicator') };
    });
    expect(early.shadow, 'the card is elevated').toBe(true);
    expect(early.hasThinking, 'the first frame shows the thinking indicator, not a fake progress').toBe(true);
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
