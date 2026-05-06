const { aql } = require('arangojs');
const { logger, dbService, ensureCollection } = require('../shared-lib');
const { NotFoundError, ValidationError, ForbiddenError } = require('../middleware/errors');

const SESSIONS = 'chatSessions';
const MESSAGES = 'chatSessionMessages';

/** Max messages loaded from DB for context (default 10 ≈ 5 user+assistant pairs). */
function historyLimit() {
  const n = parseInt(process.env.CHAT_SESSION_HISTORY_MESSAGE_LIMIT || '10', 10);
  return Math.min(Math.max(Number.isFinite(n) ? n : 10, 2), 50);
}

/**
 * Server-owned chat sessions: messages stored in Arango; each send loads recent history
 * and calls ChatQnA (system prompt remains in the genie-ai-overlay service, not here).
 */
class ChatSessionService {
  constructor() {
    this.db = null;
    this.sessions = null;
    this.sessionMessages = null;
    this.queryService = null;
    this.initialized = false;
  }

  setQueryService(queryService) {
    this.queryService = queryService;
  }

  async init() {
    if (this.initialized) return;
    this.db = await dbService.getConnection('default');
    await ensureCollection(this.db, SESSIONS);
    await ensureCollection(this.db, MESSAGES);
    this.sessions = this.db.collection(SESSIONS);
    this.sessionMessages = this.db.collection(MESSAGES);
    this.initialized = true;
    logger.info('ChatSessionService initialized');
  }

