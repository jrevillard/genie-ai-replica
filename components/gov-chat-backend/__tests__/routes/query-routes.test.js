'use strict';

require('../setup-env');

process.env.OPEA_STREAMING = 'true';
process.env.CHATQNA_STREAM_TIMEOUT = '5000';

const { Readable } = require('stream');
const translationService = require('../../services/translation-service');

// Mock shared-lib — virtual because it only exists after Docker packaging
jest.mock('../../shared-lib', () => require('../mocks/shared-lib'), { virtual: true });
jest.mock('../../shared-lib/validation-utils', () => require('../mocks/shared-lib'), { virtual: true });

// Mock keycloak-auth-service (used by middleware)
jest.mock('../../services/keycloak-auth-service', () => ({
  verifyToken: jest.fn(),
  checkUserStatusInKeycloak: jest.fn()
}));

// Mock user-provisioning-service (used by middleware)
jest.mock('../../services/user-provisioning-service', () => ({
  provisionUser: jest.fn(),
  initialize: jest.fn(),
  markUserAsDeleted: jest.fn()
}));

// Mock the TARGET service
jest.mock('../../services/query-service', () => ({
  initStreamQuery: jest.fn(),
  finalizeStreamQuery: jest.fn(),
  parseChatQnASSELine: jest.fn(),
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

// Mock axios (used directly by query-routes for streaming)
jest.mock('axios', () => ({
  post: jest.fn(),
  get: jest.fn()
}));

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
  translateStream: jest.fn(),
  init: jest.fn(),
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

// Mock swagger dependencies
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

// Mock keycloak-auth-middleware — allow pass-through, override for 401/403 tests
jest.mock('../../middleware/keycloak-auth-middleware', () => ({
  keycloakAuthMiddleware: {
    authenticate: jest.fn((req, res, next) => {
      req.user = { iss_sub: 'http://localhost:8080/realms/genie#user-123', _key: 'user-123' };
      next();
    }),
    requireAdmin: jest.fn((req, res, next) => next())
  }
}));

// Prevent process.exit during tests
const originalExit = process.exit;
beforeAll(() => {
  process.exit = jest.fn();
});
afterAll(() => {
  process.exit = originalExit;
});

const { createApp } = require('../../index');
const request = require('supertest');
const { createValidToken } = require('../fixtures/tokens');

const queryService = require('../../services/query-service');
const axios = require('axios');
const { keycloakAuthMiddleware } = require('../../middleware/keycloak-auth-middleware');
const { context, propagation, trace } = require('@opentelemetry/api');

const validToken = createValidToken();

let app;
beforeAll(() => {
  app = createApp({ services: { queryService } });
});

beforeEach(() => {
  jest.clearAllMocks();
  keycloakAuthMiddleware.authenticate.mockImplementation((req, res, next) => {
    req.user = { iss_sub: 'http://localhost:8080/realms/genie#user-123', _key: 'user-123' };
    next();
  });
  // The language the deployment can serve. `clearAllMocks` keeps the
  // implementations, so the default is set here on every test: a test that
  // refuses a language does not leak that refusal into the next one.
  translationService.resolveLanguagePair.mockImplementation((sourceLang, targetLang) => ({
    sourceLang,
    targetLang,
    sourceLangCode: sourceLang,
    targetLangCode: targetLang
  }));
  process.env.OPEA_STREAMING = 'true';
});

// `tracingBaggage.withBaggage` scopes the correlation id to the chatqna request
// through context propagation. The SDK registers AsyncLocalStorageContextManager
// at startup, but NODE_ENV === 'test' short-circuits tracing.js, so without a
// context manager `context.with` degrades to a plain call and the baggage never
// becomes active — the code under test would be correct but untestable.
// Unregistered afterwards so the global does not leak to other suites.
beforeAll(() => {
  const { AsyncLocalStorageContextManager } = require('@opentelemetry/context-async-hooks');
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
});

afterAll(() => {
  context.disable();
});

function authGet(path) {
  return request(app).get(path).set('Authorization', `Bearer ${validToken}`);
}
function authPost(path, body) {
  return request(app).post(path).set('Authorization', `Bearer ${validToken}`).send(body);
}
function authPatch(path, body) {
  return request(app).patch(path).set('Authorization', `Bearer ${validToken}`).send(body);
}

// ============================================================
// AC1.1: Auth guard — all endpoints require authentication
// ============================================================
describe('Auth guard', () => {
  it('should return 401 on PATCH /:queryId/responsetime without token', async () => {
    keycloakAuthMiddleware.authenticate.mockImplementation((req, res) => {
      res.status(401).json({ error: 'TOKEN_INVALID', message: 'Authentication required' });
    });

    const response = await request(app).patch('/api/queries/q1/responsetime').send({ responseTime: 100 });
    expect(response.status).toBe(401);
  });

  it('should return 401 on POST /stream without token', async () => {
    keycloakAuthMiddleware.authenticate.mockImplementation((req, res) => {
      res.status(401).json({ error: 'TOKEN_INVALID', message: 'Authentication required' });
    });

    const response = await request(app).post('/api/queries/stream').send({ sessionId: 's1' });
    expect(response.status).toBe(401);
  });

  it('should return 401 on POST / without token', async () => {
    keycloakAuthMiddleware.authenticate.mockImplementation((req, res) => {
      res.status(401).json({ error: 'TOKEN_INVALID', message: 'Authentication required' });
    });

    const response = await request(app).post('/api/queries').send({ sessionId: 's1' });
    expect(response.status).toBe(401);
  });

  it('should return 401 on GET /:queryId without token', async () => {
    keycloakAuthMiddleware.authenticate.mockImplementation((req, res) => {
      res.status(401).json({ error: 'TOKEN_INVALID', message: 'Authentication required' });
    });

    const response = await request(app).get('/api/queries/q1');
    expect(response.status).toBe(401);
  });

  it('should return 401 on POST /:queryId/feedback without token', async () => {
    keycloakAuthMiddleware.authenticate.mockImplementation((req, res) => {
      res.status(401).json({ error: 'TOKEN_INVALID', message: 'Authentication required' });
    });

    const response = await request(app).post('/api/queries/q1/feedback').send({ rating: 5 });
    expect(response.status).toBe(401);
  });
});

// ============================================================
// AC1.2: PATCH /:queryId/responsetime
// ============================================================
describe('PATCH /:queryId/responsetime', () => {
  it('should return 200 on success', async () => {
    const updated = { _key: 'q1', responseTime: 250 };
    queryService.updateQueryResponseTime.mockResolvedValue(updated);

    const response = await authPatch('/api/queries/q1/responsetime', { responseTime: 250 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(updated);
    expect(queryService.updateQueryResponseTime).toHaveBeenCalledWith('q1', 250);
  });

  it('should return 400 when responseTime is missing', async () => {
    const response = await authPatch('/api/queries/q1/responsetime', {});

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('required');
  });

  it('should accept responseTime of 0', async () => {
    const updated = { _key: 'q1', responseTime: 0 };
    queryService.updateQueryResponseTime.mockResolvedValue(updated);

    const response = await authPatch('/api/queries/q1/responsetime', { responseTime: 0 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(updated);
    expect(queryService.updateQueryResponseTime).toHaveBeenCalledWith('q1', 0);
  });

  it('should return 500 via next(error) on service failure', async () => {
    queryService.updateQueryResponseTime.mockRejectedValue(new Error('DB error'));

    const response = await authPatch('/api/queries/q1/responsetime', { responseTime: 250 });

    expect(response.status).toBe(500);
  });
});

// ============================================================
// AC1.3: POST /stream (SSE)
// ============================================================
describe('POST /stream', () => {
  afterEach(() => {
    delete process.env.STREAMING_TRANSLATION_ENABLED;
  });
  it('should return 501 when OPEA_STREAMING is false', async () => {
    process.env.OPEA_STREAMING = 'false';

    const response = await authPost('/api/queries/stream', { sessionId: 's1' });

    expect(response.status).toBe(501);
    expect(response.body.error).toBe('STREAMING_DISABLED');
  });

  it('should return 500 on stream setup error', async () => {
    queryService.initStreamQuery.mockRejectedValue(new Error('Init stream failed'));

    const response = await authPost('/api/queries/stream', { sessionId: 's1' });

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('STREAM_ERROR');
  });

  it('should return 504 on timeout/abort', async () => {
    const abortError = new Error('Timeout');
    abortError.code = 'ECONNABORTED';
    queryService.initStreamQuery.mockRejectedValue(abortError);

    const response = await authPost('/api/queries/stream', { sessionId: 's1' });

    expect(response.status).toBe(504);
    expect(response.body.error).toBe('CHATQNA_UNAVAILABLE');
  });

  it('should stream SSE events from OPEA', async () => {
    queryService.initStreamQuery.mockResolvedValue({
      queryId: 'q1',
      opeaUrl: 'http://chatqna:8888/v1/chatqna',
      opeaPayload: { messages: [] }
    });

    queryService.parseChatQnASSELine.mockImplementation((data) => {
      const parsed = JSON.parse(data);
      return parsed;
    });

    queryService.finalizeStreamQuery.mockResolvedValue(undefined);

    const mockStream = new Readable({ read() {} });
    axios.post.mockResolvedValue({ data: mockStream });

    const responsePromise = authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'hello' }],
      context: { language: 'EN' }
    });

    // Wait for SSE headers to be set, then push data
    await new Promise((resolve) => setTimeout(resolve, 50));

    mockStream.push('data: {"type":"chunk","content":"Hello"}\n\n');
    mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
    mockStream.push(null);

    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('text/event-stream');
  });

  it('posts to the upstream the service resolved, never to one from the request body', async () => {
    // The `nosemgrep` annotations on these axios.post sinks rest on this: the
    // route takes the upstream from initStreamQuery — env-derived, pinned in
    // query-service.test.js — and never from req.body. The body fields below
    // would win if the route consulted them, so they are sent on purpose.
    queryService.initStreamQuery.mockResolvedValue({
      queryId: 'q1',
      opeaUrl: 'http://chatqna.internal:8899/v1/chatqna',
      opeaPayload: { messages: [] }
    });

    queryService.parseChatQnASSELine.mockImplementation((data) => JSON.parse(data));
    queryService.finalizeStreamQuery.mockResolvedValue(undefined);

    const mockStream = new Readable({ read() {} });
    axios.post.mockResolvedValue({ data: mockStream });

    const responsePromise = authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'hello' }],
      context: { language: 'EN' },
      opeaUrl: 'http://169.254.169.254/latest/meta-data/',
      baseURL: 'http://169.254.169.254',
      host: '169.254.169.254',
      url: 'http://169.254.169.254'
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    mockStream.push('data: {"type":"chunk","content":"Hello"}\n\n');
    mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
    mockStream.push(null);
    await responsePromise;

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post).toHaveBeenCalledWith(
      'http://chatqna.internal:8899/v1/chatqna',
      // The payload the service built, not the one in the request body: the
      // body carries a non-empty `messages`, so a merge or substitution here
      // would change it.
      expect.objectContaining({ messages: [] }),
      expect.any(Object)
    );
  });

  it('should stream the target-language translation when STREAMING_TRANSLATION_ENABLED (#829)', async () => {
    process.env.STREAMING_TRANSLATION_ENABLED = '1';
    queryService.initStreamQuery.mockResolvedValue({
      queryId: 'q1',
      opeaUrl: 'http://chatqna:8888/v1/chatqna',
      opeaPayload: { messages: [] }
    });
    queryService.parseChatQnASSELine.mockImplementation((data) => JSON.parse(data));
    queryService.finalizeStreamQuery.mockResolvedValue(undefined);

    // translateMarkdown returns the translated unit (AST-based; structure
    // preserved). The streaming path appends the original separator verbatim.
    translationService.init.mockResolvedValue(undefined);
    translationService.translateMarkdown.mockImplementation(async (content) => `[ES]${content}`);

    const mockStream = new Readable({ read() {} });
    axios.post.mockResolvedValue({ data: mockStream });

    const responsePromise = authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'hola' }],
      context: { language: 'es' }
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // EN answer with a sentence boundary so the unit commits to the translator.
    mockStream.push('data: {"type":"chunk","content":"Hello world. "}\n\n');
    mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
    mockStream.push(null);

    const response = await responsePromise;
    expect(response.status).toBe(200);
    const body = response.text || '';
    // The streamed chunk is the TRANSLATED unit, not the EN source. The trailing
    // space separator is re-appended verbatim after the translated content.
    expect(body).toContain('[ES]Hello world. ');
    // The streaming path must NOT emit a post-stream 'translation' event.
    expect(body).not.toMatch(/"type":"translation"/);
    delete process.env.STREAMING_TRANSLATION_ENABLED;
  });

  it('keeps a translation payload inside one SSE frame — no forged event can escape it (#1096)', async () => {
    // The `nosemgrep` on this sink rests on `JSON.stringify` escaping newlines, so
    // a value cannot terminate the `data:` frame or open a second one. This
    // asserts the property instead of asserting the comment: the payload below
    // tries to end the frame and forge an event of its own.
    process.env.STREAMING_TRANSLATION_ENABLED = '1';
    queryService.initStreamQuery.mockResolvedValue({
      queryId: 'q1',
      opeaUrl: 'http://chatqna:8888/v1/chatqna',
      opeaPayload: { messages: [] }
    });
    queryService.parseChatQnASSELine.mockImplementation((data) => JSON.parse(data));
    queryService.finalizeStreamQuery.mockResolvedValue(undefined);
    translationService.init.mockResolvedValue(undefined);
    const forged = 'Hola.\n\ndata: {"type":"chunk","content":"forged"}\n\n';
    translationService.translateMarkdown.mockImplementation(async () => forged);

    const mockStream = new Readable({ read() {} });
    axios.post.mockResolvedValue({ data: mockStream });

    const responsePromise = authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'hola' }],
      context: { language: 'es' }
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    mockStream.push('data: {"type":"chunk","content":"Hello world. "}\n\n');
    mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
    mockStream.push(null);

    const response = await responsePromise;
    const body = response.text || '';
    const frames = body
      .split('\n\n')
      .filter((frame) => frame.startsWith('data: '))
      .map((frame) => JSON.parse(frame.slice('data: '.length)));

    const chunkContents = frames.filter((event) => event.type === 'chunk').map((event) => event.content);

    // The forged text arrived as string content of one frame...
    expect(chunkContents.join('\n\n')).toContain('data: {"type":"chunk","content":"forged"}');
    // ...and never became a frame of its own: had the newline not been escaped,
    // the inner object would have been split out and parsed as its own event.
    expect(chunkContents).not.toContain('forged');
    delete process.env.STREAMING_TRANSLATION_ENABLED;
  });

  it('should fall back to the EN unit and report the failure on done', async () => {
    process.env.STREAMING_TRANSLATION_ENABLED = '1';
    queryService.initStreamQuery.mockResolvedValue({
      queryId: 'q1',
      opeaUrl: 'http://chatqna:8888/v1/chatqna',
      opeaPayload: { messages: [] }
    });
    queryService.parseChatQnASSELine.mockImplementation((data) => JSON.parse(data));
    queryService.finalizeStreamQuery.mockResolvedValue(undefined);
    translationService.init.mockResolvedValue(undefined);
    // Translator fails -> the catch emits the original EN unit as a fallback.
    translationService.translateMarkdown.mockRejectedValue(new Error('vLLM down'));

    const mockStream = new Readable({ read() {} });
    axios.post.mockResolvedValue({ data: mockStream });

    const responsePromise = authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'hola' }],
      context: { language: 'es' }
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    mockStream.push('data: {"type":"chunk","content":"Hello world. "}\n\n');
    mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
    mockStream.push(null);

    const response = await responsePromise;
    expect(response.status).toBe(200);
    const body = response.text || '';
    expect(body).toContain('Hello world');
    expect(body).not.toMatch(/"type":"translation"/);
    // The EN unit is already on the wire and cannot be recalled, so the
    // failure has to reach the client somehow. It travels on `done` because an
    // `error` frame is terminal for the client: it stops reading the stream
    // and reports the whole system as down.
    expect(body).toMatch(/"type":"done","queryId":"q1","translationFailed":true/);
    // Not an `error` frame — that would truncate the answer and raise a
    // system-down notification for a translation-only failure.
    expect(body).not.toMatch(/"type":"error"/);
    delete process.env.STREAMING_TRANSLATION_ENABLED;
  });

  it('should flush a trailing partial unit at stream end (#829)', async () => {
    process.env.STREAMING_TRANSLATION_ENABLED = '1';
    queryService.initStreamQuery.mockResolvedValue({
      queryId: 'q1',
      opeaUrl: 'http://chatqna:8888/v1/chatqna',
      opeaPayload: { messages: [] }
    });
    queryService.parseChatQnASSELine.mockImplementation((data) => JSON.parse(data));
    queryService.finalizeStreamQuery.mockResolvedValue(undefined);
    translationService.init.mockResolvedValue(undefined);
    translationService.translateMarkdown.mockImplementation(async (content) => `[ES]${content}`);

    const mockStream = new Readable({ read() {} });
    axios.post.mockResolvedValue({ data: mockStream });

    const responsePromise = authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'hola' }],
      context: { language: 'es' }
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    // A complete sentence (committed at boundary) + a trailing partial (flushed at done).
    mockStream.push('data: {"type":"chunk","content":"Sentence one. "}\n\n');
    mockStream.push('data: {"type":"chunk","content":"partial trailing"}\n\n');
    mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
    mockStream.push(null);

    const response = await responsePromise;
    expect(response.status).toBe(200);
    const body = response.text || '';
    // Both the boundary-committed unit and the trailing partial are translated.
    expect(body).toContain('[ES]Sentence one');
    expect(body).toContain('[ES]partial trailing');
    expect(translationService.translateMarkdown).toHaveBeenCalledTimes(2);
    // The committed unit's content excludes the trailing separator (the space
    // is re-appended by the route, not passed to the translator).
    expect(translationService.translateMarkdown.mock.calls[0][0]).toBe('Sentence one.');
    delete process.env.STREAMING_TRANSLATION_ENABLED;
  });

  it('should degrade to direct EN forwarding after a streaming translation unit failure (#829)', async () => {
    process.env.STREAMING_TRANSLATION_ENABLED = '1';
    queryService.initStreamQuery.mockResolvedValue({
      queryId: 'q1',
      opeaUrl: 'http://chatqna:8888/v1/chatqna',
      opeaPayload: { messages: [] }
    });
    queryService.parseChatQnASSELine.mockImplementation((data) => JSON.parse(data));
    queryService.finalizeStreamQuery.mockResolvedValue(undefined);
    translationService.init.mockResolvedValue(undefined);
    translationService.translateMarkdown.mockRejectedValue(new Error('GPU down'));

    const mockStream = new Readable({ read() {} });
    axios.post.mockResolvedValue({ data: mockStream });

    const responsePromise = authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'hola' }],
      context: { language: 'es' }
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // First chunk: complete sentence → translateMarkdown fails → degradation flag set
    mockStream.push('data: {"type":"chunk","content":"First sentence. "}\n\n');
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Second chunk: should be forwarded DIRECTLY (not buffered/translated)
    mockStream.push('data: {"type":"chunk","content":"Raw English"}\n\n');
    mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
    mockStream.push(null);

    const response = await responsePromise;
    expect(response.status).toBe(200);
    const body = response.text || '';
    // Both texts present (EN fallback for failed unit + direct-forwarded chunk)
    expect(body).toContain('First sentence');
    expect(body).toContain('Raw English');
    // No post-stream translation event (streaming path skipPostStreamTranslation=true)
    expect(body).not.toMatch(/"type":"translation"/);
    delete process.env.STREAMING_TRANSLATION_ENABLED;
  });

  it('keeps the buffered tail in order when the streaming translation fails', async () => {
    // The failure happens while the answer is still being written. The English
    // that is buffered but not committed is OLDER than the chunks that follow
    // it, so it has to reach the client first — otherwise the answer reads out
    // of order and the tail lands at the very end, after the remainder.
    process.env.STREAMING_TRANSLATION_ENABLED = '1';
    queryService.initStreamQuery.mockResolvedValue({
      queryId: 'q1',
      opeaUrl: 'http://chatqna:8888/v1/chatqna',
      opeaPayload: { messages: [] }
    });
    queryService.parseChatQnASSELine.mockImplementation((data) => JSON.parse(data));
    queryService.finalizeStreamQuery.mockResolvedValue(undefined);
    translationService.init.mockResolvedValue(undefined);
    // The translation of the first unit stays in flight: the failure has to
    // land on a chosen moment, not on the first await.
    let failFirstUnit;
    const firstUnit = new Promise((resolve, reject) => {
      failFirstUnit = reject;
    });
    translationService.translateMarkdown.mockImplementationOnce(() => firstUnit);

    const mockStream = new Readable({ read() {} });
    axios.post.mockResolvedValue({ data: mockStream });

    // .end() starts the request right away: awaiting the Test object would
    // only send it at the end of the test, long after the stream was pushed.
    const responsePromise = new Promise((resolve, reject) => {
      authPost('/api/queries/stream', {
        sessionId: 's1',
        messages: [{ role: 'user', content: 'hola' }],
        context: { language: 'es' }
      }).end((err, res) => (err ? reject(err) : resolve(res)));
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    // A complete unit: it is committed to the translator.
    mockStream.push('data: {"type":"chunk","content":"First sentence. "}\n\n');
    await new Promise((resolve) => setTimeout(resolve, 50));
    // A partial unit: no boundary yet, so it stays buffered — and the
    // translation of the first unit is still in flight, so the failure is not
    // known yet.
    mockStream.push('data: {"type":"chunk","content":"Buffered tail"}\n\n');
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Now the translation fails.
    failFirstUnit(new Error('GPU down'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    // The next chunk goes out directly, in English.
    mockStream.push('data: {"type":"chunk","content":"Raw English"}\n\n');
    mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
    mockStream.push(null);

    const response = await responsePromise;
    expect(response.status).toBe(200);
    const body = response.text || '';
    // Nothing is lost: the buffered tail is part of the answer.
    expect(body).toContain('Buffered tail');
    expect(body).toContain('Raw English');
    // And it is not emitted after the chunk that follows it.
    expect(body.indexOf('Buffered tail')).toBeLessThan(body.indexOf('Raw English'));
    delete process.env.STREAMING_TRANSLATION_ENABLED;
  });

  it('does not send a queued unit to the translator after the streaming translation failed', async () => {
    // A unit committed while the previous one was still being translated is
    // queued behind it. Once the translation failed, the answer is English for
    // the remainder: the queued unit must not be sent to the translator again,
    // or a half-translated answer is what the user reads.
    process.env.STREAMING_TRANSLATION_ENABLED = '1';
    queryService.initStreamQuery.mockResolvedValue({
      queryId: 'q1',
      opeaUrl: 'http://chatqna:8888/v1/chatqna',
      opeaPayload: { messages: [] }
    });
    queryService.parseChatQnASSELine.mockImplementation((data) => JSON.parse(data));
    queryService.finalizeStreamQuery.mockResolvedValue(undefined);
    translationService.init.mockResolvedValue(undefined);
    let failFirstUnit;
    const firstUnit = new Promise((resolve, reject) => {
      failFirstUnit = reject;
    });
    translationService.translateMarkdown.mockImplementationOnce(() => firstUnit);

    const mockStream = new Readable({ read() {} });
    axios.post.mockResolvedValue({ data: mockStream });

    // .end() starts the request right away: awaiting the Test object would
    // only send it at the end of the test, long after the stream was pushed.
    const responsePromise = new Promise((resolve, reject) => {
      authPost('/api/queries/stream', {
        sessionId: 's1',
        messages: [{ role: 'user', content: 'hola' }],
        context: { language: 'es' }
      }).end((err, res) => (err ? reject(err) : resolve(res)));
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    // The first unit is committed and its translation is in flight.
    mockStream.push('data: {"type":"chunk","content":"Alpha. "}\n\n');
    await new Promise((resolve) => setTimeout(resolve, 50));
    // The second unit is committed too: it is queued behind the first one.
    mockStream.push('data: {"type":"chunk","content":"Beta. "}\n\n');
    await new Promise((resolve) => setTimeout(resolve, 50));
    failFirstUnit(new Error('GPU down'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
    mockStream.push(null);

    const response = await responsePromise;
    expect(response.status).toBe(200);
    const body = response.text || '';
    // The queued unit is part of the answer, in English.
    expect(body).toContain('Alpha');
    expect(body).toContain('Beta');
    // And it did not go through the translator a second time.
    expect(translationService.translateMarkdown).toHaveBeenCalledTimes(1);
    delete process.env.STREAMING_TRANSLATION_ENABLED;
  });

  it('keeps the answer complete and in order when the translation fails before the last unit', async () => {
    // The translation fails while the stream is still running. The units that
    // follow it are not translated, but they must still reach the client in
    // the order the answer was written: a unit queued but not yet written
    // would otherwise land after the remainder that follows it, or after the
    // response has ended (which drops it).
    process.env.STREAMING_TRANSLATION_ENABLED = '1';
    queryService.initStreamQuery.mockResolvedValue({
      queryId: 'q1',
      opeaUrl: 'http://chatqna:8888/v1/chatqna',
      opeaPayload: { messages: [] }
    });
    queryService.parseChatQnASSELine.mockImplementation((data) => JSON.parse(data));
    queryService.finalizeStreamQuery.mockResolvedValue(undefined);
    translationService.init.mockResolvedValue(undefined);
    // The translator signals that it was called, so the test waits for the
    // route to have processed the first chunk instead of guessing with a
    // timeout: the failure must be known BEFORE the last chunk arrives, and
    // the last chunk and the end of the stream must arrive in the SAME read
    // (that is what leaves a queued unit in flight when the response ends).
    let translatorCalled;
    const translatorCalledPromise = new Promise((resolve) => {
      translatorCalled = resolve;
    });
    translationService.translateMarkdown.mockImplementation(async () => {
      translatorCalled();
      throw new Error('translator unreachable');
    });

    const mockStream = new Readable({ read() {} });
    axios.post.mockResolvedValue({ data: mockStream });

    // .end() starts the request right away: awaiting the Test object would
    // only send it at the end of the test, long after the stream was pushed.
    const responsePromise = new Promise((resolve, reject) => {
      authPost('/api/queries/stream', {
        sessionId: 's1',
        messages: [{ role: 'user', content: 'hola' }],
        context: { language: 'zz' }
      }).end((err, res) => (err ? reject(err) : resolve(res)));
    });
    mockStream.push('data: {"type":"chunk","content":"First sentence. "}\n\n');
    // The first unit is refused, and the refusal is known before the next
    // chunk arrives.
    await translatorCalledPromise;
    await new Promise((resolve) => setImmediate(resolve));
    // The last unit and the end of the stream arrive in the same read.
    mockStream.push(
      'data: {"type":"chunk","content":"Second sentence. Tail"}\n\ndata: {"type":"done","queryId":"q1"}\n\n'
    );
    mockStream.push(null);

    const response = await responsePromise;
    expect(response.status).toBe(200);
    const body = response.text || '';
    expect(body).toContain('First sentence');
    // The unit queued when the refusal was already known must not be dropped
    // when the response ends.
    expect(body).toContain('Second sentence');
    expect(body).toContain('Tail');
    // The remainder must not overtake the unit it follows.
    expect(body.indexOf('Second sentence')).toBeLessThan(body.indexOf('Tail'));
    delete process.env.STREAMING_TRANSLATION_ENABLED;
  });

  it('reports a failure on done when the post-stream translation fails', async () => {
    // The post-stream path (streaming translation off) translates the whole
    // answer once the stream ended. When the translator fails, the answer
    // still reaches the client — in English — and the failure travels on
    // `done`, where the client expects the stream to end. The answer is never
    // silently left in a language the client did not ask for.
    queryService.initStreamQuery.mockResolvedValue({
      queryId: 'q1',
      opeaUrl: 'http://chatqna:8888/v1/chatqna',
      opeaPayload: { messages: [] }
    });
    queryService.parseChatQnASSELine.mockImplementation((data) => JSON.parse(data));
    queryService.finalizeStreamQuery.mockResolvedValue(undefined);
    translationService.init.mockResolvedValue(undefined);
    translationService.translateMarkdown.mockRejectedValue(new Error('translator unreachable'));

    const mockStream = new Readable({ read() {} });
    axios.post.mockResolvedValue({ data: mockStream });

    const responsePromise = authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'hola' }],
      context: { language: 'fr' }
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    mockStream.push('data: {"type":"chunk","content":"Hello world. "}\n\n');
    mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
    mockStream.push(null);

    const response = await responsePromise;
    expect(response.status).toBe(200);
    const body = response.text || '';
    expect(body).toContain('Hello world');
    expect(body).not.toMatch(/"type":"translation"/);
    expect(body).toMatch(/"translationFailed":true/);
    // Not an `error` frame: the client treats that as terminal and reports
    // the whole system as down, which only the translator failing does not mean.
    expect(body).not.toMatch(/"type":"error"/);
  });

  it('should preserve inter-unit paragraph breaks (\\n\\n) during streaming (#829)', async () => {
    // Regression guard for the formatting bug: the separator between units must
    // be passed through verbatim so paragraphs/lists survive streaming. The EN
    // answer arrives as two paragraphs; the output must keep the "\n\n" between
    // the translated units (model never sees the separator).
    process.env.STREAMING_TRANSLATION_ENABLED = '1';
    queryService.initStreamQuery.mockResolvedValue({
      queryId: 'q1',
      opeaUrl: 'http://chatqna:8888/v1/chatqna',
      opeaPayload: { messages: [] }
    });
    queryService.parseChatQnASSELine.mockImplementation((data) => JSON.parse(data));
    queryService.finalizeStreamQuery.mockResolvedValue(undefined);
    translationService.init.mockResolvedValue(undefined);
    translationService.translateMarkdown.mockImplementation(async (content) => `[ES]${content}`);

    const mockStream = new Readable({ read() {} });
    axios.post.mockResolvedValue({ data: mockStream });

    const responsePromise = authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'hola' }],
      context: { language: 'es' }
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Two paragraphs, each ending in a blank line (markdown paragraph separator).
    mockStream.push('data: {"type":"chunk","content":"First para.\\n\\n"}\n\n');
    mockStream.push('data: {"type":"chunk","content":"Second para.\\n\\n"}\n\n');
    mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
    mockStream.push(null);

    const response = await responsePromise;
    expect(response.status).toBe(200);
    const body = response.text || '';
    // JSON-stringified in the SSE body, so \n appears escaped as the two chars
    // backslash-n. The separator between translated units is intact.
    expect(body).toContain('[ES]First para.\\n\\n');
    expect(body).toContain('[ES]Second para.');
    // The translator only ever receives the content (no separator leaked in).
    expect(translationService.translateMarkdown).toHaveBeenCalledWith('First para.', 'en', 'es');
    delete process.env.STREAMING_TRANSLATION_ENABLED;
  });

  it('should forward Authorization header to ChatQnA', async () => {
    queryService.initStreamQuery.mockResolvedValue({
      queryId: 'q1',
      opeaUrl: 'http://chatqna:8888/v1/chatqna',
      opeaPayload: { messages: [] },
      authHeaders: { authorization: 'Bearer test-token-123' }
    });
    queryService.parseChatQnASSELine.mockImplementation((data) => JSON.parse(data));
    queryService.finalizeStreamQuery.mockResolvedValue(undefined);

    const mockStream = new Readable({ read() {} });
    axios.post.mockResolvedValue({ data: mockStream });

    const responsePromise = authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'hello' }],
      context: { language: 'EN' }
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
    mockStream.push(null);
    await responsePromise;

    // Verify Authorization header is forwarded to ChatQnA
    expect(axios.post).toHaveBeenCalledWith(
      'http://chatqna:8888/v1/chatqna',
      expect.any(Object),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token-123'
        })
      })
    );
  });
});

