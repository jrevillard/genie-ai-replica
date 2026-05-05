const { v4: uuidv4 } = require('uuid');
const { aql } = require('arangojs');
const { logger, dbService, ensureCollection } = require('../shared-lib');
const { NotFoundError, ValidationError } = require('../middleware/errors');

const COLLECTION = 'aiTwins';
/** Max linked KB file ids per twin (document-repository `file_id` values, normalized). */
const MAX_LINKED_KB_FILES = 10000;
const MAX_GREETING_LEN = 5000;
const MAX_TWIN_NUMBER_LEN = 32;
/** Default WhatsApp/voice number used by newly-created twins. */
const DEFAULT_TWIN_NUMBER = '+1 (575) 223-6878';
/** Default greeting used for both chat and call on new twins. */
const DEFAULT_GREETING = 'Hey, How can I help you today ?';

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
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
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
   * @param {{ offset?: number, limit?: number }} opts
   */
  async listTwins(opts = {}) {
    const offset = Math.max(0, parseInt(String(opts.offset ?? 0), 10) || 0);
    const limitRaw = parseInt(String(opts.limit ?? 50), 10);
    const limit = Math.min(Math.max(limitRaw || 50, 1), 200);

    const countResult = await this.collection.count();
    const total = countResult?.count ?? 0;

    const cursor = await this.db.query(
      aql`
        FOR t IN ${this.collection}
          SORT t.updatedAt DESC
          LIMIT ${offset}, ${limit}
          RETURN t
      `
    );
    const rows = await cursor.all();
    const twins = rows.map((d) => this._sanitizeTwin(d));
    return { twins, total, offset, limit };
  }

  async getTwinByKey(key) {
    if (!key || typeof key !== 'string') {
      throw new ValidationError('Invalid twin id');
    }
    try {
      const doc = await this.collection.document(key);
      return this._sanitizeTwin(doc);
    } catch (e) {
      if (e.errorNum === 1202) {
        throw new NotFoundError('AI twin not found');
      }
      throw e;
    }
  }

  /**
   * @param {{ name: string, profilePicUrl?: string | null, description?: string }} data
   */
  async createTwin(data) {
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
   */
  async updateTwin(key, patch) {
    if (!key || typeof key !== 'string') {
      throw new ValidationError('Invalid twin id');
    }
    await this.getTwinByKey(key);

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
    await this.collection.update(key, updates);
    return this.getTwinByKey(key);
  }

  /**
   * Read the chat greeting, call greeting and twin number for a twin.
   * Falls back to the default twin number when the doc has no value.
   */
  async getSettings(key) {
    const twin = await this.getTwinByKey(key);
    return {
      chatGreeting: twin.chatGreeting || DEFAULT_GREETING,
      callGreeting: twin.callGreeting || DEFAULT_GREETING,
      // twin.twinNumber is already empty for non-default twins (sanitized).
      twinNumber: twin.twinNumber,
    };
  }

  /**
   * Update any subset of {chatGreeting, callGreeting, twinNumber}.
   * Returns the new settings (same shape as getSettings).
   */
  async updateSettings(key, patch) {
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
      const current = await this.getTwinByKey(key);
      if (!current.isDefault) {
        const e = new ValidationError('twinNumber can only be set on the default twin (POST /:twinId/default first)');
        e.statusCode = 400;
        throw e;
      }
      updates.twinNumber = this._normalizeTwinNumber(patch.twinNumber);
    }
    if (Object.keys(updates).length === 0) {
      return this.getSettings(key);
    }
    await this.getTwinByKey(key); // 404 if missing
    updates.updatedAt = new Date().toISOString();
    await this.collection.update(key, updates);
    return this.getSettings(key);
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

  async deleteTwin(key) {
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
  async assignKbFiles(twinKey, rawIds) {
    if (!twinKey || typeof twinKey !== 'string') {
      throw new ValidationError('Invalid twin id');
    }
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      throw new ValidationError('At least one file id is required');
    }
    await this.getTwinByKey(twinKey);
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
  async unassignKbFiles(twinKey, rawIds) {
    if (!twinKey || typeof twinKey !== 'string') {
      throw new ValidationError('Invalid twin id');
    }
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      throw new ValidationError('At least one file id is required');
    }
    await this.getTwinByKey(twinKey);
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
  async replaceKbFiles(twinKey, rawIds) {
    if (!twinKey || typeof twinKey !== 'string') {
      throw new ValidationError('Invalid twin id');
    }
    if (!Array.isArray(rawIds)) {
      throw new ValidationError('linkedKbFileIds must be an array');
    }
    await this.getTwinByKey(twinKey);

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

module.exports = new AiTwinService();
