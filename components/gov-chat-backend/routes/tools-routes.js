const express = require('express');
const router = express.Router();
const { keycloakAuthMiddleware } = require('../middleware/keycloak-auth-middleware');
const { logger } = require('../shared-lib');

/**
 * @swagger
 * tags:
 *   - name: Tools
 *     description: Admin Tools API endpoints for feeds and search
 */
module.exports = (toolsService) => {
  if (!toolsService) {
    logger.error('[TOOLS-ROUTES] Invalid toolsService provided');
    throw new Error('toolsService is required');
  }

  // authenticate must run first — requireRole reads req.claims set by it
  router.use(keycloakAuthMiddleware.authenticate);

  // RBAC (NFR8/NFR10): tools-reader read-only; tools-admin full CRUD;
  // legacy admin retains access (unchanged behaviour)
  const readGuard = keycloakAuthMiddleware.requireRole('tools-admin', 'tools-reader', 'admin');
  const writeGuard = keycloakAuthMiddleware.requireRole('tools-admin', 'admin');

  // --- Feeds ---

  router.get('/feeds', readGuard, async (req, res, _next) => {
    try {
      const feeds = await toolsService.getFeeds();
      res.json({ success: true, data: feeds });
    } catch (error) {
      logger.error(`[TOOLS-ROUTES] Error getting feeds: ${error.message}`);
      res.status(500).json({ success: false, message: 'Failed to retrieve feeds' });
    }
  });

  router.post('/feeds', writeGuard, async (req, res, _next) => {
    try {
      const feed = await toolsService.createFeed(req.body);
      res.status(201).json({ success: true, data: feed });
    } catch (error) {
      logger.error(`[TOOLS-ROUTES] Error creating feed: ${error.message}`);
      res.status(500).json({ success: false, message: 'Failed to create feed' });
    }
  });

  router.put('/feeds/:id', writeGuard, async (req, res, _next) => {
    try {
      const feed = await toolsService.updateFeed(req.params.id, req.body);
      res.json({ success: true, data: feed });
    } catch (error) {
      logger.error(`[TOOLS-ROUTES] Error updating feed: ${error.message}`);
      res.status(500).json({ success: false, message: 'Failed to update feed' });
    }
  });

  router.delete('/feeds/:id', writeGuard, async (req, res, _next) => {
    try {
      const result = await toolsService.deleteFeed(req.params.id);
      if (!result.success) {
        return res.status(404).json(result);
      }
      res.json(result);
    } catch (error) {
      logger.error(`[TOOLS-ROUTES] Error deleting feed: ${error.message}`);
      res.status(500).json({ success: false, message: 'Failed to delete feed' });
    }
  });

  // --- SearXNG ---

  // Basic testing proxy to SearXNG
  router.post('/test-search', writeGuard, async (req, res, _next) => {
    try {
      const { query } = req.body;
      if (!query) {
        return res.status(400).json({ success: false, message: 'Query is required' });
      }

      const searxngUrl = process.env.SEARXNG_URL || 'http://searxng:8080';
      const searchRes = await fetch(`${searxngUrl}/search?q=${encodeURIComponent(query)}&format=json`);
      if (!searchRes.ok) {
        throw new Error(`SearXNG returned status ${searchRes.status}`);
      }
      const data = await searchRes.json();
      res.json({ success: true, data });
    } catch (error) {
      logger.error(`[TOOLS-ROUTES] Error testing search: ${error.message}`);
      res.status(500).json({ success: false, message: 'Search test failed' });
    }
  });

  // Default-deny: reached only when no route above matched — keeps the router
  // fail-closed for future routes whose author forgets a guard argument
  router.use((req, res) => {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Tools access required', details: {} });
  });

  return router;
};