  _uid(userId) {
    return String(userId || '').replace(/^users\//, '');
  }

  /**
   * @param {string} userId
   * @param {string} [twinId] reserved for next phase
   */
  async createSession(userId, twinId = null) {
    if (!this.queryService) {
      throw new Error('QueryService not wired to ChatSessionService');
    }
    const uid = this._uid(userId);
    if (!uid) {
      throw new ValidationError('userId is required');
    }
    const now = new Date().toISOString();
    const doc = {
      userId: uid,
      createdAt: now,
      updatedAt: now,
      twinId: twinId || null,
      // Channel: 'chat' = web chat page, 'whatsapp' = WhatsApp service.
      // Existing rows without this field are treated as 'chat' by readers.
      type: 'chat',
    };
    const meta = await this.sessions.save(doc);
    const sessionId = meta._key;
    logger.info(`ChatSessionService created session ${sessionId} user=${uid}`);
    return { sessionId, userId: uid, createdAt: now, twinId: doc.twinId };
  }

  async getSessionForUser(sessionId, userId) {
    const uid = this._uid(userId);
    let doc;
    try {
      doc = await this.sessions.document(sessionId);
    } catch (e) {
      if (e.errorNum === 1202) throw new NotFoundError('Chat session not found');
      throw e;
    }
    if (doc.userId !== uid) {
      throw new ForbiddenError('Not allowed to access this chat session');
    }
    return doc;
  }

  /**
   * Recent messages, oldest first, for OPEA. Excludes the turn about to be added.
   * @param {string} sessionId
   * @param {number} maxMessages
   * @returns {Promise<Array<{ role: string, content: string }>>}
   */
  async getRecentMessagesChronological(sessionId, maxMessages) {
    const lim = maxMessages;
    const cursor = await this.db.query(
      aql`
        FOR m IN ${this.sessionMessages}
          FILTER m.sessionId == ${sessionId}
          SORT m.createdAt DESC
          LIMIT ${lim}
          RETURN m
      `
    );
    const rows = await cursor.all();
    rows.reverse();
    return rows.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content == null ? '' : String(m.content),
    }));
  }

  /**
   * Append a single message to a session.
   * @param {string} sessionId
   * @param {string} role  'user' | 'assistant'
   * @param {string} content
   * @param {{ audioUrl?: string }} [extra]  optional fields to attach
   *   (e.g. `audioUrl` when the user sent a voice note).
   * @returns {Promise<string>} the new message _key
   */
  async appendMessage(sessionId, role, content, extra = {}) {
    const now = new Date().toISOString();
    const doc = {
      sessionId,
      role: role === 'assistant' ? 'assistant' : 'user',
      content: content == null ? '' : String(content),
      createdAt: now,
    };
    if (extra && typeof extra.audioUrl === 'string' && extra.audioUrl) {
      doc.audioUrl = extra.audioUrl;
    }
    const meta = await this.sessionMessages.save(doc);
    await this.sessions.update(sessionId, { updatedAt: now });
    return meta._key;
  }

  /**
   * Delete a chat session and all of its messages. Owner-only via the route.
   * @param {string} sessionId
   * @returns {Promise<{ deletedMessages: number }>}
   */
  async deleteSession(sessionId) {
    const result = await this.db.query(
      aql`
        FOR m IN ${this.sessionMessages}
          FILTER m.sessionId == ${sessionId}
          REMOVE m IN ${this.sessionMessages}
          COLLECT WITH COUNT INTO n
          RETURN n
      `
    );
    const [deletedMessages] = await result.all();
    try {
      await this.sessions.remove(sessionId);
    } catch (e) {
      if (e.errorNum === 1202) {
        throw new NotFoundError('Chat session not found');
      }
      throw e;
    }
    logger.info(`ChatSession deleted ${sessionId} (messages=${deletedMessages || 0})`);
    return { deletedMessages: deletedMessages || 0 };
  }

  /**
   * Search messages in a session by content (case-insensitive LIKE).
   * @param {string} sessionId
   * @param {string} q
   * @param {number} [limit=200]
   */
  async searchMessages(sessionId, q, limit = 200) {
    const lim = Math.min(Math.max(Number(limit) || 200, 1), 1000);
    const needle = String(q || '').trim().toLowerCase();
    if (!needle) return [];
    const pattern = `%${needle.replace(/([%_\\])/g, '\\$1')}%`;
    const cursor = await this.db.query(
      aql`
        FOR m IN ${this.sessionMessages}
          FILTER m.sessionId == ${sessionId}
          FILTER LIKE(LOWER(m.content), ${pattern}, true)
          SORT m.createdAt ASC
          LIMIT ${lim}
          RETURN m
      `
    );
    const rows = await cursor.all();
    return rows.map((m) => ({
      _key: m._key,
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content == null ? '' : String(m.content),
      audioUrl: m.audioUrl || null,
      createdAt: m.createdAt,
    }));
  }

  /** Look up a single message by _key, scoped to a session. */
  async getMessage(sessionId, messageKey) {
    let doc;
    try {
      doc = await this.sessionMessages.document(messageKey);
    } catch (e) {
      if (e.errorNum === 1202) {
        const err = new NotFoundError('Message not found');
        throw err;
      }
      throw e;
    }
    if (String(doc.sessionId) !== String(sessionId)) {
      const err = new NotFoundError('Message not found in this session');
      throw err;
    }
    return doc;
  }

  /**
   * @param {string} userId
   * @param {string} sessionId
   * @param {string} text
   * @param {object} context { categoryLabel, serviceLabels, language }
   * @param {{ userAudioUrl?: string }} [options]  attach audioUrl to the
   *   newly-stored user message (for voice notes); does not affect history
   *   sent to chatqna.
   */
  async sendMessage(userId, sessionId, text, context, options = {}) {
    if (!this.queryService || typeof this.queryService.executeChatqnaTurn !== 'function') {
      throw new Error('QueryService.executeChatqnaTurn is not available');
    }
    const t = typeof text === 'string' ? text.trim() : '';
    if (!t) {
      throw new ValidationError('Message text is required');
    }
    const session = await this.getSessionForUser(sessionId, userId);

    const maxH = historyLimit();
    const history = await this.getRecentMessagesChronological(sessionId, maxH);

    // Twin directives: prepend one system message that includes personality and
    // admin instructions. Instructions are appended after personality inside
    // the same fragment so they sit at the end of the generated prompt text.
    // Best-effort — if we can't load the twin (legacy session, twin deleted)
    // we skip the directive.
    const opeaMessages = [];
    if (session.twinId) {
      try {
        const aiTwinService = require('./ai-twin-service');
        const twin = await aiTwinService.getTwinByKey(session.twinId);
        const directive = aiTwinService.buildTwinPromptFragment(twin);
        if (directive) opeaMessages.push({ role: 'system', content: directive });
      } catch (e) {
        logger.warn(`twin prompt lookup failed for session ${sessionId}: ${e.message}`);
      }
    }
    opeaMessages.push(...history, { role: 'user', content: t });

    const ctx = {
      categoryLabel: context?.categoryLabel || 'General',
      serviceLabels: Array.isArray(context?.serviceLabels) ? context.serviceLabels : [],
      language: context?.language || 'EN',
    };

    const result = await this.queryService.executeChatqnaTurn({
      userId: this._uid(userId),
      sessionId,
      messages: opeaMessages,
      context: ctx,
      chatSessionId: sessionId,
    });

    const userMessageKey = await this.appendMessage(
      sessionId,
      'user',
      t,
      options && options.userAudioUrl ? { audioUrl: options.userAudioUrl } : {}
    );
    const reply = result.response == null ? '' : String(result.response);
    const assistantMessageKey = await this.appendMessage(sessionId, 'assistant', reply);

    return {
      queryId: result.queryId,
      response: result.response,
      metadata: result.metadata,
      responseTime: result.responseTime,
      sessionId,
      userMessageId: userMessageKey,
      assistantMessageId: assistantMessageKey,
    };
  }
}

module.exports = new ChatSessionService();
