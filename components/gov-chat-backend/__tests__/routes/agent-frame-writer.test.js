'use strict';

// Story 2.4 — the BFF frame writer: the I/O matrix as executable checks,
// following the query-routes.test.js mocking pattern. AGENT_ENABLED=1 is set
// BEFORE the app module loads (the routing helper reads it once at module
// load), so every test here exercises the AGENTIC branch of
// POST /api/queries/stream; the legacy suite (query-routes.test.js, flag
// off) pins the byte-identical legacy path.

require('../setup-env');
const { EXECUTION_VERSIONS } = require('../fixtures/agent-run-attribution');

process.env.AGENT_ENABLED = '1';
process.env.OPEA_STREAMING = 'true';
process.env.CHATQNA_STREAM_TIMEOUT = '5000';
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

// The TARGET service — the frame writer consumes the posture resolution,
// the CallerContext builder, pickUserText and finalize through it.
jest.mock('../../services/query-service', () => ({
  initStreamQuery: jest.fn(),
  finalizeStreamQuery: jest.fn(),
  // Story 2.11 — the run-start handshake + the honest-outcome patch.
  persistAgentRunStart: jest.fn(),
  persistAgentRunOutcome: jest.fn(),
  parseChatQnASSELine: jest.fn(),
  resolveFanoutPosture: jest.fn(),
  buildAgentCallerContext: jest.fn(),
  pickUserText: jest.fn(),
  createQuery: jest.fn(),
  getQuery: jest.fn(),
  addFeedback: jest.fn(),
  markQueryAsAnswered: jest.fn(),
  updateQueryResponseTime: jest.fn(),
  searchQueries: jest.fn(),
  getConversationsForQuery: jest.fn(),
  createConversationFromQuery: jest.fn(),
  linkQueryToMessage: jest.fn()
}));

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
// The agentic translation leg — the post-stream whole-answer translator on
// the non-relay terminal. The leg's own suite pins the leg's internals; this
// suite pins the frame writer's contract (construction args, outcome
// plumbing, the delivery frame + the persisted status).
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
const { proxyAgentRun, _internals } = require('../../services/agent-frame-writer');

const validToken = createValidToken();

let app;
beforeAll(() => {
  app = createApp({ services: { queryService } });
});

afterEach(() => {
  // The timeout tests set the knob inline; one cleanup owns the removal so a
  // test that forgets the tail delete cannot leak it into its neighbors.
  delete process.env.AGENT_UPSTREAM_TIMEOUT_MS;
});

beforeEach(() => {
  jest.clearAllMocks();
  // The bound translator stub (a SKIP by default — the fail-closed shape):
  // every non-relay translated request builds one at the terminal, so the
  // suite owns a sane default; tests that exercise the translate/failed
  // outcomes override it per shape. The delivery shape is the leg module's
  // helper output (never raises) — the leg's own suite pins that layer.
  createWholeAnswerTranslator.mockImplementation(() =>
    jest.fn().mockResolvedValue({
      text: null,
      failed: false,
      queryTranslationStatus: 'passthrough_english',
      accounting: {
        outcome: 'skipped',
        queryTranslationStatus: 'passthrough_english',
        configError: 'AGENT_TRANSLATION_MAX_TOKENS',
        mode: 'full-answer'
      },
      error: null
    })
  );
  keycloakAuthMiddleware.authenticate.mockImplementation((req, res, next) => {
    req.user = { iss_sub: 'http://localhost:8080/realms/genie#user-123', _key: 'user-123' };
    next();
  });
  translationService.createMarkdownTranslator.mockImplementation((sourceLang, targetLang) => ({
    translate: jest.fn((content) => translationService.translateMarkdown(content, sourceLang, targetLang))
  }));
  queryService.pickUserText.mockImplementation((messages, explicit) => {
    if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
    const msgs = Array.isArray(messages) ? messages : [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i]?.role === 'user' && typeof msgs[i]?.content === 'string' && msgs[i].content.trim()) {
        return msgs[i].content.trim();
      }
    }
    return '';
  });
  queryService.resolveFanoutPosture.mockResolvedValue(legacyPosture());
  queryService.buildAgentCallerContext.mockImplementation((queryData, posture) => ({
    user_id: queryData?.userId ?? '',
    authorized_graph_names: posture?.available ? ['GRAPH'] : [],
    authorized_repos: [],
    requested_labels: []
  }));
  process.env.OPEA_STREAMING = 'true';
  delete process.env.STREAMING_TRANSLATION_ENABLED;
});

function authPost(path, body) {
  return request(app).post(path).set('Authorization', `Bearer ${validToken}`).send(body);
}

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

const UNGROUNDED_VERDICT = {
  ...GROUNDED_VERDICT,
  grounding_status: 'ungrounded',
  is_grounded: false,
  marking: { required: true, reason: 'ungrounded' }
};

// The answered-run seam script: a tool call between two text events, then the
// verdict, the run terminal and the usage record.
function answeredRunStream({ verdict = GROUNDED_VERDICT } = {}) {
  return seamStream([
    envelope('run_started', { question: 'What is the tax rate?' }, { seq: 0 }),
    envelope('tool_call_started', { name: 'search_knowledge', arguments: { query: 'tax' } }, { seq: 1, call_id: 'c1' }),
    envelope('text_message_started', { role: 'assistant' }, { seq: 2 }),
    envelope('text_message_content', { text: 'Hello ' }, { seq: 3 }),
    envelope('tool_call_finished', { result: { hits: [] } }, { seq: 4, call_id: 'c1' }),
    envelope('text_message_content', { text: 'world.' }, { seq: 5 }),
    envelope('text_message_finished', {}, { seq: 6 }),
    envelope('verdict', verdict, { seq: 7 }),
    envelope('run_finished', { outcome: 'answered' }, { seq: 8 }),
    { usage_record: USAGE_RECORD }
  ]);
}

function setupAgentQuery(extra = {}) {
  queryService.initStreamQuery.mockResolvedValue({
    queryId: 'q1',
    opeaUrl: 'http://chatqna:8888/v1/chatqna',
    opeaPayload: { messages: [] },
    authHeaders: { authorization: `Bearer ${validToken}` },
    queryData: { userId: 'user-123', sessionId: 's1', messages: [], ...extra }
  });
  queryService.finalizeStreamQuery.mockResolvedValue(undefined);
}

function parseSSEEvents(text) {
  return text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)));
}

const flush = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

// ── the I/O matrix ──────────────────────────────────────────────────────────

