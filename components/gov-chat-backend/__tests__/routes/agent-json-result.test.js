'use strict';

// The non-streaming JSON path's I/O matrix as executable
// checks. AGENT_ENABLED=1 is set BEFORE any module loads (the routing helper
// reads it once at module load), so every test here exercises the AGENTIC
// branch of POST /api/queries through the REAL endpoint: the route wiring,
// the REAL createQuery agentic branch, the REAL seam consumer
// (runAgentJsonTurn) and the ONE persist/analytics tail — with the query
// service's DB collections injected as mocks and axios (the /v1/runs leg)
// scripted per test. The legacy suite (query-routes.test.js, flag off) pins
// the byte-identical legacy path; the streaming suite
// (agent-frame-writer.test.js) pins the other entry of the same contract.

require('../setup-env');
const { EXECUTION_VERSIONS } = require('../fixtures/agent-run-attribution');

process.env.AGENT_ENABLED = '1';
delete process.env.AGENT_SERVICE_URL;
delete process.env.STREAMING_TRANSLATION_ENABLED;

const { Readable } = require('stream');
const translationService = require('../../services/translation-service');
const { createWholeAnswerTranslator } = require('../../services/translation/agentic-translation-leg');

// Mock shared-lib — virtual because it only exists after Docker packaging
jest.mock('../../shared-lib', () => require('../mocks/shared-lib'), { virtual: true });
jest.mock('../../shared-lib/validation-utils', () => require('../mocks/shared-lib'), { virtual: true });

jest.mock('../../services/keycloak-auth-service', () => ({
  verifyToken: jest.fn(),
  checkUserStatusInKeycloak: jest.fn()
}));

jest.mock('../../services/user-provisioning-service', () => ({
  provisionUser: jest.fn(),
  initialize: jest.fn(),
  markUserAsDeleted: jest.fn()
}));

// The query service is REAL here — the subject of this suite is the
// createQuery agentic branch. Only its DB touchpoints are injected as mocks
// (collections + analytics) and the network-touching posture resolution is
// spied per test.
jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));

// Mock ALL other services loaded by index.js (even unused ones)
jest.mock('../../services/admin-dashboard-service', () => ({
  getSystemHealth: jest.fn(),
  getDatabaseStats: jest.fn(),
  getLogs: jest.fn(),
  getUserStats: jest.fn(),
  searchLogs: jest.fn(),
  debugYesterdayLogs: jest.fn(),
  backupDatabase: jest.fn(),
  optimizeDatabase: jest.fn(),
  searchUsers: jest.fn(),
  runDiagnostics: jest.fn()
}));
jest.mock('../../services/user-profile-service', () => ({}));
jest.mock('../../services/analytics-service', () => ({}));
jest.mock('../../services/chat-history-service', () => ({}));
jest.mock('../../services/service-category-service', () => ({}));
jest.mock('../../services/database-operations-service', () => ({}));
jest.mock('../../services/weather-service', () => ({}));
jest.mock('../../services/translation-service', () => ({
  translate: jest.fn(),
  translateMarkdown: jest.fn(),
  init: jest.fn(),
  createMarkdownTranslator: jest.fn(),
  resolveLanguagePair: jest.fn()
}));
// The agentic translation leg — the JSON consumer's bound whole-answer
// translator (the leg wired in place of the request-resolved one).
// The leg's own suite pins the leg's internals (including its fail-soft
// never-raises delivery); this suite pins the consumer's contract:
// construction args, outcome plumbing, V05 status persistence.
jest.mock('../../services/translation/agentic-translation-leg', () => ({
  createWholeAnswerTranslator: jest.fn()
}));
jest.mock('../../services/session-service', () => ({
  getUserSessions: jest.fn(),
  endSession: jest.fn(),
  createSession: jest.fn()
}));
jest.mock('../../services/logs-service', () => ({
  getLogsSummary: jest.fn()
}));
jest.mock('../../services/security-scan-service', () => ({
  getLastScanDetails: jest.fn(),
  runSecurityScan: jest.fn()
}));

jest.mock(
  'swagger-jsdoc',
  () => () => ({
    openapi: '3.0.0',
    info: {},
    components: {},
    security: []
  }),
  { virtual: true }
);
jest.mock(
  'swagger-ui-express',
  () => ({
    serve: [],
    setup: () => (req, res, next) => next()
  }),
  { virtual: true }
);

jest.mock('../../middleware/keycloak-auth-middleware', () => ({
  keycloakAuthMiddleware: {
    authenticate: jest.fn((req, res, next) => {
      req.user = { iss_sub: 'http://localhost:8080/realms/genie#user-123', _key: 'user-123' };
      next();
    }),
    requireAdmin: jest.fn((req, res, next) => next())
  }
}));

const originalExit = process.exit;
beforeAll(() => {
  process.exit = jest.fn();
});
afterAll(() => {
  process.exit = originalExit;
  delete process.env.AGENT_ENABLED;
});

const { createApp } = require('../../index');
const request = require('supertest');
const { createValidToken } = require('../fixtures/tokens');

const queryService = require('../../services/query-service');
const axios = require('axios');
const { keycloakAuthMiddleware } = require('../../middleware/keycloak-auth-middleware');
const { _internals, agentHttpAgent, agentHttpsAgent } = require('../../services/agent-run-contract');
const { applyAbstentionOverlay } = require('../../services/agent-json-result');

const validToken = createValidToken();

let app;
beforeAll(() => {
  app = createApp({ services: { queryService } });
});

// ── fixtures (the shared seam fixtures live in __tests__/fixtures/) ─────────

const {
  USAGE_RECORD,
  GROUNDED_VERDICT,
  INSUFFICIENCY_VERDICT,
  INSUFFICIENCY_RESPONSE,
  legacyPosture,
  envelope,
  seamStream,
  dataStream
} = require('../fixtures/agent-seam');

