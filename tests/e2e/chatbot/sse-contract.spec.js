// Story 2.9 — the SSE contract's regression coverage: the extended
// envelope (the five legacy event types + the additive agent_activity /
// agent_verdict frames, helpers/stream-route.js) rendered by the CURRENT
// client. The activity line is landed, so this file now pins
// both halves of the contract: the collapse side of the two original
// degradation tests (the line rides the frames and ends collapsed) and —
// in its own describe — the line's pre-chunk render, its latch, and the
// verdict truth table at answer level, all through the declared handles.
const { test, expect } = require('@playwright/test');
const { withWelcomeSession, DEFAULT_SESSION } = require('../helpers/welcome');
const {
  mockChatStream,
  mockStagedChatStream,
  stagedSend,
  stagedClose,
  sseFrame,
  waitForBotResponse,
  ungroundedWarningOf,
  BOT_BUBBLE,
  LOGIN_BUDGET_TIMEOUT_MS
} = require('../helpers/chatbot');

// The verdict projection payloads mirror the BFF's wire shape
// (services/agent-frame-writer.js, story 2.4): the frame carries
// {type, version: 1, ...projection} — mockChatStream adds the frame keys.
const GROUNDED_VERDICT = { grounding_status: 'grounded', is_grounded: true, translation_mode: 'none' };
const UNGROUNDED_VERDICT = {
  grounding_status: 'ungrounded',
  is_grounded: false,
  translation_mode: 'none',
  marking: { required: true, reason: 'ungrounded' }
};
// One tool-call lifecycle: started before the first chunk, completed
// before the second (the sseBody interleave encoding — entry i rides
// immediately before chunk i).
const ACTIVITY = [
  { status: 'started', operation: 'search_knowledge', callId: 'c1' },
  { status: 'completed', operation: 'search_knowledge', callId: 'c1' }
];
const GROUNDED_METADATA = {
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
};
const NO_ACTIVITY_LINE = (page) => page.locator('[data-testid="agent-activity-line"]');

test.describe.configure({ timeout: LOGIN_BUDGET_TIMEOUT_MS });

test.describe('SSE contract — graceful degradation (story 2.9)', () => {
  // The degradation AC: a client (this app) that consumes the two new
  // types behaves exactly as today — answer, metadata, done all render;
  // the activity line the app now renders for these frames collapses at
  // the turn's first chunk and never re-opens (the client's latch).
  test('an extended stream renders exactly as a legacy one and the activity line ends collapsed', async ({
    browser
  }) => {
    await withWelcomeSession(browser, DEFAULT_SESSION, async (page) => {
      // Two chunks, one lifecycle entry riding before each: the wire shape
      // the BFF writes for a tool call between two text events.
      await mockChatStream(page, ['GENIE.AI answers from the library', ' documents.'], GROUNDED_METADATA, {
        activity: ACTIVITY,
        verdict: GROUNDED_VERDICT
      });
      await page.locator('[data-testid="welcome-composer"] textarea').fill('How do I apply for a national ID?');
      await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
      // The chunk frames processed (the new frames did not swallow them)
      // and the done frame processed (the streaming flag cleared).
      await waitForBotResponse(page, { timeout: 45000 });
      await expect(page.locator(BOT_BUBBLE).last()).toContainText('GENIE.AI answers from the library documents.');
      // The metadata frame processed despite riding after the
      // agent_verdict frame: the sources render.
      await page.waitForSelector('[data-testid="answer-sources"]', { timeout: 45000 });
      const n = await page.evaluate(() => document.querySelectorAll('[data-testid^="answer-source-card-"]').length);
      expect(n, 'sources render as cards').toBeGreaterThan(0);
      // The collapse contract: the line's frames rode before the chunks,
      // so the latch closed it at the first chunk and nothing re-opened
      // it — after done, no handle remains in the DOM.
      await expect(NO_ACTIVITY_LINE(page)).toHaveCount(0);
    });
  });

  // The warning path with the new frames riding: the ungrounded metadata
  // warning renders exactly as the legacy spec asserts it — the verdict
  // frame ahead of it must not have disturbed the path.
  test('the ungrounded warning path is unchanged with the new frames riding', async ({ browser }) => {
    await withWelcomeSession(browser, DEFAULT_SESSION, async (page) => {
      await mockChatStream(
        page,
        ['GENIE.AI answers from its own knowledge', ' when no document supports the point.'],
        { is_grounded: false, confidence_score: 0.78 },
        { activity: ACTIVITY, verdict: UNGROUNDED_VERDICT }
      );
      await page.locator('[data-testid="welcome-composer"] textarea').fill('What is GENIE.AI?');
      await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
      // The warning is itself the signal that the metadata frame has landed.
      await page.waitForSelector('[data-testid="chat-message-bot"] [data-testid="answer-warning"]', {
        timeout: 45000
      });
      const s = await ungroundedWarningOf(page);
      expect(s.warnBg, 'the amber warning paints (the mocked frame ran)').not.toBeNull();
      expect(s.warnBg, 'the warning paints the warning token, not red').toBe(s.token);
      expect(s.sources, 'no empty sources section on an ungrounded answer').toBe(false);
      // The same collapse contract as above: the line rode the frames and
      // ends collapsed while the warning renders.
      await expect(NO_ACTIVITY_LINE(page)).toHaveCount(0);
    });
  });
});

