/**
 * Public guest routes — no authentication.
 *
 * Mirrors a narrow subset of the authenticated API so a shareable link can let
 * a stranger chat / call the project's default AI twin without signing in.
 *
 * Hard constraints applied here:
 *   - All endpoints unauthenticated. We never trust user-provided ids that
 *     could leak someone else's data — sessions created via this router are
 *     stamped with `userId = "guest:<random>"` and access is allowed only
 *     when the row's userId starts with "guest:".
 *   - Twin is locked to the default twin. Other twins are not reachable via
 *     /api/public/*; callers can only see their data via the auth'd routes.
 *   - Existing authenticated routes are untouched.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../shared-lib');
const aiTwinService = require('../services/ai-twin-service');
const chatSessionService = require('../services/chat-session-service');
const voiceTokenService = require('../services/voice-token-service');
const voiceCatalogService = require('../services/voice-catalog-service');
const { NotFoundError, ValidationError } = require('../middleware/errors');

const ASR_WHISPER_URL = process.env.ASR_WHISPER_URL || 'http://asr-whisper:9100';
const TTS_PIPER_URL = process.env.TTS_PIPER_URL || 'http://tts-piper:9200';

// --- voice-message multipart upload (same shape as chat-session-routes) ---
const CHAT_AUDIO_DIR = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'Uploads', 'chat-audio');
const CHAT_AUDIO_PUBLIC_PREFIX = '/Uploads/chat-audio';
const CHAT_AUDIO_MAX_BYTES = 10 * 1024 * 1024;
const CHAT_AUDIO_ALLOWED = new Set([
  'audio/wav', 'audio/x-wav', 'audio/wave',
  'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/x-m4a',
]);
const CHAT_AUDIO_EXT = {
  'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/wave': '.wav',
  'audio/webm': '.webm', 'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/m4a': '.m4a', 'audio/x-m4a': '.m4a',
};
try { fs.mkdirSync(CHAT_AUDIO_DIR, { recursive: true }); } catch (_) {}

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

const CHAT_AUDIO_MIME_BY_EXT = {
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
};

/** Resolve a stored audioUrl to a disk path inside CHAT_AUDIO_DIR (path-traversal safe). */
function resolveUserAudioPath(audioUrl) {
  if (!audioUrl || typeof audioUrl !== 'string') return null;
  if (!audioUrl.startsWith(`${CHAT_AUDIO_PUBLIC_PREFIX}/`)) return null;
  const filename = path.basename(audioUrl.slice(CHAT_AUDIO_PUBLIC_PREFIX.length + 1));
  if (!filename || filename.includes('..') || filename.includes('/')) return null;
  const abs = path.join(CHAT_AUDIO_DIR, filename);
  if (!abs.startsWith(`${CHAT_AUDIO_DIR}${path.sep}`) && abs !== CHAT_AUDIO_DIR) return null;
  return abs;
}

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

// --- guards ---

/** Generate a fresh guest userId for a brand-new session. */
function newGuestId() {
  return `guest:${uuidv4()}`;
}

/** Resolve the default twin _key. Throws 503 when no default has been seeded. */
async function getDefaultTwinKey() {
  const twin = await aiTwinService.getDefaultTwin();
  if (!twin) {
    const err = new Error('Public chat is not configured (no default twin)');
    err.statusCode = 503;
    throw err;
  }
  return twin._key;
}

/**
 * Load a chatSessions row by id and reject if it isn't a public/guest session.
 * Used to scope access on /public — guests can never read a logged-in user's
 * session even if they guess the id.
 */
async function loadGuestSession(sessionId) {
  let doc;
  try {
    doc = await chatSessionService.sessions.document(sessionId);
  } catch (e) {
    const err = new NotFoundError('Chat session not found');
    err.statusCode = 404;
    throw err;
  }
  if (typeof doc.userId !== 'string' || !doc.userId.startsWith('guest:')) {
    // Authenticated user's session — never expose via /public.
    const err = new NotFoundError('Chat session not found');
    err.statusCode = 404;
    throw err;
  }
  return doc;
}

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Public (Guest)
 *     description: Unauthenticated guest endpoints — chat & call against the project's default AI twin via shareable link. No login required. Limited to the default twin only.
 */

/* =========================================================================
   GET /api/public/chat-sessions/languages
   ------------------------------------------------------------------------- */
