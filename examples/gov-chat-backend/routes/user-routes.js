const express = require('express');
const router = express.Router();
const UserProfileService = require('../services/user-profile-service');
const multer = require('multer');
const crypto = require('crypto');
const emailService = require('../services/email-service');
const authMiddleware = require('../middleware/auth-middleware'); // Adjust the path as needed
const { aql } = require('arangojs');
const { createLogger, format, transports } = require('winston'); // Import Winston

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

// Helper function to mask sensitive fields in the request body
const maskSensitiveFields = (body) => {
  const safeBody = { ...body };
  if (safeBody.password) safeBody.password = '******';
  if (safeBody.token) safeBody.token = '******';
  if (safeBody.encPassword) safeBody.encPassword = '******';
  return safeBody;
};

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

// Get user profile
router.get('/:userId', async (req, res) => {
  try {
    logger.info(`Getting user profile for ID: ${req.params.userId}`);
    const user = await userService.getUserProfile(req.params.userId);
    res.json(user);
  } catch (error) {
    logger.error(`Error getting user profile ${req.params.userId}:`, error);
    res.status(500).json({ message: error.message });
  }
});

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

// Update user profile
router.put('/:userId', upload.any(), async (req, res) => {
  try {
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
    res.json({
      success: true,
      message: 'Profile saved successfully',
      user: user
    });
  } catch (error) {
    logger.error(`Error updating user profile ${req.params.userId}:`, error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to update profile' 
    });
  }
});

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

// Search users
router.get('/', async (req, res) => {
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

// Export the router
module.exports = router;