describe('POST /api/queries/stream — the agentic happy path (frame order)', () => {
  it('writes every client frame itself in the pinned order, done last', async () => {
    setupAgentQuery();
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: answeredRunStream() });

    const response = await authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'What is the tax rate?' }]
    });

    expect(response.status).toBe(200);
    const frames = parseSSEEvents(response.text);
    // Pinned positions: agent_activity interleaves with the chunks,
    // agent_verdict after the last chunk and before metadata, done always
    // last — and the five legacy types keep their dialect.
    expect(frames.map((f) => f.type)).toEqual([
      'agent_activity',
      'chunk',
      'agent_activity',
      'chunk',
      'agent_verdict',
      'metadata',
      'done'
    ]);

    const [activityStarted, chunkA, activityCompleted, chunkB, verdictFrame, metadata, done] = frames;
    expect(activityStarted).toEqual({
      type: 'agent_activity',
      version: 1,
      status: 'started',
      operation: 'search_knowledge',
      callId: 'c1'
    });
    expect(activityCompleted).toEqual({
      type: 'agent_activity',
      version: 1,
      status: 'completed',
      operation: 'search_knowledge',
      callId: 'c1'
    });
    expect(chunkA).toEqual({ type: 'chunk', content: 'Hello ' });
    expect(chunkB).toEqual({ type: 'chunk', content: 'world.' });
    // The verdict frame carries the projection payload verbatim + the version.
    expect(verdictFrame).toEqual({ type: 'agent_verdict', version: 1, ...GROUNDED_VERDICT });

    // The metadata frame keeps the legacy shape; grounding + agent_run ride
    // additively, the citations are mapped into the deployed envelope rows.
    expect(metadata.type).toBe('metadata');
    expect(metadata.grounding_status).toBe('grounded');
    expect(metadata.is_grounded).toBe(true);
    expect(metadata.source_documents).toEqual([
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
    ]);
    // Story 2.11: the assembled block carries the run-start handshake
    // (started_at) and the honest outcome (answered + finished_at) —
    // execution_versions is absent, this fixture's run_started payload
    // carries none (an older agent service; the block degrades).
    expect(metadata.agent_run).toEqual({
      run_id: 'run-abc',
      started_at: expect.any(String),
      usage_record: USAGE_RECORD,
      outcome: 'answered',
      finished_at: expect.any(String)
    });
    expect(metadata.responseTime).toEqual(expect.any(Number));
    // The legacy fallback keys stay (the empty-stream base) — with ONE
    // deliberate override: an agentic turn is an ANSWER in the legacy
    // abstention vocabulary, never the "chatqna never answered" null.
    expect(metadata.abstained).toBe(false);
    expect(metadata.filter_labels).toBeNull();
    // The interrupted marker is a partial-save-only field: a normal
    // completion never carries it (ADR agentic-003).
    expect(metadata.answer_interrupted).toBeUndefined();

    expect(done).toEqual({ type: 'done', queryId: 'q1', translationFailed: false });

    // The same metadata is persisted — the agent_run block rides into the
    // queries doc (the version-record persistence of this story).
    expect(queryService.finalizeStreamQuery).toHaveBeenCalledWith(
      'q1',
      'Hello world.',
      expect.any(Number),
      expect.objectContaining({ grounding_status: 'grounded', is_grounded: true, agent_run: metadata.agent_run }),
      // Story 3.2 merged reality: the agentic finalize carries the
      // branch-driven sticky-set skip as the trailing options argument.
      expect.anything()
    );
  });

  it('POSTs the derived deadline and the assembled CallerContext to /v1/runs', async () => {
    setupAgentQuery();
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: answeredRunStream() });
    delete process.env.AGENT_UPSTREAM_TIMEOUT_MS;

    await authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'What is the tax rate?' }]
    });

    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, body, options] = axios.post.mock.calls[0];
    expect(url).toBe('http://agent-service:8010');
    // deadline_ms = AGENT_UPSTREAM_TIMEOUT_MS − translation reserve −
    // finalization reserve (the pair rule holds by construction) — asserted
    // as the explicit arithmetic on the shipped constants, not by calling
    // the derivation under test on itself.
    expect(body.deadline_ms).toBe(
      _internals.DEFAULT_UPSTREAM_TIMEOUT_MS - _internals.TRANSLATION_RESERVE_MS - _internals.FINALIZATION_MARGIN_MS
    );
    expect(body.deadline_ms).toBe(3600000 - 30000 - 5000);
    expect(body.question).toBe('What is the tax rate?');
    expect(body.context).toEqual({
      user_id: 'http://localhost:8080/realms/genie#user-123',
      authorized_graph_names: ['GRAPH'],
      authorized_repos: [],
      requested_labels: []
    });
    expect(body.bearer).toBe(`Bearer ${validToken}`);
    expect(options.responseType).toBe('stream');
    expect(options.signal).toBeInstanceOf(AbortSignal);
    // The pair-rule inputs are operator-visible knobs.
    expect(options.timeout).toBe(_internals.DEFAULT_UPSTREAM_TIMEOUT_MS);
  });

  it('the run request carries the language: the requested locale, null when none asked', async () => {
    setupAgentQuery();
    // A fresh stream per call — one Readable is consumed by one request.
    axios.post.mockImplementation(() => Promise.resolve({ status: 200, headers: {}, data: answeredRunStream() }));

    await authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'What is the tax rate?' }],
      context: { language: 'FR' }
    });
    expect(axios.post.mock.calls[0][1].language).toBe('fr');

    await authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'What is the tax rate?' }]
    });
    expect(axios.post.mock.calls[1][1].language).toBeNull();
  });

  it('derives a smaller deadline from a configured timeout and forwards the labels narrowing', async () => {
    setupAgentQuery();
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: answeredRunStream() });
    queryService.resolveFanoutPosture.mockResolvedValue({
      ...legacyPosture(),
      mode: 'okf_only',
      engaged: true,
      authorizedGraphs: ['OKF_a_v1'],
      authz: {
        graph_names: ['OKF_a_v1'],
        repos: [
          { repo_id: 'r-kenya', graph_name: 'OKF_a_v1' },
          { repo_id: 'r-outside', graph_name: 'OKF_not_authorized' }
        ]
      }
    });
    queryService.buildAgentCallerContext.mockImplementation((queryData, posture) => ({
      user_id: queryData?.userId ?? '',
      authorized_graph_names: posture ? ['OKF_a_v1'] : [],
      authorized_repos: [{ repo_id: 'r-kenya', graph_name: 'OKF_a_v1' }],
      requested_labels: ['taxes']
    }));
    process.env.AGENT_UPSTREAM_TIMEOUT_MS = '60000';

    await authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'What is the tax rate?' }],
      context: { serviceLabels: ['taxes'] }
    });

    const [url, body, options] = axios.post.mock.calls[0];
    expect(url).toBe('http://agent-service:8010');
    expect(body.deadline_ms).toBe(60000 - _internals.TRANSLATION_RESERVE_MS - _internals.FINALIZATION_MARGIN_MS);
    // The wire-level timeout is the configured 60000, not a derived value.
    expect(options.timeout).toBe(60000);
    expect(body.context.authorized_graph_names).toEqual(['OKF_a_v1']);
    expect(body.context.authorized_repos).toEqual([{ repo_id: 'r-kenya', graph_name: 'OKF_a_v1' }]);
    expect(body.context.requested_labels).toEqual(['taxes']);
  });

  it('a timeout above the reserves still derives deadline = timeout − reserves', () => {
    // 40000 covers reserves (35000) plus the floor: the pair rule holds.
    expect(_internals.deriveDeadlineMs(40000)).toBe(5000);
    expect(_internals.resolveUpstreamTimeoutMs()).toBe(_internals.DEFAULT_UPSTREAM_TIMEOUT_MS);
  });

  it('an under-sized configuration is absorbed ONCE — every consumer reads the default', () => {
    // 20000 ≤ reserves + floor: deriving deadline = −15000 would break the
    // pair rule. resolveUpstreamTimeoutMs warns naming the knob and applies
    // the default — and BOTH consumers (the deadline derivation and the
    // wire-level timeout) read that same resolved value.
    const { logger } = require('../mocks/shared-lib');
    process.env.AGENT_UPSTREAM_TIMEOUT_MS = '20000';
    // A fresh module registry: the warn is memoized at module level (once
    // per process), so the assertion owns a fresh flag instead of depending
    // on this test being the file's first under-sized call.
    let fresh;
    jest.isolateModules(() => {
      fresh = require('../../services/agent-run-contract');
    });
    expect(fresh.resolveUpstreamTimeoutMs()).toBe(fresh._internals.DEFAULT_UPSTREAM_TIMEOUT_MS);
    expect(fresh._internals.deriveDeadlineMs(fresh.resolveUpstreamTimeoutMs())).toBe(3600000 - 30000 - 5000);
    expect(logger.warn).toHaveBeenCalledWith(
      'AgentRunContract.upstream_timeout_below_reserves',
      expect.objectContaining({ knob: 'AGENT_UPSTREAM_TIMEOUT_MS', configured: 20000, applied: 3600000 })
    );
  });

  it('the below-reserves warning is memoized — repeated calls log it once, not per call', () => {
    // The misconfiguration is static for the process: one warning names the
    // knob, and a per-request warn flood (once per streaming request and
    // once per JSON turn) never reaches the log pipeline.
    process.env.AGENT_UPSTREAM_TIMEOUT_MS = '20000';
    const { logger } = require('../mocks/shared-lib');
    let freshContract;
    jest.isolateModules(() => {
      // A fresh module registry: the memo flag is module state, so the
      // assertion owns a fresh one instead of depending on test order. The
      // virtual shared-lib mock resolves to the suite's shared logger
      // instance, so the count below reads the fresh module's warnings.
      freshContract = require('../../services/agent-run-contract');
    });
    freshContract.resolveUpstreamTimeoutMs();
    freshContract.resolveUpstreamTimeoutMs();
    freshContract.resolveUpstreamTimeoutMs();
    const warned = logger.warn.mock.calls.filter(
      ([name]) => name === 'AgentRunContract.upstream_timeout_below_reserves'
    ).length;
    expect(warned).toBe(1);
  });

  it('an under-sized configured timeout reads the absorbed default on the wire (deadline AND axios timeout)', async () => {
    setupAgentQuery();
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: answeredRunStream() });
    process.env.AGENT_UPSTREAM_TIMEOUT_MS = '20000';

    await authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'q' }]
    });

    const [url, body, options] = axios.post.mock.calls[0];
    expect(url).toBe('http://agent-service:8010');
    // The deadline the run paces against AND the timeout the BFF aborts with
    // are the SAME absorbed value — the small configuration aborts nothing
    // ahead of the run's own honest ending.
    expect(body.deadline_ms).toBe(3600000 - 30000 - 5000);
    expect(options.timeout).toBe(3600000);
  });
});

