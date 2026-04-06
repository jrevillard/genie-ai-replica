const authService = require('../services/auth-service');
const UserProfileService = require('../services/user-profile-service');
const { logger } = require('../shared-lib');

/**
 * Authentication middleware functions
 */
const authMiddleware = {
  /**
   * Authenticate a user based on JWT token
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  async authenticate(req, res, next) {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        logger.info(`Auth failed: no authorization header (${req.method} ${req.url})`);
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Please log in again'
        });
      }

      if (!authHeader.startsWith('Bearer ')) {
        logger.info(`Auth failed: invalid authorization format (${req.method} ${req.url})`);
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Please log in again'
        });
      }

      const token = authHeader.split(' ')[1];
      if (!token) {
        logger.info(`Auth failed: empty token (${req.method} ${req.url})`);
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Please log in again'
        });
      }

      let decoded;
      try {
        decoded = await authService.verifyToken(token);
      } catch (tokenErr) {
        logger.warn(`Auth failed: token verification error (${req.method} ${req.url})`);
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Please log in again'
        });
      }

      if (!decoded) {
        logger.info(`Auth failed: decoded token is null (${req.method} ${req.url})`);
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Please log in again'
        });
      }

      const tokenUserId = decoded._key || decoded.id || decoded._id || decoded.userId;
      logger.debug(`Auth: token verified for user ${tokenUserId} (${req.method} ${req.url})`);

      try {
        const user = await UserProfileService.getUserProfile(tokenUserId);

        if (user.disabled === true) {
          logger.info(`Auth failed: disabled account ${tokenUserId}`);
          return res.status(403).json({
            error: 'Forbidden',
            message: 'Your account has been disabled'
          });
        }

        if (!user.accessToken || user.accessToken !== token) {
          logger.warn(`Auth failed: invalid/revoked token for user ${tokenUserId}`);
          return res.status(401).json({
            error: 'Unauthorized',
            message: 'Please log in again'
          });
        }

        req.user = {
          ...decoded,
          role: user.role || 'User',
          _key: user._key || tokenUserId
        };

        logger.debug(`Auth: user ${tokenUserId} authenticated with role ${req.user.role}`);
      } catch (userError) {
        logger.warn(`Auth: could not fetch user details for ${tokenUserId}: ${userError.message}`);
        req.user = decoded;
      }

      next();
    } catch (error) {
      logger.error(`Auth error: ${error.message}`, { stack: error.stack });
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Please log in again'
      });
    }
  },

  /**
   * Check if user is an admin
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  async isAdmin(req, res, next) {
    try {
      if (!req.user) {
        logger.info('Admin check failed: no user object');
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Please log in again'
        });
      }

      const userId = req.user._key || req.user.id || req.user._id || req.user.userId;
      const user = await authService.getUserById(userId);

      if (!user) {
        logger.info(`Admin check failed: user ${userId} not found`);
        return res.status(404).json({
          error: 'Not Found',
          message: 'User not found'
        });
      }

      const isAdmin = user.role === 'Admin';

      if (!isAdmin) {
        logger.info(`Admin check failed: user ${userId} is not admin`);
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Admin access required'
        });
      }

      logger.debug(`Admin check passed for user ${userId}`);
      next();
    } catch (error) {
      logger.error(`Admin check error: ${error.message}`, { stack: error.stack });
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Error checking admin status'
      });
    }
  }
};

module.exports = authMiddleware;
