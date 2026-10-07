'use strict';

// Story 1.1 — end-to-end wire-up: HTTP request → createApp → REAL
// query-service.initStreamQuery → the chatqna OPEA call. Pins (a) the legacy
// byte-identical regression, (b) the hybrid carrier shape, (c) bearer scope
// isolation (two users → different graph sets). The okf-server and chatqna
// are stubbed at the axios boundary.

require('./setup-env');

process.env.OPEA_STREAMING = 'true';
process.env.CONTEXT_OPTION = 'conversation-with-context-labels';
delete process.env.ARANGO_GRAPH_NAME; // deterministic default 'GRAPH'

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock(
  '../shared-lib',
  () => ({
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    },
    dbService: { getConnection: jest.fn() },
    securityHeaders: (req, res, next) => next(),
    SecurityMiddleware: { applySecurityMiddleware: jest.fn() },
    reconfigureLogger: jest.fn(),
    parsePositiveInt: require('./mocks/shared-lib').parsePositiveInt
  }),
  { virtual: true }
);

jest.mock('arangojs', () => ({
  aql: (strings, ...values) => ({ _aql: true, strings, values })
}));

// The okf-server + chatqna boundary — axios.get is the okf-server client,
// axios.post is the OPEA chatqna stream.
jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn()
}));

// Translation service (loaded by query-routes; unused in these streams).
jest.mock('../services/translation-service', () => ({
  translate: jest.fn(),
  translateMarkdown: jest.fn(),
  translateStream: jest.fn(),
  init: jest.fn()
}));

// The retrieval posture client — stubbed per scenario.
jest.mock('../services/retrieval-config-client', () => ({
  getRetrievalConfig: jest.fn(),
  getAuthorizedGraphs: jest.fn(),
  OkfAuthzUnauthorizedError: class OkfAuthzUnauthorizedError extends Error {
    constructor(message) {
      super(message);
      this.statusCode = 401;
      this.code = 'OKF_UNAUTHORIZED';
    }
  }
}));

// Keycloak middleware — pass-through authenticated user (the fan-out carrier
// reads the RAW bearer header for the okf-server calls).
jest.mock('../middleware/keycloak-auth-middleware', () => ({
  keycloakAuthMiddleware: {
    authenticate: jest.fn((req, res, next) => {
      req.user = { iss_sub: 'http://localhost:8080/realms/genie#user-1', _key: 'user-1' };
      next();
    }),
    requireAdmin: jest.fn((req, res, next) => next())
  }
}));

// Heavy services loaded by index.js (unused by the stream route).
jest.mock('../services/user-profile-service', () => ({}));
jest.mock('../services/analytics-service', () => ({ recordQuery: jest.fn(), recordFeedback: jest.fn() }));
jest.mock('../services/chat-history-service', () => ({}));
jest.mock('../services/service-category-service', () => ({}));
jest.mock('../services/database-operations-service', () => ({}));
jest.mock('../services/admin-dashboard-service', () => ({ getSystemHealth: jest.fn() }));
jest.mock('../services/logs-service', () => ({ getLogsSummary: jest.fn() }));
jest.mock('../services/security-scan-service', () => ({ getLastScanDetails: jest.fn(), runSecurityScan: jest.fn() }));
jest.mock('../services/session-service', () => ({
  getUserSessions: jest.fn(),
  endSession: jest.fn(),
  createSession: jest.fn()
}));
jest.mock('../services/user-provisioning-service', () => ({
  provisionUser: jest.fn(),
  initialize: jest.fn(),
  markUserAsDeleted: jest.fn()
}));
jest.mock('../services/weather-service', () => ({}));

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

const originalExit = process.exit;
beforeAll(() => {
  process.exit = jest.fn();
});
afterAll(() => {
  process.exit = originalExit;
});

const axios = require('axios');
const { Readable } = require('stream');

function sseStream(lines) {
  let i = 0;
  return new Readable({
    read() {
      if (i < lines.length) {
        this.push(`data: ${lines[i++]}\n\n`);
      } else {
        this.push(null);
      }
    }
  });
}

const HYBRID_CONFIG = {
  config: { mode: 'hybrid' },
  source: 'database',
  serving_graph_count: 2,
  serving_repo_ids: ['a', 'b'],
  serving_graphs: [],
  engaged: true,
  warnings: []
};

const LEGACY_CONFIG = {
  config: { mode: 'legacy' },
  source: 'env-defaults',
  serving_graph_count: 0,
  serving_repo_ids: [],
  serving_graphs: [],
  engaged: false,
  warnings: []
};

const BEARER_A = 'Bearer token-user-a';
const BEARER_B = 'Bearer token-user-b';

const chatBody = (authorization) => ({
  sessionId: 'session-e2e',
  messages: [{ role: 'user', content: 'Que servicios hay?' }],
  context: { categoryLabel: null, serviceLabels: [], language: 'EN' },
  // the raw header is forwarded by the route — carry the caller identity here
  authorization
});

let app;
let queryService;

