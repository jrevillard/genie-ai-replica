const { logger } = require('../../shared-lib');
const { Worker } = require('worker_threads');
const path = require('path');

/**
 * CPU Translation Backend
 *
 * Uses worker threads to offload CPU-intensive translation to background threads.
 * This prevents blocking the Node.js event loop during translation.
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
    this.worker = null;
    this.workerReady = false;
    this.messageQueue = new Map(); // For tracking in-flight translation requests
    this.messageId = 0;
    this.initialized = false;
    this.languageMap = null;
    this.fallbackMap = null;

    logger.info(`[CPU-BACKEND] Initializing with model: ${this.modelId}`);
    logger.info(`[CPU-BACKEND] Threads: ${this.threads}, Batches: ${this.batches}`);
    logger.info(`[CPU-BACKEND] Using worker thread for non-blocking translation`);

    // Load language map
    this.loadLanguageMap(this.modelId);

    // Spawn worker thread
    this.spawnWorker();
  }

  /**
   * Spawn worker thread for translation
   */
  spawnWorker() {
    try {
      const workerPath = path.join(__dirname, 'cpu-translation-worker.js');

      this.worker = new Worker(workerPath, {
        workerData: {
          modelId: this.modelId,
          threads: this.threads
        }
      });

      // Handle worker messages
      this.worker.on('message', (message) => {
        this.handleWorkerMessage(message);
      });

      // Handle worker errors
      this.worker.on('error', (error) => {
        logger.error(`[CPU-BACKEND] Worker error: ${error.message}`);
        this.workerReady = false;
      });

      // Handle worker exit
      // D4b: respawn with backoff instead of orphaning the init loop — a single
      // failed model download (live 09-29: "terminated" at 30s) used to leave the
      // supervisor polling a dead worker forever while the whole API 502'd.
      this.worker.on('exit', (code) => {
        if (code !== 0) {
          logger.error(`[CPU-BACKEND] Worker stopped with exit code ${code}`);
        }
        this.workerReady = false;
        this.worker = null;
        // D4b review: fail queued translations fast instead of hanging them for
        // the hour-long outer timeout (which only deleted entries, never rejected).
        for (const { reject } of this.messageQueue.values()) {
          reject(new Error('Translation worker died'));
        }
        this.messageQueue.clear();
        this.scheduleRespawn();
      });

      logger.info('[CPU-BACKEND] Worker thread spawned');

      // Send init message to worker to start model loading
      this.worker.postMessage({ type: 'init' });
      logger.info('[CPU-BACKEND] Sent init message to worker');

    } catch (error) {
      logger.error(`[CPU-BACKEND] Failed to spawn worker: ${error.message}`);
      throw error;
    }
  }

  /**
   * D4b: respawn a dead worker, max 3 attempts with 30s backoff. A worker that
   * initializes successfully resets the counter (runtime crashes later still get
   * fresh retries). Past the cap: one ERROR log, translation stays degraded —
   * HTTP keeps serving (health must not depend on translation readiness).
   */
  scheduleRespawn() {
    if (this._shutdown) return;
    this._respawnAttempts = (this._respawnAttempts || 0) + 1;
    if (this._respawnAttempts > 3) {
      if (!this._gaveUpLogged) {
        logger.error('[CPU-BACKEND] Worker failed 3 init attempts — translation degraded (serving without it). Will retry on next container restart.');
        this._gaveUpLogged = true;
      }
      return;
    }
    logger.info(`[CPU-BACKEND] Respawning worker (attempt ${this._respawnAttempts}/3) in 30s...`);
    setTimeout(() => {
      if (!this.worker && !this._shutdown) {
        try {
          this.spawnWorker();
        } catch (e) {
          logger.error(`[CPU-BACKEND] Respawn failed: ${e.message}`);
        }
      }
    }, 30000);
  }

  shutdown() {
    this._shutdown = true;
    if (this.worker) {
      this.worker.terminate().catch?.(() => {});
    }
  }

  /**
   * Handle messages from worker thread
   */
  handleWorkerMessage(message) {
    const { type, success, data, error } = message;

    if (type === 'init') {
      if (success) {
        this.workerReady = true;
        this._respawnAttempts = 0;
        this._gaveUpLogged = false;
        logger.info('[CPU-BACKEND] Worker initialized and ready');
      } else {
        logger.error(`[CPU-BACKEND] Worker initialization failed: ${error}`);
        this.workerReady = false;
        // D4b review: a failed init leaves the worker ALIVE but useless (zombie) —
        // no exit event ever fires, so respawn never engages. Terminate it: the
        // exit handler takes over (rejects queued work, schedules the respawn).
        if (this.worker) {
          this.worker.terminate().catch?.(() => {});
        }
      }
      return;
    }

    if (type === 'translate') {
      // Resolve the pending promise for this translation
      // Use the messageId from the response (echoed back by worker)
      const responseMessageId = data?.messageId;
      if (responseMessageId && this.messageQueue.has(responseMessageId)) {
        const { resolve, reject } = this.messageQueue.get(responseMessageId);
        this.messageQueue.delete(responseMessageId);

        if (success) {
          resolve(data.translations);
        } else {
          reject(new Error(error || 'Translation failed'));
        }
      } else {
        logger.error(`[CPU-BACKEND] Received translation response for unknown or stale messageId: ${responseMessageId}. Queue has: ${Array.from(this.messageQueue.keys()).join(', ')}`);
      }
      return;
    }

    logger.warn(`[CPU-BACKEND] Unknown message type from worker: ${type}`);
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
   * Initialize backend (initialize worker thread)
   */
  async init() {
    if (this.initialized) {
      logger.debug('[CPU-BACKEND] Already initialized, skipping');
      return;
    }

    try {
      logger.info('[CPU-BACKEND] Starting initialization: Loading model in worker thread...');

      // Wait for worker to be ready (with timeout)
      const timeout = 1200000; // 20 minutes timeout for model loading (can be slow on first run)
      const startTime = Date.now();
      let lastLogTime = startTime;

      while (!this.workerReady) {
        if (Date.now() - startTime > timeout) {
          throw new Error('[CPU-BACKEND] Worker initialization timeout');
        }

        // Log progress every 30 seconds
        if (Date.now() - lastLogTime > 30000) {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          logger.info(`[CPU-BACKEND] Still waiting for worker to initialize... (${elapsed}s elapsed)`);
          lastLogTime = Date.now();
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      this.initialized = true;
      logger.info('[CPU-BACKEND] Initialized successfully. Worker is ready.');

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
   * Translate using CPU model (via worker thread)
   * @param {string[]} texts - Texts to translate
   * @param {string} sourceCode - Source language code (model-specific)
   * @param {string} targetCode - Target language code (model-specific)
   * @returns {Promise<string[]>} Translated texts
   */
  async translate(texts, sourceCode, targetCode) {
    if (!this.initialized || !this.workerReady) {
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

      // Generate unique message ID
      this.messageId++;

      // Set timeout for this translation (1 hour for large documents)
      const timeout = setTimeout(() => {
        if (this.messageQueue.has(this.messageId)) {
          this.messageQueue.delete(this.messageId);
        }
      }, 3600000);

      // Create a promise for this translation request
      const translationPromise = new Promise((resolve, reject) => {
        // Store the promise callbacks
        this.messageQueue.set(this.messageId, { resolve, reject });

        // Send translation request to worker (include messageId for response matching)
        this.worker.postMessage({
          type: 'translate',
          data: {
            messageId: this.messageId,
            texts,
            sourceCode,
            targetCode
          }
        });
      });

      // Clear timeout when promise resolves/rejects
      translationPromise.finally(() => clearTimeout(timeout));

      // Wait for worker to complete translation (main thread is free!)
      const translatedTexts = await translationPromise;

      const duration = Date.now() - startTime;
      logger.info(`[CPU-BACKEND] Translation completed in ${duration}ms`);

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
      workerReady: this.workerReady,
      usingWorkerThreads: true,
    };
  }

  /**
   * Terminate worker thread (cleanup)
   */
  async terminate() {
    this._shutdown = true; // D4b review: graceful terminate must not trigger a respawn
    if (this.worker) {
      logger.info('[CPU-BACKEND] Terminating worker thread...');
      this.worker.postMessage({ type: 'terminate' });

      // Wait for worker to exit gracefully
      await new Promise(resolve => {
        const timeout = setTimeout(() => {
          this.worker.terminate();
          resolve();
        }, 5000);

        this.worker.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      this.worker = null;
      this.workerReady = false;
      logger.info('[CPU-BACKEND] Worker terminated');
    }
  }
}

module.exports = CpuTranslateBackend;
