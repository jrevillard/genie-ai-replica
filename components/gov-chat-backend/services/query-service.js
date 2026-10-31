require('dotenv').config();
const { aql } = require('arangojs');
const { logger, dbService } = require('../shared-lib');
const { Worker } = require('worker_threads');
const path = require('path');
const { NotFoundError } = require('../middleware/errors');
const { normalizeRequestedLanguage } = require('./translation/language-request');
const api = require('@opentelemetry/api');
const { parsePositiveInt } = require('../shared-lib');
const retrievalConfigClient = require('./retrieval-config-client');

// Pick the user-visible question to store in queries.text for the Query Inspector.
// Order of preference:
//   1. `queryData.userQuestion` — the frontend's visibleText/typed text (the only
//      value that matches what the user saw in the chat, even when the dual-prompt
//      mechanism replaces the last user message in `messages` with a hidden
//      persona/system prompt for OPEA). MUST be a string — non-string inputs
//      (objects, arrays, numbers) would coerce to "[object Object]" and pollute
//      the Inspector. We log + reject.
//   2. The last user-role message in `messages` — correct for un-swapped flows.
//   3. The tail of `messages` — defensive fallback for any shape we don't
//      recognise. Skips empty/whitespace entries so a leftover streaming
//      placeholder (isStreaming flag absent OR content empty) can never win.
//
// Returned values are always trimmed strings (never raw, never null).
function pickUserText(messages, explicit) {
  if (explicit != null) {
    if (typeof explicit === 'string' && explicit.trim()) {
      return explicit.trim();
    }
    if (typeof explicit !== 'undefined') {
      logger.warn('pickUserText.ignored_non_string_userQuestion', {
        type: typeof explicit,
        isArray: Array.isArray(explicit)
      });
    }
  }
  if (Array.isArray(messages)) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      const content = m && typeof m.content === 'string' ? m.content.trim() : '';
      if (m && m.role === 'user' && content) return content;
    }
    const tail = messages[messages.length - 1];
    const tailContent = tail && typeof tail.content === 'string' ? tail.content.trim() : '';
    if (tailContent) return tailContent;
  }
  return '';
}

// The OPEA upstream is deployment configuration. Compose and the Helm chart
// both set OPEA_HOST; the fallback is the Compose service name so an unset
// variable points at the documented topology rather than a hostname that
// only ever resolved on one developer's machine.
const DEFAULT_OPEA_HOST = 'chatqna-xeon-backend-server';
const DEFAULT_OPEA_PORT = '8888';

function opeaChatQnaUrl() {
  return `http://${process.env.OPEA_HOST || DEFAULT_OPEA_HOST}:${process.env.OPEA_PORT || DEFAULT_OPEA_PORT}/v1/chatqna`;
}

// The target language the client asked for. It travels to OPEA, which
// validates it against its own language map before it is used, so only a
// string is forwarded: anything else is dropped rather than handed to the
// request model as something it has to reject.
//
// The normalization is the shared one (services/translation/language-request):
// the query routes normalize the same field for the translation path, and two
// spellings of one language is how a request ends up refused by one path and
// accepted by the other.
function pickLanguage(context) {
  const language = context ? context.language : undefined;
  if (language != null && typeof language !== 'string') {
    logger.warn('pickLanguage.ignored_non_string_language', {
      type: typeof language,
      isArray: Array.isArray(language)
    });
  }
  // An empty language means "no language asked for", which is a normal
  // request and not something to warn about.
  return normalizeRequestedLanguage(language) || undefined;
}

class QueryService {
  constructor() {
    this.dbService = dbService; // Store the service reference instead of the promise
    this.db = null;
    this.queries = null;
    this.serviceCategories = null;
    this.serviceCategoryTranslations = null;
    this.serviceTranslations = null;
    this.analyticsService = null; // Will be set via dependency injection
    this.chatHistoryService = null; // Will be set via dependency injection
    this.initialized = false;
    logger.info('QueryService constructor called');
  }

  /**
   * Normalize a request's context to the one contract both query paths
   * speak. A bare serviceLabels string is ONE label (never a sequence of
   * characters, never an EMPTY scope — dropping it would send the query
   * out with no filter at all); categoryLabel stays null when the request
   * declares no category (never 'General' — that label names no entity).
   */
  normalizeQueryContext(context) {
    const normalized = { ...(context || {}) };
    if (!Array.isArray(normalized.serviceLabels)) {
      // A bare string is ONE label — but a bare EMPTY string is NOTHING:
      // wrapping it into [''] would let the blank take the service branch
      // and eclipse the declared category downstream.
      normalized.serviceLabels =
        typeof normalized.serviceLabels === 'string' && normalized.serviceLabels !== ''
          ? [normalized.serviceLabels]
          : [];
    }
    if (normalized.categoryLabel === undefined) {
      normalized.categoryLabel = null;
    }
    // The upstream OPEA spelling of the category is a LIST. A bare string
    // is ONE label — the same rule serviceLabels follows. Dropping the
    // spelling instead of carrying it would answer from the whole corpus
    // while the caller believed it asked a category-scoped question.
    if (typeof normalized.categoryLabels === 'string') {
      if (normalized.categoryLabels !== '') {
        normalized.categoryLabels = [normalized.categoryLabels];
      } else {
        delete normalized.categoryLabels;
      }
    }
    return normalized;
  }

  /**
   * Resolve the wire's EN labels to the entities they name, for the query
   * record's links (analytics). The EN translation is the SSOT; the
   * document's cached `nameEN` is the FALLBACK for entities imported
   * outside the write path (no translation row at all). The WIRE itself
   * is untouched: the retriever filters on what the client sent.
   */
  async resolveScopeIds(context, { resolveCategory = true } = {}) {
    // The category and the service resolutions are INDEPENDENT — the one
    // never feeds the other — so they run in PARALLEL instead of paying
    // both Arango round-trip latencies back to back.
    const resolveCategoryId = async () => {
      let categoryId = null;
      if (resolveCategory && context?.categoryLabel) {
        try {
          const categoryQuery = aql`
              FOR trans IN ${this.serviceCategoryTranslations}
                FILTER LOWER(trans.languageCode) == 'en'
                FILTER trans.translation == ${context.categoryLabel}
                LIMIT 1
                RETURN trans.serviceCategoryId
            `;
          let cursor = await this.db.query(categoryQuery);
          categoryId = await cursor.next();
          if (!categoryId) {
            const fallbackQuery = aql`
                FOR cat IN ${this.serviceCategories}
                  FILTER cat.nameEN == ${context.categoryLabel}
                  LIMIT 1
                  RETURN cat._key
              `;
            cursor = await this.db.query(fallbackQuery);
            categoryId = await cursor.next();
          }
        } catch (error) {
          logger.error(`Error resolving categoryId: ${error.message}`);
        }
      }
      return categoryId;
    };
    const resolveServiceIds = async () => {
      let serviceIds = [];
      if (context?.serviceLabels?.length > 0) {
        try {
          // The pairs come back, not the bare ids: a label the translation
          // lookup did not answer for is the input of the fallback below.
          const servicesQuery = aql`
              FOR trans IN ${this.serviceTranslations}
                FILTER LOWER(trans.languageCode) == 'en'
                FILTER trans.translation IN ${context.serviceLabels}
                RETURN DISTINCT { label: trans.translation, serviceId: trans.serviceId }
            `;
          const cursor = await this.db.query(servicesQuery);
          const matched = await cursor.all();
          serviceIds = matched.map((pair) => pair.serviceId);
          // The same fallback the category resolution has: an entity
          // imported outside the write path carries nameEN with no
          // translation document. The fallback feeds the query RECORD's
          // link only — the wire still carries exactly what the client
          // sent.
          const matchedLabels = new Set(matched.map((pair) => pair.label));
          const unmatched = context.serviceLabels.filter((label) => !matchedLabels.has(label));
          if (unmatched.length > 0) {
            const fallbackQuery = aql`
                FOR svc IN ${this.services}
                  FILTER svc.nameEN IN ${unmatched}
                  RETURN svc._key
              `;
            const fallbackCursor = await this.db.query(fallbackQuery);
            serviceIds.push(...(await fallbackCursor.all()));
          }
        } catch (error) {
          logger.error(`Error resolving serviceIds: ${error.message}`);
        }
      }
      return serviceIds;
    };
    const [categoryId, serviceIds] = await Promise.all([resolveCategoryId(), resolveServiceIds()]);
    // One service can answer through BOTH paths (its translation row
    // for one label, its own nameEN for another): the record counts it
    // once.
    return { categoryId, serviceIds: [...new Set(serviceIds)] };
  }

