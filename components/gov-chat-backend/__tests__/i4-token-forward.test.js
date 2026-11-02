/**
 * I.4 pins — the caller's Authorization must reach chatqna.
 *
 * Diagnosis (7-agent workflow, both verifiers CONFIRMED): gov-chat-backend drops
 * the Bearer on both chatqna call paths → chatqna's doc-repo metadata fetch fails
 * for every source → source_documents [] (empty sidebar) and scores [] (confidence
 * born 0.0). These pins hold the forwarding in place on all three legs:
 *   1. stream proxy fetch (query-routes)
 *   2. runOPEAWorker task threading (query-service)
 *   3. opea-worker outbound axios headers
 */
jest.mock('../middleware/keycloak-auth-middleware', () => ({
  keycloakAuthMiddleware: (req, res, next) => next(),
  requireAdmin: (req, res, next) => next(),
}));

jest.mock('worker_threads', () => {
  const { EventEmitter } = require('events');
  const spawns = [];
  class MockWorker extends EventEmitter {
    constructor(path, opts) {
      super();
      this.path = path;
      this.opts = opts;
      spawns.push(this);
    }
    postMessage(msg) {
      this.lastMessage = msg;
    }
    terminate() {
      return Promise.resolve();
    }
  }
  return {
    Worker: MockWorker,
    spawns,
    parentPort: Object.assign(new EventEmitter(), { postMessage: jest.fn() }),
    workerData: {},
  };
});

jest.mock('axios', () => {
  const post = jest.fn();
  return { post, create: jest.fn(() => ({ post })) };
});

const express = require('express');
const { parentPort } = require('worker_threads');
const axios = require('axios');
const queryService = require('../services/query-service');

function sseUpstream(lines) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(c) {
      lines.forEach((l) => c.enqueue(encoder.encode(l)));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

async function postStream(fetchImpl, body, headers = {}) {
  const createRoutes = require('../routes/query-routes');
  let completion;
  const service = {
    buildOpeaPayload: () => ({ model: 'x' }),
    createStreamedQuery: async () => 'q1',
    completeStreamedQuery: async () => {
      completion = 'done';
    },
    get __completion() {
      return completion;
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/', createRoutes(service));
  const server = app.listen(0);
  const url = `http://127.0.0.1:${server.address().port}/stream`;
  const origFetch = global.fetch;
  global.fetch = fetchImpl;
  try {
    const res = await origFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    await res.text();
    return res.status;
  } finally {
    global.fetch = origFetch;
    server.closeAllConnections?.();
    server.close();
  }
}

const BODY = { userId: 'u', sessionId: 's', messages: [{ role: 'user', content: 'hi' }] };

describe('I.4 — Authorization forwarded to chatqna', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    axios.post.mockResolvedValue({ data: { response: 'ok', metadata: {} } });
  });

  it('stream proxy forwards the caller Bearer to the chatqna fetch', async () => {
    let capturedHeaders;
    const fetchImpl = jest.fn(async (url, init) => {
      capturedHeaders = init.headers;
      return sseUpstream(['data: {"text":"hi"}', 'data: [DONE]']);
    });

    const status = await postStream(fetchImpl, BODY, { Authorization: 'Bearer user-tok' });

    expect(status).toBe(200);
    expect(fetchImpl).toHaveBeenCalled();
    expect(capturedHeaders['Authorization']).toBe('Bearer user-tok');
    expect(capturedHeaders['Content-Type']).toBe('application/json');
  });

  it('stream proxy omits the Authorization key entirely when the caller sent none', async () => {
    let capturedHeaders;
    const fetchImpl = jest.fn(async (url, init) => {
      capturedHeaders = init.headers;
      return sseUpstream(['data: {"text":"hi"}', 'data: [DONE]']);
    });

    await postStream(fetchImpl, BODY);

    expect(capturedHeaders).not.toHaveProperty('Authorization');
  });

  it('runOPEAWorker threads the token into the worker task', async () => {
    const promise = queryService.runOPEAWorker('http://chatqna/v1/chatqna', { a: 1 }, 'Bearer user-tok');
    const { spawns } = require('worker_threads');
    const w = spawns[spawns.length - 1];
    expect(w.lastMessage).toEqual({
      url: 'http://chatqna/v1/chatqna',
      payload: { a: 1 },
      authToken: 'Bearer user-tok',
    });
    w.emit('message', { status: 'success', data: { response: 'ok', metadata: {}, responseTime: 1 } });
    await promise;
  });

  it('opea-worker sends the Authorization header when the task carries a token', async () => {
    require('../services/opea-worker');

    parentPort.emit('message', {
      url: 'http://chatqna/v1/chatqna',
      payload: { a: 1 },
      authToken: 'Bearer user-tok',
    });
    await new Promise((r) => setImmediate(r));

    expect(axios.post).toHaveBeenCalledWith(
      'http://chatqna/v1/chatqna',
      { a: 1 },
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer user-tok' }),
      })
    );
  });

  it('opea-worker omits the header when the task has no token', async () => {
    require('../services/opea-worker');

    parentPort.emit('message', { url: 'http://chatqna/v1/chatqna', payload: { a: 1 }, authToken: null });
    await new Promise((r) => setImmediate(r));

    const call = axios.post.mock.calls[axios.post.mock.calls.length - 1];
    expect(call[2].headers).not.toHaveProperty('Authorization');
  });
});
