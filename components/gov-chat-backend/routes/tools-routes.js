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

  // --- Configuration (story 4-4: domain whitelist + tool toggles) ---

  const HOSTNAME_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

  /**
   * @swagger
   * /api/admin/tools/config:
   *   get:
   *     summary: Get the tools configuration (domain whitelist + tool toggles)
   *     tags: [Tools]
   *     responses:
   *       200:
   *         description: Tools configuration
   */
  router.get('/config', readGuard, async (req, res, _next) => {
    try {
      const config = await toolsService.getConfig();
      res.json({ success: true, data: config });
    } catch (error) {
      logger.error(`[TOOLS-ROUTES] Error getting config: ${error.message}`);
      res.status(500).json({ success: false, message: 'Failed to retrieve configuration' });
    }
  });

  /**
   * @swagger
   * /api/admin/tools/config:
   *   put:
   *     summary: Update the tools configuration (tools-admin only)
   *     tags: [Tools]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               whitelist:
   *                 type: array
   *                 items: { type: string }
   *               web_search_enabled:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: Configuration updated
   *       400:
   *         description: Invalid whitelist entry
   */
  router.put('/config', writeGuard, async (req, res, _next) => {
    try {
      const { whitelist, web_search_enabled } = req.body;
      // Whole-doc replace: both fields REQUIRED — a partial payload must not
      // silently wipe the whitelist or coerce the toggle
      if (!Array.isArray(whitelist)) {
        return res.status(400).json({ success: false, message: 'whitelist (array) is required' });
      }
      if (typeof web_search_enabled !== 'boolean') {
        return res.status(400).json({ success: false, message: 'web_search_enabled (boolean) is required' });
      }
      const invalid = whitelist.find((d) => typeof d !== 'string' || !HOSTNAME_RE.test(d.trim().toLowerCase()));
      if (invalid !== undefined) {
        return res.status(400).json({
          success: false,
          message: `Invalid whitelist entry: ${JSON.stringify(invalid)}`
        });
      }
      const normalized = [...new Set(whitelist.map((d) => d.trim().toLowerCase()).filter(Boolean))];
      if (normalized.length > 1000) {
        return res.status(400).json({
          success: false,
          message: `Whitelist exceeds 1000 entries (${normalized.length})`
        });
      }
      const config = await toolsService.updateConfig({
        whitelist: normalized,
        web_search_enabled
      });
      res.json({ success: true, data: config });
    } catch (error) {
      logger.error(`[TOOLS-ROUTES] Error updating config: ${error.message}`);
      res.status(500).json({ success: false, message: 'Failed to update configuration' });
    }
  });

  // --- Audit log (story 4-6: FOI access via tools-reader; read-only) ---

  /**
   * @swagger
   * /api/admin/tools/audit:
   *   get:
   *     summary: List tool-invocation audit entries (newest first)
   *     description: Peek-only read (XREVRANGE) of the audit stream — never
   *       consumes. Returns public summary fields only; parameters_redacted
   *       and metadata are deliberately excluded. Readable by tools-reader.
   *     tags: [Tools]
   *     parameters:
   *       - in: query
   *         name: tool_id
   *         schema: { type: string }
   *       - in: query
   *         name: action
   *         schema: { type: string }
   *       - in: query
   *         name: user_id
   *         schema: { type: string }
   *       - in: query
   *         name: from
   *         description: Epoch seconds (inclusive)
   *         schema: { type: number }
   *       - in: query
   *         name: to
   *         description: Epoch seconds (inclusive)
   *         schema: { type: number }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, default: 50, maximum: 500 }
   *       - in: query
   *         name: cursor
   *         description: Entry ID cursor for pagination
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Audit entries page
   */
  router.get('/audit', readGuard, async (req, res, _next) => {
    try {
      const { tool_id, action, user_id, from, to, limit, cursor } = req.query;
      const result = await toolsService.getAuditEntries({
        tool_id,
        action,
        user_id,
        from: from ? parseFloat(from) : undefined,
        to: to ? parseFloat(to) : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
        cursor
      });
      res.json({ success: true, data: result });
    } catch (error) {
      logger.error(`[TOOLS-ROUTES] Error listing audit: ${error.message}`);
      res.status(500).json({ success: false, message: 'Failed to retrieve audit entries' });
    }
  });

  /**
   * @swagger
   * /api/admin/tools/audit/export:
   *   get:
   *     summary: Export audit entries as CSV or JSON (tools-reader FOI path)
   *     tags: [Tools]
   *     parameters:
   *       - in: query
   *         name: format
   *         required: true
   *         schema: { type: string, enum: [csv, json] }
   *       - in: query
   *         name: tool_id
   *         schema: { type: string }
   *       - in: query
   *         name: action
   *         schema: { type: string }
   *       - in: query
   *         name: user_id
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Downloadable file
   *       400:
   *         description: Invalid format
   */
  router.get('/audit/export', readGuard, async (req, res, _next) => {
    try {
      const format = req.query.format;
      if (format !== 'csv' && format !== 'json') {
        return res.status(400).json({ success: false, message: 'format must be csv or json' });
      }
      const { tool_id, action, user_id } = req.query;
      const file = await toolsService.exportAudit({ format, tool_id, action, user_id });
      res.setHeader('Content-Type', file.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
      res.send(file.body);
    } catch (error) {
      logger.error(`[TOOLS-ROUTES] Error exporting audit: ${error.message}`);
      res.status(500).json({ success: false, message: 'Failed to export audit entries' });
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
