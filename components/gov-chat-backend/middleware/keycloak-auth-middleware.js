'use strict';

const keycloakAuthService = require('../services/keycloak-auth-service');
const userProvisioningService = require('../services/user-provisioning-service');
const authService = require('../services/auth-service');
const { logger } = require('../shared-lib');

/**
 * Accept HS256 JWT from /api/auth/login when Keycloak is absent or the token is not an OIDC access token.
 * @param {string} token
 * @param {Object} req
 * @returns {Promise<boolean>} true if req.user / req.claims were set
 */
async function tryLegacyJwtAuth(token, req) {
  if (!authService.initialized) {
    logger.warn('[KeycloakAuth Middleware] AuthService not initialized; skipping legacy JWT');
    return false;
  }
  const legacyDecoded = await authService.verifyToken(token);
  if (!legacyDecoded) {
    return false;
  }
  const user = await authService.getUserById(legacyDecoded.userId);
  if (!user) {
    return false;
  }
  if (user.deleted === true) {
    return false;
  }
  const issSub = user.iss_sub || `legacy#${user._key}`;
  req.user = { ...user, iss_sub: issSub };
  req.claims = {
    ...legacyDecoded,
    iss_sub: issSub
  };
  logger.debug(`[KeycloakAuth Middleware] Legacy JWT accepted for user ${user._key}`);
  return true;
}

/**
 * Public routes that do not require authentication
 */
const PUBLIC_PATHS = [
  '/health',
  '/api/health',
  '/api-docs',
  '/api-docs/',
  '/docs',
  '/api/auth/callback',
  '/api/auth/logout/callback'
];

/**
 * Check if a given path is a public route
 * @param {string} path - Request path
 * @returns {boolean} True if path is public
 */
function isPublicRoute(path) {
  // Check static public paths
  const isStaticPublic = PUBLIC_PATHS.some(publicPath => {
    if (publicPath.endsWith('/')) {
      return path === publicPath || path.startsWith(publicPath);
    }
    return path === publicPath || path.startsWith(publicPath + '/');
  });
  if (isStaticPublic) return true;

  return false;
}

/**
 * Extract Bearer token from Authorization header
 * @param {Object} req - Express request
 * @returns {string|null} Token string or null
 */
function extractBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.substring(7);
  if (!token) {
    return null;
  }
  return token;
}

/**
 * Keycloak Auth Middleware — validates OIDC (Keycloak) JWTs on protected routes, with a
 * fallback to the legacy HS256 JWT issued by /api/auth/login so local / minimal Docker stacks
 * work without a Keycloak container.
 */
const keycloakAuthMiddleware = {
  /**
   * Authenticate request using Keycloak JWT or legacy app JWT
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   * @param {Function} next - Express next middleware
   */
  async authenticate(req, res, next) {
    // Skip auth for public routes
    // Use originalUrl (full path) because req.path is relative to mount point
    // when middleware is mounted via app.use(basePath, middleware, ...)
    const path = req.originalUrl || req.path || req.url || '/';
    if (isPublicRoute(path)) {
      return next();
    }

    try {
      const token = extractBearerToken(req);

      if (!token) {
        return res.status(401).json({
          error: 'TOKEN_INVALID',
          message: 'Missing or malformed Authorization header',
          details: {}
        });
      }

      // Extract issuer and sub from token for potential Keycloak introspection
      // Parse once to avoid duplication - payload only used for introspection URL construction
      let tokenIssuer;
      let tokenPayload;
      try {
        tokenPayload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
        tokenIssuer = tokenPayload.iss;
      } catch {
        // If we can't extract issuer, we'll skip introspection
      }

      try {
        const decoded = await keycloakAuthService.verifyToken(token);

        // Provision or update user in ArangoDB
        let user;
        try {
          user = await userProvisioningService.provisionUser(decoded);
        } catch (provisioningErr) {
          logger.error(`[KeycloakAuth Middleware] Provisioning failed: ${provisioningErr.message}`);
          return res.status(500).json({
            error: 'PROVISIONING_FAILED',
            message: 'User provisioning failed',
            details: {}
          });
        }

        // Soft-deleted users are blocked (defense-in-depth)
        if (user.deleted === true) {
          return res.status(403).json({
            error: 'FORBIDDEN',
            message: 'User account is deactivated',
            details: {}
          });
        }

        // Attach ArangoDB user document to request
        req.user = user;

        // Preserve JWT claims for downstream use
        req.claims = decoded;

        next();
      } catch (err) {
        if (err.code === 'TOKEN_EXPIRED') {
          // Check user status in Keycloak via UserInfo to determine if disabled/deleted
          if (token && tokenIssuer && tokenPayload) {
            const statusResult = await keycloakAuthService.checkUserStatusInKeycloak(token, tokenIssuer);
            if (statusResult && statusResult.disabled) {
              // Update ArangoDB user to reflect disabled status
              try {
                // Reuse already-parsed payload to extract sub for user identification
                const issSub = `${tokenIssuer}#${tokenPayload.sub}`;

                // Find user in ArangoDB and mark as deleted
                const userProvisioningService = require('../services/user-provisioning-service');
                await userProvisioningService.markUserAsDeleted(issSub);
                logger.info(`[KeycloakAuth Middleware] Marked user as deleted in ArangoDB: ${issSub}`);
              } catch (updateErr) {
                logger.warn(`[KeycloakAuth Middleware] Failed to mark user as deleted: ${updateErr.message}`);
              }
            }
          }

          return res.status(401).json({
            error: 'TOKEN_EXPIRED',
            message: 'Token has expired',
            details: {}
          });
        }

        // Keycloak missing, misconfigured, or token is the legacy app JWT (no OIDC issuer)
        if (await tryLegacyJwtAuth(token, req)) {
          return next();
        }

        return res.status(401).json({
          error: 'TOKEN_INVALID',
          message: 'Token verification failed',
          details: {}
        });
      }
    } catch (error) {
      logger.error(`[KeycloakAuth Middleware] Unexpected error: ${error.message}`);
      return res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Authentication error',
        details: {}
      });
    }
  },

  /**
   * Require admin role — must be used after authenticate
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   * @param {Function} next - Express next middleware
   */
  requireAdmin(req, res, next) {
    const roles = req.user && req.user.roles;
    const roleField = req.user && req.user.role;
    const hasLegacyRole =
      typeof roleField === 'string' && roleField.toLowerCase() === 'admin';
    const hasRolesArray =
      Array.isArray(roles) && roles.some((r) => String(r).toLowerCase() === 'admin');
    if (!hasLegacyRole && !hasRolesArray) {
      logger.warn(
        `[requireAdmin] Access denied for ${req.user?.iss_sub || 'unknown'} — role: ${roleField}, roles: ${JSON.stringify(roles)}`
      );
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Admin access required',
        details: {}
      });
    }
    next();
  }
};

module.exports = {
  keycloakAuthMiddleware,
  PUBLIC_PATHS,
  isPublicRoute
};
