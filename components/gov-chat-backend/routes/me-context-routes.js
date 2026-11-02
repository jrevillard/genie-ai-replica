/**
 * /api/me — sanitized self-identity for the frontend (A7 replacement for the
 * deleted GET /api/auth/keycloak/me). Returns a whitelist of the
 * middleware-populated `req.user` doc, including the Arango `_key` the
 * consumers read (ChatFolders directly; Settings via its id fallback chain).
 * /api/me/context — sanitized self-profile for AI personalization.
 * Consumed by the chatqna user-profile client with the caller's own Bearer
 * token. Whitelist mirrors GET /api/users/:userId/context in user-routes.js.
 */
const express = require('express');
const router = express.Router();
const { logger } = require('../shared-lib');

// Authentication is provided by the global keycloakAuthMiddleware.authenticate
// mount in index.js (this router is mounted with keycloakAuth: true).
router.get('/', async (req, res) => {
  try {
    const user = req.user;
    res.json({
      _key: user._key,
      iss_sub: user.iss_sub,
      sub: req.claims?.sub || null,
      email: user.email,
      name: user.name || null,
      fullName: user.fullName || user.personalIdentification?.fullName || null,
      loginName: user.loginName || null,
      // A5 pattern: derive the label from the roles array — provisioned docs carry no scalar role
      role: user.role || (Array.isArray(user.roles) && user.roles.includes('admin') ? 'Admin' : 'User'),
      roles: Array.isArray(user.roles) ? user.roles : [],
      emailVerified: user.emailVerified,
      status: user.status
    });
  } catch (error) {
    logger.error('Error building /api/me', { error: error.message });
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/context', async (req, res) => {
  try {
    const user = req.user;
    const userContext = {
      personalIdentification: {
        fullName: user.personalIdentification?.fullName || user.fullName || 'User',
        dob: user.personalIdentification?.dob || 'Not provided',
        gender: user.personalIdentification?.gender || 'Not provided',
        nationality: user.personalIdentification?.nationality || 'Not provided'
      },
      addressResidency: {
        currentAddress: user.addressResidency?.currentAddress || 'Not provided'
      },
      // A5 fix: derive from the roles array — provisioned docs carry no scalar role
      role: Array.isArray(user.roles) && user.roles.includes('admin') ? 'Admin' : 'User',
      emailVerified: user.emailVerified
    };

    // Farmer profile only when the user opted in (privacy control)
    if (user.farmerProfile && user.farmerProfile.shareWithAI === true) {
      const fp = user.farmerProfile;
      userContext.farmerProfile = {};

      if (fp.farmLocation) {
        userContext.farmerProfile.district = fp.farmLocation.district || 'Not provided';
        userContext.farmerProfile.village = fp.farmLocation.village || 'Not provided';
        if (fp.farmLocation.center && fp.farmLocation.center.lat) {
          userContext.farmerProfile.farmLatitude = fp.farmLocation.center.lat;
          userContext.farmerProfile.farmLongitude = fp.farmLocation.center.lng;
        }
        if (fp.farmLocation.plots && fp.farmLocation.plots.length > 0) {
          userContext.farmerProfile.numberOfPlots = fp.farmLocation.plots.length;
        }
      }

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
    }

    res.json(userContext);
  } catch (error) {
    logger.error('Error building /api/me/context', { error: error.message });
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
