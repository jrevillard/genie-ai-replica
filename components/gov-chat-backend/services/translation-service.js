const { logger } = require('../shared-lib');
const nodeCrypto = require('crypto'); // For generating cache key
const Redis = require('ioredis'); // For Redis cache

// Import backend modules
const CpuTranslateBackend = require('./translation/cpu-translate-backend');
const GpuTranslateBackend = require('./translation/gpu-translate-backend');
const { splitEdges } = require('./translation/text-edges');
const { normalizeInlineSpacing } = require('./translation/markdown-normalize');
const { translationCacheKey } = require('./translation/translation-cache-key');
const { UnsupportedLanguageError } = require('./translation/unsupported-language');
const { languageForLog } = require('./translation/language-log');
const { normalizeRequestedLanguage } = require('./translation/language-request');

// --- Read settings from environment variables ---
const DEFAULT_THREADS = 4;
const DEFAULT_BATCHES = 5;

const intraOpNumThreads = parseInt(process.env.TRANSLATION_THREADS, 10) || DEFAULT_THREADS;
const numParallelBatches = parseInt(process.env.TRANSLATION_BATCHES, 10) || DEFAULT_BATCHES;
const cacheEnabled = process.env.TRANSLATION_CACHE === 'on';
const translationBackend = process.env.TRANSLATION_BACKEND || 'auto';

// A GPU API is "configured" when the deployment named one. Two independent
// signals say so, and either is enough: a remote GPU node host, or an explicit
// translation endpoint (a deployment may route through a proxy that sets only
// the endpoint). Both reach this container — `GPU_NODE_HOST` is passed to
// chatqna, retriever and dataprep, and a deployment that sets `gpu_node_host`
// also gets `VLLM_TRANSLATION_ENDPOINT` rendered by Ansible's `env.j2`.
// The endpoint half of the test is `GpuTranslateBackend.endpointExplicit`,
// which compares against the in-cluster default rather than testing presence:
// compose passes that same default through, so "is the var set?" would answer
// yes on every deployment and make the rule unsatisfiable.
const gpuNodeHost = process.env.GPU_NODE_HOST || '';

