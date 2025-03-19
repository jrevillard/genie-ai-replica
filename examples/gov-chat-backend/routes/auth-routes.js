// auth-routes.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/auth-middleware');

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Register a new user
 *     description: Creates a new user account
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - loginName
 *               - email
 *               - encPassword
 *             properties:
 *               loginName:
 *                 type: string
 *                 description: Username for login
 *               email:
 *                 type: string
 *                 format: email
 *                 description: User's email address
 *               encPassword:
 *                 type: string
 *                 description: Password (encrypted/hashed from client)
 *               fullName:
 *                 type: string
 *                 description: User's full name (optional)
 *     responses:
 *       201:
 *         description: User registered successfully
 *       400:
 *         description: Missing required fields
 *       409:
 *         description: Username or email already exists
 *       500:
 *         description: Registration failed
 */
router.post('/register', authController.register);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: User login
 *     description: Authenticate user and return access token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - loginName
 *               - encPassword
 *             properties:
 *               loginName:
 *                 type: string
 *                 description: Username or email for login
 *               encPassword:
 *                 type: string
 *                 description: Password (encrypted/hashed from client)
 *     responses:
 *       200:
 *         description: Login successful
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Invalid credentials
 *       500:
 *         description: Login failed
 */
router.post('/login', authController.login);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: User logout
 *     description: Invalidate user's token
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logout successful
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Logout failed
 */
router.post('/logout', authMiddleware.authenticate, authController.logout);

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Get current user
 *     description: Return information about the current logged-in user
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User information retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 *       500:
 *         description: Failed to retrieve user information
 */
router.get('/me', authMiddleware.authenticate, authController.getCurrentUser);

/**
 * @swagger
 * /auth/reset-password:
 *   post:
 *     summary: Initiate password reset
 *     description: Send password reset email with token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: User's email address
 *     responses:
 *       200:
 *         description: Reset instructions sent (if email exists)
 *       400:
 *         description: Missing email
 *       500:
 *         description: Password reset initiation failed
 */
router.post('/reset-password', authController.initiatePasswordReset);

/**
 * @swagger
 * /auth/validate-token:
 *   post:
 *     summary: Validate reset token
 *     description: Check if a password reset token is valid, not expired, and not used
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *                 description: Password reset token
 *     responses:
 *       200:
 *         description: Token is valid
 *       400:
 *         description: Invalid token
 *       409:
 *         description: Token has been used
 *       410:
 *         description: Token has expired
 *       500:
 *         description: Token validation failed
 */
router.post('/validate-token', authController.validateResetToken);

/**
 * @swagger
 * /auth/reset-password/confirm:
 *   post:
 *     summary: Reset password
 *     description: Reset password using token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - newPassword
 *             properties:
 *               token:
 *                 type: string
 *                 description: Password reset token
 *               newPassword:
 *                 type: string
 *                 description: New password (encrypted/hashed from client)
 *     responses:
 *       200:
 *         description: Password reset successful
 *       400:
 *         description: Invalid token or missing fields
 *       409:
 *         description: Token has been used
 *       410:
 *         description: Token has expired
 *       500:
 *         description: Password reset failed
 */
router.post('/reset-password/confirm', authController.resetPassword);

/**
 * @swagger
 * /auth/change-password:
 *   post:
 *     summary: Change password
 *     description: Change password for authenticated user
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currentPassword
 *               - newPassword
 *             properties:
 *               currentPassword:
 *                 type: string
 *                 description: Current password (encrypted/hashed from client)
 *               newPassword:
 *                 type: string
 *                 description: New password (encrypted/hashed from client)
 *     responses:
 *       200:
 *         description: Password changed successfully
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Unauthorized or current password is incorrect
 *       500:
 *         description: Password change failed
 */
router.post('/change-password', authMiddleware.authenticate, authController.changePassword);

/**
 * @swagger
 * /auth/cleanup-tokens:
 *   post:
 *     summary: Clean up expired tokens
 *     description: Remove expired password reset tokens (admin only)
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cleanup successful
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Cleanup failed
 */
router.post('/cleanup-tokens', authMiddleware.authenticate, authMiddleware.isAdmin, authController.cleanupExpiredTokens);

module.exports = router;