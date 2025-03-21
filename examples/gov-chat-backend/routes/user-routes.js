const express = require('express');
const router = express.Router();
const UserProfileService = require('../services/user-profile-service');
const multer = require('multer');
const crypto = require('crypto');
const emailService = require('../services/email-service');
// Get access to the auth middleware
const authMiddleware = require('../middleware/auth'); // Adjust the path as needed


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
router.put('/email', authMiddleware, async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log(`Email update request for: ${email}`);
    
    // After the authMiddleware runs, req.user should be populated
    console.log('Authenticated user:', req.user);
    
    // Debugging - print the entire user object to see its structure
    console.log('Auth user details:', JSON.stringify(req.user));
    
    if (!req.user) {
      console.error('Email update failed: Authentication middleware did not set user');
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get user ID from the authenticated user object
    // Adjust this based on how your auth object is structured
    const userId = req.user._key || req.user.id || req.user._id || req.user.userId;
    
    if (!userId) {
      console.error('Email update failed: Could not determine user ID from auth data');
      console.error('Auth data structure:', req.user);
      return res.status(401).json({ error: 'Could not determine user ID from authentication data' });
    }
    
    console.log(`Processing email update for authenticated user ID: ${userId}`);
    
    try {
      // Generate verification token
      const token = crypto.randomBytes(32).toString('hex');
      
      // Get user to verify existence and get user name
      const user = await userService.getUserProfile(userId);
      
      if (!user) {
        console.error(`User ${userId} not found`);
        return res.status(404).json({ error: 'User not found' });
      }
      
      // Add pending email change to user document
      const updateData = {
        pendingEmailChange: {
          email: email,
          token: token
        },
        updatedAt: new Date().toISOString()
      };
      
      // Update user document
      await userService.users.update(userId, updateData);
      
      // Send verification email to the new address
      const userName = user.personalIdentification?.fullName || user.loginName || 'User';
      await emailService.sendVerificationEmail(email, token, userName);
      
      console.log(`Email verification sent to ${email} for user ${userId}`);
      
      // Return success response
      res.json({
        success: true,
        message: 'A verification email has been sent to your new address. You will now be logged out.',
        shouldLogout: true
      });
    } catch (updateError) {
      console.error(`Error updating email for user ${userId}:`, updateError);
      res.status(500).json({ error: updateError.message || 'Failed to update email' });
    }
  } catch (error) {
    console.error('Error handling email update:', error);
    res.status(500).json({ error: error.message || 'Failed to initiate email change' });
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