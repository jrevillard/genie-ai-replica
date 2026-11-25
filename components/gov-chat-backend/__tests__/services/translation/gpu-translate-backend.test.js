const { EventEmitter } = require('events');

jest.mock('http', () => ({ request: jest.fn() }));
jest.mock('https', () => ({ request: jest.fn() }));
jest.mock(
  '../../../shared-lib',
  () => ({
    // The real helpers, not copies: a test that asserts the timeout parser
    // rejects a negative budget is worthless against a reimplementation of it.
    ...jest.requireActual('../../../../shared/lib/validation-utils'),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
  }),
  { virtual: true }
);

const http = require('http');
const https = require('https');
const GpuTranslateBackend = require('../../../services/translation/gpu-translate-backend');

// The shared http.request double for this file's standard request/response
// scenarios — every request that completes gets the same response, and the
// timed-out ones all time out. The init test's two sequential responses and
// the abort test's incomplete response stay hand-rolled — one-off shapes
// this builder does not parameterize. Each block used to hand-roll the same
// scaffolding (an EventEmitter req with write/setTimeout/destroy stubs,
// `end -> cb(res)`), and the copies drifted: the non-2xx health refusal
// drains the response (`res.resume()`), a piece only some copies modelled.
// One builder models the request/response interface the service touches;
// each block parameterizes only the behavior it pins (status, response body,
// whether the request times out).
const serveRequest = ({ client = http, statusCode = 200, body = null, timeout = false } = {}) => {
  const capturedOpts = [];
  const writtenBodies = [];
  const responses = [];
  client.request.mockImplementation((opts, cb) => {
    capturedOpts.push(opts);
    const req = new EventEmitter();
    req.write = jest.fn((chunk) => writtenBodies.push(JSON.parse(chunk)));
    req.setTimeout = () => {};
    // A real ClientRequest emits 'error' when destroyed with one — the abort
    // wiring relies on it.
    req.destroy = jest.fn((err) => {
      if (err) req.emit('error', err);
    });
    if (timeout) {
      // Node fires 'timeout' on the request when the `timeout` option expires.
      req.end = () => process.nextTick(() => req.emit('timeout'));
      return req;
    }
    const res = new EventEmitter();
    res.statusCode = statusCode;
    res.setEncoding = () => {};
    // The refusal paths drain the response (`resume`); a real IncomingMessage
    // carries it, so the double models it as a jest.fn the tests can pin.
    res.resume = jest.fn();
    responses.push(res);
    // A request that never ends never gets a response, like a real socket:
    // the answer is delivered by `end`, then finishes itself (`healthCheck`
    // reads only `statusCode`; the body readers get 'data' + 'end').
    req.end = () =>
      process.nextTick(() => {
        cb(res);
        if (body !== null) res.emit('data', JSON.stringify(body));
        res.emit('end');
      });
    return req;
  });
  return { capturedOpts, writtenBodies, responses };
};

// The standard completed chat answer most usage tests serve.
const serveHola = () => serveRequest({ body: { choices: [{ finish_reason: 'stop', message: { content: 'Hola' } }] } });