describe('POST /api/queries/stream — pre-stream refusals (JSON, before any SSE byte)', () => {
  it('a saturated lane (429) passes through with Retry-After, the doc left unanswered', async () => {
    setupAgentQuery();
    axios.post.mockResolvedValue({
      status: 429,
      headers: { 'retry-after': '7' },
      data: dataStream('{"error":"admission_refused","message":"lane busy"}')
    });

    const response = await authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'hello' }]
    });

    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toBe('7');
    expect(response.body).toEqual({ error: 'admission_refused', message: 'lane busy' });
    expect(response.text).not.toContain('text/event-stream');
    expect(queryService.finalizeStreamQuery).not.toHaveBeenCalled();
  });

  it('unconfigured knobs (503) pass the upstream body through verbatim', async () => {
    setupAgentQuery();
    axios.post.mockResolvedValue({
      status: 503,
      headers: {},
      data: dataStream(
        '{"error":"budget_configuration_missing","message":"missing knobs","missing_knobs":["AGENT_RUN_MAX_STEPS"]}'
      )
    });

    const response = await authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'hello' }]
    });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: 'budget_configuration_missing',
      message: 'missing knobs',
      missing_knobs: ['AGENT_RUN_MAX_STEPS']
    });
    expect(queryService.finalizeStreamQuery).not.toHaveBeenCalled();
  });

  it('an unparseable 429 body still answers the documented error name', async () => {
    setupAgentQuery();
    axios.post.mockResolvedValue({ status: 429, headers: {}, data: dataStream('gateway timeout') });

    const response = await authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'hello' }]
    });

    expect(response.status).toBe(429);
    expect(response.body).toEqual({ error: 'admission_refused' });
  });

  it('a body past the 64 KiB cap is truncated with a warning, the prefix still parsed best-effort', async () => {
    setupAgentQuery();
    // A 503 body whose useful JSON head fits the cap but whose total size
    // breaches it: the read stops buffering, warns once with the status, and
    // the prefix (valid JSON here) still parses.
    const head = JSON.stringify({ error: 'budget_configuration_missing', message: 'x'.repeat(1024) });
    const oversized = head + ' '.repeat(70 * 1024);
    axios.post.mockResolvedValue({ status: 503, headers: {}, data: dataStream(oversized) });

    const response = await authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'hello' }]
    });

    expect(response.status).toBe(503);
    expect(response.body).toEqual(expect.objectContaining({ error: 'budget_configuration_missing' }));
    // The truncation itself is loud: one warning names the status and the
    // size that breached the cap.
    const { logger } = require('../mocks/shared-lib');
    expect(logger.warn).toHaveBeenCalledWith(
      'AgentRunContract.upstream_body_truncated',
      expect.objectContaining({ status: 503, bytes: expect.any(Number) })
    );
  });

  it('a body stream that errors mid-read logs the loss before resolving empty', async () => {
    // A refusal body that died mid-read resolves the same {text, parsed:null}
    // shape as an empty one — without this log, "lane full" and "answer lost
    // in transit" are indistinguishable for an operator debugging a 429.
    const { EventEmitter } = require('stream');
    const { logger } = require('../mocks/shared-lib');
    const { readUpstreamBody } = require('../../services/agent-run-contract');
    const body = new EventEmitter();
    const pending = readUpstreamBody(body, 429);
    body.emit('error', new Error('connection reset mid-body'));

    await expect(pending).resolves.toEqual({ text: '', parsed: null });
    expect(logger.error).toHaveBeenCalledWith(
      'AgentRunContract.upstream_body_stream_error',
      expect.objectContaining({ status: 429, error: 'connection reset mid-body' })
    );
  });

  it('a body whose JSON only exists past the cap degrades to the documented fallback', async () => {
    setupAgentQuery();
    // The cap discards the whole JSON object: the prefix is whitespace, the
    // parse fails, and the client still gets the documented error name —
    // never a raw string body forwarded as JSON.
    const oversized = ' '.repeat(70 * 1024) + JSON.stringify({ error: 'late_object' });
    axios.post.mockResolvedValue({ status: 429, headers: {}, data: dataStream(oversized) });

    const response = await authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'hello' }]
    });

    expect(response.status).toBe(429);
    expect(response.body).toEqual({ error: 'admission_refused' });
  });

  it('a malformed run request (422) surfaces as 422, not as an outage', async () => {
    setupAgentQuery();
    axios.post.mockResolvedValue({
      status: 422,
      headers: {},
      data: dataStream('{"error":"invalid_run_request","message":"deadline_ms must be positive"}')
    });

    const response = await authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'hello' }]
    });

    expect(response.status).toBe(422);
    expect(response.body).toEqual({ error: 'invalid_run_request', message: 'deadline_ms must be positive' });
    expect(queryService.finalizeStreamQuery).not.toHaveBeenCalled();
  });

  it('a non-object 422 body falls back to the documented error name', async () => {
    setupAgentQuery();
    axios.post.mockResolvedValue({ status: 422, headers: {}, data: dataStream('validation failed') });

    const response = await authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'hello' }]
    });

    expect(response.status).toBe(422);
    expect(response.body).toEqual({ error: 'invalid_run_request' });
  });

  it('an unexpected upstream status answers 502 before any SSE byte', async () => {
    setupAgentQuery();
    axios.post.mockResolvedValue({ status: 500, headers: {}, data: dataStream('{"message":"kaboom"}') });

    const response = await authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'hello' }]
    });

    expect(response.status).toBe(502);
    expect(response.body.error).toBe('AGENT_SERVICE_UNAVAILABLE');
    expect(response.body.message).toBe('kaboom');
  });
});

