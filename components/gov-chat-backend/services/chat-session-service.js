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

  async appendMessage(sessionId, role, content) {
    const now = new Date().toISOString();
    await this.sessionMessages.save({
      sessionId,
      role: role === 'assistant' ? 'assistant' : 'user',
      content: content == null ? '' : String(content),
      createdAt: now,
    });
    await this.sessions.update(sessionId, { updatedAt: now });
  }

  /**
   * @param {string} userId
   * @param {string} sessionId
   * @param {string} text
   * @param {object} context { categoryLabel, serviceLabels, language }
   */
  async sendMessage(userId, sessionId, text, context) {
    if (!this.queryService || typeof this.queryService.executeChatqnaTurn !== 'function') {
      throw new Error('QueryService.executeChatqnaTurn is not available');
    }
    const t = typeof text === 'string' ? text.trim() : '';
    if (!t) {
      throw new ValidationError('Message text is required');
    }
    await this.getSessionForUser(sessionId, userId);

    const maxH = historyLimit();
    const history = await this.getRecentMessagesChronological(sessionId, maxH);
    const opeaMessages = [...history, { role: 'user', content: t }];

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

    await this.appendMessage(sessionId, 'user', t);
    const reply = result.response == null ? '' : String(result.response);
    await this.appendMessage(sessionId, 'assistant', reply);

    return {
      queryId: result.queryId,
      response: result.response,
      metadata: result.metadata,
      responseTime: result.responseTime,
      sessionId,
    };
  }
}

module.exports = new ChatSessionService();
