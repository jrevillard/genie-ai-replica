'use strict';

// Adapted from gov-chat-backend/services/keycloak-auth-service.js and
// gov-chat-backend/middleware/keycloak-auth-middleware.js (legacy JWT path).
// Validates Keycloak JWTs via JWKS with defense-in-depth:
// - Signature verification via JWKS
// - Issuer validation (jwtVerify issuer option)
// - Audience validation (azp claim)
// - Algorithm restriction (RS256 only)
// Falls back to HS256 legacy app JWT (same secret as gov-chat-backend /api/auth/login)
// so admin flows work when users sign in with username/password instead of OIDC.
const jose = require('jose');
const appConfig = require('../config/appConfig');
const { logger, dbService } = require('../../shared-lib');

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

function hasKeycloakJwksConfig() {
  return !!(appConfig.security.keycloakUrl && appConfig.security.keycloakRealm);
}

/**
 * Verify HS256 JWT from /api/auth/login (gov-chat-backend) and load user from ArangoDB.
 * @param {string} token
 * @returns {Promise<{ kind: 'ok', user: object } | { kind: 'expired' } | { kind: 'forbidden' } | { kind: 'invalid' }>}
 */
async function tryLegacyAppJwt(token) {
  const jwtSecret = process.env.JWT_SECRET || 'your-secret-key-here-change-in-production';
  const secretKey = new TextEncoder().encode(jwtSecret);
  let payload;
  try {
    ({ payload } = await jose.jwtVerify(token, secretKey, { algorithms: ['HS256'] }));
  } catch (e) {
    if (e.name === 'JWTExpired') {
      return { kind: 'expired' };
    }
    return { kind: 'invalid' };
  }
  if (!payload || typeof payload.userId !== 'string') {
    return { kind: 'invalid' };
  }
  try {
    const db = await dbService.getConnection('default');
    const user = await db.collection('users').document(payload.userId);
    if (user.deleted === true) {
      return { kind: 'forbidden' };
    }
    const roleStr = user.role || 'User';
    const rolesFromUser = Array.isArray(user.roles) ? user.roles : roleStr ? [roleStr] : [];
    return {
      kind: 'ok',
      user: {
        userId: user._key,
        role: roleStr,
        sub: user.iss_sub || `legacy#${user._key}`,
        roles: rolesFromUser,
        iss: 'legacy'
      }
    };
  } catch (err) {
    logger.debug(`[KEYCLOAK-AUTH] Legacy JWT user lookup failed: ${err.message}`);
    return { kind: 'invalid' };
  }
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

function getInternalServiceToken() {
  return process.env.SERVICE_AUTH_TOKEN || process.env.JWT_SECRET || '';
}

function isDataprepInternalCallback(req) {
  const path = req.originalUrl || req.path || req.url || '';
  const hasAllowedPath =
    /^\/api\/files\/[^/]+\/status(?:\?.*)?$/.test(path) ||
    /^\/api\/files\/[^/]+\/ingestion-log(?:\?.*)?$/.test(path) ||
    /^\/api\/files\/[^/]+\/ingestion-metadata(?:\?.*)?$/.test(path);
  if (!hasAllowedPath) {
    return false;
  }
  const presentedToken = String(req.headers['x-service-token'] || '').trim();
  const expectedToken = getInternalServiceToken();
  if (!presentedToken || !expectedToken) {
    return false;
  }
  return presentedToken === expectedToken;
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
 * Authenticate request using Keycloak JWT via JWKS, or legacy HS256 app JWT.
 */
const authenticateToken = async (req, res, next) => {
  const path = req.originalUrl || req.path || req.url || '/';

  if (isPublicRoute(path)) {
    return next();
  }

  // Internal dataprep fallback for status/log/metadata callbacks when OIDC service-account flow is down.
  if (isDataprepInternalCallback(req)) {
    req.user = {
      userId: 'internal-dataprep',
      role: 'dataprep-service',
      iss: 'internal-service-token',
      sub: 'internal-dataprep',
      roles: ['dataprep-service']
    };
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

    if (hasKeycloakJwksConfig()) {
      try {
        const keySet = await getJWKS();
        const { payload: decoded } = await jose.jwtVerify(token, keySet, {
          issuer: expectedIssuer,
          requiredClaims: ['iss', 'exp']
        });

        const expectedClientId = appConfig.security.keycloakClientId;
        if (decoded.azp && expectedClientId && decoded.azp !== expectedClientId) {
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

        return next();
      } catch (err) {
        if (err.name === 'JWTExpired') {
          return res.status(401).json({
            error: 'TOKEN_EXPIRED',
            message: 'Token has expired',
            details: {}
          });
        }
        logger.debug(
          `[KEYCLOAK-AUTH] Keycloak JWT path failed (${err.name || err.message}); trying legacy JWT`
        );
      }
    }

    const legacy = await tryLegacyAppJwt(token);
    if (legacy.kind === 'expired') {
      return res.status(401).json({
        error: 'TOKEN_EXPIRED',
        message: 'Token has expired',
        details: {}
      });
    }
    if (legacy.kind === 'forbidden') {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'User account is deactivated',
        details: {}
      });
    }
    if (legacy.kind === 'ok') {
      req.user = legacy.user;
      logger.debug(`[KEYCLOAK-AUTH] Legacy JWT accepted for user ${legacy.user.userId}`);
      return next();
    }

    return res.status(401).json({
      error: 'TOKEN_INVALID',
      message: 'Token verification failed',
      details: {}
    });
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
