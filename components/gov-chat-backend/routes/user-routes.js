const express = require('express');
const router = express.Router();
const multer = require('multer');
const { keycloakAuthMiddleware } = require('../middleware/keycloak-auth-middleware');
const serviceTokenService = require('../services/service-token-service');
const { logger } = require('../shared-lib');
const keycloakProxyService = require('../services/keycloak-proxy-service');

/**
 * @swagger
 * tags:
 *   - name: User
 *     description: User profile management
 *   - name: User Administration
 *     description: Admin-specific user management operations
 * 
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       properties:
 *         _key:
 *           type: string
 *           description: Unique identifier
 *         email:
 *           type: string
 *           format: email
 *           description: User's email address
 *         emailVerified:
 *           type: boolean
 *           description: Whether email has been verified
 *         role:
 *           type: string
 *           enum: [User, Admin, Manager]
 *           description: User's role
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: Account creation timestamp
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: Last update timestamp
 */

// Configure multer for in-memory file storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  }
});

module.exports = (userService) => {
  if (!userService || typeof userService.getUserProfile !== 'function') {
    logger.error('Invalid userService provided to user-routes');
    throw new Error('userService is required with getUserProfile');
  }
  logger.debug('user-routes initialized with userService', {
    methods: Object.getOwnPropertyNames(Object.getPrototypeOf(userService)).filter(m => m !== 'constructor')
  });

  // Log route initialization
  logger.info('User Routes Module: LOADED');
  logger.info('Total routes in stack:', router.stack.length);
  router.stack.forEach((middleware, index) => {
    if (middleware.route) {
      logger.info(`Route ${index}: ${JSON.stringify(middleware.route.methods)} - ${middleware.route.path}`);
    }
  });

  // Helper function to mask sensitive fields in the request body
  const maskSensitiveFields = (body) => {
    const safeBody = { ...body };
    if (safeBody.password) safeBody.password = '******';
    if (safeBody.token) safeBody.token = '******';
    if (safeBody.encPassword) safeBody.encPassword = '******';
    return safeBody;
  };

  /**
   * @swagger
   * /api/users/debug-routes:
   *   get:
   *     summary: List all registered routes for debugging
   *     description: Lists all registered routes on the user router for debugging purposes
   *     tags: [User]
   *     responses:
   *       200:
   *         description: Successful response
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 message:
   *                   type: string
   *                   example: Routes registered on this router
   *                 routes:
   *                   type: array
   *                   items:
   *                     type: string
   *                   example: ["GET: /debug-routes", "PUT: /email"]
   *       500:
   *         description: Server error
   */
  router.get('/debug-routes', (req, res) => {
    logger.info('Debug routes endpoint accessed');
    
    // List all registered routes
    const routes = [];
    router.stack.forEach(layer => {
      if (layer.route) {
        const path = layer.route.path;
        const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase()).join(', ');
        routes.push(`${methods}: ${path}`);
      }
    });
    
    logger.info('Successfully retrieved registered routes');
    
    res.json({ 
      success: true, 
      message: 'Routes registered on this router',
      routes: routes
    });
  });

  /**
   * @swagger
   * /api/users/email:
   *   put:
   *     summary: Update user's email address
   *     description: Proxies email change to Keycloak Admin API via service account. Self-service only — authenticated user must be the target user.
   *     tags: [User]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - email
   *             properties:
   *               email:
   *                 type: string
   *                 format: email
   *                 description: New email address
   *                 example: newemail@example.com
   *               userId:
   *                 type: string
   *                 description: User ID (optional, must match authenticated user if provided)
   *     responses:
   *       200:
   *         description: Email updated successfully via Keycloak
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 message:
   *                   type: string
   *                   example: Email updated. Please verify your new email address.
   *                 shouldLogout:
   *                   type: boolean
   *                   example: true
   *       400:
   *         description: Bad request, missing email
   *       401:
   *         description: Authentication required
   *       403:
   *         description: Cannot modify a different user
   *       404:
   *         description: User not found in Keycloak
   *       409:
   *         description: Email already in use
   *       500:
   *         description: Server error
   */
  router.put('/email', keycloakAuthMiddleware.authenticate, async (req, res) => {
    try {
      const { email, userId } = req.body;

      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }

      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Self-service: verify the authenticated user matches the target user
      const authenticatedUserId = req.user._key;
      if (userId && userId !== authenticatedUserId) {
        return res.status(403).json({ success: false, message: 'Cannot modify a different user' });
      }

      // Proxy to Keycloak via service account
      await keycloakProxyService.updateUser(authenticatedUserId, {
        email: email,
        emailVerified: false
      });

      logger.info(`[EMAIL] Email updated via Keycloak proxy for user ${authenticatedUserId}`);
      res.json({
        success: true,
        message: 'Email updated. Please verify your new email address.',
        shouldLogout: true
      });
    } catch (error) {
      const status = error.status === 404 ? 404 : error.status === 409 ? 409 : 500;
      logger.error(`[EMAIL] Error updating email: ${error.message}`, { stack: error.stack });
      res.status(status).json({ success: false, message: error.message || 'Failed to update email' });
    }
  });


  

  

  /**
   * @swagger
   * /api/users/{userId}:
   *   get:
   *     summary: Get user profile
   *     description: Retrieves a user profile by ID
   *     tags: [User]
   *     parameters:
   *       - in: path
   *         name: userId
   *         schema:
   *           type: string
   *         required: true
   *         description: ID of the user to retrieve
   *     responses:
   *       200:
   *         description: User profile information
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/User'
   *       401:
   *         description: Authentication required
   *       404:
   *         description: User not found
   *       500:
   *         description: Server error
   */
  router.get('/:userId', keycloakAuthMiddleware.authenticate, async (req, res) => {
    try {
      logger.info(`Getting user profile for ID: ${req.params.userId}`);
      const user = await userService.getUserProfile(req.params.userId);
      logger.info(`User profile retrieved successfully for ID: ${req.params.userId}`);
      res.json(user);
    } catch (error) {
      logger.error(`Error getting user profile ${req.params.userId}: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * @swagger
   * /api/users/{userId}/context:
   *   get:
   *     summary: Get safe user context for AI enrichment
   *     description: Returns a sanitized subset of user data for OPEA AI context enrichment. Protected by X-Service-Token (shared secret), not Keycloak JWT.
   *     tags: [User]
   *     parameters:
   *       - in: path
   *         name: userId
   *         required: true
   *         schema:
   *           type: string
   *         description: ArangoDB _key of the user (URL-safe)
   *     responses:
   *       200:
   *         description: Sanitized user context for AI
   *       401:
   *         description: Missing or invalid X-Service-Token
   *       404:
   *         description: User not found
   *       500:
   *         description: Server error
   */
  router.get('/:userId/context', async (req, res) => {
    // Validate service shared secret
    const tokenError = serviceTokenService.validateServiceToken(req.headers['x-service-token']);
    if (tokenError) {
      return res.status(tokenError.status).json(tokenError.body);
    }

    try {
      const user = await userService.getUserProfile(req.params.userId);

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      res.json(serviceTokenService.buildUserContext(user));
    } catch (error) {
      logger.error(`Error getting user context ${req.params.userId}: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * @swagger
   * /api/users/reset-data:
   *   post:
   *     summary: Reset user profile data
   *     description: Resets a user's profile data while preserving essential account information (credentials, email, creation date). JIT-provisioned fields (name, roles) are restored on next login.
   *     tags: [User]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     responses:
   *       200:
   *         description: User profile data reset successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 message:
   *                   type: string
   *                   example: User profile data has been reset successfully
   *       401:
   *         description: Authentication required
   *       500:
   *         description: Server error
   */
  router.post('/reset-data', keycloakAuthMiddleware.authenticate, async (req, res) => {
    try {
      const userId = req.user._key;
      logger.info(`[RESET DATA] Reset request for user ${userId}`);

      const result = await userService.resetUserData(userId);
      logger.info(`[RESET DATA] User profile data reset successfully for user ${userId}`);

      res.json({
        success: true,
        message: 'User profile data has been reset successfully',
        ...result
      });
    } catch (error) {
      logger.error(`[RESET DATA] Error resetting user data: ${error.message}`, { stack: error.stack });
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to reset user data'
      });
    }
  });

  /**
   * @swagger
   * /api/users/delete:
   *   post:
   *     summary: Delete user account
   *     description: Deletes user from Keycloak and marks as deleted in ArangoDB (defense-in-depth)
   *     tags: [User]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               reason:
   *                 type: string
   *                 description: Optional reason for account deletion
   *     responses:
   *       200:
   *         description: Account deleted successfully
   *       401:
   *         description: Authentication required
   *       404:
   *         description: User not found
   *       500:
   *         description: Server error
   */
  router.post('/delete', keycloakAuthMiddleware.authenticate, async (req, res) => {
    try {
      if (!req.user || !req.user._key) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      const userId = req.user._key;
      logger.info(`[DELETE] Account deletion requested for user ${userId}`);

      await keycloakProxyService.deleteUser(userId);

      logger.info(`[DELETE] Account deleted successfully for user ${userId}`);
      res.json({ success: true, message: 'Account deleted' });
    } catch (error) {
      const status = error.status === 404 ? 404 : 500;
      logger.error(`[DELETE] Error deleting account: ${error.message}`, { stack: error.stack });
      res.status(status).json({ success: false, message: error.message || 'Failed to delete account' });
    }
  });

  /**
   * @swagger
   * /api/users/{userId}:
   *   put:
   *     summary: Update user profile, assign roles, or enable/disable user
   *     description: |-
   *       Dual-purpose route:
   *       - Admin path (roles array): Assigns realm roles via Keycloak Admin API
   *       - Admin path (disabled boolean): Enables/disables user via Keycloak Admin API
   *       - Self-service path: Updates profile — JIT fields (email, name) forwarded to Keycloak Account API, custom fields saved to ArangoDB
   *     tags: [User]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     parameters:
   *       - in: path
   *         name: userId
   *         schema:
   *           type: string
   *         required: true
   *         description: ID of the user to update
   *     requestBody:
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               data:
   *                 type: string
   *                 description: JSON string containing user profile data (for self-service updates)
   *               roles:
   *                 type: array
   *                 items:
   *                   type: string
   *                 description: Realm roles to assign (admin only), e.g. ["admin", "user"]
   *               disabled:
   *                 type: boolean
   *                 description: Set true to disable user, false to enable (admin only, inverse boolean)
   *               files:
   *                 type: array
   *                 items:
   *                   type: string
   *                   format: binary
   *                 description: Files to upload (optional)
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               roles:
   *                 type: array
   *                 items:
   *                   type: string
   *                 description: Realm roles to assign (admin only)
   *               disabled:
   *                 type: boolean
   *                 description: Set true to disable user, false to enable (admin only)
   *     responses:
   *       200:
   *         description: User updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 message:
   *                   type: string
   *                   example: Profile saved successfully
   *       400:
   *         description: Bad request, invalid profile data or role
   *       401:
   *         description: Authentication required
   *       403:
   *         description: Forbidden — admin privileges required, or cannot modify another user's profile
   *       404:
   *         description: User not found
   *       500:
   *         description: Server error
   */
  router.put('/:userId', upload.any(), keycloakAuthMiddleware.authenticate, async (req, res) => {
    const targetUserId = req.params.userId;

    try {
      // --- Admin path: role assignment ---
      if (req.body.roles && Array.isArray(req.body.roles)) {
        const isAdmin = req.user && req.user.roles && req.user.roles.includes('admin');
        if (!isAdmin) {
          return res.status(403).json({ success: false, message: 'Admin privileges required to update user roles' });
        }

        await keycloakProxyService.assignRoles(targetUserId, req.body.roles);
        logger.info(`[PUT /:userId] Roles updated via Keycloak for user ${targetUserId}: ${req.body.roles.join(', ')}`);

        return res.json({ success: true, message: 'User roles updated successfully' });
      }

      // --- Admin path: enable/disable ---
      if (req.body.disabled !== undefined) {
        const isAdmin = req.user && req.user.roles && req.user.roles.includes('admin');
        if (!isAdmin) {
          return res.status(403).json({ success: false, message: 'Admin privileges required to enable/disable users' });
        }

        await keycloakProxyService.updateUser(targetUserId, { enabled: !req.body.disabled });
        logger.info(`[PUT /:userId] User ${targetUserId} ${!req.body.disabled ? 'enabled' : 'disabled'} via Keycloak`);

        return res.json({ success: true, message: `User ${!req.body.disabled ? 'enabled' : 'disabled'} successfully` });
      }

      // --- Self-service path: profile update ---
      // Enforce self-context: user can only update their own profile
      if (targetUserId !== req.user._key) {
        return res.status(403).json({ success: false, message: 'You can only update your own profile' });
      }

      // Reject admin-only fields in self-service context
      if (req.body.roles || req.body.disabled || req.body.active || req.body.deleted) {
        return res.status(400).json({ success: false, message: 'Cannot modify admin fields' });
      }

      // Parse profile data (multipart/form-data sends JSON in req.body.data)
      let profileData = {};
      if (req.body.data) {
        try {
          profileData = JSON.parse(req.body.data);
        } catch (error) {
          return res.status(400).json({ success: false, message: 'Invalid profile data format' });
        }
      } else {
        profileData = { ...req.body };
      }

      // Split JIT fields (→ Keycloak) from custom fields (→ ArangoDB)
      const jitFields = {};
      const customFields = {};
      const JIT_KEYS = ['email', 'firstName', 'lastName', 'username'];

      for (const [key, value] of Object.entries(profileData)) {
        if (JIT_KEYS.includes(key)) {
          jitFields[key] = value;
        } else {
          customFields[key] = value;
        }
      }

      // Forward JIT fields to Keycloak Account API
      if (Object.keys(jitFields).length > 0) {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
          return res.status(401).json({ success: false, message: 'Missing authorization for profile update' });
        }
        const accessToken = authHeader.substring(7);
        await keycloakProxyService.updateOwnProfile(accessToken, jitFields);
        logger.info(`[PUT /:userId] JIT fields forwarded to Keycloak Account API for user ${targetUserId}`);
      }

      // Write custom fields to ArangoDB (JIT fields are stripped by updateUserProfile)
      const user = await userService.updateUserProfile(targetUserId, customFields, req.files || []);
      logger.info(`[PUT /:userId] Profile updated for user ${targetUserId}`);

      return res.json({ success: true, message: 'Profile saved successfully', user });
    } catch (error) {
      const status = error.status === 404 ? 404 : error.status === 403 ? 403 : 500;
      logger.error(`[PUT /:userId] Error updating user ${targetUserId}: ${error.message}`, { stack: error.stack });
      res.status(status).json({ success: false, message: error.message || 'Failed to update user' });
    }
  });


/**
 * @swagger
 * /api/users/admin/users/{userId}/force-logout:
 *   post:
 *     summary: Force logout a user
 *     description: Admin-only endpoint to force logout a user by invalidating their tokens and ending all active sessions
 *     tags: [User Administration]
 *     security:
 *       - KeycloakOAuth2: ['openid']
 *     parameters:
 *       - in: path
 *         name: userId
 *         schema:
 *           type: string
 *         required: true
 *         description: ID of the user to force logout
 *     responses:
 *       200:
 *         description: User logged out successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: User logged out successfully
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Forbidden, admin privileges required
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
router.post('/admin/users/:userId/force-logout', keycloakAuthMiddleware.authenticate, keycloakAuthMiddleware.requireAdmin, async (req, res) => {
  logger.info('\n=======================================================');
  logger.info('========= POST ADMIN/USERS/:userId/FORCE-LOGOUT ROUTE ACCESSED =========');
  logger.info(`Method: ${req.method}`);
  logger.info(`Full URL: ${req.originalUrl}`);
  logger.info(`User ID from params: ${req.params.userId}`);
  logger.info(`Authenticated user: ${req.user?._key || 'unknown'}`);
  logger.info(`User role: ${req.user?.role || 'unknown'}`);
  logger.info(`Timestamp: ${new Date().toISOString()}`);
  logger.info('=======================================');

  try {
    const userId = req.params.userId;
    const adminId = req.user?._key;

    logger.info(`[FORCE LOGOUT] Admin ${adminId} requested force logout for user ${userId}`);

    if (!userId) {
      logger.warn(`[FORCE LOGOUT] Missing userId in request`);
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }

    const result = await userService.forceUserLogout(userId, adminId);

    logger.info(`[FORCE LOGOUT] User ${userId} logged out successfully by admin ${adminId}`);
    return res.json({
      success: true,
      message: 'User logged out successfully'
    });
  } catch (error) {
    logger.error(`[FORCE LOGOUT] Error forcing logout for user ${req.params.userId} by admin ${req.user?._key}: ${error.message}`, {
      stack: error.stack,
      userId: req.params.userId,
      adminId: req.user?._key,
      timestamp: new Date().toISOString()
    });

    if (error.message === 'User not found') {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.status(500).json({ success: false, message: 'Failed to force logout' });
  }
});

/**
 * Catch-all route for unmatched requests
 * Logs details of unmatched requests for debugging
 */
router.all('*', (req, res) => {
  logger.warn('\n=========================================================');
  logger.warn(`[UNMATCHED ROUTE DEBUG] ${new Date().toISOString()} - Unmatched Request`);
  logger.warn('=========================================================');
  logger.warn(`[UNMATCHED ROUTE DEBUG] Method: ${req.method}`);
  logger.warn(`[UNMATCHED ROUTE DEBUG] URL: ${req.originalUrl}`);
  logger.warn(`[UNMATCHED ROUTE DEBUG] Path: ${req.path}`);
  logger.warn(`[UNMATCHED ROUTE DEBUG] Headers:`, JSON.stringify(req.headers, (key, value) => 
    key.toLowerCase() === 'authorization' ? value.substring(0, 20) + '...' : value, 2));
  logger.warn(`[UNMATCHED ROUTE DEBUG] Body:`, JSON.stringify(maskSensitiveFields(req.body), null, 2));
  logger.warn(`[UNMATCHED ROUTE DEBUG] Query:`, JSON.stringify(req.query, null, 2));
  logger.warn(`[UNMATCHED ROUTE DEBUG] Registered Routes:`, router.stack
    .filter(layer => layer.route)
    .map(layer => `${Object.keys(layer.route.methods).map(m => m.toUpperCase()).join(', ')}: ${layer.route.path}`));

  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`
  });
});

logger.info('User Routes Module: LOADED');
logger.info('Initializing user routes with base path assumption: /api/users');
logger.info('Total routes in stack:', router.stack.length);
router.stack.forEach((middleware, index) => {
  if (middleware.route) {
    const path = middleware.route.path;
    const methods = Object.keys(middleware.route.methods).map(m => m.toUpperCase()).join(', ');
    logger.info(`Route ${index}: ${methods} - /api/users${path}`);
  } else if (middleware.name === 'router') {
    logger.info(`Route ${index}: Sub-router mounted at ${middleware.regexp}`);
  } else {
    logger.info(`Route ${index}: Middleware - ${middleware.name || 'anonymous'}`);
  }
});
logger.info('Available routes can be checked at: GET /api/users/debug-routes');

  return router;
};