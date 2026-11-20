const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
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
const {
  skipUnlessVenue,
  ingestChainReady,
  ingestChainMissingReason,
  INGEST_PROBE_BUDGET_MS
} = require('../helpers/venue-profile');

// The fixture whose fact the answer must carry and whose file the sources
// must cite. The FACT is a fixed input of this spec (no wall-clock, no
// copy): the token is unique in the repository and the question names the
// fixture's subject.
//
// The FILE NAME is unique per RUN: the sources are asserted by name, and
// the venue is shared — a leftover from an earlier run (or a concurrent
// one) carries the same name AND the same fact, so a fixed name would let
// the citation be satisfied by a file this run never ingested, and the
// sweep would delete another run's file mid-flight. The seed is the
// fixture's own text, copied out under this run's name (the same rule the
// ingest group uses).
const FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'e2e-rag-citation.md');
const FIXTURE_SEED = 'e2e-rag-citation';
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const FIXTURE_NAME = `${FIXTURE_SEED}-${RUN_ID}.md`;
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
    // The premise's real cost is a browser login (the realm refuses
    // direct grants, so the probe mints through the browser — budgeted at
    // SESSION_MINT_TIMEOUT_MS) PLUS the canary's own ingest wait PLUS the
    // canary's cleanup sweep. The hook runs under the PROJECT's timeout
    // otherwise, and a hook cut mid-probe ERRORS the group instead of
    // skipping it — and the canary's cleanup, which sits AFTER the wait,
    // would never run: the canary would stay in the venue's corpus.
    test.setTimeout(SESSION_MINT_TIMEOUT_MS + INGEST_PROBE_BUDGET_MS + 120000);
    await skipUnlessVenue(test, ingestChainReady, ingestChainMissingReason)();
    // The fixture lands in the LEGACY corpus, but an OKF-enabled venue's
    // chat sessions are CLAIM-scoped: under heads-supersede the legacy
    // GRAPH leg is dropped from the fan-out whenever the user holds OKF
    // claims (live-proven 2026-11-20 — retriever fan-out ran
    // OKF_the-solar-system_v2 legs only), so the LLM never sees the
    // fixture's chunk and the citation cannot fire BY DESIGN. The spec
    // keeps its teeth on OKF-disabled venues (the NVIDIA default, where
    // the legacy competition includes the fixture); on an OKF venue the
    // honest answer is a named skip, not a red that blames retrieval.
    // skipUnlessVenue runs the test when the probe is TRUE, so the probe
    // is the NEGATED okfEnabled: run when the OKF pillar is parked.
    const { okfEnabled } = require('../helpers/venue-profile');
    const chatRetrievalCoversLegacyCorpus = async () => !(await okfEnabled());
    const legacyUnreachableReason = async () =>
      'venue profile: the OKF pillar is ENABLED — chat sessions are claim-scoped to OKF graphs ' +
      '(heads-supersede drops the legacy GRAPH leg), so a legacy-corpus fixture is unreachable ' +
      'by design and the citation cannot fire; the OKF claim-scoped citation path is NOT ' +
      'exercised by this run';
    await skipUnlessVenue(test, chatRetrievalCoversLegacyCorpus, legacyUnreachableReason)();
  });

  test.describe.configure({ timeout: LOGIN_BUDGET_TIMEOUT_MS });

  test.afterAll(async ({ browser }) => {
    // The fixture file is this spec's persisted state: a failing cleanup
    // FAILS, a leftover document stays in the venue's corpus and would
    // answer a later run's question (the sweep is loud, never warned
    // away). The mint + list + delete sweep outlives the 60s hook default.
    test.setTimeout(SESSION_MINT_TIMEOUT_MS);
    await deleteAllTestDocuments(FIXTURE_SEED, { browser });
  });

  test('the answer carries the fixture fact and the sources cite the fixture file', async ({ page, browser }) => {
    // Two mints (the upload's session and the wait's own), the ingest
    // wait, the answer's wait and the page login all compose here.
    test.setTimeout(SESSION_MINT_TIMEOUT_MS + INGEST_BUDGET_MS + ANSWER_BUDGET_MS + 180000);

    // The document surface is ADMIN_ONLY on the document-repository: the
    // upload and the ingest run on the admin's session token, minted
    // through the browser like every login here. The chat turn itself
    // runs on the plain user's page session — the citation surface an
    // ordinary user sees is the one under test.
    const token = await getSessionTokenViaUI({ user: TEST_ADMIN_USER, browser });

    // The upload carries THIS RUN's name: the file is copied out under it
    // (the fixture's own bytes, a fresh name), so the sources are
    // asserted against a file no other run can own. The runner's scratch
    // copy is removed in the finally below — the venue-side document is
    // removed by the group's sweep.
    const uploadPath = `${os.tmpdir()}/${FIXTURE_NAME}`;
    try {
      fs.copyFileSync(FIXTURE_PATH, uploadPath);
      const record = await uploadFileViaApi(request, token, uploadPath);
      await triggerIngestViaApi(request, token, record.file_id);
      // The wait reads the API, and a realm access token lives 300 s: the
      // token the upload carried would be minutes old by the time the
      // ingest lands, and would expire mid-wait. A session minted for the
      // wait answers in its own right.
      const waitToken = await getSessionTokenViaUI({ user: TEST_ADMIN_USER, browser });
      await waitForFileIngestedViaApi(request, waitToken, record.file_id, { timeoutMs: INGEST_BUDGET_MS });

      await loginViaUI(page);
      await navigateToChatbot(page);

      await sendMessage(page, QUESTION);
      await waitForBotResponse(page, { timeout: ANSWER_BUDGET_MS });

      // The answer is grounded: the unique fact only the fixture carries
      // is IN the answer text.
      const botText = await getLastBotMessage(page);
      expect(botText, 'the answer carries the fact only the fixture holds').toContain(FACT_TOKEN);

      // And the citation: the metadata frame's source cards name the file
      // the chunks came from. The card set is handle-resolved; the filter
      // is the spec's own seed data (this run's file name), not design
      // copy.
      await expect(page.locator('[data-testid="answer-sources"]'), 'the metadata frame rode the turn').toBeVisible({
        timeout: 45000
      });
      const cards = page.locator('[data-testid^="answer-source-card-"]');
      await expect(
        cards.filter({ hasText: FIXTURE_NAME }).first(),
        'the sources cite the ingested fixture'
      ).toBeVisible({
        timeout: 15000
      });
    } finally {
      // The runner's own scratch copy of the seed: the venue-side document
      // is removed by the group's sweep, this file is the runner's. A
      // leftover is named, not swallowed.
      try {
        fs.unlinkSync(uploadPath);
      } catch (e) {
        // ENOENT is a file that was never created (the copy failed) — not
        // a leftover. Anything else is a leftover, and it is named.
        if (e.code !== 'ENOENT') console.warn(`the scratch copy ${uploadPath} could not be removed: ${e.message}`);
      }
    }
  });
});