describe('GpuTranslateBackend translation', () => {
  let backend;
  beforeAll(() => {
    backend = new GpuTranslateBackend();
    backend.initialized = true;
  });
  afterEach(() => jest.clearAllMocks());

  describe('formatRequest context budget', () => {
    let capped;
    beforeAll(() => {
      capped = new GpuTranslateBackend();
      capped.initialized = true;
      capped.maxModelLen = 8192;
    });

    // Input size is estimated at 4 chars/token. Assertions are written
    // against that estimate so the suite pins the production contract rather
    // than re-deriving the formula.
    const estimate = (body) => Math.ceil(JSON.stringify(body.messages).length / 4);

    it('leaves room in max_tokens for the prompt it builds', () => {
      // vLLM rejects a request whose prompt plus max_tokens exceeds the
      // model's context window, so the output budget has to be derived from
      // the prompt the request actually carries — not from the context length
      // alone.
      const unit = 'the recovery code for the migrated tenant is recorded '.repeat(12);
      const body = capped.formatRequest('google/gemma-3-4b-it', 'en', 'fr', unit);
      expect(body.max_tokens + estimate(body)).toBeLessThanOrEqual(capped.maxModelLen);
    });

    it('leaves room even when the estimate undercounts the prompt fourfold', () => {
      // `chars / 4` assumes ~4 chars per token. CJK runs nearer one token per
      // character, so the real prompt can be four times the estimate — and an
      // over-generous budget is what turns that miscount into a rejection.
      const cjk = '今天天气很好我们一起去公园散步吧。'.repeat(60);
      const body = capped.formatRequest('google/gemma-3-4b-it', 'zh', 'en', cjk);
      expect(body.max_tokens + estimate(body) * 4).toBeLessThanOrEqual(capped.maxModelLen);
    });

    it('leaves enough room to translate what it was given', () => {
      // The ceiling must not eat into the answer: a translation runs about as
      // long as its source, so the budget has to clear the prompt size.
      const unit = 'the recovery code for the migrated tenant is recorded '.repeat(12);
      const body = capped.formatRequest('google/gemma-3-4b-it', 'en', 'fr', unit);
      expect(body.max_tokens).toBeGreaterThanOrEqual(estimate(body));
    });

    it('does not hand a short prompt the whole window', () => {
      const body = capped.formatRequest('google/gemma-3-4b-it', 'en', 'fr', 'Bonjour.');
      expect(body.max_tokens).toBeLessThan(capped.maxModelLen / 2);
    });

    it('refuses a prompt that cannot leave room for a translation', () => {
      // Sending this with a minimal budget would earn a 200 with a near-empty
      // translation, which the markdown path would substitute for the paragraph.
      // Refusing it here routes the request to the CPU backend instead.
      expect(() => capped.formatRequest('google/gemma-3-4b-it', 'en', 'fr', 'x'.repeat(40000))).toThrow(
        /too little for a translation/
      );
    });

    it('refuses when the discovered window was too small to leave room', () => {
      // The 4096 default stays in place when /v1/models cannot be read. A prompt
      // that nearly fills it leaves a handful of tokens — enough to pass a
      // "does it fit at all" check, not enough to translate with.
      const stale = new GpuTranslateBackend();
      stale.initialized = true;
      stale.maxModelLen = 4096;
      expect(() => stale.formatRequest('google/gemma-3-4b-it', 'en', 'fr', 'x'.repeat(15900))).toThrow(
        /too little for a translation/
      );
    });

    it('refuses to size a budget for a body with no messages', () => {
      expect(() => capped._capMaxTokens({ model: 'google/gemma-3-4b-it' })).toThrow(/no messages array/);
    });
  });

  describe('truncation detection', () => {
    let backend;
    beforeAll(() => {
      backend = new GpuTranslateBackend();
      backend.initialized = true;
    });
    afterEach(() => jest.clearAllMocks());

    it('rejects a non-streaming translation that stopped at max_tokens', async () => {
      // A budget is a ceiling: without this the caller cannot tell a short text
      // from a cut-off one, and the shortened answer reaches the cache.
      serveRequest({ body: { choices: [{ finish_reason: 'length', message: { content: 'Une traduc' } }] } });
      await expect(
        backend.callVllmService({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })
      ).rejects.toThrow(/truncated/);
    });

    it('rejects a choice carrying no content', async () => {
      // Resolving this as an empty string would blank the paragraph: the
      // markdown path substitutes whatever came back for the node's core.
      serveRequest({ body: { choices: [{ finish_reason: 'content_filter', message: { content: null } }] } });
      await expect(
        backend.callVllmService({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })
      ).rejects.toThrow(/no message content/);
    });

    it('resolves a completed non-streaming translation', async () => {
      serveRequest({ body: { choices: [{ finish_reason: 'stop', message: { content: ' Hola ' } }] } });
      await expect(backend.callVllmService({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })).resolves.toBe(
        'Hola'
      );
    });
  });

  describe('pre-existing methods (coverage)', () => {
    it('getLanguageCode returns the model-specific code from the language map', () => {
      // Real assertion: the gemma-3 map maps ISO codes to model-specific codes
      const enCode = backend.getLanguageCode('en');
      const esCode = backend.getLanguageCode('es');
      expect(enCode).toBeTruthy();
      expect(esCode).toBeTruthy();
      expect(enCode).not.toBe(esCode);
    });

    it('getLanguageCode returns falsy for unsupported language', () => {
      expect(backend.getLanguageCode('xyz')).toBeFalsy();
    });

    it('formatRequest builds a gemma-3 chat-completions request with translation instructions', () => {
      // The request carries the model-specific codes; the prompt names the
      // languages from the map.
      const req = backend.formatRequest(
        'google/gemma-3-4b-it',
        backend.getLanguageCode('en'),
        backend.getLanguageCode('es'),
        'Hello world'
      );
      expect(req.model).toBe('google/gemma-3-4b-it');
      expect(req.messages).toBeDefined();
      const prompt = JSON.stringify(req.messages);
      expect(prompt).toContain('Hello world');
      // The prompt names the languages, not the codes: the names come from
      // the map, so a language the model is asked for is one the map knows.
      expect(prompt).toContain('English');
      expect(prompt).toContain('Spanish');
    });

    it('callVllmService sends a request and returns the translated text (non-streaming)', async () => {
      // Mock the HTTP response — this tests the request/response handling, not a mock return.
      serveRequest({ body: { choices: [{ message: { content: 'Hola mundo' } }] } });

      const result = await backend.callVllmService({
        model: 'google/gemma-3-4b-it',
        messages: [{ role: 'user', content: 'Translate: Hello world' }]
      });
      expect(result).toBe('Hola mundo');
    });

    it('translate batch processes an array, skipping empty texts', async () => {
      const callSpy = jest.spyOn(backend, 'callVllmService');
      callSpy.mockResolvedValue('Translated');
      const result = await backend.translate(['', 'Hello', '   '], 'en', 'es');
      // Empty/whitespace texts are skipped (returned as '' without calling the service)
      expect(result[0]).toBe('');
      expect(result[2]).toBe('');
      // Non-empty text triggers a real callVllmService call
      expect(callSpy).toHaveBeenCalledTimes(1);
      callSpy.mockRestore();
    });

    it('translate throws when not initialized', async () => {
      backend.initialized = false;
      await expect(backend.translate(['hi'], 'en', 'es')).rejects.toThrow(/not ready/i);
      backend.initialized = true;
    });

    it('init performs health check + fetches model info via http', async () => {
      backend.initialized = false;
      const res1 = new EventEmitter();
      const res2 = new EventEmitter();
      let callCount = 0;
      http.request.mockImplementation((opts, cb) => {
        callCount++;
        const req = new EventEmitter();
        req.write = () => {};
        req.end = () => {};
        process.nextTick(() => {
          const r = callCount === 1 ? res1 : res2;
          r.statusCode = 200;
          cb(r);
          if (callCount === 1) {
            r.emit('end');
          } else {
            r.emit('data', JSON.stringify({ data: [{ id: backend.modelId, max_model_len: 4096 }] }));
            r.emit('end');
          }
        });
        return req;
      });

      await backend.init();
      expect(backend.initialized).toBe(true);
      expect(backend.maxModelLen).toBe(4096);
    });

    it('translate catch propagates error on callVllmService failure', async () => {
      jest.spyOn(backend, 'callVllmService').mockRejectedValue(new Error('vLLM 500'));
      await expect(backend.translate(['Hello'], 'en', 'es')).rejects.toThrow(/Failed to perform translation/);
    });
  });
});