// The JSON suite's own run script: plain text → verdict → terminal, no tool
// call (frame-order pinning is the frame-writer suite's answeredRunStream).
function answeredRunStream({ verdict = GROUNDED_VERDICT, answer = 'Hello world.' } = {}) {
  return seamStream([
    envelope('run_started', { question: 'What is the tax rate?' }, { seq: 0 }),
    envelope('text_message_started', { role: 'assistant' }, { seq: 1 }),
    envelope('text_message_content', { text: answer }, { seq: 2 }),
    envelope('text_message_finished', {}, { seq: 3 }),
    envelope('verdict', verdict, { seq: 4 }),
    envelope('run_finished', { outcome: 'answered' }, { seq: 5 }),
    { usage_record: USAGE_RECORD }
  ]);
}

// ── the service under test: the real singleton with mock DB touchpoints ────

let collections;

// The attribution writes go through the server-side AQL merge (the real
// arangojs aql template binds the patch as the query's second bind
// var); the wholesale tail update stays on the collection mock.
const attributionPatch = (callIndex = 0) => {
  const arg = queryService.db.query.mock.calls[callIndex][0];
  expect(arg.query).toContain('MERGE(doc.metadata.agent_run || {}');
  expect(arg.bindVars.value0).toBe('q1');
  return arg.bindVars.value1;
};
let analytics;

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  keycloakAuthMiddleware.authenticate.mockImplementation((req, res, next) => {
    req.user = { iss_sub: 'http://localhost:8080/realms/genie#user-123', _key: 'user-123' };
    next();
  });
  analytics = { recordQuery: jest.fn().mockResolvedValue(undefined) };
  collections = {
    save: jest.fn().mockResolvedValue({ _key: 'q1' }),
    update: jest.fn().mockResolvedValue({}),
    document: jest.fn().mockResolvedValue({ _key: 'q1', userId: 'user-123', sessionId: 's1', text: 'q' })
  };
  queryService.db = { query: jest.fn() };
  queryService.queries = collections;
  queryService.serviceCategories = {};
  queryService.serviceCategoryTranslations = {};
  queryService.serviceTranslations = {};
  queryService.services = {};
  queryService.initialized = true;
  queryService.setAnalyticsService(analytics);
  jest.spyOn(queryService, 'resolveFanoutPosture').mockResolvedValue(legacyPosture());
  translationService.init.mockResolvedValue(undefined);
  translationService.createMarkdownTranslator.mockImplementation((sourceLang, targetLang) => ({
    translate: jest.fn((content) => translationService.translateMarkdown(content, sourceLang, targetLang))
  }));
});

function authPost(body) {
  return request(app).post('/api/queries').set('Authorization', `Bearer ${validToken}`).send(body);
}

function postQuery(extra = {}) {
  return authPost({
    sessionId: 's1',
    messages: [{ role: 'user', content: 'What is the tax rate?' }],
    ...extra
  });
}

// The BFF-side envelope rows mapped from GROUNDED_VERDICT.citations — the
// legacy variant (no source marker) and the okf-concept variant (marker +
// identity trio), the exact deployed shapes.
const EXPECTED_SOURCE_DOCUMENTS = [
  {
    document_id: 'doc_bee_knowledge',
    document_name: 'doc bee knowledge',
    url: '',
    categoryLabels: [],
    serviceLabels: [],
    score: 0.9
  },
  {
    document_id: 'kenya_tax_rules',
    document_name: 'kenya tax rules',
    url: '',
    categoryLabels: [],
    serviceLabels: [],
    score: 0.8,
    concept_id: 'kenya_tax_rules',
    repo_id: 'r-kenya',
    bundle_version: 3,
    source: 'okf-concept'
  }
];

// ── the I/O matrix ──────────────────────────────────────────────────────────

