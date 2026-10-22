'use strict';

require('../setup-env');

// Mock ioredis BEFORE requiring service — constructor creates Redis client
const mockRedis = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  quit: jest.fn().mockResolvedValue('OK'),
  on: jest.fn()
};

jest.mock('ioredis', () => jest.fn().mockImplementation(() => mockRedis));

jest.mock('crypto', () => ({
  createHash: jest.fn().mockReturnValue({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn().mockReturnValue('abc123')
  })
}));

jest.mock(
  '../../shared-lib',
  () => ({
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    }
  }),
  { virtual: true }
);

// Shared mock functions for backends — allows tests to configure
// behavior of instances created internally by the service
const mockCpuTranslate = jest.fn().mockResolvedValue(['translated text']);
const mockGpuTranslate = jest.fn().mockResolvedValue(['gpu translated text']);

jest.mock('../../services/translation/cpu-translate-backend', () =>
  jest.fn().mockImplementation(() => ({
    translate: mockCpuTranslate,
    getSupportedLanguages: jest.fn().mockReturnValue({ en: 'English', fr: 'French', es: 'Spanish' }),
    getLanguageCode: jest.fn().mockImplementation((lang) => lang),
    isLanguageSupported: jest.fn().mockReturnValue(true),
    getFallbackLanguage: jest.fn().mockReturnValue(null),
    init: jest.fn().mockResolvedValue(undefined)
  }))
);

jest.mock('../../services/translation/gpu-translate-backend', () =>
  jest.fn().mockImplementation(() => ({
    // Stands for "the deployment named no endpoint of its own". The service
    // reads this to tell a configured GPU API from the in-cluster worker, so a
    // mock without it would silently take the configured path in every test.
    endpointExplicit: false,
    translate: mockGpuTranslate,
    getSupportedLanguages: jest.fn().mockReturnValue({ en: 'English', fr: 'French', es: 'Spanish' }),
    getLanguageCode: jest.fn().mockImplementation((lang) => lang),
    isLanguageSupported: jest.fn().mockReturnValue(true),
    getFallbackLanguage: jest.fn().mockReturnValue(null),
    init: jest.fn().mockResolvedValue(undefined)
  }))
);