describe('GpuTranslateBackend startup probe', () => {
  // The health check is a boot gate, not a selector: with a configured GPU
  // API, failing it stops the service rather than sliding to another model.
  // A gate that produces false negatives kills the container, so both the
  // outcome and the budget are asserted here.
  let savedEnv;

  beforeEach(() => {
    savedEnv = {
      endpoint: process.env.VLLM_TRANSLATION_ENDPOINT,
      probe: process.env.TRANSLATION_PROBE_TIMEOUT_SECONDS
    };
    delete process.env.VLLM_TRANSLATION_ENDPOINT;
    delete process.env.TRANSLATION_PROBE_TIMEOUT_SECONDS;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      const envKey = key === 'endpoint' ? 'VLLM_TRANSLATION_ENDPOINT' : 'TRANSLATION_PROBE_TIMEOUT_SECONDS';
      if (value === undefined) delete process.env[envKey];
      else process.env[envKey] = value;
    }
    jest.clearAllMocks();
    // `clearAllMocks` keeps installed implementations — reset the request mock.
    http.request.mockReset();
  });

  const backendWithEnv = (env) => {
    Object.entries(env).forEach(([k, v]) => {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    });
    let instance;
    jest.isolateModules(() => {
      instance = new (require('../../../services/translation/gpu-translate-backend'))();
    });
    return instance;
  };

  it('rejects when the health check times out', async () => {
    serveRequest({ timeout: true });
    await expect(new GpuTranslateBackend().healthCheck()).rejects.toThrow(/health check timeout/);
  });

  it('spends the configured probe budget on the health check', async () => {
    const probe = serveRequest({ timeout: true });

    await expect(backendWithEnv({ TRANSLATION_PROBE_TIMEOUT_SECONDS: '7' }).healthCheck()).rejects.toThrow();

    expect(probe.capturedOpts[0].timeout).toBe(7000);
  });

  it.each(['-1', '0', 'abc', ''])('refuses a budget of "%s" and keeps the default', async (value) => {
    const probe = serveRequest({ timeout: true });
    const backend = backendWithEnv({ TRANSLATION_PROBE_TIMEOUT_SECONDS: value });

    await expect(backend.healthCheck()).rejects.toThrow();

    // `-1` is the case that matters: `parseInt('-1') * 1000` is -1000, which is
    // truthy and therefore survives an `|| DEFAULT` fallback. Node's HTTP layer
    // does not honour a negative timeout, so the gate would stop expiring and
    // fall back to OS defaults instead.
    expect(probe.capturedOpts[0].timeout).toBe(30000);
  });

  it('keeps a default budget generous enough for a cold TLS handshake', async () => {
    const probe = serveRequest({ timeout: true });

    await expect(new GpuTranslateBackend().healthCheck()).rejects.toThrow();

    // The endpoint answered /health in 32 ms in production, so any budget that
    // can expire on a healthy remote node is a false-negative gate.
    expect(probe.capturedOpts[0].timeout).toBeGreaterThanOrEqual(30000);
  });

  it('does not let the model-info read fail the service', async () => {
    serveRequest({ timeout: true });

    await expect(new GpuTranslateBackend().fetchModelInfo()).resolves.toBeUndefined();
  });

  // A /health answer that is not 2xx: `healthCheck` reads only `statusCode`
  // and drains the response before rejecting.
  const servingStatus = (statusCode) => serveRequest({ statusCode, body: null });

  it.each([500, 503, 404])('rejects on health status %d — an unready service fails the gate', async (status) => {
    const probe = servingStatus(status);

    await expect(new GpuTranslateBackend().healthCheck()).rejects.toThrow(new RegExp(`status ${status}`));
    expect(probe.responses[0].resume).toHaveBeenCalled();
  });

  it('keeps init from marking a 503-serving vLLM as initialized', async () => {
    servingStatus(503);
    const backend = new GpuTranslateBackend();

    await expect(backend.init()).rejects.toThrow(/unhealthy/);

    expect(backend.initialized).toBe(false);
    expect(backend.healthCheckPassed).toBe(false);
  });

  it('does not treat the in-cluster worker as a configured GPU API', () => {
    expect(new GpuTranslateBackend().endpointExplicit).toBe(false);
  });

  it('treats any other endpoint as a configured GPU API', () => {
    expect(backendWithEnv({ VLLM_TRANSLATION_ENDPOINT: 'https://gpu-node:444/translation' }).endpointExplicit).toBe(
      true
    );
  });
});

