/**
 * Public guest routes — no authentication.
 *
 * Mirrors a narrow subset of the authenticated API so a shareable link can let
 * a stranger chat / call a Topic Module (AI twin) without signing in.
 *
 * Hard constraints applied here:
 *   - All endpoints unauthenticated. We never trust user-provided ids that
 *     could leak someone else's data — sessions created via this router are
 *     stamped with `userId = "guest:<random>"` and the hash of a separate
 *     secret, returned once as `guestId`; a session is served only to a
 *     request that sends that secret back in the X-Guest-Id header.
 *   - When PUBLIC_TWIN_IDS is set, guests may use only those modules. The
 *     module read routes are shared with signed-in users, who may read any.
 *   - Existing authenticated routes are untouched.
 */
const { createHash, randomBytes, timingSafeEqual } = require('crypto');
const express = require('express');
const fs = require('fs');
const path = require('path');
// eslint-disable-next-line no-redeclare -- the form-data package (streams, getHeaders), not the global
const FormData = require('form-data');
const axios = require('axios');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../shared-lib');
const authMiddleware = require('../middleware/auth-middleware');
const aiTwinService = require('../services/ai-twin-service');
const chatSessionService = require('../services/chat-session-service');
const voiceTokenService = require('../services/voice-token-service');
const voiceCatalogService = require('../services/voice-catalog-service');
const { NotFoundError } = require('../middleware/errors');

// Direct vLLM endpoint for the translator-side Gemma instance. Used by the
// translate-detect test endpoint to ask the model for both detection and
// translation in a single call.
const VLLM_TRANSLATION_URL =
  process.env.VLLM_TRANSLATION_URL || 'http://vllm-translation-guardrail:9031/v1/chat/completions';
const VLLM_TRANSLATION_MODEL = process.env.VLLM_TRANSLATION_MODEL_ID || 'google/gemma-3-4b-it';

// fastText LID microservice — runs CPU-only, returns ISO 639-3 + script labels
// (e.g. "wol_Latn") with confidence scores. Used as a sanity check next to the
// translator's own implicit detection.
const LID_URL = process.env.LID_URL || 'http://lid:8000';

// ISO 639-3 → ISO 639-1 / chatqna code mapping for the labels lid commonly
// returns. Used purely for display in the test endpoint response.
const ISO3_DISPLAY_NAMES = {
  eng: 'English', fra: 'French', spa: 'Spanish', ara: 'Arabic',
  por: 'Portuguese', deu: 'German', rus: 'Russian', ind: 'Indonesian',
  tha: 'Thai', cmn: 'Chinese (Mandarin)', zho: 'Chinese',
  swh: 'Swahili', swa: 'Swahili', amh: 'Amharic', ben: 'Bengali',
  hin: 'Hindi', jpn: 'Japanese', kor: 'Korean',
  wol: 'Wolof', mnk: 'Mandinka', man: 'Mandinka',
  ful: 'Fulah', fuc: 'Pulaar', hau: 'Hausa', yor: 'Yoruba',
  bam: 'Bambara', ibo: 'Igbo', sot: 'Sesotho', gaz: 'West Central Oromo',
  orm: 'Oromo', som: 'Somali', mos: 'Mossi', epo: 'Esperanto',
  ast: 'Asturian', vie: 'Vietnamese', ita: 'Italian', ron: 'Romanian',
  est: 'Estonian', fin: 'Finnish', dan: 'Danish', nob: 'Norwegian Bokmål',
};

/** Call the LID service and return the parsed predictions, or null if it
 *  fails / isn't reachable. Best-effort — never throws. */
async function detectLanguageWithLid(text) {
  try {
    const resp = await axios.post(
      `${LID_URL}/detect`,
      { text, k: 3 },
      { timeout: 5000 }
    );
    const preds = resp.data?.predictions;
    if (!Array.isArray(preds) || !preds.length) return null;
    return preds.map((p) => {
      const label = String(p.label || '');
      const iso3 = label.split('_')[0]; // strip "_Latn" suffix
      return {
        label,
        iso3,
        name: ISO3_DISPLAY_NAMES[iso3] || null,
        score: Number((p.score || 0).toFixed(3)),
      };
    });
  } catch (e) {
    logger.warn(`lid /detect call failed: ${e.message}`);
    return null;
  }
}

/** Pull the first valid JSON object out of an LLM completion that may be
 *  wrapped in markdown fences, prose, or extra commentary. */