/**
 * @swagger
 * /public/chat-sessions/languages:
 *   get:
 *     summary: List supported chat languages (translator coverage) — same list as the authed endpoint
 *     tags: [Public (Guest)]
 *     responses:
 *       200:
 *         description: Languages
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   code: { type: string, example: en }
 *                   name: { type: string, example: English }
 */
router.get('/chat-sessions/languages', (req, res) => {
  const { CHAT_LANGUAGES } = require('../constants/chat-languages');
  res.json(CHAT_LANGUAGES);
});

/* =========================================================================
   GET /api/public/ai-twins   (sanitized public directory of twins)
   ------------------------------------------------------------------------- */
/**
 * @swagger
 * /public/ai-twins:
 *   get:
 *     summary: List all AI twins (public directory — no admin fields)
 *     tags: [Public (Guest)]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 50 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, minimum: 0, default: 0 }
 *     responses:
 *       200:
 *         description: Sanitized twin list with pagination metadata
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 total:  { type: integer }
 *                 offset: { type: integer }
 *                 limit:  { type: integer }
 *                 twins:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       _key:        { type: string }
 *                       name:        { type: string }
 *                       description: { type: string }
 */
router.get('/ai-twins', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const { twins, total } = await aiTwinService.listTwins({ limit, offset });
    res.json({
      total,
      offset,
      limit,
      twins: twins.map((t) => ({
        _key: t._key,
        name: t.name,
        description: t.description,
      })),
    });
  } catch (error) {
    logger.error(`public list twins: ${error.message}`, { stack: error.stack });
    res.status(500).json({ message: error.message });
  }
});

/* =========================================================================
   GET /api/public/ai-twins/:id
   ------------------------------------------------------------------------- */
/**
 * @swagger
 * /public/ai-twins/{id}:
 *   get:
 *     summary: Read a public AI twin by id
 *     tags: [Public (Guest)]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Sanitized twin (same fields as the list endpoint)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 _key:        { type: string }
 *                 name:        { type: string }
 *                 description: { type: string }
 *       404: { description: Twin not found }
 */