jest.mock('unified', () => ({ unified: jest.fn() }), { virtual: true });
jest.mock('remark-parse', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('remark-stringify', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('unist-util-visit', () => ({ visit: jest.fn() }), { virtual: true });

// TODO: translateMarkdown tests are blocked by ESM dynamic imports.
// The service loads unified/remark-parse/remark-stringify via `await import()`
// in init(), which jest.mock() cannot intercept. To test properly:
// 1. Run integration tests in a Docker container with real ESM support, or
// 2. Refactor the service to accept a markdown processor via dependency injection.

const CpuTranslateBackend = require('../../services/translation/cpu-translate-backend');
const GpuTranslateBackend = require('../../services/translation/gpu-translate-backend');

let translationService;
let savedEnvVars;

beforeEach(() => {
  jest.clearAllMocks();
  mockRedis.get.mockResolvedValue(null);
  savedEnvVars = {};

  jest.isolateModules(() => {
    translationService = require('../../services/translation-service');
  });
  translationService.initialized = false;
});

afterEach(() => {
  Object.keys(savedEnvVars).forEach((key) => {
    if (savedEnvVars[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnvVars[key];
    }
  });
});

function setEnv(key, value) {
  savedEnvVars[key] = process.env[key];
  // Assigning `undefined` to process.env stores the string "undefined", which
  // is truthy — an unset knob would then read as a set one. Delete instead.
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

describe('TranslationService', () => {
  describe('constructor', () => {
    it('should create instance with correct defaults', () => {
      expect(translationService.backend).toBeNull();
      expect(translationService.initialized).toBe(false);
      expect(translationService.inFlightTranslations).toBeInstanceOf(Map);
    });
  });

  describe('selectBackend', () => {
    it('should force CPU backend when TRANSLATION_BACKEND=cpu', async () => {
      setEnv('TRANSLATION_BACKEND', 'cpu');
      jest.isolateModules(() => {
        translationService = require('../../services/translation-service');
      });
      translationService.initialized = false;
      translationService.backend = null;
      await translationService.selectBackend();
      expect(translationService.backendType).toBe('cpu');
    });

    it('should force GPU backend when TRANSLATION_BACKEND=gpu', async () => {
      setEnv('TRANSLATION_BACKEND', 'gpu');
      jest.isolateModules(() => {
        translationService = require('../../services/translation-service');
      });
      translationService.initialized = false;
      translationService.backend = null;
      await translationService.selectBackend();
      expect(translationService.backendType).toBe('gpu');
    });

    it('should return existing backend if already selected', async () => {
      setEnv('TRANSLATION_BACKEND', 'cpu');
      jest.isolateModules(() => {
        translationService = require('../../services/translation-service');
      });
      translationService.initialized = false;
      translationService.backend = new CpuTranslateBackend();
      translationService.backendType = 'cpu';
      const result = await translationService.selectBackend();
      expect(result).toBe(translationService.backend);
      expect(result.translate).toBe(mockCpuTranslate);
    });

    it('should throw on invalid backend value', async () => {
      setEnv('TRANSLATION_BACKEND', 'invalid');
      jest.isolateModules(() => {
        translationService = require('../../services/translation-service');
      });
      translationService.initialized = false;
      translationService.backend = null;
      await expect(translationService.selectBackend()).rejects.toThrow('Invalid TRANSLATION_BACKEND');
    });
  });

  describe('configured GPU API', () => {
    // A deployment that named a GPU API gets it, always. CPU is not a degraded
    // mode to slide into: on a remote-GPU deployment it silently moves the
    // deployer's content onto a local model, with nothing in the output to say
    // so. When no GPU API is configured the choice is legitimate and
    // TRANSLATION_BACKEND decides.

    // A fresh instance per case — `translationBackend` and `gpuNodeHost` are
    // read at module load, so changing env after the require proves nothing.
    const serviceWithEnv = (env) => {
      setEnv('TRANSLATION_BACKEND', env.backend);
      setEnv('GPU_NODE_HOST', env.gpuNodeHost);
      jest.isolateModules(() => {
        translationService = require('../../services/translation-service');
      });
      translationService.initialized = false;
      translationService.backend = null;
      translationService.backendType = null;
      return translationService;
    };

    // An endpoint of its own says "GPU API configured" even with no GPU node
    // host — a deployment may route through a proxy that sets only this.
    const gpuApi = (overrides = {}) => ({
      endpointExplicit: true,
      init: jest.fn().mockResolvedValue(undefined),
      getLanguageCode: (l) => l,
      translate: mockGpuTranslate,
      ...overrides
    });

    it.each(['cpu', 'gpu', 'auto', undefined])(
      'uses the GPU and ignores TRANSLATION_BACKEND=%s when a GPU API is configured',
      async (backend) => {
        const svc = serviceWithEnv({ backend, gpuNodeHost: 'gpu-node.internal' });

        await svc.selectBackend();

        expect(svc.backendType).toBe('gpu');
        expect(CpuTranslateBackend).not.toHaveBeenCalled();
      }
    );

    it.each(['cpu', 'gpu', 'auto', undefined])(
      'uses the GPU when only an explicit endpoint says one is configured (TRANSLATION_BACKEND=%s)',
      async (backend) => {
        const svc = serviceWithEnv({ backend, gpuNodeHost: '' });
        GpuTranslateBackend.mockImplementationOnce(() => gpuApi());

        await svc.selectBackend();

        expect(svc.backendType).toBe('gpu');
        expect(CpuTranslateBackend).not.toHaveBeenCalled();
      }
    );

    it.each(['cpu', 'gpu', 'auto', undefined])(
      'refuses to start when the configured GPU API does not answer (TRANSLATION_BACKEND=%s)',
      async (backend) => {
        const svc = serviceWithEnv({ backend, gpuNodeHost: 'gpu-node.internal' });
        GpuTranslateBackend.mockImplementationOnce(() =>
          gpuApi({ init: jest.fn().mockRejectedValue(new Error('vLLM service health check timeout')) })
        );

        await expect(svc.selectBackend()).rejects.toThrow('health check timeout');

        // The point of the rule: no CPU, not even an initialised one.
        expect(CpuTranslateBackend).not.toHaveBeenCalled();
        expect(mockCpuTranslate).not.toHaveBeenCalled();
        expect(svc.backend).toBeNull();
      }
    );

    it('still honours TRANSLATION_BACKEND=cpu when no GPU API is configured', async () => {
      const svc = serviceWithEnv({ backend: 'cpu', gpuNodeHost: '' });

      await svc.selectBackend();

      expect(svc.backendType).toBe('cpu');
    });

    it('still falls back to CPU in auto mode when no GPU API is configured', async () => {
      // The one branch where CPU is a legitimate outcome rather than a silent
      // substitution: nothing was configured to be mandatory.
      const svc = serviceWithEnv({ backend: 'auto', gpuNodeHost: '' });
      GpuTranslateBackend.mockImplementationOnce(() =>
        gpuApi({ endpointExplicit: false, init: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) })
      );

      await svc.selectBackend();

      expect(svc.backendType).toBe('cpu');
    });
  });

  describe('getSupportedLanguages', () => {
    it('should return languages from backend', () => {
      setEnv('TRANSLATION_BACKEND', 'cpu');
      jest.isolateModules(() => {
        translationService = require('../../services/translation-service');
      });
      translationService.initialized = false;
      translationService.backend = new CpuTranslateBackend();
      translationService.backendType = 'cpu';
      const langs = translationService.getSupportedLanguages();
      expect(langs).toEqual({ en: 'English', fr: 'French', es: 'Spanish' });
    });
  });

  describe('getBackendInfo', () => {
    it('should return none type when no backend selected', () => {
      const info = translationService.getBackendInfo();
      expect(info.type).toBe('none');
      expect(info.initialized).toBe(false);
    });
  });

  describe('translate', () => {
    it('should throw when not initialized', async () => {
      translationService.initialized = false;
      translationService.backend = null;
      await expect(translationService.translate(['hello'], 'en', 'fr')).rejects.toThrow('not ready');
    });

    it('should return empty array for empty texts', async () => {
      translationService.initialized = true;
      translationService.backend = new CpuTranslateBackend();
      const result = await translationService.translate([], 'en', 'fr');
      expect(result).toEqual([]);
    });

    it('should throw for unsupported source language', async () => {
      translationService.initialized = true;
      const backend = new CpuTranslateBackend();
      backend.getLanguageCode.mockReturnValueOnce(null);
      translationService.backend = backend;
      await expect(translationService.translate(['hello'], 'invalid', 'fr')).rejects.toThrow(
        'Unsupported source language'
      );
    });

    it('should refuse an unsupported language even when there is nothing to translate', async () => {
      // The languages are resolved before the empty-texts shortcut: an
      // unsupported language is a bad request whether or not there was text to
      // translate. Resolving after the shortcut would let a request with an
      // unsupported language and no text through unnoticed.
      translationService.initialized = true;
      const backend = new CpuTranslateBackend();
      backend.getLanguageCode.mockReturnValueOnce(null);
      translationService.backend = backend;
      await expect(translationService.translate([], 'invalid', 'fr')).rejects.toThrow('Unsupported source language');
    });

    it('should translate texts via backend', async () => {
      translationService.initialized = true;
      translationService.backend = new CpuTranslateBackend();
      const result = await translationService.translate(['hello', 'world'], 'en', 'fr');
      expect(translationService.backend.translate).toHaveBeenCalledWith(['hello', 'world'], 'en', 'fr');
      expect(result).toEqual(['translated text']);
    });
  });

  describe('auto mode backend commitment', () => {
    // `auto` probes once at startup and commits to whichever backend answers.
    // A request that fails afterwards is reported, not rerouted: switching
    // models mid-answer would serve a different, lower-quality translation of
    // the same content with nothing in the output to say so.
    const withGpuBackend = () => {
      setEnv('TRANSLATION_BACKEND', 'auto');
      jest.isolateModules(() => {
        translationService = require('../../services/translation-service');
      });
      translationService.initialized = true;
      translationService.backendType = 'gpu';
      const badGpu = new GpuTranslateBackend();
      badGpu.translate.mockRejectedValue(new Error('GPU OOM'));
      translationService.backend = badGpu;
    };

    it('propagates a GPU failure instead of translating on CPU', async () => {
      withGpuBackend();
      await expect(translationService.translate(['hello'], 'en', 'fr')).rejects.toThrow('GPU OOM');
      // The harm was the construction, not just the call: a CpuTranslateBackend
      // spawns a worker thread and loads the NLLB model at construction time.
      expect(CpuTranslateBackend).not.toHaveBeenCalled();
      expect(mockCpuTranslate).not.toHaveBeenCalled();
    });

    it('propagates a GPU stream failure instead of translating on CPU', async () => {
      withGpuBackend();
      translationService.backend.translateStream = jest.fn().mockRejectedValue(new Error('GPU OOM'));
      await expect(translationService.translateStream('hello', 'en', 'fr')).rejects.toThrow('GPU OOM');
      expect(CpuTranslateBackend).not.toHaveBeenCalled();
      expect(mockCpuTranslate).not.toHaveBeenCalled();
    });

    it('does not leave a CPU backend behind when selectBackend fails to start one', async () => {
      // `selectBackend` short-circuits on `this.backend`, so an instance
      // assigned before its init rejects would be reused for the life of the
      // process while the service reported itself ready on a dead backend.
      setEnv('TRANSLATION_BACKEND', 'auto');
      jest.isolateModules(() => {
        translationService = require('../../services/translation-service');
      });
      // selectBackend constructs its own instances, so the failures have to be
      // queued on the constructors rather than on an instance held here.
      GpuTranslateBackend.mockImplementationOnce(() => ({
        init: jest.fn().mockRejectedValue(new Error('GPU OOM')),
        getLanguageCode: (l) => l,
        translate: mockGpuTranslate
      }));
      CpuTranslateBackend.mockImplementationOnce(() => ({
        init: jest.fn().mockRejectedValue(new Error('NLLB worker failed to start')),
        getLanguageCode: (l) => l
      }));

      await expect(translationService.selectBackend()).rejects.toThrow('NLLB worker failed to start');
      expect(translationService.backend).toBeNull();
    });
  });

  describe('the markdown translation cache key', () => {
    // The cache is permanent, so the key has to say everything that makes two
    // translations different: the content, the language pair as the MODEL sees
    // it, the model, and the version of the translation logic.
    const serviceWithCache = (backend) => {
      setEnv('TRANSLATION_CACHE', 'on');
      jest.isolateModules(() => {
        translationService = require('../../services/translation-service');
      });
      translationService.initialized = true;
      translationService.backend = backend;
      translationService.backendType = 'stub';
      // The markdown pipeline is injected: the service loads unified and
      // remark through a dynamic import, which Jest cannot intercept.
      translationService.unified = () => ({
        use: () => ({
          parse: () => ({ type: 'root' }),
          stringify: () => 'TRANSLATED'
        })
      });
      translationService.remarkParse = {};
      translationService.remarkStringify = {};
      translationService.visit = (tree, type, callback) => callback({ value: 'hello' });
      return translationService;
    };

    // A backend whose map sends two languages to the same model code — the
    // NLLB map does that for "man" and "mnk" (both "dyu_Latn").
    const stubBackendWithModelCodes = (codes) => ({
      getLanguageCode: jest.fn((code) => (Object.prototype.hasOwnProperty.call(codes, code) ? codes[code] : null)),
      isLanguageSupported: jest.fn(() => true),
      getFallbackLanguage: jest.fn(() => null),
      translate: jest.fn().mockResolvedValue(['translated']),
      getBackendInfo: jest.fn(() => ({ model: 'stub-model' }))
    });

    const lastCacheKey = () => mockRedis.get.mock.calls[mockRedis.get.mock.calls.length - 1][0];

    it('keys the cache on the codes the model is asked for', async () => {
      const svc = serviceWithCache(stubBackendWithModelCodes({ en: 'eng_Latn', fr: 'fra_Latn' }));

      await svc.translateMarkdown('hello', 'en', 'fr');

      const key = lastCacheKey();
      expect(key).toContain('eng_Latn');
      expect(key).toContain('fra_Latn');
      // The canonical codes would name a language the model was never asked
      // for: the key has to say what the model was asked.
      expect(key).not.toContain(':en:');
      expect(key).not.toContain(':fr:');
    });

    it('gives two languages the model answers alike one cache entry', async () => {
      // The shipped NLLB map sends two languages to the same model code
      // ("man" and "mnk" are both "dyu_Latn"), so they are the same request
      // to the model and belong in the same cache entry.
      const nllbMap = require('../../services/translation/language-maps/nllb-200-map.js');
      const svc = serviceWithCache(stubBackendWithModelCodes(nllbMap.languageMap));

      await svc.translateMarkdown('hello', 'en', 'man');
      const keyForMan = lastCacheKey();
      await svc.translateMarkdown('hello', 'en', 'mnk');
      const keyForMnk = lastCacheKey();

      // Same request to the model, same translation, one entry.
      expect(keyForMnk).toBe(keyForMan);
    });
  });

  describe('translateStream', () => {
    beforeEach(() => {
      translationService.initialized = true;
      translationService.backendType = 'gpu';
      translationService.backend = {
        getLanguageCode: (l) => (l === 'en' ? 'English' : l === 'es' ? 'Spanish' : null),
        isLanguageSupported: (l) => ['es', 'fr'].includes(l),
        getFallbackLanguage: () => null,
        translateStream: jest.fn(async (unit, src, tgt, ctx, onToken) => {
          if (onToken) onToken('tok');
          return 'translated';
        })
      };
    });

    it('delegates to backend.translateStream and forwards onToken', async () => {
      const onToken = jest.fn();
      const result = await translationService.translateStream('hi', 'en', 'es', null, onToken);
      expect(result).toBe('translated');
      expect(translationService.backend.translateStream).toHaveBeenCalled();
      expect(onToken).toHaveBeenCalledWith('tok');
    });

    it('returns empty string for empty unit', async () => {
      await expect(translationService.translateStream('', 'en', 'es')).resolves.toBe('');
    });

    it('refuses an unsupported language even when there is nothing to translate', async () => {
      // The languages are resolved before the empty-unit shortcut: an
      // unsupported language is a bad request whether or not there was a unit
      // to translate. Resolving after the shortcut would let a request with an
      // unsupported language and no text through unnoticed — and the streaming
      // path would answer in English while the post-stream path refused it.
      await expect(translationService.translateStream('', 'en', 'xx')).rejects.toThrow(/Unsupported target language/);
    });

    it('throws on unsupported source language', async () => {
      await expect(translationService.translateStream('hi', 'xx', 'es')).rejects.toThrow(/Unsupported source language/);
    });

    it('falls back to backend.translate (non-streaming) when backend has no translateStream', async () => {
      translationService.backend.translateStream = undefined;
      translationService.backend.translate = jest.fn(async (_arr) => ['batch-result']);
      const onToken = jest.fn();
      const result = await translationService.translateStream('hi', 'en', 'es', null, onToken);
      expect(result).toBe('batch-result');
      expect(onToken).toHaveBeenCalledWith('batch-result');
    });

    it('propagates a stream failure instead of falling back mid-stream', async () => {
      translationService.backendType = 'gpu';
      translationService.backend = {
        getLanguageCode: (l) => l,
        isLanguageSupported: () => true,
        translateStream: jest.fn().mockRejectedValue(new Error('GPU down'))
      };
      // A fallback here would emit into a caller that has already rendered the
      // first attempt's deltas, so the second translation arrives glued to it.
      await expect(translationService.translateStream('hi', 'en', 'es')).rejects.toThrow('GPU down');
      expect(mockCpuTranslate).not.toHaveBeenCalled();
    });

    it('uses fallback language when target is not directly supported', async () => {
      translationService.backend = {
        getLanguageCode: (l) => (l === 'en' ? 'English' : l === 'es' ? 'Spanish' : null),
        isLanguageSupported: (l) => l === 'es',
        getFallbackLanguage: (l) => (l === 'fr' ? 'es' : null),
        translateStream: jest.fn(async () => 'fallback-translated')
      };
      const result = await translationService.translateStream('hi', 'en', 'fr');
      expect(result).toBe('fallback-translated');
      expect(translationService.backend.translateStream).toHaveBeenCalledWith(
        'hi',
        'English',
        'Spanish',
        undefined,
        undefined
      );
    });

    it('throws when target is unsupported with no fallback', async () => {
      translationService.backend = {
        getLanguageCode: (l) => (l === 'en' ? 'English' : null),
        isLanguageSupported: () => false,
        getFallbackLanguage: () => null,
        translateStream: jest.fn()
      };
      await expect(translationService.translateStream('hi', 'en', 'xx')).rejects.toThrow(/Unsupported target language/);
    });
  });
});
