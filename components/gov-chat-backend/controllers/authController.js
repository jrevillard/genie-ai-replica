const { logger } = require('../shared-lib');
const sessionService = require('../services/session-service');

const authController = {
  /**
   * Logout — end active ArangoDB sessions and emit audit log.
   * Keycloak handles OIDC session invalidation server-side via the redirect flow.
   */
  async logout(req, res) {
    try {
      const userId = req.user?.iss_sub || null;
      const userKey = req.user?._key || null;
      const issuer = req.user?.iss || 'unknown';

      // End active analytics sessions (non-critical — don't fail logout)
      if (userId) {
        try {
          const activeSessions = await sessionService.getUserSessions(userId, { legacyKey: userKey, activeOnly: true });
          for (const session of activeSessions) {
            await sessionService.endSession(session._key);
          }
          if (activeSessions.length > 0) {
            logger.info(`Ended ${activeSessions.length} active session(s) for user ${userId}`);
          }
        } catch (sessionErr) {
          logger.warn(`Failed to end sessions on logout: ${sessionErr.message}`);
        }
      }

      // Structured audit log
      logger.info(
        JSON.stringify({
          event: 'logout',
          timestamp: new Date().toISOString(),
          userId: userId || 'unknown',
          issuer
        })
      );

      res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
      logger.error(`Logout error: ${error.message}`, { stack: error.stack });
      res.status(500).json({ success: false, message: 'Logout failed' });
    }
  }
};

module.exports = authController;
