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

describe('GpuTranslateBackend streaming', () => {
  let backend;
  beforeAll(() => {
    backend = new GpuTranslateBackend();
    backend.initialized = true;
  });
  afterEach(() => jest.clearAllMocks());

  describe('callVllmStream', () => {
    it('parses SSE deltas, yields via onToken, resolves full text', async () => {
      const res = new EventEmitter();
      res.setEncoding = () => {};
      http.request.mockImplementation((opts, cb) => {
        const req = new EventEmitter();
        req.write = () => {};
        req.end = () => {};
        process.nextTick(() => {
          cb(res);
          res.emit('data', 'data: {"choices":[{"delta":{"content":"Hola"}}]}\n\n');
          res.emit('data', 'data: {"choices":[{"delta":{"content":" mundo"}}]}\n\n');
          res.emit('data', 'data: [DONE]\n\n');
          res.emit('end');
        });
        return req;
      });

      const tokens = [];
      const full = await backend.callVllmStream({ messages: [{ role: 'user', content: 'hi' }] }, (d) => tokens.push(d));
      expect(tokens).toEqual(['Hola', ' mundo']);
      expect(full).toBe('Hola mundo');
    });

    it('ignores non-JSON / keepalive lines without crashing', async () => {
      const res = new EventEmitter();
      res.setEncoding = () => {};
      http.request.mockImplementation((opts, cb) => {
        const req = new EventEmitter();
        req.write = () => {};
        req.end = () => {};
        process.nextTick(() => {
          cb(res);
          res.emit('data', ': keepalive\n\n');
          res.emit('data', 'data: not-json\n\n');
          res.emit('data', 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n');
          res.emit('end');
        });
        return req;
      });
      const full = await backend.callVllmStream({ messages: [] }, () => {});
      expect(full).toBe('ok');
    });

    it('rejects on non-2xx status', async () => {
      const res = new EventEmitter();
      res.setEncoding = () => {};
      http.request.mockImplementation((opts, cb) => {
        const req = new EventEmitter();
        req.write = () => {};
        req.end = () => {};
        process.nextTick(() => {
          res.statusCode = 500;
          cb(res);
          res.emit('data', 'boom');
          res.emit('end');
        });
        return req;
      });
      await expect(backend.callVllmStream({ messages: [] }, () => {})).rejects.toThrow(/500/);
    });
  });

  describe('translateStream', () => {
    it('returns empty string for empty/whitespace text', async () => {
      await expect(backend.translateStream('', 'en', 'es')).resolves.toBe('');
      await expect(backend.translateStream('   ', 'en', 'es')).resolves.toBe('');
    });

    it('delegates to callVllmStream and injects a context window (prompt-based model)', async () => {
      const spy = jest.spyOn(backend, 'callVllmStream').mockResolvedValue('Hola');
      const ctx = [{ source: 'Hi', target: 'Hola' }];
      const onToken = jest.fn();
      const result = await backend.translateStream('Bye', 'en', 'es', ctx, onToken);
      expect(result).toBe('Hola');
      expect(spy).toHaveBeenCalledTimes(1);
      const requestBody = spy.mock.calls[0][0];
      expect(requestBody.messages[0].content).toContain('Prior context');
      spy.mockRestore();
    });

    it('omits context block for TranslateGemma (structured payload)', async () => {
      const spy = jest.spyOn(backend, 'callVllmStream').mockResolvedValue('x');
      backend.modelId = 'google/translategemma-4b-it';
      await backend.translateStream('Bye', 'en', 'es', [{ source: 'a', target: 'b' }], () => {});
      const requestBody = spy.mock.calls[0][0];
      expect(JSON.stringify(requestBody)).not.toContain('Prior context');
      backend.modelId = 'google/gemma-3-4b-it';
      spy.mockRestore();
    });

    it('dynamically caps max_tokens so input + output never exceeds maxModelLen', async () => {
      const spy = jest.spyOn(backend, 'callVllmStream').mockResolvedValue('OK');
      // Large context window (simulates many prior translation units)
      const bigContext = Array.from({ length: 10 }, (_, i) => ({
        source: `Previous unit ${i} with some meaningful translation context.`,
        target: `Unidad previa ${i} con contexto de traducción significativo.`
      }));
      await backend.translateStream('Final sentence.', 'en', 'es', bigContext, () => {});
      const requestBody = spy.mock.calls[0][0];
      const inputTokens = Math.ceil(JSON.stringify(requestBody.messages).length / 4);
      // Invariant: input + max_tokens must fit within maxModelLen
      expect(requestBody.max_tokens + inputTokens).toBeLessThanOrEqual(backend.maxModelLen);
      spy.mockRestore();
    });

    it('keeps a budget proportional to the input for short text without context', async () => {
      const spy = jest.spyOn(backend, 'callVllmStream').mockResolvedValue('OK');
      await backend.translateStream('Short text.', 'en', 'es', null, () => {});
      const requestBody = spy.mock.calls[0][0];
      // Room is plentiful here — the budget tracks what the translation needs
      // rather than the whole window, and still clears the prompt.
      expect(requestBody.max_tokens).toBeGreaterThan(256);
      spy.mockRestore();
    });
  });

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

    const serveBody = (body) => {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.setEncoding = () => {};
      http.request.mockImplementation((opts, cb) => {
        const req = new EventEmitter();
        req.write = () => {};
        req.end = () => {};
        process.nextTick(() => {
          cb(res);
          res.emit('data', JSON.stringify(body));
          res.emit('end');
        });
        return req;
      });
    };

    it('rejects a non-streaming translation that stopped at max_tokens', async () => {
      // A budget is a ceiling: without this the caller cannot tell a short text
      // from a cut-off one, and the shortened answer reaches the cache.
      serveBody({
        choices: [{ finish_reason: 'length', message: { content: 'Une traduc' } }]
      });
      await expect(
        backend.callVllmService({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })
      ).rejects.toThrow(/truncated/);
    });

    it('rejects a choice carrying no content', async () => {
      // Resolving this as an empty string would blank the paragraph: the
      // markdown path substitutes whatever came back for the node's core.
      serveBody({ choices: [{ finish_reason: 'content_filter', message: { content: null } }] });
      await expect(
        backend.callVllmService({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })
      ).rejects.toThrow(/no message content/);
    });

    it('resolves a completed non-streaming translation', async () => {
      serveBody({
        choices: [{ finish_reason: 'stop', message: { content: ' Hola ' } }]
      });
      await expect(backend.callVllmService({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })).resolves.toBe(
        'Hola'
      );
    });

    it('rejects a stream that stopped at max_tokens', async () => {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.setEncoding = () => {};
      http.request.mockImplementation((opts, cb) => {
        const req = new EventEmitter();
        req.write = () => {};
        req.end = () => {};
        process.nextTick(() => {
          cb(res);
          res.emit('data', 'data: {"choices":[{"delta":{"content":"Hola"}}]}\n\n');
          res.emit('data', 'data: {"choices":[{"finish_reason":"length","delta":{}}]}\n\n');
          res.emit('data', 'data: [DONE]\n\n');
          res.emit('end');
        });
        return req;
      });
      await expect(backend.callVllmStream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(
        /truncated/
      );
    });

    it('rejects a stream that produced no content', async () => {
      // A refusal or a moderation block answers 200 with no deltas. Resolving
      // the empty string would let the markdown path substitute it for the
      // paragraph, so the stream rejects like the non-streaming path does.
      const res = new EventEmitter();
      res.statusCode = 200;
      res.setEncoding = () => {};
      http.request.mockImplementation((opts, cb) => {
        const req = new EventEmitter();
        req.write = () => {};
        req.end = () => {};
        process.nextTick(() => {
          cb(res);
          res.emit('data', 'data: {"choices":[{"finish_reason":"content_filter","delta":{}}]}\n\n');
          res.emit('data', 'data: [DONE]\n\n');
          res.emit('end');
        });
        return req;
      });
      await expect(backend.callVllmStream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(
        /no content/
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

    it('isLanguageSupported reflects the language map', () => {
      expect(backend.isLanguageSupported('en')).toBe(true);
      expect(backend.isLanguageSupported('es')).toBe(true);
    });

    it('reports a missing language name as a defect in the map, not as a bad request', () => {
      // The caller asked for a language the deployment supports; the map
      // simply does not name the code. Blaming the request for it (an
      // UnsupportedLanguageError is a 400) would hide our own defect.
      const { UnsupportedLanguageError } = require('../../../services/translation/unsupported-language');
      const original = backend.languageMap;
      backend.languageMap = { languageMap: { en: 'en' }, languageNames: {}, fallbackMap: {} };

      let error;
      try {
        backend._languageName('en');
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeDefined();
      expect(error.message).toMatch(/language map/i);
      expect(error).not.toBeInstanceOf(UnsupportedLanguageError);
      backend.languageMap = original;
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
      expect(prompt).toMatch(/English|source/i);
      expect(prompt).toMatch(/Spanish|target/i);
    });

    it('callVllmService sends a request and returns the translated text (non-streaming)', async () => {
      // Mock the HTTP response — this tests the request/response handling, not a mock return.
      const res = new EventEmitter();
      res.setEncoding = () => {};
      http.request.mockImplementation((opts, cb) => {
        const req = new EventEmitter();
        req.write = () => {};
        req.end = () => {};
        process.nextTick(() => {
          res.statusCode = 200;
          cb(res);
          res.emit('data', JSON.stringify({ choices: [{ message: { content: 'Hola mundo' } }] }));
          res.emit('end');
        });
        return req;
      });

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

  const requestThatTimesOut = (captured) => {
    http.request.mockImplementation((opts) => {
      captured.opts = opts;
      const req = new EventEmitter();
      req.write = () => {};
      req.setTimeout = () => {};
      req.destroy = jest.fn();
      req.end = () => process.nextTick(() => req.emit('timeout'));
      return req;
    });
  };

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
    requestThatTimesOut({});
    await expect(new GpuTranslateBackend().healthCheck()).rejects.toThrow(/health check timeout/);
  });

  it('spends the configured probe budget on the health check', async () => {
    const captured = {};
    requestThatTimesOut(captured);

    await expect(backendWithEnv({ TRANSLATION_PROBE_TIMEOUT_SECONDS: '7' }).healthCheck()).rejects.toThrow();

    expect(captured.opts.timeout).toBe(7000);
  });

  it.each(['-1', '0', 'abc', ''])('refuses a budget of "%s" and keeps the default', async (value) => {
    const captured = {};
    requestThatTimesOut(captured);
    const backend = backendWithEnv({ TRANSLATION_PROBE_TIMEOUT_SECONDS: value });

    await expect(backend.healthCheck()).rejects.toThrow();

    // `-1` is the case that matters: `parseInt('-1') * 1000` is -1000, which is
    // truthy and therefore survives an `|| DEFAULT` fallback. Node's HTTP layer
    // does not honour a negative timeout, so the gate would stop expiring and
    // fall back to OS defaults instead.
    expect(captured.opts.timeout).toBe(30000);
  });

  it('keeps a default budget generous enough for a cold TLS handshake', async () => {
    const captured = {};
    requestThatTimesOut(captured);

    await expect(new GpuTranslateBackend().healthCheck()).rejects.toThrow();

    // The endpoint answered /health in 32 ms in production, so any budget that
    // can expire on a healthy remote node is a false-negative gate.
    expect(captured.opts.timeout).toBeGreaterThanOrEqual(30000);
  });

  it('does not let the model-info read fail the service', async () => {
    requestThatTimesOut({});

    await expect(new GpuTranslateBackend().fetchModelInfo()).resolves.toBeUndefined();
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

  // A response that ends on its own: `healthCheck` reads only `statusCode`,
  // the other two read data and wait for 'end'.
  const responding = (statusCode, chunks = []) => {
    const res = new EventEmitter();
    res.statusCode = statusCode;
    res.setEncoding = () => {};
    res.end = () =>
      process.nextTick(() => {
        chunks.forEach((c) => res.emit('data', c));
        res.emit('end');
      });
    return res;
  };

  const captures = (sink) => (opts, cb) => {
    sink.opts = opts;
    const req = new EventEmitter();
    req.write = () => {};
    req.setTimeout = () => {};
    req.destroy = jest.fn();
    req.end = () => {
      const res = sink.res();
      cb(res);
      // `healthCheck` reads only `statusCode` and returns; the other two read
      // 'data' and wait for 'end', so the response has to finish itself.
      if (typeof res.end === 'function') res.end();
    };
    return req;
  };

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
      ['health check', (b) => b.healthCheck(), '/health', []],
      ['model info', (b) => b.fetchModelInfo(), '/v1/models', []],
      [
        'chat completion',
        (b) => b.callVllmService({ messages: [] }),
        '/v1/chat/completions',
        [JSON.stringify({ choices: [{ message: { content: 'traduit' } }] })]
      ]
    ])('prefixes the %s path with the endpoint path', async (_label, invoke, suffix, body) => {
      process.env.VLLM_TRANSLATION_ENDPOINT = REMOTE;
      const sink = { res: () => responding(200, body) };
      https.request.mockImplementation(captures(sink));

      const backend = new GpuTranslateBackend();
      backend.initialized = true;
      await invoke(backend);

      expect(sink.opts.path).toBe(`/translation${suffix}`);
    });

    it('drops a trailing slash so the prefix does not double up', async () => {
      process.env.VLLM_TRANSLATION_ENDPOINT = `${REMOTE}/`;
      const sink = { res: () => responding(200, []) };
      https.request.mockImplementation(captures(sink));

      await new GpuTranslateBackend().healthCheck();

      expect(sink.opts.path).toBe('/translation/health');
    });

    it('sends a remote https endpoint to the default port', async () => {
      process.env.VLLM_TRANSLATION_ENDPOINT = REMOTE;
      const sink = { res: () => responding(200, []) };
      https.request.mockImplementation(captures(sink));

      await new GpuTranslateBackend().healthCheck();

      expect(sink.opts.hostname).toBe('gpu-node.example.com');
      expect(sink.opts.port).toBe(443);
    });

    it('authenticates the startup probe itself, not only the helper', async () => {
      // The probe is the boot gate for a remote HTTPS GPU node, which rejects
      // an unauthenticated request. A token applied everywhere except here
      // would let boot succeed against a node every later call is refused by.
      const sink = { res: () => responding(200, []) };
      https.request.mockImplementation(captures(sink));
      const backend = backendWithKey();
      backend.endpoint = REMOTE;

      await backend.healthCheck();

      expect(sink.opts.headers.Authorization).toBe('Bearer test-key-123');
      expect(sink.opts.method).toBe('GET');
    });

    it('carries the bearer token on a real request, not just on the helper', async () => {
      const sink = {
        res: () => responding(200, [JSON.stringify({ choices: [{ message: { content: 'traduit' } }] })])
      };
      https.request.mockImplementation(captures(sink));
      process.env.VLLM_TRANSLATION_ENDPOINT = REMOTE;

      const backend = backendWithKey();
      backend.initialized = true;
      backend.endpoint = REMOTE;

      expect(await backend.callVllmService({ messages: [{ role: 'user', content: 'hello' }] })).toBe('traduit');
      expect(sink.opts.headers.Authorization).toBe('Bearer test-key-123');
      expect(sink.opts.method).toBe('POST');
    });
  });
});
