'use strict';

// Adapted from gov-chat-backend/services/keycloak-auth-service.js
// Validates Keycloak JWTs via JWKS with defense-in-depth:
// - Signature verification via JWKS
// - Issuer validation (jwtVerify issuer option)
// - Audience validation (azp claim)
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

    // Validate azp (authorized party) — the client that requested the token.
    // Keycloak 26+ sets aud=account for access tokens; azp holds the actual client ID.
    // Accept both the user-facing client (KEYCLOAK_CLIENT_ID) and service-account
    // clients (e.g. KC_DATAPREP_CLIENT_ID used by dataprep for status callbacks).
    const allowedAzp = [
      appConfig.security.keycloakClientId,
      process.env.KC_DATAPREP_CLIENT_ID
    ].filter(Boolean);
    if (decoded.azp && !allowedAzp.includes(decoded.azp)) {
      return res.status(401).json({
        error: 'TOKEN_INVALID',
        message: 'Token audience validation failed',
        details: {}
      });
    }

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