// ============================================================
// The language boundary on the chat path
// ============================================================
describe('the language the client asked for', () => {
  const { UnsupportedLanguageError } = require('../../services/translation/unsupported-language');

  const refusesTheLanguage = () => {
    translationService.resolveLanguagePair.mockImplementation(() => {
      throw new UnsupportedLanguageError('target');
    });
  };

  it('refuses a request whose language the deployment cannot serve', async () => {
    refusesTheLanguage();

    const response = await authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'hola' }],
      context: { language: 'zz' }
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/unsupported target language/i);
  });

  it('generates nothing when it refuses the request', async () => {
    refusesTheLanguage();

    await authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'hola' }],
      context: { language: 'zz' }
    });

    // Nothing was asked of chatqna and no stream was opened: the answer is
    // never produced in a language the caller did not ask for.
    expect(queryService.initStreamQuery).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('never echoes the language the caller wrote back', async () => {
    refusesTheLanguage();

    const response = await authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'hola' }],
      context: { language: 'zz' }
    });

    // The response names the refused side, never the value the caller sent:
    // a value that came back in the answer could be handed on to a model.
    expect(JSON.stringify(response.body)).not.toContain('zz');
  });

  it('refuses the same request on the non-streaming route', async () => {
    refusesTheLanguage();

    const response = await authPost('/api/queries', {
      sessionId: 's1',
      text: 'hola',
      context: { language: 'zz' }
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/unsupported target language/i);
    expect(queryService.createQuery).not.toHaveBeenCalled();
  });

  it('lets a request through when the deployment can serve the language', async () => {
    queryService.initStreamQuery.mockResolvedValue({
      queryId: 'q1',
      opeaUrl: 'http://chatqna:8888/v1/chatqna',
      opeaPayload: { messages: [] }
    });
    queryService.parseChatQnASSELine.mockImplementation((data) => JSON.parse(data));
    queryService.finalizeStreamQuery.mockResolvedValue(undefined);

    const mockStream = new Readable({ read() {} });
    axios.post.mockResolvedValue({ data: mockStream });

    const responsePromise = authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'hola' }],
      context: { language: 'fr' }
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
    mockStream.push(null);

    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(translationService.resolveLanguagePair).toHaveBeenCalledWith('en', 'fr');
  });

  it('does not refuse the request when the translator is not ready', async () => {
    // The check could not run: the language was not refused, the translation
    // is what is missing. The request goes through and the failure is
    // reported when the answer is written.
    translationService.init.mockRejectedValue(new Error('Translation service is not ready'));

    queryService.initStreamQuery.mockResolvedValue({
      queryId: 'q1',
      opeaUrl: 'http://chatqna:8888/v1/chatqna',
      opeaPayload: { messages: [] }
    });
    queryService.parseChatQnASSELine.mockImplementation((data) => JSON.parse(data));
    queryService.finalizeStreamQuery.mockResolvedValue(undefined);

    const mockStream = new Readable({ read() {} });
    axios.post.mockResolvedValue({ data: mockStream });

    const responsePromise = authPost('/api/queries/stream', {
      sessionId: 's1',
      messages: [{ role: 'user', content: 'hola' }],
      context: { language: 'fr' }
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    mockStream.push('data: {"type":"chunk","content":"Hello. "}\n\n');
    mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
    mockStream.push(null);

    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(response.text).toContain('"translationFailed":true');
  });
});

