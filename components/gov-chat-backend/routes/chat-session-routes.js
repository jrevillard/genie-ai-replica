const express = require('express');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');
const multer = require('multer');
const authMiddleware = require('../middleware/auth-middleware');
const { logger } = require('../shared-lib');

const ASR_WHISPER_URL = process.env.ASR_WHISPER_URL || 'http://asr-whisper:9100';
const TTS_PIPER_URL = process.env.TTS_PIPER_URL || 'http://tts-piper:9200';
const CHAT_AUDIO_DIR = path.join(
  __dirname,
  '..',
  process.env.UPLOAD_DIR || 'Uploads',
  'chat-audio'
);
const CHAT_AUDIO_PUBLIC_PREFIX = '/Uploads/chat-audio';
const CHAT_AUDIO_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const CHAT_AUDIO_ALLOWED = new Set([
  'audio/wav', 'audio/x-wav', 'audio/wave',
  'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/x-m4a',
]);
const CHAT_AUDIO_EXT = {
  'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/wave': '.wav',
  'audio/webm': '.webm', 'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/m4a': '.m4a', 'audio/x-m4a': '.m4a',
};

try {
  fs.mkdirSync(CHAT_AUDIO_DIR, { recursive: true });
} catch (e) {
  logger.error(`Failed to ensure chat-audio dir ${CHAT_AUDIO_DIR}: ${e.message}`);
}

