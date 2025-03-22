// auth-middleware.js
const authService = require('../services/auth-service');

// Utility function to safely stringify objects with circular references
const safeStringify = (obj, indent = 2) => {
  try {
    const cache = new Set();
    return JSON.stringify(obj, (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (cache.has(value)) {
          return '[Circular]';
        }
        cache.add(value);
      }
      // Mask sensitive data
      if (key === 'password' || key === 'encPassword' || key === 'token') {
        return typeof value === 'string' ? '******' : value;
      }
      return value;
    }, indent);
  } catch (err) {
    return `[Error serializing object: ${err.message}]`;
  }
};

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
    console.log('\n=======================================================');
    console.log(`[AUTH DEBUG] ${new Date().toISOString()} - Authentication Started`);
    console.log('=======================================================');
    console.log(`[AUTH DEBUG] Request URL: ${req.method} ${req.url}`);
    console.log(`[AUTH DEBUG] Route parameters:`, safeStringify(req.params));
    console.log(`[AUTH DEBUG] Query parameters:`, safeStringify(req.query));
    
    // Log request headers
    console.log('[AUTH DEBUG] Request headers:');
    Object.keys(req.headers).forEach(key => {
      // Don't log the full token for security
      const value = key.toLowerCase() === 'authorization' 
        ? req.headers[key].substring(0, 20) + '...' 
        : req.headers[key];
      console.log(`  ${key}: ${value}`);
    });
    
    // Log request body
    console.log('[AUTH DEBUG] Request body:', safeStringify(req.body));
    console.log('[AUTH DEBUG] Content-Type:', req.get('Content-Type'));
    
    try {
      // Check if auth header exists
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        console.log('[AUTH DEBUG] ❌ No Authorization header found');
        
        // Special handling for '/email' route - try to extract userId from body
        if (req.originalUrl.includes('/email') && req.body && req.body.userId) {
          console.log(`[AUTH DEBUG] 📧 Email route detected with userId: ${req.body.userId} in body`);
          console.log('[AUTH DEBUG] Checking if this is a direct userId authentication attempt');
          
          try {
            console.log(`[AUTH DEBUG] Attempting to get user by ID: ${req.body.userId}`);
            const user = await authService.getUserById(req.body.userId);
            
            if (user) {
              console.log('[AUTH DEBUG] ✅ Found user by ID:', safeStringify(user));
              req.user = user;
              next();
              return;
            } else {
              console.log(`[AUTH DEBUG] ❌ No user found with ID: ${req.body.userId}`);
            }
          } catch (userErr) {
            console.error(`[AUTH DEBUG] ❌ Error fetching user by ID: ${userErr.message}`);
          }
        }
        
        return res.status(401).json({ success: false, message: 'Authorization header missing' });
      }
      
      if (!authHeader.startsWith('Bearer ')) {
        console.log('[AUTH DEBUG] ❌ Authorization header does not start with "Bearer "');
        return res.status(401).json({ success: false, message: 'Invalid authorization format' });
      }
      
      // Extract token
      const token = authHeader.split(' ')[1];
      console.log(`[AUTH DEBUG] 🔑 Token extracted (first 10 chars): ${token.substring(0, 10)}...`);
      
      if (!token) {
        console.log('[AUTH DEBUG] ❌ Token is empty after extraction');
        return res.status(401).json({ success: false, message: 'Token is empty' });
      }
      
      // Verify token
      console.log('[AUTH DEBUG] 🔍 Attempting to verify token...');
      let decoded;
      try {
        decoded = await authService.verifyToken(token);
        console.log(`[AUTH DEBUG] ✅ Token verification result:`, safeStringify(decoded));
      } catch (tokenErr) {
        console.error(`[AUTH DEBUG] ❌ Token verification error: ${tokenErr.message}`);
        return res.status(401).json({ success: false, message: `Token verification failed: ${tokenErr.message}` });
      }
      
      if (!decoded) {
        console.log('[AUTH DEBUG] ❌ Decoded token is null or undefined');
        return res.status(401).json({ success: false, message: 'Invalid token - could not decode' });
      }
      
      // Extract user identifiers from decoded token
      const tokenUserId = decoded._key || decoded.id || decoded._id || decoded.userId;
      console.log(`[AUTH DEBUG] 👤 User ID from token: ${tokenUserId}`);
      
      // Check for userId in request body for extra validation
      if (req.body && req.body.userId) {
        console.log(`[AUTH DEBUG] 📝 Found userId in request body: ${req.body.userId}`);
        
        if (tokenUserId && req.body.userId !== tokenUserId) {
          console.log(`[AUTH DEBUG] ⚠️ WARNING: userId in body (${req.body.userId}) does not match token userId (${tokenUserId})`);
        } else {
          console.log('[AUTH DEBUG] ✅ userId in body matches token');
        }
      }
      
      // Set user in request object
      req.user = decoded;
      console.log(`[AUTH DEBUG] ✅ User attached to request. Authentication successful`);
      
      // Check if we need to get additional user data
      if (req.originalUrl.includes('/email')) {
        try {
          console.log(`[AUTH DEBUG] 📧 Email route - fetching additional user data for ID: ${tokenUserId}`);
          const userDetails = await authService.getUserById(tokenUserId);
          
          if (userDetails) {
            console.log('[AUTH DEBUG] ✅ Additional user details found:', safeStringify(userDetails));
          } else {
            console.log(`[AUTH DEBUG] ⚠️ WARNING: Could not find additional user details for ID: ${tokenUserId}`);
          }
        } catch (userDetailErr) {
          console.error(`[AUTH DEBUG] ⚠️ Error fetching additional user details: ${userDetailErr.message}`);
        }
      }
      
      console.log('[AUTH DEBUG] ✅ Authentication middleware complete, calling next()');
      next();
    } catch (error) {
      console.log('=======================================================');
      console.error(`[AUTH DEBUG] ❌ AUTHENTICATION ERROR: ${error.message}`);
      console.error('[AUTH DEBUG] Error stack:', error.stack);
      console.log('=======================================================');
      res.status(401).json({ success: false, message: 'Authentication failed', error: error.message });
    }
  },
  
  /**
   * Check if user is an admin
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  async isAdmin(req, res, next) {
    console.log('\n=======================================================');
    console.log(`[ADMIN DEBUG] ${new Date().toISOString()} - Admin Check Started`);
    console.log('=======================================================');
    
    try {
      // Must be used after authenticate middleware
      if (!req.user) {
        console.log('[ADMIN DEBUG] ❌ No user object found in request');
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }
      
      const userId = req.user._key || req.user.id || req.user._id || req.user.userId;
      console.log(`[ADMIN DEBUG] 👤 Checking admin status for user ID: ${userId}`);
      
      // Get user from database to check role
      console.log('[ADMIN DEBUG] 🔍 Fetching user details from database...');
      const user = await authService.getUserById(userId);
      console.log('[ADMIN DEBUG] User details:', safeStringify(user));
      
      if (!user) {
        console.log(`[ADMIN DEBUG] ❌ No user found with ID: ${userId}`);
        return res.status(404).json({ success: false, message: 'User not found' });
      }
      
      // In this example, let's assume the first 10 users are admins (for testing)
      // In a real application, you would check a proper role field
      const isAdmin = parseInt(user._key) <= 10;
      console.log(`[ADMIN DEBUG] User _key: ${user._key}, Is admin? ${isAdmin}`);
      
      if (!isAdmin) {
        console.log('[ADMIN DEBUG] ❌ User is not an admin');
        return res.status(403).json({ success: false, message: 'Admin access required' });
      }
      
      console.log('[ADMIN DEBUG] ✅ Admin check passed, calling next()');
      next();
    } catch (error) {
      console.log('=======================================================');
      console.error(`[ADMIN DEBUG] ❌ ADMIN CHECK ERROR: ${error.message}`);
      console.error('[ADMIN DEBUG] Error stack:', error.stack);
      console.log('=======================================================');
      res.status(500).json({ success: false, message: 'Error checking admin status', error: error.message });
    }
  }
};

module.exports = authMiddleware;