describe('POST /api/queries — the agentic success contract', () => {
  it("answers 201 with the streaming path's field shapes and completes the doc through the ONE tail", async () => {
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: answeredRunStream() });

    const response = await postQuery();

    expect(response.status).toBe(201);
    // The legacy top-level shape {queryId, response, metadata, responseTime}
    // — toEqual pins the exact key set, so the only additive key ever
    // allowed beside them is translationFailed (asserted by its own test).
    // The agent_run block gains started_at/outcome/finished_at
    // (the completed run-start + outcome write); execution_versions is
    // ABSENT here — this fixture's run_started payload carries none (an
    // older agent service; the block degrades to run_id + started_at).
    expect(response.body).toEqual({
      queryId: 'q1',
      response: 'Hello world.',
      metadata: {
        source_documents: EXPECTED_SOURCE_DOCUMENTS,
        confidence_score: 0,
        is_grounded: true,
        retrieval_confidence_score: null,
        // Verdict-bearing answered run: false = answered, chose not to
        // abstain (V05 §3) — null stays the "no verdict" meaning.
        abstained: false,
        abstention_reason: null,
        // The scope the run applied: this run narrowed on no label, so the
        // doc reads "ran unfiltered" (the empty list the noagent lane
        // records) — not the base's "not recorded" null.
        filter_labels: [],
        grounding_status: 'grounded',
        agent_run: {
          run_id: 'run-abc',
          started_at: expect.any(String),
          usage_record: USAGE_RECORD,
          outcome: 'answered',
          finished_at: expect.any(String)
        }
      },
      responseTime: expect.any(Number)
    });

    // The agent leg carried the derived deadline, the question, the
    // CallerContext (the REAL buildAgentCallerContext over the legacy
    // posture — empty authorization) and the bearer.
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, body, options] = axios.post.mock.calls[0];
    expect(url).toBe('http://agent-service:8010/v1/runs');
    expect(body.deadline_ms).toBe(
      _internals.DEFAULT_UPSTREAM_TIMEOUT_MS - _internals.TRANSLATION_RESERVE_MS - _internals.FINALIZATION_MARGIN_MS
    );
    expect(body.question).toBe('What is the tax rate?');
    expect(body.context).toEqual({
      user_id: 'http://localhost:8080/realms/genie#user-123',
      authorized_graph_names: [],
      authorized_repos: [],
      requested_labels: []
    });
    expect(body.bearer).toBe(`Bearer ${validToken}`);
    expect(options.responseType).toBe('stream');
    expect(options.signal).toBeInstanceOf(AbortSignal);

    // The ONE tail: the same queryId completes the doc with the assembled
    // metadata (the agent_run block rides in, completing the start write)
    // and analytics records it.
    expect(collections.update).toHaveBeenCalledWith(
      'q1',
      expect.objectContaining({
        response: 'Hello world.',
        isAnswered: true,
        metadata: expect.objectContaining({
          grounding_status: 'grounded',
          is_grounded: true,
          agent_run: expect.objectContaining({
            run_id: 'run-abc',
            outcome: 'answered',
            usage_record: USAGE_RECORD
          })
        })
      })
    );
    // An agentic answer cannot name routed graphs (the citation envelope
    // carries no graph_name by contract): the sticky set is left UNTOUCHED —
    // no `okfRoutedGraphs` key on the payload, never a false reset. (The
    // LAST update is the tail; the first is the run-start attribution
    // write.)
    const tailCall = collections.update.mock.calls[collections.update.mock.calls.length - 1];
    expect(tailCall[1]).not.toHaveProperty('okfRoutedGraphs');
    expect(analytics.recordQuery).toHaveBeenCalledTimes(1);
  });

  it('mints the doc BEFORE the run (queryId continuity)', async () => {
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: answeredRunStream() });

    await postQuery();

    // The doc was minted first; the id that completes it is the minted one —
    // both attribution writes included (the run-start write and
    // the tail).
    expect(collections.save).toHaveBeenCalledTimes(1);
    expect(collections.update).toHaveBeenCalledWith('q1', expect.anything());
  });

  it('the run request carries the language: the requested locale, null when none asked', async () => {
    // The preparation module's named-locale hint (beats detection): a
    // translated request names its locale, an English request carries null —
    // the agent always ANSWERS English either way.
    axios.post.mockImplementation(() => Promise.resolve({ status: 200, headers: {}, data: answeredRunStream() }));

    await postQuery({ context: { language: 'FR' } });
    expect(axios.post.mock.calls[0][1].language).toBe('fr');

    await postQuery();
    expect(axios.post.mock.calls[1][1].language).toBeNull();
  });

  it('every turn dials the SAME shared keepAlive agent pair (no per-request allocation)', async () => {
    axios.post.mockImplementation(() => Promise.resolve({ status: 200, headers: {}, data: answeredRunStream() }));

    await postQuery();
    await postQuery();

    const [firstOpts, secondOpts] = axios.post.mock.calls.map((call) => call[2]);
    expect(firstOpts.httpAgent).toBe(secondOpts.httpAgent);
    expect(firstOpts.httpsAgent).toBe(secondOpts.httpsAgent);
    // The instances ARE the contract module's shared pair — both consumers
    // (streaming + JSON) require the same exports, so keepAlive pools in
    // agents nothing ever destroys cannot pile up.
    expect(firstOpts.httpAgent).toBe(agentHttpAgent);
    expect(firstOpts.httpsAgent).toBe(agentHttpsAgent);
  });

  it('a stream ending with a bare SSE comment line completes without a parse error', async () => {
    // The comment sits in the buffer without its newline — the remainder
    // flush drops it (not a `data: ` line) instead of feeding the parser.
    const mockStream = new Readable({ read() {} });
    mockStream.push(`data: ${JSON.stringify(envelope('text_message_content', { text: 'an answer' }, { seq: 0 }))}\n\n`);
    mockStream.push(': keepalive');
    mockStream.push(null);
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: mockStream });

    const response = await postQuery();
    const { logger } = require('../mocks/shared-lib');

    expect(response.status).toBe(201);
    expect(response.body.response).toBe('an answer');
    expect(logger.warn).not.toHaveBeenCalledWith('AgentJsonResult.seam_parse_error', expect.anything());
  });

  it('a test-mode deployment stays deterministic whatever the flag says (mock outranks the agent)', async () => {
    process.env.CONTEXT_OPTION = 'test-mode';
    try {
      const response = await postQuery();

      // The mock branch served: no agent leg, no /v1/runs call.
      expect(axios.post).not.toHaveBeenCalled();
      expect(response.status).toBe(201);
      expect(response.body.response).toContain('mock response');
      expect(collections.update).toHaveBeenCalledWith('q1', expect.objectContaining({ isAnswered: true }));
    } finally {
      delete process.env.CONTEXT_OPTION;
    }
  });

  it('flushes the trailing unterminated seam line before the terminal (the frame-writer remainder idiom)', async () => {
    // The last frame arrives without its closing newline: a usage_record lost
    // to the buffer split would be silent — the remainder goes through the
    // parser at settle, like the streaming terminal does at 'end'.
    const mockStream = new Readable({ read() {} });
    mockStream.push(`data: ${JSON.stringify(envelope('text_message_content', { text: 'an answer' }, { seq: 0 }))}\n\n`);
    mockStream.push(`data: ${JSON.stringify(envelope('run_finished', { outcome: 'answered' }, { seq: 1 }))}\n\n`);
    mockStream.push(`data: ${JSON.stringify({ usage_record: USAGE_RECORD })}`); // NO trailing \n\n
    mockStream.push(null);
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: mockStream });

    const response = await postQuery();

    expect(response.status).toBe(201);
    expect(response.body.metadata.agent_run.usage_record).toEqual(USAGE_RECORD);
  });

  it('a run finishing with zero text events answers 201 with the empty response, doc answered', async () => {
    // Mirrors the streaming contract: lifecycle frames and the terminal
    // usage record without a single text_message_content — an honest empty
    // answer, never an error and never a fabricated text.
    axios.post.mockResolvedValue({
      status: 200,
      headers: {},
      data: seamStream([
        envelope('run_started', { question: 'q' }, { seq: 0 }),
        envelope('run_finished', { outcome: 'answered' }, { seq: 1 }),
        { usage_record: USAGE_RECORD }
      ])
    });

    const response = await postQuery();

    expect(response.status).toBe(201);
    expect(response.body.response).toBe('');
    expect(collections.update).toHaveBeenCalledWith('q1', expect.objectContaining({ response: '', isAnswered: true }));
    // The usage record whose outcome is visible rides the metadata — the
    // empty answer is still a completed, attributed run.
    expect(response.body.metadata.agent_run.usage_record.outcome).toBe('answered');
  });
});

