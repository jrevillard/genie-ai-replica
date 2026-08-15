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
/**
 * Parse `okf:{tenant}:{repo}:{read|admin}` scopes from the verified payload.
 * Sources: `okf_scopes` claim (array OR space-separated string) first, then the
 * standard `scope` claim (space-separated). Only `okf:`-prefixed string entries
 * are kept; duplicates removed, order preserved (Story 6.1 / ADR-okf-025 D16-a).
 */
function parseOkfScopes(payload) {
  const out = [];
  const seen = new Set();
  const push = (entry) => {
    if (typeof entry === 'string' && entry.startsWith('okf:') && !seen.has(entry)) {
      seen.add(entry);
      out.push(entry);
    }
  };
  const p = payload || {};
  if (Array.isArray(p.okf_scopes)) {
    p.okf_scopes.forEach(push);
  } else if (typeof p.okf_scopes === 'string') {
    p.okf_scopes.split(/\s+/).forEach(push);
  }
  if (typeof p.scope === 'string') {
    p.scope.split(/\s+/).forEach(push);
  }
  return out;
}

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
  // Opt-in audience binding (RFC 8707, Story 6.1): OKF_AUDIENCE gates the check —
  // unset = historical behavior (no audience validation in the shared verifier).
  const verifyOpts = process.env.OKF_AUDIENCE ? { audience: process.env.OKF_AUDIENCE } : {};
  try {
    const payload = await keycloakAuthService.verifyToken(token, verifyOpts);
    if (!payload) {
      return res.status(401).json({ error: 'TOKEN_INVALID', message: 'Token verification failed' });
    }
    req.user = payload;
    // Authorization context (Story 6.1): scopes + bootstrap super-role.
    req.okfScopes = parseOkfScopes(payload);
    req.okfIsSuperAdmin = !!(
      payload.realm_access &&
      Array.isArray(payload.realm_access.roles) &&
      payload.realm_access.roles.includes('tools-admin')
    );
    next();
  } catch (err) {
    logger.error('OKF auth error', { error: err.message, path: req.path });
    return res.status(401).json({ error: 'TOKEN_INVALID', message: err.message });
  }
}

module.exports = { authenticate, parseOkfScopes };
