const express = require('express');
const router = express.Router();
const multer = require('multer');
const keycloakProxyService = require('../services/keycloak-proxy-service');
const userProvisioningService = require('../services/user-provisioning-service');
const { keycloakAuthMiddleware } = require('../middleware/keycloak-auth-middleware');
const { logger } = require('../shared-lib');

// Object-level authorization — authenticate only proves WHO the caller is;
// user-scoped resources also need ownership (or the fresh 'admin' realm
// role, mirroring requireAdmin's claim source).
const isAdminReq = (req) => {
  const roles = req.claims && req.claims.realm_access && req.claims.realm_access.roles;
  return Array.isArray(roles) && roles.includes('admin');
};

/**
 * @swagger
 * tags:
 *   - name: User
 *     description: User profile management
 *   - name: User Administration
 *     description: Admin-specific user management operations
 * 
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *   schemas:
 *     User:
 *       type: object
 *       properties:
 *         _key:
 *           type: string
 *           description: Unique identifier
 *         email:
 *           type: string
 *           format: email
 *           description: User's email address
 *         emailVerified:
 *           type: boolean
 *           description: Whether email has been verified
 *         role:
 *           type: string
 *           enum: [User, Admin, Manager, AI Engineer]
 *           description: User's role
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: Account creation timestamp
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: Last update timestamp
 */

// Configure multer for in-memory file storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  }
});

