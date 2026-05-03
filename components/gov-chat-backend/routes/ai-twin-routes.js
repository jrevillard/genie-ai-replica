const express = require('express');
const Joi = require('joi');
const authMiddleware = require('../middleware/auth-middleware');
const { logger } = require('../shared-lib');

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
});

const updateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(200),
  description: Joi.string().allow('').max(50000),
  profilePicUrl: profilePicUrlSchema.optional(),
})
  .min(1)
  .messages({ 'object.min': 'at least one field is required' });

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
  router.use(authMiddleware.authenticate, authMiddleware.isAdmin);

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
      const result = await aiTwinService.listTwins({ offset, limit });
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
  router.post('/', async (req, res) => {
    const { value, error } = createSchema.validate(req.body || {}, { stripUnknown: true });
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }
    try {
      const twin = await aiTwinService.createTwin(value);
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
  router.post('/:twinId/kb-files', async (req, res) => {
    const { value, error } = assignKbBodySchema.validate(req.body || {}, { stripUnknown: true });
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }
    const ids = fileIdsFromAssignPayload(value);
    try {
      const twin = await aiTwinService.assignKbFiles(req.params.twinId, ids);
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
  router.patch('/:twinId/kb-files', async (req, res) => {
    const { value, error } = replaceKbFilesSchema.validate(req.body || {}, { stripUnknown: true });
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }
    try {
      const twin = await aiTwinService.replaceKbFiles(req.params.twinId, value.linkedKbFileIds);
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
  router.delete('/:twinId/kb-files', async (req, res) => {
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
      const twin = await aiTwinService.unassignKbFiles(req.params.twinId, ids);
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
   */
  router.get('/:twinId', async (req, res) => {
    try {
      const twin = await aiTwinService.getTwinByKey(req.params.twinId);
      res.json(twin);
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
   *         description: Updated twin
   *       400:
   *         description: Validation error
   *       401: { description: Unauthorized }
   *       403: { description: Forbidden }
   *       404:
   *         description: Twin not found
   */
  router.patch('/:twinId', async (req, res) => {
    const { value, error } = updateSchema.validate(req.body || {}, { stripUnknown: true });
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }
    try {
      const twin = await aiTwinService.updateTwin(req.params.twinId, value);
      res.json(twin);
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
   * /ai-twins/{twinId}:
   *   delete:
   *     summary: Delete AI twin
   *     tags: [AI Twins]
   *     security: [ { bearerAuth: [] } ]
   */
  router.delete('/:twinId', async (req, res) => {
    try {
      await aiTwinService.deleteTwin(req.params.twinId);
      res.status(204).send();
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({ message: error.message });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({ message: error.message });
      }
      logger.error(`ai-twin delete: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  });

  return router;
};
