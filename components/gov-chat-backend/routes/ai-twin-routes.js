const express = require('express');
const Joi = require('joi');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const authMiddleware = require('../middleware/auth-middleware');
const patientService = require('../services/patient-service');
const { logger } = require('../shared-lib');

/** Where AI twin avatars are written. Mounted statically at /Uploads/ai-twins/. */
const AVATAR_UPLOAD_DIR = path.join(
  __dirname,
  '..',
  process.env.UPLOAD_DIR || 'Uploads',
  'ai-twins'
);
const AVATAR_PUBLIC_PREFIX = '/Uploads/ai-twins';
const AVATAR_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const AVATAR_ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const AVATAR_EXT_FROM_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

try {
  fs.mkdirSync(AVATAR_UPLOAD_DIR, { recursive: true });
} catch (e) {
  logger.error(`Failed to ensure avatar upload dir ${AVATAR_UPLOAD_DIR}: ${e.message}`);
}

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: AVATAR_UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = AVATAR_EXT_FROM_MIME[file.mimetype] || '.bin';
      // <twinId>-<timestamp><.ext> — overwrites are deterministic per twin/sec.
      cb(null, `${req.params.twinId}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!AVATAR_ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error(`unsupported image type ${file.mimetype}`));
    }
    cb(null, true);
  },
});

const profilePicUrlSchema = Joi.string()
  .max(2048)
  .allow(null, '')
  .custom((value, helpers) => {
    if (value == null || value === '') return value;
    const v = String(value).trim();
    if (/^https?:\/\//i.test(v)) return v;
    if (v.startsWith('/')) return v;
    return helpers.error('any.invalid');
  }, 'absolute URL or root-relative path');

const createSchema = Joi.object({
  name: Joi.string().trim().min(1).max(200).required(),
  description: Joi.string().allow('').max(50000).default(''),
  profilePicUrl: profilePicUrlSchema.optional(),
  voiceId: Joi.string().trim().min(1).max(200).optional(),
  chatGreeting: Joi.string().allow('').max(5000).optional(),
  callGreeting: Joi.string().allow('').max(5000).optional(),
  twinNumber: Joi.string().allow('').max(32).optional(),
});

const updateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(200),
  description: Joi.string().allow('').max(50000),
  profilePicUrl: profilePicUrlSchema.optional(),
  voiceId: Joi.string().trim().min(1).max(200),
  chatGreeting: Joi.string().allow('').max(5000),
  callGreeting: Joi.string().allow('').max(5000),
  twinNumber: Joi.string().allow('').max(32),
})
  .min(1)
  .messages({ 'object.min': 'at least one field is required' });

const assignVoiceSchema = Joi.object({
  voiceId: Joi.string().trim().min(1).max(200).required(),
});

const settingsSchema = Joi.object({
  chatGreeting: Joi.string().allow('').max(5000),
  callGreeting: Joi.string().allow('').max(5000),
})
  .min(1)
  .messages({ 'object.min': 'at least one of chatGreeting, callGreeting is required' });

/** Personality patch — both fields optional; at least one required. */
const personalitySchema = Joi.object({
  languageStyle: Joi.string().valid('slang', 'casual', 'professional'),
  responseLength: Joi.string().valid('short', 'medium', 'long'),
})
  .min(1)
  .messages({
    'object.min': 'at least one of languageStyle, responseLength is required',
  });

const instructionsReplaceSchema = Joi.object({
  instructions: Joi.array().items(Joi.string().trim().max(1000)).max(100).required(),
});

const systemPromptSchema = Joi.object({
  systemPrompt: Joi.string().trim().min(1).max(50000).required(),
});


/** Assign KB files: either `fileId` or `fileIds` (document-repository file_id values). */
const assignKbBodySchema = Joi.alternatives().try(
  Joi.object({
    fileId: Joi.string().trim().min(1).max(512).required(),
  }),
  Joi.object({
    fileIds: Joi.array().items(Joi.string().trim().min(1).max(512)).min(1).max(500).required(),
  })
);

/** Same shape for unassign; optional query `fileId` for DELETE without a body. */
const unassignKbBodySchema = assignKbBodySchema;

/** Full replace of twin.linkedKbFileIds (validated against document-repository `files`). */
const replaceKbFilesSchema = Joi.object({
  linkedKbFileIds: Joi.array().items(Joi.string().trim().min(1).max(512)).max(10000).required(),
});

function fileIdsFromAssignPayload(value) {
  if (value && Array.isArray(value.fileIds)) return value.fileIds;
  if (value && typeof value.fileId === 'string') return [value.fileId];
  return [];
}

/**
 * Admin-only CRUD for AI twins (name, profilePicUrl, description, linkedKbFileIds).
 */
module.exports = (aiTwinService) => {
  if (!aiTwinService || typeof aiTwinService.listTwins !== 'function') {
    logger.error('ai-twin-routes: invalid aiTwinService');
    throw new Error('aiTwinService is required');
  }

  const router = express.Router();
  // All endpoints require a valid session. Read endpoints (list, get-by-key,
  // get-default, get-settings) are open to any authenticated user; mutating
  // endpoints add `isAdmin` per-route. The public (no-auth) browse path lives
  // under /api/public/ai-twins.
  router.use(authMiddleware.authenticate);
  const adminOnly = authMiddleware.isAdmin;

  /** The current admin's user `_key` — used to scope every twin lookup so each
   *  admin only sees / mutates their own twins. */
  function ownerIdFromReq(req) {
    return req.user && (req.user._key || req.user.id || req.user.userId);
  }

  function isAdminReq(req) {
    return req.user && req.user.role === 'Admin';
  }

  /**
   * @swagger
   * tags:
   *   - name: AI Twins
   *     description: Admin — manage AI twin personas
   * /ai-twins:
   *   get:
   *     summary: List AI twins
   *     tags: [AI Twins]
   *     security: [ { bearerAuth: [] } ]
   *     parameters:
   *       - in: query
   *         name: offset
   *         schema: { type: integer, default: 0 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, default: 50, maximum: 200 }
   *     responses:
   *       200: { description: OK }
   *       401: { description: Unauthorized }
   *       403: { description: Forbidden }
   */
  router.get('/', async (req, res) => {
    try {
      const offset = req.query.offset;
      const limit = req.query.limit;
      const userKey = ownerIdFromReq(req);

      // Admins see twins they own. Patients with an adminId are scoped to
      // their admin (tenant isolation) and optionally narrowed further by
      // allowedTwinIds. Patients with no adminId (unassigned users) see the
      // full global catalog.
      let result;
      if (isAdminReq(req)) {
        result = await aiTwinService.listTwins({ offset, limit, ownerId: userKey });
      } else {
        const access = await patientService.getSelfTwinAccess(userKey);
        if (!access) {
          result = await aiTwinService.listTwins({ offset, limit });
        } else {
          result = await aiTwinService.listTwins({
            offset,
            limit,
            ownerId: access.adminId,                 // always tenant-scoped
            allowedIds: access.allowedTwinIds,       // null → admin's full catalog
          });
        }
      }
      res.json(result);
    } catch (error) {
      logger.error(`ai-twin list: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * @swagger
   * /ai-twins:
   *   post:
   *     summary: Create AI twin
   *     tags: [AI Twins]
   *     security: [ { bearerAuth: [] } ]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [name]
   *             properties:
   *               name:
   *                 type: string
   *                 minLength: 1
   *                 maxLength: 200
   *                 description: Display name of the twin
   *               description:
   *                 type: string
   *                 maxLength: 50000
   *                 description: Optional long description (defaults to empty)
   *               profilePicUrl:
   *                 type: string
   *                 nullable: true
   *                 maxLength: 2048
   *                 description: HTTPS URL or root-relative path e.g. /Uploads/avatar.png
   *           examples:
   *             minimal:
   *               summary: Name only
   *               value: { name: "Citizen helper" }
   *             full:
   *               summary: All fields
   *               value:
   *                 name: "Citizen helper"
   *                 description: "Helps with municipal FAQs."
   *                 profilePicUrl: "https://example.com/twin.png"
   *     responses:
   *       201:
   *         description: Created
   *       400:
   *         description: Validation error
   *       401: { description: Unauthorized }
   *       403: { description: Forbidden }
   */
  router.post('/', adminOnly, async (req, res) => {
    const { value, error } = createSchema.validate(req.body || {}, { stripUnknown: true });
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }
    try {
      const twin = await aiTwinService.createTwin(value, ownerIdFromReq(req));
      res.status(201).json(twin);
    } catch (error_) {
      if (error_.statusCode === 400) {
        return res.status(400).json({ message: error_.message });
      }
      logger.error(`ai-twin create: ${error_.message}`, { stack: error_.stack });
      res.status(500).json({ message: error_.message });
    }
  });

  /**
   * @swagger
   * /ai-twins/{twinId}/kb-files:
   *   post:
   *     summary: Assign knowledge-base file(s) to this twin
   *     description: >-
   *       Links document-repository `file_id` values (normalized; optional `files/` prefix is stripped).
   *       Does not modify the KB — only stores ids on the twin for future retrieval filtering.
   *     tags: [AI Twins]
   *     security: [ { bearerAuth: [] } ]
   *     parameters:
   *       - in: path
   *         name: twinId
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             oneOf:
   *               - type: object
   *                 required: [fileId]
   *                 properties:
   *                   fileId: { type: string, description: Single KB file id }
   *               - type: object
   *                 required: [fileIds]
   *                 properties:
   *                   fileIds:
   *                     type: array
   *                     items: { type: string }
   *                     maxItems: 500
   *           examples:
   *             one:
   *               value: { fileId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }
   *             many:
   *               value: { fileIds: ["id-one", "id-two"] }
   *     responses:
   *       200: { description: Updated twin including linkedKbFileIds }
   *       400: { description: Validation error }
   *       404: { description: Twin not found }
   */
  router.post('/:twinId/kb-files', adminOnly, async (req, res) => {
    const { value, error } = assignKbBodySchema.validate(req.body || {}, { stripUnknown: true });
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }
    const ids = fileIdsFromAssignPayload(value);
    try {
      const twin = await aiTwinService.assignKbFiles(req.params.twinId, ids, ownerIdFromReq(req));
      res.json(twin);
    } catch (error_) {
      if (error_.statusCode === 404) {
        return res.status(404).json({ message: error_.message });
      }
      if (error_.statusCode === 400) {
        return res.status(400).json({ message: error_.message });
      }
      logger.error(`ai-twin assign kb: ${error_.message}`, { stack: error_.stack });
      res.status(500).json({ message: error_.message });
    }
  });

  /**
   * @swagger
   * /ai-twins/{twinId}/kb-files:
   *   patch:
   *     summary: Replace all KB file links for this twin
   *     description: >-
   *       Sends the complete `linkedKbFileIds` array. Server checks each id exists in the
   *       document-repository `files` collection (same database). Empty array clears all links.
   *       Set env AI_TWIN_SKIP_KB_FILE_EXISTENCE_CHECK=true to skip checks (not recommended in production).
   *     tags: [AI Twins]
   *     security: [ { bearerAuth: [] } ]
   *     parameters:
   *       - in: path
   *         name: twinId
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [linkedKbFileIds]
   *             properties:
   *               linkedKbFileIds:
   *                 type: array
   *                 items: { type: string }
   *                 maxItems: 10000
   *                 description: Full list of document `file_id` values (order preserved, duplicates removed)
   *           examples:
   *             clearAll:
   *               summary: No KB files
   *               value: { linkedKbFileIds: [] }
   *             twoFiles:
   *               summary: Two file ids
   *               value:
   *                 linkedKbFileIds:
   *                   - "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
   *                   - "b2c3d4e5-f6a7-8901-bcde-f12345678901"
   *     responses:
   *       200: { description: Updated twin }
   *       400: { description: Unknown id or validation error }
   *       404: { description: Twin not found }
   */
  router.patch('/:twinId/kb-files', adminOnly, async (req, res) => {
    const { value, error } = replaceKbFilesSchema.validate(req.body || {}, { stripUnknown: true });
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }
    try {
      const twin = await aiTwinService.replaceKbFiles(req.params.twinId, value.linkedKbFileIds, ownerIdFromReq(req));
      res.json(twin);
    } catch (error_) {
      if (error_.statusCode === 404) {
        return res.status(404).json({ message: error_.message });
      }
      if (error_.statusCode === 400) {
        return res.status(400).json({ message: error_.message });
      }
      logger.error(`ai-twin replace kb: ${error_.message}`, { stack: error_.stack });
      res.status(500).json({ message: error_.message });
    }
  });

  /**
   * @swagger
   * /ai-twins/{twinId}/kb-files:
   *   delete:
   *     summary: Unassign knowledge-base file(s) from this twin
   *     description: >-
   *       Query param `fileId` is supported for clients that cannot send a DELETE body.
   *       Otherwise send JSON `{ fileId }` or `{ fileIds }` as for POST assign.
   *     tags: [AI Twins]
   *     security: [ { bearerAuth: [] } ]
   *     parameters:
   *       - in: path
   *         name: twinId
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: fileId
   *         required: false
   *         schema: { type: string }
   *         description: Single file id to remove (alternative to request body)
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             oneOf:
   *               - type: object
   *                 required: [fileId]
   *                 properties:
   *                   fileId: { type: string }
   *               - type: object
   *                 required: [fileIds]
   *                 properties:
   *                   fileIds:
   *                     type: array
   *                     items: { type: string }
   *     responses:
   *       200: { description: Updated twin }
   *       400: { description: Validation error }
   *       404: { description: Twin not found }
   */
  router.delete('/:twinId/kb-files', adminOnly, async (req, res) => {
    let ids = [];
    if (req.query.fileId && typeof req.query.fileId === 'string') {
      ids = [req.query.fileId];
    } else {
      const { value, error } = unassignKbBodySchema.validate(req.body || {}, { stripUnknown: true });
      if (error) {
        return res.status(400).json({ message: error.details[0].message });
      }
      ids = fileIdsFromAssignPayload(value);
    }
    try {
      const twin = await aiTwinService.unassignKbFiles(req.params.twinId, ids, ownerIdFromReq(req));
      res.json(twin);
    } catch (error_) {
      if (error_.statusCode === 404) {
        return res.status(404).json({ message: error_.message });
      }
      if (error_.statusCode === 400) {
        return res.status(400).json({ message: error_.message });
      }
      logger.error(`ai-twin unassign kb: ${error_.message}`, { stack: error_.stack });
      res.status(500).json({ message: error_.message });
    }
  });

  /**
   * @swagger
   * /ai-twins/default:
   *   get:
   *     summary: Get the current default twin (carries the WhatsApp/voice phone number)
   *     tags: [AI Twins]
   *     security: [ { bearerAuth: [] } ]
   *     responses:
   *       200: { description: Default twin (with twinNumber) }
   *       404: { description: No twin is currently marked as default }
   */
  // NOTE: Must be declared BEFORE GET /:twinId so the literal path wins.
  router.get('/default', async (req, res) => {
    try {
      const twin = await aiTwinService.getDefaultTwin();
      if (!twin) return res.status(404).json({ message: 'No default twin set' });
      // Owner scope: only the admin who owns the default twin sees it via this
      // endpoint. Internal services (whatsapp / voice-bridge) call the service
      // directly and aren't affected.
      const ownerId = ownerIdFromReq(req);
      if (ownerId && twin.ownerId && twin.ownerId !== ownerId) {
        return res.status(404).json({ message: 'No default twin set' });
      }
      res.json(twin);
    } catch (error) {
      logger.error(`ai-twin get default: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * @swagger
   * /ai-twins/{twinId}:
   *   get:
   *     summary: Get one AI twin
   *     tags: [AI Twins]
   *     security: [ { bearerAuth: [] } ]
   *     parameters:
   *       - in: path
   *         name: twinId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: The twin
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 _key: { type: string }
   *                 name: { type: string }
   *                 profilePicUrl: { type: string, nullable: true }
   *                 description: { type: string }
   *                 voiceId: { type: string, nullable: true }
   *                 chatGreeting: { type: string }
   *                 callGreeting: { type: string }
   *                 isDefault: { type: boolean }
   *                 twinNumber: { type: string, description: "Empty string for non-default twins" }
   *                 linkedKbFileIds:
   *                   type: array
   *                   items: { type: string }
   *                 linkedKbFiles:
   *                   type: array
   *                   description: Expanded KB file metadata for linkedKbFileIds
   *                   items:
   *                     type: object
   *                     properties:
   *                       fileId: { type: string }
   *                       _key: { type: string }
   *                       fileName: { type: string, nullable: true }
   *                       originalName: { type: string, nullable: true }
   *                       mimeType: { type: string, nullable: true }
   *                       fileType: { type: string, nullable: true }
   *                       size: { type: number, nullable: true }
   *                       title: { type: string, nullable: true }
   *                       description: { type: string, nullable: true }
   *                       category: { type: string, nullable: true }
   *                       tags:
   *                         type: array
   *                         items: { type: string }
   *                       labels:
   *                         type: array
   *                         items: { type: string }
   *                       status: { type: string, nullable: true }
   *                       sourceUrl: { type: string, nullable: true }
   *                       createdAt: { type: string, nullable: true }
   *                       updatedAt: { type: string, nullable: true }
   *                 numChats: { type: integer, description: "Web chat sessions linked to this twin" }
   *                 numWhatsappChats: { type: integer, description: "WhatsApp chat sessions linked to this twin" }
   *                 numCalls: { type: integer, description: "Voice call sessions linked to this twin" }
   *                 createdAt: { type: string, format: date-time }
   *                 updatedAt: { type: string, format: date-time }
   *       404: { description: Twin not found }
   */
  /**
   * @swagger
   * /ai-twins/default-prompt:
   *   get:
   *     summary: Return the platform default system prompt (read-only, no twin ID needed)
   *     tags: [AI Twins]
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Default system prompt }
   */
  router.get('/default-prompt', adminOnly, (req, res) => {
    res.json({ systemPrompt: aiTwinService.DEFAULT_SYSTEM_PROMPT });
  });

  router.get('/:twinId', async (req, res) => {
    try {
      const userKey = ownerIdFromReq(req);
      const getOpts = { includeKbFiles: true };
      // Admins are scoped to twins they own (404 across tenants). Patients are
      // scoped to their admin AND optionally narrowed by allowedTwinIds.
      // A user with no adminId at all is denied (404).
      if (isAdminReq(req)) {
        getOpts.ownerId = userKey;
      } else {
        const access = await patientService.getSelfTwinAccess(userKey);
        if (!access) {
          return res.status(404).json({ message: 'AI twin not found' });
        }
        if (
          Array.isArray(access.allowedTwinIds) &&
          !access.allowedTwinIds.includes(req.params.twinId)
        ) {
          return res.status(404).json({ message: 'AI twin not found' });
        }
        // Tenant scope: the twin must belong to the patient's admin even
        // when allowedTwinIds is null (no explicit allow-list).
        getOpts.ownerId = access.adminId;
      }
      const twin = await aiTwinService.getTwinByKey(req.params.twinId, getOpts);
      const counts = await aiTwinService.getTwinSessionCounts(twin._key);
      res.json({ ...twin, ...counts });
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({ message: error.message });
      }
      logger.error(`ai-twin get: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * @swagger
   * /ai-twins/{twinId}:
   *   patch:
   *     summary: Update AI twin
   *     tags: [AI Twins]
   *     security: [ { bearerAuth: [] } ]
   *     parameters:
   *       - in: path
   *         name: twinId
   *         required: true
   *         schema: { type: string }
   *         description: Twin document _key (UUID)
   *     requestBody:
   *       required: true
   *       description: At least one property required (matches server validation)
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             minProperties: 1
   *             properties:
   *               name:
   *                 type: string
   *                 minLength: 1
   *                 maxLength: 200
   *               description:
   *                 type: string
   *                 maxLength: 50000
   *               profilePicUrl:
   *                 type: string
   *                 nullable: true
   *                 maxLength: 2048
   *                 description: HTTPS URL or root-relative path; null clears stored URL
   *           examples:
   *             rename:
   *               value: { name: "New name" }
   *             clearAvatar:
   *               value: { profilePicUrl: null }
   *     responses:
   *       200:
   *         description: >-
   *           Updated twin. Response shape mirrors GET /ai-twins/{twinId} —
   *           the persisted fields plus the live read-only session counts
   *           (numChats, numWhatsappChats, numCalls) so the frontend can
   *           refresh its state in a single round-trip.
   *       400:
   *         description: Validation error
   *       401: { description: Unauthorized }
   *       403: { description: Forbidden }
   *       404:
   *         description: Twin not found
   */
  router.patch('/:twinId', adminOnly, async (req, res) => {
    const { value, error } = updateSchema.validate(req.body || {}, { stripUnknown: true });
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }
    try {
      const twin = await aiTwinService.updateTwin(req.params.twinId, value, ownerIdFromReq(req));
      // Mirror GET /:twinId — include the live session counts so the
      // frontend can keep its store in sync without a second fetch.
      const counts = await aiTwinService.getTwinSessionCounts(twin._key);
      res.json({ ...twin, ...counts });
    } catch (error_) {
      if (error_.statusCode === 404) {
        return res.status(404).json({ message: error_.message });
      }
      if (error_.statusCode === 400) {
        return res.status(400).json({ message: error_.message });
      }
      logger.error(`ai-twin patch: ${error_.message}`, { stack: error_.stack });
      res.status(500).json({ message: error_.message });
    }
  });

  /**
   * @swagger
   * /ai-twins/{twinId}/voice:
   *   patch:
   *     summary: Assign a voice to an AI twin
   *     tags: [AI Twins]
   *     security: [ { bearerAuth: [] } ]
   *     parameters:
   *       - in: path
   *         name: twinId
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [voiceId]
   *             properties:
   *               voiceId:
   *                 type: string
   *                 description: _key from /api/voices
   *     responses:
   *       200: { description: Updated twin (includes voiceId) }
   *       400: { description: voiceId missing or not in catalog }
   *       404: { description: Twin not found }
   */
  router.patch('/:twinId/voice', adminOnly, async (req, res) => {
    const { value, error } = assignVoiceSchema.validate(req.body || {}, { stripUnknown: true });
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }
    try {
      const twin = await aiTwinService.updateTwin(req.params.twinId, { voiceId: value.voiceId }, ownerIdFromReq(req));
      const counts = await aiTwinService.getTwinSessionCounts(twin._key);
      res.json({ ...twin, ...counts });
    } catch (error_) {
      if (error_.statusCode === 404) {
        return res.status(404).json({ message: error_.message });
      }
      if (error_.statusCode === 400) {
        return res.status(400).json({ message: error_.message });
      }
      logger.error(`ai-twin assign voice: ${error_.message}`, { stack: error_.stack });
      res.status(500).json({ message: error_.message });
    }
  });

  /**
   * @swagger
   * /ai-twins/{twinId}/avatar:
   *   post:
   *     summary: Upload an avatar image and set it as the twin's profilePicUrl
   *     tags: [AI Twins]
   *     security: [ { bearerAuth: [] } ]
   *     parameters:
   *       - in: path
   *         name: twinId
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             required: [image]
   *             properties:
   *               image:
   *                 type: string
   *                 format: binary
   *                 description: jpeg / png / webp / gif, ≤ 5 MB
   *     responses:
   *       200:
   *         description: Updated twin (profilePicUrl set to /Uploads/ai-twins/...)
   *       400: { description: Missing or invalid image }
   *       404: { description: Twin not found }
   */
  router.post('/:twinId/avatar', adminOnly, (req, res, next) => {
    avatarUpload.single('image')(req, res, (err) => {
      if (err) {
        const code = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        return res.status(code).json({ message: err.message || 'upload failed' });
      }
      next();
    });
  }, async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ message: 'image file is required (form field "image")' });
    }
    const publicUrl = `${AVATAR_PUBLIC_PREFIX}/${req.file.filename}`;
    try {
      const twin = await aiTwinService.updateTwin(req.params.twinId, { profilePicUrl: publicUrl }, ownerIdFromReq(req));
      const counts = await aiTwinService.getTwinSessionCounts(twin._key);
      res.json({ ...twin, ...counts });
    } catch (error) {
      // Best-effort cleanup so we don't leave an orphan file on disk.
      try { fs.unlinkSync(req.file.path); } catch {}
      if (error.statusCode === 404) {
        return res.status(404).json({ message: error.message });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({ message: error.message });
      }
      logger.error(`ai-twin avatar upload: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * @swagger
   * /ai-twins/{twinId}/settings:
   *   get:
   *     summary: Get twin settings (chat/call greetings + phone number)
   *     tags: [AI Twins]
   *     security: [ { bearerAuth: [] } ]
   *     parameters:
   *       - in: path
   *         name: twinId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Current settings
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 chatGreeting: { type: string, description: "Sent at the start of a new chat session" }
   *                 callGreeting: { type: string, description: "Spoken at the start of a new voice call" }
   *                 twinNumber: { type: string, description: "WhatsApp/voice phone number for this twin" }
   *       404: { description: Twin not found }
   *
   *   post:
   *     summary: Update twin chat/call greetings (twinNumber is read-only here)
   *     tags: [AI Twins]
   *     security: [ { bearerAuth: [] } ]
   *     parameters:
   *       - in: path
   *         name: twinId
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               chatGreeting: { type: string, maxLength: 5000 }
   *               callGreeting: { type: string, maxLength: 5000 }
   *     responses:
   *       200: { description: Updated settings (still includes twinNumber for read) }
   *       400: { description: Validation error / no fields }
   *       404: { description: Twin not found }
   */
  router.get('/:twinId/settings', async (req, res) => {
    try {
      const settings = await aiTwinService.getSettings(req.params.twinId, ownerIdFromReq(req));
      res.json(settings);
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({ message: error.message });
      }
      logger.error(`ai-twin get settings: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  });

  router.post('/:twinId/settings', adminOnly, async (req, res) => {
    const { value, error } = settingsSchema.validate(req.body || {}, { stripUnknown: true });
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }
    try {
      const settings = await aiTwinService.updateSettings(req.params.twinId, value, ownerIdFromReq(req));
      res.json(settings);
    } catch (error_) {
      if (error_.statusCode === 404) {
        return res.status(404).json({ message: error_.message });
      }
      if (error_.statusCode === 400) {
        return res.status(400).json({ message: error_.message });
      }
      logger.error(`ai-twin post settings: ${error_.message}`, { stack: error_.stack });
      res.status(500).json({ message: error_.message });
    }
  });

  /**
   * @swagger
   * /ai-twins/{twinId}/personality:
   *   get:
   *     summary: Get the AI Personality (language style + response length) for a twin
   *     description: >-
   *       Defaults are applied when the twin doc has no personality field —
   *       the response is always fully populated.
   *     tags: [AI Twins]
   *     security: [ { bearerAuth: [] } ]
   *     parameters:
   *       - in: path
   *         name: twinId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Personality
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 languageStyle:  { type: string, enum: [slang, casual, professional] }
   *                 responseLength: { type: string, enum: [short, medium, long] }
   *       404: { description: Twin not found }
   *   post:
   *     summary: Update AI Personality (partial — send only fields you want to change)
   *     tags: [AI Twins]
   *     security: [ { bearerAuth: [] } ]
   *     parameters:
   *       - in: path
   *         name: twinId
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               languageStyle:  { type: string, enum: [slang, casual, professional] }
   *               responseLength: { type: string, enum: [short, medium, long] }
   *     responses:
   *       200: { description: Updated personality (full object) }
   *       400: { description: Validation error / no fields }
   *       404: { description: Twin not found }
   */
  router.get('/:twinId/personality', async (req, res) => {
    try {
      const personality = await aiTwinService.getPersonality(req.params.twinId, ownerIdFromReq(req));
      res.json(personality);
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({ message: error.message });
      }
      logger.error(`ai-twin get personality: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * @swagger
   * /ai-twins/{twinId}/suggested-instructions:
   *   get:
   *     summary: List suggested instructions not already configured on this twin
   *     tags: [AI Twins]
   *     security: [ { bearerAuth: [] } ]
   *     parameters:
   *       - in: path
   *         name: twinId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Suggested instruction strings filtered by twin config
   *       404: { description: Twin not found }
   *
   * /ai-twins/{twinId}/instructions:
   *   parameters:
   *     - in: path
   *       name: twinId
   *       required: true
   *       schema: { type: string }
   *   get:
   *     summary: Get admin instructions for a twin
   *     tags: [AI Twins]
   *     security: [ { bearerAuth: [] } ]
   *     responses:
   *       200: { description: Instruction list }
   *       404: { description: Twin not found }
   *   post:
   *     summary: Replace admin instructions for a twin
   *     tags: [AI Twins]
   *     security: [ { bearerAuth: [] } ]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [instructions]
   *             properties:
   *               instructions:
   *                 type: array
   *                 items: { type: string, maxLength: 1000 }
   *                 maxItems: 100
   *     responses:
   *       200: { description: Updated instruction list }
   *       400: { description: Validation error }
   *       404: { description: Twin not found }
   */
  router.get('/:twinId/suggested-instructions', async (req, res) => {
    try {
      const instructions = await aiTwinService.getSuggestedInstructionsForTwin(
        req.params.twinId,
        ownerIdFromReq(req)
      );
      res.json({ instructions });
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({ message: error.message });
      }
      logger.error(`ai-twin suggested instructions: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  });

  router.get('/:twinId/instructions', async (req, res) => {
    try {
      const instructions = await aiTwinService.getInstructions(req.params.twinId, ownerIdFromReq(req));
      res.json({ instructions });
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({ message: error.message });
      }
      logger.error(`ai-twin get instructions: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  });

  router.post('/:twinId/instructions', adminOnly, async (req, res) => {
    const { value, error } = instructionsReplaceSchema.validate(req.body || {}, { stripUnknown: true });
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }
    try {
      const instructions = await aiTwinService.updateInstructions(
        req.params.twinId,
        value.instructions,
        ownerIdFromReq(req)
      );
      res.json({ instructions });
    } catch (error_) {
      if (error_.statusCode === 404) {
        return res.status(404).json({ message: error_.message });
      }
      if (error_.statusCode === 400) {
        return res.status(400).json({ message: error_.message });
      }
      logger.error(`ai-twin post instructions: ${error_.message}`, { stack: error_.stack });
      res.status(500).json({ message: error_.message });
    }
  });

  router.post('/:twinId/personality', adminOnly, async (req, res) => {
    const { value, error } = personalitySchema.validate(req.body || {}, { stripUnknown: true });
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }
    try {
      const personality = await aiTwinService.updatePersonality(req.params.twinId, value, ownerIdFromReq(req));
      res.json(personality);
    } catch (error_) {
      if (error_.statusCode === 404) {
        return res.status(404).json({ message: error_.message });
      }
      if (error_.statusCode === 400) {
        return res.status(400).json({ message: error_.message });
      }
      logger.error(`ai-twin post personality: ${error_.message}`, { stack: error_.stack });
      res.status(500).json({ message: error_.message });
    }
  });

  /**
   * @swagger
   * /ai-twins/{twinId}/prompt:
   *   get:
   *     summary: Get the system prompt for a twin
   *     description: >-
   *       Returns the editable base system prompt for this twin.
   *       This is the main identity/behaviour text that admins can customise.
   *       Voice-specific instructions and retrieved-context directives are
   *       appended automatically at runtime and are NOT returned here.
   *     tags: [AI Twins]
   *     security: [ { bearerAuth: [] } ]
   *     parameters:
   *       - in: path
   *         name: twinId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: The twin's system prompt
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 systemPrompt: { type: string }
   *       404: { description: Twin not found }
   *   patch:
   *     summary: Update the system prompt for a twin (admin only)
   *     description: >-
   *       Replaces the editable base system prompt. Only the base/identity prompt
   *       should be sent — do NOT include voice-mode instructions or retrieved-
   *       context directives; those are managed by the system and appended at runtime.
   *     tags: [AI Twins]
   *     security: [ { bearerAuth: [] } ]
   *     parameters:
   *       - in: path
   *         name: twinId
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [systemPrompt]
   *             properties:
   *               systemPrompt:
   *                 type: string
   *                 minLength: 1
   *                 maxLength: 50000
   *     responses:
   *       200: { description: Updated system prompt }
   *       400: { description: Validation error }
   *       404: { description: Twin not found }
   */
  router.get('/:twinId/prompt', adminOnly, async (req, res) => {
    try {
      const systemPrompt = await aiTwinService.getSystemPrompt(req.params.twinId, ownerIdFromReq(req));
      res.json({ systemPrompt });
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({ message: error.message });
      }
      logger.error(`ai-twin get prompt: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  });

  router.patch('/:twinId/prompt', adminOnly, async (req, res) => {
    const { value, error } = systemPromptSchema.validate(req.body || {}, { stripUnknown: true });
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }
    try {
      const systemPrompt = await aiTwinService.updateSystemPrompt(
        req.params.twinId,
        value.systemPrompt,
        ownerIdFromReq(req)
      );
      res.json({ systemPrompt });
    } catch (error_) {
      if (error_.statusCode === 404) {
        return res.status(404).json({ message: error_.message });
      }
      if (error_.statusCode === 400) {
        return res.status(400).json({ message: error_.message });
      }
      logger.error(`ai-twin patch prompt: ${error_.message}`, { stack: error_.stack });
    res.status(500).json({ message: error_.message });
  }
});

  /**
   * @swagger
   * /ai-twins/{twinId}:
   *   delete:
   *     summary: Delete AI twin (the default twin cannot be deleted — returns 409)
   *     tags: [AI Twins]
   *     security: [ { bearerAuth: [] } ]
   *     responses:
   *       204: { description: Deleted }
   *       404: { description: Twin not found }
   *       409: { description: Cannot delete the default twin }
   */
  router.delete('/:twinId', adminOnly, async (req, res) => {
    try {
      await aiTwinService.deleteTwin(req.params.twinId, ownerIdFromReq(req));
      res.status(204).send();
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({ message: error.message });
      }
      if (error.statusCode === 409) {
        return res.status(409).json({ message: error.message });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({ message: error.message });
      }
      logger.error(`ai-twin delete: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * @swagger
   * /ai-twins/{twinId}/suggested-questions:
   *   get:
   *     summary: Per-twin suggested chat-landing questions
   *     description: >-
   *       Returns the twin's per-KB suggested-question set generated by the
   *       LLM from its linked knowledge-base content. Refreshes automatically
   *       (fire-and-forget) whenever an admin links / unlinks / replaces KB
   *       files. When the twin has no KB attached, no chunks yet, or the LLM
   *       generation hasn't run, this endpoint falls back to the global
   *       curated NCD list at /api/suggested-questions.
   *     tags: [AI Twins]
   *     security: [ { bearerAuth: [] } ]
   *     parameters:
   *       - in: path
   *         name: twinId
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: status
   *         required: false
   *         schema: { type: string, enum: [enabled, all], default: enabled }
   *         description: >-
   *           `enabled` (default) — only rows the admin has left turned on; used
   *           by the chat-landing UI. Falls back to the global curated list when
   *           none are enabled. `all` — admin management view, returns every
   *           row including disabled ones with the full row shape.
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
   *                   _key:     { type: string, nullable: true, description: Row key (absent when serving the global curated fallback) }
   *                   twinId:   { type: string, nullable: true }
   *                   order:    { type: integer, example: 1 }
   *                   category: { type: string,  example: Hypertension }
   *                   content:  { type: string,  example: "How do I know if my blood pressure is too high?" }
   *                   enabled:  { type: boolean, nullable: true }
   *                   source:   { type: string, enum: [generated, manual], nullable: true }
   *                   createdAt: { type: string, format: date-time, nullable: true }
   *                   updatedAt: { type: string, format: date-time, nullable: true }
   *       404: { description: Twin not found }
   */
  router.get('/:twinId/suggested-questions', async (req, res) => {
    try {
      const userKey = ownerIdFromReq(req);
      // Same scoping as GET /:twinId — admins are owner-scoped; patients are
      // scoped to their admin AND optionally narrowed by allowedTwinIds.
      let scopedOwnerId;
      if (isAdminReq(req)) {
        scopedOwnerId = userKey;
      } else {
        const access = await patientService.getSelfTwinAccess(userKey);
        if (!access) {
          return res.status(404).json({ message: 'AI twin not found' });
        }
        if (
          Array.isArray(access.allowedTwinIds) &&
          !access.allowedTwinIds.includes(req.params.twinId)
        ) {
          return res.status(404).json({ message: 'AI twin not found' });
        }
        scopedOwnerId = access.adminId;
      }

      // status=all is admin-only — it exposes disabled rows used to render
      // the management UI; non-admins always get the enabled-only view.
      const requestedStatus = req.query.status === 'all' ? 'all' : 'enabled';
      if (requestedStatus === 'all' && !isAdminReq(req)) {
        return res.status(403).json({ message: 'admin role required for status=all' });
      }

      const questions = await aiTwinService.getSuggestedQuestions(
        req.params.twinId,
        scopedOwnerId,
        { status: requestedStatus }
      );
      res.json(questions);
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({ message: error.message });
      }
      logger.error(`ai-twin suggested-questions get: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * @swagger
   * /ai-twins/{twinId}/suggested-questions:
   *   post:
   *     summary: Add a custom (manual) suggested question
   *     description: >-
   *       Admin-only. Inserts a new row with `source='manual'` that survives
   *       any future LLM regeneration (manual rows are preserved on regen).
   *     tags: [AI Twins]
   *     security: [ { bearerAuth: [] } ]
   *     parameters:
   *       - in: path
   *         name: twinId
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [content]
   *             properties:
   *               content:  { type: string, maxLength: 300 }
   *               category: { type: string, maxLength: 100, description: Short topic label; defaults to "General" }
   *               order:    { type: integer, description: Optional display order; appended at the end when omitted }
   *               enabled:  { type: boolean, default: true }
   *     responses:
   *       201: { description: Question created (returns the new row) }
   *       400: { description: Validation error }
   *       404: { description: Twin not found }
   */
  router.post('/:twinId/suggested-questions', adminOnly, async (req, res) => {
    try {
      const row = await aiTwinService.addSuggestedQuestion(
        req.params.twinId,
        req.body || {},
        ownerIdFromReq(req)
      );
      res.status(201).json(row);
    } catch (error) {
      if (error.statusCode === 404) return res.status(404).json({ message: error.message });
      if (error.statusCode === 400 || error instanceof Error && error.message?.toLowerCase().includes('required')) {
        return res.status(400).json({ message: error.message });
      }
      logger.error(`ai-twin suggested-question add: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * @swagger
   * /ai-twins/{twinId}/suggested-questions/{questionId}:
   *   patch:
   *     summary: Edit / toggle / reorder one suggested question
   *     description: >-
   *       Admin-only. Any of `content`, `category`, or `enabled` triggers
   *       sticky-on-edit — if the row was `source='generated'`, it is promoted
   *       to `source='manual'` so the next LLM regen won't overwrite it. Pure
   *       reordering (`order` only) does NOT promote.
   *     tags: [AI Twins]
   *     security: [ { bearerAuth: [] } ]
   *     parameters:
   *       - in: path
   *         name: twinId
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: questionId
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             minProperties: 1
   *             properties:
   *               content:  { type: string, maxLength: 300 }
   *               category: { type: string, maxLength: 100 }
   *               enabled:  { type: boolean }
   *               order:    { type: integer }
   *     responses:
   *       200: { description: Updated row }
   *       400: { description: Validation error }
   *       404: { description: Question or twin not found }
   */
  router.patch('/:twinId/suggested-questions/:questionId', adminOnly, async (req, res) => {
    try {
      const row = await aiTwinService.updateSuggestedQuestion(
        req.params.twinId,
        req.params.questionId,
        req.body || {},
        ownerIdFromReq(req)
      );
      res.json(row);
    } catch (error) {
      if (error.statusCode === 404) return res.status(404).json({ message: error.message });
      if (error.statusCode === 400 || (error instanceof Error && error.message?.toLowerCase().includes('must be'))) {
        return res.status(400).json({ message: error.message });
      }
      logger.error(`ai-twin suggested-question patch: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * @swagger
   * /ai-twins/{twinId}/suggested-questions/{questionId}:
   *   delete:
   *     summary: Delete a suggested question
   *     description: Admin-only. Works for both generated and manual rows.
   *     tags: [AI Twins]
   *     security: [ { bearerAuth: [] } ]
   *     parameters:
   *       - in: path
   *         name: twinId
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: questionId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       204: { description: Deleted }
   *       404: { description: Question or twin not found }
   */
  router.delete('/:twinId/suggested-questions/:questionId', adminOnly, async (req, res) => {
    try {
      await aiTwinService.deleteSuggestedQuestion(
        req.params.twinId,
        req.params.questionId,
        ownerIdFromReq(req)
      );
      res.status(204).send();
    } catch (error) {
      if (error.statusCode === 404) return res.status(404).json({ message: error.message });
      logger.error(`ai-twin suggested-question delete: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * @swagger
   * /ai-twins/{twinId}/suggested-questions/regenerate:
   *   post:
   *     summary: Force a fresh LLM generation of this twin's suggested questions
   *     description: >-
   *       Admin-only. Synchronously samples chunks from the twin's KB, calls
   *       the LLM, and stores the result on the twin doc. Returns the new
   *       questions (or the global fallback if the twin has no KB / no chunks
   *       yet). Takes ~1-3 seconds depending on LLM load.
   *     tags: [AI Twins]
   *     security: [ { bearerAuth: [] } ]
   *     parameters:
   *       - in: path
   *         name: twinId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Updated suggested questions (or global fallback if none generated)
   *       404: { description: Twin not found }
   */
  router.post('/:twinId/suggested-questions/regenerate', adminOnly, async (req, res) => {
    try {
      const generated = await aiTwinService.generateSuggestedQuestions(
        req.params.twinId,
        ownerIdFromReq(req)
      );
      // Return whatever the twin now has (may be the global fallback if KB is empty).
      const questions = generated || (await aiTwinService.getSuggestedQuestions(req.params.twinId, ownerIdFromReq(req)));
      res.json(questions);
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({ message: error.message });
      }
      logger.error(`ai-twin suggested-questions regenerate: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  });

  return router;
};