describe('POST /api/queries/stream — the error and verdict contracts', () => {
  it('a run_error mid-stream answers the legacy error contract: error frame then end', async () => {
    setupAgentQuery();
    axios.post.mockResolvedValue({
      status: 200,
      headers: {},
      data: seamStream([
        envelope('run_started', { question: 'q' }, { seq: 0 }),
        envelope('text_message_content', { text: 'partial' }, { seq: 1 }),
        envelope('run_error', { code: 'budget_exhausted', message: 'token budget exhausted' }, { seq: 2 }),
        { usage_record: { ...USAGE_RECORD, outcome: 'budget_exhausted' } }
      ])
    });

    const response = await authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'q' }]
    });

    expect(response.status).toBe(200);
    const frames = parseSSEEvents(response.text);
    expect(frames.map((f) => f.type)).toEqual(['chunk', 'error']);
    expect(frames[1]).toEqual({ type: 'error', message: 'token budget exhausted', code: 'AGENT_RUN_ERROR' });
    // No metadata, no done, nothing fabricated — the doc stays unanswered
    // EXCEPT the honest outcome (story 2.11): the agent's own verdict,
    // verbatim the usage record's outcome, rides the outcome patch.
    expect(queryService.finalizeStreamQuery).not.toHaveBeenCalled();
    expect(queryService.persistAgentRunOutcome).toHaveBeenCalledTimes(1);
    expect(queryService.persistAgentRunOutcome).toHaveBeenCalledWith('q1', 'budget_exhausted');
  });

  it('an answered run without a verdict event reads unverified — never a confident default', async () => {
    setupAgentQuery();
    axios.post.mockResolvedValue({
      status: 200,
      headers: {},
      data: seamStream([
        envelope('run_started', { question: 'q' }, { seq: 0 }),
        envelope('text_message_content', { text: 'an answer' }, { seq: 1 }),
        envelope('run_finished', { outcome: 'answered' }, { seq: 2 }),
        { usage_record: USAGE_RECORD }
      ])
    });

    const response = await authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'q' }]
    });

    const frames = parseSSEEvents(response.text);
    expect(frames.map((f) => f.type)).toEqual(['chunk', 'metadata', 'done']);
    expect(frames.find((f) => f.type === 'metadata').grounding_status).toBe('unverified');
    // CROSS-MODE ABSTENTION PARITY: no verdict → the overlay does not run —
    // the persisted metadata keeps the base null ("decision never reported"),
    // matching the JSON entry exactly.
    expect(frames.find((f) => f.type === 'metadata').abstained).toBeNull();
    expect(queryService.finalizeStreamQuery).toHaveBeenCalledWith(
      'q1',
      'an answer',
      expect.any(Number),
      expect.objectContaining({ abstained: null, abstention_reason: null }),
      expect.anything()
    );
    expect(frames.find((f) => f.type === 'metadata').is_grounded).toBe(false);
    // No verdict frame on the wire either.
    expect(frames.find((f) => f.type === 'agent_verdict')).toBeUndefined();
  });

  it('an ungrounded verdict marks the verdict frame and persists the tri-state metadata', async () => {
    setupAgentQuery();
    axios.post.mockResolvedValue({
      status: 200,
      headers: {},
      data: answeredRunStream({ verdict: UNGROUNDED_VERDICT })
    });

    const response = await authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'q' }]
    });

    const frames = parseSSEEvents(response.text);
    const verdictFrame = frames.find((f) => f.type === 'agent_verdict');
    expect(verdictFrame.marking).toEqual({ required: true, reason: 'ungrounded' });
    const metadata = frames.find((f) => f.type === 'metadata');
    expect(metadata.grounding_status).toBe('ungrounded');
    expect(metadata.is_grounded).toBe(false);
  });

  it('a completed insufficiency run persists the V05 abstention vocabulary (cross-mode parity)', async () => {
    // The same outcome POST /api/queries persists: the verdict-bearing
    // insufficiency terminal derives `abstained: true` + the mechanical
    // reason — the streaming entry can never answer the same run with the
    // JSON entry's abstention shape differing.
    setupAgentQuery();
    // The agent loop delivers the INSUFFICIENCY text (the BFF aggregates,
    // never substitutes).
    axios.post.mockResolvedValue({
      status: 200,
      headers: {},
      data: seamStream([
        envelope('run_started', { question: 'q' }, { seq: 0 }),
        envelope('text_message_content', { text: INSUFFICIENCY_RESPONSE }, { seq: 1 }),
        envelope('verdict', INSUFFICIENCY_VERDICT, { seq: 2 }),
        envelope('run_finished', { outcome: 'answered' }, { seq: 3 }),
        { usage_record: USAGE_RECORD }
      ])
    });

    const response = await authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'q' }]
    });

    // The wire metadata frame AND the persisted doc carry the overlay.
    const metadata = parseSSEEvents(response.text).find((f) => f.type === 'metadata');
    expect(metadata.abstained).toBe(true);
    expect(metadata.abstention_reason).toBe('degraded_availability,no_successful_retrieval');
    expect(metadata.grounding_status).toBe('unverified');
    expect(queryService.finalizeStreamQuery).toHaveBeenCalledWith(
      'q1',
      INSUFFICIENCY_RESPONSE,
      expect.any(Number),
      expect.objectContaining({
        abstained: true,
        abstention_reason: 'degraded_availability,no_successful_retrieval',
        grounding_status: 'unverified',
        is_grounded: false
      }),
      expect.anything()
    );
  });

  it('a payload carrying the service-side source_documents forwards THOSE rows (the service owns the mapping)', async () => {
    setupAgentQuery();
    // The merged agent-service payload names its own envelope rows (built by
    // capabilities/citations.py, shared with the no-agent lane). The BFF
    // forwards them verbatim — it does not re-derive from the raw citations.
    const serviceRows = [
      { document_id: 'svc_row', document_name: 'svc row', url: '', categoryLabels: [], serviceLabels: [], score: 0.5 }
    ];
    const verdict = { ...GROUNDED_VERDICT, source_documents: serviceRows };
    axios.post.mockResolvedValue({
      status: 200,
      headers: {},
      data: answeredRunStream({ verdict })
    });

    const response = await authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'q' }]
    });

    const metadata = parseSSEEvents(response.text).find((f) => f.type === 'metadata');
    expect(metadata.source_documents).toEqual(serviceRows);
  });

  it('a transport error mid-stream answers AGENT_STREAM_ERROR with the error contract', async () => {
    setupAgentQuery();
    const mockStream = new Readable({ read() {} });
    let capturedSignal = null;
    axios.post.mockImplementation((_url, _body, options) => {
      capturedSignal = options.signal;
      return Promise.resolve({ status: 200, headers: {}, data: mockStream });
    });

    const responsePromise = authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'q' }]
    });
    // supertest requests start lazily (on .then) — kick it off explicitly,
    // then wait for the frame writer to attach its stream listeners (bounded)
    // before driving the stream. Emitting 'error' before the attach would
    // crash the worker (Node's no-listener 'error' contract), not test
    // anything.
    responsePromise.catch(() => {});
    for (let i = 0; i < 500 && mockStream.listenerCount('data') === 0; i++) {
      await flush(10);
    }
    expect(mockStream.listenerCount('data')).toBeGreaterThan(0);
    mockStream.push(`data: ${JSON.stringify(envelope('text_message_content', { text: 'partial' }, { seq: 0 }))}\n\n`);
    await flush();
    mockStream.emit('error', new Error('socket hang up'));

    const response = await responsePromise;
    const frames = parseSSEEvents(response.text);
    expect(frames[frames.length - 1].type).toBe('error');
    expect(frames[frames.length - 1].code).toBe('AGENT_STREAM_ERROR');
    expect(frames.find((f) => f.type === 'done')).toBeUndefined();
    expect(queryService.finalizeStreamQuery).not.toHaveBeenCalled();
    // The client was told the run failed: the agent leg must not keep
    // working behind the dead response.
    expect(capturedSignal.aborted).toBe(true);
  });

  it('a stream destroyed with only a close emission still ends the response (no keepalive hang)', async () => {
    // A destroyed stream can report 'close' WITHOUT 'end' or 'error': the
    // 'close' terminal is what ends the SSE response honestly — without it
    // the response hangs on keepalives and the admission slot stays held.
    setupAgentQuery();
    const mockStream = new Readable({ read() {} });
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: mockStream });

    const responsePromise = authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'q' }]
    });
    responsePromise.catch(() => {});
    for (let i = 0; i < 500 && mockStream.listenerCount('data') === 0; i++) {
      await flush(10);
    }
    expect(mockStream.listenerCount('data')).toBeGreaterThan(0);
    mockStream.push(`data: ${JSON.stringify(envelope('text_message_content', { text: 'partial' }, { seq: 0 }))}\n\n`);
    await flush();
    mockStream.emit('close'); // close ALONE — no 'end', no 'error'

    const response = await responsePromise;
    const frames = parseSSEEvents(response.text);
    expect(frames[frames.length - 1].type).toBe('error');
    expect(frames[frames.length - 1].code).toBe('AGENT_STREAM_ERROR');
    expect(frames[frames.length - 1].message).toBe('the agent stream terminated');
    expect(frames.find((f) => f.type === 'done')).toBeUndefined();
    expect(queryService.finalizeStreamQuery).not.toHaveBeenCalled();
  });

  it('a stream that trickles past the wall-clock bound is aborted and ends with the error contract', async () => {
    // 40000 > reserves + floor: the effective timeout is the configured one,
    // so the deadline timer is a real 40000 ms bound on the BODY.
    process.env.AGENT_UPSTREAM_TIMEOUT_MS = '40000';
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    try {
      setupAgentQuery();
      const mockStream = new Readable({ read() {} });
      let capturedSignal = null;
      axios.post.mockImplementation((_url, _body, options) => {
        capturedSignal = options.signal;
        return Promise.resolve({ status: 200, headers: {}, data: mockStream });
      });

      const responsePromise = authPost('/api/queries/stream', {
        sessionId: 's1',
        messages: [{ role: 'user', content: 'q' }]
      });
      responsePromise.catch(() => {});
      for (let i = 0; i < 200 && mockStream.listenerCount('data') === 0; i++) {
        await new Promise(setImmediate);
      }
      expect(mockStream.listenerCount('data')).toBeGreaterThan(0);

      // The stream trickles: chunks keep arriving, the leg never ends.
      mockStream.push(`data: ${JSON.stringify(envelope('text_message_content', { text: 'slow' }, { seq: 0 }))}\n\n`);
      await new Promise(setImmediate);
      jest.advanceTimersByTime(40000);

      // The wall-clock bound fired: the upstream leg is aborted...
      expect(capturedSignal.aborted).toBe(true);
      // ...and (what the real adapter does on the aborted socket) the stream
      // errors out — the error contract ends the response.
      mockStream.emit('error', new Error('aborted'));

      const response = await responsePromise;
      const frames = parseSSEEvents(response.text);
      expect(frames.some((f) => f.type === 'chunk')).toBe(true);
      expect(frames[frames.length - 1].type).toBe('error');
      expect(frames.find((f) => f.type === 'done')).toBeUndefined();
      expect(queryService.finalizeStreamQuery).not.toHaveBeenCalled();
      // Story 2.11 — the BFF-attributed deadline is an honest terminal: the
      // doc reads timed_out, and the abort's stream teardown does NOT
      // overwrite it with `interrupted` (the one-outcome latch).
      expect(queryService.persistAgentRunOutcome).toHaveBeenCalledTimes(1);
      expect(queryService.persistAgentRunOutcome).toHaveBeenCalledWith('q1', 'timed_out');
    } finally {
      jest.useRealTimers();
    }
  });

  it('ignores an unknown seam kind instead of breaking the stream (additive envelope)', async () => {
    setupAgentQuery();
    axios.post.mockResolvedValue({
      status: 200,
      headers: {},
      data: seamStream([
        envelope('brand_new_seam_kind', { whatever: true }, { seq: 0 }),
        envelope('text_message_content', { text: 'ok' }, { seq: 1 }),
        envelope('run_finished', { outcome: 'answered' }, { seq: 2 }),
        { usage_record: USAGE_RECORD }
      ])
    });

    const response = await authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'q' }]
    });

    const frames = parseSSEEvents(response.text);
    expect(frames.map((f) => f.type)).toEqual(['chunk', 'metadata', 'done']);
  });

  it('a malformed seam line is logged, never projected onto a client frame', async () => {
    setupAgentQuery();
    const mockStream = new Readable({ read() {} });
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: mockStream });

    const responsePromise = authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'q' }]
    });
    await flush();
    mockStream.push('data: {"run_id":"r","seq":"not-an-int","kind":"verdict"}\n\n');
    mockStream.push(`data: ${JSON.stringify(envelope('text_message_content', { text: 'ok' }, { seq: 0 }))}\n\n`);
    mockStream.push(`data: ${JSON.stringify(envelope('run_finished', { outcome: 'answered' }, { seq: 1 }))}\n\n`);
    mockStream.push(`data: ${JSON.stringify({ usage_record: USAGE_RECORD })}\n\n`);
    mockStream.push(null);

    const response = await responsePromise;
    const frames = parseSSEEvents(response.text);
    expect(frames.map((f) => f.type)).toEqual(['chunk', 'metadata', 'done']);
  });

  it('the trailing line without its newline is still a frame (remainder flush)', async () => {
    // The last frame arrives WITHOUT its closing newline: the buffer split
    // leaves it in the remainder — the terminal flush must run it through
    // the parser (prefix stripped), or the final usage record is silently
    // lost from the persisted metadata.
    setupAgentQuery();
    const mockStream = new Readable({ read() {} });
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: mockStream });

    const responsePromise = authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'q' }]
    });
    await flush();
    mockStream.push(`data: ${JSON.stringify(envelope('text_message_content', { text: 'ok' }, { seq: 0 }))}\n\n`);
    mockStream.push(`data: ${JSON.stringify(envelope('run_finished', { outcome: 'answered' }, { seq: 1 }))}\n\n`);
    mockStream.push(`data: ${JSON.stringify({ usage_record: USAGE_RECORD })}`); // NO trailing \n\n
    mockStream.push(null);

    const response = await responsePromise;
    const metadata = parseSSEEvents(response.text).find((f) => f.type === 'metadata');
    // Story 2.11: the honest outcome rides the assembled block (answered +
    // finished_at). This script carries NO run_started event, so no
    // run-start keys (started_at / execution_versions) exist — the run_id
    // comes from the envelope, the write still completes.
    expect(metadata.agent_run).toEqual({
      run_id: 'run-abc',
      usage_record: USAGE_RECORD,
      outcome: 'answered',
      finished_at: expect.any(String)
    });
  });
});

