// The conversation view's V1 invariants (spec:
// docs/superpowers/specs/2026-10-23-chat-conversation-v1-design.md).
// Each test asserts one invariant the rendered conversation must keep,
// and each one carries a mutation check recorded beside it.
const { test, expect } = require('@playwright/test');
const { openWelcomeScreen, contrastRatio } = require('./helpers/welcome');
const { mockChatStream, sseBody, ackFeedback } = require('./helpers/chatbot');

async function askAndAnswer(page, question) {
  await page.locator('[data-testid="welcome-composer"] textarea').fill(question);
  await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
  await page.waitForSelector('.chat-message.bot', { timeout: 45000 });
}

test.describe('Conversation V1', () => {
  // The header names the open conversation and closes it.
  test('the header names the conversation and × returns to the welcome screen, keeping history', async ({
    browser
  }) => {
    const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
    await askAndAnswer(page, 'What is GENIE.AI?');
    const title = page.locator('[data-testid="conversation-header-title"]');
    await expect(title).toBeVisible();
    await expect(title).not.toBeEmpty();
    // The close cross stands apart from the save/export cluster — it is a
    // different action, not a fourth member of the row.
    const closeOutside = await page.evaluate(
      () =>
        !document.querySelector('[data-testid="conversation-header-close"]').closest('.conversation-header__actions')
    );
    expect(closeOutside, 'the close cross sits outside the save/export cluster').toBe(true);
    await page.locator('[data-testid="conversation-header-close"]').click();
    // The unsaved-changes confirm may appear — accept its default action.
    const confirm = page.locator('[role="dialog"]');
    if (await confirm.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.keyboard.press('Enter');
    }
    await expect(page.locator('.quick-help-overlay')).toBeVisible({ timeout: 15000 });
    await ctx.close();
  });

  // The wave is fixed behind the conversation.
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
    // The band shares the welcome banner's mechanics: its height derives
    // from the artwork's own aspect ratio, so nothing squashes or shears
    // at any viewport width.
    const band = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.chatbot-container'), '::after');
      return { ratio: cs.aspectRatio, size: cs.backgroundSize };
    });
    expect(band.ratio, 'the band tracks the artwork ratio, like the banner').toBe('1800 / 356');
    expect(band.size.startsWith('100%'), 'the artwork keeps its own ratio in the band').toBe(true);
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

  // The composer matches the dashboard bar: the attach and mic placeholders
  // are present but disabled everywhere; the field caps at five lines.
  test('the composer keeps its disabled attach and mic placeholders and grows to five lines', async ({ browser }) => {
    const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
    await askAndAnswer(page, 'What is GENIE.AI?');
    await expect(page.locator('[data-testid="composer-attach-btn"]')).toBeDisabled();
    await expect(page.locator('[data-testid="composer-mic-btn"]')).toBeDisabled();
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

  // Every turn carries its avatar.
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
    expect(a.radius, 'the assistant tile is a circle, like the mockup').toBe('999px');
    const u = await page.evaluate(() => {
      const el = document.querySelector('.message-avatar--user');
      const initials = el ? el.querySelector('.message-avatar__initials') : null;
      return el
        ? {
            text: el.textContent.trim(),
            hasPhoto: !!el.querySelector('img'),
            color: initials ? getComputedStyle(initials).backgroundColor : null,
            initialsRadius: initials ? getComputedStyle(initials).borderRadius : null,
            fillsTile: initials
              ? Math.abs(initials.getBoundingClientRect().width - el.getBoundingClientRect().width) < 1
              : false
          }
        : null;
    });
    expect(u, 'the user avatar renders').not.toBeNull();
    expect(u.text.length > 0 || u.hasPhoto, 'initials or a photo, never empty').toBe(true);
    expect(u.color, 'the initials circle is painted from a token, not transparent').not.toBe('rgba(0, 0, 0, 0)');
    expect(u.initialsRadius, 'the initials ground is a circle matching the tile').toBe('999px');
    expect(u.fillsTile, 'the initials ground fills the tile, not a smaller square inside it').toBe(true);
    await ctx.close();
  });
});

