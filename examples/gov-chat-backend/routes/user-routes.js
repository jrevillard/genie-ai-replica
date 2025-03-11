const express = require('express');
const router = express.Router();
const UserProfileService = require('../services/user-profile-service');
const multer = require('multer');

// Configure multer for in-memory file storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  }
});

const userService = new UserProfileService();

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