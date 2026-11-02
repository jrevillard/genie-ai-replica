// F6 (DEC-25): pins the GpuTranslateBackend NLLB branch — facebook/nllb-200-3.3B
// rides the nllb-translate sidecar (FLORES-200 codes), ONE batched POST for the
// whole texts[] array (replaces the per-text vLLM loop), and a failed health
// check still rejects init() — the handoff that lets TRANSLATION_BACKEND=auto
// fall back to CPU Xenova (existing translation-service contract, untouched).
const http = require('http');
const { EventEmitter } = require('events');

function mockTransport(statusCode, body) {
  const requests = [];
  const spy = jest.spyOn(http, 'request').mockImplementation((options, cb) => {
    const req = new EventEmitter();
    req.write = (d) => requests.push({ options, body: String(d) });
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = statusCode;
      process.nextTick(() => {
        cb(res);
        res.emit('data', body);
        res.emit('end');
      });
    };
    return req;
  });
  return { requests, spy };
}

function freshBackend(url) {
  process.env.VLLM_TRANSLATION_MODEL_ID = 'facebook/nllb-200-3.3B';
  process.env.NLLB_TRANSLATE_URL = url || 'http://nllb-translate:9201';
  jest.resetModules();
  return require('../services/translation/gpu-translate-backend');
}

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.NLLB_TRANSLATE_URL;
  delete process.env.VLLM_TRANSLATION_MODEL_ID; // same-worker leak flips other suites' model detection
});

describe('gpu-translate-backend NLLB branch (F6)', () => {
  it('loads the nllb-200 language map and retargets the sidecar endpoint', () => {
    const { requests } = mockTransport(200, '{"status":"ok"}');
    const GpuTranslateBackend = freshBackend();
    const b = new GpuTranslateBackend();
    expect(b.isNllb).toBe(true);
    expect(b.endpoint).toBe('http://nllb-translate:9201');
    expect(b.getLanguageCode('st')).toBe('sot_Latn');
    expect(b.getLanguageCode('en')).toBe('eng_Latn');
    expect(requests).toHaveLength(0); // constructor never calls out
  });

  it('translates the whole array in ONE batched sidecar call with FLORES codes', async () => {
    const { requests } = mockTransport(200, '{"translations":["Lumela","Ka kopa"]}');
    const GpuTranslateBackend = freshBackend();
    const b = new GpuTranslateBackend();
    b.initialized = true;

    const out = await b.translate(['Hello', 'Please'], 'eng_Latn', 'sot_Latn');

    expect(out).toEqual(['Lumela', 'Ka kopa']);
    expect(requests).toHaveLength(1); // batch — the per-text loop is gone
    const { options, body } = requests[0];
    expect(options.hostname).toBe('nllb-translate');
    expect(options.path).toBe('/translate');
    expect(options.timeout).toBe(34000); // 30 s base + 2 s per text — batch-scaled
    expect(JSON.parse(body)).toEqual({
      texts: ['Hello', 'Please'],
      source: 'eng_Latn',
      target: 'sot_Latn',
    });
  });

  it('rejects on a translation-count mismatch (order/count must be preserved)', async () => {
    mockTransport(200, '{"translations":["only-one"]}');
    const GpuTranslateBackend = freshBackend();
    const b = new GpuTranslateBackend();
    b.initialized = true;
    await expect(b.translate(['a', 'b'], 'eng_Latn', 'sot_Latn')).rejects.toThrow(
      /1 translations for 2 texts/
    );
  });

  it('failed health check rejects init() — auto mode falls to CPU Xenova (unchanged contract)', async () => {
    jest.spyOn(http, 'request').mockImplementation((_options, _cb) => {
      const req = new EventEmitter();
      req.write = jest.fn();
      req.end = () => req.emit('error', new Error('connect ECONNREFUSED'));
      return req;
    });
    const GpuTranslateBackend = freshBackend();
    const b = new GpuTranslateBackend();
    await expect(b.init()).rejects.toThrow('connect ECONNREFUSED');
    expect(b.healthCheckPassed).toBe(false);
  });

  it('503-during-load health check rejects init() — the sidecar is NOT ready just because it answered', async () => {
    const spy = jest.spyOn(http, 'request').mockImplementation((_options, cb) => {
      const req = new EventEmitter();
      req.write = jest.fn();
      req.end = () => {
        const res = new EventEmitter();
        res.statusCode = 503;
        cb(res); // healthCheck inspects statusCode in the response callback
      };
      return req;
    });
    const GpuTranslateBackend = freshBackend();
    const b = new GpuTranslateBackend();
    await expect(b.init()).rejects.toThrow('NLLB sidecar not ready (503)');
    expect(b.healthCheckPassed).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('malformed NLLB_TRANSLATE_URL does not crash the constructor — keeps the default (auto→CPU degrade survives)', () => {
    const GpuTranslateBackend = freshBackend('not a url ://');
    let b;
    expect(() => {
      b = new GpuTranslateBackend();
    }).not.toThrow();
    expect(b.endpoint).toBe('http://nllb-translate:9201');
    expect(b.port).toBe(9201);
  });
});
