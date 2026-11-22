'use strict';

// Story 2.4 — the BFF frame writer: the I/O matrix as executable checks,
// following the query-routes.test.js mocking pattern. AGENT_ENABLED=1 is set
// BEFORE the app module loads (the routing helper reads it once at module
// load), so every test here exercises the AGENTIC branch of
// POST /api/queries/stream; the legacy suite (query-routes.test.js, flag
// off) pins the byte-identical legacy path.

require('../setup-env');

process.env.AGENT_ENABLED = '1';
process.env.OPEA_STREAMING = 'true';
process.env.CHATQNA_STREAM_TIMEOUT = '5000';
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

// The TARGET service — the frame writer consumes the posture resolution,
// the CallerContext builder, pickUserText and finalize through it.
jest.mock('../../services/query-service', () => ({
  initStreamQuery: jest.fn(),
  finalizeStreamQuery: jest.fn(),
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
  marking: { required: false, reason: null }
};

const UNGROUNDED_VERDICT = {
  ...GROUNDED_VERDICT,
  grounding_status: 'ungrounded',
  is_grounded: false,
  marking: { required: true, reason: 'ungrounded' }
};

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
    expect(metadata.agent_run).toEqual({ run_id: 'run-abc', usage_record: USAGE_RECORD });
    expect(metadata.responseTime).toEqual(expect.any(Number));
    // The legacy fallback keys stay (the empty-stream base).
    expect(metadata.abstained).toBeNull();
    expect(metadata.filter_labels).toBeNull();

    expect(done).toEqual({ type: 'done', queryId: 'q1', translationFailed: false });

    // The same metadata is persisted — the agent_run block rides into the
    // queries doc (the version-record persistence of this story).
    expect(queryService.finalizeStreamQuery).toHaveBeenCalledWith(
      'q1',
      'Hello world.',
      expect.any(Number),
      expect.objectContaining({ grounding_status: 'grounded', is_grounded: true, agent_run: metadata.agent_run })
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
    expect(_internals.resolveUpstreamTimeoutMs()).toBe(_internals.DEFAULT_UPSTREAM_TIMEOUT_MS);
    expect(_internals.deriveDeadlineMs(_internals.resolveUpstreamTimeoutMs())).toBe(3600000 - 30000 - 5000);
    expect(logger.warn).toHaveBeenCalledWith(
      'AgentFrameWriter.upstream_timeout_below_reserves',
      expect.objectContaining({ knob: 'AGENT_UPSTREAM_TIMEOUT_MS', configured: 20000, applied: 3600000 })
    );
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
      'AgentFrameWriter.upstream_body_truncated',
      expect.objectContaining({ status: 503, bytes: expect.any(Number) })
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
    // No metadata, no done, nothing fabricated — the doc stays unanswered.
    expect(queryService.finalizeStreamQuery).not.toHaveBeenCalled();
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
    expect(metadata.agent_run).toEqual({ run_id: 'run-abc', usage_record: USAGE_RECORD });
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

    // The persisted answer is the EN source text (the wire carried the
    // translation; the doc keeps the original).
    expect(queryService.finalizeStreamQuery).toHaveBeenCalledWith(
      'q1',
      'First sentence. Second one.',
      expect.any(Number),
      expect.any(Object)
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
    }),
    emptyStreamMetadata: () => ({
      source_documents: [],
      confidence_score: 0,
      is_grounded: false,
      retrieval_confidence_score: null,
      abstained: null,
      abstention_reason: null,
      filter_labels: null
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
        agent_run: { run_id: 'run-abc' }
      })
    );
    // No frames after the disconnect.
    expect(res.writes.some((w) => w.includes('"type":"done"'))).toBe(false);
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
    // Exactly ONE finalize — the terminal's, not the close listener's.
    expect(queryService.finalizeStreamQuery).toHaveBeenCalledTimes(1);
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
        agent_run: { run_id: 'run-abc' }
      })
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
