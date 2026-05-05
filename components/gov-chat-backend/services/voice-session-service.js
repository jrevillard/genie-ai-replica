const { aql } = require('arangojs');
const { logger, dbService } = require('../shared-lib');

const SESSIONS_COLLECTION = 'call_sessions';
const MESSAGES_COLLECTION = 'call_messages';
const SUPPORTED_LANGUAGES = ['fr', 'en', 'es', 'sw'];

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

  async listSessions({ userId, limit = 50, offset = 0 }) {
    const cursor = await this.db.query(aql`
      FOR s IN ${this.sessions}
        FILTER s.userId == ${String(userId)}
        SORT s.startAt DESC
        LIMIT ${Number(offset)}, ${Number(limit)}
        RETURN s
    `);
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
