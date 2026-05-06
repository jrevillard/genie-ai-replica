const { aql } = require('arangojs');
const { logger, dbService } = require('../shared-lib');

const SESSIONS_COLLECTION = 'call_sessions';
const MESSAGES_COLLECTION = 'call_messages';
const SUPPORTED_LANGUAGES = ['fr', 'en', 'es', 'sw'];

/**
 * Map a friendly date-range enum to the inclusive lower bound (ISO 8601 UTC)
 * used in the `s.startAt >= @from` filter. Returns null when no bound applies
 * ('all' or anything unrecognized).
 */
function dateRangeLowerBound(range) {
  const now = new Date();
  if (range === 'today') {
    // Start of UTC day.
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  }
  if (range === 'last7') {
    return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  }
  if (range === 'last30') {
    return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  }
  return null;
}

class VoiceSessionService {
  constructor() {
    this.dbService = dbService;
    this.initialized = false;
    this.db = null;
    this.sessions = null;
    this.messages = null;
  }

  async init() {
    try {
      logger.info('Starting VoiceSessionService initialization');
      this.db = await this.dbService.getConnection();
      if (!this.db) {
        throw new Error('Failed to get database connection from dbService');
      }

      const collections = await this.db.listCollections();
      const names = collections.map(c => c.name);

      if (!names.includes(SESSIONS_COLLECTION)) {
        await this.db.createCollection(SESSIONS_COLLECTION);
        logger.info(`Created ${SESSIONS_COLLECTION} collection`);
      }
      if (!names.includes(MESSAGES_COLLECTION)) {
        await this.db.createCollection(MESSAGES_COLLECTION);
        logger.info(`Created ${MESSAGES_COLLECTION} collection`);
      }

      this.sessions = this.db.collection(SESSIONS_COLLECTION);
      this.messages = this.db.collection(MESSAGES_COLLECTION);

      await Promise.all([
        this.sessions.ensureIndex({ type: 'persistent', fields: ['userId'] }),
        this.sessions.ensureIndex({ type: 'persistent', fields: ['startAt'] }),
        this.messages.ensureIndex({ type: 'persistent', fields: ['sessionId'] }),
        this.messages.ensureIndex({ type: 'persistent', fields: ['createdAt'] }),
      ]);

      this.initialized = true;
      logger.info('VoiceSessionService initialized successfully');
    } catch (error) {
      logger.error(`Error initializing VoiceSessionService: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  async createSession({ userId, language, gender }) {
    if (!userId) throw new Error('userId is required');
    const lang = SUPPORTED_LANGUAGES.includes(language) ? language : 'en';
    const gen = ['female', 'male'].includes(gender) ? gender : 'female';
    const now = new Date().toISOString();
    const doc = {
      userId: String(userId),
      language: lang,
      gender: gen,
      startAt: now,
      endAt: null,
      durationSeconds: null,
      createdAt: now,
    };
    const meta = await this.sessions.save(doc);
    logger.info(`Voice session created _key=${meta._key} user=${userId} lang=${lang} gender=${gen}`);
    return { _key: meta._key, ...doc };
  }

  async endSession({ sessionId, userId }) {
    const session = await this._getSessionRaw(sessionId, userId);
    const endAt = new Date();
    const startAt = new Date(session.startAt);
    const durationSeconds = Math.max(0, Math.round((endAt.getTime() - startAt.getTime()) / 1000));
    await this.sessions.update(sessionId, {
      endAt: endAt.toISOString(),
      durationSeconds,
    });
    logger.info(`Voice session ended _key=${sessionId} duration=${durationSeconds}s`);
    return { ...session, endAt: endAt.toISOString(), durationSeconds };
  }

  async addMessage({ sessionId, userId, content, isAssistant }) {
    if (!content || typeof content !== 'string') throw new Error('content (string) is required');
    await this._getSessionRaw(sessionId, userId); // ensures session belongs to user
    const doc = {
      sessionId: String(sessionId),
      content: content.trim(),
      isAssistant: Boolean(isAssistant),
      createdAt: new Date().toISOString(),
    };
    const meta = await this.messages.save(doc);
    return { _key: meta._key, ...doc };
  }

  /**
   * @param {object} opts
   * @param {string}  opts.userId               — caller scope, required.
   * @param {string} [opts.twinId]              — only sessions to this twin.
   * @param {string} [opts.language]            — only this language code (en/fr/es/sw).
   * @param {'all'|'today'|'last7'|'last30'} [opts.dateRange='all']
   *   Date filter on startAt (UTC). 'today' = since 00:00 UTC today.
   * @param {'newest'|'oldest'|'longest'|'shortest'} [opts.sort='newest']
   * @param {number} [opts.limit=50]
   * @param {number} [opts.offset=0]
   *
   * Sort note: 'longest' / 'shortest' use `durationSeconds`. In-progress calls
   * (durationSeconds == null) are placed last in both directions so they don't
   * dominate the head of the list.
   */
  async listSessions({
    userId,
    twinId,
    language,
    dateRange = 'all',
    sort = 'newest',
    limit = 50,
    offset = 0,
  }) {
    const filters = ['s.userId == @uid'];
    const bind = { uid: String(userId), '@coll': SESSIONS_COLLECTION };

    if (twinId) {
      filters.push('s.twinId == @twinId');
      bind.twinId = String(twinId);
    }
    if (language && SUPPORTED_LANGUAGES.includes(language)) {
      filters.push('s.language == @language');
      bind.language = language;
    }

    // Translate dateRange → ISO lower bound on startAt.
    const fromIso = dateRangeLowerBound(dateRange);
    if (fromIso) {
      filters.push('s.startAt >= @from');
      bind.from = fromIso;
    }

    // Sort enum → AQL clause. `safeSort` is a literal string from a closed
    // set so it can be inlined safely.
    const SORT_MAP = {
      newest:   'SORT s.startAt DESC',
      oldest:   'SORT s.startAt ASC',
      // null durations sort last via secondary key on startAt.
      longest:  'SORT s.durationSeconds == null ? 1 : 0 ASC, s.durationSeconds DESC, s.startAt DESC',
      shortest: 'SORT s.durationSeconds == null ? 1 : 0 ASC, s.durationSeconds ASC, s.startAt DESC',
    };
    const safeSort = SORT_MAP[sort] || SORT_MAP.newest;

    bind.limit = Number(limit);
    bind.offset = Number(offset);

    const query = `
      FOR s IN @@coll
        FILTER ${filters.join(' AND ')}
        ${safeSort}
        LIMIT @offset, @limit
        RETURN s
    `;
    const cursor = await this.db.query(query, bind);
    return cursor.all();
  }

  async getSession({ sessionId, userId }) {
    return this._getSessionRaw(sessionId, userId);
  }

  async listMessages({ sessionId, userId, limit = 500 }) {
    await this._getSessionRaw(sessionId, userId);
    const cursor = await this.db.query(aql`
      FOR m IN ${this.messages}
        FILTER m.sessionId == ${String(sessionId)}
        SORT m.createdAt ASC
        LIMIT ${Number(limit)}
        RETURN m
    `);
    return cursor.all();
  }

  async _getSessionRaw(sessionId, userId) {
    let doc;
    try {
      doc = await this.sessions.document(sessionId);
    } catch (err) {
      const e = new Error('Session not found');
      e.statusCode = 404;
      throw e;
    }
    if (String(doc.userId) !== String(userId)) {
      const e = new Error('Forbidden');
      e.statusCode = 403;
      throw e;
    }
    return doc;
  }
}

const instance = new VoiceSessionService();
module.exports = instance;
