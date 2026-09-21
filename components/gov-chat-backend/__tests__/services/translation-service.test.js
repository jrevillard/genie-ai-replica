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
  process.env[key] = value;
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

  describe('translate - foreign-word retry (bn)', () => {
    it('retries once with a hint naming the leaked words, for Bengali targets only', async () => {
      translationService.initialized = true;
      const backend = new GpuTranslateBackend();
      // The acronym BAMIS is shielded as ⟦0⟧ before the model sees it (see
      // protect-tokens.js); a real translator echoes the placeholder, which the
      // service restores. The mocks do the same.
      backend.translate
        .mockResolvedValueOnce(['বর্তমানে oficiais ⟦0⟧ ক্যালেন্ডার'])
        .mockResolvedValueOnce(['বর্তমানে সরকারি ⟦0⟧ ক্যালেন্ডার']);
      translationService.backend = backend;
      translationService.backendType = 'gpu';
      const out = await translationService.translate(['the official BAMIS calendar'], 'en', 'bn');
      expect(out).toEqual(['বর্তমানে সরকারি BAMIS ক্যালেন্ডার']);
      expect(backend.translate).toHaveBeenCalledTimes(2);
      // The model was handed the shielded source, never the acronym itself.
      expect(backend.translate.mock.calls[0][0]).toEqual(['the official ⟦0⟧ calendar']);
      const [, , , opts] = backend.translate.mock.calls[1];
      expect(opts.hint).toContain('"oficiais"');
    });

    it('keeps retrying (bounded) when a retry swaps one leaked word for another', async () => {
      translationService.initialized = true;
      const backend = new GpuTranslateBackend();
      backend.translate
        .mockResolvedValueOnce(['PACKAGE ক্যালেন্ডার'])
        .mockResolvedValueOnce(['populaire ক্যালেন্ডার'])
        .mockResolvedValueOnce(['জনপ্রিয় ক্যালেন্ডার']);
      translationService.backend = backend;
      const out = await translationService.translate(['the popular calendar'], 'en', 'bn');
      expect(out).toEqual(['জনপ্রিয় ক্যালেন্ডার']);
      expect(backend.translate).toHaveBeenCalledTimes(3);
      // The second retry names both words leaked so far.
      const [, , , opts] = backend.translate.mock.calls[2];
      expect(opts.hint).toContain('"PACKAGE"');
      expect(opts.hint).toContain('"populaire"');
    });

    it('does not retry when the output is clean, nor for non-Bengali targets', async () => {
      translationService.initialized = true;
      const backend = new GpuTranslateBackend();
      backend.translate.mockResolvedValueOnce(['বর্তমানে সরকারি ক্যালেন্ডার']);
      translationService.backend = backend;
      await translationService.translate(['the official calendar'], 'en', 'bn');
      expect(backend.translate).toHaveBeenCalledTimes(1);

      backend.translate.mockClear().mockResolvedValueOnce(['calendario oficiais']);
      await translationService.translate(['the official calendar'], 'en', 'es');
      expect(backend.translate).toHaveBeenCalledTimes(1);
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

    it('should translate texts via backend', async () => {
      translationService.initialized = true;
      translationService.backend = new CpuTranslateBackend();
      const result = await translationService.translate(['hello', 'world'], 'en', 'fr');
      expect(translationService.backend.translate).toHaveBeenCalledWith(['hello', 'world'], 'en', 'fr');
      expect(result).toEqual(['translated text']);
    });
  });

  describe('GPU to CPU fallback', () => {
    it('should fall back to CPU when GPU fails in auto mode', async () => {
      setEnv('TRANSLATION_BACKEND', 'auto');
      jest.isolateModules(() => {
        translationService = require('../../services/translation-service');
      });
      translationService.initialized = true;
      translationService.backendType = 'gpu';

      const badGpu = new GpuTranslateBackend();
      badGpu.translate.mockRejectedValueOnce(new Error('GPU OOM'));
      translationService.backend = badGpu;

      const result = await translationService.translate(['hello'], 'en', 'fr');
      expect(result).toEqual(['translated text']);
    });

    it('should throw when both backends fail', async () => {
      setEnv('TRANSLATION_BACKEND', 'auto');
      jest.isolateModules(() => {
        translationService = require('../../services/translation-service');
      });
      translationService.initialized = true;
      translationService.backendType = 'gpu';

      const badGpu = new GpuTranslateBackend();
      badGpu.translate.mockRejectedValueOnce(new Error('GPU OOM'));
      translationService.backend = badGpu;

      mockCpuTranslate.mockRejectedValueOnce(new Error('CPU fail'));

      await expect(translationService.translate(['hello'], 'en', 'fr')).rejects.toThrow(
        'Translation failed on both GPU and CPU'
      );
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

    it('falls back to CPU backend when GPU translateStream throws (auto mode)', async () => {
      translationService.backendType = 'gpu';
      translationService.backend = {
        getLanguageCode: (l) => l,
        isLanguageSupported: () => true,
        translateStream: jest.fn().mockRejectedValue(new Error('GPU down'))
      };
      // CpuTranslateBackend is mocked at the top of this file (translate ->
      // mockCpuTranslate -> ['translated text']).
      const result = await translationService.translateStream('hi', 'en', 'es');
      expect(result).toBe('translated text');
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
      // No onToken -> the marker scrubber is not created and null is passed through.
      expect(translationService.backend.translateStream).toHaveBeenCalledWith(
        'hi',
        'English',
        'Spanish',
        undefined,
        null
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
