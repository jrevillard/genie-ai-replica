const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/auth-middleware');
const path = require('path');
//const { logger } = require('../logger'); // Import logger from logger.js
const { logger } = require('shared-lib');

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
router.post('/register', (req, res, next) => {
  logger.info(`Register request for loginName: ${req.body.loginName}, email: ${req.body.email}`);
  authController.register(req, res, next);
});

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
router.post('/login', (req, res, next) => {
  logger.info(`Login attempt for loginName: ${req.body.loginName}`);
  authController.login(req, res, next);
});

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
router.post('/logout', authMiddleware.authenticate, (req, res, next) => {
  logger.info(`Logout request for user: ${req.user?.loginName || 'unknown'}`);
  authController.logout(req, res, next);
});

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
router.get('/me', authMiddleware.authenticate, (req, res, next) => {
  logger.info(`Fetching current user info for: ${req.user?.loginName || 'unknown'}`);
  authController.getCurrentUser(req, res, next);
});

/**
 * @swagger
 * /auth/verify-email/{token}:
 *   get:
 *     summary: Verify email
 *     description: Verify user's email address using token
 *     tags: [Authentication]
 *     parameters:
 *       - in: path
 *         name: token
 *         schema:
 *           type: string
 *         required: true
 *         description: Email verification token
 *     responses:
 *       302:
 *         description: Redirects to login page with verification status
 */
router.get('/verify-email/:token', (req, res, next) => {
  logger.info(`Email verification attempt with token: ${req.params.token}`);
  authController.verifyEmail(req, res, next);
});

/**
 * @swagger
 * /auth/verify-email-success:
 *   get:
 *     summary: Email verification result page
 *     description: Displays the result of email verification
 *     tags: [Authentication]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [success, error]
 *         description: Verification result status
 *     responses:
 *       200:
 *         description: Serves the SPA to handle verification result
 */
router.get('/verify-email-success', (req, res) => {
  logger.info(`Serving email verification result page with status: ${req.query.status || 'unknown'}`);
  res.sendFile(path.resolve(__dirname, '../../dist/index.html'));
});

/**
 * @swagger
 * /auth/resend-verification:
 *   post:
 *     summary: Resend verification email
 *     description: Resend verification email to user
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
 *         description: Verification email sent if user exists
 *       400:
 *         description: Missing email
 *       500:
 *         description: Failed to send verification email
 */
router.post('/resend-verification', (req, res, next) => {
  logger.info(`Resend verification email request for: ${req.body.email}`);
  authController.resendVerificationEmail(req, res, next);
});

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
router.post('/reset-password', (req, res, next) => {
  logger.info(`Password reset request initiated for: ${req.body.email}`);
  authController.initiatePasswordReset(req, res, next);
});

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
router.post('/validate-token', (req, res, next) => {
  logger.info(`Validating password reset token: ${req.body.token}`);
  authController.validateResetToken(req, res, next);
});

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
router.post('/reset-password/confirm', (req, res, next) => {
  logger.info(`Confirming password reset with token: ${req.body.token}`);
  authController.resetPassword(req, res, next);
});

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
router.post('/change-password', authMiddleware.authenticate, (req, res, next) => {
  logger.info(`Password change request for user: ${req.user?.loginName || 'unknown'}`);
  authController.changePassword(req, res, next);
});

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
router.post('/cleanup-tokens', authMiddleware.authenticate, authMiddleware.isAdmin, (req, res, next) => {
  logger.info(`Token cleanup request by admin: ${req.user?.loginName || 'unknown'}`);
  authController.cleanupExpiredTokens(req, res, next);
});

module.exports = router;