test.describe('SSE contract — the agent activity line', () => {
  const LINE = '[data-testid="agent-activity-line"]';

  // The render windows a single-body mock cannot produce: with the whole
  // body in one read, a frame and its chunk process inside one tick and
  // the line never paints. The staged stream delivers the body in
  // stages, and each stage's rendered assertion gates the next send —
  // no fixed waits anywhere in the staging.
  test('pre-chunk activity renders the line, the first chunk collapses it, and post-chunk frames stay unrendered', async ({
    browser
  }) => {
    await withWelcomeSession(
      browser,
      { ...DEFAULT_SESSION, setupPage: (p) => mockStagedChatStream(p) },
      async (page) => {
        const line = page.locator(LINE);
        await page.locator('[data-testid="welcome-composer"] textarea').fill('How do I apply for a national ID?');
        await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
        // Running: the line replaces the typing indicator, carries the live
        // region attributes and the operation's handle.
        await stagedSend(
          page,
          sseFrame({
            type: 'agent_activity',
            version: 1,
            status: 'started',
            operation: 'search_knowledge',
            callId: 'c1'
          })
        );
        await expect(line).toBeVisible();
        await expect(line).toHaveClass(/agent-activity--running/);
        await expect(line).toHaveAttribute('role', 'status');
        await expect(line).toHaveAttribute('aria-live', 'polite');
        await expect(page.locator('[data-testid="agent-activity-op-search_knowledge"]')).toBeVisible();
        await expect(page.locator('[data-testid="streaming-indicator"]')).toHaveCount(0);
        // Completed stays pre-chunk, quiet.
        await stagedSend(
          page,
          sseFrame({
            type: 'agent_activity',
            version: 1,
            status: 'completed',
            operation: 'search_knowledge',
            callId: 'c1'
          })
        );
        await expect(line).toHaveClass(/agent-activity--completed/);
        // A failed op replaces the completed one — and the next started
        // replaces the failed chip (the matrix's replace rule).
        await stagedSend(
          page,
          sseFrame({ type: 'agent_activity', version: 1, status: 'failed', operation: 'read_source', callId: 'c2' })
        );
        await expect(line).toHaveClass(/agent-activity--failed/);
        await expect(page.locator('[data-testid="agent-activity-op-read_source"]')).toBeVisible();
        await expect(page.locator('[data-testid="agent-activity-op-search_knowledge"]')).toHaveCount(0);
        await stagedSend(
          page,
          sseFrame({ type: 'agent_activity', version: 1, status: 'started', operation: 'read_source', callId: 'c3' })
        );
        await expect(line).toHaveClass(/agent-activity--running/);
        // The first chunk collapses the line for the rest of the turn.
        await stagedSend(page, sseFrame({ type: 'chunk', content: 'GENIE.AI answers from the library' }));
        await expect(line).toHaveCount(0);
        // A post-chunk frame: accepted (the turn keeps streaming, no error)
        // and never rendered.
        await stagedSend(
          page,
          sseFrame({ type: 'agent_activity', version: 1, status: 'completed', operation: 'read_source', callId: 'c3' })
        );
        await expect(line).toHaveCount(0);
        await stagedSend(page, sseFrame({ type: 'chunk', content: ' documents.' }));
        await stagedSend(
          page,
          sseFrame({
            type: 'metadata',
            confidence_score: 0.9,
            is_grounded: true,
            grounding_status: 'grounded',
            source_documents: []
          })
        );
        await stagedSend(page, sseFrame({ type: 'done', queryId: 'mock-query-1' }));
        await stagedClose(page);
        await waitForBotResponse(page, { timeout: 45000 });
        await expect(page.locator(BOT_BUBBLE).last()).toContainText('GENIE.AI answers from the library documents.');
        // The turn's end (and its reset) leaves no line behind.
        await expect(line).toHaveCount(0);
      }
    );
  });

  // The verdict truth table at answer level, over single-body mocks (the
  // verdict and metadata frames land whole; the render they drive is the
  // end state). The metadata frames mirror the BFF's assembled agent
  // metadata: grounding_status + is_grounded + translation_mode.
  const GROUNDED_METADATA_CARRYING = {
    confidence_score: 0.82,
    is_grounded: true,
    grounding_status: 'grounded',
    translation_mode: 'none',
    source_documents: GROUNDED_METADATA.source_documents
  };

  test('grounded with no translation: neither warning, note nor caption', async ({ browser }) => {
    await withWelcomeSession(browser, DEFAULT_SESSION, async (page) => {
      await mockChatStream(page, ['GENIE.AI answers from the library documents.'], GROUNDED_METADATA_CARRYING, {
        verdict: GROUNDED_VERDICT
      });
      await page.locator('[data-testid="welcome-composer"] textarea').fill('How do I apply for a national ID?');
      await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
      await waitForBotResponse(page, { timeout: 45000 });
      await expect(page.locator('[data-testid="answer-warning"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="answer-verification-note"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="answer-translation-scope"]')).toHaveCount(0);
    });
  });

  test('grounded with a delivered translation: the scope caption only', async ({ browser }) => {
    await withWelcomeSession(browser, DEFAULT_SESSION, async (page) => {
      await mockChatStream(
        page,
        ['GENIE.AI answers from the library documents.'],
        { ...GROUNDED_METADATA_CARRYING, translation_mode: 'streaming-units' },
        { verdict: { ...GROUNDED_VERDICT, translation_mode: 'streaming-units' } }
      );
      await page.locator('[data-testid="welcome-composer"] textarea').fill('How do I apply for a national ID?');
      await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
      await waitForBotResponse(page, { timeout: 45000 });
      await expect(page.locator('[data-testid="answer-warning"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="answer-verification-note"]')).toHaveCount(0);
      const caption = page.locator('[data-testid="answer-translation-scope"]');
      await expect(caption).toBeVisible();
      // The caption names the scope — it is a note, not a warning.
      await expect(caption).toHaveAttribute('role', 'note');
    });
  });

  test('unverified renders the neutral note and NEVER the ungrounded warning', async ({ browser }) => {
    await withWelcomeSession(browser, DEFAULT_SESSION, async (page) => {
      // The agent metadata assembly derives is_grounded FALSE for an
      // unverified run — the exact case that must not read as ungrounded.
      await mockChatStream(page, ['GENIE.AI answers, but verification could not run.'], {
        confidence_score: 0.6,
        is_grounded: false,
        grounding_status: 'unverified',
        source_documents: []
      });
      await page.locator('[data-testid="welcome-composer"] textarea').fill('What is GENIE.AI?');
      await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
      // The note is itself the signal that the metadata frame has landed.
      await page.waitForSelector('[data-testid="chat-message-bot"] [data-testid="answer-verification-note"]', {
        timeout: 45000
      });
      const note = page.locator('[data-testid="answer-verification-note"]');
      await expect(note).toHaveAttribute('role', 'note');
      await expect(page.locator('[data-testid="answer-warning"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="answer-translation-scope"]')).toHaveCount(0);
    });
  });
});
