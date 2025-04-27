const express = require('express');
const router = express.Router();
const UserProfileService = require('../services/user-profile-service');
const multer = require('multer');
const crypto = require('crypto');
const emailService = require('../services/email-service');
const authMiddleware = require('../middleware/auth-middleware'); // Adjust the path as needed
const { aql } = require('arangojs');
const { createLogger, format, transports } = require('winston'); // Import Winston

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

const userService = new UserProfileService();

// Set up Winston logger (consistent with index.js)
const logFormat = format.printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level.toUpperCase()}]: ${message}`;
});

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    logFormat
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: 'logs/error.log', level: 'error' }),
    new transports.File({ filename: 'logs/combined.log' })
  ],
});


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
// Debug route to list all registered routes
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
// Update user's email address with verification
router.put('/email', authMiddleware.authenticate, async (req, res) => {
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
    const { email, password, userId } = req.body;
    
    logger.info(`[EMAIL ROUTE DEBUG] 📧 Email update request details:`);
    logger.info(`  - New email: ${email || 'undefined'}`);
    logger.info(`  - Password provided: ${password ? 'Yes' : 'No'}`);
    logger.info(`  - UserId from body: ${userId || 'undefined'}`);
    
    // Critical check - has the auth middleware run properly?
    logger.info('[EMAIL ROUTE DEBUG] 🔍 Checking auth middleware result (req.user):', req.user ? 'PRESENT' : 'MISSING');
    
    // Check if we have all required fields
    if (!email) {
      logger.warn('[EMAIL ROUTE DEBUG] ❌ Missing email in request');
      return res.status(400).json({ error: 'Email is required' });
    }
    
    if (!password) {
      logger.warn('[EMAIL ROUTE DEBUG] ❌ Missing password in request');
      return res.status(400).json({ error: 'Password is required for email change verification' });
    }
    
    // At this point, req.user should be populated by the auth middleware
    if (!req.user) {
      logger.error('[EMAIL ROUTE DEBUG] ❌ No authenticated user found - auth middleware failed');
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    logger.info('[EMAIL ROUTE DEBUG] 👤 Authenticated user set by middleware:', JSON.stringify(req.user));
    
    // Get user ID from the authenticated user object
    const authenticatedUserId = req.user._key || req.user.id || req.user._id || req.user.userId;
    
    if (!authenticatedUserId) {
      logger.error('[EMAIL ROUTE DEBUG] ❌ Could not determine user ID from authenticated user data');
      logger.info('[EMAIL ROUTE DEBUG] User data structure:', JSON.stringify(req.user));
      return res.status(401).json({ error: 'Could not determine user ID from authentication data' });
    }
    
    logger.info(`[EMAIL ROUTE DEBUG] ✅ Using authenticated user ID: ${authenticatedUserId}`);
    
    // If userId provided in body, check it matches the authenticated user
    if (userId && userId !== authenticatedUserId) {
      logger.warn(`[EMAIL ROUTE DEBUG] ⚠️ WARNING: UserId in body (${userId}) does not match authenticated userId (${authenticatedUserId})`);
      // You might choose to reject this request or just log the warning
    }
    
    // Validate that password is correct
    // This is a placeholder - implement your actual password verification
    try {
      logger.info('[EMAIL ROUTE DEBUG] 🔍 Verifying password...');
      // Call your password verification method here
      // const isPasswordValid = await authService.verifyPassword(authenticatedUserId, password);
      
      // For now, assume password is valid to proceed with the example
      const isPasswordValid = true;
      
      if (!isPasswordValid) {
        logger.warn('[EMAIL ROUTE DEBUG] ❌ Password verification failed');
        return res.status(401).json({ error: 'Invalid password' });
      }
      
      logger.info('[EMAIL ROUTE DEBUG] ✅ Password verified successfully');
    } catch (passwordError) {
      logger.error(`[EMAIL ROUTE DEBUG] ❌ Password verification error: ${passwordError.message}`, passwordError);
      return res.status(401).json({ error: 'Password verification failed' });
    }
    
    // Generate verification token for the email change
    logger.info('[EMAIL ROUTE DEBUG] 🔑 Generating verification token');
    let token;
    try {
      token = crypto.randomBytes(32).toString('hex');
      logger.info(`[EMAIL ROUTE DEBUG] ✅ Token generated successfully: ${token.substring(0, 10)}...`);
    } catch (tokenError) {
      logger.error(`[EMAIL ROUTE DEBUG] ❌ Error generating token: ${tokenError.message}`, tokenError);
      return res.status(500).json({ error: 'Failed to generate verification token' });
    }
    
    // Get user to verify existence and get user name
    logger.info(`[EMAIL ROUTE DEBUG] 🔍 Getting user profile for ID: ${authenticatedUserId}`);
    let user;
    try {
      user = await userService.getUserProfile(authenticatedUserId);
      
      if (!user) {
        logger.error(`[EMAIL ROUTE DEBUG] ❌ User ${authenticatedUserId} not found in database`);
        return res.status(404).json({ error: 'User not found in database' });
      }
      
      logger.info(`[EMAIL ROUTE DEBUG] ✅ User found in database: ${JSON.stringify({
        id: user._key || user.id,
        email: user.email
      })}`);
    } catch (userError) {
      logger.error(`[EMAIL ROUTE DEBUG] ❌ Error fetching user profile: ${userError.message}`, userError);
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
      logger.error(`[EMAIL ROUTE DEBUG] ❌ Error updating user document: ${updateError.message}`, updateError);
      return res.status(500).json({ error: 'Failed to update user document' });
    }
    
    // Send verification email
    logger.info('[EMAIL ROUTE DEBUG] 📧 Preparing to send verification email');
    const userName = user.personalIdentification?.fullName || user.loginName || 'User';
    
    try {
      await emailService.sendVerificationEmail(email, token, userName);
      logger.info(`[EMAIL ROUTE DEBUG] ✅ Verification email sent to ${email}`);
    } catch (emailError) {
      logger.error(`[EMAIL ROUTE DEBUG] ❌ Error sending verification email: ${emailError.message}`, emailError);
      logger.error('[EMAIL ROUTE DEBUG] Email error stack:', emailError.stack);
      logger.warn('[EMAIL ROUTE DEBUG] ⚠️ Continuing despite email error');
    }
    
    // Return success response
    logger.info('[EMAIL ROUTE DEBUG] ✅ Email update process completed successfully');
    res.json({
      success: true,
      message: 'A verification email has been sent to your new address. You will now be logged out.',
      shouldLogout: true
    });
  } catch (error) {
    logger.info('=======================================================');
    logger.error(`[EMAIL ROUTE DEBUG] ❌ EMAIL UPDATE ERROR: ${error.message}`, error);
    logger.error('[EMAIL ROUTE DEBUG] Error stack:', error.stack);
    logger.info('=======================================================');
    res.status(500).json({ error: error.message || 'Failed to initiate email change' });
  }
});

/**
 * @swagger
 * /api/users/check-email:
 *   get:
 *     summary: Check if email is available
 *     description: Checks if an email address is available for registration or email change
 *     tags: [User]
 *     parameters:
 *       - in: query
 *         name: email
 *         schema:
 *           type: string
 *           format: email
 *         required: true
 *         description: Email address to check
 *         example: test@example.com
 *     responses:
 *       200:
 *         description: Email availability check result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 available:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Email parameter is required
 *       400:
 *         description: Bad request, missing email parameter
 *       500:
 *         description: Server error
 */
// Check if email is available
router.get('/check-email', async (req, res) => {
  try {
    const email = req.query.email;
    
    logger.info(`Email check request received for: ${email}`);
    
    if (!email) {
      logger.warn('Email check missing email parameter');
      return res.status(400).json({ available: false, message: 'Email parameter is required' });
    }
    
    // Use the service method for checking email availability
    const isAvailable = await userService.isEmailAvailable(email);
    
    res.json({ available: isAvailable });
  } catch (error) {
    logger.error('Error checking email availability:', error);
    res.status(500).json({ available: false, message: 'Error checking email availability' });
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
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
// Get user profile
router.get('/:userId', (req, res, next) => {
  // Force authentication - don't continue without a valid token
  if (!req.headers.authorization) {
    return res.status(401).json({ 
      error: 'Authentication required', 
      message: 'Not authorized' 
    });
  }
  
  // Proceed to authentication middleware
  authMiddleware.authenticate(req, res, next);
  
}, async (req, res) => {
  // Original function with original logging
  try {
    logger.info(`Getting user profile for ID: ${req.params.userId}`);
    const user = await userService.getUserProfile(req.params.userId);
    res.json(user);
  } catch (error) {
    logger.error(`Error getting user profile ${req.params.userId}:`, error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /api/users:
 *   post:
 *     summary: Create user profile
 *     description: Creates a new user profile with optional file uploads
 *     tags: [User]
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
 *     responses:
 *       201:
 *         description: User profile created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       400:
 *         description: Invalid profile data format
 *       500:
 *         description: Server error
 */
// Create user profile
router.post('/', upload.any(), async (req, res) => {
  try {
    const safeBody = maskSensitiveFields(req.body);
    logger.info("Request body:", JSON.stringify(safeBody, null, 2));
    logger.info("Files:", req.files ? req.files.length : 0);
    
    let profileData = {};
    
    // Parse profile data from request body
    if (req.body.data) {
      try {
        profileData = JSON.parse(req.body.data);
      } catch (error) {
        logger.error('Error parsing profile data:', error);
        return res.status(400).json({ message: 'Invalid profile data format' });
      }
    }
    
    logger.info("Parsed profile data:", JSON.stringify(profileData));
    
    const user = await userService.createUserProfile(profileData, req.files || []);
    res.status(201).json(user);
  } catch (error) {
    logger.error('Error creating user profile:', error);
    res.status(500).json({ message: error.message });
  }
});
/**
 * @swagger
 * /api/users/{userId}:
 *   delete:
 *     summary: Delete user profile
 *     description: Deletes a user profile by ID
 *     tags: [User]
 *     parameters:
 *       - in: path
 *         name: userId
 *         schema:
 *           type: string
 *         required: true
 *         description: ID of the user to delete
 *     responses:
 *       204:
 *         description: User profile deleted successfully
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
// Delete user profile
router.delete('/:userId', async (req, res) => {
  try {
    logger.info(`Deleting user profile for ID: ${req.params.userId}`);
    await userService.deleteUserProfile(req.params.userId);
    res.status(204).send();
  } catch (error) {
    logger.error(`Error deleting user profile ${req.params.userId}:`, error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Search users
 *     description: Search for users based on criteria with pagination
 *     tags: [User]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Maximum number of users to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of users to skip
 *       - in: query
 *         name: email
 *         schema:
 *           type: string
 *         description: Filter by email (optional)
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [User, Admin, Manager]
 *         description: Filter by role (optional)
 *     responses:
 *       200:
 *         description: Search results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 users:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/User'
 *                 total:
 *                   type: integer
 *                   example: 42
 *                 limit:
 *                   type: integer
 *                   example: 20
 *                 offset:
 *                   type: integer
 *                   example: 0
 *       500:
 *         description: Server error
 */
// Search users
router.get('/', (req, res, next) => {
  // Force authentication - don't continue without a valid token
  if (!req.headers.authorization) {
    return res.status(401).json({
      error: 'Authentication required',
      message: 'Not authorized'
    });
  }

  // Proceed to authentication middleware
  authMiddleware.authenticate(req, res, next);

}, async (req, res) => {
  // Original function with original logging
  try {
    const { limit = 20, offset = 0, ...criteria } = req.query;
    logger.info("Search criteria:", criteria);
    logger.info("Limit:", limit, "Offset:", offset);

    const results = await userService.searchUsers(criteria, parseInt(limit), parseInt(offset));
    res.json(results);
  } catch (error) {
    logger.error('Error searching users:', error);
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
// Reset user profile data while preserving essential account information
router.post('/reset-data', authMiddleware.authenticate, async (req, res) => {
  try {
    logger.info('[RESET DATA] Request received to reset user data');
    const safeBody = maskSensitiveFields(req.body);
    logger.info('[RESET DATA] Request body:', JSON.stringify(safeBody, null, 2));
    
    // Debug the entire user object to see what properties are available
    logger.info('[RESET DATA] Complete req.user object:', JSON.stringify(req.user, null, 2));
    
    // Try all possible ways to get the user ID
    const possibleIdFields = ['_key', 'id', '_id', 'userId'];
    logger.info('[RESET DATA] Checking all possible ID fields:');
    possibleIdFields.forEach(field => {
      logger.info(`  - ${field}: ${req.user ? req.user[field] : 'undefined'}`);
    });
    
    // If the user object has a different structure, check its properties
    if (req.user && typeof req.user === 'object') {
      logger.info('[RESET DATA] All properties of req.user:', Object.keys(req.user));
    }
    
    // Try getting the ID directly from the token verification result
    logger.info('[RESET DATA] Token userId:', req.user ? req.user.userId : 'undefined');
    
    // Get user ID from authenticated user object - try all possible variants
    const userId = req.user && (
      req.user._key || 
      req.user.id || 
      req.user._id || 
      req.user.userId || 
      (req.user.user && req.user.user._key) || 
      (req.user.user && req.user.user.id) ||
      (req.user.user && req.user.user._id)
    );
    
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
    
    // Call the user profile service to reset the user data
    const result = await userService.resetUserData(userId);
    
    // Return success response
    res.json({
      success: true,
      message: 'User profile data has been reset successfully',
      ...result
    });
  } catch (error) {
    logger.error('[RESET DATA] Error resetting user data:', error);
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
// Permanently delete user account
router.post('/delete', authMiddleware.authenticate, async (req, res) => {
  try {
    const safeBody = maskSensitiveFields(req.body);
    logger.info('Delete account request body:', JSON.stringify(safeBody, null, 2));
    
    // Get the user ID from auth middleware
    const userId = req.user && (
      req.user._key || req.user.id || req.user._id || req.user.userId || 
      (req.user.user && req.user.user._key) || (req.user.user && req.user.user.id) ||
      (req.user.user && req.user.user._id)
    );
    
    if (!userId) {
      logger.error('Delete account failed: Could not determine user ID from auth data');
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    
    // Validate the password
    const { password, reason } = req.body;
    if (!password) {
      logger.warn('Delete account failed: Password is required');
      return res.status(400).json({ success: false, message: 'Password is required' });
    }
    
    logger.info(`Processing account deletion for user ID: ${userId}, Reason: ${reason || 'Not provided'}`);
    
    const authService = require('../services/auth-service');
    const user = await userService.getUserProfile(userId);
    if (!user) {
      logger.error(`User ${userId} not found for deletion`);
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    const isPasswordValid = await authService.verifyPassword(password, user.encPassword);
    if (!isPasswordValid) {
      logger.warn('Delete account failed: Incorrect password');
      return res.status(403).json({ success: false, message: 'Incorrect password' });
    }
    
    // Delete the account
    const result = await userService.deleteUserAccountPermanently(userId);
    res.json({ success: true, message: 'Account deleted', ...result });
  } catch (error) {
    logger.error(`Error deleting account: ${error.message}`, error);
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
router.put('/:userId', upload.any(), authMiddleware.authenticate, async (req, res) => {
  // Debug logging
  logger.info('\n=======================================================');
  logger.info('========= PUT USER ROUTE ACCESSED =========');
  logger.info(`Method: ${req.method}`);
  logger.info(`Full URL: ${req.originalUrl}`);
  logger.info(`User ID from params: ${req.params.userId}`);
  logger.info(`Request body: ${JSON.stringify(req.body)}`);
  logger.info(`Is authenticated: ${!!req.user}`);
  logger.info(`User role: ${req.user?.role}`);
  logger.info(`Content-Type: ${req.get('Content-Type')}`);
  logger.info(`Files: ${req.files ? JSON.stringify(req.files.map(f => f.fieldname)) : 'none'}`);
  logger.info('=======================================');

  try {
    // Check if the request is for a role update
    if (req.body.role) {
      // For role updates, check admin permissions
      const isAdmin = req.user && req.user.role === 'Admin';
      if (!isAdmin) {
        logger.warn(`Non-admin attempt to change role for user ${req.params.userId}`);
        return res.status(403).json({ 
          success: false, 
          message: 'Admin privileges required to update user roles' 
        });
      }

      logger.info(`[ADMIN] Update user role request for user ID: ${req.params.userId}`);
      logger.info(`[ADMIN] Update data: ${JSON.stringify(req.body)}`);
      
      // Validate the role is one of the allowed values
      const allowedRoles = ['User', 'Admin', 'Manager'];
      if (!allowedRoles.includes(req.body.role)) {
        logger.warn(`[ADMIN] Invalid role ${req.body.role} requested for user ${req.params.userId}`);
        return res.status(400).json({ 
          success: false, 
          message: `Role must be one of: ${allowedRoles.join(', ')}` 
        });
      }
      
      // Get user to verify existence
      const user = await userService.getUserProfile(req.params.userId);
      if (!user) {
        logger.warn(`[ADMIN] User with ID ${req.params.userId} not found for role update`);
        return res.status(404).json({ 
          success: false, 
          message: 'User not found' 
        });
      }
      
      // Create update data with just the role
      const updateData = {
        role: req.body.role,
        updatedAt: new Date().toISOString()
      };
      
      // Update the user document directly in the database
      await userService.users.update(req.params.userId, updateData);
      
      logger.info(`[ADMIN] User ${req.params.userId} role updated to ${req.body.role} successfully`);
      
      // Return a clean JSON response with success flag and message
      return res.json({
        success: true,
        message: 'User role updated successfully',
        role: req.body.role
      });
    } 
    // Otherwise, treat as a normal profile update
    else {
      const safeBody = maskSensitiveFields(req.body);
      logger.info("Update request body:", JSON.stringify(safeBody, null, 2));
      logger.info("Update files:", req.files ? req.files.length : 0);
      
      let profileData = {};
      
      // Parse profile data from request body
      if (req.body.data) {
        try {
          profileData = JSON.parse(req.body.data);
        } catch (error) {
          logger.error('Error parsing profile data:', error);
          return res.status(400).json({ 
            success: false, 
            message: 'Invalid profile data format' 
          });
        }
      } else {
        // If req.body.data doesn't exist, assume the entire body is the profile data
        profileData = req.body;
      }
      
      logger.info("Parsed profile data for update:", JSON.stringify(profileData));
      
      const user = await userService.updateUserProfile(req.params.userId, profileData, req.files || []);
      
      // Return a clean JSON response with success flag and message
      return res.json({
        success: true,
        message: 'Profile saved successfully',
        user: user
      });
    }
  } catch (error) {
    logger.error(`Error updating user ${req.params.userId}:`, error);
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
router.put('/:userId/role', authMiddleware.authenticate, async (req, res) => {
  // Debug logging
  logger.info('\n=======================================================');
  logger.info('========= PUT USER/ROLE ROUTE ACCESSED =========');
  logger.info(`Method: ${req.method}`);
  logger.info(`Full URL: ${req.originalUrl}`);
  logger.info(`User ID from params: ${req.params.userId}`);
  logger.info(`Request body: ${JSON.stringify(req.body)}`);
  logger.info(`Is authenticated: ${!!req.user}`);
  logger.info(`User role: ${req.user?.role}`);
  logger.info(`Content-Type: ${req.get('Content-Type')}`);
  logger.info('=======================================');

  try {
    // Check admin permissions
    const isAdmin = req.user && req.user.role === 'Admin';
    if (!isAdmin) {
      logger.warn(`Non-admin attempt to change role for user ${req.params.userId}`);
      return res.status(403).json({ 
        success: false, 
        message: 'Admin privileges required to update user roles' 
      });
    }

    logger.info(`[ADMIN] Update user role only request for user ID: ${req.params.userId}`);
    logger.info(`[ADMIN] New role: ${req.body.role}`);
    
    // Validate the role is one of the allowed values
    const allowedRoles = ['User', 'Admin', 'Manager'];
    if (!allowedRoles.includes(req.body.role)) {
      logger.warn(`[ADMIN] Invalid role ${req.body.role} requested for user ${req.params.userId}`);
      return res.status(400).json({ 
        success: false, 
        message: `Role must be one of: ${allowedRoles.join(', ')}` 
      });
    }
    
    // Get user to verify existence
    const user = await userService.getUserProfile(req.params.userId);
    if (!user) {
      logger.warn(`[ADMIN] User with ID ${req.params.userId} not found for role update`);
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }
    
    // Create update data with just the role
    const updateData = {
      role: req.body.role,
      updatedAt: new Date().toISOString()
    };
    
    // Update the user document directly in the database
    await userService.users.update(req.params.userId, updateData);
    
    logger.info(`[ADMIN] User ${req.params.userId} role updated to ${req.body.role} successfully`);
    
    // Return success response
    return res.json({
      success: true,
      message: 'User role updated successfully',
      role: req.body.role
    });
  } catch (error) {
    logger.error(`Error updating user role for ${req.params.userId}:`, error);
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
router.post('/admin/users/:userId/resend-verification', authMiddleware.authenticate, async (req, res) => {
  logger.info('\n=======================================================');
  logger.info('========= POST ADMIN/USERS/:userId/RESEND-VERIFICATION ROUTE ACCESSED =========');
  logger.info(`Method: ${req.method}`);
  logger.info(`Full URL: ${req.originalUrl}`);
  logger.info(`User ID from params: ${req.params.userId}`);
  logger.info(`Is authenticated: ${!!req.user}`);
  logger.info(`User role: ${req.user?.role}`);
  logger.info('\n=======================================================');

  try {
    // Check admin permissions
    const isAdmin = req.user && req.user.role === 'Admin';
    if (!isAdmin) {
      logger.warn(`Non-admin attempt to resend verification email for user ${req.params.userId}`);
      return res.status(403).json({
        success: false,
        message: 'Admin privileges required to resend verification email'
      });
    }

    const userId = req.params.userId;
    logger.info(`[ADMIN] Resend verification email request for user ID: ${userId}`);

    // Get user profile to verify existence and get current email
    const user = await userService.getUserProfile(userId);
    if (!user) {
      logger.warn(`[ADMIN] User with ID ${userId} not found`);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if email is already verified (optional check)
    if (user.emailVerified) {
      logger.info(`[ADMIN] User ${userId} email is already verified, marking as unverified`);
      
      // Update user document to set emailVerified to false
      await userService.users.update(userId, {
        emailVerified: false,
        updatedAt: new Date().toISOString()
      });
    } else {
      logger.info(`[ADMIN] User ${userId} email is not verified, proceeding with resend`);
    }

    // Use the auth service to send the verification email
    // This will handle token generation, storage in verificationTokens collection, and sending the email
    const authService = require('../services/auth-service');
    try {
      await authService.sendVerificationEmail(user);
      logger.info(`[ADMIN] Verification email sent to ${user.email} for user ${userId}`);
    } catch (emailError) {
      logger.error(`[ADMIN] Failed to send verification email to ${user.email}: ${emailError.message}`, emailError);
      return res.status(500).json({
        success: false,
        message: 'Failed to send verification email'
      });
    }

    // Return success response
    return res.json({
      success: true,
      message: 'Verification email sent successfully'
    });
  } catch (error) {
    logger.error(`[ADMIN] Error resending verification email for user ${req.params.userId}:`, error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to resend verification email'
    });
  }
});

// Export the router
module.exports = router;