describe('POST /api/queries/stream — translation on the agentic path (the shared relay)', () => {
  it('streams translated units and pins agent_verdict after the LAST chunk', async () => {
    process.env.STREAMING_TRANSLATION_ENABLED = '1';
    setupAgentQuery();
    translationService.init.mockResolvedValue(undefined);
    translationService.translateMarkdown.mockImplementation((content) =>
      Promise.resolve(content === 'First sentence.' ? 'Première phrase.' : 'Deuxième.')
    );
    axios.post.mockResolvedValue({
      status: 200,
      headers: {},
      data: seamStream([
        envelope('run_started', { question: 'q' }, { seq: 0 }),
        envelope('text_message_content', { text: 'First sentence. ' }, { seq: 1 }),
        envelope('text_message_content', { text: 'Second one.' }, { seq: 2 }),
        envelope('verdict', GROUNDED_VERDICT, { seq: 3 }),
        envelope('run_finished', { outcome: 'answered' }, { seq: 4 }),
        { usage_record: USAGE_RECORD }
      ])
    });

    const response = await authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'q' }],
      context: { language: 'FR' }
    });

    const frames = parseSSEEvents(response.text);
    // The relay translated the committed unit; the buffered remainder flushes
    // BEFORE the verdict frame — agent_verdict stays after the LAST chunk.
    expect(frames.map((f) => f.type)).toEqual(['chunk', 'chunk', 'agent_verdict', 'metadata', 'done']);
    expect(frames[0]).toEqual({ type: 'chunk', content: 'Première phrase. ' });
    expect(frames[1]).toEqual({ type: 'chunk', content: 'Deuxième.' });
    expect(frames[frames.length - 1].translationFailed).toBe(false);
    // Delivered units are the one translation mode the frame writer KNOWS at
    // verdict time — the frame annotates it so the client can scope the
    // verdict's claim to the source-language text.
    expect(frames[2]).toMatchObject({ type: 'agent_verdict', translation_mode: 'streaming-units' });

    // The persisted answer is the EN source text (the wire carried the
    // translation; the doc keeps the original).
    expect(queryService.finalizeStreamQuery).toHaveBeenCalledWith(
      'q1',
      'First sentence. Second one.',
      expect.any(Number),
      expect.any(Object),
      // The agentic finalize's trailing options argument ({skipRoutedGraphs}).
      expect.anything()
    );
  });

  it('reports translationFailed on done when a relayed unit fails mid-stream', async () => {
    process.env.STREAMING_TRANSLATION_ENABLED = '1';
    setupAgentQuery();
    translationService.init.mockResolvedValue(undefined);
    translationService.translateMarkdown.mockRejectedValue(new Error('translator down'));
    axios.post.mockResolvedValue({
      status: 200,
      headers: {},
      data: seamStream([
        envelope('text_message_content', { text: 'Hello world. ' }, { seq: 0 }),
        envelope('run_finished', { outcome: 'answered' }, { seq: 1 }),
        { usage_record: USAGE_RECORD }
      ])
    });

    const response = await authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'q' }],
      context: { language: 'DE' }
    });

    const frames = parseSSEEvents(response.text);
    // Degraded: the English remainder goes out, the failure travels on done —
    // never an error frame (only the translator failed).
    expect(frames.filter((f) => f.type === 'error')).toEqual([]);
    expect(frames[frames.length - 1].type).toBe('done');
    expect(frames[frames.length - 1].translationFailed).toBe(true);
    expect(frames.filter((f) => f.type === 'chunk').map((f) => f.content)).toContain('Hello world. ');
  });

  it('a failed relay never annotates the verdict as delivered', async () => {
    process.env.STREAMING_TRANSLATION_ENABLED = '1';
    setupAgentQuery();
    translationService.init.mockResolvedValue(undefined);
    translationService.translateMarkdown.mockRejectedValue(new Error('translator down'));
    axios.post.mockResolvedValue({
      status: 200,
      headers: {},
      data: seamStream([
        envelope('text_message_content', { text: 'Hello world. ' }, { seq: 0 }),
        envelope('verdict', GROUNDED_VERDICT, { seq: 1 }),
        envelope('run_finished', { outcome: 'answered' }, { seq: 2 }),
        { usage_record: USAGE_RECORD }
      ])
    });

    const response = await authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'q' }],
      context: { language: 'DE' }
    });

    const frames = parseSSEEvents(response.text);
    // The relay failed: the English original is all that was delivered, so
    // the verdict keeps the source-text claim at its full scope ('none' —
    // the payload's own finalize-time value).
    const verdict = frames.find((f) => f.type === 'agent_verdict');
    expect(verdict.translation_mode).toBe('none');
  });

  it('streaming translation OFF: a translation-requested run keeps the verdict at none (the post-stream frame carries the delivery)', async () => {
    // Streaming translation disabled — no relay exists, so the verdict frame
    // CANNOT know a translation at all; the annotation must stay out even
    // though the run asked for one (its whole-answer translation lands in the
    // later translation frame, the client's own delivery carrier).
    delete process.env.STREAMING_TRANSLATION_ENABLED;
    setupAgentQuery();
    axios.post.mockResolvedValue({
      status: 200,
      headers: {},
      data: seamStream([
        envelope('text_message_content', { text: 'Hello world.' }, { seq: 0 }),
        envelope('verdict', GROUNDED_VERDICT, { seq: 1 }),
        envelope('run_finished', { outcome: 'answered' }, { seq: 2 }),
        { usage_record: USAGE_RECORD }
      ])
    });

    const response = await authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'q' }],
      context: { language: 'DE' }
    });

    const frames = parseSSEEvents(response.text);
    const verdict = frames.find((f) => f.type === 'agent_verdict');
    expect(verdict.translation_mode).toBe('none');
  });

  it('streaming translation OFF: the post-stream translation runs through the agentic leg', async () => {
    // The leg owns the non-relay whole-answer translation (GPU-only,
    // residual-budget bounded): constructed at the terminal with the
    // TERMINAL usage record — the one place it exists — and its V05 status
    // rides the persisted metadata while the translation frame carries the
    // delivered text.
    delete process.env.STREAMING_TRANSLATION_ENABLED;
    setupAgentQuery();
    createWholeAnswerTranslator.mockImplementation(() =>
      jest.fn().mockResolvedValue({
        text: 'Bonjour le monde.',
        failed: false,
        queryTranslationStatus: 'translated',
        accounting: {
          outcome: 'translated',
          queryTranslationStatus: 'translated',
          configError: null,
          mode: 'full-answer'
        },
        error: null
      })
    );
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: answeredRunStream() });

    const response = await authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'q' }],
      context: { language: 'DE' }
    });

    // The bound translator is constructed with the terminal usage record,
    // the requested language and the request's signal.
    expect(createWholeAnswerTranslator).toHaveBeenCalledWith(
      expect.objectContaining({ runUsage: USAGE_RECORD, targetLanguage: 'de', signal: expect.anything() })
    );
    const bound = createWholeAnswerTranslator.mock.results[0].value;
    expect(bound).toHaveBeenCalledWith('Hello world.');
    const frames = parseSSEEvents(response.text);
    expect(frames.find((f) => f.type === 'translation').content).toBe('Bonjour le monde.');
    const done = frames[frames.length - 1];
    expect(done.type).toBe('done');
    // The streaming done always carries the flag: false = no failed
    // translation (V05).
    expect(done.translationFailed).toBe(false);
    // The V05 status lands on the persisted metadata.
    expect(queryService.finalizeStreamQuery.mock.calls[0][3]).toEqual(
      expect.objectContaining({ query_translation_status: 'translated' })
    );
  });

  it('a failed leg translation reports translationFailed on done; the English answer stands', async () => {
    delete process.env.STREAMING_TRANSLATION_ENABLED;
    setupAgentQuery();
    createWholeAnswerTranslator.mockImplementation(() =>
      jest.fn().mockResolvedValue({
        text: null,
        failed: true,
        queryTranslationStatus: 'fallback_timeout',
        accounting: {
          outcome: 'failed',
          queryTranslationStatus: 'fallback_timeout',
          configError: null,
          mode: 'full-answer'
        },
        error: null
      })
    );
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: answeredRunStream() });

    const response = await authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'q' }],
      context: { language: 'DE' }
    });

    const frames = parseSSEEvents(response.text);
    expect(frames.filter((f) => f.type === 'translation')).toEqual([]);
    const done = frames[frames.length - 1];
    expect(done.type).toBe('done');
    expect(done.translationFailed).toBe(true);
    expect(queryService.finalizeStreamQuery.mock.calls[0][3]).toEqual(
      expect.objectContaining({ query_translation_status: 'fallback_timeout' })
    );
  });

  it('a skipped leg translation (a missing knob) keeps the English answer, never latched', async () => {
    // The default beforeEach translator stub IS the skip (the fail-closed
    // shape the leg resolves for an unbounded translation): the English
    // answer stands and a skip is not a failure — V05.
    delete process.env.STREAMING_TRANSLATION_ENABLED;
    setupAgentQuery();
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: answeredRunStream() });

    const response = await authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'q' }],
      context: { language: 'DE' }
    });

    const frames = parseSSEEvents(response.text);
    expect(frames.filter((f) => f.type === 'translation')).toEqual([]);
    const done = frames[frames.length - 1];
    expect(done.type).toBe('done');
    expect(done.translationFailed).toBe(false);
    expect(queryService.finalizeStreamQuery.mock.calls[0][3]).toEqual(
      expect.objectContaining({ query_translation_status: 'passthrough_english' })
    );
  });

  it('streaming translation ON: the relay owns the units — the leg is never built', async () => {
    process.env.STREAMING_TRANSLATION_ENABLED = '1';
    setupAgentQuery();
    translationService.init.mockResolvedValue(undefined);
    translationService.translateMarkdown.mockResolvedValue('bon');
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: answeredRunStream() });

    await authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'q' }],
      context: { language: 'DE' }
    });

    // The relay handled the whole answer: no post-stream translation, no
    // bound translator (the units run mid-stream, before any usage record
    // the residual plan could read).
    expect(createWholeAnswerTranslator).not.toHaveBeenCalled();
  });
});

