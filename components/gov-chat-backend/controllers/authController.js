const { logger } = require('../shared-lib');

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
      const { _key, _id, _rev, encPassword, deleted, ...userWithoutInternals } = req.user;
      logger.info(`Current user info retrieved for: ${req.user.name || req.user.email || 'unknown'}`);
      res.json({ success: true, user: userWithoutInternals });
    } catch (error) {
      logger.error(`Get current user error: ${error.message}`, { stack: error.stack });
      res.status(500).json({ success: false, message: 'Failed to retrieve user information' });
    }
  },

  /**
   * Logout — Keycloak handles session invalidation server-side.
   * Frontend calls UserManager.removeUser() + redirects to Keycloak logout endpoint.
   * This backend endpoint returns success for API compatibility.
   */
  async logout(req, res) {
    try {
      logger.info(`User logout: ${req.user?.name || req.user?.email || 'unknown'}`);
      res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
      logger.error(`Logout error: ${error.message}`, { stack: error.stack });
      res.status(500).json({ success: false, message: 'Logout failed' });
    }
  }
};

module.exports = authController;