function extractJsonObject(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  const stripped = raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const m = stripped.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

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
try { fs.mkdirSync(CHAT_AUDIO_DIR, { recursive: true }); } catch { /* best-effort */ }

const audioUpload = multer({
  storage: multer.diskStorage({
    destination: CHAT_AUDIO_DIR,
    filename: (req, file, cb) => {
      const ext = CHAT_AUDIO_EXT[file.mimetype] || '.bin';
      // The key of the session the guest check loaded, never the raw URL parameter.
      const key = req.guestSession && req.guestSession._key;
      if (!key) return cb(new Error('guest session not loaded'));
      cb(null, `${key}-${Date.now()}${ext}`);
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

/**
 * Key to one guest chat session: returned once as `guestId` and sent back as
 * X-Guest-Id. It is not the session's userId (which analytics and lists show),
 * and only its SHA-256 is stored.
 */
function newGuestSecret() {
  return randomBytes(32).toString('base64url');
}

function hashGuestSecret(secret) {
  return createHash('sha256').update(secret).digest('hex');
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

// Stable code on the 404 a guest gets for a module outside PUBLIC_TWIN_IDS;
// the frontend sends the guest to sign-in on it.
const GUEST_TWIN_NOT_ALLOWED = 'GUEST_TWIN_NOT_ALLOWED';

/** Twin _keys guests may use (PUBLIC_TWIN_IDS, comma-separated); null when unset = every twin. */
function publicTwinIds() {
  const ids = String(process.env.PUBLIC_TWIN_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : null;
}

function isPublicTwin(twinId) {
  const ids = publicTwinIds();
  return !ids || ids.includes(String(twinId));
}

/** The same answer for any id outside the list, whether or not the twin exists. */
function twinNotAllowedError() {
  const err = new NotFoundError('This Topic Module is not available to guests');
  err.code = GUEST_TWIN_NOT_ALLOWED;
  return err;
}

function sendTwinNotAllowed(res) {
  const err = twinNotAllowedError();
  return res.status(404).json({ code: err.code, message: err.message });
}

/** Body for a 404 from a session route; keeps the code of a twin refusal. */
function notFoundBody(error) {
  if (error.code === GUEST_TWIN_NOT_ALLOWED) return { code: error.code, message: error.message };
  return { message: error.message };
}

/**
 * The twin a guest gets when the request names none: the default twin, or the
 * first id in PUBLIC_TWIN_IDS when guests may not use the default.
 */
async function getGuestDefaultTwinKey() {
  const ids = publicTwinIds();
  if (!ids) return getDefaultTwinKey();
  const defaultTwin = await aiTwinService.getDefaultTwin();
  if (defaultTwin && ids.includes(defaultTwin._key)) return defaultTwin._key;
  try {
    await aiTwinService.getTwinByKey(ids[0]);
  } catch (e) {
    logger.error(`PUBLIC_TWIN_IDS: cannot load twin ${ids[0]}: ${e.message}`);
    const err = new Error('Public chat is not configured');
    err.statusCode = 503;
    throw err;
  }
  return ids[0];
}

/**
 * The twin read routes are shared with signed-in users, who may read any twin.
 * While guests are limited, a request carrying a session token goes through
 * the normal auth check (an expired token gets 401, so the client refreshes
 * it) and sets req.user; a request without one is a guest.
 */
function identifySignedInUser(req, res, next) {
  if (!publicTwinIds() || !req.headers.authorization) return next();
  return authMiddleware.authenticate(req, res, next);
}

/** Constant-time check that the X-Guest-Id header hashes to the session's stored guest secret hash. */
function isSessionGuest(headerValue, guestSecretHash) {
  if (typeof headerValue !== 'string' || !headerValue || typeof guestSecretHash !== 'string') return false;
  const given = Buffer.from(hashGuestSecret(headerValue), 'hex');
  const expected = Buffer.from(guestSecretHash, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** A guest session as sent to the browser, without its secret hash. */
function publicSessionView(doc) {
  const view = { ...doc };
  delete view.guestSecretHash;
  return view;
}

/**
 * Load the guest session named in the URL for the guest who created it: the
 * X-Guest-Id header must be the guestId returned at creation. A missing or
 * different id gets the same 404 as an unknown session, so a session id alone
 * reveals nothing. Guests can never read a logged-in user's session either.
 */
async function loadGuestSession(req) {
  let doc;
  try {
    doc = await chatSessionService.sessions.document(req.params.sessionId);
  } catch {
    const err = new NotFoundError('Chat session not found');
    err.statusCode = 404;
    throw err;
  }
  if (
    typeof doc.userId !== 'string' ||
    !doc.userId.startsWith('guest:') ||
    !isSessionGuest(req.get('X-Guest-Id'), doc.guestSecretHash)
  ) {
    // Authenticated user's session, or another guest's — never expose via /public.
    const err = new NotFoundError('Chat session not found');
    err.statusCode = 404;
    throw err;
  }
  if (!isPublicTwin(doc.twinId)) throw twinNotAllowedError();
  return doc;
}

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Public (Guest)
 *     description: >-
 *       Unauthenticated guest endpoints — chat & call against a Topic Module via shareable link. No login
 *       required. When PUBLIC_TWIN_IDS is set, guests may use only those modules; other ids get 404 with
 *       code GUEST_TWIN_NOT_ALLOWED. The module read routes serve every module to a signed-in caller.
 */

/* =========================================================================
   GET /api/public/chat-sessions/languages
   ------------------------------------------------------------------------- */
/**
 * @swagger
 * /public/chat-sessions/languages:
 *   get:
 *     summary: List supported chat languages (translator + TTS coverage) — same list as the authed endpoint
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
 *                   isVoiceSupported:
 *                     type: boolean
 *                     description: >-
 *                       True when a Piper TTS voice exists for this language.
 *                       Frontend uses this to gate the call button.
 */
router.get('/chat-sessions/languages', (req, res) => {
  const { CHAT_LANGUAGES } = require('../constants/chat-languages');
  res.json(CHAT_LANGUAGES);
});

/* =========================================================================
   GET /api/public/suggested-questions   (curated chat-landing prompts)
   ------------------------------------------------------------------------- */
/**
 * @swagger
 * /public/suggested-questions:
 *   get:
 *     summary: List curated chat-landing suggested questions — same list as the authed endpoint
 *     tags: [Public (Guest)]
 *     responses:
 *       200:
 *         description: Suggested questions ordered by importance
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   order:    { type: integer }
 *                   category: { type: string }
 *                   content:  { type: string }
 */
router.get('/suggested-questions', (req, res) => {
  const { SUGGESTED_QUESTIONS } = require('../constants/suggested-questions');
  // Match the per-twin default-enabled cap so the chat-landing UI never
  // surfaces more than 3 questions, whether the source is a twin's
  // generated rows or this curated fallback list.
  res.json(SUGGESTED_QUESTIONS.slice(0, 3));
});

/* =========================================================================
   GET /api/public/ai-twins   (sanitized public directory of twins)
   ------------------------------------------------------------------------- */
/**
 * @swagger
 * /public/ai-twins:
 *   get:
 *     summary: List AI twins (public directory — no admin fields)
 *     description: Guests get only the twins in PUBLIC_TWIN_IDS when it is set; a signed-in caller gets all.
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
 *                       _key:          { type: string }
 *                       name:          { type: string }
 *                       description:   { type: string }
 *                       profilePicUrl: { type: string, nullable: true }
 */
router.get('/ai-twins', identifySignedInUser, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const allowedIds = req.user ? null : publicTwinIds();
    const { twins, total } = await aiTwinService.listTwins({ limit, offset, allowedIds });
    res.json({
      total,
      offset,
      limit,
      twins: twins.map((t) => ({
        _key: t._key,
        name: t.name,
        description: t.description,
        profilePicUrl: t.profilePicUrl,
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
 *                 _key:          { type: string }
 *                 name:          { type: string }
 *                 description:   { type: string }
 *                 profilePicUrl: { type: string, nullable: true }
 *       404: { description: "Twin not found, or code GUEST_TWIN_NOT_ALLOWED for a guest outside PUBLIC_TWIN_IDS" }
 */
router.get('/ai-twins/:id', identifySignedInUser, async (req, res) => {
  if (!req.user && !isPublicTwin(req.params.id)) return sendTwinNotAllowed(res);
  try {
    const twin = await aiTwinService.getTwinByKey(req.params.id);
    res.json({
      _key: twin._key,
      name: twin.name,
      description: twin.description,
      profilePicUrl: twin.profilePicUrl,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    if (status === 404) return res.status(404).json({ message: 'Twin not found' });
    logger.error(`public ai-twin: ${error.message}`, { stack: error.stack });
    res.status(500).json({ message: error.message });
  }
});

/* =========================================================================
   GET /api/public/ai-twins/:id/suggested-questions
   ------------------------------------------------------------------------- */
/**
 * @swagger
 * /public/ai-twins/{id}/suggested-questions:
 *   get:
 *     summary: Per-twin suggested chat-landing questions (guest)
 *     description: >-
 *       Returns the twin's per-KB suggested-question set. Falls back to the
 *       global curated list when the twin has no KB / no chunks / no LLM
 *       generation yet. Same data shape as the authed endpoint.
 *     tags: [Public (Guest)]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         required: false
 *         schema: { type: string, enum: [enabled, all], default: enabled }
 *         description: >-
 *           `enabled` (default) — only rows the admin has left toggled on; used
 *           by the chat-landing UI. Falls back to the global curated list when
 *           none are enabled. `all` — returns every row including disabled
 *           ones, with the full row shape.
 *     responses:
 *       200:
 *         description: Suggested questions
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   _key:     { type: string, nullable: true }
 *                   twinId:   { type: string, nullable: true }
 *                   order:    { type: integer }
 *                   category: { type: string }
 *                   content:  { type: string }
 *                   enabled:  { type: boolean, nullable: true }
 *                   source:   { type: string, enum: [generated, manual], nullable: true }
 *       404: { description: "Twin not found, or code GUEST_TWIN_NOT_ALLOWED for a guest outside PUBLIC_TWIN_IDS" }
 */
router.get('/ai-twins/:id/suggested-questions', identifySignedInUser, async (req, res) => {
  if (!req.user && !isPublicTwin(req.params.id)) return sendTwinNotAllowed(res);
  try {
    const status = req.query.status === 'all' ? 'all' : 'enabled';
    const questions = await aiTwinService.getSuggestedQuestions(
      req.params.id,
      undefined,
      { status }
    );
    res.json(questions);
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ message: error.message });
    }
    logger.error(`public ai-twin suggested-questions: ${error.message}`, { stack: error.stack });
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
 *     summary: Create a new guest chat session (defaults to the default twin)
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
 *                 description: >-
 *                   Optional. When omitted the session targets the default twin, or the first id in
 *                   PUBLIC_TWIN_IDS when guests may not use the default.
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 sessionId: { type: string }
 *                 guestId:   { type: string, description: "Send it as X-Guest-Id on every request for this session" }
 *                 twinId:    { type: string }
 *                 createdAt: { type: string, format: date-time }
 *       400: { description: Provided twinId does not exist }
 *       404: { description: "code GUEST_TWIN_NOT_ALLOWED: twinId is outside PUBLIC_TWIN_IDS" }
 *       503: { description: No default twin configured (and no twinId provided) }
 */
router.post('/chat-sessions', async (req, res) => {
  try {
    // Pick the twin: explicit body.twinId wins; otherwise fall back to the default.
    // Validate either way so the session never points at a non-existent twin.
    let twinId = req.body?.twinId;
    if (twinId) {
      if (!isPublicTwin(twinId)) return sendTwinNotAllowed(res);
      try {
        await aiTwinService.getTwinByKey(String(twinId));
      } catch {
        return res.status(400).json({ message: 'twinId does not exist' });
      }
      twinId = String(twinId);
    } else {
      twinId = await getGuestDefaultTwinKey();
    }

    const guestId = newGuestId();
    const guestSecret = newGuestSecret();
    // Write the session doc directly so the userId keeps the "guest:" prefix
    // that loadGuestSession() relies on (chatSessionService.createSession would
    // strip it via its internal _uid() helper).
    const now = new Date().toISOString();
    const meta = await chatSessionService.sessions.save({
      userId: guestId,
      guestSecretHash: hashGuestSecret(guestSecret),
      twinId,
      type: 'chat',
      createdAt: now,
      updatedAt: now,
    });
    res.status(201).json({
      sessionId: meta._key,
      // The browser's key to this session (sent back as X-Guest-Id), not the userId.
      guestId: guestSecret,
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
 *       - in: header
 *         name: X-Guest-Id
 *         required: true
 *         schema: { type: string }
 *         description: The guestId returned when the session was created.
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
 *       404: { description: "Session not found, or X-Guest-Id missing or wrong (same answer); code GUEST_TWIN_NOT_ALLOWED: its twin is outside PUBLIC_TWIN_IDS" }
 *       500: { description: Internal error (LLM upstream, persistence, etc.) }
 */
router.post('/chat-sessions/:sessionId/messages', async (req, res) => {
  try {
    const session = await loadGuestSession(req);
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
    if (error.statusCode === 404) return res.status(404).json(notFoundBody(error));
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
 *       - in: header
 *         name: X-Guest-Id
 *         required: true
 *         schema: { type: string }
 *         description: The guestId returned when the session was created.
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 1000, default: 500 }
 *       - in: query
 *         name: q
 *         schema: { type: string }
 */
router.get('/chat-sessions/:sessionId/messages', async (req, res) => {
  try {
    const session = await loadGuestSession(req);
    const limit = Math.min(parseInt(req.query.limit, 10) || 500, 1000);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const messages = q
      ? await chatSessionService.searchMessages(req.params.sessionId, q, limit)
      : await chatSessionService.getRecentMessagesChronological(req.params.sessionId, limit);
    res.json({ session: publicSessionView(session), messages });
  } catch (error) {
    if (error.statusCode === 404) return res.status(404).json(notFoundBody(error));
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
 *       - in: header
 *         name: X-Guest-Id
 *         required: true
 *         schema: { type: string }
 *         description: The guestId returned when the session was created.
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Audio stream — original mime for user, audio/wav for assistant TTS }
 *       400: { description: This user message has no audio (text-only) }
 *       404: { description: "Message / twin / voice not found / file missing, or X-Guest-Id missing or wrong" }
 */
router.get('/chat-sessions/:sessionId/messages/:messageId/audio', async (req, res) => {
  try {
    const session = await loadGuestSession(req);
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
      try { res.setHeader('Content-Length', String(fs.statSync(abs).size)); } catch { /* best-effort */ }
      return fs.createReadStream(abs).pipe(res);
    }
    if (!session.twinId) return res.status(404).json({ message: 'Session has no twin assigned' });
    let twin;
    try {
      twin = await aiTwinService.getTwinByKey(session.twinId);
    } catch {
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
    if (error.statusCode === 404) return res.status(404).json(notFoundBody(error));
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
 *       - in: header
 *         name: X-Guest-Id
 *         required: true
 *         schema: { type: string }
 *         description: The guestId returned when the session was created.
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
  // Check the guest before multer writes anything to disk.
  async (req, res, next) => {
    try {
      req.guestSession = await loadGuestSession(req);
      return next();
    } catch (error) {
      if (error.statusCode === 404) return res.status(404).json(notFoundBody(error));
      logger.error(`public voice-message: ${error.message}`, { stack: error.stack });
      return res.status(500).json({ message: error.message });
    }
  },
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
    const cleanup = () => { try { fs.unlinkSync(req.file.path); } catch { /* already gone */ } };
    try {
      const session = req.guestSession;

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
        metadata: result.metadata,
      });
    } catch (error) {
      cleanup();
      if (error.statusCode === 404) return res.status(404).json(notFoundBody(error));
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
 *     summary: Mint a short-lived voice JWT for a guest live call (defaults to the default twin)
 *     tags: [Public (Guest)]
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
 *                 description: Must be a language with a Piper voice (see /public/chat-sessions/languages).
 *               twinId:
 *                 type: string
 *                 description: >-
 *                   Optional. When omitted the call targets the default twin, or the first id in
 *                   PUBLIC_TWIN_IDS when guests may not use the default.
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
 *       404: { description: "code GUEST_TWIN_NOT_ALLOWED: twinId is outside PUBLIC_TWIN_IDS" }
 *       503: { description: Voice token service unavailable / no default twin }
 */
const PUBLIC_VOICE_LANGUAGES = ['en', 'fr', 'es', 'sw', 'ar', 'de', 'hi', 'id', 'pt', 'ru', 'zh'];

router.post('/voice/token', async (req, res) => {
  try {
    if (!voiceTokenService.initialized) {
      return res.status(503).json({ message: 'Voice token service unavailable' });
    }
    const language = (req.body && req.body.language) || 'en';
    if (!PUBLIC_VOICE_LANGUAGES.includes(language)) {
      return res.status(400).json({
        message: `language '${language}' has no voice on this deployment`,
        supportedLanguages: PUBLIC_VOICE_LANGUAGES,
      });
    }

    // Pick the twin: explicit body.twinId wins; otherwise fall back to default.
    // Validate either way so the JWT never carries a non-existent twin.
    let twinId = req.body && req.body.twinId;
    if (twinId) {
      if (!isPublicTwin(twinId)) return sendTwinNotAllowed(res);
      try {
        await aiTwinService.getTwinByKey(String(twinId));
      } catch {
        return res.status(400).json({ message: 'twinId does not exist' });
      }
      twinId = String(twinId);
    } else {
      twinId = await getGuestDefaultTwinKey();
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

/**
 * @swagger
 * /public/translate-detect:
 *   post:
 *     summary: Detect a sentence's language and translate it to English (test endpoint)
 *     description: >-
 *       Public, unauthenticated endpoint for testing the translation pipeline. Runs fastText LID
 *       for source-language detection (informational), then sends the raw text to Gemma 3 4B for
 *       a single-shot identify-and-translate-to-English call. Useful for sanity-checking which
 *       languages the system actually handles end-to-end.
 *     tags: [Public (Guest)]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text]
 *             properties:
 *               text:
 *                 type: string
 *                 description: The sentence to detect + translate.
 *                 maxLength: 5000
 *           examples:
 *             english:
 *               summary: English
 *               value: { text: "Hello, my name is Ryan and I am happy to meet you." }
 *             wolof:
 *               summary: Wolof
 *               value: { text: "Salaam aleekum, sama tudd RYAAN la te bég naa la gis." }
 *             mandinka:
 *               summary: Mandinka
 *               value: { text: "I salaa maa lekum, n too mu RYAAN ti, n seewoota ka i je." }
 *             french:
 *               summary: French
 *               value: { text: "Bonjour, je m'appelle Ryan et je suis heureux de vous rencontrer." }
 *     responses:
 *       200:
 *         description: lid detection + Gemma translation
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 input: { type: string }
 *                 lidDetection:
 *                   type: array
 *                   nullable: true
 *                   description: Top-3 fastText predictions (informational; not used to gate translation)
 *                   items:
 *                     type: object
 *                     properties:
 *                       label:    { type: string, example: wol_Latn }
 *                       iso3:     { type: string, example: wol }
 *                       name:     { type: string, nullable: true }
 *                       score:    { type: number }
 *                 detectedLanguage: { type: string, nullable: true, description: Source language as identified by Gemma }
 *                 translation:      { type: string, nullable: true }
 *                 model:            { type: string }
 *                 rawOutput:        { type: string, nullable: true, description: Set only when Gemma did not return strict JSON }
 *       400: { description: Missing or invalid "text" }
 *       500: { description: Translator call failed }
 */
/** Fire one Gemma call with the prompt and return the raw completion text. */
async function callGemma(prompt) {
  const upstream = await axios.post(
    VLLM_TRANSLATION_URL,
    {
      model: VLLM_TRANSLATION_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 512,
    },
    { timeout: 60000 }
  );
  return upstream.data?.choices?.[0]?.message?.content || '';
}

router.post('/translate-detect', async (req, res) => {
  const text = req.body && req.body.text;
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ message: 'Body must include "text" (non-empty string).' });
  }
  if (text.length > 5000) {
    return res.status(400).json({ message: 'text too long (max 5000 chars).' });
  }

  // Gemma gets the combined "identify + translate" prompt so we can surface
  // its self-detected source language alongside the translation.
  const gemmaPrompt =
    'Identify the source language of the text and translate it to English. ' +
    'Respond with strict JSON only, on a single line, with this exact shape: ' +
    '{"language": "<source language full name>", "translation": "<English translation>"}. ' +
    'If the text is already in English, copy it verbatim into the translation field. ' +
    'Do not include markdown fences, commentary, or any extra fields.\n\n' +
    `Text: ${text}`;

  // lid is fast (~10 ms), Gemma medium (~1-2 s); fire in parallel.
  const [lidPredictions, gemmaRaw] = await Promise.all([
    detectLanguageWithLid(text),
    callGemma(gemmaPrompt).catch((e) => {
      logger.warn(`gemma call failed: ${e.message}`);
      return null;
    }),
  ]);

  if (!gemmaRaw) {
    return res.status(500).json({ message: 'translator call failed' });
  }

  const parsed = extractJsonObject(gemmaRaw);
  if (parsed && parsed.language && parsed.translation) {
    return res.json({
      input: text,
      lidDetection: lidPredictions,
      detectedLanguage: String(parsed.language),
      translation: String(parsed.translation),
      model: VLLM_TRANSLATION_MODEL,
    });
  }

  return res.json({
    input: text,
    lidDetection: lidPredictions,
    detectedLanguage: null,
    translation: null,
    model: VLLM_TRANSLATION_MODEL,
    rawOutput: gemmaRaw,
  });
});

module.exports = router;
