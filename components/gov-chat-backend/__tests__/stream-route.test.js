// Covers routes/query-routes.js POST /stream: SSE happy path, non-SSE JSON
// upstream, upstream 500. Auth is mocked; the OPEA fetch is stubbed.
// Calls are recorded in a plain array (jest.fn state proved unreliable here
// across undici's streaming microtasks).
jest.mock('../middleware/keycloak-auth-middleware', () => ({
  keycloakAuthMiddleware: { authenticate: (req, res, next) => next() },
  PUBLIC_PATHS: [],
  isPublicRoute: () => false
}));

const express = require('express');
// query-routes builds on a module-level express.Router(): each factory call
// ADDS routes to the same router. resetModules gives every test a fresh
// module so its handler (and stubbed service) is the one that answers.
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

describe('POST /stream', () => {
  it('re-emits upstream SSE deltas, persists, then done', async () => {
    const service = makeService();
    const fetchImpl = jest.fn().mockResolvedValue(
      sseUpstream([
        'data: {"choices":[{"delta":{"content":"hel"}}]}\n\n',
        "data: b'lo '\n\n",
        'data: {"type": "metadata", "source_documents": [{"document_id": "d1"}]}\n\n',
        'data: [DONE]\n\n',
      ])
    );
    const { status, contentType, events } = await post(service, fetchImpl, BODY);
    expect(status).toBe(200);
    expect(contentType).toContain('text/event-stream');
    // JSON-delta AND b'...'-wrapped bare-text tokens both become deltas
    expect(events.filter((e) => e.delta).map((e) => e.delta)).toEqual(['hel', 'lo ']);
    expect(events.at(-1)).toMatchObject({
      done: true,
      queryId: 'q1',
      metadata: { type: 'metadata', source_documents: [{ document_id: 'd1' }] },
    });
    expect(service.__calls[0][0]).toBe('q1');
    expect(service.__calls[0][1].response).toBe('hello ');
  });

  it('flattens a non-SSE JSON upstream into a single delta', async () => {
    const service = makeService();
    const fetchImpl = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'full answer' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const { events } = await post(service, fetchImpl, BODY);
    expect(events.filter((e) => e.delta).map((e) => e.delta)).toEqual(['full answer']);
    expect(service.__calls[0][1].response).toBe('full answer');
  });

  it('emits error + done on upstream 500 and persists the empty response', async () => {
    const service = makeService();
    const fetchImpl = jest.fn().mockResolvedValue(new Response('boom', { status: 500 }));
    const { events } = await post(service, fetchImpl, BODY);
    expect(events.some((e) => e.error)).toBe(true);
    expect(events.at(-1).done).toBe(true);
    expect(service.__calls[0][1].response).toBe('');
  });

  // F4 end-of-stream translation: chatqna emits translated_answer /
  // translation_unavailable after the tokens; the backend forwards them so the
  // browser replaces the English preview, and persists the USER-FACING text.
  it('forwards translated_answer as {translation} and persists the translated text', async () => {
    const service = makeService();
    const fetchImpl = jest.fn().mockResolvedValue(
      sseUpstream([
        "data: b'Hello'\n\n",
        'data: {"type": "translated_answer", "text": "Lumela"}\n\n',
        'data: {"type": "metadata"}\n\n',
        'data: [DONE]\n\n',
      ])
    );
    const { events } = await post(service, fetchImpl, BODY);
    expect(events.filter((e) => e.delta).map((e) => e.delta)).toEqual(['Hello']);
    expect(events.some((e) => e.translation === 'Lumela')).toBe(true);
    expect(events.some((e) => e.translationNotice)).toBe(false);
    expect(events.at(-1).done).toBe(true);
    // persisted answer = user-facing (translated) text, not the English stream
    expect(service.__calls[0][1].response).toBe('Lumela');
  });

  it('forwards translation_unavailable as {translationNotice} without erroring, persists English', async () => {
    const service = makeService();
    const fetchImpl = jest.fn().mockResolvedValue(
      sseUpstream([
        "data: b'Hello'\n\n",
        'data: {"type": "translation_unavailable"}\n\n',
        'data: {"type": "metadata"}\n\n',
        'data: [DONE]\n\n',
      ])
    );
    const { events } = await post(service, fetchImpl, BODY);
    expect(events.some((e) => e.translationNotice === true)).toBe(true);
    expect(events.some((e) => e.translation)).toBe(false);
    // Translation failure is NEVER a stream error — the English answer stands.
    expect(events.some((e) => e.error)).toBe(false);
    expect(events.at(-1).done).toBe(true);
    expect(service.__calls[0][1].response).toBe('Hello');
  });

  // The live chatqna wire format is Python bytes-repr per token
  // (genieai_chatqna.py _stream_with_metadata). repr() escapes real content;
  // these are the classes the old escape-free `b'lo '` test never covered.
  describe('bytes-repr escape classes', () => {
    const cases = [
      ['newline', "data: b'Line1.\\nLine2.'\n\n", 'Line1.\nLine2.'],
      ['apostrophe (repr flips to double quotes)', 'data: b"farmers don\'t"\n\n', "farmers don't"],
      ['non-ASCII hex escapes', "data: b'caf\\xc3\\xa9 \\xe2\\x9c\\x93'\n\n", 'café ✓'],
      ['numeric token (was silently dropped)', "data: b'25'\n\n", '25'],
      ['real backslash (was doubled)', "data: b'C:\\\\path'\n\n", 'C:\\path'],
    ];

    it.each(cases)('decodes %s', async (_name, wire, expected) => {
      const service = makeService();
      const fetchImpl = jest.fn().mockResolvedValue(sseUpstream([wire, 'data: [DONE]\n\n']));
      const { events } = await post(service, fetchImpl, BODY);
      expect(events.filter((e) => e.delta).map((e) => e.delta).join('')).toBe(expected);
      expect(service.__calls[0][1].response).toBe(expected);
    });

    it('re-assembles a realistic multi-paragraph answer with digits intact', async () => {
      const service = makeService();
      const fetchImpl = jest.fn().mockResolvedValue(
        sseUpstream([
          "data: b'Apply 25 kg'\n\n",
          'data: b" don\'t over-irrigate."\n\n',
          "data: b'\\n\\nStep 2: caf\\xc3\\xa9 shade.'\n\n",
          'data: [DONE]\n\n',
        ])
      );
      const { events } = await post(service, fetchImpl, BODY);
      const joined = events.filter((e) => e.delta).map((e) => e.delta).join('');
      expect(joined).toBe("Apply 25 kg don't over-irrigate.\n\nStep 2: café shade.");
      expect(events.at(-1).done).toBe(true);
    });
  });
});