// ── disconnect detection (the direct-call view: full control over res) ──────

const { EventEmitter } = require('events');

function fakeRes() {
  const res = new EventEmitter();
  res.headersSent = false;
  res.writableEnded = false;
  res.destroyed = false;
  res.writes = [];
  res.writeHead = jest.fn((code) => {
    res.headersSent = true;
    res.statusCode = code;
  });
  res.write = jest.fn((chunk) => {
    res.writes.push(chunk);
    return true;
  });
  res.end = jest.fn(() => {
    res.writableEnded = true;
    res.emit('close');
  });
  res.status = jest.fn((code) => ({
    json: (body) => {
      res.statusCode = code;
      res.jsonBody = body;
      res.writableEnded = true;
      res.emit('close');
    }
  }));
  res.set = jest.fn();
  return res;
}

function directRun(res, { queryId = 'q1' } = {}) {
  return proxyAgentRun({
    res,
    queryService,
    queryId,
    queryData: { userId: 'user-123', sessionId: 's1', messages: [{ role: 'user', content: 'q' }] },
    authHeaders: { authorization: 'Bearer tok' },
    targetLanguage: '',
    translator: null,
    streamStartTime: Date.now(),
    // The route's real terminal writer, reduced to its persistence + end
    // contract — the frame-writer suite never asserts the route's own
    // translation/metadata logic (that is the legacy suite's job).
    handleStreamDone: jest.fn(async (qId, text, start, resArg, metadata) => {
      await queryService.finalizeStreamQuery(qId, text, Date.now() - start, metadata);
      resArg.end();
    })
  });
}

