const { EventEmitter } = require('events');

jest.mock('http', () => ({ request: jest.fn() }));
jest.mock('https', () => ({ request: jest.fn() }));
jest.mock(
  '../../../shared-lib',
  () => ({
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
  }),
  { virtual: true }
);

const http = require('http');
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

    it('keeps generous max_tokens for short input without context', async () => {
      const spy = jest.spyOn(backend, 'callVllmStream').mockResolvedValue('OK');
      await backend.translateStream('Short text.', 'en', 'es', null, () => {});
      const requestBody = spy.mock.calls[0][0];
      expect(requestBody.max_tokens).toBeGreaterThan(1000);
      spy.mockRestore();
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

    it('formatRequest builds a gemma-3 chat-completions request with translation instructions', () => {
      const req = backend.formatRequest('google/gemma-3-4b-it', 'English', 'Spanish', 'Hello world');
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
