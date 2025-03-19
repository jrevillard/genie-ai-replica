// auth-middleware.js
const authService = require('../services/auth-service');

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
      // Get token from authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Authorization header missing or invalid' });
      }
      
      const token = authHeader.split(' ')[1];
      if (!token) {
        return res.status(401).json({ success: false, message: 'Authorization token missing' });
      }
      
      // Verify token
      const decoded = await authService.verifyToken(token);
      if (!decoded) {
        return res.status(401).json({ success: false, message: 'Invalid or expired token' });
      }
      
      // Add user info to request object
      req.user = decoded;
      next();
    } catch (error) {
      console.error('Authentication error:', error);
      res.status(401).json({ success: false, message: 'Authentication failed' });
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
      // Must be used after authenticate middleware
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }
      
      // Get user from database to check role
      const user = await authService.getUserById(req.user.userId);
      
      // In this example, let's assume the first 10 users are admins (for testing)
      // In a real application, you would check a proper role field
      const isAdmin = parseInt(user._key) <= 10;
      
      if (!isAdmin) {
        return res.status(403).json({ success: false, message: 'Admin access required' });
      }
      
      next();
    } catch (error) {
      console.error('Admin check error:', error);
      res.status(500).json({ success: false, message: 'Error checking admin status' });
    }
  }
};

module.exports = authMiddleware;