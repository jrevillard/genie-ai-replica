const { v4: uuidv4 } = require('uuid');
const { aql } = require('arangojs');
const { logger, dbService, ensureCollection } = require('../shared-lib');
const { NotFoundError, ValidationError } = require('../middleware/errors');

const COLLECTION = 'aiTwins';
/** Max linked KB file ids per twin (document-repository `file_id` values, normalized). */
const MAX_LINKED_KB_FILES = 10000;
const MAX_GREETING_LEN = 5000;
const MAX_TWIN_NUMBER_LEN = 32;
const MAX_SYSTEM_PROMPT_LEN = 50000;
/** Default WhatsApp/voice number used by newly-created twins. */
const DEFAULT_TWIN_NUMBER = '+1 (575) 223-6878';
/** Default greeting used for both chat and call on new twins. */
const DEFAULT_GREETING = 'Hey, How can I help you today ?';

/**
 * The base system prompt shared by all channels (chat and call).
 * For call, voice-specific instructions are appended at runtime by the voice-bridge.
 * Admins can override this per-twin via PATCH /api/ai-twins/:twinId/prompt.
 */
const DEFAULT_SYSTEM_PROMPT = `You are Genie AI, a health companion for The Gambia deployed by the Ministry of Health. You help users prevent and manage NCDs — hypertension, diabetes, tobacco dependence — using WHO, BHBM, and Gambian guidelines. You are not a doctor. You do not diagnose, prescribe, or change treatment.

HOW TO ANSWER
The user message has three sections: USER INFORMATION, CHAT HISTORY ([user turn]/[assistant turn] markers), and CONTENT FROM THE KNOWLEDGE BASE ([Retrieved Document] entries).
1. Reply only to the last [user turn]. Ground factual claims in [Retrieved Document] entries — they are the source of truth.
2. Personalise using USER INFORMATION only when it genuinely helps.
3. If no documents were retrieved: stay helpful and conversational, offer general wellness guidance. For greetings or small talk, reply naturally — do not mention missing evidence.
4. When retrieved entries conflict: prefer Gambian guidelines, then WHO, then BHBM.
5. Never return a blank or empty reply. If you have nothing specific to offer, give a warm safe fallback: acknowledge the user, share one practical general tip, and suggest they speak to a community health worker for more help.

WHO YOU TALK TO
Adult Gambians — limited time, possibly limited literacy, English as a second language. Talk like a warm, kind community health worker. Plain. Non-judgemental.

STYLE
- Short sentences. Grade-6 reading level. 2–4 sentences preferred (≤100 words) unless more detail is explicitly requested.
- Plain words. Say "high blood pressure" not "hypertension" (use clinical term in parentheses once only).
- One focused idea per reply. Use a numbered list only when steps genuinely need to be sequential (max 3 items). At most one follow-up question.
- No emoji unless the user used them first. No jargon. No moralising. No long disclaimers. Lead with a sentence, not a bullet list.
- Use local framing where helpful: market, bantaba, attaya, domoda, benachin. Never invent health claims about foods.

DO
- Explain NCD risks and symptoms in plain language from retrieved entries.
- Offer one or two practical, locally-achievable next steps rather than a long list.
- Support behaviour change (quit smoking, salt reduction, movement, medication adherence) when user is ready.
- Refer to clinic or community health worker when in-person care is needed.

WHEN YOU CANNOT FULLY HELP
Never say "I can't help with that." Instead: briefly acknowledge the question, offer the closest safe general guidance you can (one practical tip or next step), and direct the user to where they can get more specific help — a community health worker, clinic, or pharmacist. Example: "That's something a clinician can advise on directly. In the meantime, [one practical tip]. Your nearest health worker can guide you further."

DON'T
- Diagnose or prescribe specific medications or dosages.
- Invent facts, statistics, or citations. Label anything not in retrieved entries as general guidance only.
- Give legal, financial, or immigration advice.

SAFETY — RED FLAGS
If the user describes any of the following, stop and tell them to seek urgent care immediately:
- Chest pain, pressure, or tightness; pain to arm, jaw, or back
- Sudden weakness, numbness, face drooping, slurred speech, vision trouble (possible stroke)
- Severe shortness of breath; fainting, seizure, or loss of consciousness
- Sudden severe headache ("worst ever")
- Blood sugar crisis with confusion or vomiting
- Any mention of suicide, self-harm, or harm to others

Say: "What you're describing may be serious. Please go to the nearest health facility now, or ask someone to take you. If you cannot move safely, call for help. I'll still be here when you're safe."
Do not continue other advice until the user confirms they are safe.

OUTPUT
Plain text only. No markdown. Numbers for lists (1. 2. 3.). End with at most one short follow-up question.

EXAMPLES

Example 1 — factual question with retrieved entry
User: "What is high blood pressure?"
Retrieved: High blood pressure (hypertension) is when blood force against artery walls stays too high. Usually no symptoms. Raises risk of stroke, heart attack, kidney damage. 140/90 mmHg or higher on repeated readings is considered high.
Reply: High blood pressure (hypertension) means blood pushes too hard against your artery walls. Most people feel nothing — that's why it's called a silent problem. Over time it can cause stroke, heart attack, or kidney damage. A reading of 140/90 or higher, seen more than once, is high.
Would you like to know how to check your blood pressure?

Example 2 — red flag
User: "I feel heavy pressure on my chest and my left arm is numb."
Reply: What you're describing may be serious. Please go to the nearest health facility now, or ask someone to take you. If you cannot move safely, call for help. I'll still be here when you're safe.

Example 3 — out-of-scope or prescribing question
User: "Can you prescribe me metformin for my diabetes?"
Reply: Prescribing medication is something only a clinician can do safely. What I can share is that managing blood sugar usually involves a combination of diet, movement, and medication your doctor or pharmacist can advise on. Would you like some tips on eating habits that help with blood sugar control?

Reply only as the assistant. Never continue the user's voice or invent further turns.`;

