const { logger } = require("../shared-lib");
const nodeCrypto = require("crypto"); // For generating cache key
const Redis = require("ioredis"); // For Redis cache

// Import backend modules
const CpuTranslateBackend = require("./translation/cpu-translate-backend");
const GpuTranslateBackend = require("./translation/gpu-translate-backend");

// --- Read settings from environment variables ---
const DEFAULT_THREADS = 4;
const DEFAULT_BATCHES = 5;

const intraOpNumThreads =
  parseInt(process.env.TRANSLATION_THREADS, 10) || DEFAULT_THREADS;
const numParallelBatches =
  parseInt(process.env.TRANSLATION_BATCHES, 10) || DEFAULT_BATCHES;
const cacheEnabled = process.env.TRANSLATION_CACHE === "on";
const translationBackend = process.env.TRANSLATION_BACKEND || "auto"; // Default to auto (tries GPU, falls back to CPU)

// --- Get Redis cache settings from env ---
const redisHost = process.env.TRANSLATION_CACHE_HOST || "localhost";
const redisPort = parseInt(process.env.TRANSLATION_CACHE_PORT, 10) || 6379;
const redisPassword = process.env.TRANSLATION_CACHE_PASSWORD || null;

/**
 * @class TranslationService
 * @description A proxy service for on-the-fly text translation using pluggable backends (CPU or GPU).
 * Backends are configurable via .env file. Defaults to CPU backend with NLLB-200.
 */
class TranslationService {
  constructor() {
    this.backend = null;
    this.backendType = null;
    this.unified = null;
    this.remarkParse = null;
    this.remarkStringify = null;
    this.visit = null;
    this.initialized = false;
    this.cacheClient = null; // For Redis client
    this.inFlightTranslations = new Map(); // Track in-progress translations: key = docHash:lang, value = Promise

    logger.info("[TRANSLATION-SERVICE] Constructor called");
    logger.info(`[TRANSLATION-CONFIG] Backend: ${translationBackend}`);
    logger.info(
      `[TRANSLATION-CONFIG] Threads: ${intraOpNumThreads}, Batches: ${numParallelBatches}`,
    );
    logger.info(`[TRANSLATION-CONFIG] Cache enabled: ${cacheEnabled}`);

    if (cacheEnabled) {
      logger.info(
        `[TRANSLATION-CONFIG] Cache connecting to Redis at ${redisHost}:${redisPort}`,
      );

      // Initialize Redis Client
      this.cacheClient = new Redis({
        host: redisHost,
        port: redisPort,
        password: redisPassword,
        // Optional: Add retry logic
        retryStrategy(times) {
          const delay = Math.min(times * 500, 2000);
          return delay;
        },
        maxRetriesPerRequest: 3,
        // Prevent hanging if Redis is down on startup
        enableOfflineQueue: false,
      });

      this.cacheClient.on("error", (err) => {
        logger.error(`[TRANSLATION-CACHE] Redis client error: ${err.message}`);
      });
      this.cacheClient.on("connect", () => {
        logger.info("[TRANSLATION-CACHE] Connected to Redis successfully.");
      });
    }
  }

