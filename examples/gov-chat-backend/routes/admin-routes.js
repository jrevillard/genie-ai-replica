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

// Database operations - utilize the existing database routes
router.post('/database-operations/reindex', adminController.reindexDatabase);
router.post('/database-operations/backup', adminController.backupDatabase);
router.post('/database-operations/optimize', adminController.optimizeDatabase);

module.exports = router;