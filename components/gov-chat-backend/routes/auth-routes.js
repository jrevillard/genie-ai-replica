// Ported verbatim from upstream v2.0.1 components/gov-chat-backend/routes/auth-routes.js (Epic A5).
// Upstream: opensource.unicc.org/un/itu/genie-ai @ upstream-v2.0.1.
// Replaces the legacy refresh/register/login/reset router — POST /api/auth/logout is the
// only auth endpoint; Keycloak owns every other flow.

const express = require('express');
const router = express.Router();
const { keycloakAuthMiddleware } = require('../middleware/keycloak-auth-middleware');
const { logger } = require('../shared-lib');
const authController = require('../controllers/authController');

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: User logout
 *     description: Logout endpoint (Keycloak handles session invalidation server-side)
 *     tags: [Authentication]
 *     security:
 *       - KeycloakOAuth2: ['openid']
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