// ============================================================
// AC1.4: POST /
// ============================================================
describe('POST /', () => {
  it('should return 201 on success', async () => {
    const query = { _key: 'q1', text: 'test', sessionId: 's1' };
    queryService.createQuery.mockResolvedValue(query);

    const response = await authPost('/api/queries', { sessionId: 's1', text: 'test query' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(query);
  });

  it('should return 500 on service error', async () => {
    queryService.createQuery.mockRejectedValue(new Error('Create failed'));

    const response = await authPost('/api/queries', { sessionId: 's1' });

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Create failed');
  });
});

// ============================================================
// AC1.5: GET /:queryId
// ============================================================
describe('GET /:queryId', () => {
  it('should return 200 with query', async () => {
    const query = { _key: 'q1', text: 'test' };
    queryService.getQuery.mockResolvedValue(query);

    const response = await authGet('/api/queries/q1');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(query);
  });

  it('should return 500 on service error', async () => {
    queryService.getQuery.mockRejectedValue(new Error('Not found'));

    const response = await authGet('/api/queries/q1');

    expect(response.status).toBe(500);
  });

  // ============================================================
  // Additional SSE streaming coverage — behavioral tests
  // ============================================================

  // Helper: set up a working SSE stream pipeline
  function setupSSEStream() {
    queryService.initStreamQuery.mockResolvedValue({
      queryId: 'q1',
      opeaUrl: 'http://chatqna:8888/v1/chatqna',
      opeaPayload: { messages: [] }
    });
    queryService.parseChatQnASSELine.mockImplementation((data) => JSON.parse(data));
    queryService.finalizeStreamQuery.mockResolvedValue(undefined);

    const mockStream = new Readable({ read() {} });
    axios.post.mockResolvedValue({ data: mockStream });
    return mockStream;
  }

  describe('SSE stream error after headers sent', () => {
    it('should return 401 when req.user.iss_sub is missing', async () => {
      keycloakAuthMiddleware.authenticate.mockImplementation((req, res, next) => {
        req.user = { _key: 'user-123' }; // missing iss_sub
        next();
      });

      const response = await authPost('/api/queries/stream', { sessionId: 's1' });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('UNAUTHENTICATED');
    });
  });

  describe('SSE stream data type routing', () => {
    it('should forward chunk data as SSE events to client', async () => {
      const mockStream = setupSSEStream();

      const responsePromise = authPost('/api/queries/stream', {
        sessionId: 's1',
        messages: [{ role: 'user', content: 'hello' }]
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      mockStream.push('data: {"type":"chunk","content":"Hello "}\n\n');
      mockStream.push('data: {"type":"chunk","content":"world"}\n\n');
      mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
      mockStream.push(null);

      const response = await responsePromise;
      expect(response.status).toBe(200);
      expect(response.text).toContain('"type":"chunk","content":"Hello "');
      expect(response.text).toContain('"type":"chunk","content":"world"');
    });

    it('should not forward OPEA error type events to client as chunks', async () => {
      const mockStream = setupSSEStream();

      const responsePromise = authPost('/api/queries/stream', {
        sessionId: 's1',
        messages: [{ role: 'user', content: 'hello' }]
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      mockStream.push('data: {"type":"error","raw":"bad chunk"}\n\n');
      mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
      mockStream.push(null);

      const response = await responsePromise;
      expect(response.status).toBe(200);
      expect(response.text).not.toMatch(/data:.*"type":"chunk".*"bad chunk"/);
    });

    it('should trigger finalizeStreamQuery with accumulated text on done event', async () => {
      const mockStream = setupSSEStream();

      const responsePromise = authPost('/api/queries/stream', {
        sessionId: 's1',
        messages: [{ role: 'user', content: 'hello' }]
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      mockStream.push('data: {"type":"chunk","content":"Hello world"}\n\n');
      mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
      mockStream.push(null);

      await responsePromise;

      expect(queryService.finalizeStreamQuery).toHaveBeenCalledWith(
        'q1',
        'Hello world',
        expect.any(Number),
        expect.objectContaining({ source_documents: [], confidence_score: 0 })
      );
    });
  });

  describe('SSE stream end without explicit done', () => {
    it('should auto-finalize when stream ends with accumulated text but no done event', async () => {
      const mockStream = setupSSEStream();

      const responsePromise = authPost('/api/queries/stream', {
        sessionId: 's1',
        messages: [{ role: 'user', content: 'hello' }]
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      mockStream.push('data: {"type":"chunk","content":"Auto finalized"}\n\n');
      mockStream.push(null);

      const response = await responsePromise;
      expect(response.status).toBe(200);
      expect(queryService.finalizeStreamQuery).toHaveBeenCalledWith(
        'q1',
        'Auto finalized',
        expect.any(Number),
        expect.any(Object)
      );
    });
  });

  describe('SSE metadata retrieval', () => {
    // Helper: parse SSE text into structured events
    function parseSSEEvents(text) {
      return text
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => JSON.parse(line.slice(6)));
    }

    it('should forward chatqna metadata event with source documents + is_grounded', async () => {
      // chatqna now emits the reranker-grounded metadata in-stream; the backend forwards
      // it verbatim instead of running its own retrieval.
      const mockStream = setupSSEStream();
      const responsePromise = authPost('/api/queries/stream', {
        sessionId: 's1',
        messages: [{ role: 'user', content: 'hello' }]
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      mockStream.push('data: {"type":"chunk","content":"answer"}\n\n');
      mockStream.push(
        'data: {"type":"metadata","source_documents":[{"document_id":"f1","document_name":"bee.pdf","score":0.95}],"confidence_score":0.95,"is_grounded":true}\n\n'
      );
      mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
      mockStream.push(null);

      const response = await responsePromise;
      const metadata = parseSSEEvents(response.text).find((e) => e.type === 'metadata');
      expect(metadata).toBeDefined();
      expect(metadata.source_documents).toHaveLength(1);
      expect(metadata.source_documents[0].document_name).toBe('bee.pdf');
      expect(metadata.is_grounded).toBe(true);
      expect(metadata.confidence_score).toBe(0.95);
      expect(metadata.responseTime).toEqual(expect.any(Number));

      // The backend must persist the chatqna-provided metadata (no re-fetch).
      expect(queryService.finalizeStreamQuery).toHaveBeenCalledWith(
        'q1',
        'answer',
        expect.any(Number),
        expect.objectContaining({ source_documents: expect.any(Array), is_grounded: true })
      );
    });

    it('should forward not-grounded metadata (LLM-generated response)', async () => {
      const mockStream = setupSSEStream();
      const responsePromise = authPost('/api/queries/stream', {
        sessionId: 's1',
        messages: [{ role: 'user', content: 'hello' }]
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      mockStream.push('data: {"type":"chunk","content":"guessed answer"}\n\n');
      mockStream.push('data: {"type":"metadata","source_documents":[],"confidence_score":0,"is_grounded":false}\n\n');
      mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
      mockStream.push(null);

      const response = await responsePromise;
      const metadata = parseSSEEvents(response.text).find((e) => e.type === 'metadata');
      expect(metadata.is_grounded).toBe(false);
      expect(metadata.source_documents).toEqual([]);
    });

    it('should default to empty ungrounded metadata when chatqna sends no metadata event', async () => {
      const mockStream = setupSSEStream();
      const responsePromise = authPost('/api/queries/stream', {
        sessionId: 's1',
        messages: [{ role: 'user', content: 'hello' }]
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      mockStream.push('data: {"type":"chunk","content":"answer"}\n\n');
      mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
      mockStream.push(null);

      const response = await responsePromise;
      const metadata = parseSSEEvents(response.text).find((e) => e.type === 'metadata');
      expect(metadata).toBeDefined();
      expect(metadata.source_documents).toEqual([]);
      expect(metadata.is_grounded).toBe(false);
      // The no-metadata-event fallback keeps the same key set as the captured
      // one, so a stored query does not depend on whether chatqna answered.
      expect(metadata.retrieval_confidence_score).toBeNull();
      // null, not false: no metadata event is not the same as a clean
      // low-confidence non-abstention.
      expect(metadata.abstained).toBeNull();
      expect(metadata.abstention_reason).toBeNull();
      expect(metadata).not.toHaveProperty('self_confidence');
    });

    // These four fields never reach the chat UI. They are the diagnostic half of
    // the envelope: without them a persisted query cannot be explained after the
    // fact — an ingestion-side abstention is indistinguishable from an ordinary
    // low-confidence one, and a self-grade that overrode a 0.26 retrieval score
    // is invisible unless someone reconstructs it from the traces by hand.
    it('should forward the diagnostic metadata fields and persist them', async () => {
      const mockStream = setupSSEStream();
      const responsePromise = authPost('/api/queries/stream', {
        sessionId: 's1',
        messages: [{ role: 'user', content: 'hello' }]
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      mockStream.push('data: {"type":"chunk","content":"answer"}\n\n');
      mockStream.push(
        'data: {"type":"metadata","source_documents":[],"confidence_score":1,"retrieval_confidence_score":0.26,"self_confidence":0.85,"is_grounded":true,"abstained":false,"abstention_reason":null}\n\n'
      );
      mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
      mockStream.push(null);

      const response = await responsePromise;
      const metadata = parseSSEEvents(response.text).find((e) => e.type === 'metadata');
      expect(metadata.retrieval_confidence_score).toBe(0.26);
      expect(metadata.self_confidence).toBe(0.85);
      expect(metadata.abstained).toBe(false);
      expect(metadata.abstention_reason).toBeNull();

      // The divergence is only useful if it survives persistence — ArangoDB is
      // where post-hoc analysis reads from.
      expect(queryService.finalizeStreamQuery).toHaveBeenCalledWith(
        'q1',
        'answer',
        expect.any(Number),
        expect.objectContaining({
          confidence_score: 1,
          retrieval_confidence_score: 0.26,
          self_confidence: 0.85,
          abstained: false,
          abstention_reason: null
        })
      );
    });

    it('should omit self_confidence when chatqna sends none', async () => {
      // The admin inspector renders its Self-Confidence block on
      // hasOwnProperty(metadata, 'self_confidence'), and chatqna only sets the
      // key when LLM_SELF_CONFIDENCE_ENABLED. Forwarding a normalised null would
      // make the block render on every query and report "no sentinel" for a
      // feature that is simply switched off.
      const mockStream = setupSSEStream();
      const responsePromise = authPost('/api/queries/stream', {
        sessionId: 's1',
        messages: [{ role: 'user', content: 'hello' }]
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      mockStream.push('data: {"type":"chunk","content":"answer"}\n\n');
      mockStream.push(
        'data: {"type":"metadata","source_documents":[],"confidence_score":0.5,"retrieval_confidence_score":0.5,"is_grounded":true,"abstained":false,"abstention_reason":null}\n\n'
      );
      mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
      mockStream.push(null);

      const response = await responsePromise;
      const metadata = parseSSEEvents(response.text).find((e) => e.type === 'metadata');
      expect(metadata).not.toHaveProperty('self_confidence');

      const persisted = queryService.finalizeStreamQuery.mock.calls[0][3];
      expect(persisted).not.toHaveProperty('self_confidence');
    });

    it('should keep an explicit null self_confidence so the inspector can say "no sentinel"', async () => {
      // chatqna sets self_confidence to null when LLM_SELF_CONFIDENCE_ENABLED is
      // on but the LLM omitted the [[CONF:…]] sentinel. The inspector renders
      // its block on key presence and this state on a null value — dropping the
      // key would make the block vanish instead of explaining the missing grade.
      const mockStream = setupSSEStream();
      const responsePromise = authPost('/api/queries/stream', {
        sessionId: 's1',
        messages: [{ role: 'user', content: 'hello' }]
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      mockStream.push('data: {"type":"chunk","content":"answer"}\n\n');
      mockStream.push(
        'data: {"type":"metadata","source_documents":[],"confidence_score":0.4,"retrieval_confidence_score":0.4,"self_confidence":null,"is_grounded":true,"abstained":false,"abstention_reason":null}\n\n'
      );
      mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
      mockStream.push(null);

      const response = await responsePromise;
      const metadata = parseSSEEvents(response.text).find((e) => e.type === 'metadata');
      expect(metadata).toHaveProperty('self_confidence', null);

      const persisted = queryService.finalizeStreamQuery.mock.calls[0][3];
      expect(persisted).toHaveProperty('self_confidence', null);
    });

    it('should forward every field chatqna sends, including ones added later', async () => {
      // The relay forwards the parser's object whole. A hand-written field
      // list here is how retrieval_confidence_score and self_confidence were
      // lost: parsed, then dropped one layer down.
      const mockStream = setupSSEStream();
      const responsePromise = authPost('/api/queries/stream', {
        sessionId: 's1',
        messages: [{ role: 'user', content: 'hello' }]
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      mockStream.push('data: {"type":"chunk","content":"answer"}\n\n');
      mockStream.push(
        'data: {"type":"metadata","source_documents":[],"confidence_score":0,"is_grounded":false,"abstained":true,"abstention_reason":"reranker_input_too_long","translation_status":"failed"}\n\n'
      );
      mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
      mockStream.push(null);

      const response = await responsePromise;
      const metadata = parseSSEEvents(response.text).find((e) => e.type === 'metadata');
      expect(metadata.translation_status).toBe('failed');
      // The event discriminator is not part of the payload.
      expect(metadata.type).toBe('metadata');

      const persisted = queryService.finalizeStreamQuery.mock.calls[0][3];
      expect(persisted.translation_status).toBe('failed');
      expect(persisted).not.toHaveProperty('type');
    });

    it('should forward an abstention reason so it can be told apart from a plain ungrounded answer', async () => {
      const mockStream = setupSSEStream();
      const responsePromise = authPost('/api/queries/stream', {
        sessionId: 's1',
        messages: [{ role: 'user', content: 'hello' }]
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      mockStream.push('data: {"type":"chunk","content":"I cannot answer that."}\n\n');
      mockStream.push(
        'data: {"type":"metadata","source_documents":[],"confidence_score":0,"is_grounded":false,"abstained":true,"abstention_reason":"reranker_input_too_long"}\n\n'
      );
      mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
      mockStream.push(null);

      const response = await responsePromise;
      const metadata = parseSSEEvents(response.text).find((e) => e.type === 'metadata');
      expect(metadata.abstained).toBe(true);
      expect(metadata.abstention_reason).toBe('reranker_input_too_long');

      expect(queryService.finalizeStreamQuery).toHaveBeenCalledWith(
        'q1',
        'I cannot answer that.',
        expect.any(Number),
        expect.objectContaining({ abstained: true, abstention_reason: 'reranker_input_too_long' })
      );
    });
  });

  describe('SSE translation', () => {
    const translationService = require('../../services/translation-service');

    it('should emit translation SSE event for non-EN language', async () => {
      const mockStream = setupSSEStream();
      translationService.init.mockResolvedValue(undefined);
      translationService.translateMarkdown.mockResolvedValue('Bonjour monde');

      const responsePromise = authPost('/api/queries/stream', {
        sessionId: 's1',
        messages: [{ role: 'user', content: 'hello' }],
        context: { language: 'FR' }
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      mockStream.push('data: {"type":"chunk","content":"Hello world"}\n\n');
      mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
      mockStream.push(null);

      const response = await responsePromise;
      expect(response.status).toBe(200);
      expect(translationService.translateMarkdown).toHaveBeenCalledWith('Hello world', 'en', 'fr');
      expect(response.text).toContain('"type":"translation","content":"Bonjour monde"');
    });

    it('should report a post-stream translation failure on done, not as an error', async () => {
      const mockStream = setupSSEStream();
      translationService.init.mockResolvedValue(undefined);
      translationService.translateMarkdown.mockRejectedValue(new Error('Translation service down'));

      const responsePromise = authPost('/api/queries/stream', {
        sessionId: 's1',
        messages: [{ role: 'user', content: 'hello' }],
        context: { language: 'DE' }
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      mockStream.push('data: {"type":"chunk","content":"Hello"}\n\n');
      mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
      mockStream.push(null);

      const response = await responsePromise;
      expect(response.status).toBe(200);
      expect(response.text).toContain('"type":"done","queryId":"q1","translationFailed":true');
      expect(response.text).not.toContain('"type":"error"');
    });

    it('should report translationFailed=false when translation succeeds', async () => {
      const mockStream = setupSSEStream();
      translationService.init.mockResolvedValue(undefined);
      translationService.translateMarkdown.mockResolvedValue('Hallo');

      const responsePromise = authPost('/api/queries/stream', {
        sessionId: 's1',
        messages: [{ role: 'user', content: 'hello' }],
        context: { language: 'DE' }
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      mockStream.push('data: {"type":"chunk","content":"Hello"}\n\n');
      mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
      mockStream.push(null);

      const response = await responsePromise;
      expect(response.status).toBe(200);
      expect(response.text).toContain('"type":"done","queryId":"q1","translationFailed":false');
    });

    it('should ignore a language that is not a string', async () => {
      // The language comes from the request body. A value that is not a
      // string is not a language: the request still succeeds and no
      // translation is attempted.
      const mockStream = setupSSEStream();
      translationService.init.mockResolvedValue(undefined);
      translationService.translateMarkdown.mockResolvedValue('Bonjour monde');

      const responsePromise = authPost('/api/queries/stream', {
        sessionId: 's1',
        messages: [{ role: 'user', content: 'hello' }],
        context: { language: 42 }
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      mockStream.push('data: {"type":"chunk","content":"Hello world"}\n\n');
      mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
      mockStream.push(null);

      const response = await responsePromise;
      expect(response.status).toBe(200);
      expect(translationService.translateMarkdown).not.toHaveBeenCalled();
      // The stream still completes: the answer is delivered in English.
      expect(response.text).toContain('"type":"done"');
    });
  });

  describe('SSE finalize failure resilience', () => {
    it('should still send done event when finalizeStreamQuery rejects', async () => {
      const mockStream = setupSSEStream();
      queryService.finalizeStreamQuery.mockRejectedValue(new Error('DB write failed'));

      const responsePromise = authPost('/api/queries/stream', {
        sessionId: 's1',
        messages: [{ role: 'user', content: 'hello' }]
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      mockStream.push('data: {"type":"chunk","content":"Hello"}\n\n');
      mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
      mockStream.push(null);

      const response = await responsePromise;
      expect(response.status).toBe(200);
      expect(response.text).toContain('"type":"done","queryId":"q1"');
    });
  });

  // The chatqna request is the ONE place genie.query_id attaches to outgoing
  // traffic. Everything else here proves the stream works, not that the
  // correlation id rides along with it — deleting the withBaggage wrapper in
  // query-routes.js leaves every other test in this file green.
  describe('query id correlation baggage', () => {
    const QUERY_ID_KEY = 'genie.query_id';

    // Serialize the active baggage the way the W3C header would carry it.
    const activeBaggageEntries = () => {
      const baggage = propagation.getActiveBaggage();
      if (!baggage) return [];
      return [...baggage.getAllEntries()].map(([key, entry]) => `${key}=${entry.value}`);
    };

    // The baggage must be read INSIDE the mock, at call time. Reading it after
    // the handler returns would observe an already-unwound context and pass
    // vacuously — that timing is the entire test.
    const captureBaggageOnPost = () => {
      const seen = [];
      axios.post.mockImplementation(() => {
        seen.push(activeBaggageEntries());
        const mockStream = new Readable({ read() {} });
        mockStream.push('data: {"type":"chunk","content":"hi"}\n\n');
        mockStream.push('data: {"type":"done","queryId":"q-1"}\n\n');
        mockStream.push(null);
        return Promise.resolve({ data: mockStream });
      });
      return seen;
    };

    beforeEach(() => {
      queryService.parseChatQnASSELine.mockImplementation((data) => JSON.parse(data));
      queryService.finalizeStreamQuery.mockResolvedValue(undefined);
    });

    it('carries genie.query_id on the chatqna request when a query id exists', async () => {
      queryService.initStreamQuery.mockResolvedValue({
        queryId: 'q-1',
        opeaUrl: 'http://chatqna:8888/v1/chatqna',
        opeaPayload: { messages: [] }
      });
      const seen = captureBaggageOnPost();

      const response = await authPost('/api/queries/stream', {
        sessionId: 's1',
        messages: [{ role: 'user', content: 'hello' }]
      });

      expect(response.status).toBe(200);
      expect(seen).toEqual([[`${QUERY_ID_KEY}=q-1`]]);
    });

    it('sends no baggage at all when there is no query id, never the string "undefined"', async () => {
      queryService.initStreamQuery.mockResolvedValue({
        opeaUrl: 'http://chatqna:8888/v1/chatqna',
        opeaPayload: { messages: [] }
      });
      const seen = captureBaggageOnPost();

      const response = await authPost('/api/queries/stream', {
        sessionId: 's1',
        messages: [{ role: 'user', content: 'hello' }]
      });

      expect(response.status).toBe(200);
      expect(seen).toEqual([[]]);
      // `propagation.createBaggage` coerces undefined to the literal string
      // "undefined", which passes every downstream shape check and joins to
      // nothing. Assert on the flattened entries so any such value is caught.
      expect(seen.flat().join(',')).not.toContain('undefined');
    });
  });
});

// The id must also land on the span covering THIS handler, not only on the
// outbound request. Baggage alone covers the trace when chatqna gets far enough
// to stamp something; the server span is what keeps a turn joinable to the
// stored query when it does not — a chatqna call that times out, or dies
// before its first span is exported.
//
// Driven by calling the route handler directly, inside a real active span:
// supertest runs the handler on the server side of an in-process HTTP hop, and
// the AsyncLocalStorage context of the test does NOT cross it (verified — an
// outer active span is not visible in an Express handler under supertest). A
// direct call keeps the context in one chain, and it is the only way to put a
// real recording span in front of the handler without standing up the full SDK.
describe('query id correlation on the server span', () => {
  const QUERY_ID_KEY = 'genie.query_id';
  const { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');

  let spanExporter;
  let tracer;
  let streamHandler;

  beforeAll(() => {
    spanExporter = new InMemorySpanExporter();
    // BasicTracerProvider, NOT the global provider: `trace.setTracerProvider`
    // is once-per-process and the rest of this file runs against the default
    // no-op provider. The node provider's own constructor ignores a
    // `spanProcessors` config in SDK 2.x — verified — so it would silently
    // export nothing.
    const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spanExporter)] });
    tracer = provider.getTracer('test.query-routes');

    const buildRouter = require('../../routes/query-routes');
    const layer = buildRouter(queryService).stack.find((entry) => entry.route && entry.route.path === '/stream');
    streamHandler = layer.route.stack[0].handle;
  });

  beforeEach(() => {
    spanExporter.reset();
  });

  // axios.post is made to reject so the handler takes its error path: the
  // correlation id is stamped before the request goes out, and this way no
  // keepalive interval or stream listener survives the test.
  const _runStreamHandler = async ({ queryId }) => {
    queryService.initStreamQuery.mockResolvedValue({
      queryId,
      opeaUrl: 'http://chatqna:8888/v1/chatqna',
      opeaPayload: { messages: [] }
    });
    axios.post.mockRejectedValue(Object.assign(new Error('upstream down'), { code: 'ECONNABORTED' }));

    const res = {
      writableEnded: false,
      headersSent: false,
      writeHead: jest.fn(() => {
        res.headersSent = true;
      }),
      write: jest.fn(),
      end: jest.fn(() => {
        res.writableEnded = true;
      }),
      status: jest.fn(() => res),
      json: jest.fn()
    };
    const req = {
      user: { iss_sub: 'http://localhost:8080/realms/genie#user-123' },
      body: { sessionId: 's1', messages: [{ role: 'user', content: 'hello' }] },
      headers: { authorization: 'Bearer t' },
      on: jest.fn()
    };

    // startSpan + context.with rather than startActiveSpan: the SDK version
    // pinned here does not export the span startActiveSpan opens (verified),
    // so the end has to be explicit for the assertion to see anything.
    const span = tracer.startSpan('express.server POST /api/queries/stream');
    try {
      await context.with(trace.setSpan(context.active(), span), async () => {
        await streamHandler(req, res);
      });
    } finally {
      span.end();
    }
  };

  const _serverSpan = () => {
    const [span] = spanExporter.getFinishedSpans().filter((s) => s.name.startsWith('express.server'));
    return span;
  };

  it('stamps genie.query_id on the span covering the handler', async () => {
    await _runStreamHandler({ queryId: 'q-42' });

    expect(_serverSpan().attributes[QUERY_ID_KEY]).toBe('q-42');
  });

  it('writes nothing when there is no query id, never a placeholder', async () => {
    await _runStreamHandler({ queryId: undefined });

    const span = _serverSpan();
    expect(span).toBeDefined();
    expect(QUERY_ID_KEY in span.attributes).toBe(false);
  });
});

// ============================================================
// AC1.6: POST /:queryId/feedback
// ============================================================
describe('POST /:queryId/feedback', () => {
  it('should return 200 on success', async () => {
    const updated = { _key: 'q1', feedback: { rating: 5 } };
    queryService.addFeedback.mockResolvedValue(updated);

    const response = await authPost('/api/queries/q1/feedback', { rating: 5 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(updated);
  });

  it('should return 500 via next(error) on service failure', async () => {
    queryService.addFeedback.mockRejectedValue(new Error('Feedback failed'));

    const response = await authPost('/api/queries/q1/feedback', { rating: 5 });

    expect(response.status).toBe(500);
  });
});

// ============================================================
// AC1.7: PATCH /:queryId/answered
// ============================================================
describe('PATCH /:queryId/answered', () => {
  it('should return 200 on success', async () => {
    const updated = { _key: 'q1', isAnswered: true, responseTime: 500 };
    queryService.markQueryAsAnswered.mockResolvedValue(updated);

    const response = await authPatch('/api/queries/q1/answered', { responseTime: 500 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(updated);
  });

  it('should return 400 when responseTime is missing', async () => {
    const response = await authPatch('/api/queries/q1/answered', {});

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('required');
  });
});

// ============================================================
// AC1.8: GET / (search queries with pagination)
// ============================================================
describe('GET /', () => {
  it('should return 200 with pagination', async () => {
    const results = { queries: [{ _key: 'q1' }], pagination: { total: 1, limit: 20, offset: 0 } };
    queryService.searchQueries.mockResolvedValue(results);

    const response = await authGet('/api/queries');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(results);
  });

  it('should pass query params: limit, offset, sessionId, text', async () => {
    queryService.searchQueries.mockResolvedValue({ queries: [], pagination: {} });

    const response = await authGet('/api/queries?limit=10&offset=5&sessionId=s1&text=hello');

    expect(response.status).toBe(200);
    expect(queryService.searchQueries).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's1', text: 'hello', userId: expect.any(String) }),
      10,
      5
    );
  });

  it('should return 500 on service error', async () => {
    queryService.searchQueries.mockRejectedValue(new Error('Search failed'));

    const response = await authGet('/api/queries');

    expect(response.status).toBe(500);
  });
});

// ============================================================
// AC1.9: GET /:queryId/conversations
// ============================================================
describe('GET /:queryId/conversations', () => {
  it('should return 200 with conversations', async () => {
    const conversations = [{ _key: 'c1', title: 'Chat' }];
    queryService.getConversationsForQuery.mockResolvedValue(conversations);

    const response = await authGet('/api/queries/q1/conversations');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(conversations);
    expect(queryService.getConversationsForQuery).toHaveBeenCalledWith(
      'q1',
      'http://localhost:8080/realms/genie#user-123'
    );
  });

  it('should return 403 when caller does not own the query', async () => {
    queryService.getConversationsForQuery.mockRejectedValue(new Error('Access denied'));

    const response = await authGet('/api/queries/q-other/conversations');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ success: false, message: 'Access denied' });
  });

  it('should return 400 when userId is missing', async () => {
    keycloakAuthMiddleware.authenticate.mockImplementation((req, res, next) => {
      req.user = { iss_sub: undefined, _key: 'user-123' };
      next();
    });

    const response = await authGet('/api/queries/q1/conversations');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      message: 'User ID is required'
    });
    expect(queryService.getConversationsForQuery).not.toHaveBeenCalled();
  });

  it('should return 500 via next(error) on service failure', async () => {
    queryService.getConversationsForQuery.mockRejectedValue(new Error('DB error'));

    const response = await authGet('/api/queries/q1/conversations');

    expect(response.status).toBe(500);
  });
});

// ============================================================
// AC1.10: POST /:queryId/conversation
// ============================================================
describe('POST /:queryId/conversation', () => {
  it('should return 201 on success', async () => {
    const result = { conversation: { _key: 'c1' } };
    queryService.createConversationFromQuery.mockResolvedValue(result);

    const response = await authPost('/api/queries/q1/conversation', { title: 'New chat' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(result);
  });

  it('should return 500 via next(error) on service failure', async () => {
    queryService.createConversationFromQuery.mockRejectedValue(new Error('Create failed'));

    const response = await authPost('/api/queries/q1/conversation', {});

    expect(response.status).toBe(500);
  });
});

// ============================================================
// AC1.11: POST /:queryId/link/:messageId
// ============================================================
describe('POST /:queryId/link/:messageId', () => {
  it('should return 200 on success', async () => {
    const result = { success: true };
    queryService.linkQueryToMessage.mockResolvedValue(result);

    const response = await authPost('/api/queries/q1/link/m1', { responseType: 'primary' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(result);
    expect(queryService.linkQueryToMessage).toHaveBeenCalledWith('q1', 'm1', { responseType: 'primary' });
  });

  it('should return 500 via next(error) on service failure', async () => {
    queryService.linkQueryToMessage.mockRejectedValue(new Error('Link failed'));

    const response = await authPost('/api/queries/q1/link/m1', {});

    expect(response.status).toBe(500);
  });
});