// --- Get Redis cache settings from env ---
const redisHost = process.env.TRANSLATION_CACHE_HOST || 'localhost';
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

    logger.info('[TRANSLATION-SERVICE] Constructor called');
    logger.info(`[TRANSLATION-CONFIG] Backend: ${translationBackend}`);
    logger.info(`[TRANSLATION-CONFIG] Threads: ${intraOpNumThreads}, Batches: ${numParallelBatches}`);
    logger.info(`[TRANSLATION-CONFIG] Cache enabled: ${cacheEnabled}`);

    if (cacheEnabled) {
      logger.info(`[TRANSLATION-CONFIG] Cache connecting to Redis at ${redisHost}:${redisPort}`);

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
        enableOfflineQueue: false
      });

      this.cacheClient.on('error', (err) => {
        logger.error(`[TRANSLATION-CACHE] Redis client error: ${err.message}`);
      });
      this.cacheClient.on('connect', () => {
        logger.info('[TRANSLATION-CACHE] Connected to Redis successfully.');
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

    logger.info(`[TRANSLATION-SERVICE] Selecting backend: ${translationBackend}`);

    try {
      // Constructed up front: `endpointExplicit` is how a deployment says it
      // named a GPU API, and the instance is needed on every branch that
      // resolves to GPU anyway.
      const gpuBackend = new GpuTranslateBackend();
      const gpuApiConfigured = Boolean(gpuNodeHost) || gpuBackend.endpointExplicit;

      if (gpuApiConfigured) {
        // A configured GPU API is mandatory. No value of TRANSLATION_BACKEND
        // changes that — `cpu`, `gpu`, `auto` and unset all resolve here — so
        // the knob is not an input to this decision and none of its values
        // gets special treatment.
        //
        // A failure below propagates: the backend is not optional in
        // `index.js`, so the service refuses to start rather than translating
        // with a model the deployment did not ask for.
        await gpuBackend.init();
        this.backend = gpuBackend;
        this.backendType = 'gpu';
        logger.info(
          `[TRANSLATION-SERVICE] GPU API configured — GPU backend selected and initialized (TRANSLATION_BACKEND=${translationBackend})`
        );
        return this.backend;
      }

      // No GPU API configured: the CPU backend is a legitimate outcome here,
      // and TRANSLATION_BACKEND decides between the two.
      if (translationBackend === 'cpu') {
        const backend = new CpuTranslateBackend();
        await backend.init();
        this.backend = backend;
        this.backendType = 'cpu';
        logger.info('[TRANSLATION-SERVICE] CPU backend selected and initialized');
        return this.backend;
      }

      if (translationBackend === 'gpu') {
        await gpuBackend.init();
        this.backend = gpuBackend;
        this.backendType = 'gpu';
        logger.info('[TRANSLATION-SERVICE] GPU backend selected and initialized');
        return this.backend;
      }

      if (translationBackend === 'auto') {
        // One-shot choice between the two available backends, made once at
        // startup — the same pattern as the dataprep device resolution
        // (`_resolve_docling_device`). A backend that dies later is a failure
        // to report, not a reason to switch models for the rest of the
        // process's life.
        //
        // Each backend is assigned only after its init resolves. An instance
        // whose worker never started is not a backend, and `selectBackend`
        // short-circuits on `this.backend` — caching one that failed to
        // initialise would hand it to every later request for the life of the
        // process, with the service reporting itself ready.
        try {
          logger.info('[TRANSLATION-SERVICE] Auto mode: Probing GPU backend');
          await gpuBackend.init();
          this.backend = gpuBackend;
          this.backendType = 'gpu';
          logger.info('[TRANSLATION-SERVICE] Auto mode: GPU backend selected');
          return this.backend;
        } catch (gpuError) {
          logger.warn(`[TRANSLATION-SERVICE] Auto mode: GPU unavailable (${gpuError.message}), selecting CPU`);
          const cpuBackend = new CpuTranslateBackend();
          await cpuBackend.init();
          this.backend = cpuBackend;
          this.backendType = 'cpu';
          logger.info('[TRANSLATION-SERVICE] Auto mode: CPU backend selected');
          return this.backend;
        }
      }

      throw new Error(`Invalid TRANSLATION_BACKEND value: ${translationBackend}. Must be 'cpu', 'gpu', or 'auto'`);
    } catch (error) {
      logger.error(`[TRANSLATION-SERVICE] Backend selection failed: ${error.message}`);
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
      logger.debug('[TRANSLATION-SERVICE] Already initialized, skipping');
      return;
    }

    try {
      logger.info('[TRANSLATION-SERVICE] Starting initialization: Selecting backend...');

      // Select and initialize backend
      await this.selectBackend();

      // Load markdown processing libraries
      const { unified } = await import('unified');
      this.unified = unified;
      logger.debug('[TRANSLATION-SERVICE] Loaded unified');

      const remarkParseModule = await import('remark-parse');
      this.remarkParse = remarkParseModule.default;
      logger.debug('[TRANSLATION-SERVICE] Loaded remark-parse');

      const remarkStringifyModule = await import('remark-stringify');
      this.remarkStringify = remarkStringifyModule.default;
      logger.debug('[TRANSLATION-SERVICE] Loaded remark-stringify');

      const { visit } = await import('unist-util-visit');
      this.visit = visit;
      logger.debug('[TRANSLATION-SERVICE] Loaded unist-util-visit');

      this.initialized = true;
      logger.info('[TRANSLATION-SERVICE] Initialized successfully. Backend is ready.');
    } catch (error) {
      logger.error(`[TRANSLATION-SERVICE] Initialization failed: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * @method ensureReady
   * @description The service needs an initialized backend before it can
   * resolve or translate anything: without one there is no language map to
   * check a language against.
   * @throws {Error} When the service has no backend yet.
   */
  ensureReady() {
    if (!this.initialized || !this.backend) {
      logger.error('[TRANSLATION-SERVICE] Not initialized. Cannot perform translation.');
      throw new Error('[TRANSLATION-SERVICE] Service is not ready.');
    }
  }

  /**
   * @method _resolveTarget
   * @description Resolves a target language and the code the model expects for
   * it, in one pass. The canonical code and the model-specific code are
   * produced together: resolving them separately meant the map was consulted
   * twice for the same language, and the second lookup could only fail in a
   * way the caller could not act on.
   *
   * A language the map does not map is refused. There is no chain of
   * fallbacks: a request for one language answered in another is a wrong
   * answer, and the caller has no way to see it.
   * @param {string} targetLang - The target language as it arrived from the caller.
   * @returns {{targetLang: string, targetLangCode: string}} The canonical
   *   language and the code the model expects.
   * @throws {UnsupportedLanguageError} When the language is unknown.
   */
  _resolveTarget(targetLang) {
    this.ensureReady();
    const requested = normalizeRequestedLanguage(targetLang);
    if (!requested) {
      logger.warn('[TRANSLATION-SERVICE] Unsupported target language: empty value');
      throw new UnsupportedLanguageError('target');
    }

    // One lookup answers both questions: the code the model is asked for,
    // and whether the map knows the language at all. A language the map
    // does not know is refused — there is no chain of fallbacks: a request
    // for one language answered in another is a wrong answer the caller
    // cannot see.
    const targetLangCode = this.modelLanguageCode(requested);
    if (!targetLangCode) {
      logger.warn(`[TRANSLATION-SERVICE] Unsupported target language: ${languageForLog(requested)}`);
      throw new UnsupportedLanguageError('target');
    }
    return { targetLang: requested, targetLangCode };
  }

  /**
   * @method _resolveSource
   * @description Resolves a source language and the code the model expects for
   * it, in one pass — the counterpart of `_resolveTarget`.
   * @param {string} sourceLang - The source language as it arrived from the caller.
   * @returns {{sourceLang: string, sourceLangCode: string}} The canonical
   *   language and the code the model expects.
   * @throws {UnsupportedLanguageError} When the language is unknown.
   */
  _resolveSource(sourceLang) {
    this.ensureReady();
    const requested = normalizeRequestedLanguage(sourceLang);
    if (!requested) {
      logger.warn('[TRANSLATION-SERVICE] Unsupported source language: empty value');
      throw new UnsupportedLanguageError('source');
    }
    // The source is checked against the same map the target is: a language the
    // map does not know is refused, and an inherited property is not a
    // language. The source has no fallback chain — degrading the language a
    // text is written in would translate the wrong text.
    const sourceLangCode = this.modelLanguageCode(requested);
    if (!sourceLangCode) {
      logger.warn(`[TRANSLATION-SERVICE] Unsupported source language: ${languageForLog(requested)}`);
      throw new UnsupportedLanguageError('source');
    }
    return { sourceLang: requested, sourceLangCode };
  }

  /**
   * @method modelLanguageCode
   * @description Maps a canonical language code onto the code the loaded
   * backend's model expects ("fr" -> "fr_FR" for NLLB).
   * @param {string} code - A canonical language code.
   * @returns {string|null} The model-specific code, or null when the backend
   *   does not map the language.
   */
  modelLanguageCode(code) {
    return this.backend.getLanguageCode(code) || null;
  }

  /**
   * @method resolveLanguagePair
   * @description Resolves both languages of a request and returns the codes the
   * model expects. Both languages travel in the request body, so both are
   * resolved — and refused — before anything is built from them.
   * @param {string} sourceLang - The source language as it arrived from the caller.
   * @param {string} targetLang - The target language as it arrived from the caller.
   * @returns {{sourceLang: string, targetLang: string, sourceLangCode: string, targetLangCode: string}}
   *   The canonical languages and the model-specific codes.
   * @throws {UnsupportedLanguageError} When either language is unknown.
   */
  resolveLanguagePair(sourceLang, targetLang) {
    const { sourceLang: resolvedSourceLang, sourceLangCode } = this._resolveSource(sourceLang);
    const { targetLang: resolvedTargetLang, targetLangCode } = this._resolveTarget(targetLang);
    return {
      sourceLang: resolvedSourceLang,
      targetLang: resolvedTargetLang,
      sourceLangCode,
      targetLangCode
    };
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
    this.ensureReady();

    // Both languages are resolved against the map the backend ships: a
    // language the map does not know never reaches the model. The check comes
    // before the empty-texts shortcut, so a request for an unknown language
    // is refused whether or not it had anything to translate.
    const {
      sourceLang: resolvedSourceLang,
      targetLang: resolvedTargetLang,
      sourceLangCode,
      targetLangCode
    } = this.resolveLanguagePair(sourceLang, targetLang);

    if (!texts || texts.length === 0) {
      logger.warn('[TRANSLATION-SERVICE] translate method called with empty array.');
      return [];
    }

    // The log names the resolved languages, not the ones the request carried:
    // "FR" and "fr" are the same language, and a log query written against
    // the resolved form finds this line.
    logger.info(
      `[TRANSLATION-SERVICE] Translating ${texts.length} texts from ${languageForLog(resolvedSourceLang)} to ${languageForLog(resolvedTargetLang)}`
    );

    return this._translateWithBackend(texts, sourceLangCode, targetLangCode, resolvedSourceLang, resolvedTargetLang);
  }

  /**
   * @method _translateWithBackend
   * @description Hands already-resolved language codes to the backend. The
   * resolution happens once per request: the markdown path splits a document
   * into batches, and resolving the same language again for every batch
   * repeats the same work (and would repeat any future side effect of it).
   *
   * Private on purpose: the codes it takes are model codes, and only the
   * resolution (resolveLanguagePair) may produce them. A caller that hands
   * this method a language of its own would put a code nobody vetted into
   * the model request.
   *
   * @param {string[]} texts - The texts to translate.
   * @param {string} sourceLangCode - The model-specific source language code.
   * @param {string} targetLangCode - The model-specific target language code.
   * @param {string} [sourceLang] - The canonical source language, as the log
   *   lines name it. Defaults to the model-specific code.
   * @param {string} [targetLang] - The canonical target language, as the log
   *   lines name it. Defaults to the model-specific code.
   * @returns {Promise<string[]>} The translated texts.
   */
  async _translateWithBackend(
    texts,
    sourceLangCode,
    targetLangCode,
    sourceLang = sourceLangCode,
    targetLang = targetLangCode
  ) {
    // The codes are the ones the loaded backend's own map produces. This
    // asserts it at the last step before the model: a code the backend does
    // not know is not a language it can be asked for, and the model would
    // receive it as if it were one.
    this._assertModelLanguageCodes(sourceLangCode, targetLangCode);

    try {
      // Delegate to backend
      const translatedTexts = await this.backend.translate(texts, sourceLangCode, targetLangCode);
      return translatedTexts;
    } catch (error) {
      // The backend chosen at startup is the backend we use. `auto` decides
      // between GPU and CPU once, in selectBackend; a request that fails later
      // is a failure, not a reason to switch models mid-answer — that would
      // serve a different, lower-quality translation of the same content with
      // nothing in the output to say so.
      //
      // The languages are named the way the other log lines name them — the
      // canonical codes — so a query over the canonical form finds the
      // failure too.
      logger.error(`[TRANSLATION-SERVICE] Translation failed: ${error.message}`, {
        stack: error.stack,
        sourceLang: languageForLog(sourceLang),
        targetLang: languageForLog(targetLang),
        backend: this.backendType
      });
      throw error;
    }
  }

  /**
   * @method _assertModelLanguageCodes
   * @description Refuses a language code the loaded backend does not know.
   *
   * The check is on the backend's own table, so the answer comes from the
   * model that would be asked, not from a second list that could drift away
   * from it. A backend that cannot answer (no such method) is not checked:
   * the guard is there to catch a code that slipped through, not to replace
   * the resolution.
   * @param {string} sourceLangCode - The model-specific source language code.
   * @param {string} targetLangCode - The model-specific target language code.
   * @throws {Error} When either code is not one the loaded backend knows.
   */
  _assertModelLanguageCodes(sourceLangCode, targetLangCode) {
    if (typeof this.backend?.isModelLanguageCode !== 'function') {
      return;
    }
    const sides = [
      ['source', sourceLangCode],
      ['target', targetLangCode]
    ];
    for (const [side, code] of sides) {
      if (!this.backend.isModelLanguageCode(code)) {
        // The log carries a bounded, printable form of the code — the same
        // rule the other language log lines follow. The thrown error names
        // the side only: nothing a caller wrote is echoed back.
        logger.error(
          `[TRANSLATION-SERVICE] The ${side} language code (${languageForLog(code)}) is not one the loaded backend knows.`
        );
        throw new Error(`[TRANSLATION-SERVICE] The ${side} language code is not one the loaded backend knows.`);
      }
    }
  }

  /**
   * @method translateStream
   * @description Stream-translate a single COMPLETE unit (sentence/paragraph) from
   * sourceLang to targetLang, invoking onToken for each output delta. Used by the
   * chat streaming handler to show the target language WHILE streaming (issue #829)
   * instead of flipping at the end. The caller buffers source chunks into complete
   * units first (see services/translation/stream-boundary.js) — the translator must
   * receive a complete unit.
   * @param {string} unit - A complete source-language unit to translate
   * @param {string} sourceLang - Source language code (e.g. 'en')
   * @param {string} targetLang - Target language code (e.g. 'es')
   * @param {{source: string, target: string}[]} [context] - Prior units EN+target for consistency
   * @param {(delta: string) => void} [onToken] - Streaming callback
   * @returns {Promise<string>} Full translated unit
   */
  async translateStream(unit, sourceLang, targetLang, context, onToken) {
    this.ensureReady();

    // Both languages are resolved the same way as in translate(), and before
    // the empty-unit shortcut: the frontend may send upper-case locale codes
    // ("ES") while the language maps use lower-case keys ("es"), and a
    // language the map does not know is refused. Resolving after the shortcut
    // would let a request for an unknown language through unnoticed — the
    // streaming path would answer in English while the post-stream path
    // refused the same request.
    const { sourceLangCode, targetLangCode } = this.resolveLanguagePair(sourceLang, targetLang);

    // The streaming path reaches the model through the backend too: the
    // codes are checked the same way before they go there.
    this._assertModelLanguageCodes(sourceLangCode, targetLangCode);

    if (!unit || unit.trim() === '') return '';

    try {
      if (typeof this.backend.translateStream === 'function') {
        return await this.backend.translateStream(unit, sourceLangCode, targetLangCode, context, onToken);
      }
      // Backend has no streaming support (e.g. CPU) — translate the unit in one
      // shot and emit it as a single delta so the caller keeps streaming.
      const [translated] = await this.backend.translate([unit], sourceLangCode, targetLangCode);
      if (translated && onToken) onToken(translated);
      return translated || '';
    } catch (error) {
      // Same contract as translate(): the startup-selected backend is the one
      // used. Switching models mid-stream would emit a second translation into
      // a caller that has already rendered the first.
      logger.warn(`[TRANSLATION-SERVICE] Stream translation failed: ${error.message}`);
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
    this.ensureReady();

    // Both languages are refused before anything is built from them: the
    // cache key and the in-flight key carry them, so an unchecked value would
    // end up in a Redis key as well as in the translation request.
    const {
      sourceLang: resolvedSourceLang,
      targetLang: resolvedTargetLang,
      sourceLangCode,
      targetLangCode
    } = this.resolveLanguagePair(sourceLang, targetLang);

    // --- REDIS CACHE LOGIC (GET) ---
    // Generate a unique <name> by hashing the markdown content.
    const docName = nodeCrypto.createHash('md5').update(markdownContent).digest('hex');
    // Cache key includes the model id so switching the translation model
    // invalidates the cache automatically (no stale translations on model change).
    const modelId = this.backend && this.backend.getBackendInfo ? this.backend.getBackendInfo().model : undefined;
    // The key carries the codes the MODEL was asked for, not the canonical
    // ones: two languages the model answers with the same code are the same
    // request, and they belong in the same entry.
    const cacheKey = translationCacheKey(docName, sourceLangCode, targetLangCode, modelId);
    // Key for in-flight tracking (combines doc hash and both model codes)
    const inFlightKey = `${docName}:${sourceLangCode}:${targetLangCode}`;

    if (cacheEnabled && this.cacheClient) {
      try {
        const cachedResult = await this.cacheClient.get(cacheKey);
        if (cachedResult) {
          logger.info(`[TRANSLATION-CACHE] HIT: Returning from Redis key ${cacheKey}`);
          return cachedResult;
        }
        logger.info(`[TRANSLATION-CACHE] MISS: No cache in Redis for key ${cacheKey}. Translating...`);
      } catch (error) {
        logger.warn(`[TRANSLATION-CACHE] Redis GET error. Translating anyway. ${error.message}`);
      }
    }
    // --- REDIS CACHE LOGIC (END) ---

    // --- IN-FLIGHT TRACKING: Check if translation is already in progress ---
    if (this.inFlightTranslations.has(inFlightKey)) {
      logger.info(
        `[TRANSLATION-SERVICE] In-flight translation HIT for ${inFlightKey}. Waiting for existing promise...`
      );
      const existingPromise = this.inFlightTranslations.get(inFlightKey);
      return await existingPromise;
    }

    // --- IN-FLIGHT TRACKING: Create new translation promise ---
    logger.info(
      `[TRANSLATION-SERVICE] Starting markdown translation from ${languageForLog(resolvedSourceLang)} to ${languageForLog(resolvedTargetLang)}`
    );

    // Create the translation promise
    const translationPromise = (async () => {
      const startTime = Date.now();

      try {
        // Parse the markdown into an AST
        logger.debug('[TRANSLATION-SERVICE] Parsing markdown into AST...');
        const processor = this.unified().use(this.remarkParse);
        const tree = processor.parse(markdownContent);
        logger.debug('[TRANSLATION-SERVICE] Markdown parsed successfully');

        // Normalize: ensure a space between inline strong/emphasis and an
        // immediately following word (chatqna sometimes emits run-in
        // "**Heading**Text"). Gated to word-spaced scripts — see
        // markdown-normalize.js + text-edges.js.
        normalizeInlineSpacing(tree);

        // Collect all text nodes
        const textNodes = [];
        this.visit(tree, 'text', (node) => {
          textNodes.push(node);
        });

        // Split each text node into structural edges (lead/trail: whitespace +
        // punctuation) and a word-bounded core. Translate ONLY the cores so the
        // model never sees/drops edge chars like the ": " after **bold** — then
        // re-apply the original edges verbatim. Keeps "Heading: text" intact.
        const edges = textNodes.map((node) => splitEdges(node.value));
        const texts = edges.map((e) => e.core);
        logger.info(`[TRANSLATION-SERVICE] Extracted ${texts.length} text nodes for translation`);

        if (texts.length === 0) {
          logger.warn('[TRANSLATION-SERVICE] No text nodes found to translate. Returning original content.');
          return markdownContent;
        }

        // --- Controlled Concurrency Logic ---
        const numBatches = numParallelBatches;
        const batchSize = Math.ceil(texts.length / numBatches);
        const batches = [];

        logger.info(
          `[TRANSLATION-SERVICE] Splitting ${texts.length} texts into ${numBatches} parallel batches of size ~${batchSize}`
        );

        for (let i = 0; i < texts.length; i += batchSize) {
          batches.push(texts.slice(i, i + batchSize));
        }

        // Create an array of promises, one for each batch
        const translationPromises = batches.map((batch, index) => {
          logger.debug(`[TRANSLATION-SERVICE] Starting parallel batch ${index + 1}/${batches.length}`);
          // The languages were resolved once, before the cache lookup: the
          // batches go straight to the backend with the codes already checked.
          // The canonical codes travel along so a failure names the same
          // languages as the rest of the log lines.
          return this._translateWithBackend(
            batch,
            sourceLangCode,
            targetLangCode,
            resolvedSourceLang,
            resolvedTargetLang
          );
        });

        // Run all batches concurrently
        logger.debug('[TRANSLATION-SERVICE] Waiting for all batches to complete...');
        const translatedBatches = await Promise.all(translationPromises);

        // Flatten the array of arrays back into a single array
        const translatedTexts = translatedBatches.flat();

        const duration = Date.now() - startTime;
        logger.info(
          `[TRANSLATION-SERVICE] All ${batches.length} batches completed in ${duration}ms. Received ${translatedTexts.length} total translations.`
        );

        // Sanity check
        if (translatedTexts.length !== textNodes.length) {
          logger.error(
            `[TRANSLATION-SERVICE] Mismatch in text node count. Original: ${textNodes.length}, Translated: ${translatedTexts.length}. Aborting.`
          );
          throw new Error('Translation failed due to text count mismatch.');
        }

        // Replace each node's core with its translation and re-apply the
        // original structural edges (lead/trail) verbatim.
        logger.debug('[TRANSLATION-SERVICE] Replacing translated text in AST...');
        textNodes.forEach((node, index) => {
          const e = edges[index];
          node.value = e.lead + (translatedTexts[index] || '') + e.trail;
        });
        logger.debug('[TRANSLATION-SERVICE] Text replacement completed');

        // Stringify back to markdown
        logger.debug('[TRANSLATION-SERVICE] Converting AST back to markdown...');
        const translatedMarkdown = this.unified().use(this.remarkStringify).stringify(tree);
        logger.debug('[TRANSLATION-SERVICE] Markdown stringification completed');

        logger.info('[TRANSLATION-SERVICE] Markdown translation completed successfully');

        // --- REDIS CACHE LOGIC (SET) ---
        if (cacheEnabled && this.cacheClient) {
          try {
            // This command now sets the key permanently, with no expiration.
            await this.cacheClient.set(cacheKey, translatedMarkdown);
            logger.info(`[TRANSLATION-CACHE] SET: Stored translation PERMANENTLY in Redis key ${cacheKey}`);
          } catch (error) {
            logger.error(`[TRANSLATION-CACHE] FAILED to write cache to Redis: ${error.message}`);
          }
        }
        // --- REDIS CACHE LOGIC (END) ---

        return translatedMarkdown;
      } catch (error) {
        // Log the error with full details
        logger.error(`[TRANSLATION-SERVICE] Translation failed: ${error.message}`, {
          stack: error.stack,
          inFlightKey: inFlightKey,
          sourceLang: languageForLog(resolvedSourceLang),
          targetLang: languageForLog(resolvedTargetLang),
          duration: Date.now() - startTime
        });
        throw error; // Re-throw to reject the promise
      }
    })();

    // Store promise in in-flight cache
    this.inFlightTranslations.set(inFlightKey, translationPromise);
    logger.info(`[TRANSLATION-SERVICE] Added in-flight translation for ${inFlightKey}`);

    // --- IN-FLIGHT TRACKING: Clean up after completion/failure ---
    // Only the promise that registered this key may remove it: the timeout
    // path deletes the entry too, and a later request for the same document
    // may already have registered a new promise under the same key. An
    // unconditional delete would evict that new promise and let a third
    // request start a duplicate translation.
    //
    // The cleanup hangs off the promise itself rather than off the body of
    // the translation: the body runs before the promise is registered, so a
    // finally block there could fire before the entry exists.
    translationPromise
      .catch(() => {}) // the rejection is reported by the caller; this chain only cleans up
      .then(() => {
        if (this.inFlightTranslations.get(inFlightKey) === translationPromise) {
          this.inFlightTranslations.delete(inFlightKey);
          logger.info(`[TRANSLATION-SERVICE] Removed in-flight translation for ${inFlightKey}`);
        }
      });

    // Add timeout to prevent hanging (default 1 hour for large documents)
    const timeoutMs = 3600000; // 1 hour
    let timeoutHandle;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => {
        if (this.inFlightTranslations.get(inFlightKey) === translationPromise) {
          this.inFlightTranslations.delete(inFlightKey);
        }
        reject(new Error(`[TRANSLATION-SERVICE] Translation timeout after ${timeoutMs}ms for ${inFlightKey}`));
      }, timeoutMs);
    });

    // Return the promise with timeout. The timer is cleared once the race is
    // settled: left pending, every translation would keep an hour-long timer
    // alive, and the process could not exit while one was outstanding.
    try {
      return await Promise.race([translationPromise, timeoutPromise]);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  /**
   * @method getSupportedLanguages
   * @description Get the list of supported languages for the current backend.
   * @returns {Object} Map of language codes to model-specific codes.
   */
  getSupportedLanguages() {
    if (!this.backend) {
      logger.warn('[TRANSLATION-SERVICE] Backend not initialized, returning empty language map');
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
        type: 'none',
        initialized: false
      };
    }
    return this.backend.getBackendInfo();
  }
}

// Export singleton instance
module.exports = new TranslationService();
