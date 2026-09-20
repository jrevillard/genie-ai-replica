// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 6.1b — GET /api/okf/authz/graphs (read side of the authz resolver).
// Mounted under the /api/okf router, so the router-wide authenticate +
// requireScope('read') gates apply before this handler: the caller arrives
// with req.user (verified token), req.okfScopes and req.okfIsSuperAdmin.

const authzResolverService = require('../services/authz-resolver-service');

/** GET /api/okf/authz/graphs — the caller's traversable serving-graph set. */
async function getGraphs(req, res, next) {
  try {
    const body = await authzResolverService.resolveGraphSet({
      okfScopes: req.okfScopes,
      isSuperAdmin: req.okfIsSuperAdmin
    });
    res.status(200).json(body);
  } catch (err) {
    next(err);
  }
}

module.exports = { getGraphs };
