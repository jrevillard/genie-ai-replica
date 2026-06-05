'use strict';

require('../setup-env');

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock(
  '../../shared-lib',
  () => ({
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    },
    dbService: { getConnection: jest.fn() }
  }),
  { virtual: true }
);

jest.mock('worker_threads', () => {
  const mockWorkerCallbacks = {};
  let exitResolve = null;
  const mockWorker = {
    on: jest.fn(),
    postMessage: jest.fn(),
    terminate: jest.fn(),
    once: jest.fn((event, cb) => {
      if (event === 'exit') {
        exitResolve = cb;
      }
    }),
    _getCallbacks: () => mockWorkerCallbacks,
    _fireExit: (code) => {
      if (exitResolve) {
        exitResolve(code);
        exitResolve = null;
      }
    }
  };

  return {
    Worker: jest.fn(() => mockWorker)
  };
});

const CpuTranslateBackend = require('../../services/translation/cpu-translate-backend');

describe('CpuTranslateBackend', () => {
  let backend;
  let mockWorker;
  const { Worker } = require('worker_threads');

  beforeEach(() => {
    jest.clearAllMocks();
    mockWorker = new Worker();
    backend = new CpuTranslateBackend();
  });

  afterEach(async () => {
    if (backend) {
      const terminatePromise = backend.terminate();
      // Fire exit handler so terminate() resolves without 5s timeout
      mockWorker._fireExit(0);
      await terminatePromise;
    }
  });

  describe('constructor', () => {
    it('should initialize with default config when env vars not set', () => {
      const testBackend = new CpuTranslateBackend();
      expect(testBackend.modelId).toBe('Xenova/nllb-200-distilled-600M');
      expect(testBackend.threads).toBe(4);
      expect(testBackend.batches).toBe(5);
      expect(testBackend.worker).toBeDefined();
      expect(testBackend.workerReady).toBe(false);
      expect(testBackend.messageQueue).toBeInstanceOf(Map);
      expect(testBackend.messageId).toBe(0);
      expect(testBackend.initialized).toBe(false);
    });

    it('should initialize with custom config from env vars', () => {
      process.env.TRANSLATION_CPU_MODEL_ID = 'custom/model';
      process.env.TRANSLATION_THREADS = '8';
      process.env.TRANSLATION_BATCHES = '10';

      const customBackend = new CpuTranslateBackend();
      expect(customBackend.modelId).toBe('custom/model');
      expect(customBackend.threads).toBe(8);
      expect(customBackend.batches).toBe(10);

      delete process.env.TRANSLATION_CPU_MODEL_ID;
      delete process.env.TRANSLATION_THREADS;
      delete process.env.TRANSLATION_BATCHES;
    });

    it('should spawn worker and send init message', () => {
      expect(Worker).toHaveBeenCalledWith(
        expect.stringContaining('cpu-translation-worker.js'),
        expect.objectContaining({
          workerData: expect.objectContaining({
            modelId: expect.any(String),
            threads: expect.any(Number)
          })
        })
      );
      expect(mockWorker.postMessage).toHaveBeenCalledWith({ type: 'init' });
    });
  });

  describe('spawnWorker', () => {
    it('should set up worker event handlers', () => {
      expect(mockWorker.on).toHaveBeenCalledWith('message', expect.any(Function));
      expect(mockWorker.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockWorker.on).toHaveBeenCalledWith('exit', expect.any(Function));
    });

    it('should handle worker error events', () => {
      const errorHandler = mockWorker.on.mock.calls.find((call) => call[0] === 'error')[1];
      const error = new Error('Worker failed');
      errorHandler(error);

      expect(backend.workerReady).toBe(false);
    });

    it('should handle worker exit with non-zero code', () => {
      const exitHandler = mockWorker.on.mock.calls.find((call) => call[0] === 'exit')[1];
      exitHandler(1);

      expect(backend.worker).toBe(null);
      expect(backend.workerReady).toBe(false);
    });

    it('should handle worker exit with zero code', () => {
      const exitHandler = mockWorker.on.mock.calls.find((call) => call[0] === 'exit')[1];
      exitHandler(0);

      expect(backend.worker).toBe(null);
      expect(backend.workerReady).toBe(false);
    });
  });

  describe('handleWorkerMessage', () => {
    let messageHandler;

    beforeEach(() => {
      messageHandler = mockWorker.on.mock.calls.find((call) => call[0] === 'message')[1];
    });

    it('should handle init success message', () => {
      messageHandler({ type: 'init', success: true });
      expect(backend.workerReady).toBe(true);
    });

    it('should handle init failure message', () => {
      messageHandler({ type: 'init', success: false, error: 'Load failed' });
      expect(backend.workerReady).toBe(false);
    });

    it('should resolve pending promise on translate success', async () => {
      backend.messageQueue.set(1, {
        resolve: jest.fn(),
        reject: jest.fn()
      });

      messageHandler({
        type: 'translate',
        success: true,
        data: { messageId: 1, translations: ['translated text'] }
      });

      expect(backend.messageQueue.has(1)).toBe(false);
    });

    it('should reject pending promise on translate failure', () => {
      backend.messageQueue.set(2, {
        resolve: jest.fn(),
        reject: jest.fn()
      });

      messageHandler({
        type: 'translate',
        success: false,
        error: 'Translation failed',
        data: { messageId: 2 }
      });

      expect(backend.messageQueue.has(2)).toBe(false);
    });

    it('should log warning for unknown message type', () => {
      messageHandler({ type: 'unknown', success: true });
      expect(backend.messageQueue.has(2)).toBe(false);
    });

    it('should handle stale message IDs', () => {
      messageHandler({
        type: 'translate',
        success: true,
        data: { messageId: 999, translations: [] }
      });
      expect(backend.messageQueue.has(999)).toBe(false);
    });
  });

  describe('loadLanguageMap', () => {
    it('should load default NLLB-200 map for unknown model', () => {
      process.env.TRANSLATION_CPU_MODEL_ID = 'unknown/model';
      const testBackend = new CpuTranslateBackend();
      expect(testBackend.languageMap).toBeDefined();
      delete process.env.TRANSLATION_CPU_MODEL_ID;
    });

    it('should set fallback map from language map', () => {
      expect(backend.fallbackMap).toBeDefined();
    });
  });

  describe('getLanguageCode', () => {
    it('should throw when language map not loaded', () => {
      backend.languageMap = null;
      expect(() => backend.getLanguageCode('en')).toThrow('[CPU-BACKEND] Language map not loaded');
    });

    it('should return null for unsupported language code', () => {
      const result = backend.getLanguageCode('xyz');
      expect(result).toBeNull();
    });
  });

  describe('getFallbackLanguage', () => {
    it('should return null when fallback map not loaded', () => {
      backend.fallbackMap = null;
      expect(backend.getFallbackLanguage('en')).toBeNull();
    });

    it('should return null for language without fallback', () => {
      const result = backend.getFallbackLanguage('xyz');
      expect(result).toBeNull();
    });
  });

  describe('isLanguageSupported', () => {
    it('should return false when language map not loaded', () => {
      backend.languageMap = null;
      expect(backend.isLanguageSupported('en')).toBeFalsy();
    });
  });

  describe('getSupportedLanguages', () => {
    it('should return empty object when language map not loaded', () => {
      backend.languageMap = null;
      expect(backend.getSupportedLanguages()).toEqual({});
    });
  });

  describe('translate', () => {
    let messageHandler;

    beforeEach(() => {
      messageHandler = mockWorker.on.mock.calls.find((call) => call[0] === 'message')[1];
      backend.initialized = true;
      backend.workerReady = true;
    });

    it('should throw when not initialized', async () => {
      backend.initialized = false;
      await expect(backend.translate(['text'], 'en', 'fr')).rejects.toThrow('[CPU-BACKEND] Backend is not ready.');
    });

    it('should throw when worker not ready', async () => {
      backend.workerReady = false;
      await expect(backend.translate(['text'], 'en', 'fr')).rejects.toThrow('[CPU-BACKEND] Backend is not ready.');
    });

    it('should return empty array for empty input', async () => {
      const result = await backend.translate([], 'en', 'fr');
      expect(result).toEqual([]);
    });

    it('should return empty array for null input', async () => {
      const result = await backend.translate(null, 'en', 'fr');
      expect(result).toEqual([]);
    });

    it('should successfully translate texts', async () => {
      const translatePromise = backend.translate(['Hello'], 'en', 'fr');

      setTimeout(() => {
        messageHandler({
          type: 'translate',
          success: true,
          data: { messageId: 1, translations: ['Bonjour'] }
        });
      }, 10);

      const result = await translatePromise;
      expect(result).toEqual(['Bonjour']);
    });

    it('should reject on translation failure', async () => {
      const translatePromise = backend.translate(['Hello'], 'en', 'fr');

      setTimeout(() => {
        messageHandler({
          type: 'translate',
          success: false,
          error: 'Translation error',
          data: { messageId: 1 }
        });
      }, 10);

      // Error is re-wrapped by translate() catch block
      await expect(translatePromise).rejects.toThrow('[CPU-BACKEND] Failed to perform translation.');
    });

    it('should increment messageId for each translation', async () => {
      const promise1 = backend.translate(['text1'], 'en', 'fr');
      setTimeout(() => {
        messageHandler({
          type: 'translate',
          success: true,
          data: { messageId: 1, translations: ['translated1'] }
        });
      }, 10);

      await promise1;
      expect(backend.messageId).toBe(1);

      const promise2 = backend.translate(['text2'], 'en', 'fr');
      setTimeout(() => {
        messageHandler({
          type: 'translate',
          success: true,
          data: { messageId: 2, translations: ['translated2'] }
        });
      }, 10);

      await promise2;
      expect(backend.messageId).toBe(2);
    });
  });

  describe('init', () => {
    it('should skip initialization if already initialized', async () => {
      backend.initialized = true;
      await expect(backend.init()).resolves.toBeUndefined();
    });

    it('should timeout waiting for worker', async () => {
      backend.initialized = false;
      backend.workerReady = false;

      await expect(backend.init(50)).rejects.toThrow('[CPU-BACKEND] Worker initialization timeout');
    });
  });

  describe('getBackendInfo', () => {
    it('should return complete backend info', () => {
      const info = backend.getBackendInfo();

      expect(info).toMatchObject({
        type: 'cpu',
        model: expect.any(String),
        modelId: expect.any(String),
        codeFormat: expect.any(String),
        threads: expect.any(Number),
        batches: expect.any(Number),
        initialized: false,
        workerReady: false,
        usingWorkerThreads: true
      });
    });

    it('should handle missing language map', () => {
      backend.languageMap = null;
      const info = backend.getBackendInfo();

      expect(info.modelId).toBe(backend.modelId);
      expect(info.codeFormat).toBe('unknown');
    });
  });

  describe('terminate', () => {
    it('should send terminate message and wait for exit', async () => {
      const terminatePromise = backend.terminate();
      mockWorker._fireExit(0);
      await terminatePromise;

      expect(mockWorker.postMessage).toHaveBeenCalledWith({ type: 'terminate' });
      expect(backend.worker).toBeNull();
      expect(backend.workerReady).toBe(false);
    });

    it('should force terminate after timeout', async () => {
      await backend.terminate(1);

      expect(mockWorker.postMessage).toHaveBeenCalledWith({ type: 'terminate' });
      expect(backend.worker).toBeNull();
    });

    it('should do nothing when worker is null', async () => {
      backend.worker = null;
      await expect(backend.terminate()).resolves.toBeUndefined();
    });
  });
});
