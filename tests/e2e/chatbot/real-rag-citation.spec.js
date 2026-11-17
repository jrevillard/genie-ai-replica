const { test, expect } = require('@playwright/test');
const path = require('path');
const {
  loginViaUI,
  navigateToChatbot,
  LOGIN_BUDGET_TIMEOUT_MS,
  sendMessage,
  waitForBotResponse,
  getLastBotMessage,
  TEST_ADMIN_USER
} = require('../helpers/chatbot');
const { getSessionTokenViaUI, request, SESSION_MINT_TIMEOUT_MS } = require('../helpers/auth');
const {
  uploadFileViaApi,
  triggerIngestViaApi,
  waitForFileIngestedViaApi,
  deleteAllTestDocuments
} = require('../helpers/documents');
const { skipUnlessVenue, ingestChainReady, ingestChainMissingReason } = require('../helpers/venue-profile');

// The fixture whose fact the answer must carry and whose file the sources
// must cite. Both seeds are fixed inputs of this spec (no wall-clock, no
// copy): the token is unique in the repository, the question names the
// fixture's subject, the citation is the uploaded file's own name.
const FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'e2e-rag-citation.md');
const FIXTURE_NAME = 'e2e-rag-citation.md';
const FACT_TOKEN = 'QZK-7319';
const QUESTION = 'What is the maintenance access code for the XR-7 controller?';

// Real dataprep work (ClamAV, chunking, labeling, indexing) and a real RAG
// answer (retrieval, reranking, LLM generation, translation) each wait on a
// possibly loaded shared venue — both waits are bounded, and an expiry is
// the failure, never a tolerance.
const INGEST_BUDGET_MS = 240000;
const ANSWER_BUDGET_MS = 120000;

test.describe('Chatbot — a real answer cites its real source', () => {
  // The venue premise runs FIRST: without a dataprep chain that lands
  // 'Ingested' (proven by the venue profile's own canary), this spec's
  // premise is absent, not broken (#1742). The skip hook is the group's
  // first beforeAll, so the guarded setup after it never runs on a venue
  // without the chain.
  test.beforeAll(async () => {
    // The canary runs a REAL ingest (queue, labeling, embedding) on a
    // shared venue, and it holds until the status lands — its own budget
    // (180 s) must fit inside this hook's clock, or the hook's deadline
    // would cut the verdict off mid-wait.
    test.setTimeout(INGEST_BUDGET_MS + 180000);
    await skipUnlessVenue(test, ingestChainReady, ingestChainMissingReason)();
  });

  test.describe.configure({ timeout: LOGIN_BUDGET_TIMEOUT_MS });

  test.afterAll(async ({ browser }) => {
    // The fixture file is this spec's persisted state: a failing cleanup
    // FAILS, a leftover document stays in the venue's corpus and would
    // answer a later run's question (the sweep is loud, never warned
    // away). The mint + list + delete sweep outlives the 60s hook default.
    test.setTimeout(SESSION_MINT_TIMEOUT_MS);
    await deleteAllTestDocuments('e2e-rag-citation', { browser });
  });

  test('the answer carries the fixture fact and the sources cite the fixture file', async ({ page, browser }) => {
    test.setTimeout(INGEST_BUDGET_MS + ANSWER_BUDGET_MS + 180000);

    // The document surface is ADMIN_ONLY on the document-repository: the
    // upload and the ingest run on the admin's session token, minted
    // through the browser like every login here. The chat turn itself
    // runs on the plain user's page session — the citation surface an
    // ordinary user sees is the one under test.
    const token = await getSessionTokenViaUI({ user: TEST_ADMIN_USER, browser });

    const record = await uploadFileViaApi(request, token, FIXTURE_PATH);
    await triggerIngestViaApi(request, token, record.file_id);
    await waitForFileIngestedViaApi(request, token, record.file_id, { timeoutMs: INGEST_BUDGET_MS });

    await loginViaUI(page);
    await navigateToChatbot(page);

    await sendMessage(page, QUESTION);
    await waitForBotResponse(page, { timeout: ANSWER_BUDGET_MS });

    // The answer is grounded: the unique fact only the fixture carries is
    // IN the answer text.
    const botText = await getLastBotMessage(page);
    expect(botText, 'the answer carries the fact only the fixture holds').toContain(FACT_TOKEN);

    // And the citation: the metadata frame's source cards name the file
    // the chunks came from. The card set is handle-resolved; the filter is
    // the spec's own seed data (the fixture's file name), not design copy.
    await expect(page.locator('[data-testid="answer-sources"]'), 'the metadata frame rode the turn').toBeVisible({
      timeout: 45000
    });
    const cards = page.locator('[data-testid^="answer-source-card-"]');
    await expect(cards.filter({ hasText: FIXTURE_NAME }).first(), 'the sources cite the ingested fixture').toBeVisible({
      timeout: 15000
    });
  });
});