  /**
   * The shared scope policy of both send paths: resolve ONLY what the
   * request does not already carry — a lookup whose result would be
   * thrown away is Arango queries per send for nothing — and take both
   * ids out of ONE resolveScopeIds call (two calls meant up to four
   * queries per send).
   */
  async resolveMissingScopeIds(queryData) {
    let categoryId = queryData.categoryId || null;
    let serviceIds = queryData.serviceId ? [queryData.serviceId] : [];
    const needCategory = !categoryId && Boolean(queryData.context?.categoryLabel);
    const needServices = queryData.context?.serviceLabels?.length > 0 && serviceIds.length === 0;
    if (needCategory || needServices) {
      const resolved = await this.resolveScopeIds(queryData.context, { resolveCategory: needCategory });
      if (needCategory) {
        categoryId = resolved.categoryId;
        if (!categoryId) {
          logger.warn(`Category not found for label: ${queryData.context.categoryLabel}`);
        } else {
          logger.info(`Resolved categoryLabel "${queryData.context.categoryLabel}" to categoryId: ${categoryId}`);
        }
      }
      if (needServices) {
        serviceIds = resolved.serviceIds;
        if (serviceIds.length === 0) {
          logger.warn(`No services found for labels: ${queryData.context.serviceLabels.join(', ')}`);
        } else {
          logger.info(`Resolved serviceLabels to serviceIds: ${serviceIds.join(', ')}`);
        }
      }
    }
    return { categoryId, serviceIds };
  }

