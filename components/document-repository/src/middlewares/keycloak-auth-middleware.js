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
// DW-431 (review 2026-10-29 round 3): the acceptable issuers are a LIST, not
// one string. The old single `expectedIssuer` was overwritten in sequence —
// KEYCLOAK_PUBLIC_URL first, then KEYCLOAK_BROWSER_ISSUER — so a deployment
// with both set validated ONLY the browser issuer and rejected public-issuer
// tokens, despite this block's "alongside" comment. Base + each distinct
// alias now accumulate; jwtVerify accepts an issuer array. Single-alias
// deployments keep the old behavior (a one-element array validates exactly
// the one issuer the old string did).
let expectedIssuers = [];

/**
 * Get or create the JWKS key set (lazy initialization with caching)
 * jose's createRemoteJWKSet has built-in HTTP caching based on Cache-Control headers.
 * @returns {Promise<jose.RemoteJWKSet>}
 */
async function getJWKS() {
  if (!jwks) {
    const keycloakUrl = appConfig.security.keycloakUrl;
    const realm = appConfig.security.keycloakRealm;
    // DAVID 2026-09-15: KEYCLOAK_JWKS_URL host override matches okf-server's
    // shared/lib/keycloak-auth-service.js — Keycloak's discovery hands back
    // jwks_uri based on KC_HOSTNAME, which in local Docker resolves to
    // localhost:8080 (unreachable from containers). Operators set this to a
    // container-reachable host. Falls back to the historical
    // `${keycloakUrl}/realms/.../certs` derivation when unset.
    const jwksHostOverride = process.env.KEYCLOAK_JWKS_URL;
    const jwksUri = jwksHostOverride
      ? jwksHostOverride
      : `${keycloakUrl}/realms/${realm}/protocol/openid-connect/certs`;
    // Merge 2026-10-22: main added KEYCLOAK_EXPECTED_ISSUER (appConfig
    // `security.keycloakExpectedIssuer`) to pin the validated `iss`. It says
    // the same thing as our two aliases below via a different variable, so the
    // explicit pin becomes the base value and the aliases layer on top only
    // when it is unset — a pin is never silently overridden by an alias.
    const pinnedIssuer = appConfig.security.keycloakExpectedIssuer;
    expectedIssuers = [pinnedIssuer || `${keycloakUrl}/realms/${realm}`];
    // Split internal/public OIDC URLs (same pattern as shared/lib
    // keycloak-auth-service): JWKS is fetched via the internal KEYCLOAK_URL
    // (reachable on the container network) while tokens minted through the
    // public endpoint carry the public issuer. KEYCLOAK_PUBLIC_URL ADDS an
    // accepted issuer — no-op when unset (single-URL deployments).
    const publicUrl = pinnedIssuer ? null : process.env.KEYCLOAK_PUBLIC_URL;
    if (publicUrl) {
      const publicIssuer = `${publicUrl.replace(/\/$/, '')}/realms/${realm}`;
      if (!expectedIssuers.includes(publicIssuer)) {
        logger.info(`[KEYCLOAK-AUTH] Issuer alias: also validating ${publicIssuer} (JWKS via internal ${keycloakUrl})`);
        expectedIssuers.push(publicIssuer);
      }
    }
    // DAVID 2026-09-15: browser tokens minted via the nginx /auth path carry
    // the issuer `https://localhost/auth/realms/genie` — a path-prefix alias
    // (/auth/realms/<realm>) that neither the internal nor the public URL
    // produces. jwtVerify checks issuer as a literal match, so a mismatched
    // path drops the token with JWTClaimValidationFailed. Honor
    // KEYCLOAK_BROWSER_ISSUER as another accepted issuer ALONGSIDE the
    // already-aliased ones (it used to overwrite them — DW-431) — no-op when
    // unset (single-URL deployments).
    const browserIssuer = pinnedIssuer ? null : process.env.KEYCLOAK_BROWSER_ISSUER;
    if (browserIssuer && !expectedIssuers.includes(browserIssuer)) {
      logger.info(`[KEYCLOAK-AUTH] Browser issuer alias: also validating ${browserIssuer}`);
      expectedIssuers.push(browserIssuer);
    }
    logger.info(`[KEYCLOAK-AUTH] Initializing JWKS from ${jwksUri}`);
    logger.info(`[KEYCLOAK-AUTH] Will validate tokens with issuers=${expectedIssuers.join(', ')}`);
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
  // Story 2.9.1: the okf-server orchestrator's service-account token — must
  // map verbatim (like dataprep-service), else the scalar falls through to the
  // first role ('offline_access') and authorizeRole rejects it.
  if (roles.includes('okf-service')) {
    return 'okf-service';
  }
  // tools-admin super-role (fileRoutes authorizeRole lists it): same verbatim
  // mapping rule — a tools-admin USER token's realm roles are typically
  // ['default-roles-genie', 'offline_access', 'uma_authorization',
  // 'tools-admin'], so without this the scalar falls through to
  // 'Default-roles-genie' and every tools-admin grant is dead for most tokens
  // (review 2026-10-29).
  if (roles.includes('tools-admin')) {
    return 'tools-admin';
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
      // jwtVerify validates: signature, issuer (any of the acceptable
      // issuers — jose accepts an array), expiration, and not-before
      const { payload } = await jose.jwtVerify(token, keySet, {
        issuer: expectedIssuers,
        requiredClaims: ['iss', 'exp']
      });
      decoded = payload;
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
      logger.error('[KEYCLOAK-AUTH] jwtVerify failed', {
        path,
        err_name: err && err.name,
        err_code: err && err.code,
        err_message: err && err.message,
        expected_issuers: expectedIssuers,
        token_issuer: (diagClaims && diagClaims.iss) || 'unparseable',
        token_exp: (diagClaims && diagClaims.exp) || 0
      });
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
