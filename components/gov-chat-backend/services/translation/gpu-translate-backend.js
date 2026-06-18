const { logger } = require('../../shared-lib');
const http = require('http');
const https = require('https');

// API key for remote GPU node authentication (standard OpenAI Bearer token)
const VLLM_API_KEY = process.env.VLLM_API_KEY || '';

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
    this.endpoint = process.env.VLLM_TRANSLATION_ENDPOINT || 'http://vllm-translation-guardrail:9031';
    this.port = parseInt(process.env.VLLM_TRANSLATION_SERVICE_PORT, 10) || 9031;

    // Runtime state
    this.initialized = false;
    this.languageMap = null;
    this.fallbackMap = null;
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
      this.fallbackMap = this.languageMap.fallbackMap || {};

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
      // Don't throw - allow fallback to CPU backend
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
          timeout: 5000
        };

        const req = client.request(options, (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            logger.info(`[GPU-BACKEND] Health check passed (status ${res.statusCode})`);
            resolve(true);
          } else {
            logger.warn(`[GPU-BACKEND] Health check returned status ${res.statusCode}`);
            resolve(true);
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
          timeout: 5000
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

    const code = this.languageMap.languageMap[isoCode];
    if (!code) {
      logger.warn(`[GPU-BACKEND] No language code mapping for: ${isoCode}`);
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
    return this.languageMap && Object.prototype.hasOwnProperty.call(this.languageMap.languageMap, isoCode);
  }

  /**
   * Get all supported languages
   * @returns {Object} Language map
   */
  getSupportedLanguages() {
    return this.languageMap ? this.languageMap.languageMap : {};
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
    // Reserve tokens for the prompt (~128 tokens) so total stays within maxModelLen
    const maxTokens = Math.max(128, this.maxModelLen - 128);

    // TranslateGemma format (structured chat with language codes)
    if (modelId.includes('translategemma')) {
      return {
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
        temperature: 0.0,
        max_tokens: maxTokens
      };
    }

    // Gemma-3 format (prompt-based translation)
    if (modelId.includes('gemma-3')) {
      const sourceLangName = this.languageMap.languageNames?.[sourceCode] || sourceCode;
      const targetLangName = this.languageMap.languageNames?.[targetCode] || targetCode;
      const prompt = this.languageMap.promptTemplate
        ? this.languageMap.promptTemplate(sourceCode, targetCode, sourceLangName, targetLangName, text)
        : `Translate the following text from ${sourceLangName} to ${targetLangName}. Only return the translation, no explanation.\n\nText: ${text}`;

      return {
        model: modelId,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: maxTokens
      };
    }

    // Default/fallback format (OpenAI-compatible)
    return {
      model: modelId,
      messages: [
        {
          role: 'user',
          content: `Translate from ${sourceCode} to ${targetCode}: ${text}`
        }
      ],
      temperature: 0.3,
      max_tokens: maxTokens
    };
  }

  /**
   * Call vLLM service
   * @param {Object} requestBody - Request body
   * @returns {Promise<string>} Translated text
   */
  async callVllmService(requestBody) {
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
        timeout: 30000 // 30 second timeout
      };

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
              let translatedText = '';
              if (response.choices && response.choices.length > 0) {
                translatedText = response.choices[0].message.content.trim();
              }

              resolve(translatedText);
            } else {
              logger.error(`[GPU-BACKEND] vLLM service returned status ${res.statusCode}: ${data}`);
              reject(new Error(`vLLM service error: ${res.statusCode}`));
            }
          } catch (error) {
            logger.error(`[GPU-BACKEND] Failed to parse vLLM response: ${error.message}`);
            reject(new Error(`Failed to parse vLLM response: ${error.message}`));
          }
        });
      });

      req.on('error', (error) => {
        logger.error(`[GPU-BACKEND] vLLM service request failed: ${error.message}`);
        reject(new Error(`vLLM service request failed: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('vLLM service request timeout'));
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Call vLLM service with streaming output (stream:true). Invokes onToken for
   * each generated delta token and resolves with the full concatenated text.
   * @param {Object} requestBody - Request body (stream:true is added automatically)
   * @param {(delta: string) => void} [onToken] - Called for each output delta
   * @returns {Promise<string>} Full concatenated translated text
   */
  async callVllmStream(requestBody, onToken) {
    const url = new URL(this.endpoint);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;
    const basePath = url.pathname.replace(/\/$/, '');
    const postData = JSON.stringify({ ...requestBody, stream: true });

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${basePath}/v1/chat/completions`,
      method: 'POST',
      headers: this._buildHeaders({
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }),
      timeout: 60000
    };

    return new Promise((resolve, reject) => {
      let full = '';
      let buffer = '';
      const req = client.request(options, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          let errBody = '';
          res.on('data', (c) => (errBody += c));
          res.on('end', () =>
            reject(new Error(`vLLM stream service error: ${res.statusCode} ${errBody}`))
          );
          return;
        }
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const payload = trimmed.slice(6);
            if (payload === '[DONE]') continue;
            try {
              const parsed = JSON.parse(payload);
              const delta = parsed.choices?.[0]?.delta?.content || '';
              if (delta) {
                full += delta;
                if (onToken) onToken(delta);
              }
            } catch {
              // Ignore non-JSON keepalive/partial lines
            }
          }
        });
        res.on('end', () => resolve(full));
      });

      req.on('error', (error) => {
        logger.error(`[GPU-BACKEND] vLLM stream request failed: ${error.message}`);
        reject(new Error(`vLLM stream request failed: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('vLLM stream request timeout'));
      });

      req.write(postData);
      req.end();
    });
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
   * Stream-translate a single COMPLETE unit (sentence/paragraph — see
   * services/translation/stream-boundary.js). The translator streams its output
   * via onToken. An optional rolling context window (prior units) keeps
   * terminology/pronouns consistent across units (prompt-based models only).
   * @param {string} text - Complete unit to translate
   * @param {string} sourceCode - Source language code (model-specific)
   * @param {string} targetCode - Target language code (model-specific)
   * @param {{source: string, target: string}[]} [context] - Prior units EN+target
   * @param {(delta: string) => void} [onToken] - Streaming callback
   * @returns {Promise<string>} Full translated text
   */
  async translateStream(text, sourceCode, targetCode, context, onToken) {
    if (!this.initialized) {
      throw new Error('[GPU-BACKEND] Backend is not ready.');
    }
    if (!text || text.trim() === '') return '';

    const requestBody = this.formatRequest(this.modelId, sourceCode, targetCode, text);

    // Context window: for prompt-based models, prepend prior units so the
    // translator keeps terminology/pronouns consistent across units. TranslateGemma
    // uses a structured payload where free-text context isn't supported, so it
    // translates the unit standalone (still correct, just less cross-unit glue).
    if (context && context.length > 0 && !this.modelId.includes('translategemma')) {
      const ctxBlock = context
        .map((c) => `EN: ${c.source}\n${targetCode.toUpperCase()}: ${c.target}`)
        .join('\n');
      const langNames = this.languageMap?.languageNames || {};
      const srcName = langNames[sourceCode] || sourceCode;
      const tgtName = langNames[targetCode] || targetCode;
      requestBody.messages = [
        {
          role: 'user',
          content:
            `Prior context (for terminology consistency only — do NOT translate or repeat it):\n${ctxBlock}\n\n` +
            `Translate ONLY the following text from ${srcName} to ${tgtName}. Return only the translation:\n${text}`
        }
      ];
    }

    return this.callVllmStream(requestBody, onToken);
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
}

module.exports = GpuTranslateBackend;