describe('POST /api/queries — the insufficiency outcome (a successful answer type, never an error)', () => {
  it('answers 201 with the INSUFFICIENCY text and the V05 abstention vocabulary', async () => {
    // The agent loop already replaced the drafted answer with the standard
    // message before the text events emit — the BFF aggregates, never
    // substitutes.
    axios.post.mockResolvedValue({
      status: 200,
      headers: {},
      data: answeredRunStream({ verdict: INSUFFICIENCY_VERDICT, answer: INSUFFICIENCY_RESPONSE })
    });

    const response = await postQuery();

    // Success contract: 201, the answer delivered, the doc completed.
    expect(response.status).toBe(201);
    expect(response.body.response).toBe(INSUFFICIENCY_RESPONSE);
    expect(response.body.metadata.abstained).toBe(true);
    // The mechanical reasons, comma-joined (the V05 field is one
    // machine-readable string).
    expect(response.body.metadata.abstention_reason).toBe('degraded_availability,no_successful_retrieval');
    expect(response.body.metadata.grounding_status).toBe('unverified');
    expect(response.body.metadata.is_grounded).toBe(false);
    // The doc is ANSWERED — insufficiency is a completed turn, not a failure.
    expect(collections.update).toHaveBeenCalledWith(
      'q1',
      expect.objectContaining({ isAnswered: true, response: INSUFFICIENCY_RESPONSE })
    );
    expect(analytics.recordQuery).toHaveBeenCalledTimes(1);
  });

  it('a verdict-bearing answered run sets abstained=false (answered, chose not to abstain)', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      headers: {},
      data: answeredRunStream({
        verdict: { ...GROUNDED_VERDICT, insufficient_evidence: { required: false, reasons: [] } }
      })
    });

    const response = await postQuery();

    expect(response.status).toBe(201);
    expect(response.body.metadata.abstained).toBe(false);
    expect(response.body.metadata.abstention_reason).toBeNull();
  });

  it('a run without a verdict leaves abstained=null (decision never reported)', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      headers: {},
      data: seamStream([
        envelope('text_message_content', { text: 'an answer' }, { seq: 0 }),
        envelope('run_finished', { outcome: 'answered' }, { seq: 1 }),
        { usage_record: USAGE_RECORD }
      ])
    });

    const response = await postQuery();

    expect(response.status).toBe(201);
    expect(response.body.metadata.abstained).toBeNull();
    expect(response.body.metadata.abstention_reason).toBeNull();
    expect(response.body.metadata.grounding_status).toBe('unverified');
  });
});

