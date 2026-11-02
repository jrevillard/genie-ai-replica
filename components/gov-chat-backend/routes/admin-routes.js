// src/routes/admin-routes.js
const express = require('express');
const router = express.Router();
const { keycloakAuthMiddleware } = require('../middleware/keycloak-auth-middleware');
const securityScanService = require('../services/security-scan-service');
const keycloakProxyService = require('../services/keycloak-proxy-service');
const userProvisioningService = require('../services/user-provisioning-service');
const pipelineSettings = require('../services/pipeline-settings-service');
const { logger } = require('../shared-lib');

/**
 * @swagger
 * tags:
 *   - name: Admin
 *     description: Admin dashboard API endpoints
 */
module.exports = (adminService, logsService) => {
  // Debug: Log adminService initialization
  logger.info('[ADMIN-ROUTES] Initializing admin routes');
  if (!adminService || typeof adminService.getSystemHealth !== 'function') {
    logger.error('[ADMIN-ROUTES] Invalid adminService provided to admin-routes');
    throw new Error('adminService is required with getSystemHealth');
  }
  logger.debug('[ADMIN-ROUTES] admin-routes initialized with adminService', {
    methods: Object.getOwnPropertyNames(Object.getPrototypeOf(adminService)).filter(m => m !== 'constructor')
  });

  // Debug: Log securityScanService availability
  logger.debug('[ADMIN-ROUTES] Checking securityScanService:', {
    hasSecurityScanService: !!securityScanService,
    methods: securityScanService ? Object.getOwnPropertyNames(Object.getPrototypeOf(securityScanService)).filter(m => m !== 'constructor') : 'undefined'
  });

  // Debug: Log request entry before middleware
  router.use((req, res, next) => {
    logger.info(`[ADMIN-ROUTES] Request received: ${req.method} ${req.originalUrl}`, {
      headers: req.headers,
      query: req.query,
      body: req.body
    });
    next();
  });


  // AI Config endpoint — accessible by AI Engineers and Admins
  router.get('/ai-config', keycloakAuthMiddleware.requireAdmin, async (req, res, next) => {
    try {
      const result = adminService.getAIConfig();
      res.json(result);
    } catch (error) {
      logger.error(`[ADMIN-ROUTES] Error getting AI config: ${error.message}`, { stack: error.stack });
      next(error);
    }
  });

  // All remaining routes require Admin role
  router.use(keycloakAuthMiddleware.requireAdmin);

  /**
   * @swagger
   * /admin/system-health:
   *   get:
   *     summary: Get system health metrics
   *     tags: [Admin]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: System health metrics retrieved successfully
   *       401:
   *         description: Unauthorized - authentication required
   *       403:
   *         description: Forbidden - admin access required
   *       500:
   *         description: Server error
   */
  router.get('/system-health', async (req, res, next) => {
    logger.info('[ADMIN-ROUTES] Entering /admin/system-health route', {
      user: req.user ? req.user._key : 'unknown'
    });
    try {
      const result = await adminService.getSystemHealth();
      logger.info('[ADMIN-ROUTES] System health retrieved successfully');
      res.json(result);
    } catch (error) {
      logger.error(`[ADMIN-ROUTES] Error getting system health: ${error.message}`, { stack: error.stack });
      next(error);
    }
  });

  /**
   * @swagger
   * /admin/database/stats:
   *   get:
   *     summary: Get database statistics
   *     tags: [Admin]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Database statistics retrieved successfully
   *       401:
   *         description: Unauthorized - authentication required
   *       403:
   *         description: Forbidden - admin access required
   *       500:
   *         description: Server error
   */
  router.get('/database/stats', async (req, res, next) => {
    try {
      const result = await adminService.getDatabaseStats();
      res.json(result);
    } catch (error) {
      logger.error(`[ADMIN-ROUTES] Error getting database stats: ${error.message}`, { stack: error.stack });
      next(error);
    }
  });

  /**
   * @swagger
   * /admin/logs:
   *   get:
   *     summary: Get system logs
   *     tags: [Admin]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *         description: Maximum number of logs to return
   *       - in: query
   *         name: level
   *         schema:
   *           type: string
   *         description: Filter logs by level (INFO, WARNING, ERROR)
   *       - in: query
   *         name: service
   *         schema:
   *           type: string
   *         description: Filter logs by service name
   *     responses:
   *       200:
   *         description: Logs retrieved successfully
   *       401:
   *         description: Unauthorized - authentication required
   *       403:
   *         description: Forbidden - admin access required
   *       500:
   *         description: Server error
   */
  router.get('/logs', async (req, res, next) => {
    try {
      const { limit, level, service } = req.query;
      const result = await adminService.getLogs({ limit, level, service });
      res.json(result);
    } catch (error) {
      logger.error(`[ADMIN-ROUTES] Error getting logs: ${error.message}`, { stack: error.stack });
      next(error);
    }
  });

  /**
   * @swagger
   * /admin/logs/rollover:
   *   post:
   *     summary: Trigger log rollover
   *     tags: [Admin]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Logs rolled over successfully
   *       401:
   *         description: Unauthorized - authentication required
   *       403:
   *         description: Forbidden - admin access required
   *       500:
   *         description: Server error
   */
  router.post('/logs/rollover', async (req, res, next) => {
    try {
      const result = await adminService.rolloverLogs();
      res.json(result);
    } catch (error) {
      logger.error(`[ADMIN-ROUTES] Error rolling over logs: ${error.message}`, { stack: error.stack });
      next(error);
    }
  });

  /**
   * @swagger
   * /admin/user-stats:
   *   get:
   *     summary: Get user statistics
   *     tags: [Admin]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: User statistics retrieved successfully
   *       401:
   *         description: Unauthorized - authentication required
   *       403:
   *         description: Forbidden - admin access required
   *       500:
   *         description: Server error
   */
  router.get('/user-stats', async (req, res, next) => {
    try {
      const result = await adminService.getUserStats();
      res.json(result);
      logger.debug('[ADMIN-ROUTES] User stats response sent to client', { result });
    } catch (error) {
      logger.error(`[ADMIN-ROUTES] Error getting user stats: ${error.message}`, { stack: error.stack });
      next(error);
    }
  });

  /**
   * @swagger
   * /admin/security-metrics:
   *   get:
   *     summary: Get security metrics
   *     tags: [Admin]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Security metrics retrieved successfully
   *       401:
   *         description: Unauthorized - authentication required
   *       403:
   *         description: Forbidden - admin access required
   *       500:
   *         description: Server error
   */
  router.get('/security-metrics', async (req, res, next) => {
    try {
      logger.info(`[ADMIN-ROUTES] Fetching security metrics for user: ${req.user?.email || 'unknown'}`);
      const lastScan = await securityScanService.getLastScanDetails();

      const metrics = {
        failedLoginAttempts: lastScan.failedLoginDetails?.length || 0,
        suspiciousActivities: lastScan.suspiciousDetails?.length || 0,
        lastSecurityScan: lastScan.scanTime || "Never",
        vulnerabilities: lastScan.vulnerabilities || { critical: 0, medium: 0, low: 0 }
      };

      res.status(200).json({
        success: true,
        data: metrics
      });
      logger.info(`[ADMIN-ROUTES] Security metrics retrieved successfully for user: ${req.user?.email || 'unknown'}`);
    } catch (error) {
      logger.error(`[ADMIN-ROUTES] Error fetching security metrics: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: 'Failed to fetch security metrics' });
    }
  });

  /**
   * @swagger
   * /admin/security-scan:
   *   post:
   *     summary: Run security scan
   *     tags: [Admin]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Security scan completed successfully
   *       401:
   *         description: Unauthorized - authentication required
   *       403:
   *         description: Forbidden - admin access required
   *       500:
   *         description: Server error
   */
  router.post('/security-scan', async (req, res, next) => {
    logger.info('[ADMIN-ROUTES] Entering /admin/security-scan route', {
      user: req.user ? req.user._key : 'unknown'
    });
    try {
      logger.info(`[ADMIN-ROUTES] Initiating security scan by user: ${req.user?.email || 'unknown'}`);
      const result = await securityScanService.runSecurityScan(logsService);
      logger.debug(`[ADMIN-ROUTES] Security scan response: ${JSON.stringify(result, null, 2)}`);
      res.status(200).json({ success: true, data: result });
      logger.info(`[ADMIN-ROUTES] Security scan completed successfully by user: ${req.user?.email || 'unknown'}`);
    } catch (error) {
      logger.error(`[ADMIN-ROUTES] Error running security scan: ${error.message}`, { stack: error.stack });
      res.status(500).json({ success: false, message: 'Failed to run security scan', error: 'Internal server error' });
    }
  });

  /**
   * @swagger
   * /admin/security/last-scan:
   *   get:
   *     summary: Retrieve the last security scan details
   *     tags: [Admin]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Last security scan details retrieved successfully
   *       401:
   *         description: Unauthorized - authentication required
   *       403:
   *         description: Forbidden - admin access required
   *       500:
   *         description: Server error
   */
  router.get('/security/last-scan', async (req, res, next) => {
    logger.info('[ADMIN-ROUTES] Entering /admin/security/last-scan route', {
      user: req.user ? req.user._key : 'unknown'
    });
    try {
      logger.info(`[ADMIN-ROUTES] Fetching last security scan details for user: ${req.user?.email || 'unknown'}`);
      const scanDetails = await securityScanService.getLastScanDetails();
      logger.info('[ADMIN-ROUTES] Last scan details retrieved successfully');
      res.status(200).json(scanDetails);
    } catch (error) {
      logger.error(`[ADMIN-ROUTES] Error fetching last scan details: ${error.message}`, { stack: error.stack });
      res.status(500).json({ error: 'Failed to fetch last scan details', message: error.message });
    }
  });

  /**
   * @swagger
   * /admin/diagnostics:
   *   post:
   *     summary: Run system diagnostics
   *     tags: [Admin]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Diagnostics completed successfully
   *       401:
   *         description: Unauthorized - authentication required
   *       403:
   *         description: Forbidden - admin access required
   *       500:
   *         description: Server error
   */
  router.post('/diagnostics', async (req, res, next) => {
    try {
      const result = await adminService.runDiagnostics();
      res.json(result);
    } catch (error) {
      logger.error(`[ADMIN-ROUTES] Error running diagnostics: ${error.message}`, { stack: error.stack });
      next(error);
    }
  });

  /**
   * @swagger
   * /admin/logger/configure:
   *   post:
   *     summary: Configure logger settings (level, retention, file sizes)
   *     tags: [Admin]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               level:
   *                 type: string
   *                 enum: [error, warn, info, debug]
   *               errorMaxFiles:
   *                 type: string
   *                 example: '14d'
   *               combinedMaxFiles:
   *                 type: string
   *                 example: '14d'
   *     responses:
   *       200:
   *         description: Logger configuration updated successfully
   *       400:
   *         description: Invalid configuration parameters
   *       401:
   *         description: Unauthorized - authentication required
   *       403:
   *         description: Forbidden - admin access required
   *       500:
   *         description: Server error
   */
  router.post('/logger/configure', (req, res) => {
    try {
      const { reconfigureLogger } = require('../shared-lib');
      const { level, errorMaxSize, combinedMaxSize, errorMaxFiles, combinedMaxFiles, zippedArchive } = req.body;

      if (!level && !errorMaxSize && !combinedMaxSize && !errorMaxFiles && !combinedMaxFiles && zippedArchive === undefined) {
        return res.status(400).json({ success: false, message: 'At least one configuration parameter is required' });
      }

      if (level && !['error', 'warn', 'info', 'debug'].includes(level)) {
        return res.status(400).json({ success: false, message: 'Invalid log level. Must be one of: error, warn, info, debug' });
      }

      const sizeRegex = /^\d+(k|m|g)$/;
      const filesRegex = /^\d+d$/;

      if (errorMaxSize && !sizeRegex.test(errorMaxSize)) {
        return res.status(400).json({ success: false, message: 'Invalid errorMaxSize format' });
      }
      if (combinedMaxSize && !sizeRegex.test(combinedMaxSize)) {
        return res.status(400).json({ success: false, message: 'Invalid combinedMaxSize format' });
      }
      if (errorMaxFiles && !filesRegex.test(errorMaxFiles)) {
        return res.status(400).json({ success: false, message: 'Invalid errorMaxFiles format. Use: 7d, 14d, 30d' });
      }
      if (combinedMaxFiles && !filesRegex.test(combinedMaxFiles)) {
        return res.status(400).json({ success: false, message: 'Invalid combinedMaxFiles format. Use: 7d, 14d, 30d' });
      }

      reconfigureLogger({ level, errorMaxSize, combinedMaxSize, errorMaxFiles, combinedMaxFiles, zippedArchive });
      res.json({ success: true, message: 'Logger configuration updated successfully' });
    } catch (error) {
      logger.error(`[ADMIN-ROUTES] Error configuring logger: ${error.message}`, { stack: error.stack });
      res.status(500).json({ success: false, message: 'Failed to update logger configuration', error: 'Internal server error' });
    }
  });

  /**
   * @swagger
   * /admin/logs/summary:
   *   get:
   *     summary: Get logs summary by type and service
   *     tags: [Admin]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: date
   *         schema:
   *           type: string
   *         description: Date for which to get logs (YYYY-MM-DD)
   *       - in: query
   *         name: level
   *         schema:
   *           type: string
   *         description: Filter by log level
   *     responses:
   *       200:
   *         description: Logs summary retrieved successfully
   *       401:
   *         description: Unauthorized - authentication required
   *       403:
   *         description: Forbidden - admin access required
   *       500:
   *         description: Server error
   */
  router.get('/logs/summary', async (req, res, next) => {
    try {
      const { date, level } = req.query;
      const result = await logsService.getLogsSummary({ date, level }); // Changed to logsService
      res.json({ data: result }); // Wrap result in { data: ... } for frontend consistency
    } catch (error) {
      logger.error(`[ADMIN-ROUTES] Error getting logs summary: ${error.message}`, { stack: error.stack });
      next(error);
    }
  });

  /**
   * @swagger
   * /admin/logs/search:
   *   get:
   *     summary: Search logs with filtering
   *     tags: [Admin]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: term
   *         schema:
   *           type: string
   *         description: Search term
   *       - in: query
   *         name: level
   *         schema:
   *           type: string
   *         description: Filter by log level
   *       - in: query
   *         name: service
   *         schema:
   *           type: string
   *         description: Filter by service name
   *       - in: query
   *         name: dateRange
   *         schema:
   *           type: string
   *           enum: [today, yesterday, week, month, custom]
   *         description: Date range preset
   *       - in: query
   *         name: startDate
   *         schema:
   *           type: string
   *         description: Custom start date (YYYY-MM-DD)
   *       - in: query
   *         name: endDate
   *         schema:
   *           type: string
   *         description: Custom end date (YYYY-MM-DD)
   *     responses:
   *       200:
   *         description: Search completed successfully
   *       401:
   *         description: Unauthorized - authentication required
   *       403:
   *         description: Forbidden - admin access required
   *       500:
   *         description: Server error
   */
  router.get('/logs/search', async (req, res, next) => {
    try {
      const { term, level, service, dateRange, startDate, endDate, limit, offset } = req.query;
      const result = await adminService.searchLogs({ term, level, service, dateRange, startDate, endDate, limit: limit || 100, offset: offset || 0 });
      res.json(result);
    } catch (error) {
      logger.error(`[ADMIN-ROUTES] Error searching logs: ${error.message}`, { stack: error.stack });
      next(error);
    }
  });

  /**
   * @swagger
   * /admin/logs/debug-yesterday:
   *   get:
   *     summary: Debug logs for yesterday to diagnose issues
   *     tags: [Admin]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Debug information retrieved successfully
   *       401:
   *         description: Unauthorized - authentication required
   *       403:
   *         description: Forbidden - admin access required
   *       500:
   *         description: Server error
   */
  router.get('/logs/debug-yesterday', async (req, res, next) => {
    try {
      const result = await adminService.debugYesterdayLogs();
      res.json(result);
    } catch (error) {
      logger.error(`[ADMIN-ROUTES] Error getting debug logs: ${error.message}`, { stack: error.stack });
      next(error);
    }
  });

  /**
   * @swagger
   * /admin/database-operations/reindex:
   *   post:
   *     summary: Reindex database
   *     tags: [Admin]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Database reindexed successfully
   *       401:
   *         description: Unauthorized - authentication required
   *       403:
   *         description: Forbidden - admin access required
   *       500:
   *         description: Server error
   */
  router.post('/database-operations/reindex', async (req, res, next) => {
    try {
      const result = await adminService.reindexDatabase();
      res.json(result);
    } catch (error) {
      logger.error(`[ADMIN-ROUTES] Error reindexing database: ${error.message}`, { stack: error.stack });
      next(error);
    }
  });

  /**
   * @swagger
   * /admin/database-operations/backup:
   *   post:
   *     summary: Backup database
   *     tags: [Admin]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Database backed up successfully
   *       401:
   *         description: Unauthorized - authentication required
   *       403:
   *         description: Forbidden - admin access required
   *       500:
   *         description: Server error
   */
  router.post('/database-operations/backup', async (req, res, next) => {
    try {
      const result = await adminService.backupDatabase();
      res.json(result);
    } catch (error) {
      logger.error(`[ADMIN-ROUTES] Error backing up database: ${error.message}`, { stack: error.stack });
      next(error);
    }
  });

  /**
   * @swagger
   * /admin/database-operations/optimize:
   *   post:
   *     summary: Optimize database
   *     tags: [Admin]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Database optimized successfully
   *       401:
   *         description: Unauthorized - authentication required
   *       403:
   *         description: Forbidden - admin access required
   *       500:
   *         description: Server error
   */
  router.post('/database-operations/optimize', async (req, res, next) => {
    try {
      const result = await adminService.optimizeDatabase();
      res.json(result);
    } catch (error) {
      logger.error(`[ADMIN-ROUTES] Error optimizing database: ${error.message}`, { stack: error.stack });
      next(error);
    }
  });

  /**
   * @swagger
   * /admin/users/search:
   *   get:
   *     summary: Search users with filtering
   *     tags: [Admin]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: term
   *         schema:
   *           type: string
   *         description: Search term
   *       - in: query
   *         name: field
   *         schema:
   *           type: string
   *           enum: [all, name, email, role]
   *         description: Field to search (all, name, email, role)
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *         description: Maximum number of users to return
   *       - in: query
   *         name: offset
   *         schema:
   *           type: integer
   *         description: Offset for pagination
   *     responses:
   *       200:
   *         description: Search completed successfully
   *       401:
   *         description: Unauthorized - authentication required
   *       403:
   *         description: Forbidden - admin access required
   *       500:
   *         description: Server error
   */
  router.get('/users/search', async (req, res, next) => {
    try {
      logger.info('[ADMIN-ROUTES] Route /api/admin/users/search hit');
      const { term, field, limit, offset } = req.query;
      const result = await adminService.searchUsers({ term, field, limit, offset });
      res.json(result);
    } catch (error) {
      logger.error(`[ADMIN-ROUTES] Error searching users: ${error.message}`, { stack: error.stack });
      next(error);
    }
  });

  // ============================================================
  // QUERY INSPECTOR ROUTES
  // ============================================================

  /**
   * @swagger
   * /admin/queries/inspect:
   *   get:
   *     summary: Get recent queries for admin inspection (Query Inspector)
   *     tags: [Admin]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *         description: Maximum number of queries to return (default 50)
   *       - in: query
   *         name: offset
   *         schema:
   *           type: integer
   *         description: Offset for pagination
   *       - in: query
   *         name: userId
   *         schema:
   *           type: string
   *         description: Filter by user ID
   *       - in: query
   *         name: searchText
   *         schema:
   *           type: string
   *         description: Search in query text
   *       - in: query
   *         name: startDate
   *         schema:
   *           type: string
   *         description: Filter from date (ISO string)
   *       - in: query
   *         name: endDate
   *         schema:
   *           type: string
   *         description: Filter to date (ISO string)
   *       - in: query
   *         name: minConfidence
   *         schema:
   *           type: number
   *         description: Minimum confidence score (0-1)
   *       - in: query
   *         name: maxConfidence
   *         schema:
   *           type: number
   *         description: Maximum confidence score (0-1)
   *     responses:
   *       200:
   *         description: Queries retrieved successfully
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Forbidden - admin access required
   *       500:
   *         description: Server error
   */
  router.get('/queries/inspect', async (req, res, next) => {
    try {
      logger.info('[ADMIN-ROUTES] Query Inspector - fetching queries', { query: req.query });
      const queryService = require('../services/query-service');
      const result = await queryService.getQueriesForInspector(req.query);
      res.json(result);
    } catch (error) {
      logger.error(`[ADMIN-ROUTES] Error in Query Inspector: ${error.message}`, { stack: error.stack });
      next(error);
    }
  });

  /**
   * @swagger
   * /admin/queries/inspect/{queryId}:
   *   get:
   *     summary: Get full query details for admin inspection
   *     tags: [Admin]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: queryId
   *         required: true
   *         schema:
   *           type: string
   *         description: The query ID to inspect
   *     responses:
   *       200:
   *         description: Query details retrieved successfully
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Forbidden - admin access required
   *       404:
   *         description: Query not found
   *       500:
   *         description: Server error
   */
  router.get('/queries/inspect/:queryId', async (req, res, next) => {
    try {
      logger.info('[ADMIN-ROUTES] Query Inspector - fetching query details', { queryId: req.params.queryId });
      const queryService = require('../services/query-service');
      const result = await queryService.getQueryInspectorDetails(req.params.queryId);
      res.json(result);
    } catch (error) {
      if (error.message === 'document not found' || (error.errorNum && error.errorNum === 1202)) {
        return res.status(404).json({ success: false, message: 'Query not found' });
      }
      logger.error(`[ADMIN-ROUTES] Error in Query Inspector details: ${error.message}`, { stack: error.stack });
      next(error);
    }
  });

  // ============================================================
  // USER APPROVAL ROUTES
  // ============================================================

  /**
   * @swagger
   * /admin/users/pending:
   *   get:
   *     summary: Get users pending approval
   *     tags: [Admin]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Pending users retrieved successfully
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Forbidden - admin access required
   */
  router.get('/users/pending', async (req, res, next) => {
    try {
      logger.info('[ADMIN-ROUTES] Fetching pending users');
      const { dbService } = require('../shared-lib');
      const { aql } = require('arangojs');
      const db = await dbService.getConnection();
      
      const cursor = await db.query(aql`
        FOR u IN users
          FILTER u.status == 'Pending'
          SORT u.createdAt DESC
          RETURN {
            _key: u._key,
            loginName: u.loginName || u.email,
            email: u.email,
            fullName: u.personalIdentification.fullName || u.name,
            createdAt: u.createdAt,
            status: u.status
          }
      `);
      const pendingUsers = await cursor.all();
      
      res.json({
        success: true,
        data: pendingUsers,
        count: pendingUsers.length
      });
    } catch (error) {
      logger.error(`[ADMIN-ROUTES] Error fetching pending users: ${error.message}`, { stack: error.stack });
      next(error);
    }
  });

  /**
   * @swagger
   * /admin/users/pending/count:
   *   get:
   *     summary: Get count of users pending approval
   *     tags: [Admin]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Pending user count retrieved
   */
  router.get('/users/pending/count', async (req, res, next) => {
    try {
      const { dbService } = require('../shared-lib');
      const { aql } = require('arangojs');
      const db = await dbService.getConnection();
      
      const cursor = await db.query(aql`
        RETURN LENGTH(
          FOR u IN users
            FILTER u.status == 'Pending'
            RETURN 1
        )
      `);
      const count = await cursor.next();
      
      res.json({ success: true, count: count || 0 });
    } catch (error) {
      logger.error(`[ADMIN-ROUTES] Error fetching pending count: ${error.message}`, { stack: error.stack });
      next(error);
    }
  });

  /**
   * @swagger
   * /admin/users/{userId}/approve:
   *   post:
   *     summary: Approve a pending user
   *     tags: [Admin]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: userId
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               role:
   *                 type: string
   *                 enum: [User, Manager, AI Engineer, Admin]
   *                 description: Role to assign (defaults to User)
   *     responses:
   *       200:
   *         description: User approved successfully
   *       404:
   *         description: User not found
   */
  router.post('/users/:userId/approve', async (req, res, next) => {
    try {
      const { userId } = req.params;
      const { role } = req.body;
      logger.info(`[ADMIN-ROUTES] Approving user ${userId} with role: ${role || 'User'}`);
      
      const { dbService } = require('../shared-lib');
      const db = await dbService.getConnection();
      const users = db.collection('users');
      
      // Verify user exists and is pending
      const user = await users.document(userId).catch(() => null);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
      if (user.status !== 'Pending') {
        return res.status(400).json({ success: false, message: `User is not pending (current status: ${user.status || 'Active'})` });
      }
      
      // Approve the user
      const updateData = {
        status: 'Active',
        role: role || user.role || 'User',
        updatedAt: new Date().toISOString(),
        approvedBy: req.user._key || req.user.userId,
        approvedAt: new Date().toISOString()
      };

      // A6: approving with role Admin makes the realm role real — sync BEFORE the
      // doc write so a proxy failure leaves a retryable Approve (doc stays Pending,
      // and a Pending user holding the admin realm role is still gated by status).
      // Non-Admin roles are display labels only — no realm call.
      if (updateData.role === 'Admin') {
        try {
          await keycloakProxyService.assignRealmRole(userId, 'admin');
        } catch (kcError) {
          logger.error(`[ADMIN-ROUTES] Keycloak role sync failed for ${userId}: ${kcError.message}`);
          // A 401/403 here is OUR service account's problem, not the caller's —
          // passing it through makes the frontend treat its own token as stale
          // (signinSilent → redirect loop). Map to 502; other KC statuses pass.
          const status = kcError.status === 401 || kcError.status === 403 ? 502 : kcError.status || 502;
          return res.status(status).json({
            success: false,
            message: 'Failed to sync the Keycloak admin role. Please try again.'
          });
        }
      }

      await users.update(userId, updateData);
      // Bust the provisioning cache so the status flip is visible on the next
      // request (60s cache would otherwise serve the stale Pending doc).
      if (user.iss_sub) {
        userProvisioningService.evictUser(user.iss_sub);
      }
      logger.info(`[ADMIN-ROUTES] User ${userId} approved successfully`);
      
      // Send approval notification email (non-blocking, but never silently
      // successful — the response tells the admin whether it actually sent)
      let emailNotification = 'skipped';
      try {
        const emailService = require('../services/email-service');
        if (user.email) {
          const userName = user.personalIdentification?.fullName || user.loginName || 'User';
          await emailService.sendGenericEmail(
            user.email,
            `Your ${process.env.APP_NAME || 'GENIE.AI'} account has been approved`,
            `<h2>Agrivisory Account Approved</h2>
            <p>Hello ${userName},</p>
            <p>Your account has been approved. You can now log in and access the system.</p>
            <p><a href="${process.env.FRONTEND_URL || 'http://localhost:8090'}">Click here to log in</a></p>
            <p>Best regards,<br/>${process.env.APP_NAME || 'GENIE.AI'} Team</p>`
          );
          logger.info(`[ADMIN-ROUTES] Approval email sent to ${user.email}`);
          emailNotification = 'sent';
        }
      } catch (emailError) {
        logger.warn(`[ADMIN-ROUTES] Failed to send approval email: ${emailError.message}`);
        emailNotification = 'failed';
      }

      res.json({
        success: true,
        message: 'User approved successfully',
        emailNotification,
        user: { _key: userId, status: 'Active', role: updateData.role }
      });
    } catch (error) {
      logger.error(`[ADMIN-ROUTES] Error approving user: ${error.message}`, { stack: error.stack });
      next(error);
    }
  });

  /**
   * @swagger
   * /admin/users/{userId}/reject:
   *   post:
   *     summary: Reject a pending user
   *     tags: [Admin]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: userId
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               reason:
   *                 type: string
   *                 description: Reason for rejection (optional)
   *     responses:
   *       200:
   *         description: User rejected successfully
   *       404:
   *         description: User not found
   */
  router.post('/users/:userId/reject', async (req, res, next) => {
    try {
      const { userId } = req.params;
      const { reason } = req.body;
      logger.info(`[ADMIN-ROUTES] Rejecting user ${userId}`);
      
      const { dbService } = require('../shared-lib');
      const db = await dbService.getConnection();
      const users = db.collection('users');
      
      const user = await users.document(userId).catch(() => null);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
      
      // Disable the account (soft reject)
      const updateData = {
        status: 'Rejected',
        disabled: true,
        rejectionReason: reason || '',
        updatedAt: new Date().toISOString(),
        rejectedBy: req.user._key || req.user.userId,
        rejectedAt: new Date().toISOString()
      };
      
      await users.update(userId, updateData);
      // A6: bust the provisioning cache so the Rejected status applies immediately
      if (user.iss_sub) {
        userProvisioningService.evictUser(user.iss_sub);
      }
      // A6: end the user's live Keycloak sessions so a rejected user's refresh
      // tokens die too (best-effort — the Rejected doc already gates the API).
      try {
        await keycloakProxyService.revokeUserSessions(userId);
      } catch (revokeError) {
        logger.warn(`[ADMIN-ROUTES] Session revoke after reject failed (non-critical): ${revokeError.message}`);
      }
      logger.info(`[ADMIN-ROUTES] User ${userId} rejected`);
      
      res.json({
        success: true,
        message: 'User rejected',
        user: { _key: userId, status: 'Rejected' }
      });
    } catch (error) {
      logger.error(`[ADMIN-ROUTES] Error rejecting user: ${error.message}`, { stack: error.stack });
      next(error);
    }
  });

  // ============================================================
  // PIPELINE SETTINGS ROUTES (K.2 — LLM prompts + generation params)
  // ============================================================

  // Envelope keys (version/updatedAt/updatedBy) are owned by the K.1 writer
  // and rejected in patches by construction (absent from the schema).
  const LLM_SETTINGS_ENV = 'LLM_SETTINGS_CONFIG';
  const LLM_SETTINGS_SEED = '../../../configs/pipeline/llm-settings.seed.json';
  // Shown only when the LIVE file is missing (broken deploy / not yet seeded):
  // the audit footer renders "defaults (never edited)" and empty prompt fields
  // cannot be saved (schema minimum length 1). Effective prompt text is not
  // duplicated here — the Python readers' coded defaults remain the truth.
  const LLM_SETTINGS_DEFAULTS = {
    version: 0,
    updatedAt: null,
    updatedBy: null,
    systemPrompt: '',
    // DEC-26a: NO default here — a file predating the field (or missing it)
    // must surface as ABSENT, not '', so the UI can say "default enforcing
    // rule active" instead of lying "disabled" (and an untouched save must
    // not write '' over the runtime default).
    enforceAbstention: true,
    abstentionInstructions: '',
    generation: {
      temperature: 0.01, topP: 0.95, repetitionPenalty: 1.03,
      frequencyPenalty: 0.0, presencePenalty: 0.0, maxTokens: 8192
    },
    ingest: { labelSelectorPrompt: '', contextualRetrievalPrompt: '' }
  };

  const _isString = (v, min, max) =>
    typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;
  const _isNum = (v, min, max) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

  // K.3: run the schema checkers over the MERGED doc a GET serves, so a
  // hand-edited garbage value is signaled (warnings: [...]) instead of
  // rendering as NaN/blank with no explanation. The data is still returned
  // as-is; a PUT overwrites the garbage (writeSettings refuses only a
  // corrupt-JSON file, not garbage-typed values).
  const _isEmptyPlaceholder = (v) =>
    v === '' ||
    (v !== null && typeof v === 'object' && !Array.isArray(v) &&
      Object.values(v).every(_isEmptyPlaceholder));
  const _schemaWarnings = (doc, schema, skipPlaceholders = false) => {
    const warnings = [];
    for (const key of Object.keys(schema)) {
      const value = doc[key];
      if (skipPlaceholders && _isEmptyPlaceholder(value)) continue; // never-edited '' prompts, not corruption
      const verdict = schema[key](value);
      if (verdict !== true) warnings.push(verdict);
    }
    return warnings;
  };

  // Ranges mirror the consuming code: temperature/topP/penalties follow the
  // OpenAI/vLLM envelopes, repetitionPenalty (0,2] (vLLM; <1 encourages
  // repetition), maxTokens int — floor 256 so the answer budget can never
  // disable the prompt-overflow guard (a 1-token budget would skip it), top
  // 32768 bounded by realistic model lengths (vLLM clamps the wire value).
  const _GENERATION_RANGES = {
    temperature: [0, 2],
    topP: [0, 1],
    repetitionPenalty: [0.01, 2],
    frequencyPenalty: [-2, 2],
    presencePenalty: [-2, 2]
  };

  // Partial patches are legal (writeSettings deep-merges): validate ONLY the
  // provided subkeys, and reject unknown nested keys so junk never merges.
  const LLM_SETTINGS_SCHEMA = {
    systemPrompt: (v) =>
      _isString(v, 1, 8000) || 'systemPrompt must be a non-empty string (1..8000 chars, trimmed)',
    enforceAbstention: (v) =>
      typeof v === 'boolean' || 'enforceAbstention must be a boolean',
    abstentionInstructions: (v) =>
      _isString(v, 0, 4000) || 'abstentionInstructions must be a string (0..4000 chars)',
    generation: (v) => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) {
        return 'generation must be an object';
      }
      for (const key of Object.keys(v)) {
        if (key === 'maxTokens') {
          if (!Number.isInteger(v.maxTokens) || v.maxTokens < 256 || v.maxTokens > 32768) {
            return 'generation.maxTokens must be an integer in [256, 32768]';
          }
        } else {
          const range = _GENERATION_RANGES[key];
          if (!range) {
            return `generation.${key} is not a known generation setting`;
          }
          if (!_isNum(v[key], range[0], range[1])) {
            return `generation.${key} must be a number in [${range[0]}, ${range[1]}]`;
          }
        }
      }
      return true;
    },
    ingest: (v) => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) {
        return 'ingest must be an object';
      }
      for (const key of Object.keys(v)) {
        if (key !== 'labelSelectorPrompt' && key !== 'contextualRetrievalPrompt') {
          return `ingest.${key} is not a known ingest setting`;
        }
        if (!_isString(v[key], 1, 8000)) {
          return `ingest.${key} must be a non-empty string (1..8000 chars)`;
        }
      }
      return true;
    }
  };

  /**
   * @swagger
   * /admin/pipeline-settings/llm-settings:
   *   get:
   *     summary: Get effective LLM settings (system prompt, abstention, generation params, ingest prompts)
   *     tags: [Admin]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Effective settings + audit envelope (version/updatedAt/updatedBy)
   *       403:
   *         description: Forbidden - admin access required
   */
  router.get('/pipeline-settings/llm-settings', async (req, res, next) => {
    try {
      const data = await pipelineSettings.readSettings(LLM_SETTINGS_ENV, LLM_SETTINGS_SEED, LLM_SETTINGS_DEFAULTS);
      // '' prompts are the never-edited-placeholder state, not garbage —
      // skipped so a fresh box does not cry wolf (everything else validated).
      const warnings = _schemaWarnings(data, LLM_SETTINGS_SCHEMA, true);
      res.json({ success: true, data, warnings });
    } catch (error) {
      logger.error(`[ADMIN-ROUTES] Error reading llm-settings: ${error.message}`, { stack: error.stack });
      next(error);
    }
  });

  /**
   * @swagger
   * /admin/pipeline-settings/llm-settings:
   *   put:
   *     summary: Validate and save LLM settings (atomic write, version bump, audit stamp)
   *     tags: [Admin]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             description: Partial patches are legal (deep-merged); unknown keys are rejected.
   *             properties:
   *               systemPrompt:
   *                 type: string
   *               enforceAbstention:
   *                 type: boolean
   *               abstentionInstructions:
   *                 type: string
   *               generation:
   *                 type: object
   *               ingest:
   *                 type: object
   *     responses:
   *       200:
   *         description: Settings written; next chat request picks them up (no restart)
   *       400:
   *         description: Validation failure naming the field
   *       401:
   *         description: Unauthorized - authentication required
   *       403:
   *         description: Forbidden - admin access required
   *       409:
   *         description: On-disk settings file is corrupt — write refused
   *       500:
   *         description: Server error
   *       503:
   *         description: Settings path not configured (LLM_SETTINGS_CONFIG unset)
   */
  router.put('/pipeline-settings/llm-settings', async (req, res) => {
    try {
      const data = await pipelineSettings.writeSettings(LLM_SETTINGS_ENV, LLM_SETTINGS_SEED, {
        patch: req.body || {},
        schema: LLM_SETTINGS_SCHEMA,
        updatedBy: req.user?._key || req.user?.userId
      });
      res.json({ success: true, data });
    } catch (error) {
      logger.error(`[ADMIN-ROUTES] Error writing llm-settings: ${error.message}`, { stack: error.stack });
      // Never leak the absolute container path to the client — name the file only.
      const message = String(error.message || 'Failed to save LLM settings.').split(
        pipelineSettings.resolvePath(LLM_SETTINGS_ENV, LLM_SETTINGS_SEED)
      ).join('llm-settings.json');
      res.status(error.status || 500).json({ success: false, message });
    }
  });

  // ============================================================
  // PIPELINE SETTINGS ROUTES (K.3 — retriever + reranker tuning)
  // ============================================================

  // Envelope keys are owned by the K.1 writer (rejected in patches by
  // construction). Defaults mirror the committed seed (configs/pipeline/
  // rag-tuning.seed.json) — shown when the LIVE file is missing; the Python
  // readers' coded defaults remain the truth for effective behavior.
  const RAG_TUNING_ENV = 'RAG_TUNING_CONFIG';
  const RAG_TUNING_SEED = '../../../configs/pipeline/rag-tuning.seed.json';
  const RAG_TUNING_DEFAULTS = {
    version: 0,
    updatedAt: null,
    updatedBy: null,
    retriever: {
      retrievalK: 20, fetchK: 30, scoreThreshold: 0.2, lambdaMult: 0.5,
      searchStart: 'chunk', searchMode: 'vector', filterStrategy: 'OR',
      enableTraversal: true, traversalMaxDepth: 2, traversalMaxReturned: 5,
      traversalScoreThreshold: 0.7, traversalConcurrentBatches: 4,
      hybridEnabled: true, hybridRrfK: 60, hybridDenseWeight: 1.0,
      hybridLexicalWeight: 1.0, hybridBm25Candidates: 50
    },
    reranker: {
      strategy: 'slice', threshold: 0.75, topN: 3,
      noveltySigmoidA: 20.0, noveltySigmoidB: 0.25,
      contextDecayFactor: 0.0025, minValueThreshold: -1.0
    }
  };

  // Enum sets mirror the exact pipeline branch values (arangodb raises 400
  // on any other search_start; the reranker falls back to slice on any
  // other strategy) — the UI can never write an invalid value.
  const _SEARCH_START_VALUES = ['chunk', 'edge', 'node'];
  const _SEARCH_MODE_VALUES = ['vector', 'hybrid'];
  const _FILTER_STRATEGY_VALUES = ['AND', 'OR'];
  const _RERANK_STRATEGY_VALUES = ['slice', 'threshold', 'knee_threshold', 'slice_threshold', 'adaptive'];

  // Ranges/constraints mirrored from the consuming code (spec-k3): ints are
  // true ints (bool rejected), floats are finite numbers; traversal knobs
  // floor at 1 / cap at 4 (arangodb clamps there anyway — the schema makes
  // the clamp unreachable instead of a silent fix-up).
  const _RETRIEVER_FIELD_SCHEMA = {
    retrievalK: (v) => Number.isInteger(v) && v >= 1 || 'retriever.retrievalK must be an integer >= 1',
    fetchK: (v) => Number.isInteger(v) && v >= 1 || 'retriever.fetchK must be an integer >= 1',
    scoreThreshold: (v) => _isNum(v, 0, 1) || 'retriever.scoreThreshold must be a number in [0, 1]',
    lambdaMult: (v) => _isNum(v, 0, 1) || 'retriever.lambdaMult must be a number in [0, 1]',
    searchStart: (v) => _SEARCH_START_VALUES.includes(v) || `retriever.searchStart must be one of ${_SEARCH_START_VALUES.join(', ')}`,
    searchMode: (v) => _SEARCH_MODE_VALUES.includes(v) || `retriever.searchMode must be one of ${_SEARCH_MODE_VALUES.join(', ')}`,
    filterStrategy: (v) => _FILTER_STRATEGY_VALUES.includes(v) || `retriever.filterStrategy must be one of ${_FILTER_STRATEGY_VALUES.join(', ')}`,
    enableTraversal: (v) => typeof v === 'boolean' || 'retriever.enableTraversal must be a boolean',
    traversalMaxDepth: (v) => Number.isInteger(v) && v >= 1 || 'retriever.traversalMaxDepth must be an integer >= 1',
    traversalMaxReturned: (v) => Number.isInteger(v) && v >= 1 || 'retriever.traversalMaxReturned must be an integer >= 1',
    traversalScoreThreshold: (v) => _isNum(v, 0, 1) || 'retriever.traversalScoreThreshold must be a number in [0, 1]',
    traversalConcurrentBatches: (v) => Number.isInteger(v) && v >= 1 && v <= 4 || 'retriever.traversalConcurrentBatches must be an integer in [1, 4] (retriever hard cap)',
    hybridEnabled: (v) => typeof v === 'boolean' || 'retriever.hybridEnabled must be a boolean',
    hybridRrfK: (v) => Number.isInteger(v) && v >= 1 || 'retriever.hybridRrfK must be an integer >= 1',
    hybridDenseWeight: (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0) || 'retriever.hybridDenseWeight must be a number >= 0',
    hybridLexicalWeight: (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0) || 'retriever.hybridLexicalWeight must be a number >= 0',
    hybridBm25Candidates: (v) => Number.isInteger(v) && v >= 1 || 'retriever.hybridBm25Candidates must be an integer >= 1'
  };

  const _RERANKER_FIELD_SCHEMA = {
    strategy: (v) => _RERANK_STRATEGY_VALUES.includes(v) || `reranker.strategy must be one of ${_RERANK_STRATEGY_VALUES.join(', ')}`,
    threshold: (v) => _isNum(v, 0, 1) || 'reranker.threshold must be a number in [0, 1]',
    topN: (v) => Number.isInteger(v) && v >= 1 || 'reranker.topN must be an integer >= 1',
    noveltySigmoidA: (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0) || 'reranker.noveltySigmoidA must be a number > 0',
    noveltySigmoidB: (v) => _isNum(v, 0, 1) || 'reranker.noveltySigmoidB must be a number in [0, 1]',
    contextDecayFactor: (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0) || 'reranker.contextDecayFactor must be a number >= 0',
    minValueThreshold: (v) => typeof v === 'number' && Number.isFinite(v) || 'reranker.minValueThreshold must be a finite number'
  };

  const RAG_TUNING_SCHEMA = {
    retriever: (v) => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) {
        return 'retriever must be an object';
      }
      for (const key of Object.keys(v)) {
        const check = _RETRIEVER_FIELD_SCHEMA[key];
        if (!check) {
          return `retriever.${key} is not a known retriever setting`;
        }
        const verdict = check(v[key]);
        if (verdict !== true) {
          return verdict;
        }
      }
      return true;
    },
    reranker: (v) => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) {
        return 'reranker must be an object';
      }
      for (const key of Object.keys(v)) {
        const check = _RERANKER_FIELD_SCHEMA[key];
        if (!check) {
          return `reranker.${key} is not a known reranker setting`;
        }
        const verdict = check(v[key]);
        if (verdict !== true) {
          return verdict;
        }
      }
      return true;
    }
  };

  // GET-warnings variant of the rag sections: the PUT checkers above
  // early-return on the FIRST bad subkey (one message is enough there) — a
  // warnings banner must list every bad field, not just the first.
  const _flatSectionWarnings = (section, sectionName, fieldSchema) => {
    if (!section || typeof section !== 'object' || Array.isArray(section)) return [];
    const warnings = [];
    for (const sub of Object.keys(section)) {
      const check = fieldSchema[sub];
      const verdict = check
        ? check(section[sub])
        : `${sectionName}.${sub} is not a known ${sectionName} setting`;
      if (verdict !== true) warnings.push(verdict);
    }
    return warnings;
  };

  /**
   * @swagger
   * /admin/pipeline-settings/rag-tuning:
   *   get:
   *     summary: Get effective RAG tuning (retriever counts/thresholds/traversal/hybrid + reranker strategy/adaptive params)
   *     tags: [Admin]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Effective values + audit envelope (version/updatedAt/updatedBy)
   *       403:
   *         description: Forbidden - admin access required
   */
  router.get('/pipeline-settings/rag-tuning', async (req, res, next) => {
    try {
      const data = await pipelineSettings.readSettings(RAG_TUNING_ENV, RAG_TUNING_SEED, RAG_TUNING_DEFAULTS);
      const warnings = [
        ..._flatSectionWarnings(data.retriever, 'retriever', _RETRIEVER_FIELD_SCHEMA),
        ..._flatSectionWarnings(data.reranker, 'reranker', _RERANKER_FIELD_SCHEMA)
      ];
      res.json({ success: true, data, warnings });
    } catch (error) {
      logger.error(`[ADMIN-ROUTES] Error reading rag-tuning: ${error.message}`, { stack: error.stack });
      next(error);
    }
  });

  /**
   * @swagger
   * /admin/pipeline-settings/rag-tuning:
   *   put:
   *     summary: Validate and save RAG tuning (atomic write, version bump, audit stamp; next request re-reads — no restart)
   *     tags: [Admin]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             description: Partial patches are legal (deep-merged); unknown keys are rejected.
   *             properties:
   *               retriever:
   *                 type: object
   *               reranker:
   *                 type: object
   *     responses:
   *       200:
   *         description: Settings written; next chat request picks them up (no restart)
   *       400:
   *         description: Validation failure naming the field (incl. fetchK >= retrievalK on the merged doc)
   *       401:
   *         description: Unauthorized - authentication required
   *       403:
   *         description: Forbidden - admin access required
   *       409:
   *         description: On-disk settings file is corrupt — write refused
   *       500:
   *         description: Server error
   *       503:
   *         description: Settings path not configured (RAG_TUNING_CONFIG unset)
   */
  router.put('/pipeline-settings/rag-tuning', async (req, res) => {
    try {
      const data = await pipelineSettings.writeSettings(RAG_TUNING_ENV, RAG_TUNING_SEED, {
        patch: req.body || {},
        schema: RAG_TUNING_SCHEMA,
        updatedBy: req.user?._key || req.user?.userId,
        // Cross-field constraint (MMR requirement): fetchK >= retrievalK on
        // the CLEAN MERGED doc, INSIDE the serialized write — writeSettings
        // schema-validates the patch first (so a string "5" can never reach
        // this comparison), the check covers the on-disk side a patch does
        // not touch, and the queue kills the concurrent-PUT window.
        validateMerged: (merged) => {
          const ret = merged.retriever || {};
          if (Number(ret.fetchK) < Number(ret.retrievalK)) {
            return `Invalid value for 'retriever': fetchK (${ret.fetchK}) must be >= retrievalK (${ret.retrievalK}).`;
          }
          return null;
        }
      });
      res.json({ success: true, data });
    } catch (error) {
      logger.error(`[ADMIN-ROUTES] Error writing rag-tuning: ${error.message}`, { stack: error.stack });
      // Never leak the absolute container path to the client — name the file only.
      const message = String(error.message || 'Failed to save RAG tuning settings.').split(
        pipelineSettings.resolvePath(RAG_TUNING_ENV, RAG_TUNING_SEED)
      ).join('rag-tuning.json');
      res.status(error.status || 500).json({ success: false, message });
    }
  });

  return router;
};