describe('proxyAgentRun — client disconnect mid-run (res.on close)', () => {
  beforeEach(() => {
    queryService.resolveFanoutPosture.mockResolvedValue(legacyPosture());
    queryService.buildAgentCallerContext.mockReturnValue({
      user_id: 'user-123',
      authorized_graph_names: [],
      authorized_repos: [],
      requested_labels: []
    });
    queryService.finalizeStreamQuery.mockResolvedValue(undefined);
  });

  it('a disconnect during the agent-leg wait aborts the upstream call', async () => {
    let capturedSignal = null;
    axios.post.mockImplementation((_url, _body, options) => {
      capturedSignal = options.signal;
      // The upstream never answers; the abort rejects (what the real adapter
      // does with the signal).
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('canceled');
          error.code = 'ERR_CANCELED';
          reject(error);
        });
      });
    });

    const res = fakeRes();
    const runPromise = directRun(res);
    await flush();
    res.emit('close');
    await runPromise;

    expect(capturedSignal.aborted).toBe(true);
    // Nothing was streamed: nothing to partial-save.
    expect(queryService.finalizeStreamQuery).not.toHaveBeenCalled();
  });

  it('a disconnect after chunks streamed aborts upstream AND partial-saves the answer', async () => {
    let capturedSignal = null;
    const mockStream = new Readable({ read() {} });
    axios.post.mockImplementation((_url, _body, options) => {
      capturedSignal = options.signal;
      return Promise.resolve({ status: 200, headers: {}, data: mockStream });
    });

    const res = fakeRes();
    const runPromise = directRun(res);
    await flush();
    mockStream.push(
      `data: ${JSON.stringify(envelope('text_message_content', { text: 'partial an' }, { seq: 0 }))}\n\n`
    );
    await flush();

    // The client leaves: `res` emits close (the frame writer's listener).
    res.emit('close');
    await runPromise;

    expect(capturedSignal.aborted).toBe(true);
    expect(res.writes.some((w) => w.includes('"type":"chunk"'))).toBe(true);
    expect(queryService.finalizeStreamQuery).toHaveBeenCalledWith(
      'q1',
      'partial an',
      expect.any(Number),
      expect.objectContaining({
        grounding_status: 'unverified',
        is_grounded: false,
        // Story 2.11: the partial save carries the honest `cancelled`
        // outcome (+ finished_at); this stream carried no run_started, so
        // no execution_versions/started_at ride.
        agent_run: expect.objectContaining({ run_id: 'run-abc', outcome: 'cancelled' }),
        // The honesty marker: a partial save is never indistinguishable
        // from a completion (ADR agentic-003).
        answer_interrupted: true,
        // Interrupted turns read NULL, never false: the decision was never
        // terminaled (`answer_interrupted` already marks interrupted-ness;
        // the completed terminal derives `abstained` from the verdict).
        abstained: null
      }),
      // The agentic finalize's trailing options argument ({skipRoutedGraphs}).
      expect.anything()
    );
    // No frames after the disconnect.
    expect(res.writes.some((w) => w.includes('"type":"done"'))).toBe(false);
    // Exactly ONE write carries the outcome (story 2.11): the partial
    // save's assembled metadata — the standalone patch stays latched OFF,
    // because a fire-and-forget patch racing the save is a second
    // read-merge-write whose stale metadata could overwrite the save's
    // assembled block.
    expect(queryService.persistAgentRunOutcome).not.toHaveBeenCalled();
  });

  it('a failed partial save falls back to the standalone outcome patch (cancelled still lands)', async () => {
    queryService.finalizeStreamQuery.mockRejectedValueOnce(new Error('db down'));
    const mockStream = new Readable({ read() {} });
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: mockStream });

    const res = fakeRes();
    const runPromise = directRun(res);
    await flush();
    mockStream.push(
      `data: ${JSON.stringify(envelope('text_message_content', { text: 'partial an' }, { seq: 0 }))}\n\n`
    );
    await flush();
    res.emit('close');
    await runPromise;
    await flush();

    // The save failed: the fallback patch is the doc's only chance to
    // carry the honest outcome — exactly one patch, `cancelled`.
    expect(queryService.finalizeStreamQuery).toHaveBeenCalledTimes(1);
    expect(queryService.persistAgentRunOutcome).toHaveBeenCalledTimes(1);
    expect(queryService.persistAgentRunOutcome).toHaveBeenCalledWith('q1', 'cancelled');
  });

  it('a disconnect before any text chunk leaves the doc unanswered (no partial save fabricated)', async () => {
    const mockStream = new Readable({ read() {} });
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: mockStream });

    const res = fakeRes();
    const runPromise = directRun(res);
    await flush();
    // The stream is open (headers written) but no text_message_content has
    // arrived: the client leaves NOW.
    res.emit('close');
    await runPromise;

    // Nothing streamed — nothing to partial-save; the at-start
    // `isAnswered:false` doc stays untouched (the honest "never answered").
    expect(queryService.finalizeStreamQuery).not.toHaveBeenCalled();
  });

  it('a normal completion is not re-finalized as a partial save by the close event', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      headers: {},
      data: seamStream([
        envelope('text_message_content', { text: 'done answer' }, { seq: 0 }),
        envelope('verdict', GROUNDED_VERDICT, { seq: 1 }),
        envelope('run_finished', { outcome: 'answered' }, { seq: 2 }),
        { usage_record: USAGE_RECORD }
      ])
    });

    const res = fakeRes();
    await directRun(res);
    await flush();

    expect(res.writableEnded).toBe(true);
    // Exactly ONE finalize — the terminal's, not the close listener's — and
    // it carries NO interrupted marker (the partial-save-only field).
    expect(queryService.finalizeStreamQuery).toHaveBeenCalledTimes(1);
    expect(queryService.finalizeStreamQuery.mock.calls[0][3].answer_interrupted).toBeUndefined();
  });

  it('a verdict already received rides the partial save (grounding captured before the disconnect)', async () => {
    const mockStream = new Readable({ read() {} });
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: mockStream });

    const res = fakeRes();
    const runPromise = directRun(res);
    await flush();
    mockStream.push(
      `data: ${JSON.stringify(envelope('text_message_content', { text: 'answer text' }, { seq: 0 }))}\n\n`
    );
    mockStream.push(`data: ${JSON.stringify(envelope('verdict', GROUNDED_VERDICT, { seq: 1 }))}\n\n`);
    await flush();
    res.emit('close');
    await runPromise;

    expect(queryService.finalizeStreamQuery).toHaveBeenCalledWith(
      'q1',
      'answer text',
      expect.any(Number),
      expect.objectContaining({
        grounding_status: 'grounded',
        is_grounded: true,
        // Story 2.11: the partial save carries the honest `cancelled` outcome.
        agent_run: expect.objectContaining({ run_id: 'run-abc', outcome: 'cancelled' }),
        answer_interrupted: true
      }),
      // The agentic finalize's trailing options argument ({skipRoutedGraphs}).
      expect.anything()
    );
    // The verdict frame was never written — the client was gone.
    expect(res.writes.some((w) => w.includes('"type":"agent_verdict"'))).toBe(false);
  });
});

describe('proxyAgentRun — posture failures (401 propagates, others fail closed)', () => {
  it('rethrows the typed 401 instead of degrading to an empty context', async () => {
    queryService.resolveFanoutPosture.mockRejectedValue(Object.assign(new Error('expired'), { statusCode: 401 }));

    const res = fakeRes();
    await expect(directRun(res)).rejects.toMatchObject({ statusCode: 401 });
    expect(res.writes).toEqual([]);
  });

  it('a non-401 posture failure fails closed — the run still starts on an empty authorized set', async () => {
    queryService.resolveFanoutPosture.mockRejectedValue(new Error('resolver exploded'));
    axios.post.mockResolvedValue({
      status: 200,
      headers: {},
      data: seamStream([
        envelope('text_message_content', { text: 'ok' }, { seq: 0 }),
        envelope('run_finished', { outcome: 'answered' }, { seq: 1 }),
        { usage_record: USAGE_RECORD }
      ])
    });

    const res = fakeRes();
    await directRun(res);
    await flush();

    // The run went out despite the resolver failure, with the NULL posture
    // (the fail-closed direction) — not a silently empty second resolution.
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(queryService.buildAgentCallerContext).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-123' }),
      null
    );
    // The stream ran to its normal terminal: chunks flowed, the response ended.
    expect(res.writes.some((w) => w.includes('"type":"chunk"'))).toBe(true);
    expect(res.writableEnded).toBe(true);
    expect(queryService.finalizeStreamQuery).toHaveBeenCalledTimes(1);
  });

  it('the route answers the propagated 401 before any SSE byte', async () => {
    setupAgentQuery();
    queryService.resolveFanoutPosture.mockRejectedValue(Object.assign(new Error('expired'), { statusCode: 401 }));

    const response = await authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'q' }]
    });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('UNAUTHENTICATED');
    expect(queryService.finalizeStreamQuery).not.toHaveBeenCalled();
  });
});

