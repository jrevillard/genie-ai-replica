'use strict';

// Validates Keycloak JWTs by delegating to the shared OIDC verifier
// (components/shared/lib/keycloak-auth-service.js — the single copy, also
// consumed by gov-chat-backend and okf-server). This middleware keeps
// only what is doc-repo-shaped: the public-path skip, Bearer extraction, the
// error→HTTP mapping with the 401 root-cause log, and the per-component role
// mapping (mapRole/authorizeRole — realm roles stay a per-component contract).
const keycloakAuthService = require('../../shared-lib/keycloak-auth-service');
const { logger } = require('../../shared-lib');

const PUBLIC_PATHS = ['/health', '/api-docs', '/api', '/api-docs.json'];

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
  // The okf-server orchestrator's service-account token — must
  // map verbatim (like dataprep-service), else the scalar falls through to the
  // first role ('offline_access') and authorizeRole rejects it.
  if (roles.includes('okf-service')) {
    return 'okf-service';
  }
  // tools-admin super-role (fileRoutes authorizeRole lists it): same verbatim
  // mapping rule — a tools-admin USER token's realm roles are typically
  // ['default-roles-genie', 'offline_access', 'uma_authorization',
  // 'tools-admin'], so without this the scalar falls through to
  // 'Default-roles-genie' and every tools-admin grant is dead for most tokens.
  if (roles.includes('tools-admin')) {
    return 'tools-admin';
  }
  return roles[0].charAt(0).toUpperCase() + roles[0].slice(1);
}

/**
 * Authenticate request using Keycloak JWT via the shared OIDC verifier
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

    let decoded;
    try {
      // verifyToken validates: signature (RS256), issuer (discovery issuer +
      // configured aliases), expiration, and not-before. The service hides
      // Keycloak discovery/JWKS details and RESOLVES TO THE CLAIMS PAYLOAD
      // itself (with an added iss_sub composite key). Init/cooldown failures
      // throw TokenVerificationError AUTH_SERVICE_UNAVAILABLE — mapped to the
      // 503 below, the doc-repo contract the frontend httpService handles.
      decoded = await keycloakAuthService.verifyToken(token);
    } catch (err) {
      // [DIAG 2026-09-15] Publish 401 root cause — log full token-vs-expected
      // mismatch (issuer / signature / expiration) so the next 401 is
      // diagnosable from the container log alone. The payload is decoded ONCE
      // (base64url — no padding hack, which breaks unpadded base64url tokens).
      let diagClaims = null;
      try {
        diagClaims = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString());
      } catch {
        diagClaims = null; // unparseable token — the null fields say so
      }
      if (err && err.code === 'AUTH_SERVICE_UNAVAILABLE') {
        // Keycloak discovery down / init cooldown — NOT a bad token. Kept as
        // the doc-repo 503 contract (frontend httpService handles this code);
        // the backend middleware maps the same condition to the same 503 —
        // per-component HTTP mapping over the one shared verifier. Warn-level
        // with no token diagnostics: an outage must not flood the error
        // stream with per-request entries and bury genuine 401 root causes.
        logger.warn('[KEYCLOAK-AUTH] verifier unavailable', {
          path,
          err_message: err && err.message
        });
        return res.status(503).json({
          error: 'AUTH_SERVICE_UNAVAILABLE',
          message: 'Authentication service unavailable',
          details: {}
        });
      }
      logger.error('[KEYCLOAK-AUTH] verifyToken failed', {
        path,
        err_name: err && err.name,
        err_code: err && err.code,
        err_message: err && err.message,
        token_issuer: (diagClaims && diagClaims.iss) || 'unparseable',
        token_exp: (diagClaims && diagClaims.exp) || 0,
        accepted_issuers: keycloakAuthService.getConfiguredIssuers()
      });
      if (err && err.code === 'TOKEN_EXPIRED') {
        return res.status(401).json({
          error: 'TOKEN_EXPIRED',
          message: 'Token has expired',
          details: {}
        });
      }
      // Fixed client-facing message, matching the backend middleware — the
      // verifier's internal message ('Unknown issuer', 'Cannot decode JWT
      // payload', ...) stays in the DIAG log above.
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
      roles: roles,
      // The okf scope list rides the token
      // (user-attribute protocol mapper on the genie-app + okf-server
      // clients). The serve-refusal gate keys on it — a caller holding the
      // repo's okf scope is INSIDE the restriction fence's exception, not
      // outside it (refused WITHOUT the okf scope). Absent claim = no
      // scopes, never an error.
      okfScopes: Array.isArray(decoded.okf_scopes) ? decoded.okf_scopes : []
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
