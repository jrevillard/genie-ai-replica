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

  router.use(keycloakAuthMiddleware.authenticate);
  router.use(keycloakAuthMiddleware.requireAdmin);

  // --- Feeds ---

  router.get('/feeds', async (req, res, next) => {
    try {
      const feeds = await toolsService.getFeeds();
      res.json({ success: true, data: feeds });
    } catch (error) {
      logger.error(`[TOOLS-ROUTES] Error getting feeds: ${error.message}`);
      res.status(500).json({ success: false, message: 'Failed to retrieve feeds' });
    }
  });

  router.post('/feeds', async (req, res, next) => {
    try {
      const feed = await toolsService.createFeed(req.body);
      res.status(201).json({ success: true, data: feed });
    } catch (error) {
      logger.error(`[TOOLS-ROUTES] Error creating feed: ${error.message}`);
      res.status(500).json({ success: false, message: 'Failed to create feed' });
    }
  });

  router.put('/feeds/:id', async (req, res, next) => {
    try {
      const feed = await toolsService.updateFeed(req.params.id, req.body);
      res.json({ success: true, data: feed });
    } catch (error) {
      logger.error(`[TOOLS-ROUTES] Error updating feed: ${error.message}`);
      res.status(500).json({ success: false, message: 'Failed to update feed' });
    }
  });

  router.delete('/feeds/:id', async (req, res, next) => {
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
  router.post('/test-search', async (req, res, next) => {
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

  return router;
};