// ── story 2.11 — execution attribution and observability ────────────────────
// The run-start handshake and the honest outcome vocabulary: every terminal
// path writes exactly one outcome; the three named AC failure cases
// (cancel-before-first-token, timeout-during-judge, kill-before-final-
// metadata) each leave versions + their honest state; the persisted block
// carries ids/fingerprints only.

describe('proxyAgentRun — story 2.11, the run-start handshake and the honest outcomes', () => {
  const postureContext = () => ({
    user_id: 'user-123',
    authorized_graph_names: [],
    authorized_repos: [],
    requested_labels: []
  });

  beforeEach(() => {
    queryService.resolveFanoutPosture.mockResolvedValue(legacyPosture());
    queryService.buildAgentCallerContext.mockReturnValue(postureContext());
    queryService.finalizeStreamQuery.mockResolvedValue(undefined);
    queryService.persistAgentRunStart.mockResolvedValue(undefined);
    queryService.persistAgentRunOutcome.mockResolvedValue(undefined);
  });

  it('persists the run-start block AT START, and the success finalize completes it with the outcome', async () => {
    setupAgentQuery();
    axios.post.mockResolvedValue({
      status: 200,
      headers: {},
      data: seamStream([
        envelope('run_started', { question: 'q', execution_versions: EXECUTION_VERSIONS }, { seq: 0 }),
        envelope('text_message_content', { text: 'answer' }, { seq: 1 }),
        envelope('verdict', GROUNDED_VERDICT, { seq: 2 }),
        envelope('run_finished', { outcome: 'answered' }, { seq: 3 }),
        { usage_record: USAGE_RECORD }
      ])
    });

    const res = fakeRes();
    await directRun(res);
    await flush();

    // AT START: the versions are persisted the moment run_started arrives —
    // a run whose final frame never arrives keeps them.
    expect(queryService.persistAgentRunStart).toHaveBeenCalledTimes(1);
    // The BLOCK is persisted verbatim (one mint at the consumer — the same
    // bytes the success finalize completes).
    expect(queryService.persistAgentRunStart).toHaveBeenCalledWith(
      'q1',
      expect.objectContaining({
        run_id: 'run-abc',
        execution_versions: EXECUTION_VERSIONS,
        started_at: expect.any(String)
      })
    );
    // The finalize COMPLETES the start write (never clobbers it): the
    // assembled block merges the versions + the answered outcome.
    expect(queryService.finalizeStreamQuery).toHaveBeenCalledTimes(1);
    const persistedMetadata = queryService.finalizeStreamQuery.mock.calls[0][3];
    expect(persistedMetadata.agent_run).toEqual({
      run_id: 'run-abc',
      execution_versions: EXECUTION_VERSIONS,
      started_at: expect.any(String),
      usage_record: USAGE_RECORD,
      outcome: 'answered',
      finished_at: expect.any(String)
    });
  });

  it('AC cancel-before-first-token: a disconnect after run_started keeps the versions, writes cancelled, fabricates nothing', async () => {
    const mockStream = new Readable({ read() {} });
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: mockStream });

    const res = fakeRes();
    const runPromise = directRun(res);
    await flush();
    mockStream.push(
      `data: ${JSON.stringify(
        envelope('run_started', { question: 'q', execution_versions: EXECUTION_VERSIONS }, { seq: 0 })
      )}\n\n`
    );
    await flush();
    // The client leaves before ANY chunk.
    res.emit('close');
    await runPromise;

    // The versions are on the doc (the AT START write, the block verbatim).
    expect(queryService.persistAgentRunStart).toHaveBeenCalledWith(
      'q1',
      expect.objectContaining({
        run_id: 'run-abc',
        execution_versions: EXECUTION_VERSIONS,
        started_at: expect.any(String)
      })
    );
    // The honest BFF-terminal outcome, and nothing fabricated: no finalize,
    // no partial save, no chunk ever written.
    expect(queryService.persistAgentRunOutcome).toHaveBeenCalledTimes(1);
    expect(queryService.persistAgentRunOutcome).toHaveBeenCalledWith('q1', 'cancelled');
    expect(queryService.finalizeStreamQuery).not.toHaveBeenCalled();
    expect(res.writes.some((w) => w.includes('"type":"chunk"'))).toBe(false);
  });

  it('AC kill-before-final-metadata: an upstream death after chunks writes interrupted, the client error contract unchanged', async () => {
    const mockStream = new Readable({ read() {} });
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: mockStream });

    const res = fakeRes();
    const runPromise = directRun(res);
    await flush();
    mockStream.push(`data: ${JSON.stringify(envelope('run_started', { question: 'q' }, { seq: 0 }))}\n\n`);
    mockStream.push(`data: ${JSON.stringify(envelope('text_message_content', { text: 'half an' }, { seq: 1 }))}\n\n`);
    await flush();
    // The upstream dies before any metadata: the stream errors.
    mockStream.emit('error', new Error('connection reset'));
    await runPromise;

    // The doc keeps the honest interrupted state (no finalize — the today
    // contract: error frame then end).
    expect(queryService.persistAgentRunOutcome).toHaveBeenCalledTimes(1);
    expect(queryService.persistAgentRunOutcome).toHaveBeenCalledWith('q1', 'interrupted');
    expect(queryService.finalizeStreamQuery).not.toHaveBeenCalled();
    expect(res.writes.some((w) => w.includes('"type":"error"'))).toBe(true);
    expect(res.writes.some((w) => w.includes('"type":"done"'))).toBe(false);
  });

  it('AC timeout-during-judge (direct view): a deadline abort after chunks latches timed_out over the teardown', async () => {
    process.env.AGENT_UPSTREAM_TIMEOUT_MS = '40000';
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    try {
      const mockStream = new Readable({ read() {} });
      axios.post.mockResolvedValue({ status: 200, headers: {}, data: mockStream });

      const res = fakeRes();
      const runPromise = directRun(res);
      for (let i = 0; i < 200 && mockStream.listenerCount('data') === 0; i++) {
        await new Promise(setImmediate);
      }
      mockStream.push(`data: ${JSON.stringify(envelope('run_started', { question: 'q' }, { seq: 0 }))}\n\n`);
      mockStream.push(`data: ${JSON.stringify(envelope('text_message_content', { text: 'slow' }, { seq: 1 }))}\n\n`);
      await new Promise(setImmediate);

      // The deadline fires mid-judge: the abort, and the timed_out write.
      jest.advanceTimersByTime(40000);
      expect(queryService.persistAgentRunOutcome).toHaveBeenCalledWith('q1', 'timed_out');
      // The abort tears the stream down (what a real adapter does): the
      // teardown's interrupted must NOT overwrite the deadline's fact.
      mockStream.emit('error', new Error('aborted'));
      await runPromise;

      expect(queryService.persistAgentRunOutcome).toHaveBeenCalledTimes(1);
      expect(res.writes.some((w) => w.includes('"type":"error"'))).toBe(true);
    } finally {
      jest.useRealTimers();
      delete process.env.AGENT_UPSTREAM_TIMEOUT_MS;
    }
  });

  it('the no-credentials invariant: the persisted attribution block carries ids/fingerprints only', async () => {
    setupAgentQuery();
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

    const res = fakeRes();
    await directRun(res);
    await flush();

    // Every attribution write and the assembled block, serialized and
    // scanned: no bearer, no token, no secret-shaped value — the request's
    // bearer rides the RUN BODY, never the record.
    const startArgs = JSON.stringify(queryService.persistAgentRunStart.mock.calls);
    const outcomeArgs = JSON.stringify(queryService.persistAgentRunOutcome.mock.calls);
    const persistedBlock = JSON.stringify(queryService.finalizeStreamQuery.mock.calls[0][3].agent_run);
    for (const serialized of [startArgs, outcomeArgs, persistedBlock]) {
      expect(serialized).not.toMatch(/bearer|authorization|secret|api[_-]?key|password/i);
      expect(serialized).not.toContain('Bearer tok');
    }
  });
});
