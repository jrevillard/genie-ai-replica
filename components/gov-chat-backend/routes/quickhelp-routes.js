'use strict';

/**
 * quickhelp-routes.js — J.4 (DEC-28)
 *
 * Quick-help button management for the chat landing page.
 * GET is authed (any logged-in user — the chat page is behind login);
 * every mutation requires the admin role (keycloakAuthMiddleware.requireAdmin).
 *
 * Shape (see services/quickhelp-service.js):
 *   { _key, order, enabled, isJustChat, title: {en, st?}, prompt: {en, st?}, icon }
 */

const express = require('express');
const router = express.Router();
const { logger } = require('../shared-lib');
const { keycloakAuthMiddleware } = require('../middleware/keycloak-auth-middleware');

module.exports = (quickhelpService) => {
  if (!quickhelpService || typeof quickhelpService.list !== 'function') {
    logger.error('Invalid quickhelpService provided to quickhelp-routes');
    throw new Error('quickhelpService is required with list');
  }

  /**
   * @swagger
   * /quickhelp:
   *   get:
   *     summary: List quick-help buttons
   *     description: Enabled buttons sorted by order (chat-page view); ?all=1 returns disabled too (admin view)
   *     tags: [Quick Help]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: query
   *         name: all
   *         schema: { type: string, enum: ['1'] }
   *         description: Return all buttons including disabled (admin)
   *     responses:
   *       '200': { description: Button list }
   *       '401': { description: Unauthorized }
   *       '500': { description: Server error }
   */
  // ?all=1 (admin view incl. disabled buttons) is admin-gated server-side —
  // the split must not live only in client convention (J.4 review F6).
  router.get(
    '/',
    (req, res, next) => {
      if (req.query.all === '1') return keycloakAuthMiddleware.requireAdmin(req, res, next);
      next();
    },
    async (req, res) => {
      try {
        const buttons = await quickhelpService.list({ all: req.query.all === '1' });
        res.json(buttons);
      } catch (error) {
        logger.error(`Error listing quick-help buttons: ${error.message}`, { stack: error.stack });
        res.status(500).json({ message: 'Internal server error' });
      }
    }
  );

  /**
   * @swagger
   * /quickhelp:
   *   post:
   *     summary: Create a quick-help button
   *     tags: [Quick Help]
   *     security: [{ bearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { type: object }
   *     responses:
   *       '201': { description: Created button }
   *       '400': { description: Invalid payload }
   *       '401': { description: Unauthorized }
   *       '403': { description: Admin access required }
   *       '500': { description: Server error }
   */
  router.post('/', keycloakAuthMiddleware.requireAdmin, async (req, res) => {
    try {
      const { error, button } = await quickhelpService.create(req.body);
      if (error) return res.status(400).json({ message: error });
      res.status(201).json(button);
    } catch (error) {
      logger.error(`Error creating quick-help button: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  /**
   * @swagger
   * /quickhelp/{id}:
   *   put:
   *     summary: Update a quick-help button
   *     tags: [Quick Help]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { type: object }
   *     responses:
   *       '200': { description: Updated button }
   *       '400': { description: Invalid payload }
   *       '401': { description: Unauthorized }
   *       '403': { description: Admin access required }
   *       '404': { description: Button not found }
   *       '500': { description: Server error }
   */
  router.put('/:id', keycloakAuthMiddleware.requireAdmin, async (req, res) => {
    try {
      const { error, button, status } = await quickhelpService.update(req.params.id, req.body);
      if (error) return res.status(status || 400).json({ message: error });
      res.json(button);
    } catch (error) {
      logger.error(`Error updating quick-help button: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  /**
   * @swagger
   * /quickhelp/{id}:
   *   delete:
   *     summary: Delete a quick-help button
   *     tags: [Quick Help]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       '200': { description: Deleted }
   *       '401': { description: Unauthorized }
   *       '403': { description: Admin access required }
   *       '404': { description: Button not found }
   *       '500': { description: Server error }
   */
  router.delete('/:id', keycloakAuthMiddleware.requireAdmin, async (req, res) => {
    try {
      const { error, deleted, status } = await quickhelpService.remove(req.params.id);
      if (error) return res.status(status || 400).json({ message: error });
      res.json({ deleted });
    } catch (error) {
      logger.error(`Error deleting quick-help button: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  return router;
};
