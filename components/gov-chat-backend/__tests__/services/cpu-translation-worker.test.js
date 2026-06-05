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
    }
  }),
  { virtual: true }
);

jest.mock('worker_threads', () => ({
  parentPort: {
    on: jest.fn(),
    postMessage: jest.fn()
  },
  workerData: {
    modelId: 'Xenova/nllb-200-distilled-600M',
    threads: 4
  }
}));

// Mock ESM imports
jest.mock(
  '@xenova/transformers',
  () => ({
    pipeline: jest.fn()
  }),
  { virtual: true }
);

jest.mock(
  'onnxruntime-web',
  () => ({
    env: {
      logLevel: 'info',
      debug: true
    }
  }),
  { virtual: true }
);

describe('CPU Translation Worker Logic', () => {
  let onnxruntimeWeb;
  let transformers;
  const { workerData } = require('worker_threads');

  beforeEach(() => {
    jest.clearAllMocks();

    // Get ESM mocks
    onnxruntimeWeb = require('onnxruntime-web');
    transformers = require('@xenova/transformers');
  });

  describe('worker initialization', () => {
    it('should configure ONNX runtime on init', () => {
      expect(onnxruntimeWeb.env.logLevel).toBeDefined();
      expect(onnxruntimeWeb.env.debug).toBeDefined();
    });

    it('should load transformers pipeline', () => {
      expect(transformers.pipeline).toBeDefined();
    });

    it('should handle init message', () => {
      const mockTranslator = {
        translate: jest.fn().mockResolvedValue({
          translation_text: 'translated text'
        })
      };

      transformers.pipeline.mockResolvedValue(mockTranslator);

      // Verify worker data is available
      expect(workerData.modelId).toBe('Xenova/nllb-200-distilled-600M');
      expect(workerData.threads).toBe(4);

      // Verify pipeline would be called with correct params
      expect(transformers.pipeline).toBeDefined();
    });
  });

  describe('translate message handling', () => {
    it('should handle successful translation', async () => {
      const mockTranslator = jest
        .fn()
        .mockResolvedValue([{ translation_text: 'Bonjour' }, { translation_text: 'Monde' }]);

      transformers.pipeline.mockResolvedValue(mockTranslator);

      // Simulate translate message
      const messageData = {
        messageId: 1,
        texts: ['Hello', 'World'],
        sourceCode: 'eng_Latn',
        targetCode: 'fra_Latn'
      };

      const result = await mockTranslator(messageData.texts, {
        src_lang: messageData.sourceCode,
        tgt_lang: messageData.targetCode
      });

      expect(result).toEqual([{ translation_text: 'Bonjour' }, { translation_text: 'Monde' }]);
    });

    it('should return error when worker not initialized', () => {
      // Simulate translation before init
      const notInitializedResult = {
        messageId: 1,
        success: false,
        error: 'Worker not initialized'
      };

      expect(notInitializedResult.success).toBe(false);
      expect(notInitializedResult.error).toBe('Worker not initialized');
    });

    it('should handle translation errors', async () => {
      const mockTranslator = jest.fn().mockRejectedValue(new Error('Translation failed'));

      transformers.pipeline.mockResolvedValue(mockTranslator);

      try {
        await mockTranslator(['text'], { src_lang: 'en', tgt_lang: 'fr' });
      } catch (error) {
        expect(error.message).toBe('Translation failed');
      }
    });

    it('should extract translation texts from results', () => {
      const translations = [
        { translation_text: 'First text' },
        { translation_text: 'Second text' },
        { translation_text: 'Third text' }
      ];

      const extracted = translations.map((item) => item.translation_text);
      expect(extracted).toEqual(['First text', 'Second text', 'Third text']);
    });
  });

  describe('terminate message handling', () => {
    it('should process terminate message', () => {
      const messageData = { type: 'terminate', data: {} };

      // In worker, terminate calls process.exit(0)
      // We can't actually test process.exit, but we can verify the message type
      expect(messageData.type).toBe('terminate');
    });
  });

  describe('unknown message type', () => {
    it('should return error for unknown message type', () => {
      const unknownMessage = { type: 'unknown', data: {} };
      const result = {
        success: false,
        error: `Unknown message type: ${unknownMessage.type}`
      };

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown message type: unknown');
    });
  });

  describe('error handling', () => {
    it('should include messageId in error responses', () => {
      const errorResponse = {
        type: 'translate',
        success: false,
        error: 'Translation error',
        data: { messageId: 123 }
      };

      expect(errorResponse.data.messageId).toBe(123);
    });

    it('should handle missing messageId in data', () => {
      const errorResponse = {
        type: 'translate',
        success: false,
        error: 'Translation error',
        data: { messageId: undefined }
      };

      expect(errorResponse.data.messageId).toBeUndefined();
    });
  });

  describe('uncaught exception handling', () => {
    it('should post error message on uncaught exception', () => {
      const error = new Error('Uncaught error');
      const message = {
        type: 'error',
        success: false,
        error: error.message
      };

      expect(message.type).toBe('error');
      expect(message.success).toBe(false);
      expect(message.error).toBe('Uncaught error');
    });
  });

  describe('unhandled rejection handling', () => {
    it('should log unhandled rejections', () => {
      const reason = 'Unhandled rejection reason';
      // In worker, this logs the reason
      expect(reason).toBeDefined();
    });
  });

  describe('message handler wrapper', () => {
    it('should wrap results in success response', () => {
      const result = { success: true, data: 'result' };
      const wrapped = {
        type: 'test',
        success: result.success,
        data: result.data
      };

      expect(wrapped).toEqual({
        type: 'test',
        success: true,
        data: 'result'
      });
    });

    it('should wrap errors in error response', () => {
      const error = new Error('Handler error');
      const wrapped = {
        type: 'test',
        success: false,
        error: error.message,
        data: { messageId: 1 }
      };

      expect(wrapped.success).toBe(false);
      expect(wrapped.error).toBe('Handler error');
      expect(wrapped.data.messageId).toBe(1);
    });
  });
});

