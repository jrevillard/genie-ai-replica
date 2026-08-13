'use strict';

require('../setup-env');

process.env.OPEA_STREAMING = 'true';
process.env.CHATQNA_STREAM_TIMEOUT = '5000';

const { Readable } = require('stream');
const translationService = require('../../services/translation-service');

// Mock shared-lib — virtual because it only exists after Docker packaging
jest.mock('../../shared-lib', () => require('../mocks/shared-lib'), { virtual: true });

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
  rolloverLogs: jest.fn(),
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
  init: jest.fn()
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
  process.env.OPEA_STREAMING = 'true';
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

  it('should fall back to the EN unit when stream translation fails (#829)', async () => {
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

    it('should emit TRANSLATION_FAILED error event when translation fails', async () => {
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
      expect(response.text).toContain('TRANSLATION_FAILED');
      expect(response.text).toContain('"type":"done","queryId":"q1"');
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
