// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Thin OKF auth middleware — uses the SHARED keycloak-auth-service (imported from shared/lib),
// which has the KEYCLOAK_PUBLIC_URL split-URL issuer alias. No service-specific OIDC code.
const keycloakAuthService = require('../shared-lib/keycloak-auth-service');
const { logger } = require('../shared-lib/logger');

/**
 * Per-route Keycloak OIDC authentication. Verifies the Bearer JWT via the shared
 * keycloak-auth-service (jose/JWKS + issuer). On success attaches req.user = payload.
 */
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'TOKEN_INVALID', message: 'Missing Authorization header' });
  }
  // RFC 6750 §2.1: the Bearer scheme is case-insensitive (accept bearer/Bearer/BEARER).
  const match = authHeader.match(/^\s*bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ error: 'TOKEN_INVALID', message: 'Malformed Authorization header' });
  }
  const token = match[1].trim();
  try {
    const payload = await keycloakAuthService.verifyToken(token);
    if (!payload) {
      return res.status(401).json({ error: 'TOKEN_INVALID', message: 'Token verification failed' });
    }
    req.user = payload;
    next();
  } catch (err) {
    logger.error('OKF auth error', { error: err.message, path: req.path });
    return res.status(401).json({ error: 'TOKEN_INVALID', message: err.message });
  }
}

module.exports = { authenticate };
