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
  });
});
