const express = require('express');
const Joi = require('joi');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const { logger } = require('../shared-lib');

// Languages with at least one Piper TTS voice in the deployment catalog. Must
// stay in sync with constants/chat-languages.js (the entries flagged
// isVoiceSupported: true) and genie-ai-overlay/voice-bridge's
// DEFAULT_VOICE_BY_LANGUAGE map.
const SUPPORTED_LANGUAGES = ['en', 'fr', 'es', 'sw', 'ar', 'de', 'hi', 'id', 'pt', 'ru', 'zh'];

const tokenSchema = Joi.object({
  language: Joi.string().valid(...SUPPORTED_LANGUAGES).default('en'),
  // Optional. When set, voice-bridge looks up this twin in ArangoDB and uses
  // its voiceId, callGreeting and persona for the live call.
  twinId: Joi.string().trim().max(200).optional()
});

// UI-friendly enums for date range + sort. Backend translates these into the
// concrete startAt bounds and AQL sort clause.
const DATE_RANGES = ['all', 'today', 'last7', 'last30'];
const SORT_OPTIONS = ['newest', 'oldest', 'longest', 'shortest'];

const listSessionsSchema = Joi.object({
  limit:  Joi.number().integer().min(1).max(200).default(50),
  offset: Joi.number().integer().min(0).default(0),
  // Filters — all optional; combined with AND.
  twinId:    Joi.string().trim().max(200),
  language:  Joi.string().valid(...SUPPORTED_LANGUAGES),
  dateRange: Joi.string().valid(...DATE_RANGES).default('all'),
  sort:      Joi.string().valid(...SORT_OPTIONS).default('newest'),
  // Admin-only: scope=all returns every user's sessions; userId narrows to a
  // specific user. Non-admin callers always see only their own sessions
  // regardless of these params (enforced in the route handler).
  scope:     Joi.string().valid('me', 'all'),
  userId:    Joi.string().trim().max(200),
});

function getUserId(req) {
  return req.user._key || req.user.id || req.user.userId;
}