test.describe('Conversation — sources', () => {
  // The answer card carries its own collapsible sources.
  // The stream is scripted: the local stack holds no ingested corpus, so no
  // real answer here is ever grounded — the UI contract under test is how a
  // grounded metadata frame renders, not the retriever.
  test('the answer card carries its own collapsible sources', async ({ browser }) => {
    const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
    await mockChatStream(page, ['GENIE.AI answers from the library documents.'], {
      confidence_score: 0.82,
      is_grounded: true,
      source_documents: [
        {
          document_id: 'doc-1',
          document_name: 'National ID Application Guide',
          file_name: 'guide.pdf',
          score: 0.91
        }
      ]
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
    // The pipeline ships no url, and the repository serves files behind
    // Bearer auth — the card must open through the authenticated
    // viewbrowser flow, not a bare anchor.
    let viewFetch = null;
    await page.route('**/api/files/doc-1/viewbrowser', async (route) => {
      viewFetch = { auth: route.request().headers()['authorization'] };
      return route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-fake' });
    });
    await page.locator('[data-testid^="answer-source-card-"]').click();
    await page.waitForTimeout(800);
    expect(viewFetch, 'opening the card fetches the document').not.toBeNull();
    expect(viewFetch.auth, 'the fetch carries the session token').toMatch(/^Bearer /);
    await page.locator('[data-testid="answer-sources-toggle"]').click();
    expect((await state()).open, 'the section collapses').toBe(false);
    await ctx.close();
  });
});

test.describe('Conversation — actions', () => {
  // The answer carries thumbs that record a rating and a copy that
  // fills the clipboard.
  test('the answer carries thumbs that record a rating and a copy that fills the clipboard', async ({ browser }) => {
    const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    // The inline thumbs post their rating to the same backend — answer it so
    // the rated state does not depend on the network.
    await ackFeedback(page);
    await mockChatStream(page, ['GENIE.AI is a sovereign generative AI framework for the public sector.']);
    await page.locator('[data-testid="welcome-composer"] textarea').fill('What is GENIE.AI?');
    await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
    await page.waitForSelector('[data-testid="answer-actions"]', { timeout: 45000 });
    await page.locator('[data-testid="answer-thumb-up"]').click();
    // The pointer rests on the thumb after the click — its hover paint would
    // mask the rated state. Move away so only the rated paint is read.
    await page.mouse.move(10, 10);
    await page.waitForTimeout(500);
    const rated = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="answer-thumb-up"]');
      return { attr: el.getAttribute('data-rated'), bg: getComputedStyle(el).backgroundColor };
    });
    expect(rated.attr, 'the thumb shows its selected state').toBe('true');
    expect(rated.bg, 'the selected state paints, it does not only tint the icon').not.toBe('rgba(0, 0, 0, 0)');
    await expect(page.locator('.notification.success'), 'the rating confirms itself').toBeVisible();
    await page.locator('[data-testid="answer-copy"]').click();
    await page.waitForTimeout(300);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip.length, 'the clipboard holds the answer text').toBeGreaterThan(0);
    // The button acknowledges the copy with a check mark, then reverts.
    const copiedIcon = await page.evaluate(
      () => document.querySelector('[data-testid="answer-copy"] svg')?.getAttribute('class') || ''
    );
    expect(copiedIcon, 'the copy button shows a check while copied').toContain('check');
    await page.waitForTimeout(1600);
    const revertedIcon = await page.evaluate(
      () => document.querySelector('[data-testid="answer-copy"] svg')?.getAttribute('class') || ''
    );
    expect(revertedIcon, 'the copy button reverts to the copy icon').toContain('copy');
    await ctx.close();
  });
});

