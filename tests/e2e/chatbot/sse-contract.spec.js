// Story 2.9 — the SSE contract's regression coverage: the extended
// envelope (the five legacy event types + the additive agent_activity /
// agent_verdict frames, helpers/stream-route.js) rendered by the CURRENT
// client. The activity-line UI is story 2.7's deliverable and does not
// exist yet, so the rendered assertions here are the degradation side:
// with the new frames riding, the existing render is exactly as today and
// no activity-line handle ever appears. When 2.7 lands its component,
// its own specs assert the line's appear/disappear and truth table —
// through the same handle this spec pins as absent.
const { test, expect } = require('@playwright/test');
const { withWelcomeSession, DEFAULT_SESSION } = require('../helpers/welcome');
const { mockChatStream, waitForBotResponse, BOT_BUBBLE, LOGIN_BUDGET_TIMEOUT_MS } = require('../helpers/chatbot');

// The verdict projection payloads mirror the BFF's wire shape
// (services/agent-frame-writer.js, story 2.4): the frame carries
// {type, version: 1, ...projection} — mockChatStream adds the frame keys.
const VERDICT_GROUNDED = { grounding_status: 'grounded', is_grounded: true, translation_mode: 'none' };
const VERDICT_UNGROUNDED = {
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
  // The degradation AC: a client (this app) that ignores the two new
  // types behaves exactly as today — answer, metadata, done all render,
  // and nothing else does.
  test('an extended stream renders exactly as a legacy one and no activity line appears', async ({ browser }) => {
    await withWelcomeSession(browser, DEFAULT_SESSION, async (page) => {
      // Two chunks, one lifecycle entry riding before each: the wire shape
      // the BFF writes for a tool call between two text events.
      await mockChatStream(page, ['GENIE.AI answers from the library', ' documents.'], GROUNDED_METADATA, {
        activity: ACTIVITY,
        verdict: VERDICT_GROUNDED
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
      // The degradation proof itself: no activity-line handle in the DOM —
      // the app neither rendered a line nor crashed on the unknown types.
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
        { activity: ACTIVITY, verdict: VERDICT_UNGROUNDED }
      );
      await page.locator('[data-testid="welcome-composer"] textarea').fill('What is GENIE.AI?');
      await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
      // The warning is itself the signal that the metadata frame has landed.
      await page.waitForSelector('[data-testid="chat-message-bot"] [data-testid="answer-warning"]', {
        timeout: 45000
      });
      const s = await page.evaluate(() => {
        const cards = document.querySelectorAll('[data-testid="chat-message-bot"] [data-testid="answer-card"]');
        const card = cards[cards.length - 1];
        const warn = card.querySelector('[data-testid="answer-warning"]');
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
      // Degradation rides the same path: no activity line while the
      // warning renders.
      await expect(NO_ACTIVITY_LINE(page)).toHaveCount(0);
    });
  });
});
