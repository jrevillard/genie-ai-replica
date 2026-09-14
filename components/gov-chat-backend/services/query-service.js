require('dotenv').config();
const { aql } = require('arangojs');
const { logger, dbService } = require('../shared-lib');
const { Worker } = require('worker_threads');
const path = require('path');
const { NotFoundError } = require('../middleware/errors');
const api = require('@opentelemetry/api');
const { parsePositiveInt } = require('../shared-lib/validation-utils');
const axios = require('axios');
const translationService = require('./translation-service');

/**
 * Weather-aware farmer advisor (PolisenseAI).
 *
 * Every chat message is answered by OPEA ChatQnA (knowledge-base RAG). When
 * WEATHER_ENABLED=true the backend first asks weather-mcp-service for the
 * curated context block for the farmer's district — today's date and season
 * position, the 7-day forecast, the stored crop risk, the Copernicus seasonal
 * outlook, drought and flood assessments, official warnings — and prepends it
 * to the question. The chat LLM reasons over that block and the retrieved
 * documents together; no keyword routing decides which source answers.
 *
 * The only messages that bypass the LLM are commands that launch a satellite
 * job or return an artefact (field delineation, flood mapping, the national
 * bulletin images). Those still go to weather-mcp-service /query.
 */
// Geo-inference (SAM / Prithvi on satellite imagery) takes minutes; forecasts take seconds.
const GEO_KEYWORDS = [
  'delineat',
  'field boundar',
  'farm boundar',
  'flood detection',
  'flood map',
  'flood extent',
  'satellite flood',
  'inundation',
  'prithvi'
];

// Bengali script and romanised ("Banglish") phrasings of the same commands.
// Matched on the user's original text, so routing does not depend on the
// translator producing the English stems above. Bengali entries are substrings
// (no word boundaries in the script); Banglish entries are word-start stems.
const DELINEATE_KEYWORDS_BN = [
  'জমির সীমানা',
  'জমি সীমানা',
  'ক্ষেতের সীমানা',
  'খেতের সীমানা',
  'মাঠের সীমানা',
  'প্লট সীমানা',
  'সীমানা নির্ধারণ',
  'জমির মানচিত্র',
  'ক্ষেতের মানচিত্র',
  'খেতের মানচিত্র',
  'জমির ম্যাপ',
  'ক্ষেতের ম্যাপ',
  'খেতের ম্যাপ',
  'জমি চিহ্নিত'
];
const FLOOD_KEYWORDS_BN = [
  'বন্যার মানচিত্র',
  'বন্যা মানচিত্র',
  'বন্যার ম্যাপ',
  'বন্যা ম্যাপ',
  'বন্যার বিস্তার',
  'বন্যা শনাক্ত',
  'স্যাটেলাইট বন্যা',
  'প্লাবিত এলাকা',
  'জলমগ্ন এলাকা'
];
const BULLETIN_KEYWORDS_BN = ['বুলেটিন'];
const DELINEATE_KEYWORDS_BANGLISH = [
  'jomir simana',
  'jomir shimana',
  'jomi simana',
  'jomi shimana',
  'kheter simana',
  'kheter shimana',
  'khet simana',
  'plot simana',
  'simana nirdharon',
  'jomir map',
  'jomir manchitro',
  'kheter map',
  'khet map'
];
const FLOOD_KEYWORDS_BANGLISH = [
  'bonnar map',
  'bonna map',
  'bonnar manchitro',
  'bonna manchitro',
  'bonnar bistar',
  'satellite bonna',
  'plabito elaka',
  'jolmogno',
  'jolomogno'
];
const BULLETIN_KEYWORDS_BANGLISH = ['abohawa bulletin', 'krishi bulletin'];

// English stems split by command kind (GEO_KEYWORDS keeps the combined list for
// callers that only need "is this a satellite job").
const DELINEATE_KEYWORDS_EN = ['delineat', 'field boundar', 'farm boundar'];
const FLOOD_KEYWORDS_EN = ['flood detection', 'flood map', 'flood extent', 'satellite flood', 'inundation', 'prithvi'];

// Bengali (Bangla) script block. The weather/geo keyword lists are English, and
// the weather agent's intent extractor resolves English district names, so a
// Bengali message is translated to English once (Redis-cached) and that text is
// used for routing and for the MCP call. The user's own text is untouched.
const BENGALI_RE = /[\u0980-\u09ff]/;