describe('POST /api/queries — genuine failures keep the JSON error contract, the doc stays unanswered', () => {
  it('a mid-run run_error answers 502 AGENT_RUN_ERROR and never completes the doc', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      headers: {},
      data: seamStream([
        envelope('text_message_content', { text: 'partial' }, { seq: 0 }),
        envelope('run_error', { code: 'budget_exhausted', message: 'token budget exhausted' }, { seq: 1 }),
        { usage_record: { ...USAGE_RECORD, outcome: 'budget_exhausted' } }
      ])
    });

    const response = await postQuery();

    expect(response.status).toBe(502);
    expect(response.body).toEqual({ error: 'AGENT_RUN_ERROR', message: 'token budget exhausted' });
    // The doc was minted but never finalized: the ONLY write is the honest
    // outcome patch (the agent's own verdict, verbatim) — no
    // answer, no analytics; the trailing usage record is ignored.
    expect(collections.save).toHaveBeenCalledTimes(1);
    // The ONE write is the server-side outcome patch — the
    // tail update never runs, no analytics.
    expect(collections.update).not.toHaveBeenCalled();
    expect(queryService.db.query).toHaveBeenCalledTimes(1);
    expect(attributionPatch()).toEqual({
      outcome: 'budget_exhausted',
      finished_at: expect.any(String)
    });
    expect(analytics.recordQuery).not.toHaveBeenCalled();
  });

  it('the seam loop stops at run_error — lines after the failure are not parsed', async () => {
    // The frame writer's onSeamEvent guards on the terminal flag; the JSON
    // consumer's loop over one chunk's lines must mirror that guard: once
    // run_error latched the failure, the rest of the chunk (and the
    // remainder flush) is dead input — parsing it would let post-failure
    // frames mutate state the throw never reads, and the two seam consumers
    // would drift apart.
    const { logger } = require('../mocks/shared-lib');
    const runErrorLine = `data: ${JSON.stringify(
      envelope('run_error', { code: 'budget_exhausted', message: 'token budget exhausted' }, { seq: 0 })
    )}\n`;
    axios.post.mockResolvedValue({
      status: 200,
      headers: {},
      // One chunk carries the failure AND a garbage line behind it.
      data: dataStream(`${runErrorLine}data: {broken json\n\n`)
    });

    const response = await postQuery();

    expect(response.status).toBe(502);
    expect(response.body).toEqual({ error: 'AGENT_RUN_ERROR', message: 'token budget exhausted' });
    const parseErrors = logger.warn.mock.calls.filter(([name]) => name === 'AgentJsonResult.seam_parse_error');
    expect(parseErrors).toHaveLength(0);
  });

  it('a saturated lane (429) passes through with the Retry-After hint, the doc unanswered', async () => {
    axios.post.mockResolvedValue({
      status: 429,
      headers: { 'retry-after': '7' },
      data: dataStream('{"error":"admission_refused","message":"lane busy"}')
    });

    const response = await postQuery();

    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toBe('7');
    expect(response.body).toEqual({ error: 'admission_refused', message: 'lane busy' });
    expect(collections.update).not.toHaveBeenCalled();
  });

  it('an unconfigured surface (503) passes the upstream body through verbatim', async () => {
    axios.post.mockResolvedValue({
      status: 503,
      headers: {},
      data: dataStream(
        '{"error":"budget_configuration_missing","message":"missing knobs","missing_knobs":["AGENT_RUN_MAX_STEPS"]}'
      )
    });

    const response = await postQuery();

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: 'budget_configuration_missing',
      message: 'missing knobs',
      missing_knobs: ['AGENT_RUN_MAX_STEPS']
    });
    expect(collections.update).not.toHaveBeenCalled();
  });

  it('a malformed run request (422) passes through — a request problem, not an outage', async () => {
    axios.post.mockResolvedValue({
      status: 422,
      headers: {},
      data: dataStream('{"error":"invalid_run_request","message":"deadline_ms must be positive"}')
    });

    const response = await postQuery();

    expect(response.status).toBe(422);
    expect(response.body).toEqual({ error: 'invalid_run_request', message: 'deadline_ms must be positive' });
    expect(collections.update).not.toHaveBeenCalled();
  });

  it('any other upstream status answers 502 AGENT_SERVICE_UNAVAILABLE', async () => {
    axios.post.mockResolvedValue({ status: 500, headers: {}, data: dataStream('{"message":"kaboom"}') });

    const response = await postQuery();

    expect(response.status).toBe(502);
    expect(response.body.error).toBe('AGENT_SERVICE_UNAVAILABLE');
    expect(response.body.message).toBe('kaboom');
    expect(collections.update).not.toHaveBeenCalled();
  });

  it('a connect failure or timeout answers 504 AGENT_SERVICE_UNAVAILABLE', async () => {
    axios.post.mockRejectedValue(Object.assign(new Error('timeout of 3600000ms exceeded'), { code: 'ECONNABORTED' }));

    const response = await postQuery();

    expect(response.status).toBe(504);
    expect(response.body).toEqual({
      error: 'AGENT_SERVICE_UNAVAILABLE',
      message: 'Agent service unavailable or timed out'
    });
    expect(collections.update).not.toHaveBeenCalled();
  });

  // The wall-clock-abort driver: one chunk trickles in, the deadline fires,
  // the leg is aborted — then `terminate` emits the stream's end-of-life
  // event (a real adapter errors an aborted socket; a destroyed one can
  // report 'close' alone). Returns the answered response.
  async function driveWallClockAbort(terminate) {
    process.env.AGENT_UPSTREAM_TIMEOUT_MS = '40000';
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    try {
      const mockStream = new Readable({ read() {} });
      let capturedSignal = null;
      axios.post.mockImplementation((_url, _body, opts) => {
        capturedSignal = opts.signal;
        return Promise.resolve({ status: 200, headers: {}, data: mockStream });
      });

      const responsePromise = postQuery();
      responsePromise.catch(() => {});
      for (let i = 0; i < 200 && mockStream.listenerCount('data') === 0; i++) {
        await new Promise(setImmediate);
      }
      expect(mockStream.listenerCount('data')).toBeGreaterThan(0);

      mockStream.push(`data: ${JSON.stringify(envelope('text_message_content', { text: 'slow' }, { seq: 0 }))}\n\n`);
      await new Promise(setImmediate);
      jest.advanceTimersByTime(40000);
      expect(capturedSignal.aborted).toBe(true);
      terminate(mockStream);

      return await responsePromise;
    } finally {
      jest.useRealTimers();
      delete process.env.AGENT_UPSTREAM_TIMEOUT_MS;
    }
  }

  it('a stream error after the headers arrived answers 504 too (the wall-clock bound)', async () => {
    const response = await driveWallClockAbort((stream) => stream.emit('error', new Error('aborted')));

    expect(response.status).toBe(504);
    expect(response.body.error).toBe('AGENT_SERVICE_UNAVAILABLE');
    // The ONE honest outcome is the deadline's: the abort's
    // stream teardown reports interrupted, but the deadline fired first and
    // the latch keeps the fact that actually ended the run (the write is
    // the server-side patch — the tail update never runs).
    expect(collections.update).not.toHaveBeenCalled();
    expect(attributionPatch()).toEqual({ outcome: 'timed_out', finished_at: expect.any(String) });
  });

  it('a deadline that fires after the run completed does not discard the answer', async () => {
    // The run reached its terminal (the usage record): the answer is in
    // hand. The wall-clock deadline is CLEARED there — a deadline that fires
    // afterwards would abort a completed run, and the abort's check would
    // turn a complete answer into a 504.
    process.env.AGENT_UPSTREAM_TIMEOUT_MS = '40000';
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    try {
      const mockStream = new Readable({ read() {} });
      let capturedSignal = null;
      axios.post.mockImplementation((_url, _body, opts) => {
        capturedSignal = opts.signal;
        return Promise.resolve({ status: 200, headers: {}, data: mockStream });
      });

      const responsePromise = postQuery();
      responsePromise.catch(() => {});
      for (let i = 0; i < 200 && mockStream.listenerCount('data') === 0; i++) {
        await new Promise(setImmediate);
      }
      mockStream.push(
        `data: ${JSON.stringify(envelope('text_message_content', { text: 'Hello world.' }, { seq: 0 }))}\n\n`
      );
      mockStream.push(`data: ${JSON.stringify(envelope('verdict', GROUNDED_VERDICT, { seq: 1 }))}\n\n`);
      mockStream.push(`data: ${JSON.stringify({ usage_record: USAGE_RECORD })}\n\n`);
      await new Promise(setImmediate);

      // The deadline would fire now — the run is complete, so it was
      // cleared: no abort.
      jest.advanceTimersByTime(40000);
      expect(capturedSignal.aborted).toBe(false);
      mockStream.emit('end');

      const response = await responsePromise;
      expect(response.status).toBe(201);
      expect(response.body.response).toBe('Hello world.');
    } finally {
      jest.useRealTimers();
      delete process.env.AGENT_UPSTREAM_TIMEOUT_MS;
    }
  });

  it('unparsable 429/503/422 bodies degrade to the documented error names, never raw passthrough', async () => {
    const cases = [
      { status: 429, body: '<html>gateway timeout</html>', error: 'admission_refused' },
      { status: 503, body: '<html>service unavailable</html>', error: 'budget_configuration_missing' },
      { status: 422, body: '<html>validation failed</html>', error: 'invalid_run_request' }
    ];
    for (const { status, body, error } of cases) {
      axios.post.mockResolvedValueOnce({ status, headers: {}, data: dataStream(body) });

      const response = await postQuery();

      expect(response.status).toBe(status);
      expect(response.body).toEqual({ error });
      expect(collections.update).not.toHaveBeenCalled();
    }
  });

  it('a trickling 429 body is bounded — the deadline fire settles the refusal read', async () => {
    // The deadline arms BEFORE the status ladder: a non-2xx body that never
    // ends cannot hold the request forever. The fire aborts the leg, the
    // (real adapter's) destroyed stream settles the read, and the refusal
    // answers with the documented fallback body.
    process.env.AGENT_UPSTREAM_TIMEOUT_MS = '40000';
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    try {
      const mockStream = new Readable({ read() {} });
      axios.post.mockResolvedValue({ status: 429, headers: {}, data: mockStream });

      const responsePromise = postQuery();
      responsePromise.catch(() => {});
      for (let i = 0; i < 200 && mockStream.listenerCount('data') === 0; i++) {
        await new Promise(setImmediate);
      }
      expect(mockStream.listenerCount('data')).toBeGreaterThan(0);

      jest.advanceTimersByTime(40000);
      mockStream.emit('close');

      const response = await responsePromise;
      expect(response.status).toBe(429);
      expect(response.body).toEqual({ error: 'admission_refused' });
      // The pin that reddens if the pre-ladder arming is removed: the fire
      // itself is what bounded the read, so its warning must be on record.
      const { logger } = require('../mocks/shared-lib');
      expect(logger.warn).toHaveBeenCalledWith('AgentJsonResult.upstream_deadline_exceeded', expect.anything());
      expect(collections.update).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
      delete process.env.AGENT_UPSTREAM_TIMEOUT_MS;
    }
  });

  it('a wall-clock abort whose stream ends via close alone answers 504 — never a truncated 201', async () => {
    const response = await driveWallClockAbort((stream) => stream.emit('close'));

    expect(response.status).toBe(504);
    expect(response.body).toEqual({
      error: 'AGENT_SERVICE_UNAVAILABLE',
      message: 'Agent service unavailable or timed out'
    });
    // The truncated text never became a complete answer — the doc keeps the
    // deadline's honest outcome only (the server-side patch).
    expect(collections.update).not.toHaveBeenCalled();
    expect(attributionPatch()).toEqual({ outcome: 'timed_out', finished_at: expect.any(String) });
  });

  it('a posture 401 propagates as 401 UNAUTHENTICATED — no run starts', async () => {
    queryService.resolveFanoutPosture.mockRejectedValue(Object.assign(new Error('expired'), { statusCode: 401 }));

    const response = await postQuery();

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('UNAUTHENTICATED');
    expect(axios.post).not.toHaveBeenCalled();
    expect(collections.update).not.toHaveBeenCalled();
  });

  it('a non-401 posture failure fails closed — the run still serves on the empty authorization', async () => {
    queryService.resolveFanoutPosture.mockRejectedValue(new Error('resolver exploded'));
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: answeredRunStream() });

    const response = await postQuery();

    // The run went out with the NULL posture (fail-closed direction) — the
    // REAL buildAgentCallerContext turned it into the empty authorized set.
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][1].context).toEqual({
      user_id: 'http://localhost:8080/realms/genie#user-123',
      authorized_graph_names: [],
      authorized_repos: [],
      requested_labels: []
    });
    expect(response.status).toBe(201);
    // TWO writes — the run-start attribution patch (server-side
    // merge), then the tail update that completes the doc.
    expect(queryService.db.query).toHaveBeenCalledTimes(1);
    expect(attributionPatch()).toEqual({
      run_id: 'run-abc',
      started_at: expect.any(String)
    });
    expect(collections.update).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/queries — whole-answer translation (the agentic translation leg)', () => {
  // The delivery shape the leg module's helper resolves (never raises) —
  // this suite stubs it at the factory boundary.
  const deliveryShape = (overrides = {}) => ({
    text: 'Bonjour le monde.',
    failed: false,
    queryTranslationStatus: 'translated',
    accounting: {
      outcome: 'translated',
      queryTranslationStatus: 'translated',
      configError: null,
      mode: 'full-answer'
    },
    error: null,
    ...overrides
  });
  beforeEach(() => {
    // Default: a translated answer. Individual tests override the shape.
    createWholeAnswerTranslator.mockImplementation(() => jest.fn().mockResolvedValue(deliveryShape()));
  });

  it('translates the whole answer post-run through the leg; no translationFailed key on success', async () => {
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: answeredRunStream() });

    const response = await postQuery({ context: { language: 'FR' } });

    // The bound translator is constructed per request with the TERMINAL
    // usage record (the one place it exists is post-run — what the residual
    // plan reads), the requested language and the request's signal.
    expect(createWholeAnswerTranslator).toHaveBeenCalledWith(
      expect.objectContaining({ runUsage: USAGE_RECORD, targetLanguage: 'fr', signal: expect.anything() })
    );
    const bound = createWholeAnswerTranslator.mock.results[0].value;
    expect(bound).toHaveBeenCalledWith('Hello world.');
    expect(response.status).toBe(201);
    expect(response.body.response).toBe('Bonjour le monde.');
    // Additive-only: the key is ABSENT when translation succeeded.
    expect(response.body).not.toHaveProperty('translationFailed');
    // The delivered text is what the ONE tail persisted.
    expect(collections.update).toHaveBeenCalledWith(
      'q1',
      expect.objectContaining({ response: 'Bonjour le monde.', isAnswered: true })
    );
    // The leg's V05 status lands on the persisted metadata.
    expect(collections.update).toHaveBeenCalledWith(
      'q1',
      expect.objectContaining({ metadata: expect.objectContaining({ query_translation_status: 'translated' }) })
    );
    // The delivery mode and the answer-translation outcome ride the metadata
    // too: this entry has no frames, so the metadata IS the record.
    expect(response.body.metadata.translation_mode).toBe('post-stream');
    expect(response.body.metadata.translation_status).toBe('ok');
    expect(collections.update).toHaveBeenCalledWith(
      'q1',
      expect.objectContaining({
        metadata: expect.objectContaining({ translation_mode: 'post-stream', translation_status: 'ok' })
      })
    );
  });

  it('a failed leg translation is fail-soft: the English answer stands, translationFailed rides additively', async () => {
    createWholeAnswerTranslator.mockImplementation(() =>
      jest.fn().mockResolvedValue(
        deliveryShape({
          text: null,
          failed: true,
          queryTranslationStatus: 'fallback_timeout',
          accounting: {
            outcome: 'failed',
            queryTranslationStatus: 'fallback_timeout',
            configError: null,
            mode: 'full-answer'
          }
        })
      )
    );
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: answeredRunStream() });

    const response = await postQuery({ context: { language: 'FR' } });

    expect(response.status).toBe(201);
    expect(response.body.response).toBe('Hello world.');
    expect(response.body.translationFailed).toBe(true);
    // The outcome is recorded, presence-keyed: 'failed' — a translation was
    // attempted and failed.
    expect(response.body.metadata.translation_status).toBe('failed');
    // No delivery, no mode.
    expect(response.body.metadata).not.toHaveProperty('translation_mode');
    expect(collections.update).toHaveBeenCalledWith(
      'q1',
      expect.objectContaining({
        response: 'Hello world.',
        metadata: expect.objectContaining({ query_translation_status: 'fallback_timeout' })
      })
    );
  });

  it('a skipped translation (a missing knob) keeps the English answer, never latched', async () => {
    // Fail-closed on the REQUIRED knobs: the answer translation cannot be
    // bounded, so it never starts — the English answer stays and the skip is
    // not a failure (V05).
    createWholeAnswerTranslator.mockImplementation(() =>
      jest.fn().mockResolvedValue(
        deliveryShape({
          text: null,
          failed: false,
          queryTranslationStatus: 'passthrough_english',
          accounting: {
            outcome: 'skipped',
            queryTranslationStatus: 'passthrough_english',
            configError: 'AGENT_TRANSLATION_MAX_TOKENS',
            mode: 'full-answer'
          }
        })
      )
    );
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: answeredRunStream() });

    const response = await postQuery({ context: { language: 'FR' } });

    expect(response.status).toBe(201);
    expect(response.body.response).toBe('Hello world.');
    expect(response.body).not.toHaveProperty('translationFailed');
    // A skip is not a failure and no translation was delivered: the outcome
    // stays ABSENT (the presence-keyed rule).
    expect(response.body.metadata).not.toHaveProperty('translation_status');
    expect(response.body.metadata).not.toHaveProperty('translation_mode');
    expect(collections.update).toHaveBeenCalledWith(
      'q1',
      expect.objectContaining({
        metadata: expect.objectContaining({ query_translation_status: 'passthrough_english' })
      })
    );
  });

  it('no translation is asked for: the leg is never built, the answer rides as-is', async () => {
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: answeredRunStream() });

    const response = await postQuery({ context: { language: 'auto' } });

    expect(createWholeAnswerTranslator).not.toHaveBeenCalled();
    expect(response.status).toBe(201);
    expect(response.body.response).toBe('Hello world.');
    expect(response.body).not.toHaveProperty('translationFailed');
    // No translation was asked for: the outcome stays ABSENT.
    expect(response.body.metadata).not.toHaveProperty('translation_status');
    expect(response.body.metadata).not.toHaveProperty('translation_mode');
    expect(collections.update).toHaveBeenCalledWith(
      'q1',
      expect.objectContaining({
        metadata: expect.not.objectContaining({ query_translation_status: expect.anything() })
      })
    );
  });

  it('the route builds no request-resolved translator for the JSON entry (the leg owns it)', async () => {
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: answeredRunStream() });

    await postQuery({ context: { language: 'FR' } });

    // The language CHECK still runs (an unsupported language is refused) —
    // but no markdown translator is prepared: nothing on this entry consumes
    // one anymore.
    expect(translationService.init).toHaveBeenCalled();
    expect(translationService.createMarkdownTranslator).not.toHaveBeenCalled();
  });
});

