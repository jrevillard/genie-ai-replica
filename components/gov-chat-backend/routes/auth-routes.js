const express = require('express');
const router = express.Router();
const { keycloakAuthMiddleware } = require('../middleware/keycloak-auth-middleware');
const { logger } = require('../shared-lib');
const authController = require('../controllers/authController');

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Get current user
 *     description: Return information about the current authenticated Keycloak user
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User information retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: User account is deactivated
 *       500:
 *         description: Failed to retrieve user information
 */
router.get('/me', keycloakAuthMiddleware.authenticate, async (req, res, next) => {
  try {
    logger.info('Fetching current user info');
    await authController.getCurrentUser(req, res);
  } catch (error) {
    logger.error(`Error fetching current user: ${error.message}`, { stack: error.stack });
    next(error);
  }
});

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: User logout
 *     description: Logout endpoint (Keycloak handles session invalidation server-side)
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logout successful
 *       401:
 *         description: Unauthorized
 */
router.post('/logout', keycloakAuthMiddleware.authenticate, async (req, res, next) => {
  try {
    logger.info('Processing logout request');
    await authController.logout(req, res);
  } catch (error) {
    logger.error(`Error processing logout: ${error.message}`, { stack: error.stack });
    next(error);
  }
});

module.exports = router;
