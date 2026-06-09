'use strict';

require('../setup-env');

process.env.OPEA_STREAMING = 'true';
process.env.CHATQNA_STREAM_TIMEOUT = '5000';

const { Readable } = require('stream');

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
    it('should default to empty metadata when retriever call fails', async () => {
      const mockStream = setupSSEStream();
      axios.post.mockResolvedValueOnce({ data: mockStream }).mockRejectedValueOnce(new Error('Retriever unavailable'));

      const responsePromise = authPost('/api/queries/stream', {
        sessionId: 's1',
        messages: [{ role: 'user', content: 'hello' }]
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
      mockStream.push(null);

      const response = await responsePromise;
      expect(response.status).toBe(200);
      expect(response.text).toMatch(/"type":"metadata"/);
      expect(queryService.finalizeStreamQuery).toHaveBeenCalledWith(
        'q1',
        '',
        expect.any(Number),
        expect.objectContaining({ source_documents: [], confidence_score: 0 })
      );
    });

    // Helper: parse SSE text into structured events
    function parseSSEEvents(text) {
      return text
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => JSON.parse(line.slice(6)));
    }

    // Helper: set up mocks for a full metadata retrieval flow
    function setupMetadataMocks(retrieverDocs, fileResponses) {
      queryService.initStreamQuery.mockResolvedValue({
        queryId: 'q1',
        opeaUrl: 'http://chatqna:8888/v1/chatqna',
        opeaPayload: { messages: [] }
      });
      queryService.parseChatQnASSELine.mockImplementation((data) => JSON.parse(data));
      queryService.finalizeStreamQuery.mockResolvedValue(undefined);

      const mockStream = new Readable({ read() {} });

      // Chain: ChatQnA SSE → retriever → document-repository calls
      axios.post
        .mockResolvedValueOnce({ data: mockStream }) // ChatQnA stream
        .mockResolvedValueOnce({ data: { retrieved_docs: retrieverDocs } }); // retriever

      // Mock axios.get for document-repository calls
      axios.get = jest.fn().mockImplementation(async (url) => {
        const fileId = url.split('/').pop();
        const resp = fileResponses[fileId];
        if (resp) return { data: resp };
        throw new Error(`Unexpected file request: ${fileId}`);
      });

      return mockStream;
    }

    it('should return source documents with real scores from retriever', async () => {
      const mockStream = setupMetadataMocks(
        [
          { text: 'chunk1', metadata: { file_ids: ['file-123'], score: 0.85 } },
          { text: 'chunk2', metadata: { file_ids: ['file-456'], score: 0.72 } }
        ],
        {
          'file-123': { success: true, data: { file_name: 'doc.pdf' } },
          'file-456': { success: true, data: { file_name: 'doc2.pdf' } }
        }
      );

      const responsePromise = authPost('/api/queries/stream', {
        sessionId: 's1',
        messages: [{ role: 'user', content: 'test query' }]
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      mockStream.push('data: {"type":"chunk","content":"response"}\n\n');
      mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
      mockStream.push(null);

      const response = await responsePromise;
      const metadata = parseSSEEvents(response.text).find((e) => e.type === 'metadata');

      expect(metadata).toBeDefined();
      expect(metadata.source_documents).toHaveLength(2);
      expect(metadata.source_documents[0].document_name).toBe('doc.pdf');
      expect(metadata.source_documents[0].score).toBe(0.85);
      expect(metadata.confidence_score).toBeCloseTo(0.785, 1);
    });

    it('should deduplicate by file_id keeping highest score', async () => {
      const mockStream = setupMetadataMocks(
        [
          { text: 'chunk1', metadata: { file_ids: ['file-123'], score: 0.9 } },
          { text: 'chunk2', metadata: { file_ids: ['file-123'], score: 0.7 } },
          { text: 'chunk3', metadata: { file_ids: ['file-456'], score: 0.8 } }
        ],
        {
          'file-123': { success: true, data: { file_name: 'doc.pdf' } },
          'file-456': { success: true, data: { file_name: 'doc2.pdf' } }
        }
      );

      const responsePromise = authPost('/api/queries/stream', {
        sessionId: 's1',
        messages: [{ role: 'user', content: 'test' }]
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
      mockStream.push(null);

      const response = await responsePromise;
      const metadata = parseSSEEvents(response.text).find((e) => e.type === 'metadata');

      expect(metadata.source_documents).toHaveLength(2);
      expect(metadata.source_documents[0].score).toBe(0.9);
      expect(metadata.source_documents[1].score).toBe(0.8);
    });

    it('should extract last user message when empty assistant placeholder is appended', async () => {
      const mockStream = setupMetadataMocks([{ text: 'chunk1', metadata: { file_ids: ['file-123'], score: 0.6 } }], {
        'file-123': { success: true, data: { file_name: 'result.pdf' } }
      });

      const responsePromise = authPost('/api/queries/stream', {
        sessionId: 's1',
        messages: [
          { role: 'assistant', content: 'Previous response' },
          { role: 'user', content: 'actual user query' },
          { role: 'assistant', content: '' }
        ]
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
      mockStream.push(null);

      const response = await responsePromise;
      const metadata = parseSSEEvents(response.text).find((e) => e.type === 'metadata');

      expect(metadata.source_documents).toHaveLength(1);
      expect(metadata.source_documents[0].document_name).toBe('result.pdf');
    });

    it('should read file_name from nested document-repository response', async () => {
      const mockStream = setupMetadataMocks([{ text: 'chunk1', metadata: { file_ids: ['file-789'], score: 0.55 } }], {
        'file-789': { success: true, data: { file_name: 'nested-doc.pdf' } }
      });

      const responsePromise = authPost('/api/queries/stream', {
        sessionId: 's1',
        messages: [{ role: 'user', content: 'test' }]
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      mockStream.push('data: {"type":"done","queryId":"q1"}\n\n');
      mockStream.push(null);

      const response = await responsePromise;
      const metadata = parseSSEEvents(response.text).find((e) => e.type === 'metadata');

      expect(metadata.source_documents[0].document_name).toBe('nested-doc.pdf');
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