/**
 * Resolve the text to route on. Returns { text, sourceLang }: `text` is English
 * when the message was Bengali and translation succeeded, otherwise the
 * original message; `sourceLang` is 'bn' or 'en'.
 */
async function resolveRoutingText(message) {
  const original = message || '';
  if (!BENGALI_RE.test(original)) return { text: original, sourceLang: 'en' };
  try {
    await translationService.init();
    const english = (await translationService.translateMarkdown(original, 'bn', 'en')) || '';
    const text = english.trim();
    if (text) {
      logger.info(`[WEATHER] Bengali message translated for routing: "${text.slice(0, 120)}"`);
      return { text, sourceLang: 'bn' };
    }
  } catch (err) {
    logger.warn(`[WEATHER] Bengali->English routing translation failed: ${err.message}`);
  }
  return { text: original, sourceLang: 'bn' };
}

/**
 * Text of the most recent user turn. The web client sends the streaming
 * assistant placeholder ({ role: 'assistant', content: '' }) as the last
 * element, so the array tail cannot be used as the query text.
 */
function lastUserMessageText(messages) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'user' && typeof m.content === 'string' && m.content.trim()) {
      return m.content;
    }
  }
  const last = messages[messages.length - 1];
  return last && typeof last.content === 'string' ? last.content : '';
}

/**
 * Normalised copies of the message for keyword matching only (the text sent to
 * the model is untouched). Handles what real input looks like: "7days" (digit
 * glued to a word), repeated spaces, and a line break typed inside a word
 * ("w\neather"). The joined variant is only added when it differs, and every
 * keyword test passes if it matches either variant.
 */
// Common misspellings of "delineate" seen in real input (delneate, deliniate,
// delinate ...). Applied to the routing copies only.
const DELINEATE_TYPO_RE = /\bdel[ei]?n[ei]?[ae]?t(e|es|ed|ion|ing)?\b/g;