describe('GpuTranslateBackend endpoint addressing', () => {
  // Where the request goes and what it carries: the bearer token, and the
  // endpoint path prefix that a remote GPU API is addressed through.
  let savedEnv;

  // `VLLM_API_KEY` is read once at module load, so a backend with a key needs
  // a fresh module rather than a mutated instance.
  const backendWithKey = () => {
    let instance;
    jest.isolateModules(() => {
      process.env.VLLM_API_KEY = 'test-key-123';
      instance = new (require('../../../services/translation/gpu-translate-backend'))();
    });
    return instance;
  };

  beforeEach(() => {
    savedEnv = {
      key: process.env.VLLM_API_KEY,
      endpoint: process.env.VLLM_TRANSLATION_ENDPOINT
    };
    delete process.env.VLLM_API_KEY;
    process.env.VLLM_TRANSLATION_ENDPOINT = 'http://vllm:9031';
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(savedEnv)) {
      const key = name === 'key' ? 'VLLM_API_KEY' : 'VLLM_TRANSLATION_ENDPOINT';
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    jest.clearAllMocks();
  });

  describe('_buildHeaders', () => {
    it('sends the configured API key as a bearer token and nothing else', () => {
      const headers = backendWithKey()._buildHeaders();
      expect(headers['Authorization']).toBe('Bearer test-key-123');
      // Pins the header set, so a later change cannot quietly start sending
      // something on every request to the GPU API.
      expect(Object.keys(headers)).toHaveLength(1);
    });

    it('sends no Authorization header when no key is configured', () => {
      expect(new GpuTranslateBackend()._buildHeaders()).toEqual({});
    });

    it('keeps the extra headers it is given', () => {
      const headers = backendWithKey()._buildHeaders({ 'Content-Type': 'application/json' });
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Authorization']).toBe('Bearer test-key-123');
    });

    it('does not let a caller-supplied header stand in for the configured key', () => {
      // The key is the deployment's credential. A caller passing its own
      // `Authorization` must not be able to replace it.
      expect(backendWithKey()._buildHeaders({ Authorization: 'other' })['Authorization']).toBe('Bearer test-key-123');
    });
  });

  describe('addressing', () => {
    const REMOTE = 'https://gpu-node.example.com/translation';

    it.each([
      ['health check', (b) => b.healthCheck(), '/health', null],
      ['model info', (b) => b.fetchModelInfo(), '/v1/models', null],
      [
        'chat completion',
        (b) => b.callVllmService({ messages: [] }),
        '/v1/chat/completions',
        { choices: [{ message: { content: 'traduit' } }] }
      ]
    ])('prefixes the %s path with the endpoint path', async (_label, invoke, suffix, body) => {
      process.env.VLLM_TRANSLATION_ENDPOINT = REMOTE;
      const probe = serveRequest({ client: https, body });

      const backend = new GpuTranslateBackend();
      backend.initialized = true;
      await invoke(backend);

      expect(probe.capturedOpts[0].path).toBe(`/translation${suffix}`);
    });

    it('drops a trailing slash so the prefix does not double up', async () => {
      process.env.VLLM_TRANSLATION_ENDPOINT = `${REMOTE}/`;
      const probe = serveRequest({ client: https });

      await new GpuTranslateBackend().healthCheck();

      expect(probe.capturedOpts[0].path).toBe('/translation/health');
    });

    it('sends a remote https endpoint to the default port', async () => {
      process.env.VLLM_TRANSLATION_ENDPOINT = REMOTE;
      const probe = serveRequest({ client: https });

      await new GpuTranslateBackend().healthCheck();

      expect(probe.capturedOpts[0].hostname).toBe('gpu-node.example.com');
      expect(probe.capturedOpts[0].port).toBe(443);
    });

    it('authenticates the startup probe itself, not only the helper', async () => {
      // The probe is the boot gate for a remote HTTPS GPU node, which rejects
      // an unauthenticated request. A token applied everywhere except here
      // would let boot succeed against a node every later call is refused by.
      const probe = serveRequest({ client: https });
      const backend = backendWithKey();
      backend.endpoint = REMOTE;

      await backend.healthCheck();

      expect(probe.capturedOpts[0].headers.Authorization).toBe('Bearer test-key-123');
      expect(probe.capturedOpts[0].method).toBe('GET');
    });

    it('carries the bearer token on a real request, not just on the helper', async () => {
      const probe = serveRequest({
        client: https,
        body: { choices: [{ message: { content: 'traduit' } }] }
      });
      process.env.VLLM_TRANSLATION_ENDPOINT = REMOTE;

      const backend = backendWithKey();
      backend.initialized = true;
      backend.endpoint = REMOTE;

      expect(await backend.callVllmService({ messages: [{ role: 'user', content: 'hello' }] })).toBe('traduit');
      expect(probe.capturedOpts[0].headers.Authorization).toBe('Bearer test-key-123');
      expect(probe.capturedOpts[0].method).toBe('POST');
    });
  });
});

