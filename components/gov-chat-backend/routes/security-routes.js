// routes/security-routes.js - FIXED to match working patterns
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const securityScanService = require('../services/security-scan-service');

/**
 * @swagger
 * tags:
 *   name: Security
 *   description: Security management endpoints
 */

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
// Get security metrics
router.get('/metrics', authMiddleware.authenticate, authMiddleware.isAdmin, async (req, res) => {
  try {
    // Extract security metrics from logs service
    const failedLogins = await securityScanService.checkFailedLogins();
    const suspiciousActivities = await securityScanService.checkSuspiciousActivities();
    const lastScanDetails = await securityScanService.getLastScanDetails();
    
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
// Run a new security scan - Fixed to match working patterns
router.post('/scan', authMiddleware.authenticate, authMiddleware.isAdmin, async (req, res) => {
  try {
    const result = await securityScanService.runSecurityScan();
    
    if (result.success) {
      res.json({ 
        success: true, 
        message: 'Security scan completed successfully', 
        data: result.data 
      });
    } else {
      res.status(500).json({ 
        success: false, 
        message: 'Security scan failed', 
        error: result.error 
      });
    }
  } catch (error) {
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
// Get last scan details - Fixed to match working patterns
router.get('/last-scan', authMiddleware.authenticate, authMiddleware.isAdmin, async (req, res) => {
  try {
    const result = await securityScanService.getLastScanDetails();
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get last security scan details', 
      error: error.message 
    });
  }
});

module.exports = router;