const audioUpload = multer({
  storage: multer.diskStorage({
    destination: CHAT_AUDIO_DIR,
    filename: (req, file, cb) => {
      const ext = CHAT_AUDIO_EXT[file.mimetype] || '.bin';
      cb(null, `${req.params.sessionId}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: CHAT_AUDIO_MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!CHAT_AUDIO_ALLOWED.has(file.mimetype)) {
      return cb(new Error(`unsupported audio type ${file.mimetype}`));
    }
    cb(null, true);
  },
});

/** Wrap a 16-bit PCM buffer in a RIFF/WAVE header so it plays in any browser. */
function wrapPcmInWav(pcm, sampleRate, channels, bitsPerSample) {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Server-owned chat sessions: create session, send one message; backend loads history and calls ChatQnA.
 */
module.exports = (chatSessionService, deps = {}) => {
  if (!chatSessionService || typeof chatSessionService.createSession !== 'function') {
    throw new Error('chatSessionService is required');
  }
  const aiTwinService = deps.aiTwinService || null;
  const voiceCatalogService = deps.voiceCatalogService || null;

  const router = express.Router();
  router.use(authMiddleware.authenticate);

  function userIdFromReq(req) {
    return req.user._key || req.user.id || req.user.userId;
  }

  /**
   * @swagger
   * /chat-sessions:
   *   post:
   *     summary: Create a new server-side chat session
   *     tags: [Chat Sessions]
   *     security: [ { bearerAuth: [] } ]
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               twinId: { type: string, description: reserved for future AI twin selection }
   *     responses:
   *       201: { description: Created; body includes sessionId }
   */
  router.post('/', async (req, res) => {
    try {
      const userId = userIdFromReq(req);
      if (!userId) {
        return res.status(401).json({ message: 'User id missing' });
      }
      const twinId = req.body?.twinId || null;
      const out = await chatSessionService.createSession(userId, twinId);
      res.status(201).json(out);
    } catch (error) {
      logger.error(`chat-session create: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * @swagger
   * /chat-sessions/{sessionId}/messages:
   *   post:
   *     summary: Send a message; backend loads recent history and calls ChatQnA
   *     tags: [Chat Sessions]
   *     security: [ { bearerAuth: [] } ]
   *     parameters:
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [text]
   *             properties:
   *               text: { type: string }
   *               context:
   *                 type: object
   *                 properties:
   *                   categoryLabel: { type: string }
   *                   serviceLabels:
   *                     type: array
   *                     items: { type: string }
   *                   language: { type: string }
   */
  router.post('/:sessionId/messages', async (req, res) => {
    try {
      const userId = userIdFromReq(req);
      if (!userId) {
        return res.status(401).json({ message: 'User id missing' });
      }
      const { sessionId } = req.params;
      const text = req.body?.text;
      const context = req.body?.context || {};
      const out = await chatSessionService.sendMessage(userId, sessionId, text, context);
      res.json(out);
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({ message: error.message });
      }
      if (error.statusCode === 403) {
        return res.status(403).json({ message: error.message });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({ message: error.message });
      }
      logger.error(`chat-session message: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * @swagger
   * /chat-sessions:
   *   get:
   *     summary: List sessions (caller's by default; admins can filter)
   *     tags: [Chat Sessions]
   *     security: [ { bearerAuth: [] } ]
   *     parameters:
   *       - in: query
   *         name: type
   *         schema: { type: string, enum: [chat, whatsapp] }
   *         description: Filter by channel. Omit to return both.
   *       - in: query
   *         name: scope
   *         schema: { type: string, enum: [me, all] }
   *         description: "me (default) returns the caller's sessions; all requires admin role"
   *       - in: query
   *         name: phoneNumber
   *         schema: { type: string }
   *         description: For type=whatsapp + scope=all, filter to a specific phone
   *       - in: query
   *         name: limit
   *         schema: { type: integer, minimum: 1, maximum: 200, default: 50 }
   *       - in: query
   *         name: offset
   *         schema: { type: integer, minimum: 0, default: 0 }
   *     responses:
   *       200:
   *         description: Array of sessions ordered by updatedAt DESC
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   *                 properties:
   *                   _key: { type: string }
   *                   userId: { type: string }
   *                   type: { type: string, enum: [chat, whatsapp] }
   *                   phoneNumber: { type: string, nullable: true }
   *                   twinId: { type: string, nullable: true }
   *                   createdAt: { type: string, format: date-time }
   *                   updatedAt: { type: string, format: date-time }
   *       401: { description: Unauthenticated }
   *       403: { description: scope=all requires admin }
   *       500: { description: Server error }
   */
  router.get('/', async (req, res) => {
    try {
      const userId = userIdFromReq(req);
      const isAdmin = req.user?.role === 'Admin';
      const scope = req.query.scope === 'all' ? 'all' : 'me';
      if (scope === 'all' && !isAdmin) {
        return res.status(403).json({ message: 'admin role required for scope=all' });
      }
      const type = req.query.type === 'whatsapp' || req.query.type === 'chat' ? req.query.type : null;
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

      const { aql } = require('arangojs');
      const sessions = chatSessionService.sessions;
      const filters = [];
      const bind = { '@coll': 'chatSessions', limit, offset };
      if (scope === 'me') {
        filters.push('s.userId == @uid');
        bind.uid = String(userId);
      }
      if (type) {
        filters.push('s.type == @type');
        bind.type = type;
      }
      if (req.query.phoneNumber) {
        filters.push('s.phoneNumber == @phone');
        bind.phone = String(req.query.phoneNumber);
      }
      const where = filters.length ? `FILTER ${filters.join(' AND ')}` : '';
      const cursor = await chatSessionService.db.query(
        `FOR s IN @@coll ${where} SORT s.updatedAt DESC LIMIT @offset, @limit RETURN s`,
        bind
      );
      const rows = await cursor.all();
      res.json(rows);
    } catch (error) {
      logger.error(`chat-session list: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * @swagger
   * /chat-sessions/{sessionId}/messages:
   *   get:
   *     summary: List messages for a chat session in chronological order
   *     tags: [Chat Sessions]
   *     security: [ { bearerAuth: [] } ]
   *     parameters:
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, minimum: 1, maximum: 1000, default: 500 }
   *       - in: query
   *         name: q
   *         schema: { type: string }
   *         description: Case-insensitive substring search on message content. When set, only matching messages are returned.
   *     responses:
   *       200:
   *         description: Session document plus chronological messages (filtered by q when provided)
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 session: { type: object }
   *                 messages:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       _key: { type: string }
   *                       role: { type: string, enum: [user, assistant] }
   *                       content: { type: string }
   *                       audioUrl: { type: string, nullable: true }
   *                       createdAt: { type: string, format: date-time }
   *       403: { description: Not the owner }
   *       404: { description: Session not found }
   */
  router.get('/:sessionId/messages', async (req, res) => {
    try {
      const userId = userIdFromReq(req);
      const isAdmin = req.user?.role === 'Admin';
      const { sessionId } = req.params;
      let session;
      try {
        session = await chatSessionService.sessions.document(sessionId);
      } catch (e) {
        return res.status(404).json({ message: 'Session not found' });
      }
      if (!isAdmin && String(session.userId) !== String(userId)) {
        return res.status(403).json({ message: 'Not allowed to access this chat session' });
      }
      const limit = Math.min(parseInt(req.query.limit, 10) || 500, 1000);
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const messages = q
        ? await chatSessionService.searchMessages(sessionId, q, limit)
        : await chatSessionService.getRecentMessagesChronological(sessionId, limit);
      res.json({ session, messages });
    } catch (error) {
      logger.error(`chat-session messages list: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * @swagger
   * /chat-sessions/{sessionId}:
   *   delete:
   *     summary: Delete a chat session and all of its messages
   *     tags: [Chat Sessions]
   *     security: [ { bearerAuth: [] } ]
   *     parameters:
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Deleted (returns count of removed messages)
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 deletedMessages: { type: integer }
   *       403: { description: Not the owner }
   *       404: { description: Session not found }
   */
  router.delete('/:sessionId', async (req, res) => {
    try {
      const userId = userIdFromReq(req);
      // Owner check (admins can delete any session); reuses service helper.
      await chatSessionService.getSessionForUser(req.params.sessionId, userId);
      const result = await chatSessionService.deleteSession(req.params.sessionId);
      res.json(result);
    } catch (error) {
      if (error.statusCode === 404) return res.status(404).json({ message: error.message });
      if (error.statusCode === 403) return res.status(403).json({ message: error.message });
      logger.error(`chat-session delete: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * @swagger
   * /chat-sessions/{sessionId}/voice-messages:
   *   post:
   *     summary: Send a voice note. Backend transcribes via ASR, calls ChatQnA, persists both turns.
   *     tags: [Chat Sessions]
   *     security: [ { bearerAuth: [] } ]
   *     parameters:
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             required: [audio]
   *             properties:
   *               audio:
   *                 type: string
   *                 format: binary
   *                 description: wav / webm / ogg / mp3 / m4a, ≤ 10 MB
   *               language: { type: string, default: EN }
   *               categoryLabel: { type: string }
   *               serviceLabels: { type: string, description: "comma-separated" }
   *     responses:
   *       200:
   *         description: Transcript + assistant reply (both stored as messages)
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 sessionId: { type: string }
   *                 userMessage:
   *                   type: object
   *                   properties:
   *                     id: { type: string }
   *                     text: { type: string }
   *                     audioUrl: { type: string }
   *                 assistantMessage:
   *                   type: object
   *                   properties:
   *                     id: { type: string }
   *                     text: { type: string }
   *                 responseTime: { type: integer }
   *                 queryId: { type: string }
   *       400: { description: missing/invalid audio }
   *       413: { description: audio too large }
   *       502: { description: ASR or LLM upstream error }
   */
  router.post('/:sessionId/voice-messages', (req, res, next) => {
    audioUpload.single('audio')(req, res, (err) => {
      if (err) {
        const code = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        return res.status(code).json({ message: err.message || 'upload failed' });
      }
      next();
    });
  }, async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ message: 'audio file is required (form field "audio")' });
    }
    const cleanup = () => { try { fs.unlinkSync(req.file.path); } catch {} };
    try {
      // ASR: forward the saved file to whisper as multipart.
      const language = (req.body.language || 'EN').toLowerCase().slice(0, 2);
      const form = new FormData();
      form.append('file', fs.createReadStream(req.file.path), {
        filename: req.file.originalname || req.file.filename,
        contentType: req.file.mimetype,
      });
      form.append('language', language);
      let transcript = '';
      try {
        const asrResp = await axios.post(`${ASR_WHISPER_URL}/v1/microservice/asr`, form, {
          headers: form.getHeaders(),
          timeout: 60000,
        });
        transcript = (asrResp.data && asrResp.data.text) ? String(asrResp.data.text).trim() : '';
      } catch (asrErr) {
        cleanup();
        logger.error(`voice-message ASR failed: ${asrErr.message}`);
        return res.status(502).json({ message: 'ASR failed', detail: asrErr.message });
      }
      if (!transcript) {
        cleanup();
        return res.status(400).json({ message: 'Audio could not be transcribed (silent or unsupported)' });
      }

      const userId = userIdFromReq(req);
      const audioUrl = `${CHAT_AUDIO_PUBLIC_PREFIX}/${req.file.filename}`;
      const ctx = {
        categoryLabel: req.body.categoryLabel || 'General',
        serviceLabels: req.body.serviceLabels
          ? String(req.body.serviceLabels).split(',').map((s) => s.trim()).filter(Boolean)
          : [],
        language: req.body.language || 'EN',
      };

      const result = await chatSessionService.sendMessage(
        userId,
        req.params.sessionId,
        transcript,
        ctx,
        { userAudioUrl: audioUrl }
      );

      res.json({
        sessionId: result.sessionId,
        userMessage: { id: result.userMessageId, text: transcript, audioUrl },
        assistantMessage: { id: result.assistantMessageId, text: result.response },
        responseTime: result.responseTime,
        queryId: result.queryId,
      });
    } catch (error) {
      cleanup();
      if (error.statusCode === 404) return res.status(404).json({ message: error.message });
      if (error.statusCode === 403) return res.status(403).json({ message: error.message });
      if (error.statusCode === 400) return res.status(400).json({ message: error.message });
      logger.error(`voice-message: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * @swagger
   * /chat-sessions/{sessionId}/messages/{messageId}/audio:
   *   get:
   *     summary: Synthesize audio for an assistant message using the session twin's voice (assistant only)
   *     tags: [Chat Sessions]
   *     security: [ { bearerAuth: [] } ]
   *     parameters:
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: messageId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: WAV audio stream synthesized via Piper
   *         content:
   *           audio/wav: {}
   *       400: { description: Message is a user message (not an assistant message) }
   *       404: { description: Message / twin / voice not found }
   *       502: { description: TTS upstream error }
   */
  router.get('/:sessionId/messages/:messageId/audio', async (req, res) => {
    try {
      const userId = userIdFromReq(req);
      const session = await chatSessionService.getSessionForUser(req.params.sessionId, userId);
      const msg = await chatSessionService.getMessage(req.params.sessionId, req.params.messageId);

      // Only assistant messages can be synthesized here. User messages already
      // carry their original recording at `audioUrl` if needed.
      if (msg.role !== 'assistant') {
        return res.status(400).json({ message: 'Audio playback only available for assistant messages' });
      }

      // Assistant: synthesize via the session twin's voice.
      if (!aiTwinService || !voiceCatalogService) {
        return res.status(503).json({ message: 'TTS not configured' });
      }
      if (!session.twinId) {
        return res.status(404).json({ message: 'Session has no twin assigned' });
      }
      let twin;
      try {
        twin = await aiTwinService.getTwinByKey(session.twinId);
      } catch (e) {
        return res.status(404).json({ message: 'Twin not found for this session' });
      }
      if (!twin.voiceId) {
        return res.status(404).json({ message: 'Twin has no voice assigned' });
      }
      const voice = await voiceCatalogService.getVoice(twin.voiceId);
      if (!voice) return res.status(404).json({ message: 'Voice not found in catalog' });

      const upstream = await axios.post(
        `${TTS_PIPER_URL}/v1/microservice/tts`,
        { text: msg.content, language: voice.language, voice: voice.modelVoiceId },
        { responseType: 'arraybuffer', timeout: 60000 }
      );
      const sampleRate = parseInt(upstream.headers['x-sample-rate'], 10) || 22050;
      const wav = wrapPcmInWav(Buffer.from(upstream.data), sampleRate, 1, 16);
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('X-Sample-Rate', String(sampleRate));
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Length', String(wav.length));
      res.send(wav);
    } catch (error) {
      if (error.statusCode === 404) return res.status(404).json({ message: error.message });
      if (error.statusCode === 403) return res.status(403).json({ message: error.message });
      logger.error(`message audio: ${error.message}`, { stack: error.stack });
      res.status(error.response?.status || 500).json({ message: error.message });
    }
  });

  return router;
};
