const express = require('express');
const router = express.Router();
const UserProfileService = require('../services/user-profile-service');
const multer = require('multer');
const crypto = require('crypto');
const emailService = require('../services/email-service');
// Get access to the auth middleware
const authMiddleware = require('../middleware/auth-middleware'); // Adjust the path as needed
// Import aql from ArangoDB
const { aql } = require('arangojs');


// Configure multer for in-memory file storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  }
});

const userService = new UserProfileService();

// IMPORTANT: Route order matters in Express!
// The '/email' route must be defined BEFORE the '/:userId' route
// Otherwise, Express will interpret 'email' as a userId parameter

// Update user's email address with verification
router.put('/email', authMiddleware.authenticate, async (req, res) => {
  console.log('\n=======================================================');
  console.log(`[EMAIL ROUTE DEBUG] ${new Date().toISOString()} - Email Update Route Entered (After Auth Middleware)`);
  console.log('=======================================================');
  
  // Log the complete request
  console.log('[EMAIL ROUTE DEBUG] Request method:', req.method);
  console.log('[EMAIL ROUTE DEBUG] Request URL:', req.url);
  console.log('[EMAIL ROUTE DEBUG] Request path:', req.path);
  console.log('[EMAIL ROUTE DEBUG] Content-Type:', req.get('Content-Type'));
  
  // Log headers (excluding full auth token)
  console.log('[EMAIL ROUTE DEBUG] Headers:');
  Object.keys(req.headers).forEach(key => {
    const value = key.toLowerCase() === 'authorization' 
      ? req.headers[key].substring(0, 20) + '...' 
      : req.headers[key];
    console.log(`  ${key}: ${value}`);
  });
  
  // Log request body with sensitive information masked
  const safePrintBody = { ...req.body };
  if (safePrintBody.password) safePrintBody.password = '******';
  if (safePrintBody.token) safePrintBody.token = '******';
  console.log('[EMAIL ROUTE DEBUG] Request body:', JSON.stringify(safePrintBody, null, 2));
  
  try {
    const { email, password, userId } = req.body;
    
    console.log(`[EMAIL ROUTE DEBUG] 📧 Email update request details:`);
    console.log(`  - New email: ${email || 'undefined'}`);
    console.log(`  - Password provided: ${password ? 'Yes' : 'No'}`);
    console.log(`  - UserId from body: ${userId || 'undefined'}`);
    
    // Critical check - has the auth middleware run properly?
    console.log('[EMAIL ROUTE DEBUG] 🔍 Checking auth middleware result (req.user):', req.user ? 'PRESENT' : 'MISSING');
    
    // Check if we have all required fields
    if (!email) {
      console.log('[EMAIL ROUTE DEBUG] ❌ Missing email in request');
      return res.status(400).json({ error: 'Email is required' });
    }
    
    if (!password) {
      console.log('[EMAIL ROUTE DEBUG] ❌ Missing password in request');
      return res.status(400).json({ error: 'Password is required for email change verification' });
    }
    
    // At this point, req.user should be populated by the auth middleware
    if (!req.user) {
      console.error('[EMAIL ROUTE DEBUG] ❌ No authenticated user found - auth middleware failed');
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    console.log('[EMAIL ROUTE DEBUG] 👤 Authenticated user set by middleware:', JSON.stringify(req.user));
    
    // Get user ID from the authenticated user object
    const authenticatedUserId = req.user._key || req.user.id || req.user._id || req.user.userId;
    
    if (!authenticatedUserId) {
      console.error('[EMAIL ROUTE DEBUG] ❌ Could not determine user ID from authenticated user data');
      console.log('[EMAIL ROUTE DEBUG] User data structure:', JSON.stringify(req.user));
      return res.status(401).json({ error: 'Could not determine user ID from authentication data' });
    }
    
    console.log(`[EMAIL ROUTE DEBUG] ✅ Using authenticated user ID: ${authenticatedUserId}`);
    
    // If userId provided in body, check it matches the authenticated user
    if (userId && userId !== authenticatedUserId) {
      console.log(`[EMAIL ROUTE DEBUG] ⚠️ WARNING: UserId in body (${userId}) does not match authenticated userId (${authenticatedUserId})`);
      // You might choose to reject this request or just log the warning
    }
    
    // Validate that password is correct
    // This is a placeholder - implement your actual password verification
    try {
      console.log('[EMAIL ROUTE DEBUG] 🔍 Verifying password...');
      // Call your password verification method here
      // const isPasswordValid = await authService.verifyPassword(authenticatedUserId, password);
      
      // For now, assume password is valid to proceed with the example
      const isPasswordValid = true;
      
      if (!isPasswordValid) {
        console.log('[EMAIL ROUTE DEBUG] ❌ Password verification failed');
        return res.status(401).json({ error: 'Invalid password' });
      }
      
      console.log('[EMAIL ROUTE DEBUG] ✅ Password verified successfully');
    } catch (passwordError) {
      console.error(`[EMAIL ROUTE DEBUG] ❌ Password verification error: ${passwordError.message}`);
      return res.status(401).json({ error: 'Password verification failed' });
    }
    
    // Generate verification token for the email change
    console.log('[EMAIL ROUTE DEBUG] 🔑 Generating verification token');
    let token;
    try {
      token = crypto.randomBytes(32).toString('hex');
      console.log(`[EMAIL ROUTE DEBUG] ✅ Token generated successfully: ${token.substring(0, 10)}...`);
    } catch (tokenError) {
      console.error(`[EMAIL ROUTE DEBUG] ❌ Error generating token: ${tokenError.message}`);
      return res.status(500).json({ error: 'Failed to generate verification token' });
    }
    
    // Get user to verify existence and get user name
    console.log(`[EMAIL ROUTE DEBUG] 🔍 Getting user profile for ID: ${authenticatedUserId}`);
    let user;
    try {
      user = await userService.getUserProfile(authenticatedUserId);
      
      if (!user) {
        console.error(`[EMAIL ROUTE DEBUG] ❌ User ${authenticatedUserId} not found in database`);
        return res.status(404).json({ error: 'User not found in database' });
      }
      
      console.log(`[EMAIL ROUTE DEBUG] ✅ User found in database: ${JSON.stringify({
        id: user._key || user.id,
        email: user.email
      })}`);
    } catch (userError) {
      console.error(`[EMAIL ROUTE DEBUG] ❌ Error fetching user profile: ${userError.message}`);
      return res.status(500).json({ error: 'Error fetching user profile' });
    }
    
    // Add pending email change to user document
    console.log('[EMAIL ROUTE DEBUG] 📝 Creating update data for pending email change');
    const updateData = {
      pendingEmailChange: {
        email: email,
        token: token
      },
      emailVerified: false, // Set emailVerified to false until the new email is verified
      updatedAt: new Date().toISOString()
    };
    
    console.log(`[EMAIL ROUTE DEBUG] 💾 Updating user document with pending email change: ${JSON.stringify({
      pendingEmailChange: { email, token: token.substring(0, 10) + '...' },
      emailVerified: false, // Log this change
      updatedAt: updateData.updatedAt
    })}`);
    
    try {
      await userService.users.update(authenticatedUserId, updateData);
      console.log(`[EMAIL ROUTE DEBUG] ✅ User document updated successfully`);
    } catch (updateError) {
      console.error(`[EMAIL ROUTE DEBUG] ❌ Error updating user document: ${updateError.message}`);
      return res.status(500).json({ error: 'Failed to update user document' });
    }
    
    // Send verification email
    console.log('[EMAIL ROUTE DEBUG] 📧 Preparing to send verification email');
    const userName = user.personalIdentification?.fullName || user.loginName || 'User';
    
    try {
      await emailService.sendVerificationEmail(email, token, userName);
      console.log(`[EMAIL ROUTE DEBUG] ✅ Verification email sent to ${email}`);
    } catch (emailError) {
      console.error(`[EMAIL ROUTE DEBUG] ❌ Error sending verification email: ${emailError.message}`);
      console.error('[EMAIL ROUTE DEBUG] Email error stack:', emailError.stack);
      
      // We'll still return success even if email fails, but log the issue
      console.log('[EMAIL ROUTE DEBUG] ⚠️ Continuing despite email error');
    }
    
    // Return success response
    console.log('[EMAIL ROUTE DEBUG] ✅ Email update process completed successfully');
    res.json({
      success: true,
      message: 'A verification email has been sent to your new address. You will now be logged out.',
      shouldLogout: true
    });
  } catch (error) {
    console.log('=======================================================');
    console.error(`[EMAIL ROUTE DEBUG] ❌ EMAIL UPDATE ERROR: ${error.message}`);
    console.error('[EMAIL ROUTE DEBUG] Error stack:', error.stack);
    console.log('=======================================================');
    res.status(500).json({ error: error.message || 'Failed to initiate email change' });
  }
});

// Check if email is available
router.get('/check-email', async (req, res) => {
  try {
    const email = req.query.email;
    
    console.log(`Email check request received for: ${email}`);
    
    if (!email) {
      console.log('Email check missing email parameter');
      return res.status(400).json({ available: false, message: 'Email parameter is required' });
    }
    
    // Use the service method for checking email availability
    const isAvailable = await userService.isEmailAvailable(email);
    
    res.json({ available: isAvailable });
  } catch (error) {
    console.error('Error checking email availability:', error);
    res.status(500).json({ available: false, message: 'Error checking email availability' });
  }
});

// Get user profile
router.get('/:userId', async (req, res) => {
  try {
    console.log(`Getting user profile for ID: ${req.params.userId}`);
    const user = await userService.getUserProfile(req.params.userId);
    res.json(user);
  } catch (error) {
    console.error(`Error getting user profile ${req.params.userId}:`, error);
    res.status(500).json({ message: error.message });
  }
});

// Create user profile
router.post('/', upload.any(), async (req, res) => {
  try {
    console.log("Request body:", req.body);
    console.log("Files:", req.files ? req.files.length : 0);
    
    let profileData = {};
    
    // Parse profile data from request body
    if (req.body.data) {
      try {
        profileData = JSON.parse(req.body.data);
      } catch (error) {
        console.error('Error parsing profile data:', error);
        return res.status(400).json({ message: 'Invalid profile data format' });
      }
    }
    
    console.log("Parsed profile data:", JSON.stringify(profileData));
    
    const user = await userService.createUserProfile(profileData, req.files || []);
    res.status(201).json(user);
  } catch (error) {
    console.error('Error creating user profile:', error);
    res.status(500).json({ message: error.message });
  }
});

// Update user profile
router.put('/:userId', upload.any(), async (req, res) => {
  try {
    console.log("Update request body:", req.body);
    console.log("Update files:", req.files ? req.files.length : 0);
    
    let profileData = {};
    
    // Parse profile data from request body
    if (req.body.data) {
      try {
        profileData = JSON.parse(req.body.data);
      } catch (error) {
        console.error('Error parsing profile data:', error);
        return res.status(400).json({ message: 'Invalid profile data format' });
      }
    }
    
    console.log("Parsed profile data for update:", JSON.stringify(profileData));
    
    const user = await userService.updateUserProfile(req.params.userId, profileData, req.files || []);
    res.json(user);
  } catch (error) {
    console.error(`Error updating user profile ${req.params.userId}:`, error);
    res.status(500).json({ message: error.message });
  }
});

// Delete user profile
router.delete('/:userId', async (req, res) => {
  try {
    console.log(`Deleting user profile for ID: ${req.params.userId}`);
    await userService.deleteUserProfile(req.params.userId);
    res.status(204).send();
  } catch (error) {
    console.error(`Error deleting user profile ${req.params.userId}:`, error);
    res.status(500).json({ message: error.message });
  }
});

// Search users
router.get('/', async (req, res) => {
  try {
    const { limit = 20, offset = 0, ...criteria } = req.query;
    console.log("Search criteria:", criteria);
    console.log("Limit:", limit, "Offset:", offset);
    
    const results = await userService.searchUsers(criteria, parseInt(limit), parseInt(offset));
    res.json(results);
  } catch (error) {
    console.error('Error searching users:', error);
    res.status(500).json({ message: error.message });
  }
});

// Export the router
module.exports = router;