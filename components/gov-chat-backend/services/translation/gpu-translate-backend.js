const { logger, parsePositiveInt } = require('../../shared-lib');
const http = require('http');
const https = require('https');
const { languageForLog } = require('./language-log');
const { ownLanguageCode, hasOwnLanguage, supportedLanguages } = require('./language-map-lookup');

// API key for remote GPU node authentication (standard OpenAI Bearer token)
const VLLM_API_KEY = process.env.VLLM_API_KEY || '';

// Smallest output budget worth asking for. Below this a reply cannot hold a
// sentence, and a caller that gets one has no way to tell it apart from a real
// translation — so a prompt that cannot leave this much room is refused rather
// than sent with a token or two.
const MIN_OUTPUT_BUDGET = 256;

// Budget for the startup health check. Failing it stops the service when a GPU
// API is configured, so the budget is sized for a cold TLS handshake to a remote
// node rather than for a connection that is already established.
const DEFAULT_HEALTH_TIMEOUT_MS = 30000;

// Per-request budget for a chat completion. The deployed 30s timeout: the
// legacy call sites pass no options, so they keep exactly this value. The
// agentic leg (story 2.10) overrides it per call with the remaining
// end-to-end deadline.
const DEFAULT_CALL_TIMEOUT_MS = 30000;

// Budget for the /v1/models read. It only widens the output budget ceiling, so
// a miss degrades to the conservative default rather than failing the service.
const DEFAULT_MODEL_INFO_TIMEOUT_MS = 5000;

// The worker that ships with the stack. Naming it is not a statement that a GPU
// API was configured — compose passes this very value through when the
// deployment set nothing, so presence of the env var cannot distinguish the two.
const IN_CLUSTER_ENDPOINT = 'http://vllm-translation-guardrail:9031';

/**
 * GPU Translation Backend
 *
 * Uses vLLM translation guardrail service for GPU-based translation.
 * Always reads model configuration from .env file.
 * Supports multiple models (TranslateGemma, Gemma-3, etc.)
 */

class GpuTranslateBackend {
  constructor() {
    // Configuration from environment variables
    this.modelId = process.env.VLLM_TRANSLATION_MODEL_ID || 'google/gemma-3-4b-it';
    this.endpoint = process.env.VLLM_TRANSLATION_ENDPOINT || IN_CLUSTER_ENDPOINT;
    this.port = parseInt(process.env.VLLM_TRANSLATION_SERVICE_PORT, 10) || 9031;

    // Whether the deployment named an endpoint of its own, as opposed to
    // leaving the in-cluster worker as the target. `this.endpoint` is always
    // non-empty, so on its own it cannot answer "is a GPU API configured?".
    this.endpointExplicit = this.endpoint !== IN_CLUSTER_ENDPOINT;

    // `parsePositiveInt`, not `parseInt(x, 10) * 1000 || DEFAULT`: a negative
    // budget parses to a negative number, which is truthy and therefore survives
    // the fallback — and Node's HTTP layer does not honour a negative `timeout`
    // predictably, so the gate would fall back to OS defaults instead of
    // expiring. Values below one second are treated the same way: they cannot be
    // a real remote handshake.
    this.healthTimeoutMs =
      parsePositiveInt(process.env.TRANSLATION_PROBE_TIMEOUT_SECONDS, DEFAULT_HEALTH_TIMEOUT_MS / 1000, { min: 1 }) *
      1000;
    this.modelInfoTimeoutMs = DEFAULT_MODEL_INFO_TIMEOUT_MS;

    // Runtime state
    this.initialized = false;
    this.languageMap = null;
    this.healthCheckPassed = false;
    this.maxModelLen = 4096; // Will be updated from /v1/models during init

    logger.info(`[GPU-BACKEND] Initializing with model: ${this.modelId}`);
    logger.info(`[GPU-BACKEND] Endpoint: ${this.endpoint}`);

    // Load language map
    this.loadLanguageMap(this.modelId);
  }

