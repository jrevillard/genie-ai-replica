// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// OKF scope enforcement (Story 6.1, ADR-okf-025 §4 default-deny). Scope
// grammar: okf:{tenant}:{repo}:{read|admin} with `*` wildcards. Two factories:
//  - requireScope('okf:read') — ANY okf read-or-admin scope (or wildcard, or
//    the tools-admin bootstrap super-role) must be present. Router-wide gate.
//  - requireRepoScope(repoParamOrId, 'admin') — the caller must hold admin on
//    THAT repo (exact match or wildcard, or super-role) for per-repo
//    mutations. Replaces the global tools-admin role check (G15).
// Denials are 403 FORBIDDEN_SCOPE + a best-effort okf_audit row (never fails
// the request — same semantics as audit-service.writeAudit).

const { logger } = require('../shared-lib/logger');
const { writeAudit } = require('../services/audit-service');

/** Parse `okf:{tenant}:{repo}:{level}` → {tenant, repo, level} | null. */
function parseOkfScope(scope) {
  if (typeof scope !== 'string') return null;
  const parts = scope.split(':');
  if (parts.length !== 4 || parts[0] !== 'okf') return null;
  return { tenant: parts[1], repo: parts[2], level: parts[3] };
}

const LEVEL_SATISFIES = {
  read: (level) => level === 'read' || level === 'admin',
  admin: (level) => level === 'admin'
};

function actorFromReq(req) {
  const u = (req && req.user) || {};
  return {
    sub: u.sub,
    name: u.name || u.preferred_username,
    source_ip: req && req.ip
  };
}

/** Best-effort denial audit — writeAudit never throws; guard anyway. */
function auditDenial(action, req, repoId) {
  Promise.resolve(
    writeAudit({ action, actor: actorFromReq(req), repo_id: repoId || null, source_ip: req && req.ip })
  ).catch(() => {
    /* never fail the request on audit */
  });
}

function deny(res, message) {
  return res.status(403).json({ error: 'FORBIDDEN_SCOPE', message });
}

/**
 * Router-wide gate: the caller holds ANY okf scope at read-or-admin level
 * (exact or wildcard), or is the tools-admin bootstrap super-role.
 */
function requireScope(requiredLevel = 'read') {
  return (req, res, next) => {
    const scopes = Array.isArray(req.okfScopes) ? req.okfScopes : [];
    const satisfies = LEVEL_SATISFIES[requiredLevel] || LEVEL_SATISFIES.read;
    const has = scopes.some((s) => {
      const p = parseOkfScope(s);
      return !!p && satisfies(p.level);
    });
    if (has || req.okfIsSuperAdmin) return next();
    logger.warn('OKF authz denied: no okf scope', { sub: req.user && req.user.sub, path: req.path });
    auditDenial('authz.denied.scope', req);
    return deny(res, 'This operation requires an okf read scope');
  };
}

/**
 * Per-repo gate: the caller holds `admin` (or the requested level) on THIS
 * repo (exact match or wildcard), or is the bootstrap super-role.
 * @param {string} repoParamOrId — a req.params key (default 'repo_id') or a
 *        literal repo_id.
 * @param {string} level — 'admin' (default) or 'read'.
 */
function requireRepoScope(repoParamOrId = 'repo_id', level = 'admin') {
  return (req, res, next) => {
    const repoId = (req.params && req.params[repoParamOrId]) || repoParamOrId;
    const scopes = Array.isArray(req.okfScopes) ? req.okfScopes : [];
    const satisfies = LEVEL_SATISFIES[level] || LEVEL_SATISFIES.admin;
    const has = scopes.some((s) => {
      const p = parseOkfScope(s);
      return !!p && satisfies(p.level) && (p.repo === '*' || p.repo === repoId);
    });
    if ((repoId && has) || req.okfIsSuperAdmin) return next();
    logger.warn('OKF authz denied: missing repo scope', {
      sub: req.user && req.user.sub,
      repo_id: repoId,
      path: req.path
    });
    auditDenial('authz.denied.repo', req, repoId || undefined);
    return deny(res, `This operation requires an okf ${level} scope for repository ${repoId}`);
  };
}

module.exports = { requireScope, requireRepoScope, parseOkfScope };
