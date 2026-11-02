// D4: pins the /stream zero-delta guard — a 200 SSE stream that yields ZERO
// content deltas must surface {error: 'empty response from pipeline'} and log
// it (the live model-id-mismatch shape), the non-200 branch must log (was
// silent), client abort sends NO error event, and the captured metadata
// reaches completeStreamedQuery. Same mounted-route idiom as
// stream-route.test.js (calls recorded in a plain array; jest.fn state proved
// unreliable across undici's streaming microtasks).
jest.mock('../middleware/keycloak-auth-middleware', () => ({
  keycloakAuthMiddleware: { authenticate: (req, res, next) => next() },
  PUBLIC_PATHS: [],
  isPublicRoute: () => false
}));

const express = require('express');

// query-routes builds on a module-level express.Router(): resetModules gives
// every test a fresh module so its stubbed service is the one that answers.
let createRoutes;
beforeEach(() => {
  jest.resetModules();
  createRoutes = require('../routes/query-routes');
});

function makeService() {
  let resolveCompletion;
  const completion = new Promise((r) => { resolveCompletion = r; });
  const calls = [];
  const service = {
    buildOpeaPayload: (body) => ({ messages: body.messages[body.messages.length - 1].content, stream: true }),
    createStreamedQuery: async () => 'q1',
    completeStreamedQuery: async (id, data) => { calls.push([id, data]); resolveCompletion(); },
    __calls: calls,
    __completion: completion,
  };
  return service;
}

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

async function post(service, fetchImpl, body) {
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
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    await service.__completion; // route persists before its final done write
    const events = text
      .split('\n\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => JSON.parse(l.slice(6)));
    return { status: res.status, contentType: res.headers.get('content-type'), events };
  } finally {
    global.fetch = origFetch;
    server.closeAllConnections?.();
    server.close();
  }
}

const BODY = { userId: 'u', sessionId: 's', messages: [{ role: 'user', content: 'hi' }] };

describe('POST /stream empty-guard (D4)', () => {
  it('a 200 SSE stream with zero content deltas emits {error} + logs it', async () => {
    const service = makeService();
    const fetchImpl = jest.fn().mockResolvedValue(
      sseUpstream(['data: [DONE]\n\n']) // the live failure shape: 200, stream, no tokens
    );
    const { events } = await post(service, fetchImpl, BODY);
    expect(events.some((e) => e.error === 'empty response from pipeline')).toBe(true);
    expect(events.at(-1).done).toBe(true);
    expect(service.__calls[0][1].response).toBe('');
    const { logger } = require('../shared-lib');
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/empty response from pipeline/));
  });

  it('a whitespace-only 200 stream also trips the guard', async () => {
    const service = makeService();
    const fetchImpl = jest.fn().mockResolvedValue(
      // escaped \n/\t on the wire so the JSON parses to whitespace-only content
      sseUpstream(['data: {"choices":[{"delta":{"content":"  \\n\\t"}}]}\n\n', 'data: [DONE]\n\n'])
    );
    const { events } = await post(service, fetchImpl, BODY);
    expect(events.some((e) => e.error === 'empty response from pipeline')).toBe(true);
    expect(service.__calls[0][1].response).toBe('  \n\t');
  });

  it('a stalled 200 stream times out as an error event (not client-abort silence)', async () => {
    const service = makeService();
    process.env.STREAM_UPSTREAM_TIMEOUT_MS = '75'; // route's test knob (default 120s)
    // 200 SSE headers, then the body never sends a byte; when the route's
    // combined signal aborts (timeout), undici errors the body with the
    // signal's reason — a TimeoutError DOMException. The mock mirrors that.
    const fetchImpl = jest.fn((_url, opts) => Promise.resolve(new Response(
      new ReadableStream({
        start(c) {
          opts.signal.addEventListener('abort', () => c.error(opts.signal.reason));
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } }
    )));
    let events;
    try {
      ({ events } = await post(service, fetchImpl, BODY));
    } finally {
      delete process.env.STREAM_UPSTREAM_TIMEOUT_MS;
    }
    expect(events.some((e) => e.error === 'upstream timeout')).toBe(true);
    expect(events.at(-1).done).toBe(true);
    const { logger } = require('../shared-lib');
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/upstream timeout/));
  });

  it('non-200 upstream emits {error} AND logs it (branch was silent)', async () => {
    const service = makeService();
    const fetchImpl = jest.fn().mockResolvedValue(new Response('no model', { status: 404 }));
    const { events } = await post(service, fetchImpl, BODY);
    expect(events.some((e) => e.error === 'chatqna returned 404')).toBe(true);
    expect(events.at(-1).done).toBe(true);
    expect(service.__calls[0][1].response).toBe('');
    const { logger } = require('../shared-lib');
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/chatqna returned 404/));
    // exactly one error event — the empty-guard must not double-fire
    expect(events.filter((e) => e.error)).toHaveLength(1);
  });

  it('persists the captured stream metadata on success', async () => {
    const service = makeService();
    const fetchImpl = jest.fn().mockResolvedValue(
      sseUpstream([
        'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
        'data: {"type":"metadata","is_grounded":false,"source_documents":[]}\n\n',
        'data: [DONE]\n\n',
      ])
    );
    const { events } = await post(service, fetchImpl, BODY);
    expect(events.some((e) => e.delta === 'hi')).toBe(true);
    expect(service.__calls[0][1].response).toBe('hi');
    expect(service.__calls[0][1].metadata).toEqual({ type: 'metadata', is_grounded: false, source_documents: [] });
  });

  it('client abort mid-stream sends NO error event', async () => {
    const service = makeService();
    const writes = []; // captures writes even after the client hangs up
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      const orig = res.write.bind(res);
      res.write = (chunk) => { writes.push(String(chunk)); return orig(chunk); };
      next();
    });
    app.use('/', createRoutes(service));
    const server = app.listen(0);
    const url = `http://127.0.0.1:${server.address().port}/stream`;
    const origFetch = global.fetch;
    // Route's upstream fetch: hangs until the route's abort signal fires,
    // then rejects as AbortError — what undici does on signal abort.
    const fetchImpl = jest.fn((_url, opts) => new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () =>
        reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })));
    }));
    global.fetch = fetchImpl;
    const clientAbort = new AbortController();
    try {
      const res = await origFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(BODY),
        signal: clientAbort.signal,
      });
      const reader = res.body.getReader();
      await reader.read(); // the {queryId} event — the browser now hangs up
      clientAbort.abort();
      await service.__completion; // route still persists the partial query
      await new Promise((r) => setImmediate(r)); // let the trailing writes land
    } finally {
      global.fetch = origFetch;
      server.closeAllConnections?.();
      server.close();
    }
    const events = writes
      .filter((w) => w.startsWith('data: '))
      .map((w) => { try { return JSON.parse(w.slice(6)); } catch { return {}; } });
    expect(events.some((e) => e.queryId)).toBe(true); // stream did start
    expect(events.filter((e) => e.error)).toHaveLength(0); // abort ≠ error
  });
});
