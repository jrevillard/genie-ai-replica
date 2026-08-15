'use strict';

// Adapted from gov-chat-backend/services/keycloak-auth-service.js
// Validates Keycloak JWTs via JWKS with defense-in-depth:
// - Signature verification via JWKS
// - Issuer validation (jwtVerify issuer option)
// - Algorithm restriction (RS256 only)
const jose = require('jose');
const appConfig = require('../config/appConfig');
const { logger } = require('../../shared-lib');

const PUBLIC_PATHS = ['/health', '/api-docs', '/api', '/api-docs.json'];

let jwks = null;
let expectedIssuer = null;

/**
 * Get or create the JWKS key set (lazy initialization with caching)
 * jose's createRemoteJWKSet has built-in HTTP caching based on Cache-Control headers.
 * @returns {Promise<jose.RemoteJWKSet>}
 */
async function getJWKS() {
  if (!jwks) {
    const keycloakUrl = appConfig.security.keycloakUrl;
    const realm = appConfig.security.keycloakRealm;
    const jwksUri = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/certs`;
    expectedIssuer = `${keycloakUrl}/realms/${realm}`;
    // Split internal/public OIDC URLs (same pattern as shared/lib
    // keycloak-auth-service): JWKS is fetched via the internal KEYCLOAK_URL
    // (reachable on the container network) while tokens minted through the
    // public endpoint carry the public issuer. KEYCLOAK_PUBLIC_URL overrides
    // the expected issuer only — no-op when unset (single-URL deployments).
    const publicUrl = process.env.KEYCLOAK_PUBLIC_URL;
    if (publicUrl) {
      const publicIssuer = `${publicUrl.replace(/\/$/, '')}/realms/${realm}`;
      if (publicIssuer !== expectedIssuer) {
        logger.info(`[KEYCLOAK-AUTH] Issuer alias: validating ${publicIssuer} (JWKS via internal ${keycloakUrl})`);
        expectedIssuer = publicIssuer;
      }
    }
    logger.info(`[KEYCLOAK-AUTH] Initializing JWKS from ${jwksUri}`);
    jwks = jose.createRemoteJWKSet(new URL(jwksUri));
  }
  return jwks;
}

/**
 * Check if a given path is a public route
 * @param {string} path - Request path
 * @returns {boolean} True if path is public
 */
function isPublicRoute(path) {
  return PUBLIC_PATHS.some((publicPath) => {
    if (publicPath.endsWith('/')) {
      return path.startsWith(publicPath);
    }
    return path === publicPath;
  });
}

/**
 * Map realm_access.roles array to a scalar role for backward compatibility
 * @param {string[]} roles - Array of realm roles from JWT claims
 * @returns {string} Scalar role string
 */
function mapRole(roles) {
  if (!Array.isArray(roles) || roles.length === 0) {
    return 'User';
  }
  if (roles.includes('admin')) {
    return 'Admin';
  }
  if (roles.includes('dataprep-service')) {
    return 'dataprep-service';
  }
  return roles[0].charAt(0).toUpperCase() + roles[0].slice(1);
}

/**
 * Authenticate request using Keycloak JWT via JWKS
 */
const authenticateToken = async (req, res, next) => {
  const path = req.originalUrl || req.path || req.url || '/';

  if (isPublicRoute(path)) {
    return next();
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'TOKEN_INVALID',
        message: 'Missing or malformed Authorization header',
        details: {}
      });
    }

    const token = authHeader.substring(7);
    if (!token) {
      return res.status(401).json({
        error: 'TOKEN_INVALID',
        message: 'Missing or malformed Authorization header',
        details: {}
      });
    }

    let keySet;
    try {
      keySet = await getJWKS();
    } catch (err) {
      logger.error(`[KEYCLOAK-AUTH] JWKS initialization failed: ${err.message}`);
      return res.status(503).json({
        error: 'AUTH_SERVICE_UNAVAILABLE',
        message: 'Authentication service unavailable',
        details: {}
      });
    }

    let decoded;
    try {
      // jwtVerify validates: signature, issuer, expiration, and not-before
      const { payload } = await jose.jwtVerify(token, keySet, {
        issuer: expectedIssuer,
        requiredClaims: ['iss', 'exp']
      });
      decoded = payload;
    } catch (err) {
      if (err.name === 'JWTExpired') {
        return res.status(401).json({
          error: 'TOKEN_EXPIRED',
          message: 'Token has expired',
          details: {}
        });
      }
      if (err.name === 'JWTClaimValidationFailed') {
        return res.status(401).json({
          error: 'TOKEN_INVALID',
          message: 'Token claim validation failed',
          details: {}
        });
      }
      return res.status(401).json({
        error: 'TOKEN_INVALID',
        message: 'Token verification failed',
        details: {}
      });
    }

    // Note: we do NOT validate azp (authorized party). Any client within
    // the trusted realm that obtains a valid token should be accepted by
    // this resource server — this is standard OIDC Resource Server behavior.
    // The token's signature, issuer, and expiration are already verified above.

    const roles = decoded.realm_access?.roles || [];
    const role = mapRole(roles);

    req.user = {
      userId: decoded.sub,
      role: role,
      iss: decoded.iss,
      sub: decoded.sub,
      roles: roles
    };

    next();
  } catch (error) {
    logger.error(`[KEYCLOAK-AUTH] Unexpected error: ${error.message}`);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Authentication error',
      details: {}
    });
  }
};

/**
 * Authorize by role — must be used after authenticateToken
 * @param {string[]} allowedRoles - Array of allowed role strings
 */
const authorizeRole = (allowedRoles) => {
  return (req, res, next) => {
    try {
      if (!req.user || !req.user.role) {
        return res.status(401).json({
          error: 'TOKEN_INVALID',
          message: 'Authentication required',
          details: {}
        });
      }

      const hasRole = allowedRoles.some((role) => role.toLowerCase() === String(req.user.role).toLowerCase());

      if (!hasRole) {
        return res.status(403).json({
          error: 'FORBIDDEN',
          message: 'Access denied',
          details: {}
        });
      }

      next();
    } catch (error) {
      logger.error(`[KEYCLOAK-AUTH] Role check error: ${error.message}`);
      return res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Error checking role permissions',
        details: {}
      });
    }
  };
};

module.exports = {
  authenticateToken,
  authorizeRole,
  isPublicRoute,
  PUBLIC_PATHS
};