describe('applyAbstentionOverlay — the V05 mapping pinned directly (a later streaming story reuses it)', () => {
  const base = () => ({
    source_documents: [],
    confidence_score: 0,
    is_grounded: false,
    retrieval_confidence_score: null,
    abstained: null,
    abstention_reason: null,
    filter_labels: null
  });

  it('no verdict: the overlay does not run — abstained stays null', () => {
    const metadata = applyAbstentionOverlay(base(), null);
    expect(metadata.abstained).toBeNull();
    expect(metadata.abstention_reason).toBeNull();
  });

  it('required=true: abstained=true with the mechanical reasons joined', () => {
    const metadata = applyAbstentionOverlay(base(), {
      insufficient_evidence: { required: true, reasons: ['degraded_availability'] }
    });
    expect(metadata.abstained).toBe(true);
    expect(metadata.abstention_reason).toBe('degraded_availability');
  });

  it('required=true with an empty reasons list: the reason stays null (nothing invented)', () => {
    const metadata = applyAbstentionOverlay(base(), {
      insufficient_evidence: { required: true, reasons: [] }
    });
    expect(metadata.abstained).toBe(true);
    expect(metadata.abstention_reason).toBeNull();
  });

  it('required=false: abstained=false, no reason', () => {
    const metadata = applyAbstentionOverlay(base(), {
      insufficient_evidence: { required: false, reasons: [] }
    });
    expect(metadata.abstained).toBe(false);
    expect(metadata.abstention_reason).toBeNull();
  });

  it('a verdict WITHOUT the insufficient_evidence field: no decision — the base nulls stay', () => {
    // "required" absent is not "not required": a missing/malformed decision
    // field is a decision never reported, so the overlay does not run.
    const metadata = applyAbstentionOverlay(base(), { grounding_status: 'unverified' });
    expect(metadata.abstained).toBeNull();
    expect(metadata.abstention_reason).toBeNull();
  });

  it('an insufficient_evidence OBJECT with no boolean required: no decision — the base nulls stay', () => {
    // `{}` reported nothing: mapping it to abstained:false would claim
    // "answered, chose not to abstain" for a never-reported decision.
    const metadata = applyAbstentionOverlay(base(), { insufficient_evidence: {} });
    expect(metadata.abstained).toBeNull();
    expect(metadata.abstention_reason).toBeNull();
  });
});

