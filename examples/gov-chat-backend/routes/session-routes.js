const express = require('express');
const router = express.Router();
const SessionService = require('../services/session-service');

const sessionService = new SessionService();

// Create a new session
router.post('/', async (req, res) => {
  try {
    const session = await sessionService.createSession(req.body.userId, req.body.deviceInfo, req.ip);
    res.status(201).json(session);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get session by ID
router.get('/:sessionId', async (req, res) => {
  try {
    const session = await sessionService.getSession(req.params.sessionId);
    res.json(session);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// End a session
router.patch('/:sessionId/end', async (req, res) => {
  try {
    const session = await sessionService.endSession(req.params.sessionId);
    res.json(session);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Keep a session alive
router.patch('/:sessionId/keepalive', async (req, res) => {
  try {
    const session = await sessionService.keepSessionAlive(req.params.sessionId);
    res.json(session);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get user's sessions
router.get('/user/:userId', async (req, res) => {
  try {
    const activeOnly = req.query.activeOnly === 'true';
    const sessions = await sessionService.getUserSessions(req.params.userId, activeOnly);
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