module.exports = (voiceTokenService, voiceSessionService) => {
  const tokenReady = voiceTokenService && voiceTokenService.initialized;
  const sessionReady = voiceSessionService && voiceSessionService.initialized;
  if (!tokenReady && !sessionReady) {
    logger.warn('voice-routes: neither VoiceTokenService nor VoiceSessionService initialized — /api/voice/* will return 503');
    router.use((req, res) => res.status(503).json({ message: 'Voice service unavailable' }));
    return router;
  }
  if (!tokenReady) {
    logger.warn('voice-routes: VoiceTokenService is not initialized — /api/voice/token will return 503');
  }
  if (!sessionReady) {
    logger.warn('voice-routes: VoiceSessionService is not initialized — /api/voice/sessions/* will return 503');
  }

  /**
   * @swagger
   * tags:
   *   - name: Voice
   *     description: Real-time voice call (read-only API; sessions and transcripts are written internally by the voice-bridge)
   *
   * components:
   *   schemas:
   *     CallSession:
   *       type: object
   *       properties:
   *         _key: { type: string }
   *         userId: { type: string }
   *         language: { type: string, enum: [fr, en, es, sw] }
   *         gender: { type: string, enum: [female, male] }
   *         startAt: { type: string, format: date-time }
   *         endAt: { type: string, format: date-time, nullable: true }
   *         durationSeconds: { type: integer, nullable: true }
   *         recordingUrl:
   *           type: string
   *           nullable: true
   *           description: "Public path to the call recording WAV (set when the call ends). Served by the backend at this URL."
   *         createdAt: { type: string, format: date-time }
   *     CallMessage:
   *       type: object
   *       properties:
   *         _key: { type: string }
   *         sessionId: { type: string }
   *         content: { type: string }
   *         isAssistant: { type: boolean, description: "true = agent reply, false = user transcript" }
   *         createdAt: { type: string, format: date-time }
   */

  /**
   * @swagger
   * /voice/token:
   *   post:
   *     summary: Mint a short-lived signed voice token (used by the client to open the voice WebSocket)
   *     tags: [Voice]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               language:
   *                 type: string
   *                 enum: [en, fr, es, sw, ar, de, hi, id, pt, ru, zh]
   *                 default: en
   *                 description: >-
   *                   Must be a language with a Piper TTS voice on this deployment
   *                   (see GET /chat-sessions/languages → isVoiceSupported).
   *               twinId:
   *                 type: string
   *                 description: Optional twin to call. Without this the default twin is used.
   *     responses:
   *       200:
   *         description: WebSocket info plus a signed voice token
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 wsUrl: { type: string }
   *                 voiceToken: { type: string, description: "Signed JWT to send in the WS start message" }
   *                 expiresIn: { type: integer, description: "Token lifetime in seconds" }
   *                 language: { type: string }
   *                 identity: { type: string }
   *                 fullName: { type: string }
   *       401: { description: Unauthenticated }
   *       503: { description: Voice service unavailable }
   */
  router.post('/token', authMiddleware.authenticate, async (req, res) => {
    if (!tokenReady) return res.status(503).json({ message: 'Voice token service unavailable' });
    const { value, error } = tokenSchema.validate(req.body || {}, { stripUnknown: true });
    if (error) return res.status(400).json({ message: error.details[0].message });
    try {
      const userId = getUserId(req);
      const fullName = req.user.personalIdentification?.fullName || req.user.loginName || userId;
      const result = await voiceTokenService.mintToken({
        userId,
        fullName,
        language: value.language,
        twinId: value.twinId,
      });
      return res.json(result);
    } catch (err) {
      logger.error(`voice/token error: ${err.message}`, { stack: err.stack });
      return res.status(500).json({ message: 'Failed to mint voice token' });
    }
  });

  /**
   * @swagger
   * /voice/sessions:
   *   get:
   *     summary: List the caller's voice call sessions with optional filters + sort
   *     tags: [Voice]
   *     security: [ { bearerAuth: [] } ]
   *     parameters:
   *       - in: query
   *         name: limit
   *         schema: { type: integer, minimum: 1, maximum: 200, default: 50 }
   *       - in: query
   *         name: offset
   *         schema: { type: integer, minimum: 0, default: 0 }
   *       - in: query
   *         name: twinId
   *         schema: { type: string }
   *         description: Only sessions placed against this twin.
   *       - in: query
   *         name: language
   *         schema: { type: string, enum: [en, fr, es, sw] }
   *         description: Filter by call language.
   *       - in: query
   *         name: dateRange
   *         schema: { type: string, enum: [all, today, last7, last30], default: all }
   *         description: >-
   *           `today` = since 00:00 UTC today, `last7` = last 7 days,
   *           `last30` = last 30 days, `all` = no date bound.
   *       - in: query
   *         name: sort
   *         schema: { type: string, enum: [newest, oldest, longest, shortest], default: newest }
   *         description: >-
   *           `newest` / `oldest` sort by startAt; `longest` / `shortest` by
   *           durationSeconds (in-progress calls without a duration sort last).
   *       - in: query
   *         name: scope
   *         schema: { type: string, enum: [me, all] }
   *         description: "Admin-only — `all` returns every user's calls. Default is the caller's own."
   *       - in: query
   *         name: userId
   *         schema: { type: string }
   *         description: "Admin-only — filter calls to a specific user's userId (auto-implies scope=all)."
   *     responses:
   *       200:
   *         description: Filtered sessions
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items: { $ref: '#/components/schemas/CallSession' }
   */
  router.get('/sessions', authMiddleware.authenticate, async (req, res) => {
    if (!sessionReady) return res.status(503).json({ message: 'Voice session service unavailable' });
    const { value, error } = listSessionsSchema.validate(req.query || {}, { stripUnknown: true });
    if (error) return res.status(400).json({ message: error.details[0].message });
    try {
      const callerId = getUserId(req);
      const isAdmin = req.user?.role === 'Admin';

      // Setting userId=... implicitly means scope=all. Both require admin.
      const wantsBroaderScope = value.scope === 'all' || !!value.userId;
      if (wantsBroaderScope && !isAdmin) {
        return res.status(403).json({
          message: value.userId
            ? 'admin role required to filter by userId'
            : 'admin role required for scope=all',
        });
      }

      // Resolve the effective userId filter passed to the service:
      //   - non-admin: always caller's own
      //   - admin + userId=X: filter to that user
      //   - admin + scope=all: no userId filter
      //   - admin default: caller's own (parity with the chat-sessions endpoint)
      let filterUserId = callerId;
      if (isAdmin) {
        if (value.userId) filterUserId = value.userId;
        else if (value.scope === 'all') filterUserId = null;
      }

      const sessions = await voiceSessionService.listSessions({
        userId: filterUserId,
        twinId: value.twinId,
        language: value.language,
        dateRange: value.dateRange,
        sort: value.sort,
        limit: value.limit,
        offset: value.offset,
      });
      return res.json(sessions);
    } catch (err) {
      logger.error(`voice/sessions GET error: ${err.message}`, { stack: err.stack });
      return res.status(500).json({ message: 'Failed to list sessions' });
    }
  });

  /**
   * @swagger
   * /voice/sessions/{sessionId}:
   *   get:
   *     summary: Fetch a single voice call session by id
   *     tags: [Voice]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Session document
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/CallSession' }
   *       403: { description: Forbidden — not the owner }
   *       404: { description: Session not found }
   */
  router.get('/sessions/:sessionId', authMiddleware.authenticate, async (req, res) => {
    if (!sessionReady) return res.status(503).json({ message: 'Voice session service unavailable' });
    try {
      const userId = getUserId(req);
      const session = await voiceSessionService.getSession({ sessionId: req.params.sessionId, userId });
      return res.json(session);
    } catch (err) {
      const status = err.statusCode || 500;
      if (status >= 500) {
        logger.error(`voice/sessions/:id GET error: ${err.message}`, { stack: err.stack });
      }
      return res.status(status).json({ message: err.message || 'Failed to get session' });
    }
  });

  /**
   * @swagger
   * /voice/sessions/{sessionId}/messages:
   *   get:
   *     summary: Fetch messages for a voice call session in chronological order
   *     tags: [Voice]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, minimum: 1, maximum: 1000, default: 500 }
   *     responses:
   *       200:
   *         description: Array of messages
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items: { $ref: '#/components/schemas/CallMessage' }
   */
  router.get('/sessions/:sessionId/messages', authMiddleware.authenticate, async (req, res) => {
    if (!sessionReady) return res.status(503).json({ message: 'Voice session service unavailable' });
    try {
      const userId = getUserId(req);
      const limit = Math.min(Number(req.query.limit) || 500, 1000);
      const messages = await voiceSessionService.listMessages({
        sessionId: req.params.sessionId,
        userId,
        limit
      });
      return res.json(messages);
    } catch (err) {
      const status = err.statusCode || 500;
      if (status >= 500) {
        logger.error(`voice/sessions/:id/messages GET error: ${err.message}`, { stack: err.stack });
      }
      return res.status(status).json({ message: err.message || 'Failed to list messages' });
    }
  });

  return router;
};
