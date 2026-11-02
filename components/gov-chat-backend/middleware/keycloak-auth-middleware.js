'use strict';
// Ported verbatim from upstream v2.0.1 components/gov-chat-backend/middleware/keycloak-auth-middleware.js (Epic A5).
// Upstream: opensource.unicc.org/un/itu/genie-ai @ upstream-v2.0.1.
// Local note: the old inline provisioner (Pending status + admin-notify email) was a product
// delta — A6 re-integrates it on top of user-provisioning-service (see epic-A-context.md).

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
  // Check static public paths
  const isStaticPublic = PUBLIC_PATHS.some((publicPath) => {
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
    // Use originalUrl (full path) because req.path is relative to mount point
    // when middleware is mounted via app.use(basePath, middleware, ...)
    // Strip the query string: /health?probe=1 must still match PUBLIC_PATHS (A5 fix)
    const path = (req.originalUrl || req.path || req.url || '/').split('?')[0];
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

        // A6 product delta: approval lifecycle gate (DEC-3). Old pre-A5 middleware
        // semantics restored under the {error, message, details} contract —
        // Rejected/disabled accounts are hard-blocked; Pending users get the
        // ACCOUNT_PENDING code the frontend redirects on (/pending-approval).
        if (user.status === 'Rejected' || user.disabled === true) {
          const isRejected = user.status === 'Rejected';
          logger.info(`[KeycloakAuth Middleware] User ${isRejected ? 'rejected' : 'disabled'}: ${user.iss_sub}`);
          return res.status(403).json({
            error: 'FORBIDDEN',
            message: isRejected
              ? 'Your account registration has been rejected. Please contact your system administrator for more information.'
              : 'Your account has been disabled. Please contact your system administrator.',
            details: {}
          });
        }

        if (user.status === 'Pending') {
          logger.info(`[KeycloakAuth Middleware] User pending approval: ${user.iss_sub}`);
          return res.status(403).json({
            error: 'ACCOUNT_PENDING',
            message: 'Your account is pending approval by an administrator.',
            details: { email: user.email || null }
          });
        }

        // Attach ArangoDB user document to request
        req.user = user;

        // Preserve JWT claims for downstream use
        req.claims = decoded;

        next();
      } catch (err) {
        if (err.code === 'TOKEN_EXPIRED') {
          // Check user status in Keycloak via UserInfo to determine if disabled/deleted.
          // A5 fix: only probe issuers discovery vouched for (tokenIssuer comes from the
          // UNVERIFIED payload — dialing it verbatim is an SSRF probe primitive), and
          // only when a sub exists to build the iss_sub key.
          if (
            token &&
            tokenIssuer &&
            tokenPayload &&
            tokenPayload.sub &&
            keycloakAuthService.isTrustedIssuer(tokenIssuer)
          ) {
            const statusResult = await keycloakAuthService.checkUserStatusInKeycloak(token, tokenIssuer);
            if (statusResult && statusResult.disabled) {
              // Update ArangoDB user to reflect disabled status
              try {
                // Reuse already-parsed payload to extract sub for user identification
                const issSub = `${tokenIssuer}#${tokenPayload.sub}`;
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

        // Discovery/JWKS-init failures are an outage, not a bad token — answer 503 so
        // clients don't re-auth loop (A5 fix); doc-repo middleware uses the same shape.
        if (err.code === 'AUTH_SERVICE_UNAVAILABLE') {
          return res.status(503).json({
            error: 'AUTH_SERVICE_UNAVAILABLE',
            message: 'Authentication service unavailable',
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
    // Use JWT claims (req.claims) instead of ArangoDB user (req.user.roles)
    // to avoid stale cached roles when Keycloak role assignments change.
    // req.claims is set from the verified JWT on every request, so it is always fresh.
    const roles = req.claims && req.claims.realm_access && req.claims.realm_access.roles;
    if (!roles || !Array.isArray(roles) || !roles.includes('admin')) {
      logger.warn(
        `[requireAdmin] Access denied for ${req.user?.iss_sub || 'unknown'} — roles: ${JSON.stringify(roles)}`
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
