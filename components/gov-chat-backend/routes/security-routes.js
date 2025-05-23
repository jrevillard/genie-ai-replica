const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const securityScanService = require('../services/security-scan-service');
const { logger } = require('../shared-lib');

/**
 * @swagger
 * tags:
 *   name: Security
 *   description: Security management endpoints
 */
module.exports = () => {
  /**
   * @swagger
   * /api/security/metrics:
   *   get:
   *     summary: Get security metrics
   *     tags: [Security]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Security metrics retrieved successfully
   */
  router.get('/metrics', authMiddleware.authenticate, authMiddleware.isAdmin, async (req, res) => {
    try {
      logger.info(`Fetching security metrics for user: ${req.user?.loginName || 'unknown'}`);
      
      const failedLogins = await securityScanService.checkFailedLogins();
      const suspiciousActivities = await securityScanService.checkSuspiciousActivities();
      const lastScanDetails = await securityScanService.getLastScanDetails();
      
      logger.info(`Security metrics retrieved successfully for user: ${req.user?.loginName || 'unknown'}`);
      
      res.json({
        success: true,
        data: {
          failedLoginAttempts: failedLogins,
          suspiciousActivities: suspiciousActivities,
          lastSecurityScan: lastScanDetails.lastScan,
          vulnerabilities: lastScanDetails.vulnerabilities
        }
      });
    } catch (error) {
      logger.error(`Error fetching security metrics for user ${req.user?.loginName || 'unknown'}: ${error.message}`, { stack: error.stack });
      res.status(500).json({
        success: false,
        message: 'Failed to get security metrics',
        error: error.message
      });
    }
  });

  /**
   * @swagger
   * /api/security/scan:
   *   post:
   *     summary: Run a comprehensive security scan
   *     tags: [Security]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Security scan completed successfully
   */
  router.post('/scan', authMiddleware.authenticate, authMiddleware.isAdmin, async (req, res) => {
    try {
      logger.info(`Initiating security scan by user: ${req.user?.loginName || 'unknown'}`);
      
      const result = await securityScanService.runSecurityScan();
      
      if (result.success) {
        logger.info(`Security scan completed successfully by user: ${req.user?.loginName || 'unknown'}`);
        res.json({ 
          success: true, 
          message: 'Security scan completed successfully', 
          data: result.data 
        });
      } else {
        logger.error(`Security scan failed for user ${req.user?.loginName || 'unknown'}: ${result.error}`, { stack: result.error?.stack });
        res.status(500).json({ 
          success: false, 
          message: 'Security scan failed', 
          error: result.error 
        });
      }
    } catch (error) {
      logger.error(`Error running security scan for user ${req.user?.loginName || 'unknown'}: ${error.message}`, { stack: error.stack });
      res.status(500).json({ 
        success: false, 
        message: 'Failed to run security scan', 
        error: error.message 
      });
    }
  });

  /**
   * @swagger
   * /api/security/last-scan:
   *   get:
   *     summary: Get details about the last security scan
   *     tags: [Security]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Last scan details retrieved successfully
   */
  router.get('/last-scan', authMiddleware.authenticate, authMiddleware.isAdmin, async (req, res) => {
    try {
      logger.info(`Fetching last security scan details for user: ${req.user?.loginName || 'unknown'}`);
      
      const result = await securityScanService.getLastScanDetails();
      
      logger.info(`Last security scan details retrieved successfully for user: ${req.user?.loginName || 'unknown'}`);
      
      res.json({ success: true, data: result });
    } catch (error) {
      logger.error(`Error fetching last security scan details for user ${req.user?.loginName || 'unknown'}: ${error.message}`, { stack: error.stack });
      res.status(500).json({ 
        success: false, 
        message: 'Failed to get last security scan details', 
        error: error.message 
      });
    }
  });

  return router;
};