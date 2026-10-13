// src/routes/admin-routes.js
const express = require('express');
const router = express.Router();
const { keycloakAuthMiddleware } = require('../middleware/keycloak-auth-middleware');
const securityScanService = require('../services/security-scan-service');
const queryService = require('../services/query-service');
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
    methods: Object.getOwnPropertyNames(Object.getPrototypeOf(adminService)).filter((m) => m !== 'constructor')
  });

  // Debug: Log securityScanService availability
  logger.debug('[ADMIN-ROUTES] Checking securityScanService:', {
    hasSecurityScanService: !!securityScanService,
    methods: securityScanService
      ? Object.getOwnPropertyNames(Object.getPrototypeOf(securityScanService)).filter((m) => m !== 'constructor')
      : 'undefined'
  });

  // Admin access is logged by TWO middlewares, one before auth and one
  // after, and they deliberately log different fields. Keep them apart.
  //
  // SECURITY NOTE (applies to both): an earlier version dumped raw
  // `req.headers` / `req.query` / `req.body` into the structured log body.
  // The `headers` top-level key matches no SENSITIVE_KEY_PATTERN, so a
  // shallow `redactAttributes` let the raw `authorization: Bearer …` JWT
  // reach the OTel LogRecord attributes and from there the admin /logs
  // search dialog. Fixed in 6851023b5. Never re-add headers / query /
  // body here — query strings leak JWTs passed as ?token=... into
  // VictoriaLogs.

  // Pre-auth entry: method + path only. `userSub` is deliberately ABSENT
  // — auth has not run, so `req.user` is undefined, and stamping
  // `userSub: undefined` on every request would poison forensic
  // correlation for the whole admin surface.
  router.use((req, res, next) => {
    logger.info(`[ADMIN-ROUTES] Request received: ${req.method} ${req.path}`, {
      method: req.method,
      url: req.path
    });
    next();
  });

  router.use(keycloakAuthMiddleware.authenticate);
  router.use(keycloakAuthMiddleware.requireAdmin);

  // Post-auth audit log: method + path + the JWT subject
  // (`req.user.sub`). Fires AFTER auth + the admin gate, so only
  // requests that actually passed authorisation are audited here —
  // failures land in the keycloak middleware's own warn path instead
  // of polluting the trail of successful admin work.
  router.use((req, res, next) => {
    if (req.user && req.user.sub) {
      logger.info(`[ADMIN-ROUTES] Admin request: ${req.method} ${req.path}`, {
        method: req.method,
        url: req.path,
        userSub: req.user.sub
      });
    }
    next();
  });

  /**
   * @swagger
   * "/api/admin/system-health":
   *   get:
   *     summary: Get system health metrics
   *     tags: [Admin]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     responses:
   *       200:
   *         description: 'System health metrics retrieved successfully. metrics.errorRate is the only VL-derived field; per the OBSERVABILITY carve-out it stays null when VictoriaLogs is unreachable and this endpoint deliberately does NOT raise 503 on VL outage (the dashboard tile stays well-formed with errorRate=0 in that tile). trends.* fields are nullable by design (no-prior-month-history becomes null rather than NaN).'
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 metrics:
   *                   type: object
   *                   properties:
   *                     systemUptime:
   *                       type: number
   *                     avgResponseTime:
   *                       type: number
   *                     errorRate:
   *                       type: number
   *                       nullable: true
   *                       description: 'Percentage of ERROR+FATAL severity_text rows in the last 24h. null when VL is unreachable.'
   *                     monthlyActiveUsers:
   *                       type: integer
   *                 trends:
   *                   type: object
   *                   description: 'All fields nullable by design (no-prior-month-history renders as null, never NaN).'
   *                   properties:
   *                     uptime:
   *                       type: number
   *                       nullable: true
   *                     responseTime:
   *                       type: number
   *                       nullable: true
   *                     errorRate:
   *                       type: number
   *                       nullable: true
   *                     activeUsers:
   *                       type: number
   *                       nullable: true
   *                 resourceUsage:
   *                   type: object
   *                   properties:
   *                     cpu:
   *                       type: number
   *                     memory:
   *                       type: number
   *                     storage:
   *                       type: number
   *                 healthServices:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: string
   *                       name:
   *                         type: string
   *                       status:
   *                         type: string
   *       401:
   *         description: Unauthorized - authentication required
   *       403:
   *         description: Forbidden - admin access required
   *       500:
   *         description: 'Server error during system health computation (e.g. DB failure). Note that VL outage does NOT trigger this - it produces a 200 with errorRate=null instead.'
   */
  router.get('/system-health', async (req, res, next) => {
    logger.info('[ADMIN-ROUTES] Entering /admin/system-health route', {
      user: req.user?.iss_sub || 'unknown'
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
   * "/api/admin/database/stats":
   *   get:
   *     summary: Get database statistics
   *     tags: [Admin]
   *     security:
   *       - KeycloakOAuth2: ['openid']
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
   * "/api/admin/logs":
   *   get:
   *     summary: Get system logs
   *     tags: [Admin]
   *     security:
   *       - KeycloakOAuth2: ['openid']
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
   *           enum: [TRACE, DEBUG, INFO, WARN, WARNING, ERROR, FATAL]
   *         description: 'Filter logs by level. WARN/WARNING are synonyms (normalized to WARN before the VL query). The query is a single-value severity_text:<canonical> clause; ERROR matches only ERROR, FATAL only FATAL. Use /logs/summary for the sibling view.'
   *       - in: query
   *         name: service
   *         schema:
   *           type: string
   *         description: Filter logs by service name
   *     responses:
   *       200:
   *         description: Logs retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 logs:
   *                   type: array
   *                   items:
   *                     type: object
   *                 total:
   *                   type: integer
   *                 limit:
   *                   type: integer
   *                 offset:
   *                   type: integer
   *       400:
   *         description: 'Invalid filter (level outside the allowlist) - typed InvalidFilterError envelope {error: invalid_filter, message}.'
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   enum: [invalid_filter]
   *                 message:
   *                   type: string
   *       401:
   *         description: Unauthorized - authentication required
   *       403:
   *         description: Forbidden - admin access required
   *       503:
   *         description: 'VictoriaLogs unreachable - typed envelope {error: vl_unreachable, message} surfaced via the global error middleware reading err.statusCode + err.body verbatim.'
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   enum: [vl_unreachable]
   *                 message:
   *                   type: string
   *       500:
   *         description: Untyped server error - non-VL failures (programmer errors, etc.) propagate as 500.
   */
  router.get('/logs', async (req, res, next) => {
    try {
      // Forward the full querystring — AdminDashboardService.getLogs forwards
      // the options object verbatim, so any future search-box / pagination
      // keys (q, offset) reach the service without a route widening per
      // release. Pre-existing keys (limit, level, service) keep identical
      // behaviour.
      const result = await adminService.getLogs({ ...req.query });
      res.json(result);
    } catch (error) {
      logger.error(`[ADMIN-ROUTES] Error getting logs: ${error.message}`, { stack: error.stack });
      next(error);
    }
  });

  /**
   * @swagger
   * "/api/admin/user-stats":
   *   get:
   *     summary: Get user statistics
   *     tags: [Admin]
   *     security:
   *       - KeycloakOAuth2: ['openid']
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
    } catch (error) {
      logger.error(`[ADMIN-ROUTES] Error getting user stats: ${error.message}`, { stack: error.stack });
      next(error);
    }
  });

  /**
   * @swagger
   * "/api/admin/security-metrics":
   *   get:
   *     summary: Get security metrics
   *     tags: [Admin]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     responses:
   *       200:
   *         description: Security metrics retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   enum: [true]
   *                 data:
   *                   type: object
   *                   properties:
   *                     failedLoginAttempts:
   *                       type: integer
   *                     suspiciousActivities:
   *                       type: integer
   *                     lastSecurityScan:
   *                       type: string
   *                       nullable: true
   *                     vulnerabilities:
   *                       type: object
   *                       properties:
   *                         critical:
   *                           type: integer
   *                         medium:
   *                           type: integer
   *                         low:
   *                           type: integer
   *       401:
   *         description: Unauthorized - authentication required
   *       403:
   *         description: Forbidden - admin access required
   *       500:
   *         description: Server error
   */
  router.get('/security-metrics', async (req, res) => {
    try {
      logger.info(`[ADMIN-ROUTES] Fetching security metrics for user: ${req.user?.email || 'unknown'}`);
      const lastScan = await securityScanService.getLastScanDetails();

      const metrics = {
        failedLoginAttempts: lastScan.failedLoginDetails?.length || 0,
        suspiciousActivities: lastScan.suspiciousDetails?.length || 0,
        lastSecurityScan: lastScan.scanTime || 'Never',
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
   * "/api/admin/security-scan":
   *   post:
   *     summary: Run security scan
   *     tags: [Admin]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     responses:
   *       200:
   *         description: Security scan completed successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   enum: [true]
   *                 data:
   *                   type: object
   *                   properties:
   *                     scanTime:
   *                       type: string
   *                       format: date-time
   *                     vulnerabilities:
   *                       type: object
   *                       properties:
   *                         critical:
   *                           type: integer
   *                         medium:
   *                           type: integer
   *                         low:
   *                           type: integer
   *                         details:
   *                           type: array
   *                           items:
   *                             type: object
   *                     status:
   *                       type: string
   *                       enum: [completed, skipped]
   *                     skipped:
   *                       type: boolean
   *                     reason:
   *                       type: string
   *                       nullable: true
   *                     vulnerabilityDetails:
   *                       type: object
   *                       description: 'Categorised vulnerability buckets: {critical, medium, low} arrays.'
   *                     patternMatches:
   *                       type: array
   *                       items:
   *                         type: object
   *                       description: 'All pattern-match rows (signature hits + bare-phrase hits).'
   *                     patternMatchCount:
   *                       type: integer
   *                     failedLoginDetails:
   *                       type: array
   *                       items:
   *                         type: object
   *                     suspiciousDetails:
   *                       type: array
   *                       items:
   *                         type: object
   *                     message:
   *                       type: string
   *                       description: 'Human-readable scan summary; distinguishes skipped vs completed.'
   *       401:
   *         description: Unauthorized - authentication required
   *       403:
   *         description: Forbidden - admin access required
   *       503:
   *         description: 'VictoriaLogs unreachable - typed envelope {error: vl_unreachable, message}; the inline catch forwards err.statusCode + err.body verbatim when the throwable carries them.'
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   enum: [vl_unreachable]
   *                 message:
   *                   type: string
   *       500:
   *         description: Untyped server error - the inline catch falls back here when the throwable has no statusCode.
   */
  router.post('/security-scan', async (req, res) => {
    logger.info('[ADMIN-ROUTES] Entering /admin/security-scan route', {
      user: req.user?.iss_sub || 'unknown'
    });
    try {
      logger.info(`[ADMIN-ROUTES] Initiating security scan by user: ${req.user?.email || 'unknown'}`);
      const result = await securityScanService.runSecurityScan(logsService);
      logger.debug(`[ADMIN-ROUTES] Security scan response: ${JSON.stringify(result, null, 2)}`);
      res.status(200).json({ success: true, data: result });
      logger.info(`[ADMIN-ROUTES] Security scan completed successfully by user: ${req.user?.email || 'unknown'}`);
    } catch (error) {
      // VlUnavailableError carries its own statusCode (503) + body
      // ({error: 'vl_unreachable', message}) so monitoring/alerting can
      // distinguish VL outages from generic 500s. Render verbatim and only
      // fall back to 500 when the throwable is untyped.
      logger.error(`[ADMIN-ROUTES] Error running security scan: ${error.message}`, { stack: error.stack });
      if (error.statusCode && error.body) {
        return res.status(error.statusCode).json(error.body);
      }
      res.status(500).json({ success: false, message: 'Failed to run security scan' });
    }
  });

  /**
   * @swagger
   * "/api/admin/security/last-scan":
   *   get:
   *     summary: Retrieve the last security scan details
   *     tags: [Admin]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     responses:
   *       200:
   *         description: 'Last security scan details retrieved successfully. Unlike /security-scan and /security-metrics, this endpoint returns the unwrapped scanResult directly (NOT wrapped in {success, data}).'
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 scanTime:
   *                   type: string
   *                   format: date-time
   *                 lastScan:
   *                   type: string
   *                   nullable: true
   *                   description: 'Cold-start sentinel ("Never") returned by getLastScanDetails when no scan has been saved yet; null after the first successful run.'
   *                 vulnerabilities:
   *                   type: object
   *                   properties:
   *                     critical:
   *                       type: integer
   *                     medium:
   *                       type: integer
   *                     low:
   *                       type: integer
   *                     details:
   *                       type: array
   *                       items:
   *                         type: object
   *                 vulnerabilityDetails:
   *                   type: object
   *                   description: 'Categorised vulnerability buckets: {critical, medium, low} arrays.'
   *                 patternMatches:
   *                   type: array
   *                   items:
   *                     type: object
   *                 patternMatchCount:
   *                   type: integer
   *                 failedLoginDetails:
   *                   type: array
   *                   items:
   *                     type: object
   *                 suspiciousDetails:
   *                   type: array
   *                   items:
   *                     type: object
   *                 status:
   *                   type: string
   *                   enum: [completed, skipped]
   *                 skipped:
   *                   type: boolean
   *                 reason:
   *                   type: string
   *                   nullable: true
   *                 message:
   *                   type: string
   *                   description: 'Human-readable scan summary (only present after a run; cold-start default omits it).'
   *       401:
   *         description: Unauthorized - authentication required
   *       403:
   *         description: Forbidden - admin access required
   *       500:
   *         description: Server error
   */
  router.get('/security/last-scan', async (req, res) => {
    logger.info('[ADMIN-ROUTES] Entering /admin/security/last-scan route', {
      user: req.user?.iss_sub || 'unknown'
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
   * "/api/admin/diagnostics":
   *   post:
   *     summary: Run system diagnostics
   *     tags: [Admin]
   *     security:
   *       - KeycloakOAuth2: ['openid']
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
   * "/api/admin/logs/summary":
   *   get:
   *     summary: Get logs summary by type and service
   *     tags: [Admin]
   *     security:
   *       - KeycloakOAuth2: ['openid']
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
   *           enum: [ERROR, WARN, WARNING, FATAL]
   *         description: 'Filter by log level. WARNING normalizes to WARN and is accepted; the canonical bucket keys are ERROR / WARN. WARN and WARNING are synonyms; ERROR and FATAL are siblings. The VL query OR-joins the synonyms internally. Any value outside the allowlist is rejected with 400 invalid_filter.'
   *     responses:
   *       200:
   *         description: Logs summary retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 errors:
   *                   type: array
   *                   items:
   *                     type: object
   *                 warnings:
   *                   type: array
   *                   items:
   *                     type: object
   *                 services:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       name:
   *                         type: string
   *                       count:
   *                         type: integer
   *                 date:
   *                   type: string
   *                 degraded:
   *                   type: boolean
   *       400:
   *         description: 'Invalid filter (level outside the ERROR/WARN/FATAL allowlist) - typed InvalidFilterError envelope {error: invalid_filter, message}.'
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   enum: [invalid_filter]
   *                 message:
   *                   type: string
   *       401:
   *         description: Unauthorized - authentication required
   *       403:
   *         description: Forbidden - admin access required
   *       503:
   *         description: 'VictoriaLogs unreachable on a complete-outage query (all 3 buckets fail). Typed envelope {error: vl_unreachable, message}; the F11 complete-outage guard throws VlUnavailableError so the route renders 503 instead of 200 + empty arrays + degraded:true.'
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   enum: [vl_unreachable]
   *                 message:
   *                   type: string
   *       500:
   *         description: Untyped server error - non-VL failures (programmer errors, etc.) propagate as 500.
   */
  router.get('/logs/summary', async (req, res, next) => {
    try {
      const { date, level } = req.query;
      const result = await logsService.getLogsSummary({ date, level });
      res.json(result);
    } catch (error) {
      logger.error(`[ADMIN-ROUTES] Error getting logs summary: ${error.message}`, { stack: error.stack });
      next(error);
    }
  });

  /**
   * @swagger
   * "/api/admin/logs/search":
   *   get:
   *     summary: Search logs with filtering
   *     tags: [Admin]
   *     security:
   *       - KeycloakOAuth2: ['openid']
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
   *           enum: [TRACE, DEBUG, INFO, WARN, WARNING, ERROR, FATAL]
   *         description: 'Filter by log level. WARN/WARNING are synonyms (normalized to WARN before the VL query). The query is a single-value severity_text:<canonical> clause; ERROR matches only ERROR, FATAL only FATAL. Use /logs/summary for the sibling view. The VL query uses the unquoted severity_text:<level> form. getLogsInRange is the only endpoint that uses the quoted form — these endpoints differ in shape.'
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
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 logs:
   *                   type: array
   *                   items:
   *                     type: object
   *                 total:
   *                   type: integer
   *                 limit:
   *                   type: integer
   *                 offset:
   *                   type: integer
   *       400:
   *         description: 'Invalid filter - typed InvalidFilterError envelope {error: invalid_filter, message} for unsupported level values.'
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   enum: [invalid_filter]
   *                 message:
   *                   type: string
   *       401:
   *         description: Unauthorized - authentication required
   *       403:
   *         description: Forbidden - admin access required
   *       503:
   *         description: 'VictoriaLogs unreachable - typed envelope {error: vl_unreachable, message} via global error middleware.'
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   enum: [vl_unreachable]
   *                 message:
   *                   type: string
   *       500:
   *         description: Untyped server error - non-VL failures propagate as 500.
   */
  router.get('/logs/search', async (req, res, next) => {
    try {
      const { term, level, service, dateRange, startDate, endDate } = req.query;
      const result = await adminService.searchLogs({ term, level, service, dateRange, startDate, endDate });
      res.json(result);
    } catch (error) {
      logger.error(`[ADMIN-ROUTES] Error searching logs: ${error.message}`, { stack: error.stack });
      next(error);
    }
  });

  /**
   * @swagger
   * "/api/admin/logs/debug-yesterday":
   *   get:
   *     summary: Debug logs for yesterday to diagnose issues
   *     tags: [Admin]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     responses:
   *       200:
   *         description: Debug information retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 logs:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       date:
   *                         type: string
   *                       time:
   *                         type: string
   *                       level:
   *                         type: string
   *                       service:
   *                         type: string
   *                       message:
   *                         type: string
   *                 total:
   *                   type: integer
   *       401:
   *         description: Unauthorized - authentication required
   *       403:
   *         description: Forbidden - admin access required
   *       503:
   *         description: 'VictoriaLogs unreachable - typed envelope {error: vl_unreachable, message} via the explicit LogsService._vlOrThrow(vlErr) call in admin-dashboard-service.js.'
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   enum: [vl_unreachable]
   *                 message:
   *                   type: string
   *       500:
   *         description: Untyped server error - non-VL failures propagate as 500.
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
   * "/api/admin/database-operations/backup":
   *   post:
   *     summary: Backup database
   *     tags: [Admin]
   *     security:
   *       - KeycloakOAuth2: ['openid']
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
   * "/api/admin/database-operations/optimize":
   *   post:
   *     summary: Optimize database
   *     tags: [Admin]
   *     security:
   *       - KeycloakOAuth2: ['openid']
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
   * "/api/admin/users/search":
   *   get:
   *     summary: Search users with filtering
   *     tags: [Admin]
   *     security:
   *       - KeycloakOAuth2: ['openid']
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
   * "/api/admin/queries/inspect":
   *   get:
   *     summary: Get recent queries for admin inspection (Query Inspector)
   *     tags: [Admin]
   *     security:
   *       - KeycloakOAuth2: ['openid']
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
      const allowedParams = [
        'limit',
        'offset',
        'userId',
        'searchText',
        'startDate',
        'endDate',
        'minConfidence',
        'maxConfidence'
      ];
      const params = {};
      for (const key of allowedParams) {
        if (req.query[key] !== undefined) params[key] = req.query[key];
      }
      logger.info('[ADMIN-ROUTES] Query Inspector - fetching queries', { query: params });
      const result = await queryService.getQueriesForInspector(params);
      res.json(result);
    } catch (error) {
      logger.error(`[ADMIN-ROUTES] Error in Query Inspector: ${error.message}`, { stack: error.stack });
      next(error);
    }
  });

  /**
   * @swagger
   * "/api/admin/queries/inspect/{queryId}":
   *   get:
   *     summary: Get full query details for admin inspection
   *     tags: [Admin]
   *     security:
   *       - KeycloakOAuth2: ['openid']
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
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: false
   *                 message:
   *                   type: string
   *                   example: 'Query not found'
   *       500:
   *         description: Server error
   */
  router.get('/queries/inspect/:queryId', async (req, res, next) => {
    try {
      logger.info('[ADMIN-ROUTES] Query Inspector - fetching query details', { queryId: req.params.queryId });
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

  return router;
};
