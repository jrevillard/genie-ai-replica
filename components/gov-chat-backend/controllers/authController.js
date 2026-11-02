// Ported from upstream v2.0.1 components/gov-chat-backend/controllers/authController.js (Epic A5).
// Upstream: opensource.unicc.org/un/itu/genie-ai @ upstream-v2.0.1.
// Local adaptation: our session-service is the same requireable singleton index.js
// initializes, so the require below returns exactly the sessionService the app
// wired (spec: "authController receives sessionService"); its getUserSessions
// signature is (userId, activeOnly) — adapted from upstream's options-object call.

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
          const activeSessions = await sessionService.getUserSessions(userId, true);
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
      // A5 fix: standard error contract, not the legacy {success,message} shape
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Logout failed', details: {} });
    }
  }
};

module.exports = authController;