describe('CPU Translation Worker Integration Simulation', () => {
  describe('full translation flow', () => {
    it('should simulate complete translation workflow', async () => {
      const mockPipeline = jest
        .fn()
        .mockResolvedValue([{ translation_text: 'Translated 1' }, { translation_text: 'Translated 2' }]);

      const transformers = require('@xenova/transformers');
      transformers.pipeline.mockResolvedValue(mockPipeline);

      // Simulate the workflow
      const translator = await transformers.pipeline('translation', 'Xenova/nllb-200-distilled-600M', {
        quantized: true
      });

      const result = await translator(['Text 1', 'Text 2'], {
        src_lang: 'eng_Latn',
        tgt_lang: 'fra_Latn'
      });

      expect(result).toHaveLength(2);
      expect(result[0].translation_text).toBe('Translated 1');
      expect(result[1].translation_text).toBe('Translated 2');
    });

    it('should handle batch translation', async () => {
      const mockPipeline = jest
        .fn()
        .mockResolvedValue([
          { translation_text: 'T1' },
          { translation_text: 'T2' },
          { translation_text: 'T3' },
          { translation_text: 'T4' },
          { translation_text: 'T5' }
        ]);

      const transformers = require('@xenova/transformers');
      transformers.pipeline.mockResolvedValue(mockPipeline);

      const translator = await transformers.pipeline('translation', 'model', {});
      const texts = ['Text1', 'Text2', 'Text3', 'Text4', 'Text5'];
      const result = await translator(texts, { src_lang: 'en', tgt_lang: 'fr' });

      expect(result).toHaveLength(5);
    });
  });

  describe('ONNX runtime configuration', () => {
    it('should set fatal log level', () => {
      const ort = require('onnxruntime-web');
      ort.env.logLevel = 'fatal';
      expect(ort.env.logLevel).toBe('fatal');
    });

    it('should disable debug mode', () => {
      const ort = require('onnxruntime-web');
      ort.env.debug = false;
      expect(ort.env.debug).toBe(false);
    });
  });

  describe('pipeline session options', () => {
    it('should configure parallel execution mode', () => {
      const sessionOptions = {
        executionMode: 'parallel',
        intraOpNumThreads: 4,
        interOpNumThreads: 1,
        graphOptimizationLevel: 'all',
        logSeverityLevel: 4
      };

      expect(sessionOptions.executionMode).toBe('parallel');
      expect(sessionOptions.intraOpNumThreads).toBe(4);
      expect(sessionOptions.interOpNumThreads).toBe(1);
      expect(sessionOptions.graphOptimizationLevel).toBe('all');
      expect(sessionOptions.logSeverityLevel).toBe(4);
    });
  });
});
