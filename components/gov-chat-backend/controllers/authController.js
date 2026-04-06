const { logger } = require('../shared-lib');
const sessionService = require('../services/session-service');

const authController = {
  /**
   * Get current authenticated user info
   * req.user is set by keycloakAuthMiddleware from JIT provisioning (ArangoDB document)
   */
  async getCurrentUser(req, res) {
    try {
      if (!req.user || !req.user.iss_sub) {
        logger.warn('No authenticated user found');
        return res.status(401).json({ success: false, message: 'Not authenticated' });
      }
      const { _id, _rev, encPassword, deleted, ...userWithKey } = req.user;
      // Expose _key as 'id' for downstream API lookups (e.g. /api/users/:id/context)
      const { _key, ...userWithoutInternals } = userWithKey;
      logger.info(`Current user info retrieved for: ${req.user.name || req.user.email || 'unknown'}`);
      res.json({ success: true, user: { ...userWithoutInternals, id: _key } });
    } catch (error) {
      logger.error(`Get current user error: ${error.message}`, { stack: error.stack });
      res.status(500).json({ success: false, message: 'Failed to retrieve user information' });
    }
  },

  /**
   * Logout — end active ArangoDB sessions and emit audit log.
   * Keycloak handles OIDC session invalidation server-side via the redirect flow.
   */
  async logout(req, res) {
    try {
      const userId = req.user?._key || null;
      const issSub = req.user?.iss_sub || 'unknown';
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
      logger.info(JSON.stringify({
        event: 'logout',
        timestamp: new Date().toISOString(),
        userId: issSub,
        issuer
      }));

      res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
      logger.error(`Logout error: ${error.message}`, { stack: error.stack });
      res.status(500).json({ success: false, message: 'Logout failed' });
    }
  }
};

module.exports = authController;
