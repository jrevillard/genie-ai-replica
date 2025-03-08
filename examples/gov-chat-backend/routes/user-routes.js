const express = require('express');
const router = express.Router();
const UserProfileService = require('../services/user-profile-service');
const multer = require('multer');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, './uploads/')
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname)
  }
});
const upload = multer({ storage: storage });

const userService = new UserProfileService();

// Get user profile
router.get('/:userId', async (req, res) => {
  try {
    const user = await userService.getUserProfile(req.params.userId);
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create user profile
router.post('/', upload.any(), async (req, res) => {
  try {
    const profileData = JSON.parse(req.body.data || '{}');
    const user = await userService.createUserProfile(profileData, req.files);
    res.status(201).json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update user profile
router.put('/:userId', upload.any(), async (req, res) => {
  try {
    const profileData = JSON.parse(req.body.data || '{}');
    const user = await userService.updateUserProfile(req.params.userId, profileData, req.files);
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Delete user profile
router.delete('/:userId', async (req, res) => {
  try {
    await userService.deleteUserProfile(req.params.userId);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Search users
router.get('/', async (req, res) => {
  try {
    const { limit = 20, offset = 0, ...criteria } = req.query;
    const results = await userService.searchUsers(criteria, parseInt(limit), parseInt(offset));
    res.json(results);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