describe('GpuTranslateBackend usage-returning entry point and per-call options (story 2.10)', () => {
  // The agentic leg's surface: usage returned-or-estimated, the private 30s
  // timeout overridable, the request abortable. The legacy `translate` and
  // the option-less `callVllmService` keep their deployed behavior.
  let backend;

  beforeAll(() => {
    backend = new GpuTranslateBackend();
    backend.initialized = true;
  });
  afterEach(() => jest.clearAllMocks());

  it('returns the endpoint-served usage verbatim', async () => {
    serveRequest({
      body: {
        choices: [{ finish_reason: 'stop', message: { content: 'Hola' } }],
        usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 }
      }
    });
    const r = await backend.translateWithUsage(['Hello'], 'en', 'es');
    expect(r.translations).toEqual(['Hola']);
    expect(r.usage).toEqual({ prompt_tokens: 7, completion_tokens: 3 });
    expect(r.estimated).toBe(false);
  });

  it('estimates chars/4, flagged estimated, when the response carries no usage', async () => {
    const probe = serveHola();
    const r = await backend.translateWithUsage(['Hello'], 'en', 'es');
    expect(r.estimated).toBe(true);
    expect(r.usage).toEqual({
      prompt_tokens: Math.ceil(JSON.stringify(probe.writtenBodies[0].messages).length / 4),
      completion_tokens: Math.ceil('Hola'.length / 4)
    });
  });

  it('caps the output budget at options.maxTokens on top of the window math', async () => {
    const probe = serveHola();
    await backend.translateWithUsage(['Hello world'], 'en', 'es', { maxTokens: 40 });
    // A request the window math would have budgeted far above 40 comes out
    // capped at the caller's bound.
    expect(probe.writtenBodies[0].max_tokens).toBe(40);
  });

  it('overrides the request timeout with options.timeoutMs', async () => {
    const probe = serveHola();
    await backend.translateWithUsage(['Hello'], 'en', 'es', { timeoutMs: 4321 });
    expect(probe.capturedOpts[0].timeout).toBe(4321);
  });

  it('shrinks the timeout across texts so a later one cannot start past the deadline', async () => {
    const probe = serveHola();
    // A 50ms budget with two texts: after the first call the elapsed time is
    // subtracted before the second request is built. The wall clock advances
    // a readable step on EVERY Date.now read, so the shrink is discriminable
    // even when the two requests are built inside one real millisecond — the
    // second timeout is STRICTLY smaller than the first, and a production
    // that skipped the elapsed subtraction would build two equal timeouts
    // and turn this red.
    const realNow = Date.now.bind(Date);
    let reads = 0;
    const dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => {
      reads += 1;
      return realNow() + reads * 10;
    });
    await backend.translateWithUsage(['Hello', 'world'], 'en', 'es', { timeoutMs: 50 });
    dateSpy.mockRestore();
    expect(probe.capturedOpts).toHaveLength(2);
    expect(probe.capturedOpts[0].timeout).toBeLessThanOrEqual(50);
    expect(probe.capturedOpts[1].timeout).toBeLessThanOrEqual(probe.capturedOpts[0].timeout);
    expect(probe.capturedOpts[1].timeout).toBeLessThan(probe.capturedOpts[0].timeout);
    expect(probe.capturedOpts[1].timeout).toBeGreaterThan(0);
  });

  it('refuses to start a call past the deadline the caller set', async () => {
    const realNow = Date.now.bind(Date);
    const dateSpy = jest.spyOn(Date, 'now').mockReturnValueOnce(realNow()).mockReturnValueOnce(realNow());
    // Third read (the per-text deadline check) jumps far ahead: the second
    // text never starts.
    dateSpy.mockReturnValue(realNow() + 60000);
    serveHola();
    await expect(backend.translateWithUsage(['Hello', 'world'], 'en', 'es', { timeoutMs: 50 })).rejects.toThrow(
      /request timeout/
    );
    dateSpy.mockRestore();
  });

  it('destroys the in-flight request when the caller aborts mid-call', async () => {
    const controller = new AbortController();
    const res = new EventEmitter();
    res.statusCode = 200;
    res.setEncoding = () => {};
    let capturedReq = null;
    http.request.mockImplementation((opts, cb) => {
      const req = new EventEmitter();
      capturedReq = req;
      req.write = () => {};
      req.end = () => process.nextTick(() => controller.abort());
      req.setTimeout = () => {};
      req.destroy = jest.fn((err) => {
        if (err) req.emit('error', err);
      });
      process.nextTick(() => {
        cb(res);
        // The response never completes: the abort destroys the socket first.
      });
      return req;
    });
    await expect(backend.translateWithUsage(['Hello'], 'en', 'es', { signal: controller.signal })).rejects.toThrow(
      /aborted|failed/
    );
    expect(capturedReq.destroy).toHaveBeenCalled();
  });

  it('rejects immediately, without a request, on an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const probe = serveHola();
    await expect(backend.translateWithUsage(['Hello'], 'en', 'es', { signal: controller.signal })).rejects.toThrow(
      /aborted/
    );
    expect(probe.capturedOpts).toHaveLength(0);
  });

  it('skips empty texts without a call, like translate', async () => {
    const probe = serveHola();
    const r = await backend.translateWithUsage(['', 'Hello', '   '], 'en', 'es');
    expect(r.translations).toEqual(['', 'Hola', '']);
    expect(probe.writtenBodies).toHaveLength(1);
  });

  it('answers an empty array with no usage and no estimate', async () => {
    const probe = serveHola();
    const r = await backend.translateWithUsage([], 'en', 'es');
    expect(r).toEqual({ translations: [], usage: null, estimated: false });
    expect(probe.capturedOpts).toHaveLength(0);
  });

  it('answers an input of only empty texts with usage null — no-call is not zero-usage', async () => {
    const probe = serveHola();
    const r = await backend.translateWithUsage(['', '   '], 'en', 'es');
    expect(r.translations).toEqual(['', '']);
    expect(r.usage).toBeNull();
    expect(r.estimated).toBe(false);
    expect(probe.capturedOpts).toHaveLength(0);
  });

  it('treats a non-finite timeoutMs as not provided (the 30s default)', async () => {
    const probeNaN = serveHola();
    await backend.translateWithUsage(['Hello'], 'en', 'es', { timeoutMs: NaN });
    expect(probeNaN.capturedOpts[0].timeout).toBe(30000);

    const probeInf = serveHola();
    await backend.translateWithUsage(['Hello'], 'en', 'es', { timeoutMs: Infinity });
    expect(probeInf.capturedOpts[0].timeout).toBe(30000);
  });

  it('accepts options: null on both entry points (no TypeError)', async () => {
    const probe = serveHola();
    await expect(
      backend.callVllmService({ model: 'm', messages: [{ role: 'user', content: 'hi' }], max_tokens: 10 }, null)
    ).resolves.toBe('Hola');
    await expect(backend.translateWithUsage(['Hello'], 'en', 'es', null)).resolves.toMatchObject({
      translations: ['Hola']
    });
    expect(probe.capturedOpts[0].timeout).toBe(30000);
  });

  describe('legacy behavior pins', () => {
    it('callVllmService keeps the deployed 30s timeout when called without options', async () => {
      const probe = serveHola();
      await backend.callVllmService({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });
      expect(probe.capturedOpts[0].timeout).toBe(30000);
    });

    it('translate still resolves plain strings and ignores any usage in the response', async () => {
      serveRequest({
        body: {
          choices: [{ finish_reason: 'stop', message: { content: 'Hola' } }],
          usage: { prompt_tokens: 7, completion_tokens: 3 }
        }
      });
      const out = await backend.translate(['Hello'], 'en', 'es');
      expect(out).toEqual(['Hola']);
    });
  });
});
