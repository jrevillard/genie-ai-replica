const express = require('express');
const router = express.Router();
const SessionService = require('../services/session-service');

const sessionService = new SessionService();

/**
 * @swagger
 * /sessions:
 *   post:
 *     summary: Create a new session
 *     description: Creates a new session for a user
 *     tags: [Sessions]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *             properties:
 *               userId:
 *                 type: string
 *                 description: ID of the user
 *               deviceInfo:
 *                 type: object
 *                 properties:
 *                   type:
 *                     type: string
 *                     description: Device type (e.g., desktop, mobile)
 *                   browser:
 *                     type: string
 *                     description: Browser information
 *                   os:
 *                     type: string
 *                     description: Operating system information
 *     responses:
 *       201:
 *         description: Session created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Session'
 *       400:
 *         description: Missing required fields
 *       500:
 *         description: Server error
 */
router.post('/', async (req, res) => {
  try {
    console.log("Request body:", JSON.stringify(req.body));
    const session = await sessionService.createSession(req.body.userId, req.body.deviceInfo, req.ip);
    res.status(201).json(session);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /sessions/{sessionId}:
 *   get:
 *     summary: Get session by ID
 *     description: Retrieves a session by its unique identifier
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Session ID
 *     responses:
 *       200:
 *         description: Session retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Session'
 *       404:
 *         description: Session not found
 *       500:
 *         description: Server error
 */
router.get('/:sessionId', async (req, res) => {
  try {
    console.log("Request body:", JSON.stringify(req.body));
    const session = await sessionService.getSession(req.params.sessionId);
    res.json(session);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /sessions/{sessionId}/end:
 *   patch:
 *     summary: End a session
 *     description: Marks a session as ended
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Session ID
 *     responses:
 *       200:
 *         description: Session ended successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Session'
 *       404:
 *         description: Session not found
 *       500:
 *         description: Server error
 */
router.patch('/:sessionId/end', async (req, res) => {
  try {
    console.log("Request body:", JSON.stringify(req.body));
    const session = await sessionService.endSession(req.params.sessionId);
    res.json(session);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /sessions/{sessionId}/keepalive:
 *   patch:
 *     summary: Keep a session alive
 *     description: Updates the last activity time of a session to prevent expiration
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Session ID
 *     responses:
 *       200:
 *         description: Session kept alive successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Session'
 *       404:
 *         description: Session not found
 *       500:
 *         description: Server error
 */
router.patch('/:sessionId/keepalive', async (req, res) => {
  try {
    console.log("Request body:", JSON.stringify(req.body));
    const session = await sessionService.keepSessionAlive(req.params.sessionId);
    res.json(session);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /sessions/user/{userId}:
 *   get:
 *     summary: Get user's sessions
 *     description: Retrieves all sessions for a specific user
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *       - in: query
 *         name: activeOnly
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Whether to return only active sessions
 *     responses:
 *       200:
 *         description: Sessions retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Session'
 *       500:
 *         description: Server error
 */
router.get('/user/:userId', async (req, res) => {
  try {
    const activeOnly = req.query.activeOnly === 'true';
    console.log("Request body:", JSON.stringify(req.body));
    const sessions = await sessionService.getUserSessions(req.params.userId, activeOnly);
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;