module.exports = (userService) => {
  if (!userService || typeof userService.getUserProfile !== 'function') {
    logger.error('Invalid userService provided to user-routes');
    throw new Error('userService is required with getUserProfile');
  }
  logger.debug('user-routes initialized with userService', {
    methods: Object.getOwnPropertyNames(Object.getPrototypeOf(userService)).filter(m => m !== 'constructor')
  });

  // Log route initialization
  logger.info('User Routes Module: LOADED');
  logger.info('Total routes in stack:', router.stack.length);
  router.stack.forEach((middleware, index) => {
    if (middleware.route) {
      logger.info(`Route ${index}: ${JSON.stringify(middleware.route.methods)} - ${middleware.route.path}`);
    }
  });

  // Helper function to mask sensitive fields in the request body
  const maskSensitiveFields = (body) => {
    const safeBody = { ...body };
    if (safeBody.password) safeBody.password = '******';
    if (safeBody.token) safeBody.token = '******';
    if (safeBody.encPassword) safeBody.encPassword = '******';
    return safeBody;
  };

  // A6: keep the realm's `admin` role in sync on Admin↔other transitions.
  // The Arango `role` is a display label; the ONLY authorization role is the
  // realm role, synced via the proxy so it applies to the user's next token.
  // Sync happens BEFORE the label write — on proxy failure the error surfaces
  // and the label stays unchanged (no half-state). KC 401/403 is our service
  // account's problem, not the caller's — surfacing it invites the frontend's
  // signinSilent loop, so both are mapped to 502 (other KC statuses pass).
  const syncRealmAdminRole = async (user, newRole) => {
    const wasAdmin = user.role === 'Admin';
    const willBeAdmin = newRole === 'Admin';
    if (wasAdmin === willBeAdmin) return;
    try {
      if (willBeAdmin) {
        await keycloakProxyService.assignRealmRole(user._key, 'admin');
      } else {
        await keycloakProxyService.removeRealmRole(user._key, 'admin');
      }
    } catch (kcError) {
      logger.error(`[ADMIN] Keycloak role sync failed for ${user._key}: ${kcError.message}`);
      const status = kcError.status === 401 || kcError.status === 403 ? 502 : kcError.status || 502;
      const error = new Error('Failed to sync the Keycloak admin role. Please try again.');
      error.status = status;
      throw error;
    }
  };

  /**
   * @swagger
   * /api/users/email:
   *   put:
   *     summary: Update user's email address
   *     description: Updates the user's email via the Keycloak Account API with the
   *       user's own token. Keycloak runs its own email verification when configured;
   *       the ArangoDB email refreshes from token claims on the next login.
   *     tags: [User]
   *     security:
   *       - bearerAuth: []
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
   *                 description: New email address
   *                 example: newemail@example.com
   *     responses:
   *       200:
   *         description: Email update submitted to Keycloak
   *       400:
   *         description: Bad request, missing email
   *       401:
   *         description: Authentication required
   *       409:
   *         description: Keycloak conflict (e.g. email already in use)
   *       500:
   *         description: Server error
   */
  router.put('/email', async (req, res) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }

      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const accessToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!accessToken) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // A6: email self-service via the Keycloak Account API with the user's own
      // token (upstream updateOwnProfile pattern). The old pending-email-change /
      // verification-token machinery is deleted — KC owns verification, and the
      // Arango email refreshes from claims on the next login.
      await keycloakProxyService.updateOwnProfile(accessToken, { email });

      res.json({
        success: true,
        message: 'Email update submitted to Keycloak. If email verification is enabled, follow the instructions sent to your new address.'
      });
    } catch (error) {
      // Keycloak errors carry their status (409 duplicate email etc.) — the raw
      // message stays in the log, the client gets a fixed friendly one
      const status = error.status || 500;
      logger.error(`Error updating email: ${error.message}`, { stack: error.stack });
      res.status(status).json({ success: false, message: 'Failed to update email' });
    }
  });

  /**
   * @swagger
   * /api/users/check-email:
   *   get:
   *     summary: Check if email is available
   *     description: Checks if an email address is available for registration or email change
   *     tags: [User]
   *     parameters:
   *       - in: query
   *         name: email
   *         schema:
   *           type: string
   *           format: email
   *         required: true
   *         description: Email address to check
   *         example: test@example.com
   *     responses:
   *       200:
   *         description: Email availability check result
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 available:
   *                   type: boolean
   *                 message:
   *                   type: string
   *                   example: Email parameter is required
   *       400:
   *         description: Bad request, missing email parameter
   *       500:
   *         description: Server error
   */
  router.get('/check-email', async (req, res) => {
    try {
      const email = req.query.email;
      
      logger.info(`Email check request received for: ${email}`);
      
      if (!email) {
        logger.warn('Email check missing email parameter');
        return res.status(400).json({ available: false, message: 'Email parameter is required' });
      }
      
      const isAvailable = await userService.isEmailAvailable(email);
      logger.info(`Email availability check for ${email}: ${isAvailable ? 'available' : 'not available'}`);
      
      res.json({ available: isAvailable });
    } catch (error) {
      logger.error(`Error checking email availability: ${error.message}`, { stack: error.stack });
      res.status(500).json({ available: false, message: 'Error checking email availability' });
    }
  });

  /**
   * @swagger
   * /api/users/farmer-profile:
   *   get:
   *     summary: Get farmer profile for current user
   *     description: Retrieves farmer-specific profile data (farm location, crops, livestock, cooperatives)
   *     tags: [User]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Farmer profile retrieved successfully
   *       404:
   *         description: No farmer profile found
   *       401:
   *         description: Unauthorized
   */
  router.get('/farmer-profile', async (req, res) => {
    try {
      const userId = req.user._key;
      logger.info('[FARMER PROFILE] GET request', { userId });

      const user = await userService.getUserProfile(userId);
      if (!user || !user.farmerProfile) {
        return res.status(404).json({ message: 'No farmer profile found' });
      }

      res.json({ farmerProfile: user.farmerProfile });
    } catch (error) {
      logger.error('[FARMER PROFILE] Error fetching farmer profile:', { error: 'Internal server error' });
      res.status(500).json({ message: 'Error fetching farmer profile' });
    }
  });

  /**
   * @swagger
   * /api/users/farmer-profile:
   *   put:
   *     summary: Create or update farmer profile
   *     description: Saves farmer-specific profile data (farm location, crops, livestock, cooperatives)
   *     tags: [User]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Farmer profile saved successfully
   *       400:
   *         description: Invalid data
   *       401:
   *         description: Unauthorized
   */
  router.put('/farmer-profile', async (req, res) => {
    try {
      const userId = req.user._key;
      const { farmLocation, farmDetails, crops, livestock, cooperatives, shareWithAI } = req.body;

      logger.info('[FARMER PROFILE] PUT request', { userId });

      // Validate GPS coordinates if center point provided
      if (farmLocation && farmLocation.center) {
        const lat = parseFloat(farmLocation.center.lat);
        const lng = parseFloat(farmLocation.center.lng);
        if (farmLocation.center.lat != null && (isNaN(lat) || lat < -90 || lat > 90)) {
          return res.status(400).json({ message: 'Invalid latitude (must be between -90 and 90)' });
        }
        if (farmLocation.center.lng != null && (isNaN(lng) || lng < -180 || lng > 180)) {
          return res.status(400).json({ message: 'Invalid longitude (must be between -180 and 180)' });
        }
      }

      // Validate plot polygon coordinates
      if (farmLocation && farmLocation.plots && Array.isArray(farmLocation.plots)) {
        if (farmLocation.plots.length > 100) {
          return res.status(400).json({ message: 'Too many plots (maximum 100)' });
        }
        for (const plot of farmLocation.plots) {
          if (plot.coordinates && Array.isArray(plot.coordinates)) {
            if (plot.coordinates.length > 1000) {
              return res.status(400).json({ message: 'Too many coordinates per plot (maximum 1000)' });
            }
            for (const coord of plot.coordinates) {
              if (!Array.isArray(coord) || coord.length < 2) {
                return res.status(400).json({ message: 'Invalid plot coordinates format' });
              }
              const [pLat, pLng] = coord;
              if (pLat < -90 || pLat > 90 || pLng < -180 || pLng > 180) {
                return res.status(400).json({ message: 'Plot coordinates out of valid range' });
              }
            }
          }
        }
      }

      const farmerProfile = {
        shareWithAI: shareWithAI === true,
        farmLocation: farmLocation || {},
        farmDetails: farmDetails || {},
        crops: crops || [],
        livestock: livestock || [],
        cooperatives: cooperatives || [],
        updatedAt: new Date().toISOString(),
      };

      await userService.updateUserProfile(userId, { farmerProfile });

      logger.info('[FARMER PROFILE] Profile saved', { userId, plotCount: (farmLocation?.plots || []).length });
      res.json({ success: true, message: 'Farmer profile saved successfully' });
    } catch (error) {
      logger.error('[FARMER PROFILE] Error saving farmer profile:', { error: 'Internal server error', stack: error.stack });
      res.status(500).json({ message: 'Error saving farmer profile' });
    }
  });

  /**
   * @swagger
   * /api/users/{userId}:
   *   get:
   *     summary: Get user profile
   *     description: Retrieves a user profile by ID
   *     tags: [User]
   *     parameters:
   *       - in: path
   *         name: userId
   *         schema:
   *           type: string
   *         required: true
   *         description: ID of the user to retrieve
   *     responses:
   *       200:
   *         description: User profile information
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/User'
   *       401:
   *         description: Authentication required
   *       404:
   *         description: User not found
   *       500:
   *         description: Server error
   */
  router.get('/:userId', (req, res, next) => {
    if (!req.headers.authorization) {
      logger.warn(`Authentication required for fetching user profile ${req.params.userId}`);
      return res.status(401).json({ 
        error: 'Authentication required', 
        message: 'Not authorized' 
      });
    }
    
    next();
  }, async (req, res) => {
    try {
      // Owners see their own profile; admins get a whitelisted projection of
      // anyone (the raw doc is PII-dense); non-owners get 404 — no oracle.
      const isSelf = req.params.userId === req.user?._key;
      if (!isSelf && !isAdminReq(req)) {
        logger.warn(`Profile read denied: ${req.user?.iss_sub || 'unknown'} → ${req.params.userId}`);
        return res.status(404).json({ message: 'User not found' });
      }
      logger.info(`Getting user profile for ID: ${req.params.userId}`);
      const user = await userService.getUserProfile(req.params.userId);
      if (!isSelf) {
        return res.json({
          _key: user._key,
          email: user.email,
          loginName: user.loginName || null,
          role: user.role || (Array.isArray(user.roles) && user.roles.includes('admin') ? 'Admin' : 'User'),
          roles: Array.isArray(user.roles) ? user.roles : [],
          emailVerified: user.emailVerified,
          status: user.status,
          createdAt: user.createdAt || null
        });
      }
      logger.info(`User profile retrieved successfully for ID: ${req.params.userId}`);
      res.json(user);
    } catch (error) {
      logger.error(`Error getting user profile ${req.params.userId}: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: 'Internal server error' });
    }
  });


/**
   * @swagger
   * /api/users/{userId}/context:
   *   get:
   *     summary: Get safe user context for AI
   *     description: Retrieves a sanitized subset of user data specifically for AI context enrichment
   *     tags: [User]
   *     parameters:
   *       - in: path
   *         name: userId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Safe user context
   */
  router.get('/:userId/context', (req, res, next) => {
    // 1. Enforce Authentication
    if (!req.headers.authorization) {
      logger.warn(`Authentication required for fetching user context ${req.params.userId}`);
      return res.status(401).json({ error: 'Authentication required' });
    }
    next();
  }, async (req, res) => {
    try {
      // AI context is the owner's PII (farmer GPS when shared) — owner or admin only.
      if (req.params.userId !== req.user?._key && !isAdminReq(req)) {
        logger.warn(`Context read denied: ${req.user?.iss_sub || 'unknown'} → ${req.params.userId}`);
        return res.status(404).json({ message: 'User not found' });
      }
      logger.info(`Getting AI context for user ID: ${req.params.userId}`);

      // 2. Fetch the full profile internally
      const user = await userService.getUserProfile(req.params.userId);

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      // 3. Create the SANITIZED object strictly for the AI
      const userContext = {
        personalIdentification: {
          fullName: user.personalIdentification?.fullName || 'User',
          dob: user.personalIdentification?.dob || 'Not provided',
          gender: user.personalIdentification?.gender || 'Not provided',
          nationality: user.personalIdentification?.nationality || 'Not provided'
        },
        addressResidency: {
          currentAddress: user.addressResidency?.currentAddress || 'Not provided'
        },
        // We might want role info to adjust the tone (e.g., "Answer as if speaking to a Manager")
        role: user.role,
        emailVerified: user.emailVerified
      };

      // 4. Include farmer profile context if user has opted in (privacy control)
      if (user.farmerProfile && user.farmerProfile.shareWithAI === true) {
        const fp = user.farmerProfile;
        userContext.farmerProfile = {};

        // Farm location (district/village only — not exact GPS for privacy)
        if (fp.farmLocation) {
          userContext.farmerProfile.district = fp.farmLocation.district || 'Not provided';
          userContext.farmerProfile.village = fp.farmLocation.village || 'Not provided';
          // Include approximate coordinates for weather/advisory relevance
          if (fp.farmLocation.center && fp.farmLocation.center.lat) {
            userContext.farmerProfile.farmLatitude = fp.farmLocation.center.lat;
            userContext.farmerProfile.farmLongitude = fp.farmLocation.center.lng;
          }
          if (fp.farmLocation.plots && fp.farmLocation.plots.length > 0) {
            userContext.farmerProfile.numberOfPlots = fp.farmLocation.plots.length;
          }
        }

        // Farm details
        if (fp.farmDetails) {
          if (fp.farmDetails.size) {
            userContext.farmerProfile.farmSize = `${fp.farmDetails.size} ${fp.farmDetails.sizeUnit || 'hectares'}`;
          }
          if (fp.farmDetails.ownershipType) {
            userContext.farmerProfile.ownershipType = fp.farmDetails.ownershipType;
          }
          if (fp.farmDetails.farmingType) {
            userContext.farmerProfile.farmingType = fp.farmDetails.farmingType;
          }
          if (fp.farmDetails.irrigationType) {
            userContext.farmerProfile.irrigationType = fp.farmDetails.irrigationType;
          }
        }

        // Crops
        if (fp.crops && fp.crops.length > 0) {
          userContext.farmerProfile.crops = fp.crops
            .map(c => c.name + (c.season ? ` (${c.season})` : '') + (c.area ? ` ${c.area}ha` : ''))
            .join(', ');
        }

        // Livestock
        if (fp.livestock && fp.livestock.length > 0) {
          userContext.farmerProfile.livestock = fp.livestock
            .map(l => `${l.count || '?'}× ${l.type}` + (l.purpose ? ` (${l.purpose})` : ''))
            .join(', ');
        }

        // Cooperatives
        if (fp.cooperatives && fp.cooperatives.length > 0) {
          userContext.farmerProfile.cooperatives = fp.cooperatives
            .map(g => g.name + (g.role ? ` [${g.role}]` : ''))
            .join(', ');
        }

        logger.info(`[USER CONTEXT] Farmer profile included for user ${req.params.userId} (shareWithAI=true)`);
      }
      
      logger.info(`User context retrieved successfully for ID: ${req.params.userId}`);
      res.json(userContext); // Send ONLY the safe data
    } catch (error) {
      logger.error(`Error getting user context ${req.params.userId}: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  

  /**
   * @swagger
   * /api/users:
   *   post:
   *     summary: Create user profile
   *     description: Creates a new user profile with optional file uploads
   *     tags: [User]
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
   *     responses:
   *       201:
   *         description: User profile created successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/User'
   *       400:
   *         description: Invalid profile data format
   *       500:
   *         description: Server error
   */
  // Admin-only: user documents are created by JIT provisioning (A6) — this
  // route is an admin escape hatch, not self-service identity minting.
  router.post('/', keycloakAuthMiddleware.requireAdmin, upload.any(), async (req, res) => {
    try {
      const safeBody = maskSensitiveFields(req.body);
      logger.info("Files:", req.files ? req.files.length : 0);
      
      let profileData = {};
      
      if (req.body.data) {
        try {
          profileData = JSON.parse(req.body.data);
        } catch (error) {
          logger.error(`Error parsing profile data: ${error.message}`, { stack: error.stack });
          return res.status(400).json({ message: 'Invalid profile data format' });
        }
      }
      
      logger.info("Parsed profile data:", JSON.stringify(profileData));
      
      const user = await userService.createUserProfile(profileData, req.files || []);
      logger.info(`User profile created successfully`);
      
      res.status(201).json(user);
    } catch (error) {
      logger.error(`Error creating user profile: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  /**
   * @swagger
   * /api/users/{userId}:
   *   delete:
   *     summary: Delete user profile
   *     description: Deletes a user profile by ID
   *     tags: [User]
   *     parameters:
   *       - in: path
   *         name: userId
   *         schema:
   *           type: string
   *         required: true
   *         description: ID of the user to delete
   *     responses:
   *       204:
   *         description: User profile deleted successfully
   *       404:
   *         description: User not found
   *       500:
   *         description: Server error
   */
  router.delete('/:userId', async (req, res) => {
    try {
      // GDPR self-delete or admin removal — nobody else's.
      if (req.params.userId !== req.user?._key && !isAdminReq(req)) {
        logger.warn(`Profile delete denied: ${req.user?.iss_sub || 'unknown'} → ${req.params.userId}`);
        return res.status(403).json({ message: 'You can only delete your own profile' });
      }
      logger.info(`Deleting user profile for ID: ${req.params.userId}`);
      await userService.deleteUserProfile(req.params.userId);
      logger.info(`User profile deleted successfully for ID: ${req.params.userId}`);
      res.status(204).send();
    } catch (error) {
      logger.error(`Error deleting user profile ${req.params.userId}: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  /**
   * @swagger
   * /api/users:
   *   get:
   *     summary: Search users
   *     description: Search for users based on criteria with pagination
   *     tags: [User]
   *     parameters:
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 20
   *         description: Maximum number of users to return
   *       - in: query
   *         name: offset
   *         schema:
   *           type: integer
   *           default: 0
   *         description: Number of users to skip
   *       - in: query
   *         name: email
   *         schema:
   *           type: string
   *         description: Filter by email (optional)
   *       - in: query
   *         name: role
   *         schema:
   *           type: string
   *           enum: [User, Admin, Manager, AI Engineer]
   *         description: Filter by role (optional)
   *     responses:
   *       200:
   *         description: Search results
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 users:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/User'
   *                 total:
   *                   type: integer
   *                   example: 42
   *                 limit:
   *                   type: integer
   *                   example: 20
   *                 offset:
   *                   type: integer
   *                   example: 0
   *       401:
   *         description: Authentication required
   *       500:
   *         description: Server error
   */
  // The user directory is admin tooling — full PII docs to any authenticated
  // caller was an IDOR (audit F5). requireAdmin reads fresh JWT claims.
  router.get('/', keycloakAuthMiddleware.requireAdmin, async (req, res) => {
    try {
      const { limit = 20, offset = 0, ...criteria } = req.query;
      logger.info("Search criteria:", JSON.stringify(criteria));
      logger.info("Limit:", limit, "Offset:", offset);

      const results = await userService.searchUsers(criteria, parseInt(limit), parseInt(offset));
      logger.info(`User search completed successfully`);
      
      res.json(results);
    } catch (error) {
      logger.error(`Error searching users: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  /**
   * @swagger
   * /api/users/reset-data:
   *   post:
   *     summary: Reset user profile data
   *     description: Resets a user profile data while preserving essential account information
   *     tags: [User]
   *     security:
   *       - bearerAuth: []
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
   *                   example: true
   *                 message:
   *                   type: string
   *                   example: User profile data has been reset successfully
   *       401:
   *         description: Authentication required
   *       500:
   *         description: Server error
   */
  router.post('/reset-data', async (req, res) => {
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
      
      // Get user ID from authenticated user object
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
      
      const result = await userService.resetUserData(userId);
      logger.info(`[RESET DATA] User profile data reset successfully for user ID: ${userId}`);
      
      res.json({
        success: true,
        message: 'User profile data has been reset successfully',
        ...result
      });
    } catch (error) {
      logger.error(`[RESET DATA] Error resetting user data: ${error.message}`, { stack: error.stack });
      res.status(500).json({ 
        success: false, 
        message: 'Failed to reset user data' 
      });
    }
  });

  /**
   * @swagger
   * /api/users/delete:
   *   post:
   *     summary: Permanently delete user account
   *     description: Permanently deletes a user account with password verification
   *     tags: [User]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - password
   *             properties:
   *               password:
   *                 type: string
   *                 description: Current password for verification
   *               reason:
   *                 type: string
   *                 description: Reason for deleting the account (optional)
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
   *                   example: true
   *                 message:
   *                   type: string
   *                   example: Account deleted
   *       400:
   *         description: Bad request, missing password
   *       401:
   *         description: Authentication required
   *       403:
   *         description: Incorrect password
   *       404:
   *         description: User not found
   *       500:
   *         description: Server error
   */
  router.post('/delete', async (req, res) => {
    try {
      const safeBody = maskSensitiveFields(req.body);
      logger.info('Delete account request body:', JSON.stringify(safeBody, null, 2));

      const userId = req.user && (
        req.user._key || req.user.id || req.user._id || req.user.userId ||
        (req.user.user && req.user.user._key) || (req.user.user && req.user.user.id) ||
        (req.user.user && req.user.user._id)
      );

      if (!userId) {
        logger.error('Delete account failed: Could not determine user ID from auth data');
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      const { reason } = req.body;

      logger.info(`Processing account deletion for user ID: ${userId}, Reason: ${reason || 'Not provided'}`);

      const user = await userService.getUserProfile(userId);
      if (!user) {
        logger.error(`User ${userId} not found for deletion`);
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      // DEC-3 (A5): the local-password confirmation gate is gone — Keycloak owns credentials.
      // A6: upstream GDPR delete via the proxy — the Keycloak user is deleted
      // (404 tolerated) and Arango PII nullified, so re-login is impossible.
      // (Replaces deleteUserAccountPermanently; uploaded files still die here.)
      await userService.deleteUserFiles(user);
      await keycloakProxyService.deleteUser(userId);
      logger.info(`Account deleted successfully for user ID: ${userId}`);

      res.json({ success: true, message: 'Account deleted' });
    } catch (error) {
      const status = error.status || 500;
      logger.error(`Error deleting account: ${error.message}`, { stack: error.stack });
      res.status(status).json({ success: false, message: 'Failed to delete account' });
    }
  });

  /**
   * @swagger
   * /api/users/{userId}:
   *   put:
   *     summary: Update user profile or role
   *     description: Updates a user's profile data or role (admin only for role updates)
   *     tags: [User]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: userId
   *         schema:
   *           type: string
   *         required: true
   *         description: ID of the user to update
   *     requestBody:
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               data:
   *                 type: string
   *                 description: JSON string containing user profile data
   *               role:
   *                 type: string
   *                 enum: [User, Admin, Manager, AI Engineer]
   *                 description: User role (admin only)
   *               files:
   *                 type: array
   *                 items:
   *                   type: string
   *                   format: binary
   *                 description: Files to upload (optional)
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               role:
   *                 type: string
   *                 enum: [User, Admin, Manager, AI Engineer]
   *                 description: User role (admin only)
   *     responses:
   *       200:
   *         description: User profile or role updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 message:
   *                   type: string
   *                   example: Profile saved successfully
   *                 user:
   *                   type: object
   *                   description: Updated user data (only when profile is updated)
   *                 role:
   *                   type: string
   *                   description: Updated role (only when role is updated)
   *                   example: Admin
   *       400:
   *         description: Bad request, invalid profile data or role
   *       401:
   *         description: Authentication required
   *       403:
   *         description: Forbidden, admin privileges required for role updates
   *       404:
   *         description: User not found
   *       500:
   *         description: Server error
   */
  router.put('/:userId', upload.any(), (req, res, next) => {
    // Role changes are admin-only (requireAdmin reads JWT claims — Arango's scalar
    // role died with A5); plain profile updates are owner-or-admin self-service.
    if (req.body && req.body.role) return keycloakAuthMiddleware.requireAdmin(req, res, next);
    if (req.params.userId !== req.user?._key && !isAdminReq(req)) {
      logger.warn(`Profile update denied: ${req.user?.iss_sub || 'unknown'} → ${req.params.userId}`);
      return res.status(403).json({ message: 'You can only update your own profile' });
    }
    next();
  }, async (req, res) => {
    logger.info('\n=======================================================');
    logger.info('========= PUT USER ROUTE ACCESSED =========');
    logger.info(`Method: ${req.method}`);
    logger.info(`Full URL: ${req.originalUrl}`);
    logger.info(`User ID from params: ${req.params.userId}`);
    logger.info(`Is authenticated: ${!!req.user}`);
    logger.info(`User role: ${req.user?.role}`);
    logger.info(`Content-Type: ${req.get('Content-Type')}`);
    logger.info(`Files: ${req.files ? JSON.stringify(req.files.map(f => f.fieldname)) : 'none'}`);
    logger.info('=======================================');

    try {
      if (req.body.role) {
        logger.info(`[ADMIN] Update user role request for user ID: ${req.params.userId}`);
        logger.info(`[ADMIN] Update data: ${JSON.stringify(req.body)}`);
        
        const allowedRoles = ['User', 'Admin', 'Manager', 'AI Engineer'];
        if (!allowedRoles.includes(req.body.role)) {
          logger.warn(`[ADMIN] Invalid role ${req.body.role} requested for user ${req.params.userId}`);
          return res.status(400).json({ 
            success: false, 
            message: `Role must be one of: ${allowedRoles.join(', ')}` 
          });
        }
        
        const user = await userService.getUserProfile(req.params.userId);
        if (!user) {
          logger.warn(`[ADMIN] User with ID ${req.params.userId} not found for role update`);
          return res.status(404).json({
            success: false,
            message: 'User not found'
          });
        }

        // A6: realm admin-role sync on Admin↔other transitions (before the label write)
        try {
          await syncRealmAdminRole(user, req.body.role);
        } catch (syncError) {
          return res.status(syncError.status || 502).json({ success: false, message: syncError.message });
        }

        const updateData = {
          role: req.body.role,
          updatedAt: new Date().toISOString()
        };

        await userService.users.update(req.params.userId, updateData);
        // A6: bust the provisioning cache so the label flip is served immediately
        if (user.iss_sub) {
          userProvisioningService.evictUser(user.iss_sub);
        }
        logger.info(`[ADMIN] User ${req.params.userId} role updated to ${req.body.role} successfully`);

        return res.json({
          success: true,
          message: 'User role updated successfully',
          role: req.body.role
        });
      } else {
        const safeBody = maskSensitiveFields(req.body);
        logger.info("Update request body:", JSON.stringify(safeBody, null, 2));
        logger.info("Update files:", req.files ? req.files.length : 0);
        
        let profileData = {};
        
        if (req.body.data) {
          try {
            profileData = JSON.parse(req.body.data);
          } catch (error) {
            logger.error(`Error parsing profile data: ${error.message}`, { stack: error.stack });
            return res.status(400).json({ 
              success: false, 
              message: 'Invalid profile data format' 
            });
          }
        } else {
          profileData = req.body;
        }
        
        logger.info("Parsed profile data for update:", JSON.stringify(profileData));
        
        const user = await userService.updateUserProfile(req.params.userId, profileData, req.files || []);
        logger.info(`User profile updated successfully for user ID: ${req.params.userId}`);
        
        return res.json({
          success: true,
          message: 'Profile saved successfully',
          user: user
        });
      }
    } catch (error) {
      logger.error(`Error updating user ${req.params.userId}: ${error.message}`, { stack: error.stack });
      res.status(500).json({ 
        success: false, 
        message: 'Failed to update user' 
      });
    }
  });

  /**
   * @swagger
   * /api/users/{userId}/role:
   *   put:
   *     summary: Update user role
   *     description: Updates a user's role (admin only)
   *     tags: [User Administration]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: userId
   *         schema:
   *           type: string
   *         required: true
   *         description: ID of the user to update
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - role
   *             properties:
   *               role:
   *                 type: string
   *                 enum: [User, Admin, Manager, AI Engineer]
   *                 description: New role to assign to the user
   *     responses:
   *       200:
   *         description: User role updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 message:
   *                   type: string
   *                   example: User role updated successfully
   *                 role:
   *                   type: string
   *                   example: Admin
   *       400:
   *         description: Bad request, invalid role
   *       401:
   *         description: Authentication required
   *       403:
   *         description: Forbidden, admin privileges required
   *       404:
   *         description: User not found
   *       500:
   *         description: Server error
   */
  router.put('/:userId/role', keycloakAuthMiddleware.requireAdmin, async (req, res) => {
    logger.info('\n=======================================================');
    logger.info('========= PUT USER/ROLE ROUTE ACCESSED =========');
    logger.info(`Method: ${req.method}`);
    logger.info(`Full URL: ${req.originalUrl}`);
    logger.info(`User ID from params: ${req.params.userId}`);
    logger.info(`Is authenticated: ${!!req.user}`);
    logger.info(`User role: ${req.user?.role}`);
    logger.info(`Content-Type: ${req.get('Content-Type')}`);
    logger.info('=======================================');

    try {
      logger.info(`[ADMIN] Update user role only request for user ID: ${req.params.userId}`);
      logger.info(`[ADMIN] New role: ${req.body.role}`);
      
      const allowedRoles = ['User', 'Admin', 'Manager', 'AI Engineer'];
      if (!allowedRoles.includes(req.body.role)) {
        logger.warn(`[ADMIN] Invalid role ${req.body.role} requested for user ${req.params.userId}`);
        return res.status(400).json({ 
          success: false, 
          message: `Role must be one of: ${allowedRoles.join(', ')}` 
        });
      }
      
      const user = await userService.getUserProfile(req.params.userId);
      if (!user) {
        logger.warn(`[ADMIN] User with ID ${req.params.userId} not found for role update`);
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // A6: realm admin-role sync on Admin↔other transitions (before the label write)
      try {
        await syncRealmAdminRole(user, req.body.role);
      } catch (syncError) {
        return res.status(syncError.status || 502).json({ success: false, message: syncError.message });
      }

      const updateData = {
        role: req.body.role,
        updatedAt: new Date().toISOString()
      };

      await userService.users.update(req.params.userId, updateData);
      // A6: bust the provisioning cache so the label flip is served immediately
      if (user.iss_sub) {
        userProvisioningService.evictUser(user.iss_sub);
      }
      logger.info(`[ADMIN] User ${req.params.userId} role updated to ${req.body.role} successfully`);

      return res.json({
        success: true,
        message: 'User role updated successfully',
        role: req.body.role
      });
    } catch (error) {
      logger.error(`Error updating user role for ${req.params.userId}: ${error.message}`, { stack: error.stack });
      res.status(500).json({ 
        success: false, 
        message: 'Failed to update user role' 
      });
    }
  });

/**
 * @swagger
 * /api/users/admin/users/{userId}/resend-verification:
 *   post:
 *     summary: Resend email verification
 *     description: Admin only endpoint to resend verification email to a user
 *     tags: [User Administration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         schema:
 *           type: string
 *         required: true
 *         description: ID of the user to resend verification email to
 *     responses:
 *       200:
 *         description: Verification email sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Verification email sent successfully
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Forbidden, admin privileges required
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
router.post('/admin/users/:userId/resend-verification', keycloakAuthMiddleware.requireAdmin, async (req, res) => {
  logger.info('\n=======================================================');
  logger.info('========= POST ADMIN/USERS/:userId/RESEND-VERIFICATION ROUTE ACCESSED =========');
  logger.info(`Method: ${req.method}`);
  logger.info(`Full URL: ${req.originalUrl}`);
  logger.info(`User ID from params: ${req.params.userId}`);
  logger.info(`Is authenticated: ${!!req.user}`);
  logger.info(`User role: ${req.user?.role}`);
  logger.info('=======================================');

  try {
    const userId = req.params.userId;
    logger.info(`[ADMIN] Resend verification email request for user ID: ${userId}`);

    const user = await userService.getUserProfile(userId);
    if (!user) {
      logger.warn(`[ADMIN] User with ID ${userId} not found`);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // A6: Keycloak's own VERIFY_EMAIL required action via the Admin API —
    // KC sends its own templates. The emailVerified:false nudge is gone:
    // the claim refreshes from the token on the next login.
    await keycloakProxyService.sendVerifyEmail(userId);
    logger.info(`[ADMIN] Verification email sent for user ${userId}`);

    return res.json({
      success: true,
      message: 'Verification email sent successfully'
    });
  } catch (error) {
    const status = error.status || 500;
    logger.error(`[ADMIN] Error resending verification email for user ${req.params.userId}: ${error.message}`, { stack: error.stack });
    return res.status(status).json({
      success: false,
      message: 'Failed to resend verification email'
    });
  }
});

/**
 * @swagger
 * /api/users/admin/users/{userId}/force-logout:
 *   post:
 *     summary: Force logout a user
 *     description: Admin-only endpoint to force logout a user by invalidating their tokens and ending all active sessions
 *     tags: [User Administration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         schema:
 *           type: string
 *         required: true
 *         description: ID of the user to force logout
 *     responses:
 *       200:
 *         description: User logged out successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: User logged out successfully
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Forbidden, admin privileges required
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
router.post('/admin/users/:userId/force-logout', keycloakAuthMiddleware.requireAdmin, async (req, res) => {
  logger.info('\n=======================================================');
  logger.info('========= POST ADMIN/USERS/:userId/FORCE-LOGOUT ROUTE ACCESSED =========');
  logger.info(`Method: ${req.method}`);
  logger.info(`Full URL: ${req.originalUrl}`);
  logger.info(`User ID from params: ${req.params.userId}`);
  logger.info(`Authenticated user: ${req.user?._key || 'unknown'}`);
  logger.info(`User role: ${req.user?.role || 'unknown'}`);
  logger.info(`Timestamp: ${new Date().toISOString()}`);
  logger.info('=======================================');

  try {
    const userId = req.params.userId;
    const adminId = req.user?._key;

    logger.info(`[FORCE LOGOUT] Admin ${adminId} requested force logout for user ${userId}`);

    if (!userId) {
      logger.warn(`[FORCE LOGOUT] Missing userId in request`);
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }

    const result = await userService.forceUserLogout(userId, adminId);

    logger.info(`[FORCE LOGOUT] User ${userId} logged out successfully by admin ${adminId}`);
    return res.json({
      success: true,
      message: 'User logged out successfully'
    });
  } catch (error) {
    logger.error(`[FORCE LOGOUT] Error forcing logout for user ${req.params.userId} by admin ${req.user?._key}: ${error.message}`, {
      stack: error.stack,
      userId: req.params.userId,
      adminId: req.user?._key,
      timestamp: new Date().toISOString()
    });

    if (error.message === 'User not found') {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.status(500).json({ success: false, message: 'Failed to force logout' });
  }
});

/**
 * Catch-all route for unmatched requests
 * Logs details of unmatched requests for debugging
 */
router.all('*', (req, res) => {
  logger.warn('\n=========================================================');
  logger.warn(`[UNMATCHED ROUTE DEBUG] ${new Date().toISOString()} - Unmatched Request`);
  logger.warn('=========================================================');
  logger.warn(`[UNMATCHED ROUTE DEBUG] Method: ${req.method}`);
  logger.warn(`[UNMATCHED ROUTE DEBUG] URL: ${req.originalUrl}`);
  logger.warn(`[UNMATCHED ROUTE DEBUG] Path: ${req.path}`);
  logger.warn(`[UNMATCHED ROUTE DEBUG] Headers:`, JSON.stringify(req.headers, (key, value) => 
    key.toLowerCase() === 'authorization' ? value.substring(0, 20) + '...' : value, 2));
  logger.warn(`[UNMATCHED ROUTE DEBUG] Body:`, JSON.stringify(maskSensitiveFields(req.body), null, 2));
  logger.warn(`[UNMATCHED ROUTE DEBUG] Query:`, JSON.stringify(req.query, null, 2));
  logger.warn(`[UNMATCHED ROUTE DEBUG] Registered Routes:`, router.stack
    .filter(layer => layer.route)
    .map(layer => `${Object.keys(layer.route.methods).map(m => m.toUpperCase()).join(', ')}: ${layer.route.path}`));

  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`
  });
});

logger.info('User Routes Module: LOADED');
logger.info('Initializing user routes with base path assumption: /api/users');
logger.info('Total routes in stack:', router.stack.length);
router.stack.forEach((middleware, index) => {
  if (middleware.route) {
    const path = middleware.route.path;
    const methods = Object.keys(middleware.route.methods).map(m => m.toUpperCase()).join(', ');
    logger.info(`Route ${index}: ${methods} - /api/users${path}`);
  } else if (middleware.name === 'router') {
    logger.info(`Route ${index}: Sub-router mounted at ${middleware.regexp}`);
  } else {
    logger.info(`Route ${index}: Middleware - ${middleware.name || 'anonymous'}`);
  }
});

  // ============================================================
  // END OF ROUTES
  // ============================================================

  return router;
};