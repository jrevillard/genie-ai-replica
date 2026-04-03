'use strict';

const keycloakAuthService = require('../services/keycloak-auth-service');
const userProvisioningService = require('../services/user-provisioning-service');
const { logger } = require('../shared-lib');

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
  return PUBLIC_PATHS.some(publicPath => {
    if (publicPath.endsWith('/')) {
      return path === publicPath || path.startsWith(publicPath);
    }
    return path === publicPath || path.startsWith(publicPath + '/');
  });
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
 * Build user identity headers for OPEA services
 * @param {Object} claims - Verified JWT claims
 * @returns {Object} Headers object with X-User-Id, X-User-Roles, X-Issuer
 */
function buildUserHeaders(claims) {
  const roles = claims.realm_access?.roles || [];
  return {
    'X-User-Id': `${claims.iss}#${claims.sub}`,
    'X-User-Roles': Array.isArray(roles) ? roles.join(',') : '',
    'X-Issuer': claims.iss
  };
}

/**
 * Keycloak Auth Middleware — validates Keycloak tokens on protected routes
 */
const keycloakAuthMiddleware = {
  /**
   * Authenticate request using Keycloak JWT
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   * @param {Function} next - Express next middleware
   */
  async authenticate(req, res, next) {
    // Skip auth for public routes
    const path = req.path || req.originalUrl || req.url || '/';
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
        if (user === null || user.deleted === true) {
          return res.status(403).json({
            error: 'FORBIDDEN',
            message: 'User account is deactivated',
            details: {}
          });
        }

        // Attach ArangoDB user document to request
        req.user = user;

        // Preserve JWT claims for header construction
        req.claims = decoded;

        // Build and attach OPEA headers for upstream services
        req.user.opeaHeaders = buildUserHeaders(req.claims);

        next();
      } catch (err) {
        if (err.code === 'TOKEN_EXPIRED') {
          return res.status(401).json({
            error: 'TOKEN_EXPIRED',
            message: 'Token has expired',
            details: {}
          });
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
    if (!roles || !Array.isArray(roles) || !roles.includes('admin')) {
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
