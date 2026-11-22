'use strict';

// Story 2.4b — the non-streaming JSON path's I/O matrix as executable
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

process.env.AGENT_ENABLED = '1';
delete process.env.AGENT_SERVICE_URL;
delete process.env.STREAMING_TRANSLATION_ENABLED;

const { Readable } = require('stream');
const translationService = require('../../services/translation-service');

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
const { _internals } = require('../../services/agent-run-contract');
const { applyAbstentionOverlay } = require('../../services/agent-json-result');

const validToken = createValidToken();

let app;
beforeAll(() => {
  app = createApp({ services: { queryService } });
});

// ── fixtures ────────────────────────────────────────────────────────────────

function legacyPosture() {
  return {
    available: true,
    mode: 'legacy',
    engaged: false,
    warnings: [],
    postureUnknown: false,
    authorizedGraphs: [],
    authz: null,
    stickyGraphs: [],
    legacyGraph: 'GRAPH',
    correlationId: 'cid-1'
  };
}

const USAGE_RECORD = {
  run_id: 'run-abc',
  outcome: 'answered',
  steps: 2,
  model_calls: 2,
  aux_model_calls: 1,
  tool_calls: 1,
  evidence_bytes: 1024,
  prompt_tokens: 90,
  completion_tokens: 30,
  wall_clock_seconds: 4.2,
  error: null
};

const GROUNDED_VERDICT = {
  grounding_status: 'grounded',
  is_grounded: true,
  translation_mode: 'none',
  policy: 'verdict-marked',
  judge: { model: 'judge', score: null },
  citations: [
    { provenance: { file_id: 'doc_bee_knowledge' }, text: 'bees pollinate', score: 0.9 },
    {
      provenance: { source: 'okf-concept', concept_id: 'kenya_tax_rules', repo_id: 'r-kenya', bundle_version: 3 },
      text: 'taxes apply',
      score: 0.8
    }
  ],
  invalid_citations: [],
  insufficient_evidence: { required: false, reasons: [] },
  marking: { required: false, reason: null }
};

// The insufficiency verdict the verification pipeline emits on the
// early-return path: unverified / not grounded, the mechanical decision and
// its reasons riding verbatim (verification.py Verdict.payload()).
const INSUFFICIENCY_VERDICT = {
  grounding_status: 'unverified',
  is_grounded: false,
  translation_mode: 'none',
  policy: 'verdict-marked',
  judge: { ran: false, outcome: 'skipped', verdict: null },
  citations: [],
  invalid_citations: [],
  insufficient_evidence: { required: true, reasons: ['degraded_availability', 'no_successful_retrieval'] },
  findings: [],
  source_documents: [],
  marking: { required: false, reason: null }
};

// verification.py INSUFFICIENCY_RESPONSE — the text the agent loop delivers
// when the ledger requires insufficiency (the BFF never substitutes text).
const INSUFFICIENCY_RESPONSE = 'I could not find supporting evidence in the knowledge base to answer this question.';

function envelope(kind, payload, { seq = 0, call_id = null } = {}) {
  return { run_id: 'run-abc', call_id, seq, kind, payload };
}

function seamStream(frames) {
  const mockStream = new Readable({ read() {} });
  for (const frame of frames) {
    mockStream.push(`data: ${JSON.stringify(frame)}\n\n`);
  }
  mockStream.push(null);
  return mockStream;
}

