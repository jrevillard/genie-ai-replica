// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Per-route role authorization. Reads roles from the VERIFIED token (OKF's
// middleware/auth.js sets req.user = payload, so roles live at req.user.realm_access.roles).
// There is NO authorizeRole helper in gov-chat-backend to copy — the backend reads
// req.claims.realm_access.roles inline (it uses req.claims; OKF uses req.user).
//
// NOTE: the 'tools-admin' realm role is provisioned by Epic 6 (FR-18). Until then,
// mutating calls 403 against a real Keycloak token — verify via tests with a mocked
// req.user.realm_access.roles = ['tools-admin'].

const { logger } = require('../shared-lib/logger');

/**
 * Express middleware factory: require a Keycloak realm role on the caller.
 * @param {string} role
 */
function requireRole(role) {
  return function requireRoleMiddleware(req, res, next) {
    const roles = (req.user && req.user.realm_access && req.user.realm_access.roles) || [];
    if (!Array.isArray(roles) || !roles.includes(role)) {
      logger.warn('OKF role check failed', {
        required: role,
        path: req.path,
        sub: req.user ? req.user.sub : 'anonymous'
      });
      return res.status(403).json({ error: 'FORBIDDEN_ROLE', message: `This operation requires the '${role}' role` });
    }
    next();
  };
}

module.exports = { requireRole };