  /**
   * @method selectBackend
   * @description Selects and initializes the appropriate translation backend based on configuration.
   * @returns {Promise<CpuTranslateBackend|GpuTranslateBackend>} The selected backend
   */
  async selectBackend() {
    // If backend already selected, return it
    if (this.backend) {
      return this.backend;
    }

    logger.info(
      `[TRANSLATION-SERVICE] Selecting backend: ${translationBackend}`,
    );

    try {
      if (translationBackend === "gpu") {
        // Force GPU backend
        this.backend = new GpuTranslateBackend();
        await this.backend.init();
        this.backendType = "gpu";
        logger.info(
          "[TRANSLATION-SERVICE] GPU backend selected and initialized",
        );
        return this.backend;
      }

      if (translationBackend === "cpu") {
        // Force CPU backend
        this.backend = new CpuTranslateBackend();
        await this.backend.init();
        this.backendType = "cpu";
        logger.info(
          "[TRANSLATION-SERVICE] CPU backend selected and initialized",
        );
        return this.backend;
      }

      if (translationBackend === "auto") {
        // Try GPU first, fallback to CPU
        try {
          logger.info(
            "[TRANSLATION-SERVICE] Auto mode: Trying GPU backend first",
          );
          this.backend = new GpuTranslateBackend();
          await this.backend.init();
          this.backendType = "gpu";
          logger.info(
            "[TRANSLATION-SERVICE] Auto mode: GPU backend successful",
          );
          return this.backend;
        } catch (gpuError) {
          logger.warn(
            `[TRANSLATION-SERVICE] Auto mode: GPU backend failed (${gpuError.message}), falling back to CPU`,
          );
          this.backend = new CpuTranslateBackend();
          await this.backend.init();
          this.backendType = "cpu";
          logger.info(
            "[TRANSLATION-SERVICE] Auto mode: CPU backend initialized as fallback",
          );
          return this.backend;
        }
      }

      throw new Error(
        `Invalid TRANSLATION_BACKEND value: ${translationBackend}. Must be 'cpu', 'gpu', or 'auto'`,
      );
    } catch (error) {
      logger.error(
        `[TRANSLATION-SERVICE] Backend selection failed: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * @method init
   * @description Initializes the service by selecting and initializing the translation backend.
   * This is a long-running, one-time operation on first startup.
   */
  async init() {
    if (this.initialized) {
      logger.debug("[TRANSLATION-SERVICE] Already initialized, skipping");
      return;
    }

    try {
      logger.info(
        "[TRANSLATION-SERVICE] Starting initialization: Selecting backend...",
      );

      // Select and initialize backend
      await this.selectBackend();

      // Load markdown processing libraries
      const { unified } = await import("unified");
      this.unified = unified;
      logger.debug("[TRANSLATION-SERVICE] Loaded unified");

      const remarkParseModule = await import("remark-parse");
      this.remarkParse = remarkParseModule.default;
      logger.debug("[TRANSLATION-SERVICE] Loaded remark-parse");

      const remarkStringifyModule = await import("remark-stringify");
      this.remarkStringify = remarkStringifyModule.default;
      logger.debug("[TRANSLATION-SERVICE] Loaded remark-stringify");

      const { visit } = await import("unist-util-visit");
      this.visit = visit;
      logger.debug("[TRANSLATION-SERVICE] Loaded unist-util-visit");

      this.initialized = true;
      logger.info(
        "[TRANSLATION-SERVICE] Initialized successfully. Backend is ready.",
      );
    } catch (error) {
      logger.error(
        `[TRANSLATION-SERVICE] Initialization failed: ${error.message}`,
        { stack: error.stack },
      );
      throw error;
    }
  }

  /**
   * @method translate
   * @description Translates a batch of texts from a source language to a target language.
   * @param {string[]} texts - An array of text strings to translate.
   * @param {string} sourceLang - The source language code (e.g., 'en', 'fr').
   * @param {string} targetLang - The target language code (e.g., 'fr', 'de').
   * @returns {Promise<string[]>} A promise that resolves to an array of translated text strings.
   */
  async translate(texts, sourceLang, targetLang) {
    if (!this.initialized || !this.backend) {
      logger.error(
        "[TRANSLATION-SERVICE] Not initialized. Cannot perform translation.",
      );
      throw new Error("[TRANSLATION-SERVICE] Service is not ready.");
    }

    if (!texts || texts.length === 0) {
      logger.warn(
        "[TRANSLATION-SERVICE] translate method called with empty array.",
      );
      return [];
    }

    logger.info(
      `[TRANSLATION-SERVICE] Translating ${texts.length} texts from ${sourceLang} to ${targetLang}`,
    );

    // Get backend language code mappings
    const sourceLangCode = this.backend.getLanguageCode(sourceLang);
    if (!sourceLangCode) {
      logger.warn(
        `[TRANSLATION-SERVICE] Unsupported source language code: ${sourceLang}`,
      );
      throw new Error(`Unsupported source language: ${sourceLang}`);
    }

    // Check if target language is supported
    if (!this.backend.isLanguageSupported(targetLang)) {
      // Check for fallback language
      const fallbackLang = this.backend.getFallbackLanguage(targetLang);
      if (fallbackLang) {
        logger.warn(
          `[TRANSLATION-SERVICE] Target language ${targetLang} not directly supported, using fallback ${fallbackLang}`,
        );
        // Recursively call translate with fallback language
        return this.translate(texts, sourceLang, fallbackLang);
      }
      logger.warn(
        `[TRANSLATION-SERVICE] Unsupported target language code: ${targetLang}`,
      );
      throw new Error(`Unsupported target language: ${targetLang}`);
    }

    const targetLangCode = this.backend.getLanguageCode(targetLang);

    try {
      // Delegate to backend
      const translatedTexts = await this.backend.translate(
        texts,
        sourceLangCode,
        targetLangCode,
      );
      return translatedTexts;
    } catch (error) {
      // If backend is GPU and in auto mode, try falling back to CPU for this request only
      if (this.backendType === "gpu" && translationBackend === "auto") {
        logger.warn(
          `[TRANSLATION-SERVICE] GPU backend failed for this request, falling back to CPU: ${error.message}`,
        );
        try {
          const cpuBackend = new CpuTranslateBackend();
          await cpuBackend.init();
          logger.info(
            "[TRANSLATION-SERVICE] CPU backend initialized as fallback",
          );

          const sourceCode = cpuBackend.getLanguageCode(sourceLang);
          const targetCode = cpuBackend.getLanguageCode(targetLang);
          return await cpuBackend.translate(texts, sourceCode, targetCode);
        } catch (cpuError) {
          logger.error(
            `[TRANSLATION-SERVICE] CPU fallback also failed: ${cpuError.message}`,
          );
          throw new Error(`Translation failed on both GPU and CPU backends`, {
            cause: cpuError,
          });
        }
      }

      logger.error(
        `[TRANSLATION-SERVICE] Translation failed: ${error.message}`,
        {
          stack: error.stack,
          sourceLang: sourceLang,
          targetLang: targetLang,
          backend: this.backendType,
        },
      );
      throw error;
    }
  }

  /**
   * @method translateMarkdown
   * @description Translates the content of a markdown file while preserving the markdown structure.
   * Caches the result to Redis permanently if caching is enabled.
   * @param {string} markdownContent - The markdown content as a string.
   * @param {string} sourceLang - The source language code (e.g., 'en').
   * @param {string} targetLang - The target language code (e.g., 'fr').
   * @returns {Promise<string>} The translated markdown content as a string.
   */
  async translateMarkdown(markdownContent, sourceLang, targetLang) {
    if (!this.initialized) {
      logger.error(
        "TranslationService not initialized. Cannot perform markdown translation.",
      );
      throw new Error("TranslationService is not ready.");
    }

    // --- REDIS CACHE LOGIC (GET) ---
    // Generate a unique <name> by hashing the markdown content.
    const docName = nodeCrypto
      .createHash("md5")
      .update(markdownContent)
      .digest("hex");
    // Create the cache key in the format <prefix>:<name>:<locale>
    const cacheKey = `translation:${docName}:${targetLang}`;
    // Key for in-flight tracking (combines doc hash and target language)
    const inFlightKey = `${docName}:${targetLang}`;

    if (cacheEnabled && this.cacheClient) {
      try {
        const cachedResult = await this.cacheClient.get(cacheKey);
        if (cachedResult) {
          logger.info(
            `[TRANSLATION-CACHE] HIT: Returning from Redis key ${cacheKey}`,
          );
          return cachedResult;
        }
        logger.info(
          `[TRANSLATION-CACHE] MISS: No cache in Redis for key ${cacheKey}. Translating...`,
        );
      } catch (error) {
        logger.warn(
          `[TRANSLATION-CACHE] Redis GET error. Translating anyway. ${error.message}`,
        );
      }
    }
    // --- REDIS CACHE LOGIC (END) ---

    // --- IN-FLIGHT TRACKING: Check if translation is already in progress ---
    if (this.inFlightTranslations.has(inFlightKey)) {
      logger.info(
        `[TRANSLATION-SERVICE] In-flight translation HIT for ${inFlightKey}. Waiting for existing promise...`,
      );
      const existingPromise = this.inFlightTranslations.get(inFlightKey);
      return await existingPromise;
    }

    // --- IN-FLIGHT TRACKING: Create new translation promise ---
    logger.info(
      `[TRANSLATION-SERVICE] Starting markdown translation from ${sourceLang} to ${targetLang}`,
    );

    // Create the translation promise
    const translationPromise = (async () => {
      const startTime = Date.now();

      try {
        // Parse the markdown into an AST
        logger.debug("[TRANSLATION-SERVICE] Parsing markdown into AST...");
        const processor = this.unified().use(this.remarkParse);
        const tree = processor.parse(markdownContent);
        logger.debug("[TRANSLATION-SERVICE] Markdown parsed successfully");

        // Collect all text nodes
        const textNodes = [];
        this.visit(tree, "text", (node) => {
          textNodes.push(node);
        });

        const texts = textNodes.map((node) => node.value);
        logger.info(
          `[TRANSLATION-SERVICE] Extracted ${texts.length} text nodes for translation`,
        );

        if (texts.length === 0) {
          logger.warn(
            "[TRANSLATION-SERVICE] No text nodes found to translate. Returning original content.",
          );
          return markdownContent;
        }

        // --- Controlled Concurrency Logic ---
        const numBatches = numParallelBatches;
        const batchSize = Math.ceil(texts.length / numBatches);
        const batches = [];

        logger.info(
          `[TRANSLATION-SERVICE] Splitting ${texts.length} texts into ${numBatches} parallel batches of size ~${batchSize}`,
        );

        for (let i = 0; i < texts.length; i += batchSize) {
          batches.push(texts.slice(i, i + batchSize));
        }

        // Create an array of promises, one for each batch
        const translationPromises = batches.map((batch, index) => {
          logger.debug(
            `[TRANSLATION-SERVICE] Starting parallel batch ${index + 1}/${batches.length}`,
          );
          return this.translate(batch, sourceLang, targetLang);
        });

        // Run all batches concurrently
        logger.debug(
          "[TRANSLATION-SERVICE] Waiting for all batches to complete...",
        );
        const translatedBatches = await Promise.all(translationPromises);

        // Flatten the array of arrays back into a single array
        const translatedTexts = translatedBatches.flat();

        const duration = Date.now() - startTime;
        logger.info(
          `[TRANSLATION-SERVICE] All ${batches.length} batches completed in ${duration}ms. Received ${translatedTexts.length} total translations.`,
        );

        // Sanity check
        if (translatedTexts.length !== textNodes.length) {
          logger.error(
            `[TRANSLATION-SERVICE] Mismatch in text node count. Original: ${textNodes.length}, Translated: ${translatedTexts.length}. Aborting.`,
          );
          throw new Error("Translation failed due to text count mismatch.");
        }

        // Replace original texts with translated ones
        logger.debug(
          "[TRANSLATION-SERVICE] Replacing translated text in AST...",
        );
        textNodes.forEach((node, index) => {
          node.value = translatedTexts[index];
        });
        logger.debug("[TRANSLATION-SERVICE] Text replacement completed");

        // Stringify back to markdown
        logger.debug(
          "[TRANSLATION-SERVICE] Converting AST back to markdown...",
        );
        const translatedMarkdown = this.unified()
          .use(this.remarkStringify)
          .stringify(tree);
        logger.debug(
          "[TRANSLATION-SERVICE] Markdown stringification completed",
        );

        logger.info(
          "[TRANSLATION-SERVICE] Markdown translation completed successfully",
        );

        // --- REDIS CACHE LOGIC (SET) ---
        if (cacheEnabled && this.cacheClient) {
          try {
            // This command now sets the key permanently, with no expiration.
            await this.cacheClient.set(cacheKey, translatedMarkdown);
            logger.info(
              `[TRANSLATION-CACHE] SET: Stored translation PERMANENTLY in Redis key ${cacheKey}`,
            );
          } catch (error) {
            logger.error(
              `[TRANSLATION-CACHE] FAILED to write cache to Redis: ${error.message}`,
            );
          }
        }
        // --- REDIS CACHE LOGIC (END) ---

        return translatedMarkdown;
      } catch (error) {
        // Log the error with full details
        logger.error(
          `[TRANSLATION-SERVICE] Translation failed: ${error.message}`,
          {
            stack: error.stack,
            inFlightKey: inFlightKey,
            sourceLang: sourceLang,
            targetLang: targetLang,
            duration: Date.now() - startTime,
          },
        );
        throw error; // Re-throw to reject the promise
      } finally {
        // --- IN-FLIGHT TRACKING: Clean up after completion/failure ---
        this.inFlightTranslations.delete(inFlightKey);
        logger.info(
          `[TRANSLATION-SERVICE] Removed in-flight translation for ${inFlightKey}`,
        );
      }
    })();

    // Store promise in in-flight cache
    this.inFlightTranslations.set(inFlightKey, translationPromise);
    logger.info(
      `[TRANSLATION-SERVICE] Added in-flight translation for ${inFlightKey}`,
    );

    // Add timeout to prevent hanging (default 1 hour for large documents)
    const timeoutMs = 3600000; // 1 hour
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => {
        this.inFlightTranslations.delete(inFlightKey);
        reject(
          new Error(
            `[TRANSLATION-SERVICE] Translation timeout after ${timeoutMs}ms for ${inFlightKey}`,
          ),
        );
      }, timeoutMs),
    );

    // Return the promise with timeout
    return await Promise.race([translationPromise, timeoutPromise]);
  }

  /**
   * @method getSupportedLanguages
   * @description Get the list of supported languages for the current backend.
   * @returns {Object} Map of language codes to model-specific codes.
   */
  getSupportedLanguages() {
    if (!this.backend) {
      logger.warn(
        "[TRANSLATION-SERVICE] Backend not initialized, returning empty language map",
      );
      return {};
    }
    return this.backend.getSupportedLanguages();
  }

  /**
   * @method getBackendInfo
   * @description Get information about the current backend.
   * @returns {Object} Backend information.
   */
  getBackendInfo() {
    if (!this.backend) {
      return {
        type: "none",
        initialized: false,
      };
    }
    return this.backend.getBackendInfo();
  }
}

// Export singleton instance
module.exports = new TranslationService();