function dataStream(text) {
  const mockStream = new Readable({ read() {} });
  mockStream.push(text);
  mockStream.push(null);
  return mockStream;
}

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
        filter_labels: null,
        grounding_status: 'grounded',
        agent_run: { run_id: 'run-abc', usage_record: USAGE_RECORD }
      },
      responseTime: expect.any(Number)
    });

    // The agent leg carried the derived deadline, the question, the
    // CallerContext (the REAL buildAgentCallerContext over the legacy
    // posture — empty authorization) and the bearer.
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, body, options] = axios.post.mock.calls[0];
    expect(url).toBe('http://agent-service:8010');
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
    // metadata (the agent_run block rides in) and analytics records it.
    expect(collections.update).toHaveBeenCalledWith(
      'q1',
      expect.objectContaining({
        response: 'Hello world.',
        isAnswered: true,
        metadata: expect.objectContaining({
          grounding_status: 'grounded',
          is_grounded: true,
          agent_run: { run_id: 'run-abc', usage_record: USAGE_RECORD }
        }),
        okfRoutedGraphs: []
      })
    );
    expect(analytics.recordQuery).toHaveBeenCalledTimes(1);
  });

  it('mints the doc BEFORE the run (queryId continuity)', async () => {
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: answeredRunStream() });

    await postQuery();

    // The doc was minted first; the id that completes it is the minted one.
    expect(collections.save).toHaveBeenCalledTimes(1);
    expect(collections.update).toHaveBeenCalledWith('q1', expect.anything());
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
    // The doc was minted but never finalized: no update, no analytics — the
    // trailing usage record is ignored.
    expect(collections.save).toHaveBeenCalledTimes(1);
    expect(collections.update).not.toHaveBeenCalled();
    expect(analytics.recordQuery).not.toHaveBeenCalled();
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

  it('a stream error after the headers arrived answers 504 too (the wall-clock bound)', async () => {
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

      // The stream trickles: one chunk arrives, the leg never ends — the
      // wall-clock bound fires, aborts the leg, and the (real adapter's)
      // stream error ends the turn with the typed 504.
      mockStream.push(`data: ${JSON.stringify(envelope('text_message_content', { text: 'slow' }, { seq: 0 }))}\n\n`);
      await new Promise(setImmediate);
      jest.advanceTimersByTime(40000);
      expect(capturedSignal.aborted).toBe(true);
      mockStream.emit('error', new Error('aborted'));

      const response = await responsePromise;
      expect(response.status).toBe(504);
      expect(response.body.error).toBe('AGENT_SERVICE_UNAVAILABLE');
      expect(collections.update).not.toHaveBeenCalled();
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

  it('a wall-clock abort whose stream ends via close alone answers 504 — never a truncated 201', async () => {
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

      // The stream trickles, the wall-clock bound fires and aborts the leg —
      // and the destroyed stream reports 'close' WITHOUT an 'error' event.
      mockStream.push(
        `data: ${JSON.stringify(envelope('text_message_content', { text: 'truncated' }, { seq: 0 }))}\n\n`
      );
      await new Promise(setImmediate);
      jest.advanceTimersByTime(40000);
      expect(capturedSignal.aborted).toBe(true);
      mockStream.emit('close');

      const response = await responsePromise;
      expect(response.status).toBe(504);
      expect(response.body).toEqual({
        error: 'AGENT_SERVICE_UNAVAILABLE',
        message: 'Agent service unavailable or timed out'
      });
      // The truncated text never became a complete answer.
      expect(collections.update).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
      delete process.env.AGENT_UPSTREAM_TIMEOUT_MS;
    }
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
    expect(collections.update).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/queries — whole-answer translation (the handleStreamDone non-relay semantics)', () => {
  it('translates the whole answer post-run; no translationFailed key on success', async () => {
    translationService.translateMarkdown.mockResolvedValue('Bonjour le monde.');
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: answeredRunStream() });

    const response = await postQuery({ context: { language: 'FR' } });

    // The route resolved a translator (the request-resolved one the tail of
    // the resolution hands to createQuery).
    expect(translationService.createMarkdownTranslator).toHaveBeenCalledWith('en', 'fr');
    expect(response.status).toBe(201);
    expect(response.body.response).toBe('Bonjour le monde.');
    // Additive-only: the key is ABSENT when translation succeeded.
    expect(response.body).not.toHaveProperty('translationFailed');
    // The delivered text is what the ONE tail persisted.
    expect(collections.update).toHaveBeenCalledWith(
      'q1',
      expect.objectContaining({ response: 'Bonjour le monde.', isAnswered: true })
    );
  });

  it('a failed translation is fail-soft: the English answer stands, translationFailed rides additively', async () => {
    translationService.translateMarkdown.mockRejectedValue(new Error('translator down'));
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: answeredRunStream() });

    const response = await postQuery({ context: { language: 'FR' } });

    expect(response.status).toBe(201);
    expect(response.body.response).toBe('Hello world.');
    expect(response.body.translationFailed).toBe(true);
    expect(collections.update).toHaveBeenCalledWith(
      'q1',
      expect.objectContaining({ response: 'Hello world.', isAnswered: true })
    );
  });

  it('a translator that could not be prepared does not refuse the request — English stands, latched', async () => {
    // init rejects with a NON-unsupported-language error: the check could not
    // run, so the request goes through and the failure is reported on the
    // latch — the same direction the streaming path takes.
    translationService.init.mockRejectedValue(new Error('Translation service is not ready'));
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: answeredRunStream() });

    const response = await postQuery({ context: { language: 'FR' } });

    expect(response.status).toBe(201);
    expect(response.body.response).toBe('Hello world.');
    expect(response.body.translationFailed).toBe(true);
  });

  it('no translation is asked for: no translator is built, the answer rides as-is', async () => {
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: answeredRunStream() });

    const response = await postQuery({ context: { language: 'auto' } });

    expect(translationService.createMarkdownTranslator).not.toHaveBeenCalled();
    expect(response.status).toBe(201);
    expect(response.body.response).toBe('Hello world.');
    expect(response.body).not.toHaveProperty('translationFailed');
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
});

describe('POST /api/queries — the agentic language refusal (same map, same body)', () => {
  const { UnsupportedLanguageError } = require('../../services/translation/unsupported-language');

  it('refuses a language the deployment cannot serve before anything runs (400, no agent leg)', async () => {
    // The stubbing idiom of query-routes.test.js: the refusal comes from the
    // language map, thrown at the translator-resolution boundary the agentic
    // branch now shares.
    translationService.createMarkdownTranslator.mockImplementation(() => {
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