function routingVariants(message) {
  const base = (message || '')
    .toLowerCase()
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(DELINEATE_TYPO_RE, 'delineate');
  const spaced = base.replace(/\s+/g, ' ').trim();
  const joined = base
    .replace(/([a-z])\r?\n([a-z])/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
  return spaced === joined ? [spaced] : [spaced, joined];
}

/**
 * The variant to hand to weather-mcp-service: the one with the most command
 * keyword hits (ties keep the plain spaced copy). The MCP runs its own keyword
 * checks, so it must see "delineate", not "deli\neate".
 */
function bestRoutingText(message) {
  const lists = [GEO_KEYWORDS, BULLETIN_KEYWORDS];
  const score = (text) => lists.reduce((n, list) => n + list.filter((kw) => text.includes(kw)).length, 0);
  let best = null;
  let bestScore = -1;
  for (const v of routingVariants(message)) {
    const sc = score(v);
    if (sc > bestScore) {
      best = v;
      bestScore = sc;
    }
  }
  return best || message || '';
}

/**
 * Keyword test that anchors the match to the START of a word. A plain
 * `includes` also matched inside longer words, so "suitable" contained "table"
 * and sent every "is potato suitable given the forecast" question down the
 * document-only path with no weather data ("drainage" likewise matched "rain").
 * Only the leading boundary is required: several keywords are deliberate stems
 * ("delineat", "plant", "humid", "field boundar") that must still match
 * "delineate", "planting", "humidity" and "field boundaries".
 */
const kwMatches = (text, kw) => new RegExp(`(?:^|[^a-z0-9])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text);

// Commands weather-mcp-service executes itself: the bulletin returns images,
// GEO_KEYWORDS launch satellite inference. Everything else is a question.
const BULLETIN_KEYWORDS = ['bulletin', 'agrometeorological', 'agromet', 'agri advisory'];

/** Substring test for Bengali-script keywords (NFC-normalised, no word boundaries). */
const bnMatches = (text, kw) => text.normalize('NFC').includes(kw.normalize('NFC'));

/**
 * Which command a message is, if any: 'delineate', 'flood' or 'bulletin'.
 * English stems are tested on the routing variants (see routingVariants);
 * Bengali and Banglish phrasings on the same text, so it works on the user's
 * original message and on its translation alike. null = an ordinary question.
 */
function weatherCommandKind(message) {
  if (process.env.WEATHER_ENABLED !== 'true') return null;
  const variants = routingVariants(message);
  const hasEn = (list) => variants.some((text) => list.some((kw) => kwMatches(text, kw)));
  const hasBn = (list) => list.some((kw) => bnMatches(message || '', kw));
  if (hasEn(DELINEATE_KEYWORDS_EN) || hasEn(DELINEATE_KEYWORDS_BANGLISH) || hasBn(DELINEATE_KEYWORDS_BN)) {
    return 'delineate';
  }
  if (hasEn(FLOOD_KEYWORDS_EN) || hasEn(FLOOD_KEYWORDS_BANGLISH) || hasBn(FLOOD_KEYWORDS_BN)) return 'flood';
  if (hasEn(BULLETIN_KEYWORDS) || hasEn(BULLETIN_KEYWORDS_BANGLISH) || hasBn(BULLETIN_KEYWORDS_BN)) return 'bulletin';
  return null;
}

/** True when weather-mcp-service must run the message as a command. */
function isWeatherCommand(message) {
  return weatherCommandKind(message) !== null;
}

/**
 * weather-mcp-service routes on English stems too. When the command was
 * recognised from Bengali/Banglish but the translated text lacks the stem,
 * prefix a canonical English command so the MCP takes the same branch.
 */
function ensureCommandKeyword(text, kind) {
  const variants = routingVariants(text);
  const hasEn = (list) => variants.some((t) => list.some((kw) => kwMatches(t, kw)));
  if (kind === 'delineate' && !hasEn(DELINEATE_KEYWORDS_EN)) return `Delineate field boundaries: ${text}`;
  if (kind === 'flood' && !hasEn(FLOOD_KEYWORDS_EN)) return `Show the satellite flood map: ${text}`;
  if (kind === 'bulletin' && !hasEn(BULLETIN_KEYWORDS)) return `Show the agromet bulletin: ${text}`;
  return text;
}

/**
 * The curated weather/farm context for the message's district, as plain text.
 * weather-mcp-service scans the message for a district name and falls back to
 * its default district. Returns '' on any failure so a weather outage never
 * blocks a knowledge-base answer.
 */
async function fetchWeatherContext(message) {
  if (process.env.WEATHER_ENABLED !== 'true') return '';
  const weatherMcpUrl = process.env.WEATHER_MCP_URL || 'http://weather-mcp-service:8000';
  try {
    const resp = await axios.get(`${weatherMcpUrl}/context`, { params: { location: message }, timeout: 5000 });
    return String(resp.data?.text || '');
  } catch (err) {
    logger.warn(`[WEATHER] context fetch failed (${err.message}) - answering without it`);
    return '';
  }
}

/**
 * Prepend the context block to the question in the OPEA payload. Only the
 * payload changes: the stored query and the text shown to the user do not.
 */
function withWeatherContext(opeaPayload, backendMode, queryText, weatherContext) {
  if (!weatherContext) return opeaPayload;
  // Data first, question after it, instruction last: the instruction that
  // follows the question is the one the model weights most, so it is not
  // buried under the data block.
  const wrap = (question) =>
    `[Live weather and farm data, retrieved now]\n${weatherContext}\n[End of live data]\n\n` +
    `Question: ${question}\n\n` +
    'Answer only this question. Use the parts of the live data and the retrieved documents it needs ' +
    'and leave the rest out; do not state weather values that are not listed above.';
  if (backendMode === 'single-message') {
    return { ...opeaPayload, messages: wrap(queryText) };
  }
  const msgs = [...opeaPayload.messages];
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    if (msgs[i]?.role === 'user') {
      msgs[i] = { ...msgs[i], content: wrap(msgs[i].content) };
      break;
    }
  }
  return { ...opeaPayload, messages: msgs };
}

/**
 * Answer a weather/geo message via weather-mcp-service. Never throws: on
 * failure it returns a user-facing message, distinguishing a missing
 * geo-inference-worker from a generic weather outage.
 */
const WEATHER_FALLBACK_TEXT = {
  en: {
    geoUnavailable: 'Field mapping is temporarily unavailable. Please try again in a few minutes.',
    weatherUnavailable: "I couldn't fetch the weather information right now. Please try again later."
  },
  bn: {
    geoUnavailable: 'জমির মানচিত্র সেবা সাময়িকভাবে পাওয়া যাচ্ছে না। অনুগ্রহ করে কয়েক মিনিট পর আবার চেষ্টা করুন।',
    weatherUnavailable: 'এই মুহূর্তে আবহাওয়ার তথ্য আনা সম্ভব হয়নি। অনুগ্রহ করে পরে আবার চেষ্টা করুন।'
  }
};

async function answerViaWeatherMcp(message, language = 'en', originalMessage = null) {
  const weatherMcpUrl = process.env.WEATHER_MCP_URL || 'http://weather-mcp-service:8000';
  const lowerMsg = message.toLowerCase();
  const isGeo = GEO_KEYWORDS.some((kw) => lowerMsg.includes(kw));
  const timeout = isGeo ? 660000 : 30000; // 11 min for satellite inference, 30 s for forecasts
  if (isGeo) logger.info('[WEATHER] geo-inference query - using 11-minute timeout');
  try {
    // `language` asks the agent to write its explanation in the UI language;
    // the response's `language` says which language the answer actually is in
    // (English when the agent fell back to a template), so the route knows
    // whether the post-stream translation is still needed.
    // original_query carries the user's own (possibly Bengali) text so the MCP can
    // pick up Bengali district names the translation may have altered.
    const wResp = await axios.post(
      `${weatherMcpUrl}/query`,
      { query: message, language, original_query: originalMessage || undefined },
      { timeout }
    );
    const d = wResp.data || {};
    return {
      text: d.answer || '',
      answerLanguage: String(d.language || 'en').toLowerCase(),
      metadata: {
        source_documents: [],
        confidence_score: 1.0,
        weather: true,
        location: d.location ?? null,
        forecast: d.forecast ?? null,
        field_delineation: d.field_delineation ?? null,
        flood_analysis: d.flood_analysis ?? null,
        risk_tier: d.risk_tier ?? null,
        risk_label: d.risk_label ?? null
      }
    };
  } catch (wErr) {
    logger.error(`[WEATHER] weather-mcp-service call failed: ${wErr.message}`);
    const body = wErr.response?.data?.detail || wErr.response?.data || '';
    const errStr = typeof body === 'string' ? body : JSON.stringify(body);
    const isGeoErr =
      isGeo ||
      /geo|delineat|flood|inference/.test(errStr) ||
      wErr.response?.status === 502 ||
      wErr.code === 'ECONNABORTED';
    // User-facing text only; the cause is in the log line above. Bengali is
    // served directly so the fallback never depends on the translator.
    const lang = String(language || 'en').toLowerCase();
    const texts = WEATHER_FALLBACK_TEXT[lang] || WEATHER_FALLBACK_TEXT.en;
    return {
      text: isGeoErr ? texts.geoUnavailable : texts.weatherUnavailable,
      answerLanguage: WEATHER_FALLBACK_TEXT[lang] ? lang : 'en',
      metadata: { source_documents: [], confidence_score: 0, weather: true }
    };
  }
}

class QueryService {
  constructor() {
    this.dbService = dbService; // Store the service reference instead of the promise
    this.db = null;
    this.queries = null;
    this.serviceCategories = null;
    this.services = null;
    this.analyticsService = null; // Will be set via dependency injection
    this.chatHistoryService = null; // Will be set via dependency injection
    this.initialized = false;
    logger.info('QueryService constructor called');
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
          return {
            type: 'metadata',
            source_documents: obj.source_documents ?? [],
            confidence_score: obj.confidence_score ?? 0,
            // Raw retrieval confidence (rank-weighted) and LLM self-grade, for
            // admin/eval (QueryInspector). confidence_score above is the
            // citizen-facing value (LLM self-grade when enabled, else retrieval).
            retrieval_confidence_score: obj.retrieval_confidence_score ?? null,
            self_confidence: Object.prototype.hasOwnProperty.call(obj, 'self_confidence') ? obj.self_confidence : null,
            is_grounded: obj.is_grounded ?? false
          };
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

    if (!queryData.context) {
      queryData.context = { categoryLabel: null, serviceLabels: [] };
    } else {
      if (!Array.isArray(queryData.context.serviceLabels)) {
        queryData.context.serviceLabels = [];
      }
      // Preserve null/undefined categoryLabel — null means "no category filter"
      // (chatqna treats a missing categoryLabel as no category-level filter).
      // Do NOT default to 'General' — that would inject a non-matching label.
      if (queryData.context.categoryLabel === undefined) {
        queryData.context.categoryLabel = null;
      }
    }

    if (missingFields.length > 0) {
      throw new Error(`Missing required query data. Fields: ${missingFields.join(', ')}`);
    }

    // The web client appends an empty assistant placeholder (the streaming
    // bubble) as the final element, so "last message" is not the user's text.
    // Take the last non-empty user turn instead - it feeds analytics, the
    // single-message payload and the weather/geo router.
    const queryText = lastUserMessageText(queryData.messages);

    // Resolve categoryId
    let categoryId = queryData.categoryId || null;
    if (queryData.context?.categoryLabel && !categoryId) {
      try {
        const categoryQuery = aql`
            FOR cat IN ${this.serviceCategories}
              FILTER cat.nameEN == ${queryData.context.categoryLabel}
              LIMIT 1
              RETURN cat._key
          `;
        const cursor = await this.db.query(categoryQuery);
        categoryId = await cursor.next();
      } catch (error) {
        logger.error(`Error resolving categoryId: ${error.message}`);
      }
    }

    // Resolve serviceIds
    let serviceIds = queryData.serviceId ? [queryData.serviceId] : [];
    if (queryData.context?.serviceLabels?.length > 0 && serviceIds.length === 0) {
      try {
        const servicesQuery = aql`
            FOR svc IN ${this.services}
              FILTER svc.nameEN IN ${queryData.context.serviceLabels}
              RETURN svc._key
          `;
        const cursor = await this.db.query(servicesQuery);
        serviceIds = await cursor.all();
      } catch (error) {
        logger.error(`Error resolving serviceIds: ${error.message}`);
      }
    }

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
    const opeaHost = process.env.OPEA_HOST || 'e2e-109-198';
    const opeaPort = process.env.OPEA_PORT || '8888';
    const opeaUrl = `http://${opeaHost}:${opeaPort}/v1/chatqna`;

    let opeaPayload;
    if (backendMode === 'single-message') {
      opeaPayload = { messages: queryText, stream: true };
    } else {
      opeaPayload = {
        messages: queryData.messages,
        context: {
          categoryLabel: queryData.context.categoryLabel,
          serviceLabels: queryData.context.serviceLabels,
          language: queryData.context.language
        },
        stream: true
      };
    }

    // Weather-aware advisor (PolisenseAI). Commands that launch satellite jobs
    // or return artefacts are executed by weather-mcp-service; every other
    // message is answered by ChatQnA with the district's live context attached.
    const routing = await resolveRoutingText(queryText);
    // The translation is checked first; the original text catches Bengali and
    // Banglish phrasings the translator did not turn into the English stems.
    const commandKind = weatherCommandKind(routing.text) || weatherCommandKind(queryText);
    if (commandKind) {
      const routed = ensureCommandKeyword(bestRoutingText(routing.text), commandKind);
      logger.info(`[WEATHER] ${commandKind} command -> weather-mcp-service: "${routed}"`);
      const uiLanguage = String(queryData.context?.language || routing.sourceLang || 'en').toLowerCase();
      const weatherResult = await answerViaWeatherMcp(
        routed,
        uiLanguage,
        routing.sourceLang === 'bn' ? queryText : null
      );
      return { queryId, weatherResult, authHeaders, queryData };
    }
    // For Bengali messages the district scan sees both texts (Bengali names resolve natively).
    const weatherContext = await fetchWeatherContext(
      routing.sourceLang === 'bn' && routing.text !== queryText ? `${routing.text}\n${queryText}` : routing.text
    );
    if (weatherContext) logger.info('[WEATHER] live context attached to the knowledge-base query');
    opeaPayload = withWeatherContext(opeaPayload, backendMode, queryText, weatherContext);

    return { queryId, opeaUrl, opeaPayload, authHeaders, queryData };
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
      if (!queryData.context) {
        logger.warn('[DEBUG] Validation: context object is missing. Supplying default context.');
        // Create a default context object
        queryData.context = { categoryLabel: 'General', serviceLabels: [] };
        logger.info('[DEBUG] Validation PASSED: Default context object supplied.');
      } else {
        logger.info('[DEBUG] Validation PASSED: context object is present.');

        // Also validate the internals of the provided context
        if (!Array.isArray(queryData.context.serviceLabels)) {
          logger.warn('[DEBUG] Validation WARNING: context.serviceLabels is not an array. Defaulting to empty array.');
          queryData.context.serviceLabels = [];
        } else {
          logger.info(
            `[DEBUG] Validation PASSED: context.serviceLabels is present with labels: ${queryData.context.serviceLabels.join(', ')}.`
          );
        }

        if (!queryData.context.categoryLabel) {
          logger.warn('[DEBUG] Validation WARNING: context.categoryLabel is missing. Defaulting to "General".');
          queryData.context.categoryLabel = 'General';
        }
      }
      // --- FIX: END context VALIDATION ---

      if (missingFields.length > 0) {
        const errorMsg = `Missing required query data from frontend. Fields: ${missingFields.join(', ')}`;
        logger.error('QueryService.missing_required_data', { missingFields: missingFields.join(', ') });
        throw new Error(errorMsg);
      }
      logger.info('[DEBUG] All validations passed successfully.');

      // Derive text from the last message for backward compatibility and analytics
      const queryText = lastUserMessageText(queryData.messages);
      if (!queryText) {
        logger.warn('No extractable text from messages; analytics may be affected.');
      }

      // Resolve categoryLabel to categoryId if not provided
      let categoryId = queryData.categoryId || null;
      if (queryData.context?.categoryLabel && !categoryId) {
        try {
          const categoryQuery = aql`
              FOR cat IN ${this.serviceCategories}
                FILTER cat.nameEN == ${queryData.context.categoryLabel}  // Changed to nameEN for schema match
                LIMIT 1
                RETURN cat._key
            `;
          const cursor = await this.db.query(categoryQuery);
          categoryId = await cursor.next();
          if (!categoryId) {
            logger.warn(`Category not found for label: ${queryData.context.categoryLabel}`);
          } else {
            logger.info(`Resolved categoryLabel "${queryData.context.categoryLabel}" to categoryId: ${categoryId}`);
          }
        } catch (error) {
          logger.error(`Error resolving categoryId: ${error.message}`, { stack: error.stack });
        }
      }

      // Optionally resolve serviceLabels to serviceIds (array)
      let serviceIds = queryData.serviceId ? [queryData.serviceId] : []; // Preserve if provided (as single or array)
      if (queryData.context?.serviceLabels?.length > 0 && serviceIds.length === 0) {
        try {
          const servicesQuery = aql`
              FOR svc IN ${this.services}
                FILTER svc.nameEN IN ${queryData.context.serviceLabels}  // Changed to nameEN for schema match
                RETURN svc._key
            `;
          const cursor = await this.db.query(servicesQuery);
          serviceIds = await cursor.all();
          if (serviceIds.length === 0) {
            logger.warn(`No services found for labels: ${queryData.context.serviceLabels.join(', ')}`);
          } else {
            logger.info(`Resolved serviceLabels to serviceIds: ${serviceIds.join(', ')}`);
          }
        } catch (error) {
          logger.error(`Error resolving serviceIds: ${error.message}`, { stack: error.stack });
        }
      }

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
        await this.queries.update(queryId, updateData);
      } else {
        // *** EXISTING OPEA CALL LOGIC (NOW USING WORKER THREAD) ***
        const opeaHost = process.env.OPEA_HOST || 'e2e-109-198';
        const opeaPort = process.env.OPEA_PORT || '8888';
        const opeaUrl = `http://${opeaHost}:${opeaPort}/v1/chatqna`;

        let opeaPayload;
        if (backendMode === 'single-message') {
          logger.info('[DEBUG] Backend mode is "single-message". Extracting last message for OPEA.');
          const queryText = lastUserMessageText(queryData.messages);

          if (!queryText) {
            throw new Error('Could not extract last message content for single-message mode.');
          }

          opeaPayload = {
            messages: queryText,
            stream: false,
            context: {
              language: queryData.context?.language
            }
          };
        } else {
          logger.info('[DEBUG] Backend mode is "conversation-with-labels". Formatting payload with full context.');
          opeaPayload = {
            messages: queryData.messages,
            context: {
              categoryLabel: queryData.context.categoryLabel,
              serviceLabels: queryData.context.serviceLabels,
              language: queryData.context.language
            },
            stream: false
          };
        }

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
// Pure helpers of the weather-aware path, exported for unit tests.
module.exports._weather = { isWeatherCommand, weatherCommandKind, ensureCommandKeyword, withWeatherContext };
