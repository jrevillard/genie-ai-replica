const express = require('express');
const router = express.Router();
const multer = require('multer');
const { keycloakAuthMiddleware } = require('../middleware/keycloak-auth-middleware');
const { AppError } = require('../middleware/errors');
const { logger } = require('../shared-lib');
const keycloakProxyService = require('../services/keycloak-proxy-service');
const { JIT_FORWARD_FIELDS } = require('../constants/jit-fields');

/**
 * @swagger
 * tags:
 *   - name: Current User
 *     description: Authenticated user profile management (/api/me singleton)
 *
 */

// Configure multer for in-memory file storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB max file size
  }
});

module.exports = (userService) => {
  if (!userService || typeof userService.getUserProfile !== 'function') {
    logger.error('Invalid userService provided to user-routes');
    throw new Error('userService is required with getUserProfile');
  }

  /**
   * @swagger
   * "/api/me":
   *   get:
   *     summary: Get current user profile
   *     description: Returns the full profile of the authenticated user. User is resolved from the JWT — no ID parameter needed.
   *     tags: [Current User]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     responses:
   *       200:
   *         description: Full user profile
   *       401:
   *         description: Authentication required
   *       404:
   *         description: User not found
   *       500:
   *         description: Server error
   */
  router.get('/', keycloakAuthMiddleware.authenticate, async (req, res) => {
    try {
      const userId = req.user.iss_sub;
      const userKey = req.user._key;
      logger.info(`Getting profile for authenticated user ${userId}`);
      const user = await userService.getUserProfile(userKey);
      res.json(user);
    } catch (error) {
      logger.error(`Error getting user profile: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * @swagger
   * "/api/me/context":
   *   get:
   *     summary: Get user context for AI enrichment
   *     description: Returns a sanitized subset of user data for OPEA AI context enrichment. User is resolved from the JWT.
   *     tags: [Current User]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     responses:
   *       200:
   *         description: Sanitized user context for AI
   *       401:
   *         description: Missing or invalid Keycloak token
   *       404:
   *         description: User not found
   *       500:
   *         description: Server error
   */
  router.get('/context', keycloakAuthMiddleware.authenticate, async (req, res) => {
    try {
      const userKey = req.user._key;
      const user = await userService.getUserProfile(userKey);

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      // Use JWT claims for roles — always fresh from the current token,
      // unlike ArangoDB user document which may be cached (60s TTL).
      // Filter out Keycloak built-in roles (matches frontend filtering).
      const allRoles = (req.claims && req.claims.realm_access && req.claims.realm_access.roles) || [];
      const roles = allRoles.filter(
        (r) => r !== 'offline_access' && r !== 'uma_authorization' && !r.startsWith('default-roles-')
      );

      res.json({
        name: user.name || 'User',
        role: roles,
        emailVerified: user.emailVerified || false
      });
    } catch (error) {
      logger.error(`Error getting user context: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * @swagger
   * "/api/me/reset-data":
   *   post:
   *     summary: Reset user profile data
   *     description: Resets the authenticated user's profile data while preserving the account identity fields (email, name, roles, issuer/subject) and creation date.
   *     tags: [Current User]
   *     security:
   *       - KeycloakOAuth2: ['openid']
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
   *                 message:
   *                   type: string
   *                 userKey:
   *                   type: string
   *                 fieldsPreserved:
   *                   type: integer
   *                   description: Informational count of preserved fields (system-managed identity/audit fields plus client preferences) carried over from the stored document (excludes the updated-at bump).
   *                 filesDeletionFailed:
   *                   type: boolean
   *                   description: True when the uploaded files could not be removed after the reset committed — files may remain on disk.
   *       401:
   *         description: Authentication required
   *       404:
   *         description: User not found
   *       500:
   *         description: Server error
   */
  router.post('/reset-data', keycloakAuthMiddleware.authenticate, async (req, res) => {
    try {
      const userId = req.user.iss_sub;
      const userKey = req.user._key;
      logger.info(`[RESET DATA] Reset request for user ${userId}`);

      const result = await userService.resetUserData(userKey);
      logger.info(`[RESET DATA] User profile data reset successfully for user ${userId}`);

      res.json({
        success: true,
        message: 'User profile data has been reset successfully',
        ...result
      });
    } catch (error) {
      // Typed AppErrors carry their own status and a client-facing message;
      // anything else (driver errors, wrapped responses) is 500 with a
      // generic message — internal error text never reaches the client.
      const isTyped = error instanceof AppError;
      const status = isTyped ? error.statusCode : 500;
      const message = isTyped ? error.message : 'Failed to reset user data';
      // Client-condition failures (404) are warn-grade without a stack — an
      // expected outcome, not alerting noise; only server-side failures log
      // error-grade with the throw-site stack.
      const logFailedReset = status >= 500 ? logger.error.bind(logger) : logger.warn.bind(logger);
      const logContext = status >= 500 ? { stack: error.stack } : {};
      logFailedReset(`[RESET DATA] Error resetting user data: ${error.message}`, logContext);
      res.status(status).json({
        success: false,
        message
      });
    }
  });

  /**
   * @swagger
   * "/api/me/delete":
   *   post:
   *     summary: Delete user account (GDPR right to erasure)
   *     description: Deletes the user from Keycloak and erases all PII from ArangoDB (soft-delete with nullification). This action is irreversible.
   *     tags: [Current User]
   *     security:
   *       - KeycloakOAuth2: ['openid']
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
   *                 message:
   *                   type: string
   *                 filesDeletionFailed:
   *                   type: boolean
   *                   description: True when the uploaded files could not be removed after the erasure committed — files may remain on disk.
   *       401:
   *         description: Authentication required
   *       404:
   *         description: User not found
   *       500:
   *         description: Server error
   */
  router.post('/delete', keycloakAuthMiddleware.authenticate, async (req, res) => {
    try {
      const userId = req.user.iss_sub;
      const userKey = req.user._key;
      logger.info(`[DELETE] Account deletion requested for user ${userId}`);

      const result = await keycloakProxyService.deleteUser(userKey);

      logger.info(`[DELETE] Account deleted successfully for user ${userId}`);
      res.json({
        success: true,
        message: 'Account deleted',
        filesDeletionFailed: result.filesDeletionFailed === true
      });
    } catch (error) {
      // deleteUser tolerates a Keycloak 404 (user already gone) internally —
      // a vanished ArangoDB record surfaces as a typed NotFoundError instead.
      // Typed AppErrors carry their own status and a client-facing message;
      // anything else (driver errors, wrapped responses) is 500 with a
      // generic message — internal error text never reaches the client.
      const isTyped = error instanceof AppError;
      const status = isTyped ? error.statusCode : 500;
      const message = isTyped ? error.message : 'Failed to delete account';
      // Client-condition failures (404) are warn-grade without a stack — an
      // expected outcome, not alerting noise; only server-side failures log
      // error-grade with the throw-site stack.
      const logFailedDelete = status >= 500 ? logger.error.bind(logger) : logger.warn.bind(logger);
      const logContext = status >= 500 ? { stack: error.stack } : {};
      logFailedDelete(`[DELETE] Error deleting account: ${error.message}`, logContext);
      res.status(status).json({ success: false, message });
    }
  });

  /**
   * @swagger
   * "/api/me":
   *   put:
   *     summary: Update current user profile
   *     description: Self-service profile update. JIT fields (email, name) forwarded to Keycloak Account API, custom fields saved to ArangoDB.
   *     tags: [Current User]
   *     security:
   *       - KeycloakOAuth2: ['openid']
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
   *         application/json:
   *           schema:
   *             type: object
   *             description: User profile fields to update
   *     responses:
   *       200:
   *         description: User updated successfully
   *       400:
   *         description: Bad request, invalid profile data
   *       401:
   *         description: Authentication required
   *       404:
   *         description: User not found
   *       500:
   *         description: Server error
   */
  router.put('/', keycloakAuthMiddleware.authenticate, upload.any(), async (req, res) => {
    const userId = req.user.iss_sub;
    const userKey = req.user._key;

    try {
      // Parse profile data (multipart/form-data sends JSON in req.body.data)
      let profileData = {};
      if (req.body.data) {
        try {
          profileData = JSON.parse(req.body.data);
        } catch {
          return res.status(400).json({ success: false, message: 'Invalid profile data format' });
        }
      } else {
        profileData = { ...req.body };
      }

      // Split JIT fields (-> Keycloak) from custom fields (-> ArangoDB)
      const jitFields = {};
      const customFields = {};
      const JIT_KEYS = JIT_FORWARD_FIELDS;

      for (const [key, value] of Object.entries(profileData)) {
        if (JIT_KEYS.includes(key)) {
          jitFields[key] = value;
        } else {
          customFields[key] = value;
        }
      }

      // Forward JIT fields to Keycloak via Account API (user's own token)
      if (Object.keys(jitFields).length > 0) {
        const accessToken = req.headers.authorization?.replace('Bearer ', '');
        if (!accessToken) {
          return res.status(401).json({ success: false, message: 'Missing authorization token' });
        }
        await keycloakProxyService.updateOwnProfile(accessToken, jitFields);
        logger.info(`[PUT /me] JIT fields forwarded to Keycloak for user ${userId}`);
      }

      // Write custom fields to ArangoDB (JIT fields are stripped by updateUserProfile)
      const user = await userService.updateUserProfile(userKey, customFields, req.files || []);
      logger.info(`[PUT /me] Profile updated for user ${userId}`);

      return res.json({ success: true, message: 'Profile saved successfully', user });
    } catch (error) {
      const status = error.status === 404 ? 404 : error.status === 403 ? 403 : 500;
      logger.error(`[PUT /me] Error updating user ${userId}: ${error.message}`, { stack: error.stack });
      res.status(status).json({ success: false, message: error.message || 'Failed to update user' });
    }
  });

  /**
   * Catch-all route for unmatched requests
   */
  router.all('*', (req, res) => {
    res.status(404).json({
      success: false,
      message: `Route not found: ${req.method} ${req.originalUrl}`
    });
  });

  return router;
};