  /**
   * Load language map based on model ID
   * @param {string} modelId - Model identifier from .env
   */
  loadLanguageMap(modelId) {
    try {
      // Map model IDs to language map files
      const modelToMap = {
        'google/translategemma-4b-it': './language-maps/translategemma-map.js',
        'google/gemma-3-4b-it': './language-maps/gemma-3-map.js',
        'google/gemma-3-1b-it': './language-maps/gemma-3-map.js'
      };

      const mapPath = modelToMap[modelId];

      if (!mapPath) {
        logger.warn(`[GPU-BACKEND] No language map found for model: ${modelId}`);
        throw new Error(`No language map found for model: ${modelId}. Add a language map file to ./language-maps/`);
      }

      this.languageMap = require(mapPath);

      logger.info(`[GPU-BACKEND] Loaded language map: ${this.languageMap.modelName}`);
      logger.info(`[GPU-BACKEND] Code format: ${this.languageMap.codeFormat}`);
    } catch (error) {
      logger.error(`[GPU-BACKEND] Failed to load language map: ${error.message}`);
      throw new Error(`Failed to load language map for model ${modelId}`, { cause: error });
    }
  }

  /**
   * Initialize backend (health check)
   */
  async init() {
    if (this.initialized) {
      logger.debug('[GPU-BACKEND] Already initialized, skipping');
      return;
    }

    try {
      logger.info('[GPU-BACKEND] Starting initialization: Performing health check...');

      // Perform health check and fetch model info
      await this.healthCheck();
      await this.fetchModelInfo();

      this.initialized = true;
      this.healthCheckPassed = true;
      logger.info('[GPU-BACKEND] Initialized successfully. vLLM service is ready.');
    } catch (error) {
      logger.error(`[GPU-BACKEND] Initialization failed: ${error.message}`);
      // Rethrow: this is the startup probe `auto` runs to choose a backend,
      // and its failure is what selects the CPU model. Swallowing it would
      // leave `auto` with a GPU backend that never answered.
      this.healthCheckPassed = false;
      throw error;
    }
  }

  /**
   * Health check for vLLM service
   */
  /**
   * Build base headers for vLLM requests (injects Authorization: Bearer when VLLM_API_KEY is set).
   * @returns {Object} Headers object
   */
  _buildHeaders(extraHeaders = {}) {
    const headers = { ...extraHeaders };
    if (VLLM_API_KEY) {
      headers['Authorization'] = `Bearer ${VLLM_API_KEY}`;
    }
    return headers;
  }