  /**
   * Initialize the QueryService
   * @returns {Promise<void>}
   */
  async init() {
    if (this.initialized) {
      logger.debug('QueryService already initialized, skipping');
      return;
    }
    try {
      this.db = await this.dbService.getConnection('default');
      this.queries = this.db.collection('queries');
      this.serviceCategories = this.db.collection('serviceCategories');
      this.serviceCategoryTranslations = this.db.collection('serviceCategoryTranslations');
      this.serviceTranslations = this.db.collection('serviceTranslations');
      this.services = this.db.collection('services');
      this.initialized = true;
      logger.info('QueryService initialized successfully');
    } catch (error) {
      logger.error(`Error initializing QueryService: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Set the analytics service
   * @param {Object} analyticsService - Analytics service instance
   */
  setAnalyticsService(analyticsService) {
    this.analyticsService = analyticsService;
    logger.info('QueryService.analytics_service_set');
  }

  /**
   * Set the chat history service
   * @param {Object} chatHistoryService - Chat history service instance
   */
  async setChatHistoryService(chatHistoryService) {
    this.chatHistoryService = chatHistoryService;
    logger.info('QueryService.chat_history_service_set');
  }

  /**
   * Offload OPEA call to a worker thread
   * @param {string} url - The OPEA endpoint URL
   * @param {Object} payload - The request payload
   * @returns {Promise<Object>} The worker result
   */
  runOPEAWorker(url, payload, headers = null) {
    return new Promise((resolve, reject) => {
      const workerPath = path.join(__dirname, './opea-worker.js');
      const worker = new Worker(workerPath);

      worker.on('message', (msg) => {
        if (msg.status === 'success') {
          resolve(msg.data);
        } else {
          reject(new Error(msg.error ? msg.error.message : 'Worker execution failed'));
        }
        worker.terminate();
      });

      worker.on('error', (err) => {
        reject(err);
        worker.terminate();
      });

      worker.on('exit', (code) => {
        if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
      });

      worker.postMessage({ url, payload, headers });
    });
  }

  /**
   * Generates a mock OPEA response for testing purposes.
   * @param {Object} queryData - The incoming query data.
   * @returns {Object} A mock response object { response, metadata }.
   */
  getMockOpeaResponse(queryData) {
    logger.info('[DEBUG] Generating mock OPEA response for test mode.');
    const { categoryLabel, serviceLabels } = queryData.context;
    const lastMessage = queryData.messages[queryData.messages.length - 1].content.toLowerCase();

    let response = `This is a general mock response. You asked about "${lastMessage}" within the context of "${categoryLabel}".`;
    const metadata = {
      source_documents: [],
      confidence_score: Math.random() * (0.98 - 0.85) + 0.85
    };

    // Main theme response based on categoryLabel
    switch (categoryLabel) {
      case 'Identity & Civil Registration':
        response = `This is a mock response regarding **Identity & Civil Registration**. This category covers services like applying for National IDs, passports, and birth certificates. What specific service do you need help with?`;
        break;
      case 'Taxes & Revenue':
        response = `This is a mock response for **Taxes & Revenue**. You can get assistance with filing returns, paying taxes, or getting a tax compliance certificate. Please specify what you need.`;
        break;
      case 'Business & Trade':
        response = `This is a mock response for **Business & Trade**. We can help with business registration, permits, and licenses. How can I assist you today?`;
        break;
      case 'Healthcare & Social Services':
        response = `This is a mock response for **Healthcare & Social Services**. This includes finding hospitals, information on national health insurance, and other social programs.`;
        break;
      case 'Education & Learning':
        response = `This is a mock response for **Education & Learning**. You can find information on public schools, higher education loans, and curriculum details here.`;
        break;
      case 'Transportation & Mobility':
        response = `This is a mock response for **Transport & Licenses**. This covers driver's licenses, vehicle registration, and public transport information.`;
        break;
      case 'Housing & Urban Development':
        response = `This is a mock response for **Housing & Urban Development**. Information about affordable housing programs, land rates, and building permits can be found here.`;
        break;
      case 'Employment & Labor Services':
        response = `This is a mock response for **Employment & Labor Services**. We can provide information on job searching, labor laws, and workplace safety.`;
        break;
      case 'General':
        response = `This is a general mock response as no specific category was selected. I can answer questions about a wide range of government services. What would you like to know?`;
        break;
    }

    // Add documents based on serviceLabels
    if (serviceLabels && serviceLabels.length > 0) {
      serviceLabels.forEach((label) => {
        if (label.toLowerCase().includes('id')) {
          metadata.source_documents.push({
            document_id: `doc_id_${Math.floor(Math.random() * 1000)}`,
            url: 'http://example.com/docs/id_application_form.pdf',
            text: 'Official form for National ID card application.',
            categoryLabel: categoryLabel || 'Identity & Civil Registration',
            serviceLabels: [label],
            score: 0.95
          });
        }
        if (label.toLowerCase().includes('birth registration')) {
          metadata.source_documents.push({
            document_id: `doc_birth_${Math.floor(Math.random() * 1000)}`,
            url: 'http://example.com/docs/birth_registration_guide',
            text: 'A step-by-step guide on registering a birth.',
            categoryLabel: categoryLabel || 'Identity & Civil Registration',
            serviceLabels: [label],
            score: 0.98
          });
        }
        if (label.toLowerCase().includes('passport')) {
          metadata.source_documents.push({
            document_id: `doc_passport_${Math.floor(Math.random() * 1000)}`,
            url: 'http://example.com/docs/passport_application_ecitizen',
            text: 'Link to the eCitizen portal for passport applications.',
            categoryLabel: categoryLabel || 'Identity & Civil Registration',
            serviceLabels: [label],
            score: 0.93
          });
        }
        if (label.toLowerCase().includes('tax')) {
          metadata.source_documents.push({
            document_id: `doc_tax_${Math.floor(Math.random() * 1000)}`,
            url: 'http://example.com/docs/tax_payment_options',
            text: 'Information on various methods to pay your taxes.',
            categoryLabel: categoryLabel || 'Taxes & Revenue',
            serviceLabels: [label],
            score: 0.91
          });
        }
        if (label.toLowerCase().includes('business')) {
          metadata.source_documents.push({
            document_id: `doc_biz_${Math.floor(Math.random() * 1000)}`,
            url: 'http://example.com/docs/business_registration_requirements',
            text: 'Checklist of requirements for starting a new business.',
            categoryLabel: categoryLabel || 'Business & Trade',
            serviceLabels: [label],
            score: 0.96
          });
        }
      });
    }

    // If no specific documents were added but we have labels, add a generic one.
    if (metadata.source_documents.length === 0 && serviceLabels && serviceLabels.length > 0) {
      metadata.source_documents.push({
        document_id: `doc_generic_${Math.floor(Math.random() * 1000)}`,
        url: 'http://example.com/docs/general_info',
        text: `General information document related to your query about ${serviceLabels.join(', ')}.`,
        categoryLabel: categoryLabel || 'General',
        serviceLabels: serviceLabels,
        score: 0.85
      });
    }

    return { response, metadata };
  }

  /**
   * Parse a raw SSE line from ChatQnA's align_generator output.
   * ChatQnA outputs Python repr() of bytes: data: b'text'\n\n
   * @param {string} line - Raw SSE data line (without "data: " prefix)
   * @returns {Object} Parsed event: { type: 'chunk'|'done'|'error', content?: string }
   */
  parseChatQnASSELine(line) {
    const trimmed = line.trim();
    if (trimmed === '[DONE]') {
      return { type: 'done' };
    }
    // chatqna metadata event: a raw JSON object (NOT a Python-repr token chunk).
    // Carries the reranker-grounded source documents, confidence, and is_grounded flag.
    if (trimmed.startsWith('{')) {
      try {
        const obj = JSON.parse(trimmed);
        if (obj && obj.type === 'metadata') {
          const parsed = {
            type: 'metadata',
            source_documents: obj.source_documents ?? [],
            confidence_score: obj.confidence_score ?? 0,
            // Raw retrieval confidence (rank-weighted) and LLM self-grade, for
            // admin/eval (QueryInspector). confidence_score above is the
            // citizen-facing value (LLM self-grade when enabled, else retrieval).
            retrieval_confidence_score: obj.retrieval_confidence_score ?? null,
            // Why the answer is missing, when it is: chatqna abstains with a
            // machine-readable reason (e.g. "reranker_input_too_long"), and the
            // generic is_grounded=false alone cannot tell an ingestion-side
            // abstention from an ordinary low-confidence one.
            abstained: obj.abstained ?? false,
            abstention_reason: obj.abstention_reason ?? null,
            // The labels the retrieval filtered on (chatqna computes them with
            // the pipeline's own rule). The Query Inspector names the scope
            // behind an abstention from them; dropping them here would leave
            // every streamed query without a scope. Absent means the pipeline
            // never reported a scope — null, so the Inspector's dash says "not
            // recorded", not "Unfiltered" (an empty list is a reported empty
            // scope and means exactly that).
            filter_labels: Array.isArray(obj.filter_labels) ? obj.filter_labels : null,
            is_grounded: obj.is_grounded ?? false
          };
          // self_confidence is keyed by PRESENCE, not by value. chatqna emits
          // the key only when LLM_SELF_CONFIDENCE_ENABLED, and emits an explicit
          // null when the sentinel was omitted or malformed. The inspector
          // renders its block on hasOwnProperty and its "no sentinel" state on
          // a null value, so collapsing "feature off" into "no sentinel" here
          // would make the two indistinguishable.
          if (Object.prototype.hasOwnProperty.call(obj, 'self_confidence')) {
            parsed.self_confidence = obj.self_confidence;
          }
          // What the history translator fed the embedder ("translated",
          // "passthrough_english", "passthrough_unknown_language",
          // "fallback_timeout" or "fallback_error"): the response-side
          // counterpart of the rag.translation.query_status span attribute.
          // Dropping it here would make a degraded translation invisible on
          // the streamed path — the same loss retrieval_confidence_score and
          // self_confidence suffered before. Keyed by presence so an older
          // chatqna without the field stays mock/test-friendly.
          if (Object.prototype.hasOwnProperty.call(obj, 'query_translation_status')) {
            parsed.query_translation_status = obj.query_translation_status;
          }
          return parsed;
        }
      } catch {
        // Not valid JSON — fall through to token-chunk handling.
      }
    }
    // Match Python repr: b'...' or b"..."
    const match = trimmed.match(/^b(['"])(.*)\1$/s);
    if (match) {
      const quote = match[1];
      let content = match[2];
      // Decode Python repr escape sequences.
      // Order matters: \\ must be handled before \x to avoid consuming escaped backslashes.
      // Use placeholder for \\ so \x doesn't match the second backslash in \\xHH.
      const BS = '\x00BS\x00';
      content = content
        .replace(/\\\\/g, BS)
        .replace(/(?:\\x([0-9a-fA-F]{2}))+/g, (m) => {
          const hex = m.replace(/\\x/g, '');
          return Buffer.from(hex, 'hex').toString('utf8');
        })
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\r/g, '\r')
        .replace(quote === "'" ? /\\'/g : /\\"/g, quote === '"' ? '"' : "'")
        .replace(new RegExp(BS, 'g'), '\\')
        // eslint-disable-next-line no-control-regex -- intentional: strip control chars from LLM output
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
      return { type: 'chunk', content };
    }
    return { type: 'error', raw: trimmed };
  }

  /**
   * Initialize a streaming query — validate, save to DB, build OPEA payload.
   * Returns early without calling ChatQnA (caller handles the stream).
   * @param {Object} queryData - Query data from the request
   * @param {Object} authHeaders - Auth headers to forward to OPEA
   * @returns {Promise<Object>} { queryId, opeaUrl, opeaPayload, queryData }
   */
  async initStreamQuery(queryData, authHeaders) {
    logger.info('QueryService.init_stream_query_start');

    // Validation (reuse same logic as createQuery)
    const missingFields = [];
    if (!queryData.userId) missingFields.push('userId');
    if (!queryData.sessionId) missingFields.push('sessionId');

    if (!Array.isArray(queryData.messages) || queryData.messages.length === 0) {
      if (queryData.text) {
        queryData.messages = [{ role: 'user', content: queryData.text }];
      } else {
        missingFields.push('messages');
      }
    }

    queryData.context = this.normalizeQueryContext(queryData.context);

    if (missingFields.length > 0) {
      throw new Error(`Missing required query data. Fields: ${missingFields.join(', ')}`);
    }

    const queryText = pickUserText(queryData.messages, queryData.userQuestion);
    if (!queryText) {
      logger.warn('QueryService.init_stream_no_extractable_text', {
        sessionId: queryData.sessionId,
        messagesLen: Array.isArray(queryData.messages) ? queryData.messages.length : 0,
        hasUserQuestion: queryData.userQuestion != null
      });
    }

    // Resolve the wire's EN labels to the entities they name (the
    // query record's links). The wire itself is untouched. The shared
    // policy of both send paths lives in resolveMissingScopeIds: only
    // what the request does not already carry is looked up — a request
    // that carries its own categoryId still gets its service links.
    const { categoryId, serviceIds } = await this.resolveMissingScopeIds(queryData);

    const backendMode = process.env.CONTEXT_OPTION || 'conversation-with-context-labels';

    const basicQueryDoc = {
      userId: queryData.userId,
      sessionId: queryData.sessionId,
      timestamp: queryData.timestamp || new Date().toISOString(),
      isAnswered: false,
      categoryId,
      serviceId: serviceIds.length > 0 ? serviceIds : null,
      responseTime: 0,
      contextOption: backendMode,
      messages: queryData.messages,
      context: queryData.context,
      text: queryText
    };

    const query = await this.queries.save(basicQueryDoc);
    const queryId = query._key;
    logger.info('QueryService.stream_query_created', { queryId });

    // Build OPEA payload with stream: true
    const opeaUrl = opeaChatQnaUrl();

    let opeaPayload;
    if (backendMode === 'single-message') {
      opeaPayload = { messages: queryText, stream: true };
    } else {
      opeaPayload = {
        messages: queryData.messages,
        context: {
          categoryLabel: queryData.context.categoryLabel,
          // The legacy PLURAL spelling rides along when the caller used
          // it: the chatqna contract accepts both, and a scope the
          // request declared must never die at this boundary.
          categoryLabels: queryData.context.categoryLabels,
          serviceLabels: queryData.context.serviceLabels,
          language: pickLanguage(queryData.context)
        },
        stream: true
      };
    }

    // Story 1.1 — resolve the OKF retrieval posture + the caller's authorized
    // graph set and attach the fan-out carrier to the payload context.
    // Fail-closed: any resolver problem (except a 401, which propagates — the
    // request itself is invalid) degrades to the legacy carrier, i.e. the
    // payload stays byte-identical to pre-1.1.
    await this._attachFanoutCarrier(opeaPayload, authHeaders, queryId, queryData.sessionId);

    return { queryId, opeaUrl, opeaPayload, authHeaders, queryData };
  }

  /**
   * Story 1.1 (ADR-okf-039) — attach the multi-graph fan-out carrier to the
   * chatqna payload context.
   *
   * The okf-server is the source of truth: the client's `engaged` flag is the
   * AUTHORITATIVE engagement gate (mode ∈ {okf_only, hybrid} AND ≥1 serving
   * graph for this caller, computed server-side) and is never re-computed
   * here. Carrier rules:
   *   - mode == 'hybrid' AND engaged → `authorized_graph_names` = legacy graph
   *     (process.env.ARANGO_GRAPH_NAME) FIRST, then the authz-resolver's OKF
   *     graphs (the GRAPH-injection rule — legacy first, OKF after).
   *   - mode == 'okf_only' → NEVER prepend the legacy graph; the legacy
   *     free-form corpus is NEVER queried (engaged or not) — signalled to
   *     chatqna via `exclude_legacy: true`.
   *   - engaged == false AND mode == 'hybrid' → empty `authorized_graph_names`
   *     (the retriever stays on the legacy path).
   *   - engaged == false AND mode == 'okf_only' → empty carrier AND
   *     `exclude_legacy: true` — the retriever REFUSES the legacy free-form
   *     corpus (zero hits; okf_only never falls back to legacy).
   *   - mode == 'legacy' (or never resolved) → NOTHING is added — the payload
   *     is byte-identical to pre-1.1 (the D8 invariant).
   * @param {Object} opeaPayload - The payload to mutate (context carrier).
   * @param {Object} authHeaders - {authorization: 'Bearer ...'} of the caller.
   * @param {string} queryId - For log correlation.
   * @returns {Promise<Object>} The same payload (mutated in place).
   */
  async _attachFanoutCarrier(opeaPayload, authHeaders, queryId, sessionId = null) {
    const context = opeaPayload && opeaPayload.context;
    // single-message mode has no context object — nothing to carry.
    if (!context) {
      logger.info('QueryService.fanout_carrier_skipped_no_context', { queryId });
      return opeaPayload;
    }
    const bearer = authHeaders?.authorization;
    if (!bearer) {
      // No bearer → the authz endpoints are unreachable for this caller;
      // legacy path (chatqna still authenticates the stream itself).
      logger.info('QueryService.fanout_carrier_skipped_no_bearer', { queryId });
      return opeaPayload;
    }
    const correlationId = crypto.randomUUID();
    try {
      const config = await retrievalConfigClient.getRetrievalConfig(bearer, { correlationId, queryId });
      const mode = config?.config?.mode || 'legacy';
      // The SERVER's engaged flag is the gate — read, never re-derived.
      const engaged = config?.engaged === true;
      const warnings = Array.isArray(config?.warnings) ? config.warnings : [];
      logger.info('QueryService.fanout_config_resolved', {
        queryId,
        correlationId,
        mode,
        engaged,
        serving_graph_count: config?.serving_graph_count,
        serving_graphs: Array.isArray(config?.serving_graphs) ? config.serving_graphs.length : 0,
        warnings: warnings.length
      });

      // Per-call authz — only when the server engaged the fan-out (the carrier
      // is empty regardless when engaged is false).
      // Story 1.3 — the sticky lookup (below) needs only engaged+sessionId and
      // is INDEPENDENT of the authz call, so both start together: one fewer
      // sequential ArangoDB round-trip per engaged chat query (review
      // 2026-10-29).
      let stickyGraphs = [];
      const stickyPromise =
        engaged && sessionId
          ? this._loadStickyGraphs(sessionId, queryId).catch((stickyErr) => {
              // Sticky is an optimization — a lookup problem must never break the query.
              logger.warn('QueryService.sticky_load_failed', { queryId, correlationId, error: stickyErr?.message });
              return [];
            })
          : null;

      let authorizedGraphs = [];
      if (engaged) {
        const authz = await retrievalConfigClient.getAuthorizedGraphs(bearer, { correlationId, queryId });
        authorizedGraphs = Array.isArray(authz?.graph_names)
          ? authz.graph_names.filter((g) => typeof g === 'string' && g.trim())
          : [];
      }

      // Story 1.3 — sticky conversation-continuity set: the routed graphs that
      // produced previous answers in THIS conversation. The retriever searches
      // them unconditionally (they bypass affinity qualification), which keeps
      // signal-free follow-ups ("why are they missing from the table?") locked
      // to the conversation's subject. Authorization still wins: the sticky
      // set is intersected with the carrier's authorized graphs and the legacy
      // graph is never sticky (the legacy leg is outside routing entirely).
      const legacyGraph = process.env.ARANGO_GRAPH_NAME || 'GRAPH';
      if (stickyPromise) {
        stickyGraphs = await stickyPromise;
      }

      if (mode === 'hybrid') {
        context.mode = mode;
        context.authorized_graph_names = engaged ? [...new Set([legacyGraph, ...authorizedGraphs])] : [];
        const stickyClean = stickyGraphs.filter((g) => authorizedGraphs.includes(g) && g !== legacyGraph);
        if (engaged && stickyClean.length) {
          context.sticky_graph_names = stickyClean;
          logger.info('QueryService.sticky_carrier_attached', { queryId, correlationId, sticky: stickyClean });
        }
      } else if (mode === 'okf_only') {
        // okf_only LITERALLY means OKF only — the legacy free-form corpus is
        // NEVER queried, regardless of engaged (resolved Open Question,
        // 2026-10-06). The exclude_legacy signal enforces it retriever-side.
        context.mode = mode;
        context.authorized_graph_names = engaged ? [...new Set(authorizedGraphs)] : [];
        context.exclude_legacy = true;
        const stickyClean = stickyGraphs.filter((g) => authorizedGraphs.includes(g));
        if (engaged && stickyClean.length) {
          context.sticky_graph_names = stickyClean;
          logger.info('QueryService.sticky_carrier_attached', { queryId, correlationId, sticky: stickyClean });
        }
        if (!engaged) {
          // Structured telemetry for the admin dashboard (NOT surfaced to the
          // user chat).
          logger.warn('QueryService.fanout_warning', {
            queryId,
            correlationId,
            fanout: { warning: 'okf_only_zero_serving', mode, engaged },
            server_warnings: warnings
          });
        }
      } else {
        // legacy (or an unknown mode) — add NOTHING; the payload stays
        // byte-identical to pre-1.1.
        logger.info('QueryService.fanout_carrier_empty_legacy', { queryId, correlationId, mode, engaged });
      }
      return opeaPayload;
    } catch (err) {
      if (err?.statusCode === 401) {
        // BEARER_TOKEN_EXPIRED — the request is invalid; never silently fall
        // back to the legacy path.
        throw err;
      }
      logger.error('QueryService.fanout_carrier_failed_fail_closed', {
        queryId,
        correlationId,
        error: err?.message
      });
      return opeaPayload; // fail-closed: legacy payload (no carrier keys added)
    }
  }

  /**
   * Story 1.3 — load the sticky (conversation-continuity) graph set for a
   * session: the routed graphs persisted on the most recent query of this
   * session that carries one. Single indexed-enough lookup; empty when the
   * conversation has no prior OKF answer (first query → fresh routing only).
   * @param {string} sessionId - The conversation/session id
   * @param {string} queryId - Correlation for logs
   * @returns {Promise<string[]>} Sticky graph names (possibly empty)
   */
  async _loadStickyGraphs(sessionId, queryId) {
    // The most recent query that has PERSISTED a routed set — an EMPTY set
    // counts. Sticky sets must reset when routing moves on: loading "most
    // recent NON-empty" glued a session to a graph that had stopped serving
    // for the rest of the conversation (the authorized-intersection protects
    // against revocation, not against a graph that stopped SERVING while
    // still authorized — review 2026-10-29).
    const cursor = await this.db.query(
      `FOR q IN queries
         FILTER q.sessionId == @sessionId AND q.okfRoutedGraphs != null
         SORT q.timestamp DESC
         LIMIT 1
         RETURN q.okfRoutedGraphs`,
      { sessionId }
    );
    const rows = await cursor.all();
    const sticky = Array.isArray(rows[0]) ? rows[0] : [];
    logger.info('QueryService.sticky_loaded', { queryId, sessionId, sticky_count: sticky.length });
    return sticky;
  }

  /**
   * Story 1.3 — derive the routed-graph set from a finalized answer's source
   * documents: distinct graph_name values, legacy graph excluded (it is
   * always searched anyway and must never stick). Persisted on the query
   * document; the NEXT query in the session reads it as its sticky set.
   * @param {Object} metadata - Finalized metadata (source_documents)
   * @returns {string[]} Distinct OKF graph names (possibly empty)
   */
  _deriveRoutedGraphs(metadata) {
    const legacyGraph = process.env.ARANGO_GRAPH_NAME || 'GRAPH';
    const docs = Array.isArray(metadata?.source_documents) ? metadata.source_documents : [];
    return [...new Set(docs.map((d) => d?.graph_name).filter((g) => typeof g === 'string' && g && g !== legacyGraph))];
  }

  /**
   * Story 1.3 — persist the routed-graph set on a finalized query (ONE
   * helper for all three finalize paths). An EMPTY set is persisted too:
   * that is what lets _loadStickyGraphs reset a session's stickiness when
   * routing moves on (see the load-side note).
   * @param {Object} updateData - The update payload being assembled
   * @param {Object} metadata - Finalized metadata (source_documents)
   * @param {string} queryId - Correlation for logs
   */
  _persistRoutedGraphs(updateData, metadata, queryId) {
    const routedGraphs = this._deriveRoutedGraphs(metadata);
    updateData.okfRoutedGraphs = routedGraphs;
    logger.info('QueryService.sticky_routed_graphs_persisted', { queryId, routedGraphs });
  }

  /**
   * Finalize a streaming query — update DB with response and metadata.
   * @param {string} queryId - The query ID
   * @param {string} responseText - The full accumulated response text
   * @param {number} responseTime - Response time in milliseconds
   * @param {Object} metadata - Metadata object (source_documents, confidence_score)
   */
  async finalizeStreamQuery(queryId, responseText, responseTime, metadata) {
    logger.info('QueryService.finalize_stream_query_start', { queryId });

    const updateData = {
      response: responseText,
      responseTime,
      isAnswered: true,
      metadata
    };
    // Story 1.3 — persist the routed set (empty persists too: it RESETS stickiness).
    this._persistRoutedGraphs(updateData, metadata, queryId);
    await this.queries.update(queryId, updateData);

    // Record analytics
    if (this.analyticsService) {
      try {
        await this.analyticsService.recordQuery(await this.queries.document(queryId));
      } catch (error) {
        logger.error('QueryService.stream_analytics_failed', { queryId, error: error.message });
      }
    }

    logger.info('QueryService.finalize_stream_query_complete', { queryId, responseTime });
  }

  /**
   * Create a new query
   * @param {Object} queryData - Query data
   * @returns {Promise<Object>} The created query
   */
  async createQuery(queryData, headers = null) {
    const startTime = Date.now();
    try {
      logger.info('QueryService.create_query_start');
      logger.info(`[DEBUG] Received full request payload from frontend: ${JSON.stringify(queryData, null, 2)}`);

      const backendMode = process.env.CONTEXT_OPTION || 'conversation-with-context-labels';
      logger.info(`[DEBUG] Backend is configured in "${backendMode}" mode.`);

      logger.info('[DEBUG] Starting validation of incoming data...');
      const missingFields = [];

      if (!queryData.userId) {
        logger.warn('[DEBUG] Validation FAILED: userId is missing.');
        missingFields.push('userId');
      } else {
        logger.info(`[DEBUG] Validation PASSED: userId is present (${queryData.userId}).`);
      }

      if (!queryData.sessionId) {
        logger.warn('[DEBUG] Validation FAILED: sessionId is missing.');
        missingFields.push('sessionId');
      } else {
        logger.info(`[DEBUG] Validation PASSED: sessionId is present (${queryData.sessionId}).`);
      }

      // --- FIX: START messages VALIDATION ---
      if (!Array.isArray(queryData.messages) || queryData.messages.length === 0) {
        // Fallback: Check for the legacy 'text' field
        if (queryData.text) {
          logger.warn('[DEBUG] Validation: messages array is missing. Synthesizing from legacy "text" field.');
          // Create the messages array from the text field
          queryData.messages = [{ role: 'user', content: queryData.text }];
          logger.info(`[DEBUG] Validation PASSED: messages array synthesized with 1 item.`);
        } else {
          // Only fail if BOTH messages and text are missing
          logger.warn(
            '[DEBUG] Validation FAILED: messages array is missing or empty and no legacy "text" field found.'
          );
          missingFields.push('messages');
        }
      } else {
        logger.info(`[DEBUG] Validation PASSED: messages array is present with ${queryData.messages.length} items.`);
      }
      // --- FIX: END messages VALIDATION ---

      // --- FIX: START context VALIDATION ---
      // The SAME normalization the stream path applies: the two paths are
      // one contract, written once.
      queryData.context = this.normalizeQueryContext(queryData.context);
      // --- FIX: END context VALIDATION ---

      if (missingFields.length > 0) {
        const errorMsg = `Missing required query data from frontend. Fields: ${missingFields.join(', ')}`;
        logger.error('QueryService.missing_required_data', { missingFields: missingFields.join(', ') });
        throw new Error(errorMsg);
      }
      logger.info('[DEBUG] All validations passed successfully.');

      // Derive text from the last message for backward compatibility and analytics
      const queryText = pickUserText(queryData.messages, queryData.userQuestion);
      if (!queryText) {
        logger.warn('No extractable text from messages; analytics may be affected.');
      }

      // Resolve the wire's EN labels to the entities they name — the
      // shared policy of both send paths (see resolveMissingScopeIds):
      // only what the request does not already carry, both ids out of
      // ONE call.
      const { categoryId, serviceIds } = await this.resolveMissingScopeIds(queryData);

      const basicQueryDoc = {
        userId: queryData.userId,
        sessionId: queryData.sessionId,
        timestamp: queryData.timestamp || new Date().toISOString(),
        isAnswered: false, // Will be updated after response
        categoryId: categoryId,
        serviceId: serviceIds.length > 0 ? serviceIds : null, // Store as array or null
        responseTime: 0, // Will be updated after response
        contextOption: backendMode,
        messages: queryData.messages,
        context: queryData.context,
        text: queryText
      };

      logger.debug('QueryService.saving_query_document', { basicQueryDoc });
      const query = await this.queries.save(basicQueryDoc);
      const queryId = query._key;
      logger.info('QueryService.query_created', { queryId });

      let opeaResponseContent = null;
      let opeaMetadata = null;
      let opeaResponseTime = 0;
      const opeaStartTime = Date.now();

      // *** START: TEST MODE LOGIC ***
      if (backendMode === 'test-mode') {
        logger.info('[DEBUG] TEST MODE ACTIVATED. Bypassing OPEA call.');
        const mockData = this.getMockOpeaResponse(queryData);
        opeaResponseContent = mockData.response;
        opeaMetadata = mockData.metadata;
        opeaResponseTime = Date.now() - opeaStartTime + Math.floor(Math.random() * 200); // Simulate network delay

        logger.info(`[DEBUG] Mock response generated in ${opeaResponseTime}ms.`);
        logger.info(`[DEBUG] Mock Response Content: ${opeaResponseContent}`);
        logger.info(`[DEBUG] Mock Metadata: ${JSON.stringify(opeaMetadata, null, 2)}`);

        const updateData = {
          response: opeaResponseContent,
          responseTime: opeaResponseTime,
          isAnswered: true,
          metadata: opeaMetadata
        };
        // Story 1.3 — sticky persistence (empty persists too: RESETS stickiness).
        this._persistRoutedGraphs(updateData, opeaMetadata, queryId);
        await this.queries.update(queryId, updateData);
      } else {
        // *** EXISTING OPEA CALL LOGIC (NOW USING WORKER THREAD) ***
        const opeaUrl = opeaChatQnaUrl();

        let opeaPayload;
        if (backendMode === 'single-message') {
          logger.info('[DEBUG] Backend mode is "single-message". Extracting last message for OPEA.');
          const lastMessage = queryData.messages[queryData.messages.length - 1];
          const queryText = lastMessage ? lastMessage.content : '';

          if (!queryText) {
            throw new Error('Could not extract last message content for single-message mode.');
          }

          opeaPayload = {
            messages: queryText,
            stream: false,
            context: {
              language: pickLanguage(queryData.context)
            }
          };
        } else {
          logger.info('[DEBUG] Backend mode is "conversation-with-labels". Formatting payload with full context.');
          opeaPayload = {
            messages: queryData.messages,
            context: {
              categoryLabel: queryData.context.categoryLabel,
              // Same rule as the stream path: the plural spelling rides
              // along when the caller used it.
              categoryLabels: queryData.context.categoryLabels,
              serviceLabels: queryData.context.serviceLabels,
              language: pickLanguage(queryData.context)
            },
            stream: false
          };
        }

        // Story 1.1 — attach the fan-out carrier exactly as the stream path
        // does (initStreamQuery): okf_only must not leak into the legacy
        // corpus and hybrid must fan out on this route too. Same 401
        // propagation / no-bearer-skip / fail-closed semantics.
        await this._attachFanoutCarrier(opeaPayload, headers, queryId, queryData.sessionId);

        logger.info('[DEBUG] Sending request to OPEA via Worker Thread...');
        logger.info(`[DEBUG] OPEA Payload: ${JSON.stringify(opeaPayload, null, 2)}`);

        // Inject traceparent from active OTel context so OPEA services join the distributed trace
        const traceHeaders = {};
        api.propagation.inject(api.context.active(), traceHeaders);
        const workerHeaders = { ...headers, ...traceHeaders };

        // *** CHANGED: Use Worker Thread for OPEA Call ***
        const workerResult = await this.runOPEAWorker(opeaUrl, opeaPayload, workerHeaders);

        opeaResponseTime = workerResult.responseTime;
        opeaResponseContent = workerResult.response;
        opeaMetadata = workerResult.metadata;

        logger.info(`[DEBUG] Worker thread returned result in ${opeaResponseTime}ms.`);
        logger.info(`[DEBUG] OPEA Response Content: ${opeaResponseContent}`);
        logger.info(`[DEBUG] OPEA Metadata: ${JSON.stringify(opeaMetadata, null, 2)}`);

        const updateData = {
          response: opeaResponseContent,
          responseTime: opeaResponseTime,
          isAnswered: true,
          metadata: opeaMetadata
        };
        // Story 1.3 — sticky persistence (empty persists too: RESETS stickiness).
        this._persistRoutedGraphs(updateData, opeaMetadata, queryId);
        await this.queries.update(queryId, updateData);
      }

      // Record the query in analytics
      if (this.analyticsService) {
        await this.analyticsService.recordQuery(await this.queries.document(queryId));
      }

      const totalDuration = Date.now() - startTime;
      logger.info('QueryService.create_query_complete', {
        queryId,
        mode: backendMode,
        responseTime: opeaResponseTime,
        totalDuration
      });

      return {
        queryId,
        response: opeaResponseContent,
        metadata: opeaMetadata,
        responseTime: opeaResponseTime
      };
    } catch (error) {
      const totalDuration = Date.now() - startTime;
      logger.error('QueryService.create_query_failed', {
        error: error.message,
        stack: error.stack,
        durationMs: totalDuration
      });
      throw error;
    }
  }

  /**
   * Add feedback to a query
   * @param {String} queryId - Query ID
   * @param {Object} feedback - Feedback data
   * @returns {Promise<Object>} The updated query
   */
  async addFeedback(queryId, feedback) {
    const startTime = Date.now();
    try {
      logger.info('QueryService.add_feedback_start', { queryId });

      // Ensure feedback has required fields
      if (feedback.rating === undefined) {
        logger.warn('QueryService.feedback_rating_required', { queryId });
        throw new Error('Feedback rating is required');
      }

      // Prepare feedback object
      const userFeedback = {
        rating: feedback.rating,
        comment: feedback.comment || '',
        providedAt: new Date().toISOString()
      };

      // Update the query with feedback
      const updatedQuery = await this.queries.update(
        queryId,
        {
          userFeedback
        },
        { returnNew: true }
      );

      // Update analytics if service is set
      if (this.analyticsService) {
        try {
          await this.analyticsService.recordFeedback(queryId, userFeedback);
          logger.info('QueryService.analytics_feedback_updated', { queryId });
        } catch (error) {
          logger.error('QueryService.update_analytics_feedback_failed', {
            queryId,
            error: error.message
          });
          // Continue even if analytics update fails
        }
      }

      logger.info('QueryService.feedback_added', {
        queryId,
        durationMs: Date.now() - startTime
      });
      return updatedQuery.new;
    } catch (error) {
      logger.error('QueryService.add_feedback_failed', {
        queryId,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Get a query by ID
   * @param {String} queryId - Query ID
   * @returns {Promise<Object>} The query
   */
  async getQuery(queryId) {
    const startTime = Date.now();
    try {
      logger.info('QueryService.get_query_start', { queryId });
      const query = await this.queries.document(queryId);
      logger.info('QueryService.query_retrieved', {
        queryId,
        durationMs: Date.now() - startTime
      });
      return query;
    } catch (error) {
      logger.error('QueryService.get_query_failed', {
        queryId,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Mark a query as answered
   * @param {String} queryId - Query ID
   * @param {Number} responseTime - Response time in milliseconds
   * @returns {Promise<Object>} The updated query
   */
  async markAsAnswered(queryId, responseTime = 0) {
    const startTime = Date.now();
    try {
      logger.info('QueryService.mark_as_answered_start', { queryId, responseTime });
      const updatedQuery = await this.queries.update(
        queryId,
        {
          isAnswered: true,
          responseTime
        },
        { returnNew: true }
      );

      logger.info('QueryService.query_marked_answered', {
        queryId,
        durationMs: Date.now() - startTime
      });
      return updatedQuery.new;
    } catch (error) {
      logger.error('QueryService.mark_as_answered_failed', {
        queryId,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Update the response time for a query
   * @param {String} queryId - Query ID
   * @param {Number} responseTime - Response time in milliseconds
   * @returns {Promise<Object>} The updated query
   */
  async updateQueryResponseTime(queryId, responseTime) {
    const startTime = Date.now();
    try {
      logger.info('QueryService.update_query_response_time_start', { queryId, responseTime });

      // Validate responseTime
      if (typeof responseTime !== 'number' || responseTime < 0) {
        logger.warn('QueryService.invalid_response_time', { queryId, responseTime });
        throw new Error('Invalid response time');
      }

      // Update the query with response time
      const updatedQuery = await this.queries.update(
        queryId,
        {
          responseTime,
          updatedAt: new Date().toISOString()
        },
        { returnNew: true }
      );

      logger.info('QueryService.query_response_time_updated', {
        queryId,
        durationMs: Date.now() - startTime
      });
      return updatedQuery.new;
    } catch (error) {
      logger.error('QueryService.update_query_response_time_failed', {
        queryId,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Set query category and service
   * @param {String} queryId - Query ID
   * @param {String} categoryId - Category ID
   * @param {String} serviceId - Service ID (optional)
   * @returns {Promise<Object>} The updated query
   */
  async setQueryCategory(queryId, categoryId, serviceId = null) {
    const startTime = Date.now();
    try {
      logger.info('QueryService.set_query_category_start', { queryId, categoryId, serviceId });

      // Update the query with category and service
      const updateData = { categoryId };
      if (serviceId) {
        updateData.serviceId = serviceId;
      }

      const updatedQuery = await this.queries.update(queryId, updateData, { returnNew: true });

      // Update or create edge between query and category
      try {
        const edgeCursor = await this.db.query(aql`
          FOR edge IN queryCategories
            FILTER edge._from == ${'queries/' + queryId}
            RETURN edge
        `);

        const existingEdge = await edgeCursor.next();

        if (existingEdge) {
          logger.debug('QueryService.updating_query_category_edge', { queryId });
          await this.db.collection('queryCategories').update(existingEdge._key, {
            _to: `serviceCategories/${categoryId}`,
            updatedAt: new Date().toISOString()
          });
        } else {
          logger.debug('QueryService.creating_query_category_edge', { queryId });
          await this.db.collection('queryCategories').save({
            _from: `queries/${queryId}`,
            _to: `serviceCategories/${categoryId}`,
            createdAt: new Date().toISOString()
          });
        }
      } catch (error) {
        logger.error('QueryService.update_query_category_edge_failed', {
          queryId,
          error: error.message
        });
        // Continue even if edge update fails
      }

      logger.info('QueryService.category_set', {
        queryId,
        durationMs: Date.now() - startTime
      });
      return updatedQuery.new;
    } catch (error) {
      logger.error('QueryService.set_query_category_failed', {
        queryId,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Search for queries based on criteria
   * @param {Object} criteria - Search criteria
   * @param {Number} limit - Maximum number of results (default: 20)
   * @param {Number} offset - Offset for pagination (default: 0)
   * @returns {Promise<Object>} Search results
   */
  async searchQueries(criteria, limit = 20, offset = 0) {
    const startTime = Date.now();
    try {
      logger.info('QueryService.search_queries_start', { criteria, limit, offset });

      const filterConditions = [];

      if (criteria.userId) {
        filterConditions.push(aql`q.userId == ${criteria.userId}`);
      }

      if (criteria.sessionId) {
        filterConditions.push(aql`q.sessionId == ${criteria.sessionId}`);
      }

      if (criteria.text) {
        filterConditions.push(aql`LOWER(q.text) LIKE CONCAT("%", LOWER(${criteria.text}), "%")`);
      }

      if (criteria.categoryId) {
        filterConditions.push(aql`q.categoryId == ${criteria.categoryId}`);
      }

      if (criteria.serviceId) {
        filterConditions.push(aql`q.serviceId == ${criteria.serviceId}`);
      }

      if (criteria.isAnswered !== undefined) {
        filterConditions.push(aql`q.isAnswered == ${criteria.isAnswered}`);
      }

      if (criteria.startDate) {
        filterConditions.push(aql`q.timestamp >= ${criteria.startDate}`);
      }

      if (criteria.endDate) {
        filterConditions.push(aql`q.timestamp <= ${criteria.endDate}`);
      }

      if (criteria.hasFeedback !== undefined) {
        if (criteria.hasFeedback) {
          filterConditions.push(aql`q.userFeedback != null`);
        } else {
          filterConditions.push(aql`q.userFeedback == null`);
        }
      }

      if (criteria.minRating !== undefined) {
        filterConditions.push(aql`q.userFeedback.rating >= ${criteria.minRating}`);
      }

      if (criteria.maxRating !== undefined) {
        filterConditions.push(aql`q.userFeedback.rating <= ${criteria.maxRating}`);
      }

      if (criteria.tags && criteria.tags.length > 0) {
        filterConditions.push(aql`
          LENGTH(
            FOR tag IN ${criteria.tags}
              FILTER tag IN q.metadata.tags
              RETURN tag
          ) == LENGTH(${criteria.tags})
        `);
      }

      let filterQuery;
      if (filterConditions.length > 0) {
        filterQuery = aql`FILTER `;
        for (let i = 0; i < filterConditions.length; i++) {
          if (i > 0) {
            filterQuery = aql`${filterQuery} AND `;
          }
          filterQuery = aql`${filterQuery} ${filterConditions[i]}`;
        }
      } else {
        filterQuery = aql``;
      }

      const query = aql`
        FOR q IN queries
          ${filterQuery}
          SORT q.timestamp DESC
          LIMIT ${offset}, ${limit}
          RETURN q
      `;

      const cursor = await this.db.query(query);
      const queries = await cursor.all();

      const countQuery = aql`
        FOR q IN queries
          ${filterQuery}
          COLLECT WITH COUNT INTO total
          RETURN total
      `;
      const countCursor = await this.db.query(countQuery);
      const totalCount = (await countCursor.next()) || 0;

      logger.info('QueryService.search_queries_completed', {
        resultCount: queries.length,
        totalCount,
        durationMs: Date.now() - startTime
      });
      return {
        queries,
        pagination: {
          total: totalCount,
          limit,
          offset,
          pages: Math.ceil(totalCount / limit),
          currentPage: Math.floor(offset / limit) + 1
        }
      };
    } catch (error) {
      logger.error('QueryService.search_queries_failed', {
        criteria,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Delete a query
   * @param {String} queryId - Query ID
   * @returns {Promise<Object>} Deletion result
   */
  async deleteQuery(queryId) {
    const startTime = Date.now();
    try {
      logger.info('QueryService.delete_query_start', { queryId });

      // Delete edges connected to the query
      try {
        await this.db.query(aql`
          FOR edge IN sessionQueries
            FILTER edge._to == ${'queries/' + queryId}
            REMOVE edge IN sessionQueries
        `);

        await this.db.query(aql`
          FOR edge IN queryCategories
            FILTER edge._from == ${'queries/' + queryId}
            REMOVE edge IN queryCategories
        `);
        logger.info('QueryService.edges_deleted', { queryId });
      } catch (error) {
        logger.error('QueryService.delete_edges_failed', {
          queryId,
          error: error.message
        });
        // Continue even if edge deletion fails
      }

      const result = await this.queries.remove(queryId);
      logger.info('QueryService.query_deleted', {
        queryId,
        durationMs: Date.now() - startTime
      });
      return result;
    } catch (error) {
      logger.error('QueryService.delete_query_failed', {
        queryId,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Get similar queries
   * @param {String} queryText - Query text to find similar queries
   * @param {Number} limit - Maximum number of similar queries to return
   * @returns {Promise<Array>} Similar queries
   */
  async getSimilarQueries(queryText, limit = 5) {
    const startTime = Date.now();
    try {
      logger.info('QueryService.get_similar_queries_start', { queryText });

      const lowerQueryText = queryText.toLowerCase();
      const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'with', 'by'];
      const words = lowerQueryText.split(/\s+/).filter((word) => word.length > 2 && !stopWords.includes(word));

      if (words.length === 0) {
        logger.info('QueryService.no_significant_words', { queryText });
        return [];
      }

      const similarQueriesQuery = aql`
        FOR q IN queries
          LET score = (
            FOR word IN ${words}
              FILTER LOWER(q.text) LIKE CONCAT("%", word, "%")
              RETURN 1
          )
          FILTER LENGTH(score) > 0
          SORT LENGTH(score) DESC, q.timestamp DESC
          LIMIT ${limit}
          RETURN q
      `;

      const cursor = await this.db.query(similarQueriesQuery);
      const similarQueries = await cursor.all();
      logger.info('QueryService.similar_queries_found', {
        count: similarQueries.length,
        durationMs: Date.now() - startTime
      });
      return similarQueries;
    } catch (error) {
      logger.error('QueryService.get_similar_queries_failed', {
        queryText,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      return [];
    }
  }

  /**
   * Save a query with its criteria for future recall
   * @param {Object} queryData - Query data with criteria
   * @returns {Promise<Object>} The saved query
   */
  async saveQueryWithCriteria(queryData) {
    const startTime = Date.now();
    try {
      logger.info('QueryService.save_query_with_criteria_start', { dataLength: JSON.stringify(queryData).length });

      if (!queryData.userId || !queryData.text) {
        logger.warn('QueryService.missing_required_data', { queryData });
        throw new Error('Missing required query data');
      }

      const basicQueryDoc = {
        userId: queryData.userId,
        text: queryData.text,
        timestamp: queryData.timestamp || new Date().toISOString()
      };

      if (queryData.categoryId) basicQueryDoc.categoryId = queryData.categoryId;
      if (queryData.serviceId) basicQueryDoc.serviceId = queryData.serviceId;

      basicQueryDoc.metadata = {
        criteria: queryData.criteria || '',
        tags: Array.isArray(queryData.tags) ? queryData.tags : [],
        isSaved: true,
        name: queryData.name || `Query ${new Date().toISOString()}`,
        description: queryData.description || ''
      };

      logger.debug('QueryService.saving_query_with_criteria', { basicQueryDoc });
      const query = await this.queries.save(basicQueryDoc);
      logger.info('QueryService.query_saved', {
        queryId: query._key,
        durationMs: Date.now() - startTime
      });

      return query;
    } catch (error) {
      logger.error('QueryService.save_query_with_criteria_failed', {
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Get saved queries for a user
   * @param {String} userId - User ID
   * @param {Number} limit - Maximum number of queries to return
   * @param {Number} offset - Offset for pagination
   * @returns {Promise<Object>} Saved queries with pagination
   */
  async getSavedQueries(userId, limit = 20, offset = 0) {
    const startTime = Date.now();
    try {
      logger.info('QueryService.get_saved_queries_start', { userId });

      const query = aql`
        FOR q IN queries
          FILTER q.userId == ${userId}
          FILTER q.metadata.isSaved == true
          SORT q.timestamp DESC
          LIMIT ${offset}, ${limit}
          RETURN q
      `;

      const cursor = await this.db.query(query);
      const queries = await cursor.all();

      const countQuery = aql`
        FOR q IN queries
          FILTER q.userId == ${userId}
          FILTER q.metadata.isSaved == true
          COLLECT WITH COUNT INTO total
          RETURN total
      `;
      const countCursor = await this.db.query(countQuery);
      const totalCount = (await countCursor.next()) || 0;

      logger.info('QueryService.saved_queries_retrieved', {
        userId,
        count: queries.length,
        totalCount,
        durationMs: Date.now() - startTime
      });
      return {
        queries,
        pagination: {
          total: totalCount,
          limit,
          offset,
          pages: Math.ceil(totalCount / limit),
          currentPage: Math.floor(offset / limit) + 1
        }
      };
    } catch (error) {
      logger.error('QueryService.get_saved_queries_failed', {
        userId,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Get query recommendations based on user history
   * @param {String} userId - User ID
   * @param {Number} limit - Maximum number of recommendations
   * @returns {Promise<Array>} Recommended queries
   */
  async getQueryRecommendations(userId, limit = 5) {
    const startTime = Date.now();
    try {
      logger.info('QueryService.get_query_recommendations_start', { userId });

      const recentQueriesQuery = aql`
        FOR q IN queries
          FILTER q.userId == ${userId}
          SORT q.timestamp DESC
          LIMIT 10
          RETURN q
      `;

      const recentQueriesCursor = await this.db.query(recentQueriesQuery);
      const recentQueries = await recentQueriesCursor.all();

      if (recentQueries.length === 0) {
        logger.info('QueryService.no_recent_queries', { userId });
        const popularQueries = await this.getPopularQueries(limit);
        return popularQueries.map((q) => q.text);
      }

      const categories = recentQueries.filter((q) => q.categoryId).map((q) => q.categoryId);

      const services = recentQueries.filter((q) => q.serviceId).map((q) => q.serviceId);

      if (categories.length === 0 && services.length === 0) {
        logger.info('QueryService.no_categories_or_services', { userId });
        const popularQueries = await this.getPopularQueries(limit);
        return popularQueries.map((q) => q.text);
      }

      const recommendationsQuery = aql`
        LET categorySimilar = (
          FOR q IN queries
            FILTER q.userId != ${userId}
            FILTER q.categoryId IN ${categories}
            SORT q.timestamp DESC
            LIMIT ${limit * 2}
            RETURN DISTINCT q.text
        )
        
        LET serviceSimilar = (
          FOR q IN queries
            FILTER q.userId != ${userId}
            FILTER q.serviceId IN ${services}
            SORT q.timestamp DESC
            LIMIT ${limit * 2}
            RETURN DISTINCT q.text
        )
        
        LET combined = UNION(categorySimilar, serviceSimilar)
        
        FOR text IN combined
          SORT RAND()
          LIMIT ${limit}
          RETURN text
      `;

      const recommendationsCursor = await this.db.query(recommendationsQuery);
      const recommendations = await recommendationsCursor.all();

      if (recommendations.length < limit) {
        logger.info('QueryService.insufficient_recommendations', {
          count: recommendations.length,
          limit
        });
        const popularQueries = await this.getPopularQueries(limit - recommendations.length);
        return [...recommendations, ...popularQueries.map((q) => q.text)];
      }

      logger.info('QueryService.query_recommendations_found', {
        userId,
        count: recommendations.length,
        durationMs: Date.now() - startTime
      });
      return recommendations;
    } catch (error) {
      logger.error('QueryService.get_query_recommendations_failed', {
        userId,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      return await this.getPopularQueries(limit).then((queries) => queries.map((q) => q.text));
    }
  }

  /**
   * Get popular queries
   * @param {Number} limit - Maximum number of queries to return
   * @returns {Promise<Array>} Popular queries
   */
  async getPopularQueries(limit = 5) {
    const startTime = Date.now();
    try {
      logger.info('QueryService.get_popular_queries_start');
      const query = aql`
        FOR q IN queries
          COLLECT text = q.text WITH COUNT INTO count
          SORT count DESC
          LIMIT ${limit}
          RETURN { text, count }
      `;

      const cursor = await this.db.query(query);
      const popularQueries = await cursor.all();
      logger.info('QueryService.popular_queries_found', {
        count: popularQueries.length,
        durationMs: Date.now() - startTime
      });
      return popularQueries;
    } catch (error) {
      logger.error('QueryService.get_popular_queries_failed', {
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      return [];
    }
  }

  /**
   * Create a conversation from a query
   * @param {String} queryId - Query ID
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Created conversation data
   */
  async createConversationFromQuery(queryId, options = {}) {
    const startTime = Date.now();
    try {
      logger.info('QueryService.create_conversation_from_query_start', { queryId });

      if (!this.chatHistoryService) {
        logger.error('QueryService.chat_history_service_not_set');
        throw new Error('Chat history service is not set');
      }

      const query = await this.getQuery(queryId);

      if (!query) {
        logger.warn('QueryService.query_not_found', { queryId });
        throw new NotFoundError('Query not found');
      }

      const conversation = await this.chatHistoryService.createConversationFromQuery(queryId, query.userId, {
        title: options.title || query.text,
        responseText: options.responseText,
        tags: options.tags || []
      });

      logger.info('QueryService.conversation_created', {
        queryId,
        conversationId: conversation.conversation._key,
        durationMs: Date.now() - startTime
      });
      return conversation;
    } catch (error) {
      logger.error('QueryService.create_conversation_from_query_failed', {
        queryId,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Get conversations for a query
   * @param {String} queryId - Query ID
   * @returns {Promise<Array>} Conversations associated with the query
   */
  async getConversationsForQuery(queryId, userId) {
    const startTime = Date.now();
    try {
      logger.info('QueryService.get_conversations_for_query_start', { queryId });

      if (!this.chatHistoryService) {
        logger.error('QueryService.chat_history_service_not_set');
        throw new Error('Chat history service is not set');
      }

      const relatedMessages = await this.chatHistoryService.findMessagesForQuery(queryId, userId);

      // Handle ownership check returns
      if (relatedMessages === null) {
        return []; // Query not found
      }
      if (relatedMessages && relatedMessages.forbidden) {
        throw new Error('Access denied');
      }

      const conversationMap = new Map();
      for (const item of relatedMessages) {
        if (item.conversation && !conversationMap.has(item.conversation._key)) {
          conversationMap.set(item.conversation._key, {
            conversation: item.conversation,
            messages: []
          });
        }

        if (item.message) {
          const conversation = conversationMap.get(item.conversation._key);
          if (conversation) {
            conversation.messages.push(item.message);
          }
        }
      }

      const conversations = Array.from(conversationMap.values());
      logger.info('QueryService.conversations_found', {
        queryId,
        count: conversations.length,
        durationMs: Date.now() - startTime
      });
      return conversations;
    } catch (error) {
      logger.error('QueryService.get_conversations_for_query_failed', {
        queryId,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Mark a query as answered
   * @param {String} queryId - Query ID
   * @param {Number} responseTime - Response time in milliseconds
   * @returns {Promise<Object>} Updated query
   */
  async markQueryAsAnswered(queryId, responseTime) {
    const startTime = Date.now();
    try {
      if (!queryId || queryId === 'undefined') {
        logger.warn('QueryService.mark_query_as_answered_invalid_id', { queryId });
        throw new Error('Invalid query ID provided');
      }

      logger.info('QueryService.mark_query_as_answered_start', { queryId, responseTime });

      const updateData = {
        isAnswered: true,
        responseTime,
        updatedAt: new Date().toISOString()
      };

      const updatedQuery = await this.queries.update(queryId, updateData);

      logger.info('QueryService.query_marked_as_answered', {
        queryId,
        responseTime,
        durationMs: Date.now() - startTime
      });

      return updatedQuery;
    } catch (error) {
      logger.error('QueryService.mark_query_as_answered_failed', {
        queryId,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });

      if (error.name === 'ArangoError' && error.errorNum === 1202) {
        throw new NotFoundError('Query not found');
      }

      throw error;
    }
  }

  /**
   * Link query to an existing conversation message
   * @param {String} queryId - Query ID
   * @param {String} messageId - Message ID
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Link details
   */
  async linkQueryToMessage(queryId, messageId, options = {}) {
    const startTime = Date.now();
    try {
      logger.info('QueryService.link_query_to_message_start', { queryId, messageId });

      if (!this.chatHistoryService) {
        logger.error('QueryService.chat_history_service_not_set');
        throw new Error('Chat history service is not set');
      }

      const messageCursor = await this.db.query(
        `
      FOR msg IN messages
        FILTER msg._key == @messageId
        RETURN {
          _key: msg._key,
          conversationId: msg.conversationId
        }
    `,
        { messageId }
      );

      const message = await messageCursor.next();

      if (!message) {
        logger.warn('QueryService.message_not_found', { messageId });
        throw new NotFoundError('Message not found');
      }

      const link = await this.chatHistoryService.linkQueryToConversation(queryId, message.conversationId, messageId, {
        responseType: options.responseType || 'primary',
        confidenceScore: options.confidenceScore || 1.0
      });

      logger.info('QueryService.query_linked_to_message', {
        queryId,
        messageId,
        conversationId: message.conversationId,
        durationMs: Date.now() - startTime
      });
      return link;
    } catch (error) {
      logger.error('QueryService.link_query_to_message_failed', {
        queryId,
        messageId,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }

  async getQueriesForInspector(options = {}) {
    const startTime = Date.now();
    try {
      const limit = parsePositiveInt(options.limit, 50, { min: 1, max: 100 });
      const offset = parsePositiveInt(options.offset, 0, { min: 0 });

      logger.info('QueryService.get_queries_for_inspector_start', { options });

      const filterConditions = [];

      if (options.userId) {
        filterConditions.push(aql`q.userId == ${options.userId}`);
      }

      if (options.startDate) {
        const startDate = new Date(options.startDate);
        if (!isNaN(startDate.getTime())) {
          filterConditions.push(aql`q.timestamp >= ${startDate.toISOString()}`);
        }
      }

      if (options.endDate) {
        const endDate = new Date(options.endDate);
        if (!isNaN(endDate.getTime())) {
          filterConditions.push(aql`q.timestamp <= ${endDate.toISOString()}`);
        }
      }

      if (options.minConfidence !== undefined && options.minConfidence !== '') {
        const minConf = parseFloat(options.minConfidence);
        if (!isNaN(minConf)) {
          filterConditions.push(aql`q.metadata.confidence_score >= ${minConf}`);
        }
      }

      if (options.maxConfidence !== undefined && options.maxConfidence !== '') {
        const maxConf = parseFloat(options.maxConfidence);
        if (!isNaN(maxConf)) {
          filterConditions.push(aql`q.metadata.confidence_score <= ${maxConf}`);
        }
      }

      if (options.searchText) {
        filterConditions.push(aql`LOWER(q.text) LIKE CONCAT("%", LOWER(${options.searchText}), "%")`);
      }

      filterConditions.push(aql`q.isAnswered == true`);

      let filterQuery;
      if (filterConditions.length > 0) {
        filterQuery = aql`FILTER `;
        for (let i = 0; i < filterConditions.length; i++) {
          if (i > 0) {
            filterQuery = aql`${filterQuery} AND `;
          }
          filterQuery = aql`${filterQuery} ${filterConditions[i]}`;
        }
      } else {
        filterQuery = aql``;
      }

      const query = aql`
        FOR q IN queries
          ${filterQuery}
          SORT q.timestamp DESC
          LIMIT ${offset}, ${limit}
          RETURN {
            _key: q._key,
            userId: q.userId,
            timestamp: q.timestamp,
            text: q.text,
            response: q.response,
            responseTime: q.responseTime,
            context: q.context,
            metadata: q.metadata,
            userFeedback: q.userFeedback,
            contextOption: q.contextOption
          }
      `;

      const cursor = await this.db.query(query);
      const queries = await cursor.all();

      const countQuery = aql`
        FOR q IN queries
          ${filterQuery}
          COLLECT WITH COUNT INTO total
          RETURN total
      `;
      const countCursor = await this.db.query(countQuery);
      const totalCount = (await countCursor.next()) || 0;

      logger.info('QueryService.get_queries_for_inspector_complete', {
        resultCount: queries.length,
        totalCount,
        durationMs: Date.now() - startTime
      });

      return {
        success: true,
        data: {
          queries,
          pagination: {
            total: totalCount,
            limit,
            offset,
            pages: Math.ceil(totalCount / limit),
            currentPage: Math.floor(offset / limit) + 1
          }
        }
      };
    } catch (error) {
      logger.error('QueryService.get_queries_for_inspector_failed', {
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }

  async getQueryInspectorDetails(queryId) {
    const startTime = Date.now();
    try {
      logger.info('QueryService.get_query_inspector_details_start', { queryId });

      const queryDoc = await this.queries.document(queryId);

      let userName = null;
      if (queryDoc.userId) {
        try {
          const userCursor = await this.db.query(aql`
            FOR u IN users
              FILTER u._key == ${queryDoc.userId}
              RETURN { fullName: u.fullName, email: u.email }
          `);
          const user = await userCursor.next();
          if (user) {
            userName = user.fullName || user.email;
          }
        } catch (e) {
          logger.warn('QueryService.user_lookup_failed', { userId: queryDoc.userId, error: e.message });
        }
      }

      logger.info('QueryService.get_query_inspector_details_complete', {
        queryId,
        durationMs: Date.now() - startTime
      });

      return {
        success: true,
        data: {
          ...queryDoc,
          userName
        }
      };
    } catch (error) {
      logger.error('QueryService.get_query_inspector_details_failed', {
        queryId,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }
}

// Singleton instance
const instance = new QueryService();
module.exports = instance;
// Attached for unit-test access. Pure helper, no instance state — safe to expose
// on the singleton object; do not refactor into a class method without also
// updating the unit tests (query-service.test.js: pickUserText suite).
module.exports.pickUserText = pickUserText;