/** Allowed AI Personality values. Both fields are open enums today; broaden in this list. */
const LANGUAGE_STYLES = Object.freeze(['slang', 'casual', 'professional']);
const RESPONSE_LENGTHS = Object.freeze(['short', 'medium', 'long']);
/** Project-wide default personality applied to any twin that doesn't have one set. */
const DEFAULT_PERSONALITY = Object.freeze({
  languageStyle: 'slang',
  responseLength: 'medium',
});
const MAX_INSTRUCTIONS = 100;
const MAX_INSTRUCTION_LENGTH = 1000;
const SUGGESTED_INSTRUCTIONS = Object.freeze([
  'Be concise and practical in your answers.',
  'When possible, answer with step-by-step actions.',
  'Ask a clarifying question if the request is ambiguous.',
  'State uncertainty clearly when you are not fully sure.',
]);

/**
 * Map a twin's personality settings to a single instruction string that gets
 * prepended (as a `role: system` message) to the chat history sent to chatqna.
 * Exposed for the voice-bridge / whatsapp paths so they can inject the same
 * directive without re-deriving the wording.
 *
 * @param {{ languageStyle?: string, responseLength?: string } | null | undefined} personality
 * @returns {string} Single-paragraph directive. Falsy when personality is empty.
 */
function buildPersonalityPromptFragment(personality) {
  const p = personality || {};
  const style = LANGUAGE_STYLES.includes(p.languageStyle)
    ? p.languageStyle
    : DEFAULT_PERSONALITY.languageStyle;
  const length = RESPONSE_LENGTHS.includes(p.responseLength)
    ? p.responseLength
    : DEFAULT_PERSONALITY.responseLength;

  // Phrasing avoids any wording that hints at role-play (e.g. "like a friend"),
  // because Llama 3.1 sometimes interprets that as instruction to invent a
  // fictional dialogue partner and starts hallucinating users by name.
  // Each line is a STYLE constraint on the existing assistant role — never an
  // identity override.
  const STYLE_COPY = {
    slang: 'use casual everyday language; contractions and short forms are fine; avoid formal jargon',
    casual: 'use a friendly conversational tone with full sentences; contractions are fine',
    professional: 'use formal precise language; full sentences; no contractions or slang',
  };
  const LENGTH_COPY = {
    short: 'keep replies to 1-2 short sentences; no preamble',
    medium: 'keep replies moderately detailed, roughly 3-6 sentences',
    long: 'give thorough, multi-paragraph explanations with examples when helpful',
  };

  return [
    'Style preferences for your reply (these modify HOW you respond — they do not change your role or what you do):',
    `- Tone: ${STYLE_COPY[style]}.`,
    `- Length: ${LENGTH_COPY[length]}.`,
  ].join('\n');
}

/**
 * Build a prompt fragment from admin-defined twin instructions.
 * Each instruction is treated as a strict system-level directive.
 *
 * @param {string[] | null | undefined} instructions
 * @returns {string}
 */
function buildInstructionsPromptFragment(instructions) {
  if (!Array.isArray(instructions) || instructions.length === 0) {
    return '';
  }
  const lines = instructions
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, MAX_INSTRUCTIONS);
  if (lines.length === 0) {
    return '';
  }
  return [
    'Additional admin instructions (apply these together with your existing system rules):',
    ...lines.map((item) => `- ${item}`),
  ].join('\n');
}

/**
 * Compose the full AI twin prompt fragment. Personality comes first, and
 * admin instructions are appended at the end by design.
 *
 * @param {{ personality?: object, instructions?: string[] } | null | undefined} twin
 * @returns {string}
 */
function buildTwinPromptFragment(twin) {
  const personality = buildPersonalityPromptFragment(twin && twin.personality);
  const instructions = buildInstructionsPromptFragment(twin && twin.instructions);
  return [personality, instructions].filter(Boolean).join('\n\n');
}

/** @typedef {import('arangojs').DocumentCollection} DocumentCollection */

/**
 * Normalize a knowledge-base file id to the canonical form stored on the twin.
 * Strips optional `files/` prefix (same family as chat history / retriever file references).
 * Does not verify the file exists in the document repo — that stays in the KB stack.
 *
 * @param {unknown} id
 * @returns {string | null}
 */
function normalizeKbFileId(id) {
  if (typeof id !== 'string') return null;
  let s = id.trim();
  if (!s) return null;
  if (s.length > 512) return null;
  const lower = s.toLowerCase();
  if (lower.startsWith('files/')) {
    s = s.slice('files/'.length);
  }
  return s || null;
}

/**
 * Fields that are NEVER persisted on the aiTwins document — they're derived
 * live from other collections at GET time only (see getTwinSessionCounts).
 * Any update path that catches one of these in its payload is treated as a
 * client bug: the field is stripped before the write and a warning logged.
 *
 * Read-only invariant: the only routes that compute these are GET handlers
 * which merge `await getTwinSessionCounts(_key)` onto the response. There is
 * no write API.
 */
const IMMUTABLE_TWIN_FIELDS = ['numChats', 'numWhatsappChats', 'numCalls'];

function stripImmutableTwinFields(updates, callsite) {
  if (!updates || typeof updates !== 'object') return updates;
  for (const key of IMMUTABLE_TWIN_FIELDS) {
    if (key in updates) {
      logger.warn(`AiTwin update: dropping read-only field '${key}' from ${callsite}`);
      delete updates[key];
    }
  }
  return updates;
}

/**
 * AI Twin — admin-defined chat personas and optional KB file allow-list (`linkedKbFileIds`).
 */
class AiTwinService {
  constructor() {
    this.db = null;
    /** @type {DocumentCollection | null} */
    this.collection = null;
    this.initialized = false;
    /** Optional VoiceCatalogService — set externally to enable voiceId default + validation. */
    this.voiceCatalogService = null;
  }

  setVoiceCatalogService(service) {
    this.voiceCatalogService = service;
  }

