const express = require('express');
const authMiddleware = require('../middleware/auth-middleware');
const { logger } = require('../shared-lib');

/**
 * Server-owned chat sessions: create session, send one message; backend loads history and calls ChatQnA.
 */
module.exports = (chatSessionService) => {
  if (!chatSessionService || typeof chatSessionService.createSession !== 'function') {
    throw new Error('chatSessionService is required');
  }

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

  return router;
};
