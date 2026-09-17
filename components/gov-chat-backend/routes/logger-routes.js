const express = require('express');
const router = express.Router();
const { keycloakAuthMiddleware } = require('../middleware/keycloak-auth-middleware');
const { logger } = require('../shared-lib');

module.exports = () => {
  /**
   * @swagger
   * "/api/logger/configure":
   *   post:
   *     summary: "Deprecated: logger configuration"
   *     description: |
   *       Deprecated. Log level and file transports are managed via the
   *       LOG_LEVEL and LOG_TO_FILE environment variables; runtime
   *       reconfiguration is no longer supported.
   *     tags: [Logger]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     responses:
   *       200:
   *         description: Deprecation notice
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 deprecated:
   *                   type: boolean
   *                   example: true
   *                 message:
   *                   type: string
   *                   example: Logger configuration is deprecated; log level and file transports are managed via LOG_LEVEL / LOG_TO_FILE environment variables.
   *       401:
   *         description: Unauthorized, authentication required
   *       403:
   *         description: Forbidden, admin privileges required
   */
  router.post('/configure', keycloakAuthMiddleware.authenticate, keycloakAuthMiddleware.requireAdmin, (req, res) => {
    logger.info(
      '[LOGGER-ROUTES] /api/logger/configure is deprecated; reconfiguring logger transports is no longer supported',
      {
        user: req.user?.iss_sub || 'unknown'
      }
    );
    res.json({
      deprecated: true,
      message:
        'Logger configuration is deprecated; log level and file transports are managed via LOG_LEVEL / LOG_TO_FILE environment variables.'
    });
  });

  return router;
};