  async init() {
    if (this.initialized) {
      return;
    }
    try {
      this.db = await dbService.getConnection('default');
      await ensureCollection(this.db, COLLECTION);
      this.collection = this.db.collection(COLLECTION);
      this.initialized = true;
      logger.info('AiTwinService initialized');
      await this._seedDefaultTwin();
    } catch (error) {
      logger.error(`AiTwinService init failed: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Ensure exactly one twin exists with isDefault=true. Idempotent.
   *
   * If no default exists yet, creates a "Genie" twin holding the project
   * phone number. Subsequent boots are a no-op.
   */
  async _seedDefaultTwin() {
    try {
      const cursor = await this.db.query(
        'FOR t IN @@coll FILTER t.isDefault == true LIMIT 1 RETURN t._key',
        { '@coll': COLLECTION }
      );
      const existing = await cursor.next();
      if (existing) return;

      const voiceId = this.voiceCatalogService
        ? this.voiceCatalogService.getDefaultVoiceKey()
        : null;
      const now = new Date().toISOString();
      const doc = {
        _key: uuidv4(),
        name: 'Genie',
        profilePicUrl: null,
        description: '',
        voiceId,
        chatGreeting: DEFAULT_GREETING,
        callGreeting: DEFAULT_GREETING,
        isDefault: true,
        twinNumber: DEFAULT_TWIN_NUMBER,
        linkedKbFileIds: [],
        instructions: [],
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        createdAt: now,
        updatedAt: now,
      };
      await this.collection.save(doc);
      logger.info(`AiTwin seeded default twin: ${doc._key} (twinNumber=${DEFAULT_TWIN_NUMBER})`);
    } catch (error) {
      logger.warn(`AiTwin seed default failed (non-fatal): ${error.message}`);
    }
  }

  /**
   * @param {object | null} doc
   */
  _sanitizeTwin(doc) {
    if (!doc) return null;
    const raw = doc.linkedKbFileIds;
    const linkedKbFileIds = Array.isArray(raw)
      ? [...new Set(raw.map((x) => normalizeKbFileId(x)).filter(Boolean))]
      : [];
    const isDefault = doc.isDefault === true;
    return {
      _key: doc._key,
      ownerId: doc.ownerId ?? null,
      name: doc.name,
      profilePicUrl: doc.profilePicUrl ?? null,
      description: doc.description ?? '',
      voiceId: doc.voiceId ?? null,
      chatGreeting: doc.chatGreeting || DEFAULT_GREETING,
      callGreeting: doc.callGreeting || DEFAULT_GREETING,
      isDefault,
      // twinNumber is only meaningful on the default twin; non-default twins
      // surface an empty string regardless of any legacy stored value.
      twinNumber: isDefault ? (doc.twinNumber || DEFAULT_TWIN_NUMBER) : '',
      linkedKbFileIds,
      personality: this._readPersonality(doc),
      instructions: this._readInstructions(doc),
      systemPrompt: typeof doc.systemPrompt === 'string' && doc.systemPrompt.trim()
        ? doc.systemPrompt
        : DEFAULT_SYSTEM_PROMPT,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  /**
   * Fetch KB file metadata for linked ids from document-repository `files`.
   * Returned in the same order as the input ids (missing ids are skipped).
   *
   * @param {string[]} normalizedIds
   * @returns {Promise<Array<object>>}
   */
  async _fetchKbFilesByIds(normalizedIds) {
    if (!Array.isArray(normalizedIds) || normalizedIds.length === 0) {
      return [];
    }
    const querySpec = {
      query: `
        FOR f IN files
          FILTER f.file_id IN @ids
          RETURN {
            fileId: f.file_id,
            _key: f._key,
            fileName: f.file_name || null,
            originalName: f.file_name || null,
            mimeType: f.file_type || null,
            fileType: f.file_type || null,
            size: f.file_size || null,
            title: f.file_name || null,
            description: null,
            category: null,
            tags: f.labels || [],
            labels: f.labels || [],
            status: f.dataprep.status || f.status || null,
            sourceUrl: f.source_url || null,
            createdAt: f.create_date || f.uploaded_date || null,
            updatedAt: f.dataprep.ingest_date || f.uploaded_date || null,
            fileSize: f.file_size || null,
            fileHash: f.file_hash || null,
            storagePath: f.storage_path || null,
            chunkCount: f.chunk_count || null,
            language: f.language || null,
            author: f.author || null,
            uploadedDate: f.uploaded_date || null,
            createDate: f.create_date || null,
            crawlDate: f.crawl_date || null,
            ingestDate: f.dataprep.ingest_date || null,
            retractDate: f.dataprep.retract_date || null
          }
      `,
      bindVars: { ids: normalizedIds },
    };
    const orderRows = (rows) => {
      const byId = new Map(rows.map((row) => [row.fileId, row]));
      return normalizedIds.map((id) => byId.get(id)).filter(Boolean);
    };
    try {
      const primaryCursor = await this.db.query(querySpec);
      const primaryRows = await primaryCursor.all();
      if (primaryRows.length > 0) {
        await this._attachLinkedTwinIds(primaryRows);
        return orderRows(primaryRows);
      }

      // Some deployments keep document-repository metadata in a dedicated "files" DB.
      const filesDb = await dbService.getConnection('files');
      if (!filesDb || filesDb === this.db) {
        return [];
      }
      const fallbackCursor = await filesDb.query(querySpec);
      const fallbackRows = await fallbackCursor.all();
      await this._attachLinkedTwinIds(fallbackRows);
      return orderRows(fallbackRows);
    } catch (e) {
      logger.warn(`AiTwin linked KB metadata fetch failed: ${e.message}`);
      return [];
    }
  }

  /**
   * Reverse-lookup: for each file row, set `linkedTwinIds` to the _keys of every
   * twin whose `linkedKbFileIds` contains the file. aiTwins always lives in this
   * service's primary DB even when files live in a separate "files" DB.
   * Mutates the rows in place; best-effort (sets [] on failure).
   */
  async _attachLinkedTwinIds(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return;
    const ids = rows.map((r) => r.fileId).filter(Boolean);
    if (ids.length === 0) {
      for (const r of rows) r.linkedTwinIds = [];
      return;
    }
    try {
      const cursor = await this.db.query(
        `FOR t IN aiTwins
           FILTER t.linkedKbFileIds != null
             AND LENGTH(INTERSECTION(t.linkedKbFileIds, @ids)) > 0
           FOR fid IN INTERSECTION(t.linkedKbFileIds, @ids)
             RETURN { fileId: fid, twinKey: t._key }`,
        { ids }
      );
      const pairs = await cursor.all();
      const byId = new Map();
      for (const { fileId, twinKey } of pairs) {
        const arr = byId.get(fileId) || [];
        arr.push(twinKey);
        byId.set(fileId, arr);
      }
      for (const r of rows) {
        r.linkedTwinIds = byId.get(r.fileId) || [];
      }
    } catch (e) {
      logger.warn(`_attachLinkedTwinIds failed: ${e.message}`);
      for (const r of rows) r.linkedTwinIds = [];
    }
  }

  /**
   * Remove missing file ids from a twin's linkedKbFileIds.
   *
   * @param {string} twinKey
   * @param {string[]} currentIds
   * @param {string[]} existingIds
   * @returns {Promise<string[]>} pruned ids
   */
  async _pruneMissingLinkedKbFileIds(twinKey, currentIds, existingIds) {
    const existingSet = new Set(existingIds || []);
    const nextIds = (currentIds || []).filter((id) => existingSet.has(id));
    if (nextIds.length === (currentIds || []).length) {
      return currentIds || [];
    }
    await this.collection.update(twinKey, {
      linkedKbFileIds: nextIds,
      updatedAt: new Date().toISOString(),
    });
    const removed = (currentIds || []).filter((id) => !existingSet.has(id));
    logger.info(
      `AiTwin ${twinKey}: pruned missing KB file links (${removed.length})`,
      { removed }
    );
    return nextIds;
  }

  /**
   * Read a twin's personality, applying project defaults for any field that
   * is missing or invalid. Always returns a fully-populated object — never
   * `null` — so callers can blindly forward to `buildPersonalityPromptFragment`.
   */
  _readPersonality(doc) {
    const raw = (doc && doc.personality) || {};
    return {
      languageStyle: LANGUAGE_STYLES.includes(raw.languageStyle)
        ? raw.languageStyle
        : DEFAULT_PERSONALITY.languageStyle,
      responseLength: RESPONSE_LENGTHS.includes(raw.responseLength)
        ? raw.responseLength
        : DEFAULT_PERSONALITY.responseLength,
    };
  }

  /**
   * Read and normalize stored twin instructions.
   */
  _readInstructions(doc) {
    const raw = doc && doc.instructions;
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const item of raw) {
      if (typeof item !== 'string') continue;
      const s = item.trim();
      if (!s) continue;
      if (s.length > MAX_INSTRUCTION_LENGTH) continue;
      out.push(s);
      if (out.length >= MAX_INSTRUCTIONS) break;
    }
    return out;
  }

  /**
   * Validate and normalize a replacement instructions array.
   */
  _normalizeInstructions(instructions) {
    if (!Array.isArray(instructions)) {
      throw new ValidationError('instructions must be an array of strings');
    }
    if (instructions.length > MAX_INSTRUCTIONS) {
      throw new ValidationError(`instructions cannot have more than ${MAX_INSTRUCTIONS} items`);
    }
    const out = [];
    for (const item of instructions) {
      if (typeof item !== 'string') {
        throw new ValidationError('instructions must contain only strings');
      }
      const s = item.trim();
      if (!s) {
        continue;
      }
      if (s.length > MAX_INSTRUCTION_LENGTH) {
        throw new ValidationError(
          `each instruction must be at most ${MAX_INSTRUCTION_LENGTH} characters`
        );
      }
      out.push(s);
    }
    return out;
  }

  /** Validate and normalize an optional greeting (chat or call). */
  _normalizeGreeting(value, fieldName) {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string') {
      throw new ValidationError(`${fieldName} must be a string`);
    }
    const v = value.trim();
    if (v.length > MAX_GREETING_LEN) {
      throw new ValidationError(`${fieldName} must be at most ${MAX_GREETING_LEN} characters`);
    }
    return v;
  }

  /** Validate and normalize the twin phone number. Empty string allowed. */
  _normalizeTwinNumber(value) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string') {
      throw new ValidationError('twinNumber must be a string');
    }
    const v = value.trim();
    if (v.length > MAX_TWIN_NUMBER_LEN) {
      throw new ValidationError(`twinNumber must be at most ${MAX_TWIN_NUMBER_LEN} characters`);
    }
    return v;
  }

  /**
   * Resolve a voiceId from the request, falling back to the catalog default
   * (en male) when missing. Validates the id exists in the catalog.
   */
  async _resolveVoiceId(voiceId) {
    if (!this.voiceCatalogService) return null;
    if (voiceId === undefined || voiceId === null || voiceId === '') {
      return this.voiceCatalogService.getDefaultVoiceKey();
    }
    if (typeof voiceId !== 'string') {
      throw new ValidationError('voiceId must be a string');
    }
    const voice = await this.voiceCatalogService.getVoice(voiceId);
    if (!voice) throw new ValidationError(`voiceId "${voiceId}" not found in catalog`);
    return voice._key;
  }

  /**
   * @param {{ offset?: number, limit?: number, ownerId?: string }} opts
   *   When `ownerId` is provided, only that owner's twins are returned (and
   *   `total` reflects that filtered count). When omitted, lists all twins —
   *   used by internal services that need a global view (public guest list,
   *   admin diagnostics).
   */
  async listTwins(opts = {}) {
    const offset = Math.max(0, parseInt(String(opts.offset ?? 0), 10) || 0);
    const limitRaw = parseInt(String(opts.limit ?? 50), 10);
    const limit = Math.min(Math.max(limitRaw || 50, 1), 200);
    const ownerId = typeof opts.ownerId === 'string' && opts.ownerId ? String(opts.ownerId) : null;
    // allowedIds: string[] | null — when non-null, only return twins whose _key is in the list.
    const allowedIds = Array.isArray(opts.allowedIds) ? opts.allowedIds : null;

    let total;
    let cursor;
    if (allowedIds !== null) {
      // Patient-scoped fetch: only the explicitly allowed twin keys.
      if (allowedIds.length === 0) {
        return { twins: [], total: 0, offset, limit };
      }
      const countCursor = await this.db.query(
        aql`FOR t IN ${this.collection} FILTER t._key IN ${allowedIds} COLLECT WITH COUNT INTO n RETURN n`
      );
      total = (await countCursor.all())[0] ?? 0;
      cursor = await this.db.query(
        aql`
          FOR t IN ${this.collection}
            FILTER t._key IN ${allowedIds}
            SORT t.updatedAt DESC
            LIMIT ${offset}, ${limit}
            RETURN t
        `
      );
    } else if (ownerId) {
      const countCursor = await this.db.query(
        aql`FOR t IN ${this.collection} FILTER t.ownerId == ${ownerId} COLLECT WITH COUNT INTO n RETURN n`
      );
      total = (await countCursor.all())[0] ?? 0;
      cursor = await this.db.query(
        aql`
          FOR t IN ${this.collection}
            FILTER t.ownerId == ${ownerId}
            SORT t.updatedAt DESC
            LIMIT ${offset}, ${limit}
            RETURN t
        `
      );
    } else {
      const countResult = await this.collection.count();
      total = countResult?.count ?? 0;
      cursor = await this.db.query(
        aql`
          FOR t IN ${this.collection}
            SORT t.updatedAt DESC
            LIMIT ${offset}, ${limit}
            RETURN t
        `
      );
    }
    const rows = await cursor.all();
    const twins = rows.map((d) => this._sanitizeTwin(d));
    return { twins, total, offset, limit };
  }

  /**
   * @param {string} key
   * @param {{ ownerId?: string }} [opts]  when `ownerId` is provided, throws
   *   NotFoundError if the twin's `ownerId` doesn't match. We deliberately
   *   404 (not 403) so cross-tenant probing can't enumerate twin ids.
   */
  async getTwinByKey(key, opts = {}) {
    if (!key || typeof key !== 'string') {
      throw new ValidationError('Invalid twin id');
    }
    let doc;
    try {
      doc = await this.collection.document(key);
    } catch (e) {
      if (e.errorNum === 1202) {
        throw new NotFoundError('AI twin not found');
      }
      throw e;
    }
    if (opts && opts.ownerId && doc.ownerId !== opts.ownerId) {
      throw new NotFoundError('AI twin not found');
    }
    const twin = this._sanitizeTwin(doc);
    if (opts && opts.includeKbFiles === true) {
      const linkedKbFiles = await this._fetchKbFilesByIds(twin.linkedKbFileIds || []);
      const existingIds = linkedKbFiles.map((f) => f.fileId).filter(Boolean);
      twin.linkedKbFileIds = await this._pruneMissingLinkedKbFileIds(
        twin._key,
        twin.linkedKbFileIds || [],
        existingIds
      );
      const byId = new Map(linkedKbFiles.map((f) => [f.fileId, f]));
      twin.linkedKbFiles = twin.linkedKbFileIds.map((id) => byId.get(id)).filter(Boolean);
    }
    return twin;
  }

  /**
   * @param {{ name: string, profilePicUrl?: string | null, description?: string }} data
   * @param {string} ownerId  user `_key` of the creating admin — stamped on
   *   the row so subsequent reads can scope by owner.
   */
  async createTwin(data, ownerId) {
    if (!ownerId || typeof ownerId !== 'string') {
      throw new ValidationError('ownerId is required');
    }
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (!name || name.length > 200) {
      throw new ValidationError('name is required and must be at most 200 characters');
    }
    const description =
      typeof data.description === 'string' ? data.description.trim() : data.description == null ? '' : String(data.description);
    if (description.length > 50000) {
      throw new ValidationError('description must be at most 50000 characters');
    }

    let profilePicUrl = null;
    if (data.profilePicUrl != null && data.profilePicUrl !== '') {
      if (typeof data.profilePicUrl !== 'string') {
        throw new ValidationError('profilePicUrl must be a string or null');
      }
      const u = data.profilePicUrl.trim();
      if (u.length > 2048) {
        throw new ValidationError('profilePicUrl is too long');
      }
      profilePicUrl = u;
    }

    const voiceId = await this._resolveVoiceId(data.voiceId);
    const chatGreeting = data.chatGreeting === undefined
      ? DEFAULT_GREETING
      : this._normalizeGreeting(data.chatGreeting, 'chatGreeting');
    const callGreeting = data.callGreeting === undefined
      ? DEFAULT_GREETING
      : this._normalizeGreeting(data.callGreeting, 'callGreeting');

    const now = new Date().toISOString();
    const _key = uuidv4();
    const doc = {
      _key,
      ownerId,
      name,
      profilePicUrl,
      description,
      voiceId,
      chatGreeting,
      callGreeting,
      // New twins are never the default and never carry a phone number.
      // Use POST /api/ai-twins/:twinId/default to promote one.
      isDefault: false,
      twinNumber: '',
      linkedKbFileIds: [],
      instructions: [],
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      createdAt: now,
      updatedAt: now,
    };
    const meta = await this.collection.save(doc);
    const saved = await this.collection.document(meta._key);
    logger.info(`AiTwin created: ${_key}`);
    return this._sanitizeTwin(saved);
  }

  /**
   * @param {string} key
   * @param {{ name?: string, profilePicUrl?: string | null, description?: string }} patch
   * @param {string} [ownerId]  scope the update to this owner — 404 otherwise.
   */
  async updateTwin(key, patch, ownerId) {
    if (!key || typeof key !== 'string') {
      throw new ValidationError('Invalid twin id');
    }
    await this.getTwinByKey(key, { ownerId });

    const updates = {};
    if (patch.name !== undefined) {
      const name = typeof patch.name === 'string' ? patch.name.trim() : '';
      if (!name || name.length > 200) {
        throw new ValidationError('name must be non-empty and at most 200 characters');
      }
      updates.name = name;
    }
    if (patch.description !== undefined) {
      const description =
        typeof patch.description === 'string'
          ? patch.description.trim()
          : patch.description == null
            ? ''
            : String(patch.description);
      if (description.length > 50000) {
        throw new ValidationError('description must be at most 50000 characters');
      }
      updates.description = description;
    }
    if (patch.profilePicUrl !== undefined) {
      if (patch.profilePicUrl === null || patch.profilePicUrl === '') {
        updates.profilePicUrl = null;
      } else if (typeof patch.profilePicUrl === 'string') {
        const u = patch.profilePicUrl.trim();
        if (u.length > 2048) {
          throw new ValidationError('profilePicUrl is too long');
        }
        updates.profilePicUrl = u;
      } else {
        throw new ValidationError('profilePicUrl must be a string or null');
      }
    }
    if (patch.voiceId !== undefined) {
      updates.voiceId = await this._resolveVoiceId(patch.voiceId);
    }
    if (patch.chatGreeting !== undefined) {
      updates.chatGreeting = this._normalizeGreeting(patch.chatGreeting, 'chatGreeting');
    }
    if (patch.callGreeting !== undefined) {
      updates.callGreeting = this._normalizeGreeting(patch.callGreeting, 'callGreeting');
    }
    if (patch.twinNumber !== undefined) {
      const current = await this.getTwinByKey(key);
      if (!current.isDefault) {
        const e = new ValidationError('twinNumber can only be set on the default twin (POST /:twinId/default first)');
        e.statusCode = 400;
        throw e;
      }
      updates.twinNumber = this._normalizeTwinNumber(patch.twinNumber);
    }

    if (Object.keys(updates).length === 0) {
      return this.getTwinByKey(key);
    }
    updates.updatedAt = new Date().toISOString();
    // Defensive: counts (numChats, numWhatsappChats, numCalls) are derived at
    // read time only. Guard against a caller bypassing the route's Joi schema.
    stripImmutableTwinFields(updates, 'updateTwin');
    await this.collection.update(key, updates);
    return this.getTwinByKey(key);
  }

  /**
   * Read the chat greeting, call greeting and twin number for a twin.
   * Falls back to the default twin number when the doc has no value.
   */
  async getSettings(key, ownerId) {
    const twin = await this.getTwinByKey(key, { ownerId });
    return {
      chatGreeting: twin.chatGreeting || DEFAULT_GREETING,
      callGreeting: twin.callGreeting || DEFAULT_GREETING,
      // twin.twinNumber is already empty for non-default twins (sanitized).
      twinNumber: twin.twinNumber,
    };
  }

  /**
   * Read a twin's AI Personality (languageStyle + responseLength).
   * Always returns a full object — defaults fill any missing field.
   */
  async getPersonality(key, ownerId) {
    const twin = await this.getTwinByKey(key, { ownerId });
    return twin.personality;
  }

  /**
   * Read a twin's admin instructions (array of strings).
   */
  async getInstructions(key, ownerId) {
    const twin = await this.getTwinByKey(key, { ownerId });
    return twin.instructions;
  }

  /**
   * Patch a twin's personality. Partial updates supported — the object is
   * shallow-merged with existing values, so a client can change one field
   * at a time without resending the other.
   * @returns {Promise<{ languageStyle: string, responseLength: string }>}
   */
  async updatePersonality(key, patch, ownerId) {
    if (!patch || typeof patch !== 'object') {
      throw new ValidationError('personality body is required');
    }
    const updates = {};
    if (patch.languageStyle !== undefined) {
      if (!LANGUAGE_STYLES.includes(patch.languageStyle)) {
        throw new ValidationError(
          `languageStyle must be one of: ${LANGUAGE_STYLES.join(', ')}`
        );
      }
      updates.languageStyle = patch.languageStyle;
    }
    if (patch.responseLength !== undefined) {
      if (!RESPONSE_LENGTHS.includes(patch.responseLength)) {
        throw new ValidationError(
          `responseLength must be one of: ${RESPONSE_LENGTHS.join(', ')}`
        );
      }
      updates.responseLength = patch.responseLength;
    }
    if (Object.keys(updates).length === 0) {
      return this.getPersonality(key, ownerId);
    }
    const twin = await this.getTwinByKey(key, { ownerId }); // 404 if missing or not yours
    const merged = { ...twin.personality, ...updates };
    await this.collection.update(key, {
      personality: merged,
      updatedAt: new Date().toISOString(),
    });
    return merged;
  }

  /**
   * Replace a twin's admin instructions with a new array.
   * @returns {Promise<string[]>}
   */
  async updateInstructions(key, instructions, ownerId) {
    const normalized = this._normalizeInstructions(instructions);
    await this.getTwinByKey(key, { ownerId }); // 404 if missing or not yours
    await this.collection.update(key, {
      instructions: normalized,
      updatedAt: new Date().toISOString(),
    });
    return normalized;
  }

  /**
   * Read the systemPrompt for a twin (falls back to DEFAULT_SYSTEM_PROMPT).
   */
  async getSystemPrompt(key, ownerId) {
    const twin = await this.getTwinByKey(key, { ownerId });
    return twin.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  }

  /**
   * Replace the systemPrompt for a twin.
   * @param {string} key
   * @param {string} prompt
   * @param {string} [ownerId]
   * @returns {Promise<string>} the saved prompt
   */
  async updateSystemPrompt(key, prompt, ownerId) {
    if (typeof prompt !== 'string') {
      throw new ValidationError('systemPrompt must be a string');
    }
    const trimmed = prompt.trim();
    if (!trimmed) {
      throw new ValidationError('systemPrompt must not be empty');
    }
    if (trimmed.length > MAX_SYSTEM_PROMPT_LEN) {
      throw new ValidationError(`systemPrompt must be at most ${MAX_SYSTEM_PROMPT_LEN} characters`);
    }
    await this.getTwinByKey(key, { ownerId }); // 404 if missing or not yours
    await this.collection.update(key, {
      systemPrompt: trimmed,
      updatedAt: new Date().toISOString(),
    });
    return trimmed;
  }

  getSuggestedInstructions() {
    return [...SUGGESTED_INSTRUCTIONS];
  }

  /**
   * Return suggested instructions minus those already configured on this twin.
   */
  async getSuggestedInstructionsForTwin(key, ownerId) {
    const twin = await this.getTwinByKey(key, { ownerId });
    const existing = new Set(
      (Array.isArray(twin.instructions) ? twin.instructions : [])
        .map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : ''))
        .filter(Boolean)
    );
    return SUGGESTED_INSTRUCTIONS.filter(
      (item) => !existing.has(String(item).trim().toLowerCase())
    );
  }

  /**
   * Update any subset of {chatGreeting, callGreeting, twinNumber}.
   * Returns the new settings (same shape as getSettings).
   */
  async updateSettings(key, patch, ownerId) {
    if (!patch || typeof patch !== 'object') {
      throw new ValidationError('settings body is required');
    }
    const updates = {};
    if (patch.chatGreeting !== undefined) {
      updates.chatGreeting = this._normalizeGreeting(patch.chatGreeting, 'chatGreeting');
    }
    if (patch.callGreeting !== undefined) {
      updates.callGreeting = this._normalizeGreeting(patch.callGreeting, 'callGreeting');
    }
    if (patch.twinNumber !== undefined) {
      const current = await this.getTwinByKey(key, { ownerId });
      if (!current.isDefault) {
        const e = new ValidationError('twinNumber can only be set on the default twin (POST /:twinId/default first)');
        e.statusCode = 400;
        throw e;
      }
      updates.twinNumber = this._normalizeTwinNumber(patch.twinNumber);
    }
    if (Object.keys(updates).length === 0) {
      return this.getSettings(key, ownerId);
    }
    await this.getTwinByKey(key, { ownerId }); // 404 if missing or not yours
    updates.updatedAt = new Date().toISOString();
    stripImmutableTwinFields(updates, 'updateSettings');
    await this.collection.update(key, updates);
    return this.getSettings(key, ownerId);
  }

  /**
   * Count sessions linked to a twin across the chat / whatsapp / call channels.
   * Uses raw AQL against the existing collections (`chatSessions`,
   * `call_sessions`) so we don't have to inject the other services. Returns
   * zeros when a collection is missing (e.g. fresh deploy).
   *
   * @param {string} twinId
   * @returns {Promise<{ numChats: number, numWhatsappChats: number, numCalls: number }>}
   */
  async getTwinSessionCounts(twinId) {
    const out = { numChats: 0, numWhatsappChats: 0, numCalls: 0 };
    if (!twinId) return out;

    const safeCount = async (aqlString, bind) => {
      try {
        const cursor = await this.db.query(aqlString, bind);
        const n = await cursor.next();
        return Number.isFinite(n) ? n : 0;
      } catch (e) {
        // collection or view not found — treat as zero, log at debug only.
        if (e.errorNum === 1203) return 0;
        logger.warn(`getTwinSessionCounts query failed: ${e.message}`);
        return 0;
      }
    };

    out.numChats = await safeCount(
      "RETURN LENGTH(FOR s IN chatSessions FILTER s.twinId == @twinId AND s.type == 'chat' RETURN 1)",
      { twinId }
    );
    out.numWhatsappChats = await safeCount(
      "RETURN LENGTH(FOR s IN chatSessions FILTER s.twinId == @twinId AND s.type == 'whatsapp' RETURN 1)",
      { twinId }
    );
    out.numCalls = await safeCount(
      'RETURN LENGTH(FOR c IN call_sessions FILTER c.twinId == @twinId RETURN 1)',
      { twinId }
    );
    return out;
  }

  /** Return the default twin or null when none is marked. */
  async getDefaultTwin() {
    const cursor = await this.db.query(
      'FOR t IN @@coll FILTER t.isDefault == true LIMIT 1 RETURN t',
      { '@coll': COLLECTION }
    );
    const doc = await cursor.next();
    return doc ? this._sanitizeTwin(doc) : null;
  }

  async deleteTwin(key, ownerId) {
    if (!key || typeof key !== 'string') {
      throw new ValidationError('Invalid twin id');
    }
    // Guard: the default twin owns the project phone number and is required
    // for the WhatsApp flow. Block deletion regardless of caller.
    let existing;
    try {
      existing = await this.collection.document(key);
    } catch (e) {
      if (e.errorNum === 1202) {
        throw new NotFoundError('AI twin not found');
      }
      throw e;
    }
    if (ownerId && existing.ownerId !== ownerId) {
      throw new NotFoundError('AI twin not found');
    }
    if (existing.isDefault === true) {
      const err = new ValidationError('The default twin cannot be deleted');
      err.statusCode = 409;
      throw err;
    }
    try {
      await this.collection.remove(key);
      logger.info(`AiTwin removed: ${key}`);
    } catch (e) {
      if (e.errorNum === 1202) {
        throw new NotFoundError('AI twin not found');
      }
      throw e;
    }
  }

  /**
   * Link KB file ids (document-repository file_id / chunk graph ids) to this twin.
   * @param {string} twinKey
   * @param {string[]} rawIds
   */
  async assignKbFiles(twinKey, rawIds, ownerId) {
    if (!twinKey || typeof twinKey !== 'string') {
      throw new ValidationError('Invalid twin id');
    }
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      throw new ValidationError('At least one file id is required');
    }
    await this.getTwinByKey(twinKey, { ownerId });
    const normalized = [...new Set(rawIds.map((id) => normalizeKbFileId(id)).filter(Boolean))];
    if (normalized.length === 0) {
      throw new ValidationError('No valid KB file ids');
    }

    let doc;
    try {
      doc = await this.collection.document(twinKey);
    } catch (e) {
      if (e.errorNum === 1202) throw new NotFoundError('AI twin not found');
      throw e;
    }

    const existing = Array.isArray(doc.linkedKbFileIds) ? doc.linkedKbFileIds.map((x) => normalizeKbFileId(x)).filter(Boolean) : [];
    const merged = [...new Set([...existing, ...normalized])];
    if (merged.length > MAX_LINKED_KB_FILES) {
      throw new ValidationError(`Cannot link more than ${MAX_LINKED_KB_FILES} KB files per twin`);
    }

    await this.collection.update(twinKey, {
      linkedKbFileIds: merged,
      updatedAt: new Date().toISOString(),
    });
    logger.info(`AiTwin ${twinKey}: assigned ${normalized.length} KB file(s); total linked=${merged.length}`);
    return this.getTwinByKey(twinKey);
  }

  /**
   * Remove KB file ids from this twin's allow-list.
   * @param {string} twinKey
   * @param {string[]} rawIds
   */
  async unassignKbFiles(twinKey, rawIds, ownerId) {
    if (!twinKey || typeof twinKey !== 'string') {
      throw new ValidationError('Invalid twin id');
    }
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      throw new ValidationError('At least one file id is required');
    }
    await this.getTwinByKey(twinKey, { ownerId });
    const removeSet = new Set(rawIds.map((id) => normalizeKbFileId(id)).filter(Boolean));
    if (removeSet.size === 0) {
      throw new ValidationError('No valid KB file ids');
    }

    let doc;
    try {
      doc = await this.collection.document(twinKey);
    } catch (e) {
      if (e.errorNum === 1202) throw new NotFoundError('AI twin not found');
      throw e;
    }

    const existing = Array.isArray(doc.linkedKbFileIds) ? doc.linkedKbFileIds.map((x) => normalizeKbFileId(x)).filter(Boolean) : [];
    const next = existing.filter((id) => !removeSet.has(id));

    await this.collection.update(twinKey, {
      linkedKbFileIds: next,
      updatedAt: new Date().toISOString(),
    });
    logger.info(`AiTwin ${twinKey}: unassigned KB file(s); remaining=${next.length}`);
    return this.getTwinByKey(twinKey);
  }

  /**
   * Resolve which ids exist in document-repository `files` collection (same Arango DB as twins).
   * @param {string[]} normalizedIds
   * @returns {Promise<Set<string>>}
   */
  async _fetchExistingKbFileIds(normalizedIds) {
    if (normalizedIds.length === 0) {
      return new Set();
    }
    try {
      const cursor = await this.db.query({
        query: 'FOR f IN files FILTER f.file_id IN @ids RETURN f.file_id',
        bindVars: { ids: normalizedIds },
      });
      const rows = await cursor.all();
      return new Set(rows);
    } catch (e) {
      logger.error(`AiTwin KB validation query failed: ${e.message}`, { stack: e.stack });
      throw new ValidationError(
        'Cannot validate KB file ids (ensure the document-repository `files` collection exists in this database).'
      );
    }
  }

  /**
   * Replace the full linked KB file list. Validates each id exists in `files` unless
   * AI_TWIN_SKIP_KB_FILE_EXISTENCE_CHECK=true (emergency/dev only).
   * Preserves order of first occurrence in `rawIds`.
   *
   * @param {string} twinKey
   * @param {string[]} rawIds - full replacement list (empty array clears all links)
   */
  async replaceKbFiles(twinKey, rawIds, ownerId) {
    if (!twinKey || typeof twinKey !== 'string') {
      throw new ValidationError('Invalid twin id');
    }
    if (!Array.isArray(rawIds)) {
      throw new ValidationError('linkedKbFileIds must be an array');
    }
    await this.getTwinByKey(twinKey, { ownerId });

    const seen = new Set();
    const normalizedOrdered = [];
    for (const raw of rawIds) {
      const n = normalizeKbFileId(raw);
      if (!n) {
        continue;
      }
      if (seen.has(n)) {
        continue;
      }
      seen.add(n);
      normalizedOrdered.push(n);
    }

    if (normalizedOrdered.length > MAX_LINKED_KB_FILES) {
      throw new ValidationError(`Cannot link more than ${MAX_LINKED_KB_FILES} KB files per twin`);
    }

    const skipCheck = process.env.AI_TWIN_SKIP_KB_FILE_EXISTENCE_CHECK === 'true';
    if (!skipCheck && normalizedOrdered.length > 0) {
      const existing = await this._fetchExistingKbFileIds(normalizedOrdered);
      const missing = normalizedOrdered.filter((id) => !existing.has(id));
      if (missing.length > 0) {
        const preview = missing.slice(0, 25).join(', ');
        const more = missing.length > 25 ? ` (+${missing.length - 25} more)` : '';
        throw new ValidationError(`Unknown KB file id(s): ${preview}${more}`);
      }
    }

    await this.collection.update(twinKey, {
      linkedKbFileIds: normalizedOrdered,
      updatedAt: new Date().toISOString(),
    });
    logger.info(`AiTwin ${twinKey}: replaced KB links; count=${normalizedOrdered.length} skipExistenceCheck=${skipCheck}`);
    return this.getTwinByKey(twinKey);
  }
}

const aiTwinService = new AiTwinService();
// Singleton + side-channel helpers. The helper lets call/whatsapp paths
// derive the personality directive without recreating the wording.
module.exports = aiTwinService;
module.exports.buildPersonalityPromptFragment = buildPersonalityPromptFragment;
module.exports.buildInstructionsPromptFragment = buildInstructionsPromptFragment;
module.exports.buildTwinPromptFragment = buildTwinPromptFragment;
module.exports.LANGUAGE_STYLES = LANGUAGE_STYLES;
module.exports.RESPONSE_LENGTHS = RESPONSE_LENGTHS;
module.exports.DEFAULT_PERSONALITY = DEFAULT_PERSONALITY;
module.exports.SUGGESTED_INSTRUCTIONS = SUGGESTED_INSTRUCTIONS;
module.exports.DEFAULT_SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT;
