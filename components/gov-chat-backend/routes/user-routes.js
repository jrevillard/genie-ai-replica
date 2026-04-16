const express = require('express');
const router = express.Router();
const multer = require('multer');
const { keycloakAuthMiddleware } = require('../middleware/keycloak-auth-middleware');
const { logger } = require('../shared-lib');
const keycloakProxyService = require('../services/keycloak-proxy-service');
const { JIT_FORWARD_FIELDS } = require('../constants/jit-fields');

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
   *                   example: ["GET: /debug-routes"]
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
   *     description: Returns a sanitized subset of user data for OPEA AI context enrichment. Protected by Keycloak JWT.
   *     tags: [User]
   *     security:
   *       - KeycloakOAuth2: ['openid']
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
   *         description: Missing or invalid Keycloak token
   *       404:
   *         description: User not found
   *       500:
   *         description: Server error
   */
  router.get('/:userId/context', keycloakAuthMiddleware.authenticate, async (req, res) => {
    try {
      // IDOR protection: only allow users to access their own context
      if (req.user._key !== req.params.userId) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const user = await userService.getUserProfile(req.params.userId);

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      res.json({
        name: user.name || 'User',
        role: user.roles || [],
        emailVerified: user.emailVerified || false
      });
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
   * /api/users/{userId}:
   *   put:
   *     summary: Update user profile
   *     description: Self-service profile update. JIT fields (email, name) forwarded to Keycloak Account API, custom fields saved to ArangoDB.
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
   *                 description: JSON string containing user profile data
   *               files:
   *                 type: array
   *                 items:
   *                   type: string
   *                   format: binary
   *                 description: Files to upload (optional)
   *         application/json:
   *           schema:
   *             type: object
   *             description: User profile fields to update
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
   *         description: Bad request, invalid profile data
   *       401:
   *         description: Authentication required
   *       403:
   *         description: Forbidden — cannot modify another user's profile
   *       404:
   *         description: User not found
   *       500:
   *         description: Server error
   */
  router.put('/:userId', upload.any(), keycloakAuthMiddleware.authenticate, async (req, res) => {
    const targetUserId = req.params.userId;

    try {
      // --- Self-service path: profile update ---
      // Enforce self-context: user can only update their own profile
      if (targetUserId !== req.user._key) {
        return res.status(403).json({ error: 'FORBIDDEN', message: 'You can only update your own profile', details: {} });
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

      // Split JIT fields (-> Keycloak) from custom fields (-> ArangoDB)
      const jitFields = {};
      const customFields = {};
      const JIT_KEYS = JIT_FORWARD_FIELDS;

      for (const [key, value] of Object.entries(profileData)) {
        if (JIT_KEYS.includes(key)) {
          jitFields[key] = value;
        } else {
          customFields[key] = value;
        }
      }

      // Forward JIT fields to Keycloak via Admin API
      if (Object.keys(jitFields).length > 0) {
        await keycloakProxyService.updateOwnProfile(targetUserId, jitFields);
        logger.info(`[PUT /:userId] JIT fields forwarded to Keycloak for user ${targetUserId}`);
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