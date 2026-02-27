const { logger } = require('../../shared-lib');

/**
 * CPU Translation Backend
 *
 * Uses transformers.js for CPU-based translation.
 * Supports configurable models via .env (NLLB-200, etc.)
 * Default: facebook/nllb-200-distilled-600M
 */

class CpuTranslateBackend {
  constructor() {
    // Configuration from environment variables
    this.modelId = process.env.TRANSLATION_CPU_MODEL_ID || 'Xenova/nllb-200-distilled-600M';
    this.threads = parseInt(process.env.TRANSLATION_THREADS, 10) || 4;
    this.batches = parseInt(process.env.TRANSLATION_BATCHES, 10) || 5;

    // Runtime state
    this.translator = null;
    this.initialized = false;
    this.languageMap = null;
    this.fallbackMap = null;

    logger.info(`[CPU-BACKEND] Initializing with model: ${this.modelId}`);
    logger.info(`[CPU-BACKEND] Threads: ${this.threads}, Batches: ${this.batches}`);

    // Load language map
    this.loadLanguageMap(this.modelId);
  }

  /**
   * Load language map based on model ID
   * @param {string} modelId - Model identifier
   */
  loadLanguageMap(modelId) {
    try {
      // Map model IDs to language map files
      const modelToMap = {
        'Xenova/nllb-200-distilled-600M': './language-maps/nllb-200-map.js',
        'facebook/nllb-200-distilled-600M': './language-maps/nllb-200-map.js',
      };

      const mapPath = modelToMap[modelId];

      if (!mapPath) {
        logger.warn(`[CPU-BACKEND] No language map found for model: ${modelId}, using default NLLB-200 map`);
        // Default to NLLB-200 map
        this.languageMap = require('./language-maps/nllb-200-map.js');
      } else {
        this.languageMap = require(mapPath);
        logger.info(`[CPU-BACKEND] Loaded language map: ${this.languageMap.modelName}`);
      }

      this.fallbackMap = this.languageMap.fallbackMap || {};
    } catch (error) {
      logger.error(`[CPU-BACKEND] Failed to load language map: ${error.message}`);
      throw new Error(`Failed to load language map for model ${modelId}`);
    }
  }

  /**
   * Initialize backend (load model into memory)
   */
  async init() {
    if (this.initialized) {
      logger.debug('[CPU-BACKEND] Already initialized, skipping');
      return;
    }

    try {
      logger.info('[CPU-BACKEND] Starting initialization: Loading AI model...');

      // Import ONNX runtime first
      const ort = await import('onnxruntime-web');
      ort.env.logLevel = 'fatal';
      ort.env.debug = false;
      logger.debug('[CPU-BACKEND] Set ONNX global log level to fatal');

      // Dynamically import the ESM-only transformers.js library
      const { pipeline } = await import('@xenova/transformers');
      logger.debug('[CPU-BACKEND] Loaded transformers.js pipeline');

      // Load the quantized translation pipeline for faster performance
      this.translator = await pipeline('translation', this.modelId, {
        quantized: true,
        session_options: {
          executionMode: 'parallel',
          intraOpNumThreads: this.threads,
          interOpNumThreads: 1,
          graphOptimizationLevel: 'all',
          logSeverityLevel: 4,
        }
      });

      logger.debug(`[CPU-BACKEND] Loaded quantized translation pipeline with ${this.threads} threads`);
      this.initialized = true;
      logger.info('[CPU-BACKEND] Initialized successfully. Model is ready.');

    } catch (error) {
      logger.error(`[CPU-BACKEND] Initialization failed: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Get model-specific language code
   * @param {string} isoCode - ISO 639-1 language code
   * @returns {string} Model-specific language code
   */
  getLanguageCode(isoCode) {
    if (!this.languageMap) {
      throw new Error('[CPU-BACKEND] Language map not loaded');
    }

    const code = this.languageMap.languageMap[isoCode];
    if (!code) {
      logger.warn(`[CPU-BACKEND] No language code mapping for: ${isoCode}`);
      return null;
    }

    return code;
  }

  /**
   * Get fallback language code
   * @param {string} isoCode - ISO 639-1 language code
   * @returns {string|null} Fallback language code or null
   */
  getFallbackLanguage(isoCode) {
    if (!this.fallbackMap) {
      return null;
    }

    return this.fallbackMap[isoCode] || null;
  }

  /**
   * Check if language is supported
   * @param {string} isoCode - ISO 639-1 language code
   * @returns {boolean} True if supported
   */
  isLanguageSupported(isoCode) {
    return this.languageMap && this.languageMap.languageMap.hasOwnProperty(isoCode);
  }

  /**
   * Get all supported languages
   * @returns {Object} Language map
   */
  getSupportedLanguages() {
    return this.languageMap ? this.languageMap.languageMap : {};
  }

  /**
   * Translate using CPU model
   * @param {string[]} texts - Texts to translate
   * @param {string} sourceCode - Source language code (model-specific)
   * @param {string} targetCode - Target language code (model-specific)
   * @returns {Promise<string[]>} Translated texts
   */
  async translate(texts, sourceCode, targetCode) {
    if (!this.initialized || !this.translator) {
      logger.error('[CPU-BACKEND] Not initialized. Cannot perform translation.');
      throw new Error('[CPU-BACKEND] Backend is not ready.');
    }

    if (!texts || texts.length === 0) {
      logger.warn('[CPU-BACKEND] translate called with empty array.');
      return [];
    }

    logger.info(`[CPU-BACKEND] Translating ${texts.length} texts from ${sourceCode} to ${targetCode}`);

    try {
      const startTime = Date.now();

      const translations = await this.translator(texts, {
        src_lang: sourceCode,
        tgt_lang: targetCode,
      });

      const duration = Date.now() - startTime;
      logger.info(`[CPU-BACKEND] Translation completed in ${duration}ms.`);

      const translatedTexts = translations.map(item => item.translation_text);
      logger.debug(`[CPU-BACKEND] Extracted ${translatedTexts.length} translated texts`);

      return translatedTexts;

    } catch (error) {
      logger.error(`[CPU-BACKEND] Translation failed: ${error.message}`, {
        stack: error.stack,
        sourceCode: sourceCode,
        targetCode: targetCode
      });
      throw new Error('[CPU-BACKEND] Failed to perform translation.');
    }
  }

  /**
   * Get backend information
   * @returns {Object} Backend info
   */
  getBackendInfo() {
    return {
      type: 'cpu',
      model: this.modelId,
      modelId: this.languageMap?.modelName || this.modelId,
      codeFormat: this.languageMap?.codeFormat || 'unknown',
      threads: this.threads,
      batches: this.batches,
      initialized: this.initialized,
    };
  }
}

module.exports = CpuTranslateBackend;