  async healthCheck() {
    try {
      const url = new URL(this.endpoint);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;
      const basePath = url.pathname.replace(/\/$/, '');

      return new Promise((resolve, reject) => {
        const options = {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: `${basePath}/health`,
          method: 'GET',
          headers: this._buildHeaders(),
          timeout: this.healthTimeoutMs
        };

        const req = client.request(options, (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            logger.info(`[GPU-BACKEND] Health check passed (status ${res.statusCode})`);
            resolve(true);
          } else {
            logger.warn(`[GPU-BACKEND] Health check returned status ${res.statusCode}`);
            // A non-2xx fails the gate: the endpoint is not serving a usable
            // translation service (vLLM answers 503 while still loading).
            // Resolving here would let `init` mark an unready service as
            // initialized. The refusal consumes nothing else — drain the
            // response so the keep-alive socket is not parked on a paused
            // stream.
            res.resume();
            reject(new Error(`vLLM service unhealthy: status ${res.statusCode}`));
          }
        });

        req.on('error', (error) => {
          logger.error(`[GPU-BACKEND] Health check failed: ${error.message}`);
          reject(new Error(`vLLM service unreachable: ${error.message}`));
        });

        req.on('timeout', () => {
          req.destroy();
          reject(new Error('vLLM service health check timeout'));
        });

        req.end();
      });
    } catch (error) {
      logger.error(`[GPU-BACKEND] Health check error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch model info (max_model_len) from vLLM /v1/models endpoint
   */
  async fetchModelInfo() {
    try {
      const url = new URL(this.endpoint);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;
      const basePath = url.pathname.replace(/\/$/, '');

      await new Promise((resolve) => {
        const options = {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: `${basePath}/v1/models`,
          method: 'GET',
          headers: this._buildHeaders(),
          // Deliberately short, unlike `healthCheck`: this call only reads
          // `max_model_len` and resolves with a default on failure, so it
          // decides nothing about whether the service may start.
          timeout: this.modelInfoTimeoutMs
        };

        const req = client.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              const model = parsed.data?.find((m) => m.id === this.modelId);
              if (model?.max_model_len) {
                this.maxModelLen = model.max_model_len;
                logger.info(`[GPU-BACKEND] Model max context length: ${this.maxModelLen} tokens`);
              } else {
                logger.warn(
                  `[GPU-BACKEND] Model ${this.modelId} not found in /v1/models response, using default max_tokens`
                );
              }
              resolve();
            } catch (e) {
              logger.warn(`[GPU-BACKEND] Failed to parse /v1/models response: ${e.message}`);
              resolve();
            }
          });
        });

        req.on('error', (error) => {
          logger.warn(`[GPU-BACKEND] Failed to fetch model info: ${error.message}`);
          resolve(); // Don't fail init — use default max_tokens
        });
        req.on('timeout', () => {
          req.destroy();
          resolve();
        });
        req.end();
      });
    } catch (error) {
      logger.warn(`[GPU-BACKEND] fetchModelInfo error: ${error.message}`);
    }
  }

  /**
   * Get model-specific language code
   * @param {string} isoCode - ISO 639-1 language code
   * @returns {string} Model-specific language code
   */
  getLanguageCode(isoCode) {
    if (!this.languageMap) {
      throw new Error('[GPU-BACKEND] Language map not loaded');
    }

    const code = ownLanguageCode(this.languageMap, isoCode);
    if (!code) {
      if (hasOwnLanguage(this.languageMap, isoCode)) {
        // The map carries the language and maps it to an empty code: the
        // shipped map is broken. That is our defect, not the caller's
        // request, and the caller must not be answered as if their language
        // were unknown.
        throw new Error(
          `[GPU-BACKEND] The shipped language map maps "${isoCode}" to an empty code (server-side defect, not a bad request)`
        );
      }
      logger.warn(`[GPU-BACKEND] No language code mapping for: ${languageForLog(isoCode)}`);
      return null;
    }
    return code;
  }

  /**
   * Get all supported languages
   * @returns {Object} A copy of the language map
   */
  getSupportedLanguages() {
    return supportedLanguages(this.languageMap);
  }

  /**
   * The chars/4 token estimate — the deployed constant, one home for the
   * estimator: the window math below and the usage estimate
   * (`_estimateUsage`) both call it. Optimistic for CJK (~1 token/char
   * against ~4 here); the window math's `needed` bound is sized to survive
   * that miscount — see its doc.
   * @param {string|Object[]} text - The text (or messages array) to size
   * @returns {number} The estimated token count
   */
  _estimateTokens(text) {
    return Math.ceil(JSON.stringify(text).length / 4);
  }

  /**
   * Lower `max_tokens` so the request's INPUT plus its OUTPUT budget fits
   * `maxModelLen`, without asking for output the translation cannot use.
   *
   * `max_tokens` is the OUTPUT budget, and vLLM rejects a request whose prompt
   * plus `max_tokens` exceeds the model's context window. Deriving it from the
   * context length alone (`maxModelLen - 128`) therefore caps the PROMPT at
   * ~128 tokens: on an 8192-token model every request asked for 8064 output
   * tokens, so anything longer than a short sentence was refused outright
   * ("maximum context length is 8192 tokens. However, you requested 8064
   * output tokens and your prompt contains at least 129"). The prompt has to
   * come out of the same window.
   *
   * The budget is the smaller of two bounds: what the window can carry
   * (`room`), and what a translation of this prompt can plausibly produce
   * (`needed` — a translation runs about as long as its source, so a prompt of
   * N tokens needs on the order of N, not the ~8000 the window would otherwise
   * hand over).
   *
   * `needed` is what keeps the input estimate from being load-bearing. Input
   * size is estimated at `chars / 4`, which is optimistic for CJK (zh is in
   * both the gemma-3 and translategemma language maps, where the tokenizer
   * runs nearer one token per character). An over-generous budget is what
   * turns that miscount into a rejected request; a budget sized by need leaves
   * the window room to absorb it. The miscount is not eliminated — a CJK node
   * beyond roughly 4 000 characters still overflows and is rejected — so the
   * estimate is treated as a guess to be survived, not a measurement.
   *
   * A budget is a ceiling, so a translation that genuinely needs more stops at
   * `max_tokens`. That is not left as a quiet shortfall: `callVllmService`
   * rejects on `finish_reason === 'length'`, so a truncated translation
   * surfaces as a failed request rather than being accepted and cached as a
   * shortened answer. A prompt that cannot fit at all is refused here rather
   * than sent with an unusable budget.
   *
   * @param {Object} requestBody - OpenAI-compatible request body; mutated
   * @returns {Object} the same body, with `max_tokens` capped
   * @throws {Error} if the prompt leaves too little of the window to translate
   */
  _capMaxTokens(requestBody) {
    if (!Array.isArray(requestBody.messages)) {
      throw new Error('Cannot size the output budget: request body has no messages array');
    }
    const inputTokens = this._estimateTokens(requestBody.messages);
    const room = this.maxModelLen - inputTokens - 128;
    if (room < MIN_OUTPUT_BUDGET) {
      // A budget this small would earn a reply of a few tokens, which the
      // markdown path would substitute for the whole paragraph. Refuse instead:
      // an oversized prompt is the caller's to split, and a refusal has to
      // stay visible rather than becoming a silently shorter answer.
      throw new Error(`Prompt leaves ${room} of ${this.maxModelLen} tokens, too little for a translation`);
    }
    const needed = 4 * inputTokens + 256;
    requestBody.max_tokens = Math.min(requestBody.max_tokens ?? room, room, needed);
    return requestBody;
  }

  /**
   * The language name a prompt is built from.
   *
   * The name comes from the language map or not at all: falling back to the
   * code would put an unmapped value into the prompt, which is the one thing
   * the map exists to prevent.
   *
   * A code the map knows but does not name is a defect in the shipped map,
   * not a bad request: the caller asked for a language the deployment
   * supports. It is deliberately not an `UnsupportedLanguageError` — that
   * error is the refusal of a caller's language (HTTP 400), and reporting
   * our own defect as one would blame the request for it.
   *
   * @param {string} code - Model-specific language code
   * @returns {string} The language name
   * @throws {Error} When the language map has no name for the code.
   */
  _languageName(code) {
    const names = this.languageMap ? this.languageMap.languageNames : null;
    const name = names && Object.prototype.hasOwnProperty.call(names, code) ? names[code] : null;
    if (!name) {
      throw new Error(
        `[GPU-BACKEND] The language map has no name for the model code "${code}" — the shipped map is missing an entry (server-side defect, not a bad request)`
      );
    }
    return name;
  }

  /**
   * Format request for specific model
   * @param {string} modelId - Model identifier
   * @param {string} sourceCode - Source language code (model-specific)
   * @param {string} targetCode - Target language code (model-specific)
   * @param {string} text - Text to translate
   * @returns {Object} Formatted request body
   */
  formatRequest(modelId, sourceCode, targetCode, text) {
    // TranslateGemma format (structured chat with language codes)
    if (modelId.includes('translategemma')) {
      return this._capMaxTokens({
        model: modelId,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                source_lang_code: sourceCode, // ISO 639-1
                target_lang_code: targetCode, // ISO 639-1
                text: text
              }
            ]
          }
        ],
        temperature: 0.0
      });
    }

    // Gemma-3 format (prompt-based translation)
    if (modelId.includes('gemma-3')) {
      const sourceLangName = this._languageName(sourceCode);
      const targetLangName = this._languageName(targetCode);
      const prompt = this.languageMap.promptTemplate
        ? this.languageMap.promptTemplate(sourceCode, targetCode, sourceLangName, targetLangName, text)
        : `Translate the following text from ${sourceLangName} to ${targetLangName}. Only return the translation, no explanation.\n\nText: ${text}`;

      return this._capMaxTokens({
        model: modelId,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3
      });
    }

    // Default/fallback format (OpenAI-compatible)
    return this._capMaxTokens({
      model: modelId,
      messages: [
        {
          role: 'user',
          content: `Translate from ${sourceCode} to ${targetCode}: ${text}`
        }
      ],
      temperature: 0.3
    });
  }

  /**
   * The endpoint-served token usage of a chat completion, or null when the
   * response carries none. Only finite counts count: a partial usage object
   * cannot be accounted.
   * @param {Object} response - Parsed vLLM response body
   * @returns {{prompt_tokens: number, completion_tokens: number}|null}
   */
  _servedUsage(response) {
    const usage = response && response.usage;
    if (usage && Number.isFinite(usage.prompt_tokens) && Number.isFinite(usage.completion_tokens)) {
      return { prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens };
    }
    return null;
  }

  /**
   * The chars/4 estimate of a call's token usage — the deployed constant
   * (the same estimator `_estimateTokens` uses for the window math). Used
   * ONLY to account for usage the endpoint discarded, never to bound a call.
   * @param {Object} requestBody - The request as it was sent
   * @param {string} translated - The translation the call produced
   * @returns {{prompt_tokens: number, completion_tokens: number}}
   */
  _estimateUsage(requestBody, translated) {
    return {
      prompt_tokens: this._estimateTokens(requestBody.messages),
      completion_tokens: Math.ceil((translated || '').length / 4)
    };
  }

  /**
   * POST one chat completion and resolve its content plus the endpoint-served
   * usage. The transport internals of `callVllmService`; the string-only
   * wrapper below keeps the legacy callers' resolved shape untouched.
   * @param {Object} requestBody - Request body
   * @param {Object} [options] - Additive per-call options (story 2.10); null
   *   and undefined are both "no options".
   * @param {number} [options.timeoutMs] - Per-call timeout; default 30s (the
   *   deployed value). A non-finite value is treated as not provided — Node's
   *   socket layer does not honour NaN/Infinity, and the call would never
   *   expire. The agentic leg passes the remaining end-to-end deadline, so no
   *   call runs past it.
   * @param {AbortSignal} [options.signal] - Caller abort (the client
   *   disconnect): an abort destroys the in-flight request. Absent on the
   *   legacy path — the wiring is inert without it.
   * @returns {Promise<{content: string, usage: {prompt_tokens: number, completion_tokens: number}|null}>}
   */
  async _postChatCompletion(requestBody, options) {
    const { timeoutMs, signal } = options || {};
    const callTimeoutMs = Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_CALL_TIMEOUT_MS;
    // An already-aborted caller never produces a request at all.
    if (signal && signal.aborted) {
      throw new Error('vLLM service request aborted');
    }
    const url = new URL(this.endpoint);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;
    const basePath = url.pathname.replace(/\/$/, '');

    return new Promise((resolve, reject) => {
      const postData = JSON.stringify(requestBody);

      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${basePath}/v1/chat/completions`,
        method: 'POST',
        headers: this._buildHeaders({
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }),
        timeout: callTimeoutMs // 30 second timeout (the legacy default; overridable per call)
      };

      // Abort wiring (story 2.10). An abort destroys the in-flight request;
      // the listener never outlives the settlement. Without a signal nothing
      // here changes for the legacy callers.
      let onAbort = null;
      const settle = (fn) => (value) => {
        if (onAbort && signal) signal.removeEventListener('abort', onAbort);
        fn(value);
      };
      const resolveSettled = settle(resolve);
      const rejectSettled = settle(reject);

      const req = client.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              const response = JSON.parse(data);

              // Parse response based on format
              const choice = response.choices && response.choices.length > 0 && response.choices[0];
              if (choice && choice.finish_reason === 'length') {
                // The model ran into the output budget instead of finishing. The
                // caller cannot tell a short text from a truncated one, so treat
                // it as a failed request: it surfaces to the caller and never
                // reaches the translation cache.
                logger.error(
                  `[GPU-BACKEND] vLLM stopped at max_tokens=${requestBody.max_tokens} without finishing the translation`
                );
                rejectSettled(new Error(`vLLM truncated the translation at max_tokens=${requestBody.max_tokens}`));
                return;
              }

              const content = choice && choice.message ? choice.message.content : undefined;
              if (typeof content !== 'string') {
                // A choice with no content (null, or a tool-call shape) is not a
                // translation. Resolving it as an empty string would blank the
                // paragraph, so the request fails visibly instead.
                rejectSettled(new Error('vLLM returned a choice with no message content'));
                return;
              }
              resolveSettled({ content: content.trim(), usage: this._servedUsage(response) });
            } else {
              logger.error(`[GPU-BACKEND] vLLM service returned status ${res.statusCode}: ${data}`);
              rejectSettled(new Error(`vLLM service error: ${res.statusCode}`));
            }
          } catch (error) {
            logger.error(`[GPU-BACKEND] Failed to parse vLLM response: ${error.message}`);
            rejectSettled(new Error(`Failed to parse vLLM response: ${error.message}`));
          }
        });
      });

      req.on('error', (error) => {
        logger.error(`[GPU-BACKEND] vLLM service request failed: ${error.message}`);
        rejectSettled(new Error(`vLLM service request failed: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        rejectSettled(new Error('vLLM service request timeout'));
      });

      if (signal) {
        // Abort wiring only: an already-aborted caller was refused above.
        onAbort = () => req.destroy(new Error('vLLM service request aborted'));
        signal.addEventListener('abort', onAbort, { once: true });
      }

      req.write(postData);
      req.end();
    });
  }

  /**
   * Call vLLM service
   * @param {Object} requestBody - Request body
   * @param {Object} [options] - Additive per-call options (`timeoutMs`,
   *   `signal`), passed through to `_postChatCompletion`. Omitted on the
   *   legacy path, which keeps the deployed 30s timeout and no abort wiring.
   * @returns {Promise<string>} Translated text
   */
  async callVllmService(requestBody, options) {
    const { content } = await this._postChatCompletion(requestBody, options);
    return content;
  }

  /**
   * The usage-returning twin of `translate` (story 2.10 — the agentic leg).
   *
   * The legacy `translate` resolves strings only and its 30s timeout is
   * private; the residual-budget contract (AD-6/AD-14) needs usage returned
   * or estimated, a timeout bounded by the remaining deadline, and a
   * disconnect that destroys the in-flight request. This entry point wraps
   * the same internals (same prompt, same truncation rejection, same empty
   * text skipping) and adds exactly that:
   *
   * - `options.maxTokens` — the output budget is capped at the caller's
   *   bound (the remaining allowance) on top of the window math
   *   `_capMaxTokens` already applies;
   * - `options.timeoutMs` — the per-call timeout, overriding the 30s
   *   default (a non-finite value is treated as not provided); across
   *   several texts the budget shrinks with elapsed time, so a later text
   *   cannot start past the deadline the caller set;
   * - `options.signal` — a caller abort destroys the in-flight request;
   * - the resolved usage — the endpoint-served counts when the response
   *   carries them, otherwise the chars/4 estimate, flagged `estimated`;
   *   null when no call was made at all (an empty input, or one of only
   *   empty texts), so no-call stays distinguishable from zero-usage.
   *
   * The legacy `translate` is untouched: same signature, same 30s timeout,
   * no usage reading.
   *
   * @param {string[]} texts - Texts to translate
   * @param {string} sourceCode - Source language code (model-specific)
   * @param {string} targetCode - Target language code (model-specific)
   * @param {Object} [options] - `{maxTokens, timeoutMs, signal}`; null and
   *   undefined are both "no options".
   * @returns {Promise<{translations: string[], usage: {prompt_tokens: number, completion_tokens: number}|null, estimated: boolean}>}
   */
  async translateWithUsage(texts, sourceCode, targetCode, options) {
    const { maxTokens, timeoutMs, signal } = options || {};
    if (!this.initialized) {
      logger.error('[GPU-BACKEND] Not initialized. Cannot perform translation.');
      throw new Error('[GPU-BACKEND] Backend is not ready.');
    }

    if (!texts || texts.length === 0) {
      logger.warn('[GPU-BACKEND] translateWithUsage called with empty array.');
      return { translations: [], usage: null, estimated: false };
    }

    logger.info(`[GPU-BACKEND] Translating ${texts.length} texts from ${sourceCode} to ${targetCode}`);

    const translations = [];
    let promptTokens = 0;
    let completionTokens = 0;
    let estimated = false;
    let callsMade = 0;
    // The caller's deadline: a later text must not start past it.
    const deadline = Number.isFinite(timeoutMs) ? Date.now() + timeoutMs : null;

    try {
      for (let i = 0; i < texts.length; i++) {
        const text = texts[i];

        // Skip empty texts (the `translate` discipline)
        if (!text || text.trim() === '') {
          translations.push('');
          continue;
        }

        let callTimeout = timeoutMs;
        if (deadline !== null) {
          callTimeout = deadline - Date.now();
          if (callTimeout <= 0) {
            // The budget the caller set is spent: no further call starts.
            // The same failure a socket timeout reports, so the caller's
            // classification is one check.
            throw new Error('vLLM service request timeout');
          }
        }

        const requestBody = this.formatRequest(this.modelId, sourceCode, targetCode, text);
        if (Number.isFinite(maxTokens)) {
          // The residual bound rides the request: the smaller of the window
          // math's cap and the remaining allowance. `max_tokens` is always
          // assigned by `_capMaxTokens` (it throws on the refusal path), so
          // there is no fallback case.
          requestBody.max_tokens = Math.min(requestBody.max_tokens, maxTokens);
        }

        const { content, usage } = await this._postChatCompletion(requestBody, {
          timeoutMs: callTimeout,
          signal
        });
        translations.push(content);
        callsMade += 1;

        if (usage) {
          promptTokens += usage.prompt_tokens;
          completionTokens += usage.completion_tokens;
        } else {
          const guess = this._estimateUsage(requestBody, content);
          promptTokens += guess.prompt_tokens;
          completionTokens += guess.completion_tokens;
          estimated = true;
        }

        logger.debug(`[GPU-BACKEND] Translated text ${i + 1}/${texts.length}`);
      }

      return {
        translations,
        usage: callsMade > 0 ? { prompt_tokens: promptTokens, completion_tokens: completionTokens } : null,
        estimated
      };
    } catch (error) {
      logger.error(`[GPU-BACKEND] Translation failed: ${error.message}`, {
        stack: error.stack,
        sourceCode: sourceCode,
        targetCode: targetCode
      });
      throw error;
    }
  }

  /**
   * Translate using vLLM service
   * @param {string[]} texts - Texts to translate
   * @param {string} sourceCode - Source language code (model-specific)
   * @param {string} targetCode - Target language code (model-specific)
   * @returns {Promise<string[]>} Translated texts
   */
  async translate(texts, sourceCode, targetCode) {
    if (!this.initialized) {
      logger.error('[GPU-BACKEND] Not initialized. Cannot perform translation.');
      throw new Error('[GPU-BACKEND] Backend is not ready.');
    }

    if (!texts || texts.length === 0) {
      logger.warn('[GPU-BACKEND] translate called with empty array.');
      return [];
    }

    logger.info(`[GPU-BACKEND] Translating ${texts.length} texts from ${sourceCode} to ${targetCode}`);

    try {
      const startTime = Date.now();
      const translatedTexts = [];

      // Process each text (vLLM handles batching internally)
      for (let i = 0; i < texts.length; i++) {
        const text = texts[i];

        // Skip empty texts
        if (!text || text.trim() === '') {
          translatedTexts.push('');
          continue;
        }

        // Format request for this model
        const requestBody = this.formatRequest(this.modelId, sourceCode, targetCode, text);

        // Call vLLM service
        const translated = await this.callVllmService(requestBody);
        translatedTexts.push(translated);

        logger.debug(`[GPU-BACKEND] Translated text ${i + 1}/${texts.length}`);
      }

      const duration = Date.now() - startTime;
      logger.info(`[GPU-BACKEND] Translation completed in ${duration}ms (${texts.length} texts)`);

      return translatedTexts;
    } catch (error) {
      logger.error(`[GPU-BACKEND] Translation failed: ${error.message}`, {
        stack: error.stack,
        sourceCode: sourceCode,
        targetCode: targetCode
      });
      throw new Error(`[GPU-BACKEND] Failed to perform translation: ${error.message}`, { cause: error });
    }
  }

  /**
   * Get backend information
   * @returns {Object} Backend info
   */
  getBackendInfo() {
    return {
      type: 'gpu',
      model: this.modelId,
      modelId: this.languageMap?.modelName || this.modelId,
      codeFormat: this.languageMap?.codeFormat || 'unknown',
      endpoint: this.endpoint,
      port: this.port,
      maxModelLen: this.maxModelLen,
      initialized: this.initialized,
      healthCheckPassed: this.healthCheckPassed
    };
  }

  /**
   * "A GPU API is configured" — the same two independent signals the legacy
   * service reads: a remote GPU node host, or an explicit translation
   * endpoint. The in-cluster worker alone is compose's pass-through default,
   * not a configuration.
   * @returns {boolean}
   */
  isApiConfigured() {
    return Boolean(process.env.GPU_NODE_HOST) || this.endpointExplicit;
  }
}

module.exports = GpuTranslateBackend;
