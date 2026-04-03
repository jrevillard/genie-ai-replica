const express = require('express');
const router = express.Router();
const multer = require('multer');
const crypto = require('crypto');
const emailService = require('../services/email-service');
const { keycloakAuthMiddleware } = require('../middleware/keycloak-auth-middleware');
const { logger } = require('../shared-lib');

/**
 * @swagger
 * tags:
 *   - name: User
 *     description: User profile management
 *   - name: User Administration
 *     description: Admin-specific user management operations
 * 
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
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
   *     description: Initiates the process to update a user's email address with verification
   *     tags: [User]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - email
   *               - password
   *             properties:
   *               email:
   *                 type: string
   *                 format: email
   *                 description: New email address
   *                 example: newemail@example.com
   *               password:
   *                 type: string
   *                 description: Current password for verification
   *                 example: password123
   *               userId:
   *                 type: string
   *                 description: User ID (optional, will be overridden by authenticated user)
   *     responses:
   *       200:
   *         description: Email update initiated successfully
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
   *                   example: A verification email has been sent to your new address. You will now be logged out.
   *                 shouldLogout:
   *                   type: boolean
   *                   example: true
   *       400:
   *         description: Bad request, missing required fields
   *       401:
   *         description: Authentication error, invalid password
   *       500:
   *         description: Server error
   */
  router.put('/email', keycloakAuthMiddleware.authenticate, async (req, res) => {
    logger.info('\n=======================================================');
    logger.info(`[EMAIL ROUTE DEBUG] ${new Date().toISOString()} - Email Update Route Entered (After Auth Middleware)`);
    logger.info('=======================================================');
    
    // Log the complete request
    logger.info('[EMAIL ROUTE DEBUG] Request method:', req.method);
    logger.info('[EMAIL ROUTE DEBUG] Request URL:', req.url);
    logger.info('[EMAIL ROUTE DEBUG] Request path:', req.path);
    logger.info('[EMAIL ROUTE DEBUG] Content-Type:', req.get('Content-Type'));
    
    // Log headers (excluding full auth token)
    logger.info('[EMAIL ROUTE DEBUG] Headers:');
    Object.keys(req.headers).forEach(key => {
      const value = key.toLowerCase() === 'authorization' 
        ? req.headers[key].substring(0, 20) + '...' 
        : req.headers[key];
      logger.info(`  ${key}: ${value}`);
    });
    
    // Log request body with sensitive information masked
    const safePrintBody = maskSensitiveFields(req.body);
    logger.info('[EMAIL ROUTE DEBUG] Request body:', JSON.stringify(safePrintBody, null, 2));
    
    try {
      const { email, userId } = req.body;

      logger.info(`[EMAIL ROUTE DEBUG] 📧 Email update request details:`);
      logger.info(`  - New email: ${email || 'undefined'}`);
      logger.info(`  - UserId from body: ${userId || 'undefined'}`);

      // Critical check - has the auth middleware run properly?
      logger.info('[EMAIL ROUTE DEBUG] 🔍 Checking auth middleware result (req.user):', req.user ? 'PRESENT' : 'MISSING');

      // Check if we have all required fields
      if (!email) {
        logger.warn('[EMAIL ROUTE DEBUG] Missing email in request');
        return res.status(400).json({ error: 'Email is required' });
      }
      
      // At this point, req.user should be populated by the auth middleware
      if (!req.user) {
        logger.error('[EMAIL ROUTE DEBUG] No authenticated user found - auth middleware failed');
        return res.status(401).json({ error: 'Authentication required' });
      }
      
      logger.info('[EMAIL ROUTE DEBUG] 👤 Authenticated user set by middleware:', JSON.stringify(req.user));

      // Get user ID from the authenticated user object (Keycloak sets iss_sub)
      const authenticatedUserId = req.user.iss_sub;
      
      if (!authenticatedUserId) {
        logger.error('[EMAIL ROUTE DEBUG] Could not determine user ID from authenticated user data');
        logger.info('[EMAIL ROUTE DEBUG] User data structure:', JSON.stringify(req.user));
        return res.status(401).json({ error: 'Could not determine user ID from authentication data' });
      }
      
      logger.info(`[EMAIL ROUTE DEBUG] Using authenticated user ID: ${authenticatedUserId}`);

      // If userId provided in body, check it matches the authenticated user
      if (userId && userId !== authenticatedUserId) {
        logger.warn(`[EMAIL ROUTE DEBUG] UserId in body (${userId}) does not match authenticated userId (${authenticatedUserId})`);
        return res.status(403).json({ success: false, message: 'Cannot modify a different user' });
      }

      // Generate verification token for the email change
      logger.info('[EMAIL ROUTE DEBUG] 🔑 Generating verification token');
      let token;
      try {
        token = crypto.randomBytes(32).toString('hex');
        logger.info(`[EMAIL ROUTE DEBUG] ✅ Token generated successfully: ${token.substring(0, 10)}...`);
      } catch (tokenError) {
        logger.error(`[EMAIL ROUTE DEBUG] Error generating token: ${tokenError.message}`, { stack: tokenError.stack });
        return res.status(500).json({ error: 'Failed to generate verification token' });
      }
      
      // Get user to verify existence and get user name
      logger.info(`[EMAIL ROUTE DEBUG] 🔍 Getting user profile for ID: ${authenticatedUserId}`);
      let user;
      try {
        user = await userService.getUserProfile(authenticatedUserId);
        
        if (!user) {
          logger.error(`[EMAIL ROUTE DEBUG] User ${authenticatedUserId} not found in database`);
          return res.status(404).json({ error: 'User not found in database' });
        }
        
        logger.info(`[EMAIL ROUTE DEBUG] ✅ User found in database: ${JSON.stringify({
          id: user._key || user.id,
          email: user.email
        })}`);
      } catch (userError) {
        logger.error(`[EMAIL ROUTE DEBUG] Error fetching user profile: ${userError.message}`, { stack: userError.stack });
        return res.status(500).json({ error: 'Error fetching user profile' });
      }
      
      // Add pending email change to user document
      logger.info('[EMAIL ROUTE DEBUG] 📝 Creating update data for pending email change');
      const updateData = {
        pendingEmailChange: {
          email: email,
          token: token
        },
        emailVerified: false, // Set emailVerified to false until the new email is verified
        updatedAt: new Date().toISOString()
      };
      
      logger.info(`[EMAIL ROUTE DEBUG] 💾 Updating user document with pending email change: ${JSON.stringify({
        pendingEmailChange: { email, token: token.substring(0, 10) + '...' },
        emailVerified: false,
        updatedAt: updateData.updatedAt
      })}`);
      
      try {
        await userService.users.update(authenticatedUserId, updateData);
        logger.info(`[EMAIL ROUTE DEBUG] ✅ User document updated successfully`);
      } catch (updateError) {
        logger.error(`[EMAIL ROUTE DEBUG] Error updating user document: ${updateError.message}`, { stack: updateError.stack });
        return res.status(500).json({ error: 'Failed to update user document' });
      }
      
      // Send verification email
      logger.info('[EMAIL ROUTE DEBUG] 📧 Preparing to send verification email');
      const userName = user.personalIdentification?.fullName || user.loginName || 'User';
      
      try {
        await emailService.sendVerificationEmail(email, token, userName);
        logger.info(`[EMAIL ROUTE DEBUG] Verification email sent to ${email}`);
      } catch (emailError) {
        logger.error(`[EMAIL ROUTE DEBUG] Error sending verification email: ${emailError.message}`, { stack: emailError.stack });
        logger.warn('[EMAIL ROUTE DEBUG] Continuing despite email error');
      }
      
      // Return success response
      logger.info('[EMAIL ROUTE DEBUG] Email update process completed successfully');
      res.json({
        success: true,
        message: 'A verification email has been sent to your new address. You will now be logged out.',
        shouldLogout: true
      });
    } catch (error) {
      logger.info('=======================================================');
      logger.error(`[EMAIL ROUTE DEBUG] EMAIL UPDATE ERROR: ${error.message}`, { stack: error.stack });
      logger.info('=======================================================');
      res.status(500).json({ error: error.message || 'Failed to initiate email change' });
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
  router.get('/:userId', (req, res, next) => {
    if (!req.headers.authorization) {
      logger.warn(`Authentication required for fetching user profile ${req.params.userId}`);
      return res.status(401).json({ 
        error: 'Authentication required', 
        message: 'Not authorized' 
      });
    }
    
    keycloakAuthMiddleware.authenticate(req, res, next);
  }, async (req, res) => {
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
   * /api/users/reset-data:
   *   post:
   *     summary: Reset user profile data
   *     description: Resets a user profile data while preserving essential account information
   *     tags: [User]
   *     security:
   *       - bearerAuth: []
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
      logger.info('[RESET DATA] Request received to reset user data');
      const safeBody = maskSensitiveFields(req.body);
      logger.info('[RESET DATA] Request body:', JSON.stringify(safeBody, null, 2));
      
      // Debug the entire user object to see what properties are available
      logger.info('[RESET DATA] Complete req.user object:', JSON.stringify(req.user, null, 2));
      
      // Try all possible ways to get the user ID
      const possibleIdFields = ['_key', 'id', '_id', 'iss_sub'];
      logger.info('[RESET DATA] Checking all possible ID fields:');
      possibleIdFields.forEach(field => {
        logger.info(`  - ${field}: ${req.user ? req.user[field] : 'undefined'}`);
      });

      // If the user object has a different structure, check its properties
      if (req.user && typeof req.user === 'object') {
        logger.info('[RESET DATA] All properties of req.user:', Object.keys(req.user));
      }

      // Get user ID from authenticated user object
      const userId = req.user?.iss_sub;
      
      if (!userId) {
        logger.error('[RESET DATA] Could not determine user ID from authentication data');
        logger.error('[RESET DATA] User object type:', typeof req.user);
        logger.error('[RESET DATA] Is user object present:', !!req.user);
        
        return res.status(401).json({ 
          success: false, 
          message: 'Authentication required' 
        });
      }
      
      logger.info(`[RESET DATA] Processing reset request for user ID: ${userId}`);
      
      const result = await userService.resetUserData(userId);
      logger.info(`[RESET DATA] User profile data reset successfully for user ID: ${userId}`);
      
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
   *     summary: Permanently delete user account
   *     description: Permanently deletes a user account with password verification
   *     tags: [User]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - password
   *             properties:
   *               password:
   *                 type: string
   *                 description: Current password for verification
   *               reason:
   *                 type: string
   *                 description: Reason for deleting the account (optional)
   *     responses:
   *       200:
   *         description: Account deleted successfully
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
   *                   example: Account deleted
   *       400:
   *         description: Bad request, missing password
   *       401:
   *         description: Authentication required
   *       403:
   *         description: Incorrect password
   *       404:
   *         description: User not found
   *       500:
   *         description: Server error
   */
  router.post('/delete', keycloakAuthMiddleware.authenticate, async (req, res) => {
    try {
      const safeBody = maskSensitiveFields(req.body);
      logger.info('Delete account request body:', JSON.stringify(safeBody, null, 2));
      
      const userId = req.user && req.user.iss_sub;

      if (!userId) {
        logger.error('Delete account failed: Could not determine user ID from auth data');
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      const { reason } = req.body;

      logger.info(`Processing account deletion for user ID: ${userId}, Reason: ${reason || 'Not provided'}`);
      
      const user = await userService.getUserProfile(userId);
      if (!user) {
        logger.error(`User ${userId} not found for deletion`);
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      const result = await userService.deleteUserAccountPermanently(userId);
      logger.info(`Account deleted successfully for user ID: ${userId}`);
      
      res.json({ success: true, message: 'Account deleted', ...result });
    } catch (error) {
      logger.error(`Error deleting account: ${error.message}`, { stack: error.stack });
      res.status(500).json({ success: false, message: error.message || 'Failed to delete account' });
    }
  });

  /**
   * @swagger
   * /api/users/{userId}:
   *   put:
   *     summary: Update user profile or role
   *     description: Updates a user's profile data or role (admin only for role updates)
   *     tags: [User]
   *     security:
   *       - bearerAuth: []
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
   *               role:
   *                 type: string
   *                 enum: [User, Admin, Manager]
   *                 description: User role (admin only)
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
   *               role:
   *                 type: string
   *                 enum: [User, Admin, Manager]
   *                 description: User role (admin only)
   *     responses:
   *       200:
   *         description: User profile or role updated successfully
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
   *                 user:
   *                   type: object
   *                   description: Updated user data (only when profile is updated)
   *                 role:
   *                   type: string
   *                   description: Updated role (only when role is updated)
   *                   example: Admin
   *       400:
   *         description: Bad request, invalid profile data or role
   *       401:
   *         description: Authentication required
   *       403:
   *         description: Forbidden, admin privileges required for role updates
   *       404:
   *         description: User not found
   *       500:
   *         description: Server error
   */
  router.put('/:userId', upload.any(), keycloakAuthMiddleware.authenticate, async (req, res) => {
    logger.info('\n=======================================================');
    logger.info('========= PUT USER ROUTE ACCESSED =========');
    logger.info(`Method: ${req.method}`);
    logger.info(`Full URL: ${req.originalUrl}`);
    logger.info(`User ID from params: ${req.params.userId}`);
    logger.info(`Request body: ${JSON.stringify(req.body)}`);
    logger.info(`Is authenticated: ${!!req.user}`);
    logger.info(`User role: ${req.user?.roles}`);
    logger.info(`Content-Type: ${req.get('Content-Type')}`);
    logger.info(`Files: ${req.files ? JSON.stringify(req.files.map(f => f.fieldname)) : 'none'}`);
    logger.info('=======================================');

    try {
      if (req.body.role) {
        const isAdmin = req.user && req.user.roles && req.user.roles.includes('admin');
        if (!isAdmin) {
          logger.warn(`Non-admin attempt to change role for user ${req.params.userId}`);
          return res.status(403).json({ 
            success: false, 
            message: 'Admin privileges required to update user roles' 
          });
        }

        logger.info(`[ADMIN] Update user role request for user ID: ${req.params.userId}`);
        logger.info(`[ADMIN] Update data: ${JSON.stringify(req.body)}`);
        
        const allowedRoles = ['User', 'Admin', 'Manager'];
        if (!allowedRoles.includes(req.body.role)) {
          logger.warn(`[ADMIN] Invalid role ${req.body.role} requested for user ${req.params.userId}`);
          return res.status(400).json({ 
            success: false, 
            message: `Role must be one of: ${allowedRoles.join(', ')}` 
          });
        }
        
        const user = await userService.getUserProfile(req.params.userId);
        if (!user) {
          logger.warn(`[ADMIN] User with ID ${req.params.userId} not found for role update`);
          return res.status(404).json({ 
            success: false, 
            message: 'User not found' 
          });
        }
        
        const updateData = {
          role: req.body.role,
          updatedAt: new Date().toISOString()
        };
        
        await userService.users.update(req.params.userId, updateData);
        logger.info(`[ADMIN] User ${req.params.userId} role updated to ${req.body.role} successfully`);
        
        return res.json({
          success: true,
          message: 'User role updated successfully',
          role: req.body.role
        });
      } else {
        const safeBody = maskSensitiveFields(req.body);
        logger.info("Update request body:", JSON.stringify(safeBody, null, 2));
        logger.info("Update files:", req.files ? req.files.length : 0);
        
        let profileData = {};
        
        if (req.body.data) {
          try {
            profileData = JSON.parse(req.body.data);
          } catch (error) {
            logger.error(`Error parsing profile data: ${error.message}`, { stack: error.stack });
            return res.status(400).json({ 
              success: false, 
              message: 'Invalid profile data format' 
            });
          }
        } else {
          profileData = req.body;
        }
        
        logger.info("Parsed profile data for update:", JSON.stringify(profileData));
        
        const user = await userService.updateUserProfile(req.params.userId, profileData, req.files || []);
        logger.info(`User profile updated successfully for user ID: ${req.params.userId}`);
        
        return res.json({
          success: true,
          message: 'Profile saved successfully',
          user: user
        });
      }
    } catch (error) {
      logger.error(`Error updating user ${req.params.userId}: ${error.message}`, { stack: error.stack });
      res.status(500).json({ 
        success: false, 
        message: error.message || 'Failed to update user' 
      });
    }
  });

  /**
   * @swagger
   * /api/users/{userId}/role:
   *   put:
   *     summary: Update user role
   *     description: Updates a user's role (admin only)
   *     tags: [User Administration]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: userId
   *         schema:
   *           type: string
   *         required: true
   *         description: ID of the user to update
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - role
   *             properties:
   *               role:
   *                 type: string
   *                 enum: [User, Admin, Manager]
   *                 description: New role to assign to the user
   *     responses:
   *       200:
   *         description: User role updated successfully
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
   *                   example: User role updated successfully
   *                 role:
   *                   type: string
   *                   example: Admin
   *       400:
   *         description: Bad request, invalid role
   *       401:
   *         description: Authentication required
   *       403:
   *         description: Forbidden, admin privileges required
   *       404:
   *         description: User not found
   *       500:
   *         description: Server error
   */
  router.put('/:userId/role', keycloakAuthMiddleware.authenticate, async (req, res) => {
    logger.info('\n=======================================================');
    logger.info('========= PUT USER/ROLE ROUTE ACCESSED =========');
    logger.info(`Method: ${req.method}`);
    logger.info(`Full URL: ${req.originalUrl}`);
    logger.info(`User ID from params: ${req.params.userId}`);
    logger.info(`Request body: ${JSON.stringify(req.body)}`);
    logger.info(`Is authenticated: ${!!req.user}`);
    logger.info(`User role: ${req.user?.roles}`);
    logger.info(`Content-Type: ${req.get('Content-Type')}`);
    logger.info('=======================================');

    try {
      const isAdmin = req.user && req.user.roles && req.user.roles.includes('admin');
      if (!isAdmin) {
        logger.warn(`Non-admin attempt to change role for user ${req.params.userId}`);
        return res.status(403).json({
          success: false,
          message: 'Admin privileges required to update user roles'
        });
      }

      logger.info(`[ADMIN] Update user role only request for user ID: ${req.params.userId}`);
      logger.info(`[ADMIN] New role: ${req.body.role}`);
      
      const allowedRoles = ['User', 'Admin', 'Manager'];
      if (!allowedRoles.includes(req.body.role)) {
        logger.warn(`[ADMIN] Invalid role ${req.body.role} requested for user ${req.params.userId}`);
        return res.status(400).json({ 
          success: false, 
          message: `Role must be one of: ${allowedRoles.join(', ')}` 
        });
      }
      
      const user = await userService.getUserProfile(req.params.userId);
      if (!user) {
        logger.warn(`[ADMIN] User with ID ${req.params.userId} not found for role update`);
        return res.status(404).json({ 
          success: false, 
          message: 'User not found' 
        });
      }
      
      const updateData = {
        role: req.body.role,
        updatedAt: new Date().toISOString()
      };
      
      await userService.users.update(req.params.userId, updateData);
      logger.info(`[ADMIN] User ${req.params.userId} role updated to ${req.body.role} successfully`);
      
      return res.json({
        success: true,
        message: 'User role updated successfully',
        role: req.body.role
      });
    } catch (error) {
      logger.error(`Error updating user role for ${req.params.userId}: ${error.message}`, { stack: error.stack });
      res.status(500).json({ 
        success: false, 
        message: error.message || 'Failed to update user role' 
      });
    }
  });

/**
 * @swagger
 * /api/users/admin/users/{userId}/resend-verification:
 *   post:
 *     summary: Resend email verification
 *     description: Admin only endpoint to resend verification email to a user
 *     tags: [User Administration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         schema:
 *           type: string
 *         required: true
 *         description: ID of the user to resend verification email to
 *     responses:
 *       200:
 *         description: Verification email sent successfully
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
 *                   example: Verification email sent successfully
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Forbidden, admin privileges required
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
router.post('/admin/users/:userId/resend-verification', keycloakAuthMiddleware.authenticate, async (req, res) => {
  logger.info('\n=======================================================');
  logger.info('========= POST ADMIN/USERS/:userId/RESEND-VERIFICATION ROUTE ACCESSED =========');
  logger.info(`Method: ${req.method}`);
  logger.info(`Full URL: ${req.originalUrl}`);
  logger.info(`User ID from params: ${req.params.userId}`);
  logger.info(`Is authenticated: ${!!req.user}`);
  logger.info(`User role: ${req.user?.roles}`);
  logger.info('=======================================');

  try {
    const isAdmin = req.user && req.user.roles && req.user.roles.includes('admin');
    if (!isAdmin) {
      logger.warn(`Non-admin attempt to resend verification email for user ${req.params.userId}`);
      return res.status(403).json({
        success: false,
        message: 'Admin privileges required to resend verification email'
      });
    }

    const userId = req.params.userId;
    logger.info(`[ADMIN] Resend verification email request for user ID: ${userId}`);

    const user = await userService.getUserProfile(userId);
    if (!user) {
      logger.warn(`[ADMIN] User with ID ${userId} not found`);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.emailVerified) {
      logger.info(`[ADMIN] User ${userId} email is already verified, marking as unverified`);
      await userService.users.update(userId, {
        emailVerified: false,
        updatedAt: new Date().toISOString()
      });
    } else {
      logger.info(`[ADMIN] User ${userId} email is not verified, proceeding with resend`);
    }

    // Send verification email using UserProfileService
    await userService.sendVerificationEmail(user);
    logger.info(`[ADMIN] Verification email sent to ${user.email} for user ${userId}`);

    logger.info(`[ADMIN] Verification email process completed successfully for user ${userId}`);
    
    return res.json({
      success: true,
      message: 'Verification email sent successfully'
    });
  } catch (error) {
    logger.error(`[ADMIN] Error resending verification email for user ${req.params.userId}: ${error.message}`, { stack: error.stack });
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to resend verification email'
    });
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
 *       - bearerAuth: []
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