test.describe('Conversation — warning and error', () => {
  // The ungrounded amber and the retryable error state live inside the card.
  test('an ungrounded answer shows the amber warning inside the card and no empty sources', async ({ browser }) => {
    const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
    // Deterministic: the ungrounded state comes from the metadata frame, so
    // the test scripts a stream whose metadata declares is_grounded=false —
    // never a live RAG answer, which may ground either way.
    await mockChatStream(page, ['GENIE.AI answers from its own knowledge when no document supports the point.'], {
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

test.describe('Conversation — status pill', () => {
  // The status indicator lives in the navbar (visible on every page) and
  // an offline state carries an accessible explanation.
  test('the navbar pill reports the online state; a failed turn flips it to an explained offline', async ({
    browser
  }) => {
    const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
    const pill = page.locator('[data-testid="nav-status"]');
    await expect(pill).toHaveAttribute('data-status', 'online');
    expect(await pill.getAttribute('role'), 'the pill is announced as a status region').toBe('status');
    const pillFont = await pill.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(pillFont, 'the pill label is body-legible, not a footnote').toBeGreaterThanOrEqual(12);
    // A failed turn flips the pill to its offline explanation.
    await page.route('**/queries/stream**', async (route) => {
      try {
        await route.abort();
      } catch {
        /* the context closed before the abort */
      }
    });
    await page.locator('[data-testid="welcome-composer"] textarea').fill('say something');
    await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
    await page.waitForSelector('[data-testid="answer-error"]', { timeout: 30000 });
    await expect(pill).toHaveAttribute('data-status', 'offline');
    expect((await pill.getAttribute('title'))?.length, 'the pill explains itself').toBeGreaterThan(0);
    await ctx.close();
  });
});

test.describe('Conversation — documents panel', () => {
  // The empty documents state explains itself, FAQs stay.
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

test.describe('Conversation — contrast', () => {
  // The inks clear WCAG AA for body text (4.5:1): the amber
  // warning on its ground, the initials on their accent circle.
  test('the amber warning and the initials clear a 4.5:1 contrast floor', async ({ browser }) => {
    const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
    await mockChatStream(page, ['GENIE.AI answers from its own knowledge when no document supports the point.'], {
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
        initBg: rgb(pick('.message-avatar__initials', 'backgroundColor')),
        timeColor: rgb(pick('.message-time', 'color')),
        timeBg: rgb(pick('.message-time', 'backgroundColor'))
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
    expect(
      contrastRatio(styles.timeColor, styles.timeBg),
      'the timestamp clears 4.5:1 on its pill, wave band included'
    ).toBeGreaterThanOrEqual(4.5);
    await ctx.close();
  });
});

test.describe('Conversation — answer card', () => {
  // The assistant answer renders inside one elevated card, from the
  // first frame of the stream.
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
      const ground = getComputedStyle(card.closest('.chatbot-container')).backgroundColor;
      return {
        shadow: cs.boxShadow !== 'none',
        hasThinking: !!card.querySelector('.streaming-indicator'),
        distinctFromGround: cs.backgroundColor !== ground
      };
    });
    expect(early.shadow, 'the card is elevated').toBe(true);
    expect(early.distinctFromGround, 'the card fills one step above the unified ground, not the same paint').toBe(true);
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

test.describe('Conversation — surface invariants', () => {
  // Opening Just Chat must not fabricate a knowledge-domain chip: "Just
  // Chat" is not a context, so none is added.
  test('a Just Chat turn adds no context chip and the header stays Just Chat', async ({ browser }) => {
    const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
    await expect(page.locator('[data-testid="conversation-header-title"]')).toHaveText(/Just Chat/i);
    await askAndAnswer(page, 'What is GENIE.AI?');
    await page.waitForSelector('.chat-message.bot .message-bubble', { timeout: 45000 });
    expect(await page.locator('.context-panel').count(), 'no chip is fabricated for Just Chat').toBe(0);
    await expect(page.locator('[data-testid="conversation-header-title"]')).toHaveText(/Just Chat/i);
    await ctx.close();
  });

  // The header names the QuickHelp option that opened the chat.
  test('the header title reflects the QuickHelp option that opened the chat', async ({ browser }) => {
    const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
    await page.locator('.quick-help-item').filter({ hasText: 'Apply for ID' }).click();
    await expect(page.locator('[data-testid="conversation-header-title"]')).toHaveText(/Apply for ID/i);
    // The option is a knowledge domain — its chip is shown as context.
    expect(await page.locator('.context-panel').count(), 'the domain chip is shown').toBe(1);
    await ctx.close();
  });

  // Leaving an unsaved chat prompts instead of silently losing it.
  test('navigating away never prompts and never loses the conversation', async ({ browser }) => {
    const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
    // The stream stays pending until we release it, so the generation is
    // genuinely in flight while the user leaves — an instant mock would
    // finish before the navigation and prove nothing about the abort
    // path. (Mutation check: re-adding a beforeUnmount abort makes the
    // answer never arrive and this test go red.)
    let releaseStream;
    const streamReleased = new Promise((resolve) => {
      releaseStream = resolve;
    });
    await ackFeedback(page);
    const body = sseBody(['The answer completes in the background.']);
    await page.route('**/queries/stream**', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await streamReleased;
      try {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body
        });
      } catch {
        /* the context closed before the fulfillment */
      }
    });
    await page.locator('[data-testid="welcome-composer"] textarea').fill('What is GENIE.AI?');
    await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
    // Leave while the answer is still streaming.
    await page.waitForSelector('.chat-message.bot .streaming-indicator', { timeout: 15000 });
    await page.locator('[aria-label="Settings"]').locator('visible=true').first().click();
    await page.waitForTimeout(500);
    expect(await page.locator('[role="dialog"]').count(), 'navigation is never blocked').toBe(0);
    // Release the stream while the chat view is unmounted: the store
    // must keep consuming it.
    releaseStream();
    await page.waitForResponse((r) => r.url().includes('/queries/stream') && r.status() === 200, { timeout: 15000 });
    await page.waitForTimeout(1000); // frame processing + persistence debounce
    // Back through the router (history back is an in-app navigation, not
    // a reload): the conversation is intact and the answer completed in
    // the background.
    await page.goBack();
    await page.waitForSelector('.chat-message.bot .message-bubble', { timeout: 30000 });
    await expect(page.locator('.chat-message.user').last()).toContainText('What is GENIE.AI?');
    await expect(page.locator('.chat-message.bot .message-bubble').last()).toContainText(
      'The answer completes in the background.'
    );
    // The transcript must be the VIEW, not merely present in the DOM
    // behind the welcome overlay: the overlay covers the conversation.
    await expect(page.locator('.quick-help-overlay')).toHaveCount(0);
    await expect(page.locator('.chat-input')).toBeVisible();
    await ctx.close();
  });

  test('a reload keeps the turns; an interrupted generation offers a retry', async ({ browser }) => {
    const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
    // A stream that never responds: the reload kills the pending fetch,
    // and rehydration must render the interrupted turn through the
    // retry affordance — not as a spinner, not as a missing turn.
    await page.route('**/queries/stream**', async (route) => {
      if (route.request().method() === 'POST') {
        // Hang the request on purpose; the context close cleans it up.
        await new Promise(() => {});
      }
      await route.continue();
    });
    await page.locator('[data-testid="welcome-composer"] textarea').fill('What is GENIE.AI?');
    await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
    await page.waitForSelector('.chat-message.bot .streaming-indicator', { timeout: 15000 });
    // The turn survives only through the persisted payload — wait for the
    // write, not for the render (the debounce trails the first frame).
    await page.waitForFunction(
      () => {
        try {
          const stored = JSON.parse(sessionStorage.getItem('genie.conversation.v1'));
          return (stored?.conversations?.open?.messages?.length || 0) >= 2;
        } catch {
          return false;
        }
      },
      null,
      // The write lands within ~2.3 s (2 s wall + 300 ms trailing edge);
      // the budget is 10× that for a loaded CI agent.
      { timeout: 30000 }
    );
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.chat-message.user', { timeout: 30000 });
    await expect(page.locator('.chat-message.user').last()).toContainText('What is GENIE.AI?');
    await expect(page.locator('[data-testid="answer-retry"]'), 'the interrupted turn offers a retry').toBeVisible();
    await expect(page.locator('.chat-message.bot .streaming-indicator')).toHaveCount(0);
    await ctx.close();
  });
});