router.get('/ai-twins/:id', async (req, res) => {
  try {
    const twin = await aiTwinService.getTwinByKey(req.params.id);
    res.json({
      _key: twin._key,
      name: twin.name,
      description: twin.description,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    if (status === 404) return res.status(404).json({ message: 'Twin not found' });
    logger.error(`public ai-twin: ${error.message}`, { stack: error.stack });
    res.status(500).json({ message: error.message });
  }
});

/* =========================================================================
   POST /api/public/chat-sessions   (create a guest session)
   ------------------------------------------------------------------------- */
/**
 * @swagger
 * /public/chat-sessions:
 *   post:
 *     summary: Create a new guest chat session against any twin (defaults to the default twin)
 *     tags: [Public (Guest)]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               twinId:
 *                 type: string
 *                 description: Optional. When omitted the session targets the default twin.
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 sessionId: { type: string }
 *                 guestId:   { type: string, description: "Synthetic id stamped on the session" }
 *                 twinId:    { type: string }
 *                 createdAt: { type: string, format: date-time }
 *       400: { description: Provided twinId does not exist }
 *       503: { description: No default twin configured (and no twinId provided) }
 */
router.post('/chat-sessions', async (req, res) => {
  try {
    // Pick the twin: explicit body.twinId wins; otherwise fall back to the default.
    // Validate either way so the session never points at a non-existent twin.
    let twinId = req.body?.twinId;
    if (twinId) {
      try {
        await aiTwinService.getTwinByKey(String(twinId));
      } catch (e) {
        return res.status(400).json({ message: 'twinId does not exist' });
      }
      twinId = String(twinId);
    } else {
      twinId = await getDefaultTwinKey();
    }

    const guestId = newGuestId();
    // Write the session doc directly so the userId keeps the "guest:" prefix
    // that loadGuestSession() relies on (chatSessionService.createSession would
    // strip it via its internal _uid() helper).
    const now = new Date().toISOString();
    const meta = await chatSessionService.sessions.save({
      userId: guestId,
      twinId,
      type: 'chat',
      createdAt: now,
      updatedAt: now,
    });
    res.status(201).json({
      sessionId: meta._key,
      guestId,
      twinId,
      createdAt: now,
    });
  } catch (error) {
    if (error.statusCode === 503) return res.status(503).json({ message: error.message });
    logger.error(`public create session: ${error.message}`, { stack: error.stack });
    res.status(500).json({ message: error.message });
  }
});

/* =========================================================================
   POST /api/public/chat-sessions/:sessionId/messages   (text turn)
   ------------------------------------------------------------------------- */
/**
 * @swagger
 * /public/chat-sessions/{sessionId}/messages:
 *   post:
 *     summary: Send a text message in a guest session and get the assistant reply
 *     tags: [Public (Guest)]
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
 *                   serviceLabels: { type: array, items: { type: string } }
 *                   language: { type: string, default: EN }
 *     responses:
 *       200:
 *         description: Assistant reply with both turns persisted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 sessionId:          { type: string }
 *                 userMessageId:      { type: string }
 *                 assistantMessageId: { type: string }
 *                 response:           { type: string, description: assistant reply text }
 *                 responseTime:       { type: integer, description: ms }
 *                 queryId:            { type: string, nullable: true }
 *       400: { description: Missing or invalid text }
 *       404: { description: Session not found / not a guest session }
 *       500: { description: Internal error (LLM upstream, persistence, etc.) }
 */
router.post('/chat-sessions/:sessionId/messages', async (req, res) => {
  try {
    const session = await loadGuestSession(req.params.sessionId);
    const text = req.body?.text;
    const context = req.body?.context || {};
    const out = await chatSessionService.sendMessage(
      session.userId,
      req.params.sessionId,
      text,
      context
    );
    res.json(out);
  } catch (error) {
    if (error.statusCode === 404) return res.status(404).json({ message: error.message });
    if (error.statusCode === 400) return res.status(400).json({ message: error.message });
    logger.error(`public send message: ${error.message}`, { stack: error.stack });
    res.status(500).json({ message: error.message });
  }
});

/* =========================================================================
   GET /api/public/chat-sessions/:sessionId/messages   (history)
   ------------------------------------------------------------------------- */
/**
 * @swagger
 * /public/chat-sessions/{sessionId}/messages:
 *   get:
 *     summary: Load the message history for a guest session (also supports ?q= search)
 *     tags: [Public (Guest)]
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
 */
router.get('/chat-sessions/:sessionId/messages', async (req, res) => {
  try {
    const session = await loadGuestSession(req.params.sessionId);
    const limit = Math.min(parseInt(req.query.limit, 10) || 500, 1000);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const messages = q
      ? await chatSessionService.searchMessages(req.params.sessionId, q, limit)
      : await chatSessionService.getRecentMessagesChronological(req.params.sessionId, limit);
    res.json({ session, messages });
  } catch (error) {
    if (error.statusCode === 404) return res.status(404).json({ message: error.message });
    logger.error(`public list messages: ${error.message}`, { stack: error.stack });
    res.status(500).json({ message: error.message });
  }
});

/* =========================================================================
   GET /api/public/chat-sessions/:sessionId/messages/:messageId/audio
   ------------------------------------------------------------------------- */
/**
 * @swagger
 * /public/chat-sessions/{sessionId}/messages/{messageId}/audio:
 *   get:
 *     summary: Get audio for a message — original recording for user voice messages, Piper TTS for assistant messages
 *     tags: [Public (Guest)]
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
 *       200: { description: Audio stream — original mime for user, audio/wav for assistant TTS }
 *       400: { description: This user message has no audio (text-only) }
 *       404: { description: Message / twin / voice not found / file missing }
 */
router.get('/chat-sessions/:sessionId/messages/:messageId/audio', async (req, res) => {
  try {
    const session = await loadGuestSession(req.params.sessionId);
    const msg = await chatSessionService.getMessage(req.params.sessionId, req.params.messageId);
    if (msg.role === 'user') {
      if (!msg.audioUrl) {
        return res.status(400).json({ message: 'This user message has no audio (text-only)' });
      }
      const abs = resolveUserAudioPath(msg.audioUrl);
      if (!abs || !fs.existsSync(abs)) {
        return res.status(404).json({ message: 'Audio file no longer available' });
      }
      const ext = path.extname(abs).toLowerCase();
      const mime = CHAT_AUDIO_MIME_BY_EXT[ext] || 'application/octet-stream';
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'no-store');
      try { res.setHeader('Content-Length', String(fs.statSync(abs).size)); } catch (_) { /* best-effort */ }
      return fs.createReadStream(abs).pipe(res);
    }
    if (!session.twinId) return res.status(404).json({ message: 'Session has no twin assigned' });
    let twin;
    try {
      twin = await aiTwinService.getTwinByKey(session.twinId);
    } catch (e) {
      return res.status(404).json({ message: 'Twin not found for this session' });
    }
    if (!twin.voiceId) return res.status(404).json({ message: 'Twin has no voice assigned' });
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
    logger.error(`public message audio: ${error.message}`, { stack: error.stack });
    res.status(error.response?.status || 500).json({ message: error.message });
  }
});

/* =========================================================================
   POST /api/public/chat-sessions/:sessionId/voice-messages
   ------------------------------------------------------------------------- */
/**
 * @swagger
 * /public/chat-sessions/{sessionId}/voice-messages:
 *   post:
 *     summary: Send a voice note in a guest session (ASR → LLM → reply text)
 *     tags: [Public (Guest)]
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
 *               audio: { type: string, format: binary }
 *               language: { type: string, default: EN }
 */
router.post(
  '/chat-sessions/:sessionId/voice-messages',
  (req, res, next) => {
    audioUpload.single('audio')(req, res, (err) => {
      if (err) {
        const code = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        return res.status(code).json({ message: err.message || 'upload failed' });
      }
      next();
    });
  },
  async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'audio file is required (form field "audio")' });
    const cleanup = () => { try { fs.unlinkSync(req.file.path); } catch (_) {} };
    try {
      const session = await loadGuestSession(req.params.sessionId);

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
        logger.error(`public voice-message ASR failed: ${asrErr.message}`);
        return res.status(502).json({ message: 'ASR failed', detail: asrErr.message });
      }
      if (!transcript) {
        cleanup();
        return res.status(400).json({ message: 'Audio could not be transcribed (silent or unsupported)' });
      }

      const audioUrl = `${CHAT_AUDIO_PUBLIC_PREFIX}/${req.file.filename}`;
      const ctx = {
        categoryLabel: req.body.categoryLabel || 'General',
        serviceLabels: req.body.serviceLabels
          ? String(req.body.serviceLabels).split(',').map((s) => s.trim()).filter(Boolean)
          : [],
        language: req.body.language || 'EN',
      };
      const result = await chatSessionService.sendMessage(
        session.userId,
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
      if (error.statusCode === 400) return res.status(400).json({ message: error.message });
      logger.error(`public voice-message: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  }
);

/* =========================================================================
   POST /api/public/voice/token   (mint guest voice JWT for the live call)
   ------------------------------------------------------------------------- */
/**
 * @swagger
 * /public/voice/token:
 *   post:
 *     summary: Mint a short-lived voice JWT for a guest live call against any twin (defaults to the default twin)
 *     tags: [Public (Guest)]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               language: { type: string, enum: [en, fr, es, sw], default: en }
 *               twinId:
 *                 type: string
 *                 description: Optional. When omitted the call targets the default twin.
 *     responses:
 *       200:
 *         description: WS info + voiceToken (carries guest userId + chosen twinId)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 wsUrl: { type: string }
 *                 voiceToken: { type: string }
 *                 expiresIn: { type: integer }
 *                 language: { type: string }
 *                 twinId: { type: string }
 *       400: { description: Provided twinId does not exist }
 *       503: { description: Voice token service unavailable / no default twin }
 */
router.post('/voice/token', async (req, res) => {
  try {
    if (!voiceTokenService.initialized) {
      return res.status(503).json({ message: 'Voice token service unavailable' });
    }
    const language = (req.body && req.body.language) || 'en';

    // Pick the twin: explicit body.twinId wins; otherwise fall back to default.
    // Validate either way so the JWT never carries a non-existent twin.
    let twinId = req.body && req.body.twinId;
    if (twinId) {
      try {
        await aiTwinService.getTwinByKey(String(twinId));
      } catch (e) {
        return res.status(400).json({ message: 'twinId does not exist' });
      }
      twinId = String(twinId);
    } else {
      twinId = await getDefaultTwinKey();
    }

    const guestId = newGuestId();
    const result = await voiceTokenService.mintToken({
      userId: guestId,
      fullName: 'Guest',
      language,
      twinId,
    });
    res.json(result);
  } catch (error) {
    if (error.statusCode === 503) return res.status(503).json({ message: error.message });
    logger.error(`public voice token: ${error.message}`, { stack: error.stack });
    res.status(500).json({ message: 'Failed to mint voice token' });
  }
});

module.exports = router;