beforeAll(async () => {
  // The REAL query service — only its DB seams are mocked.
  queryService = require('../services/query-service');
  const mockDb = {
    collection: jest.fn().mockReturnValue({
      save: jest.fn().mockResolvedValue({ _key: 'query-e2e-1' }),
      update: jest.fn().mockResolvedValue({ _key: 'query-e2e-1' })
    }),
    query: jest.fn()
  };
  const { dbService } = require('../shared-lib');
  dbService.getConnection.mockResolvedValue(mockDb);
  queryService.db = mockDb;
  queryService.queries = mockDb.collection();
  queryService.serviceCategories = mockDb.collection();
  queryService.services = mockDb.collection();
  queryService.initialized = true;

  const { createApp } = require('../index');
  app = createApp({ services: { queryService } });
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.OPEA_STREAMING = 'true';
  // Stream: one token chunk, chatqna's metadata event, then DONE.
  axios.post.mockImplementation(async (url, _payload) => {
    expect(url).toMatch(/\/v1\/chatqna$/);
    return {
      data: sseStream([
        `b'Hola '`,
        `b'mundo'`,
        JSON.stringify({ type: 'metadata', source_documents: [], confidence_score: 0, is_grounded: false }),
        '[DONE]'
      ])
    };
  });
});

afterEach(() => {
  delete process.env.ARANGO_GRAPH_NAME;
});

function authPost(body, bearer) {
  const req = require('supertest')(app).post('/api/queries/stream');
  if (bearer) req.set('Authorization', bearer);
  return req.send(body);
}

describe('e2e fan-out wire-up (Story 1.1)', () => {
  it('legacy mode: the chatqna payload is byte-identical to the pre-1.1 shape', async () => {
    const { getRetrievalConfig } = require('../services/retrieval-config-client');
    getRetrievalConfig.mockResolvedValue(LEGACY_CONFIG);

    const res = await authPost(chatBody(), BEARER_A);

    expect(res.status).toBe(200);
    expect(axios.post).toHaveBeenCalledTimes(1);
    const payload = axios.post.mock.calls[0][1];
    expect(payload.context).toEqual({
      categoryLabel: null,
      serviceLabels: [],
      language: 'EN'
    });
    expect(Object.keys(payload.context).sort()).toEqual(['categoryLabel', 'language', 'serviceLabels']);
  });

  it('hybrid mode engaged: the payload carries the carrier with GRAPH first, OKF graphs after', async () => {
    process.env.ARANGO_GRAPH_NAME = 'GRAPH';
    const client = require('../services/retrieval-config-client');
    client.getRetrievalConfig.mockResolvedValue(HYBRID_CONFIG);
    client.getAuthorizedGraphs.mockResolvedValue({ graph_names: ['OKF_agro_v1', 'OKF_health_v2'] });

    const res = await authPost(chatBody(), BEARER_A);

    expect(res.status).toBe(200);
    const payload = axios.post.mock.calls[0][1];
    expect(payload.context.authorized_graph_names).toEqual(['GRAPH', 'OKF_agro_v1', 'OKF_health_v2']);
    expect(payload.context.mode).toBe('hybrid');
    // The bearer was forwarded to the okf-server client calls.
    expect(client.getRetrievalConfig).toHaveBeenCalledWith(
      BEARER_A,
      expect.objectContaining({ correlationId: expect.any(String) })
    );
    expect(client.getAuthorizedGraphs).toHaveBeenCalledWith(BEARER_A, expect.anything());
    // The stream completed.
    expect(res.text).toContain('"type":"done"');
  });

  it('bearer scope isolation: two different users resolve different graph sets per turn', async () => {
    process.env.ARANGO_GRAPH_NAME = 'GRAPH';
    const client = require('../services/retrieval-config-client');
    client.getRetrievalConfig.mockImplementation(async (bearer) =>
      bearer === BEARER_B ? { ...HYBRID_CONFIG, serving_graph_count: 1 } : HYBRID_CONFIG
    );
    client.getAuthorizedGraphs.mockImplementation(async (bearer) =>
      bearer === BEARER_B ? { graph_names: ['OKF_health_v2'] } : { graph_names: ['OKF_agro_v1'] }
    );

    await authPost(chatBody(), BEARER_A);
    await authPost(chatBody(), BEARER_B);

    const payloadA = axios.post.mock.calls[0][1];
    const payloadB = axios.post.mock.calls[1][1];

    expect(payloadA.context.authorized_graph_names).toEqual(['GRAPH', 'OKF_agro_v1']);
    expect(payloadB.context.authorized_graph_names).toEqual(['GRAPH', 'OKF_health_v2']);
    // User B's carrier never carries user A's graph.
    expect(payloadB.context.authorized_graph_names).not.toContain('OKF_agro_v1');
    expect(client.getRetrievalConfig).toHaveBeenCalledWith(BEARER_B, expect.anything());
  });

  it('BEARER_TOKEN_EXPIRED: a 401 during posture resolution surfaces as HTTP 401 — chatqna is never called', async () => {
    const client = require('../services/retrieval-config-client');
    client.getRetrievalConfig.mockRejectedValue(new client.OkfAuthzUnauthorizedError('token expired'));

    const res = await authPost(chatBody(), BEARER_A);

    // The 401 propagates to the chat client (I/O Matrix BEARER_TOKEN_EXPIRED)…
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'UNAUTHENTICATED' });
    // …and the legacy path is NOT silently engaged — chatqna never saw the request.
    expect(axios.post).not.toHaveBeenCalled();
  });
});
