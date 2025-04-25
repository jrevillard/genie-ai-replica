/**
 * @swagger
 * tags:
 *   name: Admin
 *   description: Admin dashboard API endpoints
 */

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middleware/auth-middleware');
const { logger } = require('../logger'); // Import the centralized logger

// Apply authentication and admin role check middleware
router.use(authMiddleware.authenticate);
router.use(authMiddleware.isAdmin);

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
router.get('/system-health', adminController.getSystemHealth);

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
router.get('/database/stats', adminController.getDatabaseStats);

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
router.get('/logs', adminController.getLogs);

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
router.post('/logs/rollover', adminController.rolloverLogs);

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
router.get('/user-stats', adminController.getUserStats);

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
router.get('/security-metrics', adminController.getSecurityMetrics);

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
router.post('/security-scan', adminController.runSecurityScan);

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
router.post('/diagnostics', adminController.runDiagnostics);

// Updates for admin-routes.js - Add these routes

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
router.get('/logs/summary', adminController.getLogsSummary);

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
router.get('/logs/search', adminController.searchLogs);

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
router.get('/logs/debug-yesterday', adminController.debugYesterdayLogs);

// Database operations - utilize the existing database routes
router.post('/database-operations/reindex', adminController.reindexDatabase);
router.post('/database-operations/backup', adminController.backupDatabase);
router.post('/database-operations/optimize', adminController.optimizeDatabase);

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
router.get('/users/search', (req, res, next) => {
    logger.info('Route /api/admin/users/search hit');
    adminController.searchUsers(req, res, next);
  });
//router.get('/users/search', adminController.searchUsers);

module.exports = router;