describe('POST /api/queries — the agentic language refusal (same map, same body)', () => {
  const { UnsupportedLanguageError } = require('../../services/translation/unsupported-language');

  it('refuses a language the deployment cannot serve before anything runs (400, no agent leg)', async () => {
    // The stubbing idiom of query-routes.test.js: the refusal comes from the
    // language map, thrown at the language-PAIR boundary the agentic branch
    // now shares (the check entry resolves the pair, it prepares no
    // translator — the leg owns the translation).
    translationService.resolveLanguagePair.mockImplementation(() => {
      throw new UnsupportedLanguageError('target');
    });

    const response = await postQuery({ context: { language: 'zz' } });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('UNSUPPORTED_LANGUAGE');
    expect(response.body.message).toMatch(/unsupported target language/i);
    // The refusal precedes every side effect: no run, no doc, no completion.
    expect(axios.post).not.toHaveBeenCalled();
    expect(collections.update).not.toHaveBeenCalled();
  });
});

// ── execution attribution on the JSON entry ────────────────────────────────
describe('POST /api/queries — story 2.11, the run-start handshake', () => {
  it('persists the run-start block AT START, and the success metadata completes it with the outcome', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      headers: {},
      data: seamStream([
        envelope('run_started', { question: 'q', execution_versions: EXECUTION_VERSIONS }, { seq: 0 }),
        envelope('text_message_content', { text: 'answer' }, { seq: 1 }),
        envelope('run_finished', { outcome: 'answered' }, { seq: 2 }),
        { usage_record: USAGE_RECORD }
      ])
    });

    const response = await postQuery();

    expect(response.status).toBe(201);
    // AT START: the versions persisted the moment run_started arrived (the
    // server-side merge patch).
    expect(queryService.db.query).toHaveBeenCalledTimes(1);
    expect(attributionPatch()).toEqual({
      run_id: 'run-abc',
      execution_versions: EXECUTION_VERSIONS,
      started_at: expect.any(String)
    });
    // The assembled metadata the tail writes completes the block: the same
    // versions + the answered outcome, never a clobber.
    expect(response.body.metadata.agent_run).toEqual({
      run_id: 'run-abc',
      execution_versions: EXECUTION_VERSIONS,
      started_at: expect.any(String),
      usage_record: USAGE_RECORD,
      outcome: 'answered',
      finished_at: expect.any(String)
    });
  });

  it('the no-credentials invariant: the persisted block and the answered metadata carry ids only', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      headers: {},
      data: seamStream([
        envelope('run_started', { question: 'q', execution_versions: EXECUTION_VERSIONS }, { seq: 0 }),
        envelope('text_message_content', { text: 'answer' }, { seq: 1 }),
        envelope('run_finished', { outcome: 'answered' }, { seq: 2 }),
        { usage_record: USAGE_RECORD }
      ])
    });

    await postQuery();

    const serialized = JSON.stringify(collections.update.mock.calls);
    expect(serialized).not.toMatch(/bearer|authorization|secret|api[_-]?key|password/i);
  });
});
